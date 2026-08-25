/**
 * Faturista — orquestrador de coleta de faturas de concessionária.
 *
 * Este arquivo NÃO conhece portal nenhum. Ele cuida do que é comum a todos:
 *   - regra da janela de disponibilidade (quando vale a pena procurar)
 *   - consulta e agrupamento das UCs por driver / titular / escopo
 *   - gravação de status e faturas no Supabase
 *
 * Tudo que é específico de um portal (URL, rotas, seletores, fluxo de
 * download) vive em drivers/<concessionaria>.js — ver drivers/index.js.
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const { DRIVERS, resolverDriver } = require('./drivers');
const { extrairDoArquivo } = require('./extrator');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const DOWNLOAD_DIR = './downloads';
const DEBUG_DIR = './downloads/debug';

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
    const JANELA_INICIO_DIAS = 5;   // só procura a partir de D+5
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
        let desistiu = false;
        if (diasDesdeLeitura < JANELA_INICIO_DIAS) motivo = `aguarda D+${JANELA_INICIO_DIAS} (leitura há ${diasDesdeLeitura}d)`;
        else if (diasDesdeLeitura > JANELA_DESISTIR_DIAS) { motivo = `desiste: ${diasDesdeLeitura}d sem publicar (>${JANELA_DESISTIR_DIAS}d)`; desistiu = true; }
        else if (diasUltimaTentativa < JANELA_RETENTATIVA) motivo = `retentativa em ${JANELA_RETENTATIVA - diasUltimaTentativa}d`;

        return { mesRef, dataLeitura, diasDesdeLeitura, elegivel: motivo === null, motivo, desistiu };
    }

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
        // sentido procurar a partir de D+5 da leitura, repetindo a cada 7 dias.
        modoJanela = true;
        targetedDays = [];
        currentMesRef = null; // definido POR UC
    }

    console.log(`[Faturista] REF: ${currentMesRef || "por UC (modo janela)"} | Dias de Leitura: ${targetedDays.length ? targetedDays.join(', ') : 'Todos no Mês'}`);

    // 2. Busca as UCs atendidas por algum driver registrado
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
            data_desligamento,
            acompanhar_conta_ate,
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
        `);

    // Com um único driver usa-se ilike direto (idêntico ao comportamento
    // anterior); com vários, um or() de ilikes cobre todos os padrões.
    if (DRIVERS.length === 1) {
        query = query.ilike('concessionaria', DRIVERS[0].matchConcessionaria);
    } else {
        query = query.or(DRIVERS.map(d => `concessionaria.ilike.${d.matchConcessionaria}`).join(','));
    }

    // UC encerrada nao gera mais conta. Tentar todo dia gasta sessao no portal,
    // marca erro vermelho no Calendario de Leituras e -- pior -- grava
    // last_scraping_at, o que joga a UC para o fim da janela de retentativa de
    // 7 dias.
    //
    // As demais entram MESMO sem faturamento ativo (aguardando_conexao,
    // vinculado, sem_geracao, ativacao...): a concessionaria pode emitir conta
    // antes de a UC estar faturando, e essa conta e justamente o aviso de que
    // alguma coisa mudou. Decisao do dono em 25/08/2026.
    // UC encerrada sai da fila -- MENOS enquanto houver acompanhamento aberto.
    //
    // Depois do desligamento a concessionaria ainda emite: a conta final
    // proporcional, que e devida, e as vezes contas de periodo posterior, que
    // nao sao. Sem acompanhar, ninguem descobre. Acompanhando para sempre, o
    // robo fica consultando conta desligada imaginando erro.
    //
    // O prazo e explicito por UC em acompanhar_conta_ate (padrao 90 dias, ~3
    // ciclos, a partir do desligamento ou da descoberta). Vencido, a UC sai
    // sozinha -- se ainda vier conta, o caso e juridico e nao de robo.
    const STATUS_ENCERRADOS = ['cancelado', 'cancelado_inadimplente', 'desconectado'];
    const hojeISO = hojeUTC.toISOString().slice(0, 10);
    query = query.or(
        `status.not.in.(${STATUS_ENCERRADOS.join(',')}),acompanhar_conta_ate.gte.${hojeISO}`
    );

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

        uc.driver = resolverDriver(uc.concessionaria);
        if (!uc.driver) {
            console.error(`[Faturista] ERRO: Nenhum driver para a concessionária "${uc.concessionaria}" (UC ${uc.numero_uc}). Pulando.`);
            await supabase
                .from('consumer_units')
                .update({
                    last_scraping_status: 'error',
                    last_scraping_at: new Date().toISOString(),
                    last_scraping_error: 'concessionaria sem driver de automacao'
                })
                .eq('id', uc.id);
            continue;
        }

        const uf = uc.address?.uf?.toUpperCase();
        uc.escopoAlvo = uc.driver.resolverEscopo({ uf, concessionaria: uc.concessionaria });

        if (!uc.escopoAlvo) {
            console.error(`[Faturista] ERRO: ${uc.driver.rotuloEscopo} não resolvido para UC ${uc.numero_uc} (UF: ${uf}, Conc: ${uc.concessionaria}). Pulando.`);
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

                // SINALIZAÇÃO NO CRM: quando a automação DESISTE (>60d sem a conta
                // ser publicada), a UC não pode sumir em silêncio da fila — precisa
                // ficar visível no Calendário de Leituras para ação humana.
                if (j.desistiu) {
                    await sinalizarDesistencia(uc, j);
                }
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

    // 3. Agrupa: driver -> titular das credenciais -> escopo (estado, no caso da Neoenergia).
    //    O driver vem primeiro porque cada portal exige seu próprio navegador.
    const porDriver = ucsToScrape.reduce((acc, uc) => {
        const driverId = uc.driver.id;
        if (!acc[driverId]) acc[driverId] = { driver: uc.driver, titulares: {} };

        const effectiveSub = uc.titular_fatura || uc.subscriber;
        const subId = effectiveSub?.id || uc.subscriber_id;
        const titulares = acc[driverId].titulares;

        if (!titulares[subId]) {
            titulares[subId] = {
                subscriber: effectiveSub,
                subscriberId: subId,
                credenciaisDaLinha: effectiveSub?.portal_credentials,
                escopos: {}
            };
        }

        const escopo = uc.escopoAlvo;
        if (!titulares[subId].escopos[escopo]) {
            titulares[subId].escopos[escopo] = [];
        }

        titulares[subId].escopos[escopo].push(uc);
        return acc;
    }, {});

    const totalTitulares = Object.values(porDriver)
        .reduce((n, g) => n + Object.keys(g.titulares).length, 0);
    console.log(`[Faturista] Iniciando processamento de ${allUcs.length} UCs em ${totalTitulares} contas de titular.`);

    // 4. Um navegador por driver — as exigências de anti-bot são do portal,
    //    não do orquestrador (ver launchOptions/contextOptions do driver).
    for (const driverId in porDriver) {
        const { driver, titulares } = porDriver[driverId];

        const browser = await chromium.launch(driver.launchOptions());
        const context = await browser.newContext(driver.contextOptions());
        const page = await context.newPage();

        async function takeScreenshot(name, opts = {}) {
            if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
            await page.screenshot({ path: `${DEBUG_DIR}/${name}_${Date.now()}.png`, ...opts });
        }

        const ctx = {
            log: (msg) => console.log(msg),
            screenshot: takeScreenshot,
            downloadDir: DOWNLOAD_DIR,
        };

        // Processa cada grupo (Titular)
        for (const subId in titulares) {
            const group = titulares[subId];
            const { subscriber, escopos } = group;
            const escoposList = Object.keys(escopos);

            if (escoposList.length === 0) continue;

            const allUcsCount = Object.values(escopos).reduce((acc, curr) => acc + curr.length, 0);
            console.log(`\n=== Processando Assinante: ${subscriber.name} (${allUcsCount} UCs em ${escoposList.length} ${driver.rotuloEscopo.toLowerCase()}(s)) ===`);

            const creds = await carregarCredenciais(group.subscriberId, group.credenciaisDaLinha);

            if (!creds?.login || !creds?.password) {
                console.error(`Status: ERRO - Credenciais não encontradas para o assinante ${subscriber.name}`);
                for (const escopo in escopos) {
                    for (const uc of escopos[escopo]) {
                        await updateUCStatus(uc.id, 'error', 'Credenciais de acesso não configuradas.');
                    }
                }
                continue;
            }

            try {
                await driver.login(page, creds, ctx);

                for (const escopoAlvo of escoposList) {
                    const ucsDoEscopo = escopos[escopoAlvo];
                    console.log(`\n--- Processando ${driver.rotuloEscopo}: ${escopoAlvo} (${ucsDoEscopo.length} UCs) ---`);

                    await driver.selecionarEscopo(page, escopoAlvo, ctx);

                    for (const uc of ucsDoEscopo) {
                        try {
                            console.log(`-> UC: ${uc.numero_uc}`);

                            const r = await driver.capturarFatura(page, uc, uc.mesRefAlvo, ctx);

                            if (r.resultado === 'conta_minima') {
                                // A concessionária não emite PDF/boleto — o saldo acumula
                                // para o mês seguinte. Registrar evita reprocessar todo dia.
                                await upsertInvoice(uc, r.ref, {
                                    reading_status: 'processing',
                                    reading_error: '[INFO] Conta minima - concessionaria nao emite PDF/boleto; saldo acumula para o mes seguinte. Nao reprocessar.',
                                    status: 'sem_faturamento',
                                    valor_concessionaria: r.valor,
                                    is_placeholder: false,
                                });
                                await updateUCStatus(uc.id, 'success');

                            } else if (r.resultado === 'baixada') {
                                // Upload e gravação ficam no orquestrador; se falharem, a
                                // fatura é marcada com erro igual a uma falha de download.
                                try {
                                    const storagePath = await uploadToSupabase(r.localPath, uc.numero_uc, r.fileName);

                                    // Estágio 2: lê o PDF e completa a fatura. A leitura pode
                                    // falhar sem que o download se perca — nesse caso a fatura
                                    // fica gravada com o PDF e o motivo, para revisão.
                                    let extraidos = { reading_status: 'processing', reading_error: null };
                                    try {
                                        const ex = await extrairDoArquivo(r.localPath, {
                                            supabaseUrl: process.env.SUPABASE_URL,
                                            supabaseKey: process.env.SUPABASE_KEY,
                                            valorPortal: r.valor,
                                            refAlvo: r.ref,
                                        });
                                        extraidos = ex.colunas;
                                        if (ex.veredito.ok) {
                                            console.log(`   [Extração] ${ex.colunas.consumo_kwh} kWh | compensado ${ex.colunas.consumo_compensado} | venc ${ex.colunas.vencimento_concessionaria} | R$ ${ex.veredito.totalPdf.toFixed(2)} confere com portal e código de barras`);
                                        } else {
                                            console.warn(`   [Extração] CONFERIR: ${ex.veredito.problemas.join('; ')}`);
                                        }
                                    } catch (exErr) {
                                        console.error(`   [Extração] falhou:`, exErr.message);
                                        extraidos = {
                                            reading_status: 'error',
                                            reading_error: `Falha na leitura do PDF: ${exErr.message}`.substring(0, 500),
                                        };
                                    }

                                    const { data: gravada } = await upsertInvoice(uc, r.ref, {
                                        concessionaria_pdf_url: storagePath,
                                        status: 'sem_faturamento',
                                        valor_concessionaria: r.valor,
                                        is_placeholder: false,
                                        ...extraidos,
                                    });
                                    await updateUCStatus(uc.id, 'success');
                                    await registrarSuspeitaDesligamento(uc, gravada?.id);
                                } catch (upErr) {
                                    console.error(`   [Faturista] Falha ao guardar o PDF:`, upErr.message);
                                    await upsertInvoice(uc, r.ref, {
                                        reading_status: 'error',
                                        reading_error: `Falha no download: ${upErr.message}`,
                                        status: 'sem_faturamento',
                                        is_placeholder: true,
                                    });
                                    await updateUCStatus(uc.id, 'not_available', 'Hoje é dia de leitura, mas a fatura ainda não foi postada no portal.');
                                }

                            } else if (r.resultado === 'falha_download') {
                                await upsertInvoice(uc, r.ref, {
                                    reading_status: 'error',
                                    reading_error: `Falha no download: ${r.erro}`,
                                    status: 'sem_faturamento',
                                    is_placeholder: true,
                                });
                                await updateUCStatus(uc.id, 'not_available', 'Hoje é dia de leitura, mas a fatura ainda não foi postada no portal.');

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
                } // end escopos loop
            } catch (groupErr) {
                console.error(`Erro Crítico no Grupo ${subscriber.name}:`, groupErr.message);
                for (const escopo in escopos) {
                    for (const uc of escopos[escopo]) {
                        await updateUCStatus(uc.id, 'error', `Erro de login/portal: ${groupErr.message}`);
                    }
                }
                await takeScreenshot(`erro_grupo_${subId}`);
            } finally {
                console.log('Finalizando sessão do assinante...');
                await driver.encerrarSessao(page, context);
            }
        }

        await browser.close();
    }

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

/**
 * Credenciais do portal para um titular de fatura.
 *
 * A senha não vive mais na linha do assinante: fica cifrada no Vault, e a
 * única forma de lê-la é a RPC abaixo, com EXECUTE concedido só ao
 * service_role. Qualquer usuário logado no CRM enxerga a linha inteira do
 * assinante — era por ali que a senha vazava.
 *
 * O fallback no jsonb cobre o intervalo entre esta versão e a migração dos
 * segredos; depois dela o campo `password` já não existe.
 */
