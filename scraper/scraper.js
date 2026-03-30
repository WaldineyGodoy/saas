const { firefox } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
    console.log('Iniciando Faturista (Modo CRM/Calendário)...');
    
    // 1. Identifica o dia atual, mês ref, ou os dias informados via variável de ambiente
    let targetedDays = [];
    let currentMesRef = "";
    const now = new Date();

    if (process.env.TARGET_DAYS) {
        const targetStr = process.env.TARGET_DAYS.trim();
        // Regex para YYYY-MM-DD (Modo Dia ou Semana via CRM)
        if (targetStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parts = targetStr.split('-');
            const year = parts[0];
            const month = parts[1];
            const day = parseInt(parts[2], 10);
            
            targetedDays = [day];
            currentMesRef = `${month}/${year}`;
        } 
        // Regex para YYYY-MM (Modo Mês via CRM)
        else if (targetStr.match(/^\d{4}-\d{2}$/)) {
            const parts = targetStr.split('-');
            const year = parts[0];
            const month = parts[1];
            
            // Fica vazio para buscar todos os dias do mês
            targetedDays = [];
            currentMesRef = `${month}/${year}`;
        }
        // Fallback: Modo manual antigo (ex: "5, 12, 18")
        else {
            targetedDays = targetStr.split(',').map(d => parseInt(d.trim()));
            currentMesRef = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        }
    } else {
        // Disparo Automático (Cron Diário)
        targetedDays = [now.getDate()];
        currentMesRef = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    }

    console.log(`[Faturista] REF: ${currentMesRef} | Dias de Leitura: ${targetedDays.length ? targetedDays.join(', ') : 'Todos no Mês'}`);

    // 2. Busca UCs da Neoenergia
    console.log('Pesquisando UCs aptas via código (Supabase)...');
    
    let query = supabase
        .from('consumer_units')
        .select(`
            id, 
            numero_uc, 
            subscriber_id,
            titular_fatura_id,
            concessionaria,
            tipo_ligacao,
            tarifa_concessionaria,
            desconto_assinante,
            dia_leitura,
            dia_vencimento,
            last_scraping_status,
            subscriber:subscriber_id (
                id, 
                name, 
                portal_credentials
            ),
            titular_fatura:titular_fatura_id (
                id,
                name,
                portal_credentials
            )
        `)
        .eq('concessionaria', 'Neoenergia Cosern');

    if (targetedDays.length > 0) {
        query = query.in('dia_leitura', targetedDays);
    }

    const { data: allUcs, error: ucError } = await query;

    if (ucError) {
        console.error('Erro ao buscar UCs:', ucError.message);
        return;
    }

    // 2.1 Refinamento Híbrido: Verifica se a fatura já existe no banco (via código)
    const ucsToScrape = [];
    for (const uc of (allUcs || [])) {
        const { data: existingInvoices } = await supabase
            .from('invoices')
            .select('id, concessionaria_pdf_url')
            .eq('uc_id', uc.id)
            .eq('mes_referencia', currentMesRef)
            .not('concessionaria_pdf_url', 'is', null)
            .limit(1);

        if (existingInvoices && existingInvoices.length > 0) {
            console.log(`[Código] UC ${uc.numero_uc}: Fatura [${currentMesRef}] já existe. Pulando scrape.`);
            if (uc.last_scraping_status !== 'success') {
                await updateUCStatus(uc.id, 'success', 'Fatura detectada via consulta de banco de dados.');
            }
        } else {
            console.log(`[Código] UC ${uc.numero_uc}: Fatura [${currentMesRef}] pendente. Adicionando à fila do Agente.`);
            ucsToScrape.push(uc);
        }
    }

    if (ucsToScrape.length === 0) {
        console.log('Nenhuma UC necessita de intervenção do Agente Playwright no momento.');
        return;
    }

    console.log(`\nMarcando ${ucsToScrape.length} UCs como PROCESSING no banco de dados...`);
    for (const uc of ucsToScrape) {
        const { error } = await supabase
            .from('consumer_units')
            .update({ 
                last_scraping_status: 'processing',
                last_scraping_error: null 
            })
            .eq('id', uc.id);
        if (error) console.error(`[Faturista] Erro RLS ao marcar processing em UC ${uc.id}:`, error.message);
    }

    console.log(`\nAgente Playwright Iniciado para ${ucsToScrape.length} UCs.`);

    // 3. Agrupa UCs selecionadas por Titular das Credenciais
    const groups = ucsToScrape.reduce((acc, uc) => {
        // Prioriza o titular_fatura se houver, senão usa o subscriber_id
        const effectiveSub = uc.titular_fatura || uc.subscriber;
        const subId = effectiveSub?.id || uc.subscriber_id;
        
        if (!acc[subId]) {
            acc[subId] = {
                subscriber: effectiveSub,
                credentials: effectiveSub?.portal_credentials,
                ucs: []
            };
        }
        acc[subId].ucs.push(uc);
        return acc;
    }, {});

    console.log(`[Faturista] Iniciando processamento de ${allUcs.length} UCs em ${Object.keys(groups).length} contas de titular.`);

    const browser = await firefox.launch({ headless: true }); 
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        acceptDownloads: true
    });
    const page = await context.newPage();

    async function takeScreenshot(name) {
        const dir = './downloads/debug';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: `${dir}/${name}_${Date.now()}.png` });
    }

    async function updateUCStatus(ucId, status, errorMsg = null) {
        const { error } = await supabase
            .from('consumer_units')
            .update({ 
                last_scraping_status: status,
                last_scraping_at: new Date().toISOString(),
                last_scraping_error: errorMsg
            })
            .eq('id', ucId);
        if (error) {
            console.error(`[Faturista] Erro ao atualizar UC ${ucId} para '${status}':`, error.message);
        }
    }

    // Processa cada grupo (Titular)
    for (const subId in groups) {
        const group = groups[subId];
        const { subscriber, credentials: creds, ucs: groupUcs } = group;

        console.log(`\n=== Processando Assinante: ${subscriber.name} (${groupUcs.length} UCs) ===`);

        if (!creds?.login || !creds?.password) {
            console.error(`Status: ERRO - Credenciais não encontradas para o assinante ${subscriber.name}`);
            for (const uc of groupUcs) {
                await updateUCStatus(uc.id, 'error', 'Credenciais de acesso não configuradas.');
            }
            continue;
        }

        try {
            console.log('Acessando portal Neoenergia...');
            await page.goto('https://agenciavirtual.neoenergia.com/#/login', { waitUntil: 'load', timeout: 60000 });

            let loggedIn = false;
            for (let i = 0; i < 15; i++) {
                await page.waitForTimeout(3000);
                const url = page.url();
                
                const userField = page.locator('input#userId, input[name="username"], input[name="j_username"], input[name="cpfCnpj"], mat-form-field:has-text("CPF") input, mat-form-field:has-text("CNPJ") input, input[formcontrolname="login"], input[formcontrolname="usuario"]').first();
                const passField = page.locator('input#password, input[name="password"], input[name="j_password"], mat-form-field:has-text("Senha") input, input[type="password"]').first();
                const enterBtn = page.locator('button:has-text("ENTRAR"), button[type="submit"]').filter({ hasNotText: 'Visitar' }).first();
                const portalAccessBtn = page.locator('button[aria-label="Conectar-se a agência virtual"]');
                const rnCard = page.locator('mat-card:has-text("Rio Grande do Norte")');
                const ucSearchInput = page.locator('input[placeholder*="digo"], input[placeholder*="Código"], input[placeholder*="Conta"], input[placeholder*="Contrato"], mat-form-field:has-text("Conta") input, mat-form-field:has-text("Contrato") input, mat-form-field:has-text("Código") input, input[type="text"]').first();
                const checkOla = page.locator('text=Olá,').first();
                const checkSair = page.locator('button:has-text("Sair"), a:has-text("Sair")').first();

                // Safe login check: strictly waits for dashboard search input or dashboard cards
                if (await ucSearchInput.isVisible() || page.url().includes('/home/dashboard')) {
                    console.log('ACESSO REALIZADO E DASHBOARD CARREGADO!');
                    loggedIn = true;
                    break;
                }

                if (await checkOla.isVisible()) {
                    const currentUrl = page.url();
                    if (!(await ucSearchInput.isVisible()) && !currentUrl.includes('/dashboard')) {
                        console.log('   [Faturista] Logado, mas preso na home pública. Clicando em "2ª Via de Pagamento"...');
                        const segundaViaBtn = page.locator('mat-card:has-text("2ª Via de Pagamento"), mat-card:has-text("2a Via de Pagamento"), a:has-text("2ª Via de Pagamento")').first();
                        if (await segundaViaBtn.isVisible()) {
                            await segundaViaBtn.click({ force: true });
                        } else {
                            await page.goto('https://agenciavirtual.neoenergia.com/rn/#/home');
                        }
                        continue;
                    }
                }

                if (await userField.isVisible()) {
                    console.log(`   [Faturista] Preenchendo credenciais para ${creds.login} (Modo Humano)...`);
                    const cleanUser = creds.login.replace(/\D/g, '');
                    
                    await userField.click();
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await userField.pressSequentially(cleanUser, { delay: 100 });
                    
                    await passField.click();
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await passField.pressSequentially(creds.password, { delay: 100 });
                    
                    await page.waitForTimeout(2000);
                    if (await enterBtn.isEnabled()) {
                        await enterBtn.click({ noWaitAfter: true });
                    } else {
                        await enterBtn.click({ force: true, noWaitAfter: true });
                    }
                    await page.waitForTimeout(5000);
                    continue;
                }

                const loginBtn = page.locator('.btn-login, button:has-text("LOGIN")').filter({ hasNotText: 'Cadastrar' }).first();
                if (await loginBtn.isVisible() && !(await checkOla.isVisible())) {
                    await loginBtn.click({ force: true });
                    continue;
                }

                if (await rnCard.isVisible()) {
                    await rnCard.click();
                    continue;
                }

                if (await portalAccessBtn.isVisible()) {
                    await portalAccessBtn.click();
                    continue;
                }
            }

            if (!loggedIn) {
                throw new Error('Falha na autenticação ou timeout do portal.');
            }

            for (const uc of groupUcs) {
                try {
                    const paddedUC = uc.numero_uc.toString().padStart(12, '0');
                    console.log(`-> UC: ${uc.numero_uc}`);
                    
                    // Retorno ao painel principal, caso não esteja na home
                    const searchInput = page.locator('input[placeholder*="digo"], input[placeholder*="Código"], input[placeholder*="Conta"], input[placeholder*="Contrato"], mat-form-field:has-text("Conta") input, mat-form-field:has-text("Contrato") input, mat-form-field:has-text("Código") input, input[type="text"]').first();
                    
                    if (!(await searchInput.isVisible())) {
                        console.log('   [Faturista] Buscador não encontrado. Retornando ao dashboard (2ª Via)...');
                        const segundaViaBtn = page.locator('mat-card:has-text("2ª Via de Pagamento"), mat-card:has-text("2a Via de Pagamento"), a:has-text("2ª Via de Pagamento")').first();
                        if (await segundaViaBtn.isVisible()) {
                            await segundaViaBtn.click({ force: true });
                            await page.waitForTimeout(4000);
                        } else {
                            // Tenta ir pelo menu ou página inicial se o botão não estiver visível
                            await page.goto('https://agenciavirtual.neoenergia.com/#/home').catch(() => {});
                            await page.waitForTimeout(4000);
                        }
                    }
                    const userFormField = page.locator('mat-dialog-container input#userId, .mat-mdc-dialog-container input#userId, input#userId, mat-form-field:has-text("CPF") input').filter({ visible: true }).first();
                    if (await userFormField.isVisible()) {
                        await userFormField.fill(creds.login.replace(/\D/g, ''));
                        await page.locator('input#password, input[type="password"]').first().fill(creds.password);
                        await page.locator('button:has-text("ENTRAR"), button[type="submit"]').filter({ hasNotText: 'Visitar' }).filter({ visible: true }).first().click();
                        await page.waitForTimeout(5000);
                    }

                    try {
                        await searchInput.waitFor({ state: 'visible', timeout: 35000 });
                    } catch (e) {
                        const debugPath = `./downloads/debug/timeout_search_${uc.numero_uc}_${Date.now()}.png`;
                        console.error(`[Faturista] Timeout aguardando campo de busca. Tirando print para debug em: ${debugPath}`);
                        const debugDir = './downloads/debug';
                        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
                        await page.screenshot({ path: debugPath });
                        throw e; // Re-lança o erro para o fluxo normal de captura
                    }

                    await searchInput.fill(paddedUC);
                    await page.click('button[aria-label="Pesquisar"]');
                    await page.waitForTimeout(4000);

                    const ucCard = page.locator(`mat-card:has-text("${uc.numero_uc}"), mat-card:has-text("${paddedUC}")`).first();
                    if (await ucCard.isVisible()) {
                        await ucCard.click();
                        await page.waitForSelector('mat-card:has-text("Faturas")', { timeout: 15000 });
                        await page.click('mat-card:has-text("Faturas")');

                        await page.waitForSelector('mat-expansion-panel', { timeout: 30000 });
                        const panels = await page.locator('mat-expansion-panel').all();
                        
                        let foundBill = false;
                        for (const panel of panels) {
                            const statusText = await panel.locator('.mat-content div:nth-child(4) span:nth-child(2)').innerText().catch(() => '');
                            const mesRefStr = await panel.locator('.mat-content div:nth-child(2) span:nth-child(2)').innerText().catch(() => '');
                            
                            if (statusText.includes('Vencida') || statusText.includes('A Vencer')) {
                                console.log(`   Baixando fatura [${mesRefStr.trim()}]...`);
                                const header = panel.locator('mat-expansion-panel-header');
                                await header.click();
                                await page.waitForTimeout(1500);

                                const downloadBtn = panel.locator('button[aria-label*="Download"], button:has-text("Baixar")').first();
                                if (await downloadBtn.isVisible()) {
                                    const [dl] = await Promise.all([
                                        page.waitForEvent('download'),
                                        downloadBtn.click()
                                    ]);
                                    const fileName = `${uc.numero_uc}_${mesRefStr.trim().replace('/', '-')}_${Date.now()}.pdf`;
                                    const localPath = `./downloads/${fileName}`;
                                    await dl.saveAs(localPath);
                                    
                                    const publicUrl = await uploadToSupabase(localPath, uc.numero_uc, fileName);
                                    
                                        // Scanner do PDF para extrair kWh e CIP
                                        const pdfData = await parseInvoicePdf(localPath);

                                        const mesReferenciaBase = pdfData.mesReferencia || parseMesRef(mesRefStr.trim());
                                        if (mesReferenciaBase) {
                                            // Regras de Criação de Fatura Automática
                                            const [month, year] = mesReferenciaBase.split('/').map(Number);
                                            
                                            // Vencimento: Usa o do PDF se houver, senão calcula
                                            let vencimentoStr = pdfData.vencimento;
                                            if (!vencimentoStr) {
                                                let nextMonth = month + 1;
                                                let nextYear = year;
                                                if (nextMonth > 12) { nextMonth = 1; nextYear++; }
                                                const vencimentoDate = new Date(nextYear, nextMonth - 1, uc.dia_vencimento || 10);
                                                vencimentoStr = vencimentoDate.toISOString().split('T')[0];
                                            }

                                            // Regra: Consumo Mínimo por Tipo de Ligação (Fallback se extração falhar)
                                            const kwhMinimo = uc.tipo_ligacao === 'trifasico' ? 100 : (uc.tipo_ligacao === 'bifasico' ? 50 : 30);
                                            const tarifa = Number(uc.tarifa_concessionaria) || 0;
                                            const valorTarifaMinima = kwhMinimo * tarifa;

                                            // Upsert no CRM
                                            await supabase.from('invoices').upsert({ 
                                                uc_id: uc.id, 
                                                mes_referencia: `${year}-${String(month).padStart(2, '0')}-01`,
                                                vencimento: vencimentoStr,
                                                data_leitura: pdfData.dataLeitura,
                                                tipo_ligacao: uc.tipo_ligacao,
                                                tarifa_concessionaria: tarifa,
                                                tarifa_minima: valorTarifaMinima,
                                                consumo_kwh: pdfData.consumoKwh || 0, 
                                                iluminacao_publica: pdfData.cipValor || 0,
                                                outros_lancamentos: pdfData.outrosLancamentos || 0,
                                                consumo_reais: (pdfData.consumoKwh || kwhMinimo) * tarifa, 
                                                valor_a_pagar: pdfData.valorTotal || (((pdfData.consumoKwh || kwhMinimo) * tarifa) + (pdfData.cipValor || 0)), 
                                                desconto_assinante: Number(uc.desconto_assinante) || 0,
                                                status: 'a_vencer',
                                                concessionaria_pdf_url: publicUrl 
                                            }, { onConflict: 'uc_id,mes_referencia' });
                                            
                                            foundBill = true;
                                        }
                                }
                                await header.click();
                            }
                        }

                        if (foundBill) {
                            await updateUCStatus(uc.id, 'success');
                        } else {
                            console.log('   Fatura não disponível no portal ainda.');
                            await updateUCStatus(uc.id, 'not_available', 'Hoje é dia de leitura, mas a fatura ainda não foi postada no portal.');
                        }
                    } else {
                        throw new Error('Unidade não encontrada no painel da concessionária.');
                    }
                } catch (err) {
                    console.error(`   Erro UC ${uc.numero_uc}: ${err.message}`);
                    await updateUCStatus(uc.id, 'error', err.message);
                    await takeScreenshot(`erro_uc_${uc.numero_uc}`);
                }
            }

            console.log('Finalizando sessão do assinante...');
            await page.goto('https://agenciavirtual.neoenergia.com/#/login').catch(() => {});
            await context.clearCookies();

        } catch (groupErr) {
            console.error(`Erro Crítico no Grupo ${subscriber.name}:`, groupErr.message);
            for (const uc of groupUcs) {
                await updateUCStatus(uc.id, 'error', `Erro de login/portal: ${groupErr.message}`);
            }
            await takeScreenshot(`erro_grupo_${subId}`);
        }
    }

    await browser.close();
    console.log('\nProcesso Calendário Neoenergia Finalizado.');
}

