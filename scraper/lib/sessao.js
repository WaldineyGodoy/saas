/**
 * Sessão de portal persistente, por titular.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * ---------------------------
 * Até aqui o orquestrador abria UM contexto de navegador para o driver inteiro
 * e chamava `clearCookies()` entre um titular e outro. Efeito colateral: toda
 * execução começava sem nenhum cookie, e o robô refazia o login completo em
 * cada rodada. Fora o tempo, isso custa reputação — o WAF (Akamai, no caso da
 * Neoenergia) vê sempre um cliente recém-chegado, sem `_abck`/`bm_sz` de
 * histórico, que é exatamente o perfil que ele desafia.
 *
 * Agora cada titular tem o seu próprio contexto, e o `storageState` dele
 * (cookies + localStorage) é guardado entre execuções. O login deixa de ser
 * por rodada e passa a ser por expiração.
 *
 * ONDE FICA GUARDADO
 * ------------------
 * Bucket PRIVADO `portal-sessions`, um arquivo por titular. O conteúdo é um
 * cookie de sessão autenticada: tem o mesmo peso de uma senha e recebe o mesmo
 * tratamento — nada de log do valor, nada de artefato de CI, nada no git.
 *
 * DEGRADAÇÃO
 * ----------
 * Tudo aqui é best-effort: bucket inexistente, JSON corrompido, sonda que não
 * responde — qualquer falha cai no caminho antigo (login completo) com um aviso
 * no log. O pior caso é o comportamento de antes mais alguns segundos de sonda,
 * nunca uma rodada perdida.
 *
 * DESLIGAR
 * --------
 * `SESSAO_PERSISTENTE=false` desativa por completo, sem precisar reverter
 * código. Útil para isolar o robô de uma suspeita de sessão envenenada.
 *
 * ⚠️ LIMITE CONHECIDO — IP
 * Cookie de WAF costuma ser amarrado ao IP que o recebeu. O runner do GitHub
 * Actions sai com IP diferente a cada execução, então a sessão salva lá tende a
 * ser recusada na rodada seguinte: a sonda detecta, descarta e refaz o login —
 * ou seja, funciona, mas sem ganho. O ganho real aparece em host de IP estável
 * (VPS ou self-hosted runner), que é para onde o fluxo de homologação deve ir.
 */

const BUCKET = process.env.SESSAO_BUCKET || 'portal-sessions';
const VALIDADE_DIAS = Number(process.env.SESSAO_VALIDADE_DIAS || 7);
const HABILITADA = process.env.SESSAO_PERSISTENTE !== 'false';

// O envelope existe para carregar metadado junto do state. Sem ele não dá para
// saber se a sessão é de ontem ou de um mês atrás sem acordar o portal.
const VERSAO_ENVELOPE = 1;

const caminho = (driverId, subscriberId) => `sessions/${driverId}/${subscriberId}.json`;

/** O driver sabe checar se a sessão restaurada ainda vale? Sem isso, não há como reusar com segurança. */
const suportaPersistencia = (driver) => HABILITADA && typeof driver.sessaoValida === 'function';

/**
 * Lê o `storageState` salvo do titular. Devolve null se não existir, se estiver
 * velho demais ou se qualquer coisa der errado — nunca lança.
 */
async function carregar({ supabase, driver, subscriberId, log }) {
    const path = caminho(driver.id, subscriberId);

    try {
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (error || !data) return null;

        const envelope = JSON.parse(await data.text());

        if (envelope.versao !== VERSAO_ENVELOPE || !envelope.state) {
            log(`   [Sessão] Envelope em formato desconhecido; ignorando.`);
            return null;
        }

        const idadeDias = (Date.now() - new Date(envelope.salvoEm).getTime()) / 86400000;
        if (!Number.isFinite(idadeDias) || idadeDias > VALIDADE_DIAS) {
            log(`   [Sessão] Salva há ${idadeDias.toFixed(1)}d (limite ${VALIDADE_DIAS}d); vai logar do zero.`);
            return null;
        }

        const nCookies = envelope.state.cookies?.length ?? 0;
        log(`   [Sessão] Encontrada: ${nCookies} cookies, salva há ${idadeDias.toFixed(1)}d.`);
        return envelope.state;
    } catch (e) {
        log(`   [Sessão] Falha ao ler (${e.message}); vai logar do zero.`);
        return null;
    }
}

