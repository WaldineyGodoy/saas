/**
 * Driver: Neoenergia — Agência Virtual (https://agenciavirtual.neoenergia.com)
 *
 * Concentra TUDO que é específico deste portal: URL, rotas da SPA (Angular),
 * seletores, fluxo de download e as peculiaridades descobertas em campo.
 * O scraper.js é o orquestrador e não deve conhecer nada disso.
 *
 * Contrato de um driver (ver drivers/index.js):
 *   id, nome, matchConcessionaria, loginUrl, rotuloEscopo
 *   launchOptions(), contextOptions()
 *   resolverEscopo({ uf, concessionaria })   -> string | null
 *   login(page, creds, ctx)                  -> lança em caso de falha
 *   selecionarEscopo(page, escopo, ctx)
 *   capturarFatura(page, uc, mesRefAlvo, ctx)-> { resultado, ... }
 *   encerrarSessao(page, context)
 *   parseMesRef(texto)
 *
 * "Escopo" é a abstração do passo de seleção de ESTADO: a Neoenergia opera 5
 * distribuidoras sob um portal único, então é preciso escolher o estado antes
 * de buscar a UC. Portais de concessionária única implementam isso como no-op.
 */


const LOGIN_URL = 'https://agenciavirtual.neoenergia.com/#/login';

// Rotas internas da SPA. Navegação é sempre por location.hash — nunca page.goto():
// goto recarrega a aplicação Angular e derruba a sessão autenticada.
const ROTAS = {
    selecionarEstado: '#/home/selecionar-estado',
    meusImoveis:      '#/home/meus-imoveis',
    consultarDebitos: '#/home/servicos/consultar-debitos',
};

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

/** Navega dentro da SPA sem recarregar (preserva a sessão). */
async function irPara(page, rota) {
    await page.evaluate((r) => { location.hash = r; }, rota);
    await page.waitForTimeout(3000);
}

/** "1.234,56" | "1234.56" | "1234,56" -> Number */
function parseValor(raw) {
    if (!raw) return 0;
    const cleaned = String(raw).trim();
    if (cleaned.includes(',') && cleaned.includes('.')) return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    if (cleaned.includes(',')) return parseFloat(cleaned.replace(',', '.'));
    return parseFloat(cleaned);
}

/** Extrai "R$ x" do texto da linha da fatura. */
function valorDaLinha(rowText) {
    const m = rowText.match(/R\$\s*([\d,.]+)/);
    return m && m[1] ? parseValor(m[1]) : 0;
}

/** Aplica máscara de CPF (11 dígitos) ou CNPJ (14) — o portal autentica por documento. */
function formatDoc(v) {
    const d = (v || '').replace(/\D/g, '');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return v;
}

/**
 * Marca de conta parcelada na linha do portal.
 *
 * A Neoenergia parcela de forma UNILATERAL: quando não consegue faturar a
 * conta no prazo, emite a fatura e já a parcela, para cumprir o prazo de
 * emissão da ANEEL. Não é acordo pedido pelo cliente e não é sinal de
 * inadimplência — e, principalmente, a fatura EXISTE (é dela que saem consumo
 * e energia compensada, necessários para faturar o assinante da B2W).
 */
const PADRAO_PARCELADA = /PARCELAD|PARCELAMENTO|ACORDO/i;

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