async function parseInvoicePdf(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    try {
        const data = await pdf(dataBuffer);
        const text = data.text;

        // Padrões Neoenergia Cosern
        const consumptionMatch = text.match(/(?:Energia Ativa|Consumo Total|Total Consumo)[^\d]*(\d+)[^\d]*kWh/i) || 
                                 text.match(/kWh[^\d]*(\d+)/i) ||
                                 text.match(/(\d+)\s*kWh/i);
        
        const cipMatch = text.match(/(?:CONTR\.? ILUM\.? PUB\.?|COSIP|CIP-MUNICIP\.)[^\d]*([\d,.]+)/i) ||
                         text.match(/Ilum\.?\s*P[uú]bl\.?[^\d]*([\d,.]+)/i);

        const refMonthMatch = text.match(/Mês\s*Referência[:\s]*(\w{3}\/\d{2,4})|REF[:\s]*(\w{3}\/\d{2,4})/i);
        const dueDateMatch = text.match(/Vencimento[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i);
        const totalAmountMatch = text.match(/Total\s*a\s*Pagar[:\s]*R\$?\s*([\d,.]+)|Valor\s*a\s*Pagar[:\s]*R\$?\s*([\d,.]+)/i);
        const readingDateMatch = text.match(/(?:Leitura\s*Atual|Data\s*da\s*Leitura)[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i);
        const othersMatch = text.match(/(?:Outros\s*Lançamentos|Adicionais)[:\s]*R\$?\s*([\d,.]+)/i);

        let consumoKwh = 0;
        if (consumptionMatch) {
            consumoKwh = parseInt(consumptionMatch[1].replace(/\D/g, ''));
        }

        const parseValue = (raw) => {
            if (!raw) return 0;
            if (raw.includes(',') && raw.includes('.')) return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
            if (raw.includes(',')) return parseFloat(raw.replace(',', '.'));
            return parseFloat(raw);
        };

        const formatDate = (raw) => {
            if (!raw) return null;
            const parts = raw.split('/');
            if (parts.length < 2) return null;
            const year = parts[2]?.length === 2 ? `20${parts[2]}` : parts[2];
            return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        };

        let result = {
            consumoKwh,
            cipValor: parseValue(cipMatch ? cipMatch[1] : null),
            mesReferencia: refMonthMatch ? parseMesRef(refMonthMatch[1] || refMonthMatch[2]) : null,
            vencimento: formatDate(dueDateMatch ? dueDateMatch[1] : null),
            valorTotal: parseValue(totalAmountMatch ? totalAmountMatch[1] : null),
            dataLeitura: formatDate(readingDateMatch ? readingDateMatch[1] : null),
            outrosLancamentos: parseValue(othersMatch ? othersMatch[1] : null)
        };

        console.log(`      [Scanner PDF] Extração: MesRef=${result.mesReferencia}, Consumo=${result.consumoKwh} kWh, CIP=R$ ${result.cipValor}, Venc=${result.vencimento}, Total=R$ ${result.valorTotal}`);
        return result;
    } catch (err) {
        console.error('      [Scanner PDF] Erro ao processar arquivo:', err.message);
        return { consumoKwh: 0, cipValor: 0 };
    }
}

function parseMesRef(mesRefStr) {
    const months = {
        'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06',
        'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12'
    };
    const parts = mesRefStr.split('/');
    if (parts.length !== 2) return null;
    const month = months[parts[0].toUpperCase()] || parts[0].padStart(2, '0');
    return `${month}/${parts[1]}`;
}

async function uploadToSupabase(localPath, ucNumber, fileName) {
    const fileBuffer = fs.readFileSync(localPath);
    const storagePath = `invoices/${ucNumber}/${fileName}`;
    
    const { data, error } = await supabase.storage
        .from('invoices')
        .upload(storagePath, fileBuffer, {
            contentType: 'application/pdf',
            upsert: true
        });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
        .from('invoices')
        .getPublicUrl(storagePath);
    
    return publicUrl;
}

const dir = './downloads';
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
run();
