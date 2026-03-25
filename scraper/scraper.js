const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
    console.log('Iniciando agente Neoenergia (Modo Calendário)...');
    
    // 1. Identifica o dia atual para filtrar faturas do calendário
    const todayDay = new Date().getDate();
    console.log(`Dia do Calendário: ${todayDay}`);

    // 2. Busca UCs da Neoenergia cujo dia de leitura é hoje ou já passou no mês corrente
    // E que ainda não possuem a fatura baixada para o mês de referência atual.
    console.log('Pesquisando UCs aptas via código (Supabase)...');
    
    // Calcula o mês de referência atual (ex: "03/2026")
    const now = new Date();
    const currentMesRef = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    
    const { data: allUcs, error: ucError } = await supabase
        .from('consumer_units')
        .select(`
            id, 
            numero_uc, 
            subscriber_id,
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
            )
        `)
        .eq('concessionaria', 'Neoenergia Cosern')
        .lte('dia_leitura', todayDay); // Busca todas as UCs cuja leitura já ocorreu ou ocorre hoje no mês

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

    console.log(`\nAgente Playwright Iniciado para ${ucsToScrape.length} UCs.`);

    // 3. Agrupa UCs selecionadas por Titular
    const groups = ucsToScrape.reduce((acc, uc) => {
        const subId = uc.subscriber_id;
        if (!acc[subId]) {
            acc[subId] = {
                subscriber: uc.subscriber,
                credentials: uc.subscriber?.portal_credentials,
                ucs: []
            };
        }
        acc[subId].ucs.push(uc);
        return acc;
    }, {});

    const browser = await chromium.launch({ headless: true }); // Headless true para GitHub Actions
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
        await supabase
            .from('consumer_units')
            .update({ 
                last_scraping_status: status,
                last_scraping_at: new Date().toISOString(),
                last_scraping_error: errorMsg
            })
            .eq('id', ucId);
    }

    // Processa cada grupo (Titular)
    for (const subId in groups) {
        const group = groups[subId];
        const { subscriber, credentials, ucs: groupUcs } = group;

        console.log(`\n=== Processando Assinante: ${subscriber.name} (${groupUcs.length} UCs) ===`);

        if (!credentials?.login || !credentials?.password) {
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
                
                const userField = page.locator('input#userId');
                const passField = page.locator('input#password');
                const enterBtn = page.locator('button:has-text("ENTRAR")');
                const portalAccessBtn = page.locator('button[aria-label="Conectar-se a agência virtual"]');
                const rnCard = page.locator('mat-card:has-text("Rio Grande do Norte")');
                const searchInput = page.locator('input[placeholder*="Código"]').first();
                const checkOla = page.locator('text=Olá,').first();

                if (url.includes('/home') || await searchInput.isVisible() || await checkOla.isVisible()) {
                    console.log('ACESSO REALIZADO!');
                    loggedIn = true;
                    break;
                }

                if (await userField.isVisible()) {
                    const cleanUser = credentials.login.replace(/\D/g, '');
                    await userField.fill(cleanUser);
                    await passField.fill(credentials.password);
                    await enterBtn.click();
                    await page.waitForLoadState('networkidle').catch(() => {});
                    continue;
                }

                const loginBtn = page.locator('.btn-login, button:has-text("LOGIN")').filter({ hasNotText: 'Cadastrar' }).first();
                if (await loginBtn.isVisible()) {
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
                    
                    await page.goto('https://agenciavirtual.neoenergia.com/#/home').catch(() => {});
                    await page.waitForTimeout(3000);

                    const userFormField = page.locator('mat-dialog-container input#userId, .mat-mdc-dialog-container input#userId, input#userId').filter({ visible: true }).first();
                    if (await userFormField.isVisible()) {
                        await userFormField.fill(credentials.login.replace(/\D/g, ''));
                        await page.locator('input#password').fill(credentials.password);
                        await page.locator('button').filter({ hasText: /^ENTRAR$/ }).filter({ visible: true }).first().click();
                        await page.waitForTimeout(5000);
                    }

                    const searchInput = page.locator('input[placeholder*="digo"], input[placeholder*="Código"]').first();
                    await searchInput.waitFor({ state: 'visible', timeout: 20000 });
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
                                    const { consumoKwh, cipValor } = await parseInvoicePdf(localPath);

                                    const mesReferenciaBase = parseMesRef(mesRefStr.trim());
                                    if (mesReferenciaBase) {
                                        // Regras de Criação de Fatura Automática
                                        const [month, year] = mesReferenciaBase.split('/').map(Number);
                                        
                                        // Vencimento: Dia do vencimento no mês seguinte
                                        let nextMonth = month + 1;
                                        let nextYear = year;
                                        if (nextMonth > 12) { nextMonth = 1; nextYear++; }
                                        const vencimentoDate = new Date(nextYear, nextMonth - 1, uc.dia_vencimento || 10);
                                        const vencimentoStr = vencimentoDate.toISOString().split('T')[0];

                                        // Regra: Consumo Mínimo por Tipo de Ligação
                                        const kwhMinimo = uc.tipo_ligacao === 'trifasico' ? 100 : (uc.tipo_ligacao === 'bifasico' ? 50 : 30);
                                        const tarifa = Number(uc.tarifa_concessionaria) || 0;
                                        const valorTarifaMinima = kwhMinimo * tarifa;

                                        // Upsert no CRM
                                        await supabase.from('invoices').upsert({ 
                                            uc_id: uc.id, 
                                            mes_referencia: `${year}-${String(month).padStart(2, '0')}-01`,
                                            vencimento: vencimentoStr,
                                            tipo_ligacao: uc.tipo_ligacao,
                                            tarifa_concessionaria: tarifa,
                                            tarifa_minima: valorTarifaMinima,
                                            consumo_kwh: consumoKwh || 0, 
                                            iluminacao_publica: cipValor || 0,
                                            consumo_reais: (consumoKwh || kwhMinimo) * tarifa, 
                                            valor_a_pagar: ((consumoKwh || kwhMinimo) * tarifa) + (cipValor || 0), 
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

        let consumoKwh = 0;
        if (consumptionMatch) {
            consumoKwh = parseInt(consumptionMatch[1].replace(/\D/g, ''));
        }

        let cipValor = 0;
        if (cipMatch) {
            const rawCip = cipMatch[1];
            // Se tiver vírgula e ponto (ex: 1.234,56 ou 23,45)
            if (rawCip.includes(',') && rawCip.includes('.')) {
                cipValor = parseFloat(rawCip.replace(/\./g, '').replace(',', '.'));
            } else if (rawCip.includes(',')) {
                cipValor = parseFloat(rawCip.replace(',', '.'));
            } else {
                cipValor = parseFloat(rawCip);
            }
        }

        console.log(`      [Scanner PDF] Extração Completa: Consumo=${consumoKwh} kWh, CIP=R$ ${cipValor}`);
        return { consumoKwh, cipValor };
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