module.exports = {
    id: 'neoenergia',
    nome: 'Neoenergia',

    // Filtro aplicado à coluna consumer_units.concessionaria (ilike).
    matchConcessionaria: 'Neoenergia%',

    loginUrl: LOGIN_URL,
    rotuloEscopo: 'Estado',

    /**
     * Exigências do portal, descobertas na marra:
     * - headless:false é OBRIGATÓRIO — em headless o Akamai devolve Access Denied.
     *   No CI isso funciona porque o processo roda dentro de um display virtual (xvfb-run).
     * - AutomationControlled remove navigator.webdriver; sem a flag o portal
     *   carrega a página mas RECUSA autenticar (fica preso em #/login).
     */
    launchOptions() {
        return {
            headless: process.env.HEADLESS === 'true',
            slowMo: Number(process.env.SLOW_MO || 0),
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-dev-shm-usage'
            ]
        };
    },

    contextOptions() {
        return {
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale: 'pt-BR',
            timezoneId: 'America/Fortaleza',
            acceptDownloads: true
        };
    },

    /** Resolve o estado a selecionar no portal. Prioriza a UF do endereço. */
    resolverEscopo({ uf, concessionaria }) {
        const ufUpper = (uf || '').toUpperCase();
        const conc = (concessionaria || '').toLowerCase();
        return UF_TO_ESTADO[ufUpper] || CONCESSIONARIA_TO_ESTADO[conc];
    },

    /**
     * Fase 1 — Autenticação.
     * O portal alterna entre home institucional, modal de login e telas logadas
     * sem transição previsível, por isso o loop de tentativas em vez de uma
     * sequência linear. Sucesso = chegou em selecionar-estado ou meus-imoveis.
     */
    async login(page, creds, ctx) {
        const { log, screenshot } = ctx;

        log('Acessando portal Neoenergia...');
        await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 60000 });

        let loggedIn = false;
        for (let i = 0; i < 15; i++) {
            await page.waitForTimeout(3000);

            // Sucesso?
            if (page.url().includes('/selecionar-estado') || page.url().includes('/meus-imoveis') || await page.locator('input[placeholder*="Unidade Consumidora"]').isVisible()) {
                log('ACESSO REALIZADO COM SUCESSO!');
                loggedIn = true;
                break;
            }

            // Modal Aberto?
            const userField = page.locator('input#userId, input[name="username"], input[name="j_username"], input[name="cpfCnpj"], mat-form-field:has-text("CPF") input, mat-form-field:has-text("CNPJ") input, input[formcontrolname="login"], input[formcontrolname="usuario"]').first();
            if (await userField.isVisible()) {
                log(`   [Faturista] Preenchendo credenciais para ${creds.login}...`);

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
                log('   [Faturista] Submeteu form de login. Aguardando redirecionamento autônomo...');

                // Aguarda o portal decidir para onde jogar (não força nav aqui de primeira)
                try {
                    await page.waitForFunction(() =>
                        location.hash.includes('selecionar-estado') ||
                        location.hash.includes('meus-imoveis') ||
                        !!document.querySelector('input[placeholder*="Unidade Consumidora"]'),
                        { timeout: 15000 });
                } catch (e) {
                    log('   [Faturista] Sem redirect automático pós-login. Indo para selecionar-estado...');
                    await irPara(page, ROTAS.selecionarEstado);
                    await page.waitForTimeout(3000);
                }

                try {
                    await page.waitForFunction(() =>
                        !!document.querySelector('a.link-page') ||
                        !!document.querySelector('input[placeholder*="Unidade Consumidora"]'),
                        { timeout: 20000 });
                } catch (e) {
                    log('   [Faturista] Timeout aguardando tela de estados/imóveis após fallback. Tirando dump...');
                    await screenshot(`pos_login_fallback_fail`, { fullPage: true });
                    const hashLog = await page.evaluate(() => location.hash);
                    const est = await page.evaluate(() => ({
                        hash: location.hash,
                        bodyLen: document.body.innerText.trim().length,
                        temLinkPage: document.querySelectorAll('a.link-page').length,
                        temRouterOutlet: !!document.querySelector('router-outlet'),
                        ua: navigator.userAgent,
                        webdriver: navigator.webdriver
                    }));
                    log('[DEBUG ESTADO] ' + JSON.stringify(est));
                    log(`   [Faturista] Location hash atual: ${hashLog}`);
                }
                continue;
            }

            // Botão de Abrir Modal Visível?
            const abrirModalBtn = page.locator('button[aria-label="Conectar-se a agência virtual"], button:has-text("LOGIN")').filter({ hasNotText: 'CADASTRE' }).first();
            if (await abrirModalBtn.count() > 0) {
                log(`   [Faturista] Clicando para abrir modal de login...`);
                await abrirModalBtn.click({ force: true }).catch(() => {});
                await page.waitForTimeout(2500);
                continue;
            }
        }

        if (!loggedIn) {
            await screenshot(`login_fail`, { fullPage: true });
            throw new Error('Falha na autenticação ou timeout do portal.');
        }
    },

    /** Fase 2 — Seleção de estado (a Neoenergia serve 5 distribuidoras no mesmo portal). */
    async selecionarEscopo(page, escopo, ctx) {
        const { log } = ctx;

        log(`   [Faturista] Navegando para ${ROTAS.selecionarEstado}...`);
        await irPara(page, ROTAS.selecionarEstado);
        await page.waitForTimeout(3000);

        const estadoLink = page.locator('a.link-page', { hasText: escopo }).first();
        if (await estadoLink.count() > 0) {
            log(`   [Faturista] Selecionando estado: ${escopo}`);
            await estadoLink.click({ force: true });
            try {
                await page.waitForFunction(() => location.hash.includes('meus-imoveis'), { timeout: 20000 });
                log(`   [Faturista] Roteado para meus-imoveis com sucesso.`);
            } catch (e) {
                console.error('   [Faturista] Timeout aguardando redirecionamento pós-estado.');
            }
        } else {
            console.error(`   [Faturista] Botão do estado ${escopo} não encontrado. Risco de falha na UC.`);
        }
    },

    /**
     * Fases 3 a 5 — abre a UC, procura a fatura do mês-alvo e baixa o PDF.
     *
     * Retorna (nunca grava no banco — isso é responsabilidade do orquestrador):
     *   { resultado: 'baixada',        ref, valor, parcelada, localPath }
     *   { resultado: 'conta_minima',   ref, valor }
     *   { resultado: 'parcelada',      ref, valor }   // existe, sem download aqui
     *   { resultado: 'falha_download', ref, erro }
     *   { resultado: 'nao_disponivel' }
     * Lança em erro estrutural (UC não encontrada, botão ausente).
     */
    async capturarFatura(page, uc, mesRefAlvo, ctx) {
        const { log, downloadDir } = ctx;
        // O cadastro guarda o numero em formatos diferentes: uns so com
        // digitos ("7030003955"), outros formatados ("2.236.346.032-16"), e ha
        // ate um com espaco na frente. O portal sempre exibe 12 digitos, sem
        // pontuacao. Normalizar antes de buscar e antes de casar o card.
        const digitosUC = uc.numero_uc.toString().replace(/\D/g, '');
        const paddedUC = digitosUC.padStart(12, '0');

        // Fase 3: Busca de UC em meus-imoveis (Reset explícito para cada UC)
        await irPara(page, ROTAS.meusImoveis);
        await page.waitForTimeout(3000);

        const ucSearchInput = page.locator('input[placeholder*="Unidade Consumidora"]').first();
        await ucSearchInput.waitFor({ state: 'visible', timeout: 15000 });
        await ucSearchInput.fill(digitosUC);

        // Clica em Pesquisar
        const pesquisarBtn = page.locator('button', { hasText: 'Pesquisar' }).first();
        if (await pesquisarBtn.isVisible()) {
            await pesquisarBtn.click();
        } else {
            await page.click('button[aria-label="Pesquisar"]');
        }
        await page.waitForTimeout(4000);

        // Casa por DIGITO, nao por substring literal. O hasText comparava o
        // texto do cadastro com o do portal: numero formatado nunca casava, e a
        // UC caia em "card nao visivel" mesmo existindo na concessionaria.
        const itens = page.locator('li');
        const totalItens = await itens.count();
        let ucCardRow = null;

        for (let i = 0; i < totalItens; i++) {
            const item = itens.nth(i);
            const digitosDoItem = (await item.innerText().catch(() => '')).replace(/\D/g, '');
            if (digitosDoItem.includes(paddedUC)) {
                ucCardRow = item.locator('div.row').first();
                break;
            }
        }

        if (ucCardRow && await ucCardRow.count() > 0) {
            await ucCardRow.click({ force: true });
            log(`   [Faturista] Card UC ${paddedUC} clicado. Portal deve redirecionar...`);
            await page.waitForTimeout(4000); // Aguarda o redirect autônomo do portal
        } else {
            throw new Error(`Unidade ${paddedUC} não encontrada no painel da concessionária (nenhum card com esse número entre os ${totalItens} listados).`);
        }

        // Fase 4: Lista de Faturas (consultar-debitos)
        log('   [Faturista] Forçando rota para consultar-debitos...');
        await irPara(page, ROTAS.consultarDebitos);
        await page.waitForTimeout(5000);

        const checkboxes = await page.locator('mat-checkbox[id^="checkItem-"]').all();
        let falhaDownload = null;
        // Diagnóstico: quando o alvo não é encontrado, saber o que ESTAVA na tela
        // vale mais que o palpite. Sem isso, "não disponível" some sem rastro.
        const refsVistas = [];

        for (const cb of checkboxes) {
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
            }).catch((e) => { log('   [DIAG] erro no evaluate: ' + e.message); return ''; });

            const parsedRef = parseMesRef(rowText);
            if (parsedRef) refsVistas.push(parsedRef);
            if (parsedRef !== mesRefAlvo) continue;

            log(`   [Faturista] Fatura [${parsedRef}] localizada na tabela!`);

            // A Neoenergia parcela de forma UNILATERAL: quando não consegue
            // faturar no prazo, emite a conta e já a parcela para cumprir o
            // prazo da ANEEL. Ou seja, parcelada NÃO quer dizer acordo do
            // cliente e NÃO quer dizer ausência de fatura — o PDF existe e é
            // dele que saem consumo e energia compensada. Por isso o download
            // segue normalmente; 'parcelada' é só uma etiqueta a mais.
            const ehParcelada = PADRAO_PARCELADA.test(rowText);
            if (ehParcelada) {
                log(`   [Faturista] Fatura [${parsedRef}] está PARCELADA. Baixando mesmo assim.`);
            }

            // CONTA MÍNIMA não gera PDF nem boleto — a concessionária acumula o
            // valor para o mês seguinte. Insistir no download é perda de tempo.
            if (rowText.toUpperCase().includes('CONTA MÍNIMA')) {
                log(`   [Faturista] Fatura identificada como CONTA MÍNIMA. Pulando download.`);
                return { resultado: 'conta_minima', ref: parsedRef, valor: valorDaLinha(rowText) };
            }

            // Fase 5: Fluxo de Download

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
            log(`   [Faturista] Modal de motivo de download. Escolhendo opção...`);
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
                const localPath = `${downloadDir}/${fileName}`;
                await dl.saveAs(localPath);

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

                return {
                    resultado: 'baixada',
                    ref: parsedRef,
                    valor: valorDaLinha(rowText),
                    parcelada: ehParcelada,
                    localPath,
                    fileName
                };
            } catch (downloadErr) {
                console.error(`   [Faturista] Falha ao baixar o PDF:`, downloadErr.message);

                // Tenta fechar qualquer modal pendente se falhou
                const closeBtn = page.locator('mat-dialog-container button[aria-label="Fechar"], mat-dialog-container button:has-text("OK")').first();
                if (await closeBtn.count() > 0) await closeBtn.click({ force: true }).catch(() => {});

                // Não interrompe o loop: comportamento preservado do código original.
                falhaDownload = { resultado: 'falha_download', ref: parsedRef, erro: downloadErr.message };
            }
        }

        if (falhaDownload) return falhaDownload;

        // Nenhum checkbox casou com o mês-alvo. Antes de dizer "não disponível",
        // procurar a referência no texto da tela: a lista do portal ordena
        // vencidas -> a vencer -> parceladas -> pagas, e nem toda linha
        // oferece checkbox de 2ª via. Se a conta existe mas não é baixável,
        // registrar o valor é muito melhor que gravar zero.
        const achadoNoTexto = await page.evaluate((alvoRegex) => {
            const blocos = [...document.querySelectorAll('div,li,tr')]
                .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
                .filter(t => t.length > 20 && t.length < 600);
            return blocos.find(t => new RegExp(alvoRegex, 'i').test(t)) || null;
        }, mesRefAlvo.replace('/', '\\/')).catch(() => null);

        if (achadoNoTexto) {
            const refTexto = parseMesRef(achadoNoTexto);
            if (refTexto === mesRefAlvo && PADRAO_PARCELADA.test(achadoNoTexto)) {
                log(`   [Faturista] Fatura [${mesRefAlvo}] existe como PARCELADA, sem opção de download nesta tela.`);
                return {
                    resultado: 'parcelada',
                    ref: mesRefAlvo,
                    valor: valorDaLinha(achadoNoTexto),
                };
            }
        }

        log(`   [Faturista] Referência ${mesRefAlvo} não encontrada. Disponíveis na tela: ${refsVistas.length ? refsVistas.join(', ') : '(nenhuma)'}`);
        return { resultado: 'nao_disponivel' };
    },

    /** Derruba a sessão do titular antes de logar com o próximo. */
    async encerrarSessao(page, context) {
        await page.goto(LOGIN_URL).catch(() => {});
        await context.clearCookies();
    },

    parseMesRef,
};