/**
 * Grava o `storageState` atual do contexto.
 *
 * Chamado DEPOIS do trabalho, não só depois do login: o WAF rotaciona cookie
 * durante a navegação, então o estado do fim da rodada é o que tem mais chance
 * de ser aceito na próxima.
 */
async function salvar({ supabase, driver, subscriberId, context, log }) {
    if (!suportaPersistencia(driver)) return false;

    const path = caminho(driver.id, subscriberId);

    try {
        const state = await context.storageState();
        const envelope = {
            versao: VERSAO_ENVELOPE,
            salvoEm: new Date().toISOString(),
            origem: process.env.GITHUB_ACTIONS === 'true' ? 'ci' : 'local',
            state,
        };

        const { error } = await supabase.storage
            .from(BUCKET)
            .upload(path, Buffer.from(JSON.stringify(envelope)), {
                contentType: 'application/json',
                upsert: true,
            });

        if (error) throw error;

        log(`   [Sessão] Guardada (${state.cookies?.length ?? 0} cookies).`);
        return true;
    } catch (e) {
        // Não guardar a sessão não estraga a rodada: só faz a próxima relogar.
        log(`   [Sessão] Não foi possível guardar (${e.message}).`);
        return false;
    }
}

/** Apaga a sessão salva. Usado quando a sonda prova que ela morreu. */
async function descartar({ supabase, driver, subscriberId, log }) {
    try {
        await supabase.storage.from(BUCKET).remove([caminho(driver.id, subscriberId)]);
    } catch (e) {
        log(`   [Sessão] Falha ao descartar a sessão morta (${e.message}).`);
    }
}

/**
 * Abre o contexto do titular já autenticado, reusando a sessão quando ela ainda
 * vale e logando quando não vale.
 *
 * `montarCtx(page)` é o que devolve o `ctx` do driver (log/screenshot/downloadDir);
 * vem de fora porque o `screenshot` precisa estar amarrado à página desta sessão.
 *
 * Devolve { context, page, ctx, reusada }. Lança se o login falhar — mesmo
 * contrato de `driver.login`, para o tratamento de erro do grupo não mudar.
 */
async function abrir({ supabase, browser, driver, subscriberId, creds, montarCtx, log }) {
    if (suportaPersistencia(driver)) {
        const state = await carregar({ supabase, driver, subscriberId, log });

        if (state) {
            const context = await browser.newContext({ ...driver.contextOptions(), storageState: state });
            const page = await context.newPage();
            const ctx = montarCtx(page);

            let valida = false;
            try {
                valida = await driver.sessaoValida(page, ctx);
            } catch (e) {
                log(`   [Sessão] Sonda falhou (${e.message}); tratando como expirada.`);
            }

            if (valida) {
                log('   [Sessão] Reaproveitada — login pulado.');
                return { context, page, ctx, reusada: true };
            }

            // Contexto envenenado por cookie morto: fora com ele. Reaproveitar o
            // mesmo contexto para logar arrisca o portal seguir enxergando a
            // sessão anterior.
            log('   [Sessão] Expirada; autenticando do zero.');
            await context.close().catch(() => {});
            await descartar({ supabase, driver, subscriberId, log });
        }
    }

    const context = await browser.newContext(driver.contextOptions());
    const page = await context.newPage();
    const ctx = montarCtx(page);

    try {
        await driver.login(page, creds, ctx);
    } catch (e) {
        // O orquestrador nunca recebeu este contexto, então não é ele quem vai
        // fechá-lo. Sem isto, cada titular que falha no login deixa um contexto
        // aberto até o fim do lote.
        await context.close().catch(() => {});
        throw e;
    }

    await salvar({ supabase, driver, subscriberId, context, log });

    return { context, page, ctx, reusada: false };
}

module.exports = { abrir, salvar, descartar, carregar, BUCKET, HABILITADA, VALIDADE_DIAS };