async function carregarCredenciais(subscriberId, credenciaisDaLinha) {
    if (!subscriberId) return credenciaisDaLinha || null;

    const { data, error } = await supabase.rpc('fn_get_portal_credentials', {
        p_entidade: 'subscribers',
        p_id: subscriberId,
    });

    if (error) {
        console.warn(`[Faturista] RPC de credenciais falhou (${error.message}); usando o campo antigo.`);
    } else if (data && data.length > 0 && data[0].senha) {
        return { login: data[0].login, password: data[0].senha };
    }

    return credenciaisDaLinha || null;
}

/** Grava a fatura do mês-alvo da UC. `ref` no formato MM/AAAA. */
async function upsertInvoice(uc, ref, campos) {
    const [month, year] = ref.split('/').map(Number);
    return supabase.from('invoices').upsert({
        uc_id: uc.id,
        mes_referencia: `${year}-${String(month).padStart(2, '0')}-01`,
        reading_checked_at: new Date().toISOString(),
        ...campos
    }, { onConflict: 'uc_id,mes_referencia' }).select('id').single();
}

/**
 * Desligamento de UC na concessionária.
 *
 * O assinante pede o desligamento direto na concessionária e a B2W só descobre
 * depois — foi o que aconteceu com a UC 7029990055, cujo medidor parou em
 * 29/04/2026 e a Cosern seguiu emitindo conta de períodos posteriores.
 *
 * O sinal está nos dados que o robô já traz: ciclo de leitura curto encerrando
 * a série da UC é assinatura de leitura de encerramento. Quando a suspeita
 * dispara, fica registrada no histórico da UC para alguém conferir no portal e
 * gravar a data — a partir daí a auditoria barra conta de período posterior.
 *
 * Não é prova: ciclo curto também acontece quando a concessionária remaneja o
 * calendário. Por isso registra e avisa, em vez de gravar a data sozinho.
 */
