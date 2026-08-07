const { firefox, chromium } = require('playwright');
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
    let modoJanela = false;
    const now = new Date();

    // ---- Regra da janela de disponibilidade (modo automático) ----
    // A leitura do dia D refere-se ao MÊS DA LEITURA (confirmado nos dados:
    // data_leitura 2026-07-09 -> mes_referencia 07/2026).
    // A concessionária publica a conta em até ~15 dias, às vezes atrasando mais.
    const JANELA_INICIO_DIAS = 7;   // só procura a partir de D+7
    const JANELA_RETENTATIVA  = 7;  // repete a cada 7 dias enquanto indisponível
    const JANELA_DESISTIR_DIAS = 60; // depois disso é anomalia -> exige ação humana

    // Datas em UTC para não variar com o fuso do runner.
    const hojeUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    function ultimoDiaDoMes(ano, mesIdx) {
        return new Date(Date.UTC(ano, mesIdx + 1, 0)).getUTCDate();
    }

    // Descobre a última leitura que JÁ ocorreu e o mês de referência dela.
    function calcularJanelaUC(diaLeitura, ultimaTentativaISO) {
        const ano = hojeUTC.getUTCFullYear();
        const mesIdx = hojeUTC.getUTCMonth();

        // dia_leitura pode não existir no mês (ex.: 31 em fevereiro) -> usa o último dia
        const diaEsteMes = Math.min(diaLeitura, ultimoDiaDoMes(ano, mesIdx));

        let dataLeitura;
        if (hojeUTC.getUTCDate() >= diaEsteMes) {
            dataLeitura = new Date(Date.UTC(ano, mesIdx, diaEsteMes));
        } else {
            const mesAntIdx = mesIdx === 0 ? 11 : mesIdx - 1;
            const anoAnt = mesIdx === 0 ? ano - 1 : ano;
            const diaAnt = Math.min(diaLeitura, ultimoDiaDoMes(anoAnt, mesAntIdx));
            dataLeitura = new Date(Date.UTC(anoAnt, mesAntIdx, diaAnt));
        }

        const diasDesdeLeitura = Math.floor((hojeUTC - dataLeitura) / 86400000);
        const diasUltimaTentativa = ultimaTentativaISO
            ? Math.floor((hojeUTC - new Date(ultimaTentativaISO)) / 86400000)
            : Infinity;

        const mesRef = `${String(dataLeitura.getUTCMonth() + 1).padStart(2, '0')}/${dataLeitura.getUTCFullYear()}`;

        let motivo = null;
        if (diasDesdeLeitura < JANELA_INICIO_DIAS) motivo = `aguarda D+${JANELA_INICIO_DIAS} (leitura há ${diasDesdeLeitura}d)`;
        else if (diasDesdeLeitura > JANELA_DESISTIR_DIAS) motivo = `desiste: ${diasDesdeLeitura}d sem publicar (>${JANELA_DESISTIR_DIAS}d)`;
        else if (diasUltimaTentativa < JANELA_RETENTATIVA) motivo = `retentativa em ${JANELA_RETENTATIVA - diasUltimaTentativa}d`;

        return { mesRef, dataLeitura, diasDesdeLeitura, elegivel: motivo === null, motivo };
    }

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
        // Disparo automático (cron diário) -> MODO JANELA.
        // Não filtra por dia de leitura: cada UC calcula seu próprio mês-alvo e
        // sua própria elegibilidade (ver calcularJanelaUC). Regra de negócio:
        // a concessionária tem até 15 dias para publicar a conta, então só faz
        // sentido procurar a partir de D+7 da leitura, repetindo a cada 7 dias.
        modoJanela = true;
        targetedDays = [];
        currentMesRef = null; // definido POR UC
    }

    console.log(`[Faturista] REF: ${currentMesRef || "por UC (modo janela)"} | Dias de Leitura: ${targetedDays.length ? targetedDays.join(', ') : 'Todos no Mês'}`);

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
            status,
            last_scraping_status,
            last_scraping_at,
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
        // MODO JANELA: cada UC tem seu próprio mês-alvo (derivado da data da leitura)
        // e sua própria elegibilidade. No modo manual (TARGET_DAYS) segue o mês global.
        if (modoJanela) {
            if (!uc.dia_leitura) {
                console.log(`[Janela] UC ${uc.numero_uc}: sem dia_leitura cadastrado. Pulando.`);
                continue;
            }
            const j = calcularJanelaUC(uc.dia_leitura, uc.last_scraping_at);
            uc.mesRefAlvo = j.mesRef;
            if (!j.elegivel) {
                console.log(`[Janela] UC ${uc.numero_uc} (leitura dia ${uc.dia_leitura}, ref ${j.mesRef}): ${j.motivo}`);
                continue;
            }
            console.log(`[Janela] UC ${uc.numero_uc}: elegível — leitura há ${j.diasDesdeLeitura}d, buscando ${j.mesRef}`);
        } else {
            uc.mesRefAlvo = currentMesRef;
        }

        const [mm, yyyy] = uc.mesRefAlvo.split('/');
        const inicioMes = `${yyyy}-${mm}-01`;
        // Date.UTC evita depender do fuso da máquina: mes_referencia é uma coluna DATE,
        // a comparação não pode variar conforme o TZ do runner.
        // Number(mm) já aponta para o mês seguinte (o construtor é 0-indexed).
        const fimMes = new Date(Date.UTC(Number(yyyy), Number(mm), 1)).toISOString().slice(0, 10);

        const { data: existingInvoices } = await supabase
            .from('invoices')
            .select('id, concessionaria_pdf_url')
            .eq('uc_id', uc.id)
            .gte('mes_referencia', inicioMes)
            .lt('mes_referencia', fimMes)
            .not('concessionaria_pdf_url', 'is', null)
            .limit(1);

        if (existingInvoices && existingInvoices.length > 0) {
            console.log(`[Código] UC ${uc.numero_uc}: Fatura [${uc.mesRefAlvo}] já existe. Pulando scrape.`);
            if (uc.last_scraping_status !== 'success') {
                await updateUCStatus(uc.id, 'success', 'Fatura detectada via consulta de banco de dados.');
            }
        } else {
            console.log(`[Código] UC ${uc.numero_uc}: Fatura [${uc.mesRefAlvo}] pendente. Adicionando à fila do Agente.`);
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

    // headless:false é OBRIGATÓRIO — em headless o Akamai devolve Access Denied.
    // No CI isso funciona porque o processo roda dentro de um display virtual (xvfb-run).
    // A flag AutomationControlled remove navigator.webdriver, sem ela o portal não autentica.
    const browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true',
        slowMo: Number(process.env.SLOW_MO || 0),
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-dev-shm-usage'
        ]
    });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'pt-BR',
        timezoneId: 'America/Fortaleza',
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
            async function irPara(page, rota) {
                await page.evaluate((r) => { location.hash = r; }, rota);
                await page.waitForTimeout(3000);
            }

            console.log('Acessando portal Neoenergia...');
            await page.goto('https://agenciavirtual.neoenergia.com/#/login', { waitUntil: 'load', timeout: 60000 });

            // Fase 1: Loop de Login Enxuto
            let loggedIn = false;
            for (let i = 0; i < 15; i++) {
                await page.waitForTimeout(3000);
                
                // Sucesso?
                if (page.url().includes('/selecionar-estado') || page.url().includes('/meus-imoveis') || await page.locator('input[placeholder*="Unidade Consumidora"]').isVisible()) {
                    console.log('ACESSO REALIZADO COM SUCESSO!');
                    loggedIn = true;
                    break;
                }

                // Modal Aberto?
                const userField = page.locator('input#userId, input[name="username"], input[name="j_username"], input[name="cpfCnpj"], mat-form-field:has-text("CPF") input, mat-form-field:has-text("CNPJ") input, input[formcontrolname="login"], input[formcontrolname="usuario"]').first();
                if (await userField.isVisible()) {
                    console.log(`   [Faturista] Preenchendo credenciais para ${creds.login}...`);
                    const formatDoc = (v) => {
                        const d = (v || '').replace(/\D/g, '');
                        if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                        if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
                        return v;
                    };
                    
                    await userField.click();
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await userField.pressSequentially(formatDoc(creds.login), { delay: 100 });
                    
                    const passField = page.locator('input#password, input[name="password"], input[name="j_password"], mat-form-field:has-text("Senha") input, input[type="password"]').first();
                    await passField.click();
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await passField.pressSequentially(creds.password, { delay: 100 });
                    
                    await page.waitForTimeout(2000);
                    const enterBtn = page.locator('button:has-text("ENTRAR"), button[type="submit"]').filter({ hasNotText: 'Visitar' }).first();
                    if (await enterBtn.isEnabled()) {
                        await enterBtn.click({ noWaitAfter: true });
                    } else {
                        await enterBtn.click({ force: true, noWaitAfter: true });
                    }
                    console.log('   [Faturista] Submeteu form de login. Aguardando redirecionamento autônomo...');
                    
                    // Aguarda o portal decidir para onde jogar (não força nav aqui de primeira)
                    try {
                        await page.waitForFunction(() => 
                            location.hash.includes('selecionar-estado') || 
                            location.hash.includes('meus-imoveis') ||
                            !!document.querySelector('input[placeholder*="Unidade Consumidora"]'),
                            { timeout: 15000 });
                    } catch (e) {
                        console.log('   [Faturista] Sem redirect automático pós-login. Indo para selecionar-estado...');
                        await irPara(page, '#/home/selecionar-estado');
                        await page.waitForTimeout(3000);
                    }
                    
                    try {
                        await page.waitForFunction(() => 
                            !!document.querySelector('a.link-page') ||
                            !!document.querySelector('input[placeholder*="Unidade Consumidora"]'),
                            { timeout: 20000 });
                    } catch(e) {
                        console.log('   [Faturista] Timeout aguardando tela de estados/imóveis após fallback. Tirando dump...');
                        await page.screenshot({ path: `./downloads/debug/pos_login_fallback_fail_${Date.now()}.png`, fullPage: true });
                        const hashLog = await page.evaluate(() => location.hash);
                        const est = await page.evaluate(() => ({
                            hash: location.hash,
                            bodyLen: document.body.innerText.trim().length,
                            temLinkPage: document.querySelectorAll('a.link-page').length,
                            temRouterOutlet: !!document.querySelector('router-outlet'),
                            ua: navigator.userAgent,
                            webdriver: navigator.webdriver
                        }));
                        console.log('[DEBUG ESTADO]', JSON.stringify(est));
                        console.log(`   [Faturista] Location hash atual: ${hashLog}`);
                    }
                    continue;
                }

                // Botão de Abrir Modal Visível?
                const abrirModalBtn = page.locator('button[aria-label="Conectar-se a agência virtual"], button:has-text("LOGIN")').filter({ hasNotText: 'CADASTRE' }).first();
                if (await abrirModalBtn.count() > 0) {
                    console.log(`   [Faturista] Clicando para abrir modal de login...`);
                    await abrirModalBtn.click({ force: true }).catch(()=>{});
                    await page.waitForTimeout(2500);
                    continue;
                }
            }

            if (!loggedIn) {
                await page.screenshot({ path: `./downloads/debug/login_fail_${Date.now()}.png`, fullPage: true });
                throw new Error('Falha na autenticação ou timeout do portal.');
            }

            // Loop dos Estados
            for (let eIdx = 0; eIdx < estadosList.length; eIdx++) {
                const estadoAlvo = estadosList[eIdx];
                const ucsDoEstado = estados[estadoAlvo];
                console.log(`\n--- Processando Estado: ${estadoAlvo} (${ucsDoEstado.length} UCs) ---`);

                // Fase 2: Seleção de Estado (Navegação explícita)
                console.log(`   [Faturista] Navegando para #/home/selecionar-estado...`);
                await irPara(page, '#/home/selecionar-estado');
                await page.waitForTimeout(3000);

                const estadoLink = page.locator('a.link-page', { hasText: estadoAlvo }).first();
                if (await estadoLink.count() > 0) {
                    console.log(`   [Faturista] Selecionando estado: ${estadoAlvo}`);
                    await estadoLink.click({ force: true });
                    try {
                        await page.waitForFunction(() => location.hash.includes('meus-imoveis'), { timeout: 20000 });
                        console.log(`   [Faturista] Roteado para meus-imoveis com sucesso.`);
                    } catch (e) {
                        console.error('   [Faturista] Timeout aguardando redirecionamento pós-estado.');
                    }
                } else {
                    console.error(`   [Faturista] Botão do estado ${estadoAlvo} não encontrado. Risco de falha na UC.`);
                }

                // Loop das UCs deste Estado
                for (const uc of ucsDoEstado) {
                    try {
                        const paddedUC = uc.numero_uc.toString().padStart(12, '0');
                        console.log(`-> UC: ${uc.numero_uc}`);
                        
                        // Fase 3: Busca de UC em meus-imoveis (Reset explícito para cada UC)
                        await irPara(page, '#/home/meus-imoveis');
                        await page.waitForTimeout(3000);

                        const ucSearchInput = page.locator('input[placeholder*="Unidade Consumidora"]').first();
                        await ucSearchInput.waitFor({ state: 'visible', timeout: 15000 });
                        await ucSearchInput.fill(uc.numero_uc); // com trim nativo
                        
                        // Clica em Pesquisar
                        const pesquisarBtn = page.locator('button', { hasText: 'Pesquisar' }).first();
                        if (await pesquisarBtn.isVisible()) {
                            await pesquisarBtn.click();
                        } else {
                            await page.click('button[aria-label="Pesquisar"]');
                        }
                        await page.waitForTimeout(4000);

                        // Clica no card (div.row no li)
                        const ucCardRow = page.locator('li', { hasText: paddedUC }).locator('div.row').first();
                        if (await ucCardRow.count() > 0) {
                            await ucCardRow.click({ force: true });
                            console.log(`   [Faturista] Card UC ${paddedUC} clicado. Portal deve redirecionar...`);
                            await page.waitForTimeout(4000); // Aguarda o redirect autônomo do portal
                        } else {
                            throw new Error('Unidade não encontrada no painel da concessionária (card não visível).');
                        }

                        // Fase 4: Lista de Faturas (consultar-debitos)
                        console.log('   [Faturista] Forçando rota para consultar-debitos...');
                        await irPara(page, '#/home/servicos/consultar-debitos');
                        await page.waitForTimeout(5000);

                        // Acha checkboxes
                        const checkboxes = await page.locator('mat-checkbox[id^="checkItem-"]').all();
                        let foundBill = false;

                        for (const cb of checkboxes) {
                            const cbId = await cb.getAttribute('id');
                            // Sobe na árvore até achar o bloco que contém a REFERÊNCIA (padrão MES/ANO).
                            // Validado no portal: o texto só aparece ~6 níveis acima do mat-checkbox.
                            const rowText = await cb.evaluate((el) => {
                                let h = el;
                                for (let k = 0; k < 8 && h; k++) {
                                    const t = (h.textContent || '').replace(/\s+/g, ' ').trim();
                                    if (/\/20\d\d/.test(t)) return t;
                                    h = h.parentElement;
                                }
                                return '';
                            }).catch((e) => { console.log('   [DIAG] erro no evaluate:', e.message); return ''; });
                            
                            const parsedRef = parseMesRef(rowText);
                            if (parsedRef === uc.mesRefAlvo) {
                                console.log(`   [Faturista] Fatura [${parsedRef}] localizada na tabela!`);

                                // Fase 5: Fluxo de Download
                                const isContaMinima = rowText.toUpperCase().includes('CONTA MÍNIMA');
                                
                                if (isContaMinima) {
                                    console.log(`   [Faturista] Fatura identificada como CONTA MÍNIMA. Pulando download.`);
                                    // Parse value
                                    const matchVal = rowText.match(/R\$\s*([\d,.]+)/);
                                    let valorFatura = 0;
                                    if (matchVal && matchVal[1]) {
                                        let cleaned = matchVal[1].trim();
                                        if (cleaned.includes(',') && cleaned.includes('.')) valorFatura = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
                                        else if (cleaned.includes(',')) valorFatura = parseFloat(cleaned.replace(',', '.'));
                                        else valorFatura = parseFloat(cleaned);
                                    }

                                    const [month, year] = parsedRef.split('/').map(Number);
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
                                    break; // quebra o loop de checkboxes
                                }

                                // 1. Marca o checkbox via JS (o <input> do Material é invisível;
                                //    click({force:true}) do Playwright não registra no Angular).
                                await cb.evaluate((el) => {
                                    const i = el.querySelector('input');
                                    if (i && !i.checked) i.click();
                                });
                                await page.waitForTimeout(1200);

                                // 2. Clica no botão "Download" da tela (texto vem com espaços/ícone)
                                const clicouDownload = await page.evaluate(() => {
                                    const b = [...document.querySelectorAll('button')]
                                        .find(x => x.offsetParent !== null && /^\s*Download\s*$/i.test(x.textContent.trim()));
                                    if (!b) return false;
                                    b.click();
                                    return true;
                                });
                                if (!clicouDownload) throw new Error('Botão Download não encontrado na tela.');
                                
                                // 3. Modal de motivo
                                console.log(`   [Faturista] Modal de motivo de download. Escolhendo opção...`);
                                await page.waitForSelector('mat-dialog-container', { timeout: 10000 });
                                
                                // Seleciona "Não Estou Com Fatura Em Mãos" via JS.
                                // O modal é maior que a viewport -> locator.click() dá "outside of the viewport".
                                // Além disso o id do radio MUDA a cada abertura (mat-radio-5, mat-radio-10...),
                                // por isso a busca é pelo TEXTO.
                                // Espera os RADIOS renderizarem (o container aparece antes do conteúdo)
                                await page.waitForFunction(() => {
                                    const d = document.querySelector('mat-dialog-container,[role=dialog]');
                                    return !!d && [...d.querySelectorAll('mat-radio-button')]
                                        .some(x => /Não Estou Com Fatura/i.test(x.textContent));
                                }, { timeout: 20000 }).catch(() => {});

                                const motivoOk = await page.evaluate(() => {
                                    const dlg = document.querySelector('mat-dialog-container,[role=dialog]');
                                    if (!dlg) return false;
                                    const rb = [...dlg.querySelectorAll('mat-radio-button')]
                                        .find(x => /Não Estou Com Fatura/i.test(x.textContent));
                                    if (!rb) return false;
                                    const i = rb.querySelector('input');
                                    if (i && !i.checked) i.click();
                                    return true;
                                });
                                if (!motivoOk) throw new Error('Motivo "Não Estou Com Fatura Em Mãos" não encontrado no modal.');
                                await page.waitForTimeout(1200);

                                // 4. Clica em BAIXAR no modal (via JS) e intercepta o download
                                try {
                                    const [dl] = await Promise.all([
                                        page.waitForEvent('download', { timeout: 60000 }),
                                        page.evaluate(() => {
                                            const dlg = document.querySelector('mat-dialog-container,[role=dialog]');
                                            const b = [...dlg.querySelectorAll('button')]
                                                .find(x => /^\s*BAIXAR\s*$/i.test(x.textContent.trim()));
                                            if (b) b.click();
                                        })
                                    ]);
                                    
                                    const fileName = `${uc.numero_uc}_${parsedRef.replace('/', '-')}_${Date.now()}.pdf`;
                                    const localPath = `./downloads/${fileName}`;
                                    await dl.saveAs(localPath);
                                    
                                    const storagePath = await uploadToSupabase(localPath, uc.numero_uc, fileName);
                                    
                                    // Fecha o diálogo de sucesso ("Download realizado com sucesso").
                                    // O portal exibe um overlay SweetAlert ("Carregando") que intercepta
                                    // pointer events -> locator.click() fica em retry infinito.
                                    // Solução: aguardar o overlay sumir e fechar via JS.
                                    await page.waitForFunction(() => {
                                        const c = document.querySelector('.swal2-container');
                                        return !c || !/Carregando/i.test(c.textContent);
                                    }, { timeout: 30000 }).catch(() => {});

                                    await page.evaluate(() => {
                                        [...document.querySelectorAll('button')]
                                            .filter(b => b.offsetParent !== null && /^\s*(OK|FECHAR)\s*$/i.test(b.textContent.trim()))
                                            .forEach(b => b.click());
                                    }).catch(() => {});
                                    await page.waitForTimeout(1500);

                                    // Parse value
                                    const matchVal = rowText.match(/R\$\s*([\d,.]+)/);
                                    let valorFatura = 0;
                                    if (matchVal && matchVal[1]) {
                                        let cleaned = matchVal[1].trim();
                                        if (cleaned.includes(',') && cleaned.includes('.')) valorFatura = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
                                        else if (cleaned.includes(',')) valorFatura = parseFloat(cleaned.replace(',', '.'));
                                        else valorFatura = parseFloat(cleaned);
                                    }
                                    const [month, year] = parsedRef.split('/').map(Number);

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
                                    break; // quebra o loop de checkboxes
                                } catch (downloadErr) {
                                    console.error(`   [Faturista] Falha ao baixar o PDF:`, downloadErr.message);
                                    
                                    // Tenta fechar qualquer modal pendente se falhou
                                    const closeBtn = page.locator('mat-dialog-container button[aria-label="Fechar"], mat-dialog-container button:has-text("OK")').first();
                                    if (await closeBtn.count() > 0) await closeBtn.click({ force: true }).catch(()=>{});

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

                        if (foundBill) {
                            await updateUCStatus(uc.id, 'success');
                        } else {
                            console.log('   Fatura não disponível no portal ainda.');
                            await updateUCStatus(uc.id, 'not_available', 'Hoje é dia de leitura, mas a fatura ainda não foi postada no portal.');
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

function parseMesRef(texto) {
    const months = {
        'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06',
        'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12'
    };
    if (!texto) return null;
    const t = String(texto).toUpperCase();

    // ATENÇÃO: o portal renderiza SEM espaços -> "REFERÊNCIAJULHO/2026VENCIMENTO26/08/26".
    // Por isso não dá para capturar "[A-Z]+/ANO" (pegaria "REFERÊNCIAJULHO").
    // Busca-se o nome do mês explicitamente, seguido de /ANO.
    const MESES_EXTENSO = {
        'JANEIRO': '01', 'FEVEREIRO': '02', 'MARÇO': '03', 'MARCO': '03',
        'ABRIL': '04', 'MAIO': '05', 'JUNHO': '06', 'JULHO': '07',
        'AGOSTO': '08', 'SETEMBRO': '09', 'OUTUBRO': '10',
        'NOVEMBRO': '11', 'DEZEMBRO': '12'
    };
    for (const [nome, num] of Object.entries(MESES_EXTENSO)) {
        const m = t.match(new RegExp(nome + '\\/(\\d{4})'));
        if (m) return `${num}/${m[1]}`;
    }

    // Abreviações (JUL/2026)
    const porAbrev = t.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{4})/);
    if (porAbrev) return `${months[porAbrev[1]]}/${porAbrev[2]}`;

    // Formato numérico: 07/2026
    const porNumero = t.match(/\b(\d{1,2})\/(\d{4})\b/);
    if (porNumero) return `${porNumero[1].padStart(2, '0')}/${porNumero[2]}`;

    return null;
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
