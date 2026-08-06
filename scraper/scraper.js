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

    const UF_TO_ESTADO = {
        RN: 'Rio Grande do Norte',
        BA: 'Bahia',
        PE: 'Pernambuco',
        SP: 'São Paulo',
        MS: 'Mato Grosso do Sul',
    };

    const CONCESSIONARIA_TO_ESTADO = {
        'neoenergia cosern':     'Rio Grande do Norte',
        'neoenergia coelba':     'Bahia',
        'neoenergia pernambuco': 'Pernambuco',
        'neoenergia celpe':      'Pernambuco',
        'neoenergia elektro':    null,
    };

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
            address,
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
        .ilike('concessionaria', 'Neoenergia%');

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
        if (uc.numero_uc) {
            uc.numero_uc = String(uc.numero_uc).trim();
        }

        const uf = uc.address?.uf?.toUpperCase();
        const conc = uc.concessionaria?.toLowerCase();
        uc.estadoAlvo = UF_TO_ESTADO[uf] || CONCESSIONARIA_TO_ESTADO[conc];

        if (!uc.estadoAlvo) {
            console.error(`[Faturista] ERRO: Estado não resolvido para UC ${uc.numero_uc} (UF: ${uf}, Conc: ${uc.concessionaria}). Pulando.`);
            await supabase
                .from('consumer_units')
                .update({ 
                    last_scraping_status: 'error',
                    last_scraping_at: new Date().toISOString(),
                    last_scraping_error: 'estado nao resolvido'
                })
                .eq('id', uc.id);
            continue;
        }
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

    // 3. Agrupa UCs selecionadas por Titular das Credenciais e depois por Estado
    const groups = ucsToScrape.reduce((acc, uc) => {
        const effectiveSub = uc.titular_fatura || uc.subscriber;
        const subId = effectiveSub?.id || uc.subscriber_id;
        
        if (!acc[subId]) {
            acc[subId] = {
                subscriber: effectiveSub,
                credentials: effectiveSub?.portal_credentials,
                estados: {}
            };
        }
        
        const estado = uc.estadoAlvo;
        if (!acc[subId].estados[estado]) {
            acc[subId].estados[estado] = [];
        }
        
        acc[subId].estados[estado].push(uc);
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
        const { subscriber, credentials: creds, estados } = group;
        const estadosList = Object.keys(estados);
        
        if (estadosList.length === 0) continue;
        const primeiroEstado = estadosList[0];
        
        const allUcsCount = Object.values(estados).reduce((acc, curr) => acc + curr.length, 0);
        console.log(`\n=== Processando Assinante: ${subscriber.name} (${allUcsCount} UCs em ${estadosList.length} estado(s)) ===`);

        if (!creds?.login || !creds?.password) {
            console.error(`Status: ERRO - Credenciais não encontradas para o assinante ${subscriber.name}`);
            for (const estado in estados) {
                for (const uc of estados[estado]) {
                    await updateUCStatus(uc.id, 'error', 'Credenciais de acesso não configuradas.');
                }
            }
            continue;
        }

        try {
            console.log('Acessando portal Neoenergia...');
            await page.goto('https://agenciavirtual.neoenergia.com/#/login', { waitUntil: 'load', timeout: 60000 });

            let loggedIn = false;
            let stuckOnOlaCount = 0;
            let agenciaClicks = 0;
            
            for (let i = 0; i < 15; i++) {
                await page.waitForTimeout(3000);
                const url = page.url();
                
                const userField = page.locator('input#userId, input[name="username"], input[name="j_username"], input[name="cpfCnpj"], mat-form-field:has-text("CPF") input, mat-form-field:has-text("CNPJ") input, input[formcontrolname="login"], input[formcontrolname="usuario"]').first();
                const passField = page.locator('input#password, input[name="password"], input[name="j_password"], mat-form-field:has-text("Senha") input, input[type="password"]').first();
                const enterBtn = page.locator('button:has-text("ENTRAR"), button[type="submit"]').filter({ hasNotText: 'Visitar' }).first();
                const portalAccessBtn = page.locator('button[aria-label="Conectar-se a agência virtual"]');
                const stateOption = page.getByText(primeiroEstado, { exact: false }).first();
                const ucSearchInput = page.locator('input[placeholder*="digo"], input[placeholder*="Código"], input[placeholder*="Unidade Consumidora"]').first();
                const checkOla = page.locator('text=Olá,').first();
                const checkSair = page.locator('button:has-text("Sair"), a:has-text("Sair")').first();

                // 1) Safe login check: strictly waits for dashboard search input or dashboard cards
                if (await ucSearchInput.isVisible() || page.url().includes('/home/dashboard') || page.url().includes('/home/meus-imoveis')) {
                    console.log('ACESSO REALIZADO E DASHBOARD CARREGADO!');
                    loggedIn = true;
                    break;
                }

                // 2) Seleção de Estado (Tela logo após login, antes do dashboard)
                if (await stateOption.count() > 0) {
                    console.log(`   [Faturista] Selecionando estado: ${primeiroEstado} (elemento existe no DOM)`);
                    await stateOption.scrollIntoViewIfNeeded().catch(() => {});
                    await stateOption.click({ force: true }).catch(() => {});
                    try {
                        await page.waitForTimeout(3000);
                        if (!page.url().includes('/meus-imoveis')) {
                            await page.goto('https://agenciavirtual.neoenergia.com/#/home/meus-imoveis').catch(() => {});
                            await page.waitForTimeout(2000);
                        }
                    } catch (e) {}
                    continue;
                }

                // 3) Formulário de Credenciais Aberto? (Modal ou tela nativa)
                if (await userField.isVisible()) {
                    console.log(`   [Faturista] Preenchendo credenciais para ${creds.login} (Modo Humano)...`);
                    
                    const formatDoc = (v) => {
                        const d = (v || '').replace(/\D/g, '');
                        if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                        if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
                        return v;
                    };
                    const formattedUser = formatDoc(creds.login);
                    
                    await userField.click();
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await userField.pressSequentially(formattedUser, { delay: 100 });
                    
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

                // 4) Botão de Abrir Modal de Login na Home Institucional
                const entrarAgencia = page.locator('button[aria-label="Conectar-se a agência virtual"], button:has-text("LOGIN")').filter({ hasNotText: 'CADASTRE' }).first();
                if (await entrarAgencia.count() > 0 && !(await userField.isVisible())) {
                    if (await checkOla.isVisible()) {
                        console.log('   [Faturista] Já autenticado na home institucional, tentando navegação direta para a área logada...');
                        await page.goto('https://agenciavirtual.neoenergia.com/#/home').catch(()=>{});
                        await page.waitForTimeout(3000);
                        continue;
                    }

                    agenciaClicks++;
                    console.log(`   [Faturista] Abrindo formulário de login (Tentativa ${agenciaClicks}/2)...`);
                    
                    if (agenciaClicks > 2) {
                        console.log('   [Faturista] Limite de cliques excedido, forçando recarga da página...');
                        await page.goto('https://agenciavirtual.neoenergia.com/#/login').catch(()=>{});
                        continue;
                    }

                    await entrarAgencia.click({ force: true }).catch(()=>{});
                    await page.waitForTimeout(3000);
                    
                    if (agenciaClicks === 1) {
                        try {
                            await page.screenshot({ path: `./downloads/debug/pos_click_agencia_${Date.now()}.png`, fullPage: true });
                        } catch(e) {}
                    }
                    continue;
                }

                // 5) Botão LOGIN solto (excepcional, se existir fora do modal)
                const loginBtn = page.locator('.btn-login, button:has-text("LOGIN")').filter({ hasNotText: 'Cadastrar' }).first();
                if (await loginBtn.isVisible() && !(await checkOla.isVisible())) {
                    await loginBtn.click({ force: true });
                    continue;
                }

                // 6) checkOla (preso na home, após tudo falhar)
                if (await checkOla.isVisible()) {
                    const currentUrl = page.url();
                    if (!(await ucSearchInput.isVisible()) && !currentUrl.includes('/dashboard')) {
                        stuckOnOlaCount++;
                        console.log(`   [Faturista] Preso na home pública (${stuckOnOlaCount}/3). URL: ${currentUrl}`);
                        
                        // Diagnóstico do H1 / Título
                        try {
                            const mainHeading = await page.locator('h1, h2, h3').first().innerText({ timeout: 1000 });
                            console.log(`   [Faturista] Título visível na tela: "${mainHeading}"`);
                        } catch (e) {}

                        if (stuckOnOlaCount === 1) {
                            try {
                                await page.screenshot({ path: `./downloads/debug/home_dump_${Date.now()}.png`, fullPage: true });
                                const dump = await page.evaluate((estadoEsperado) => ({
                                    hash: location.hash,
                                    links: [...document.querySelectorAll('a')]
                                            .map(a => ({ txt: a.innerText.trim().slice(0,40),
                                                         href: a.getAttribute('href'),
                                                         vis: !!a.offsetParent }))
                                            .filter(x => x.txt),
                                    temEstado: document.body.innerText.includes(estadoEsperado),
                                    matCards: document.querySelectorAll('mat-card').length
                                }), primeiroEstado);
                                console.log('[DEBUG DOM]', JSON.stringify(dump, null, 1));
                            } catch (errDump) {
                                console.error('Erro ao gerar dump DOM:', errDump);
                            }
                        }

                        if (stuckOnOlaCount >= 3) {
                            console.log('   [Faturista] Abortando por falha de navegação (repetições estouradas).');
                            break;
                        }

                        console.log('   [Faturista] Autenticado, mas preso na home. Tentando clicar em "LOGIN" para entrar na área logada...');
                        const entrarArea = page.locator('button[aria-label="Conectar-se a agência virtual"], button:has-text("LOGIN")').filter({ hasNotText: 'CADASTRE' }).first();
                        if (await entrarArea.count() > 0) {
                            await entrarArea.click({ force: true }).catch(()=>{});
                            await page.waitForTimeout(4000);
                            try {
                                await page.screenshot({ path: `./downloads/debug/pos_login_autenticado_${Date.now()}.png`, fullPage: true });
                            } catch(e) {}
                            continue;
                        }

                        console.log('   [Faturista] Tentando forçar ida à raiz da home (fallback final)...');
                        await page.goto('https://agenciavirtual.neoenergia.com/#/home').catch(()=>{});
                        continue;
                    }
                }
            }

            if (!loggedIn) {
                throw new Error('Falha na autenticação ou timeout do portal.');
            }

            for (let eIdx = 0; eIdx < estadosList.length; eIdx++) {
                const estadoAlvo = estadosList[eIdx];
                const ucsDoEstado = estados[estadoAlvo];
                console.log(`\n--- Processando Estado: ${estadoAlvo} (${ucsDoEstado.length} UCs) ---`);

                if (eIdx > 0) {
                    console.log(`   [Faturista] Trocando estado na sessão para: ${estadoAlvo}`);
                    const trocarEstadoBtn = page.getByText('Trocar Estado', { exact: false }).first();
                    if (await trocarEstadoBtn.isVisible()) {
                        await trocarEstadoBtn.click({ force: true });
                        await page.waitForTimeout(3000);
                        
                        const nextStateOption = page.getByText(estadoAlvo, { exact: false }).first();
                        if (await nextStateOption.count() > 0) {
                            await nextStateOption.scrollIntoViewIfNeeded().catch(()=>{});
                            await nextStateOption.click({ force: true }).catch(()=>{});
                            await page.waitForTimeout(4000);
                        }
                    } else {
                        console.error('   [Faturista] Botão "Trocar Estado" não encontrado. Pode causar falhas neste grupo.');
                    }
                }

                // Aguarda o nome do estado aparecer na tela antes de seguir
                console.log(`   [Faturista] Aguardando confirmação do estado no cabeçalho...`);
                try {
                    await page.waitForFunction((expectedState) => {
                        return document.body.innerText.includes(expectedState);
                    }, estadoAlvo, { timeout: 10000 });
                } catch (e) {
                    console.error(`   [Faturista] AVISO: Não confirmamos "${estadoAlvo}" na tela, prosseguindo com risco.`);
                }

                for (const uc of ucsDoEstado) {
                    try {
                        const paddedUC = uc.numero_uc.toString().padStart(12, '0');
                        console.log(`-> UC: ${uc.numero_uc}`);
                    
                    // Verifica se o campo de busca está visível (espera até 6 segundos para a página carregar caso acabe de logar)
                    const searchInput = page.locator('input[placeholder*="digo"], input[placeholder*="Código"], input[placeholder*="Conta"], input[placeholder*="Contrato"], mat-form-field:has-text("Conta") input, mat-form-field:has-text("Contrato") input, mat-form-field:has-text("Código") input, input[type="text"]').first();
                    
                    let isSearchReady = false;
                    try {
                        await searchInput.waitFor({ state: 'visible', timeout: 6000 });
                        isSearchReady = true;
                    } catch (e) {
                        isSearchReady = false;
                    }

                    if (!isSearchReady) {
                        console.log('   [Faturista] Buscador não encontrado. Forçando rota do dashboard...');
                        // Se estivermos dentro de uma UC anterior ou perdidos, forçamos o roteador angular para o dashboard
                        await page.goto('https://agenciavirtual.neoenergia.com/#/home/meus-imoveis').catch(() => {});
                        await page.waitForTimeout(4000);
                        
                        try {
                            await searchInput.waitFor({ state: 'visible', timeout: 6000 });
                        } catch (e) {
                            console.log('   [Faturista] Buscador ainda não encontrado após forçar dashboard. Verificando botão "Trocar Unidade"...');
                            // Tenta procurar botões de voltar/trocar UC que existem quando estamos dentro de uma fatura
                            const trocarUcBtn = page.locator('button:has-text("Trocar unidade"), a:has-text("Mudar de unidade")').first();
                            if (await trocarUcBtn.isVisible()) {
                                await trocarUcBtn.click({ force: true });
                                await page.waitForTimeout(3000);
                            }
                        }
                    }
                    const userFormField = page.locator('mat-dialog-container input#userId, .mat-mdc-dialog-container input#userId, input#userId, mat-form-field:has-text("CPF") input, input[name="username"], input[name="cpfCnpj"]').filter({ visible: true }).first();
                    if (await userFormField.isVisible()) {
                        console.log('   [Faturista] Refazendo login no loop interno (Modo Humano)...');
                        const formatDoc = (v) => {
                            const d = (v || '').replace(/\D/g, '');
                            if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                            if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
                            return v;
                        };
                        
                        await userFormField.click();
                        await page.keyboard.press('Control+A');
                        await page.keyboard.press('Backspace');
                        await userFormField.pressSequentially(formatDoc(creds.login), { delay: 100 });
                        
                        const innerPass = page.locator('input#password, input[type="password"]').first();
                        await innerPass.click();
                        await page.keyboard.press('Control+A');
                        await page.keyboard.press('Backspace');
                        await innerPass.pressSequentially(creds.password, { delay: 100 });
                        
                        await page.waitForTimeout(2000);
                        const innerEnter = page.locator('button:has-text("ENTRAR"), button[type="submit"]').filter({ hasNotText: 'Visitar' }).filter({ visible: true }).first();
                        if (await innerEnter.isEnabled()) {
                            await innerEnter.click({ noWaitAfter: true });
                        } else {
                            await innerEnter.click({ force: true, noWaitAfter: true });
                        }
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
                            const mesRefStr = await panel.locator('.mat-content div:nth-child(2) span:nth-child(2)').innerText().catch(() => '');
                            const panelText = await panel.innerText().catch(() => '');
                            
                            const parsedRef = parseMesRef(mesRefStr.trim());
                            if (!parsedRef) continue;
                            
                            // Check if this panel matches the target month (currentMesRef)
                            // e.g., '07/2026' === '07/2026'
                            if (parsedRef !== currentMesRef) {
                                continue;
                            }

                            console.log(`   Verificando fatura [${mesRefStr.trim()}]...`);
                            
                            // Check for Conta Minima
                            const isContaMinimaText = panelText.toUpperCase().includes('CONTA MÍNIMA');
                            const hasCheckbox = await panel.locator('mat-checkbox, input[type="checkbox"], [id^="checkItem-"]').count() > 0;
                            
                            if (isContaMinimaText || !hasCheckbox) {
                                console.log(`   [Faturista] Fatura identificada como CONTA MÍNIMA. Pulando download.`);
                                const [month, year] = parsedRef.split('/').map(Number);
                                const valorStr = await panel.locator('.mat-content div:nth-child(5) span:nth-child(2)').innerText().catch(() => '0');
                                const parseValue = (raw) => {
                                    if (!raw) return 0;
                                    let cleaned = raw.replace('R$', '').trim();
                                    if (cleaned.includes(',') && cleaned.includes('.')) return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
                                    if (cleaned.includes(',')) return parseFloat(cleaned.replace(',', '.'));
                                    return parseFloat(cleaned);
                                };
                                const valorFatura = parseValue(valorStr);

                                await supabase.from('invoices').upsert({
                                    uc_id: uc.id,
                                    mes_referencia: `${year}-${String(month).padStart(2, '0')}-01`,
                                    reading_status: 'processing',
                                    reading_error: '[INFO] Conta minima - concessionaria nao emite PDF/boleto; saldo acumula para o mes seguinte. Nao reprocessar.',
                                    status: 'sem_faturamento',
                                    valor_concessionaria: valorFatura,
                                    is_placeholder: false,
                                    reading_checked_at: new Date().toISOString()
                                }, { onConflict: 'uc_id,mes_referencia' });
                                foundBill = true;
                                continue;
                            }

                            // If it's a regular bill, we open the panel and download
                            const header = panel.locator('mat-expansion-panel-header');
                            await header.click();
                            await page.waitForTimeout(1500);

                            const downloadBtn = panel.locator('button[aria-label*="Download"], button:has-text("Baixar")').first();
                            if (await downloadBtn.isVisible()) {
                                try {
                                    const [dl] = await Promise.all([
                                        page.waitForEvent('download', { timeout: 60000 }), // increased to 60s
                                        downloadBtn.click()
                                    ]);
                                    const fileName = `${uc.numero_uc}_${mesRefStr.trim().replace('/', '-')}_${Date.now()}.pdf`;
                                    const localPath = `./downloads/${fileName}`;
                                    await dl.saveAs(localPath);
                                    
                                    const storagePath = await uploadToSupabase(localPath, uc.numero_uc, fileName);
                                    
                                    const [month, year] = parsedRef.split('/').map(Number);
                                    const valorStr = await panel.locator('.mat-content div:nth-child(5) span:nth-child(2)').innerText().catch(() => '0');
                                    const parseValue = (raw) => {
                                        if (!raw) return 0;
                                        let cleaned = raw.replace('R$', '').trim();
                                        if (cleaned.includes(',') && cleaned.includes('.')) return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
                                        if (cleaned.includes(',')) return parseFloat(cleaned.replace(',', '.'));
                                        return parseFloat(cleaned);
                                    };
                                    const valorFatura = parseValue(valorStr);

                                    await supabase.from('invoices').upsert({ 
                                        uc_id: uc.id, 
                                        mes_referencia: `${year}-${String(month).padStart(2, '0')}-01`,
                                        concessionaria_pdf_url: storagePath,
                                        status: 'sem_faturamento',
                                        reading_status: 'processing',
                                        reading_checked_at: new Date().toISOString(),
                                        valor_concessionaria: valorFatura,
                                        is_placeholder: false
                                    }, { onConflict: 'uc_id,mes_referencia' });
                                    
                                    foundBill = true;
                                } catch (downloadErr) {
                                    console.error(`   [Faturista] Falha ao baixar o PDF:`, downloadErr.message);
                                    
                                    // Check if the page has an error dialog for "indisponível" or missing fields
                                    const bodyText = await page.innerText('body').catch(() => '');
                                    const isPortalError = bodyText.includes('Fatura indisponível no canal digital') || 
                                                          bodyText.includes('Campos obrigatórios ausentes');
                                    
                                    if (isPortalError) {
                                        console.log(`   [Faturista] Erro de conta minima detectado via modal do portal.`);
                                        const [month, year] = parsedRef.split('/').map(Number);
                                        await supabase.from('invoices').upsert({
                                            uc_id: uc.id,
                                            mes_referencia: `${year}-${String(month).padStart(2, '0')}-01`,
                                            reading_status: 'processing',
                                            reading_error: '[INFO] Conta minima - concessionaria nao emite PDF/boleto; saldo acumula para o mes seguinte. Nao reprocessar.',
                                            status: 'sem_faturamento',
                                            is_placeholder: false,
                                            reading_checked_at: new Date().toISOString()
                                        }, { onConflict: 'uc_id,mes_referencia' });
                                        foundBill = true;
                                    } else {
                                        const [month, year] = parsedRef.split('/').map(Number);
                                        await supabase.from('invoices').upsert({
                                            uc_id: uc.id,
                                            mes_referencia: `${year}-${String(month).padStart(2, '0')}-01`,
                                            reading_status: 'error',
                                            reading_error: `Falha no download: ${downloadErr.message}`,
                                            status: 'sem_faturamento',
                                            is_placeholder: true,
                                            reading_checked_at: new Date().toISOString()
                                        }, { onConflict: 'uc_id,mes_referencia' });
                                    }
                                }
                            }
                            await header.click();
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
                } catch (ucErr) {
                    console.error(`   Erro UC ${uc.numero_uc}: ${ucErr.message}`);
                    await updateUCStatus(uc.id, 'error', ucErr.message.substring(0, 255));
                    await takeScreenshot(`erro_uc_${uc.numero_uc}`);
                }
            } // end ucs loop
            } // end states loop
        } catch (groupErr) {
            console.error(`Erro Crítico no Grupo ${subscriber.name}:`, groupErr.message);
            for (const estado in estados) {
                for (const uc of estados[estado]) {
                    await updateUCStatus(uc.id, 'error', `Erro de login/portal: ${groupErr.message}`);
                }
            }
            await takeScreenshot(`erro_grupo_${subId}`);
        } finally {
            console.log('Finalizando sessão do assinante...');
            await page.goto('https://agenciavirtual.neoenergia.com/#/login').catch(() => {});
            await context.clearCookies();
        }
    }

    await browser.close();
    console.log('\nProcesso Calendário Neoenergia Finalizado.');

    try {
        console.log('Executando verificação de lembretes/gatilhos de vencimento...');
        const { error: rpcError } = await supabase.rpc('fn_check_invoice_due_reminders');
        if (rpcError) {
            console.error('Erro ao processar lembretes de vencimento (RPC):', rpcError.message);
        } else {
            console.log('Verificação de lembretes concluída com sucesso.');
        }
    } catch (rpcErr) {
        console.error('Falha ao chamar RPC de lembretes:', rpcErr.message);
    }
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
        .from('energy-bills')
        .upload(storagePath, fileBuffer, {
            contentType: 'application/pdf',
            upsert: true
        });

    if (error) throw error;

    return storagePath;
}

const dir = './downloads';
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
run();