async function registrarSuspeitaDesligamento(uc, invoiceId) {
    if (!invoiceId || uc.data_desligamento) return;

    const { data, error } = await supabase.rpc('fn_suspeita_desligamento', { p_invoice_id: invoiceId });
    if (error) {
        console.warn(`   [Faturista] Não foi possível checar desligamento: ${error.message}`);
        return;
    }

    const s = data?.[0];
    if (!s?.suspeita) return;

    const aviso = `UC ${uc.numero_uc}: última conta com ciclo de ${s.dias_ciclo} dias contra mediana de ${s.mediana} em ${s.ciclos} faturas. Possível desligamento na concessionária — conferir no portal e registrar data_desligamento.`;
    console.warn(`   [ATENÇÃO] ${aviso}`);

    // Idempotente: não repete o mesmo aviso todo dia para a mesma fatura.
    const { data: jaAvisado } = await supabase
        .from('crm_history')
        .select('id')
        .eq('entity_id', uc.id)
        .eq('metadata->>evento', 'suspeita_desligamento')
        .eq('metadata->>invoice_id', invoiceId)
        .limit(1);

    if (jaAvisado && jaAvisado.length > 0) return;

    await supabase.from('crm_history').insert({
        entity_type: 'consumer_unit',
        entity_id: uc.id,
        content: aviso,
        metadata: {
            evento: 'suspeita_desligamento',
            invoice_id: invoiceId,
            dias_ciclo: s.dias_ciclo,
            mediana: s.mediana,
            ciclos: s.ciclos,
        },
    });
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

/**
 * Sinaliza no CRM que a automação DESISTIU de buscar a conta desta UC/mês.
 *
 * Sem isso a UC simplesmente pararia de ser tentada e sumiria da fila em
 * silêncio — ninguém saberia que existe uma conta que nunca foi publicada.
 *
 * A marcação é feita na INVOICE do mês (não só na UC) porque é dela que o
 * Calendário de Leituras lê a cor. Resultado: card VERMELHO (Indisponível)
 * no mês correspondente, com o motivo em reading_error.
 *
 * É idempotente: se já estiver sinalizada, não regrava (evita ruído diário).
 */
async function sinalizarDesistencia(uc, janela) {
    const [mm, yyyy] = janela.mesRef.split('/');
    const mesReferencia = `${yyyy}-${mm}-01`;
    const nota = `[ATENCAO] Automacao desistiu apos ${janela.diasDesdeLeitura} dias sem a concessionaria publicar a conta (leitura em ${janela.dataLeitura.toISOString().slice(0, 10)}). Verificar manualmente no portal ou abrir chamado na concessionaria.`;

    try {
        const { data: existente } = await supabase
            .from('invoices')
            .select('id, reading_error')
            .eq('uc_id', uc.id)
            .eq('mes_referencia', mesReferencia)
            .limit(1);

        // Já sinalizada -> não repete a gravação todo dia
        if (existente && existente.length > 0 && (existente[0].reading_error || '').includes('Automacao desistiu')) {
            return;
        }

        await supabase.from('invoices').upsert({
            uc_id: uc.id,
            mes_referencia: mesReferencia,
            status: 'sem_faturamento',
            reading_status: 'error',
            reading_error: nota,
            reading_checked_at: new Date().toISOString(),
            is_placeholder: true
        }, { onConflict: 'uc_id,mes_referencia' });

        await supabase
            .from('consumer_units')
            .update({
                last_scraping_status: 'error',
                last_scraping_error: nota,
                last_scraping_at: new Date().toISOString()
            })
            .eq('id', uc.id);

        console.log(`   [ATENÇÃO] UC ${uc.numero_uc} sinalizada no CRM: conta de ${janela.mesRef} não publicada em ${janela.diasDesdeLeitura} dias.`);
    } catch (e) {
        console.error(`   Falha ao sinalizar desistência da UC ${uc.numero_uc}:`, e.message);
    }
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

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
run();
