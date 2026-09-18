/**
 * Testes de lib/sessao.js — `node --test lib/sessao.test.js`
 *
 * Usa o runner nativo do Node (node:test), sem dependência nova. O portal é
 * dublê: o que importa aqui é a MÁQUINA DE DECISÃO — quando reusar, quando
 * descartar, quando logar e quando gravar. Errar isso custa caro nos dois
 * sentidos: reusar sessão morta derruba a rodada inteira do titular, e relogar
 * sem necessidade é justamente o que este módulo veio eliminar.
 */

const test = require('node:test');
const assert = require('node:assert');

const ONTEM = new Date(Date.now() - 86400000).toISOString();
const MES_PASSADO = new Date(Date.now() - 30 * 86400000).toISOString();

const envelope = (salvoEm = ONTEM, state = { cookies: [{ name: 'x' }], origins: [] }) =>
    JSON.stringify({ versao: 1, salvoEm, origem: 'local', state });

/** Supabase dublê: guarda o que foi baixado/gravado/apagado para as asserções. */
function fakeSupabase({ conteudo = null, falhaUpload = false } = {}) {
    const chamadas = { download: [], upload: [], remove: [] };
    return {
        chamadas,
        storage: {
            from: () => ({
                download: async (path) => {
                    chamadas.download.push(path);
                    if (conteudo === null) return { data: null, error: { message: 'Not found' } };
                    return { data: { text: async () => conteudo }, error: null };
                },
                upload: async (path) => {
                    chamadas.upload.push(path);
                    return falhaUpload ? { error: { message: 'bucket inexistente' } } : { error: null };
                },
                remove: async (paths) => {
                    chamadas.remove.push(...paths);
                    return { error: null };
                },
            }),
        },
    };
}

function fakeBrowser() {
    const contextos = [];
    return {
        contextos,
        newContext: async (opts) => {
            const ctx = {
                opts,
                fechado: false,
                newPage: async () => ({}),
                storageState: async () => ({ cookies: [{ name: 'novo' }], origins: [] }),
                close: async () => { ctx.fechado = true; },
            };
            contextos.push(ctx);
            return ctx;
        },
    };
}

/** @param sondaResponde  true/false, ou 'lanca' para simular portal travado. */
function fakeDriver({ sondaResponde = true, comSonda = true, loginLanca = false } = {}) {
    const d = {
        id: 'portal-teste',
        logins: 0,
        sondas: 0,
        contextOptions: () => ({ locale: 'pt-BR' }),
        login: async () => {
            d.logins++;
            if (loginLanca) throw new Error('senha recusada');
        },
    };
    if (comSonda) {
        d.sessaoValida = async () => {
            d.sondas++;
            if (sondaResponde === 'lanca') throw new Error('portal travado');
            return sondaResponde;
        };
    }
    return d;
}

/** Recarrega o módulo com env limpo, porque as flags são lidas no require. */
function carregarModulo(env = {}) {
    const anterior = { ...process.env };
    Object.assign(process.env, env);
    delete require.cache[require.resolve('./sessao')];
    const mod = require('./sessao');
    process.env = anterior;
    return mod;
}

const abrirCom = (sessao, { supabase, browser, driver, ...resto }) =>
    sessao.abrir({
        supabase,
        browser,
        driver,
        subscriberId: 'sub-1',
        creds: { login: '123', password: 'x' },
        montarCtx: () => ({ log: () => {}, screenshot: async () => {} }),
        log: () => {},
        ...resto,
    });

test('sessão válida é reaproveitada e o login não acontece', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true' });
    const supabase = fakeSupabase({ conteudo: envelope() });
    const browser = fakeBrowser();
    const driver = fakeDriver({ sondaResponde: true });

    const r = await abrirCom(sessao, { supabase, browser, driver });

    assert.equal(r.reusada, true);
    assert.equal(driver.logins, 0, 'não deveria ter logado');
    assert.equal(driver.sondas, 1);
    assert.equal(browser.contextos.length, 1, 'um contexto só');
    assert.ok(browser.contextos[0].opts.storageState, 'contexto criado com a sessão salva');
    assert.ok(browser.contextos[0].opts.locale, 'contextOptions do driver preservadas');
});

test('sessão expirada é descartada e o login acontece num contexto novo', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true' });
    const supabase = fakeSupabase({ conteudo: envelope() });
    const browser = fakeBrowser();
    const driver = fakeDriver({ sondaResponde: false });

    const r = await abrirCom(sessao, { supabase, browser, driver });

    assert.equal(r.reusada, false);
    assert.equal(driver.logins, 1);
    assert.equal(browser.contextos.length, 2, 'o contexto envenenado é trocado, não reusado');
    assert.equal(browser.contextos[0].fechado, true, 'o contexto da sessão morta foi fechado');
    assert.equal(browser.contextos[1].opts.storageState, undefined, 'o segundo nasce limpo');
    assert.deepEqual(supabase.chamadas.remove, ['sessions/portal-teste/sub-1.json']);
    assert.equal(supabase.chamadas.upload.length, 1, 'a sessão nova foi gravada');
});

test('sonda que lança é tratada como sessão expirada, não como erro da rodada', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true' });
    const supabase = fakeSupabase({ conteudo: envelope() });
    const driver = fakeDriver({ sondaResponde: 'lanca' });

    const r = await abrirCom(sessao, { supabase, browser: fakeBrowser(), driver });

    assert.equal(r.reusada, false);
    assert.equal(driver.logins, 1);
});

test('sem sessão salva, loga e grava', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true' });
    const supabase = fakeSupabase({ conteudo: null });
    const driver = fakeDriver();

    const r = await abrirCom(sessao, { supabase, browser: fakeBrowser(), driver });

    assert.equal(r.reusada, false);
    assert.equal(driver.logins, 1);
    assert.equal(driver.sondas, 0, 'não sonda o que não existe');
    assert.deepEqual(supabase.chamadas.upload, ['sessions/portal-teste/sub-1.json']);
});

test('sessão velha demais nem chega a ser sondada', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true', SESSAO_VALIDADE_DIAS: '7' });
    const supabase = fakeSupabase({ conteudo: envelope(MES_PASSADO) });
    const driver = fakeDriver();

    await abrirCom(sessao, { supabase, browser: fakeBrowser(), driver });

    assert.equal(driver.sondas, 0, 'poupa a ida ao portal');
    assert.equal(driver.logins, 1);
});

test('envelope corrompido não derruba: cai no login', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true' });
    const supabase = fakeSupabase({ conteudo: '{ isto não é json' });
    const driver = fakeDriver();

    const r = await abrirCom(sessao, { supabase, browser: fakeBrowser(), driver });

    assert.equal(r.reusada, false);
    assert.equal(driver.logins, 1);
});

test('SESSAO_PERSISTENTE=false volta ao comportamento antigo', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'false' });
    const supabase = fakeSupabase({ conteudo: envelope() });
    const driver = fakeDriver();

    await abrirCom(sessao, { supabase, browser: fakeBrowser(), driver });

    assert.equal(driver.logins, 1);
    assert.deepEqual(supabase.chamadas.download, [], 'não toca no storage');
    assert.deepEqual(supabase.chamadas.upload, []);
});

test('driver sem sessaoValida segue logando toda vez, sem tocar no storage', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true' });
    const supabase = fakeSupabase({ conteudo: envelope() });
    const driver = fakeDriver({ comSonda: false });

    await abrirCom(sessao, { supabase, browser: fakeBrowser(), driver });

    assert.equal(driver.logins, 1);
    assert.deepEqual(supabase.chamadas.download, []);
    assert.deepEqual(supabase.chamadas.upload, []);
});

test('bucket ausente não derruba a rodada — só não guarda', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true' });
    const supabase = fakeSupabase({ conteudo: null, falhaUpload: true });
    const driver = fakeDriver();

    const r = await abrirCom(sessao, { supabase, browser: fakeBrowser(), driver });

    assert.equal(r.reusada, false, 'a sessão abriu mesmo sem conseguir gravar');
    assert.equal(driver.logins, 1);
});

test('login que falha propaga e não deixa contexto aberto para trás', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true' });
    const supabase = fakeSupabase({ conteudo: null });
    const browser = fakeBrowser();
    const driver = fakeDriver({ loginLanca: true });

    await assert.rejects(
        () => abrirCom(sessao, { supabase, browser, driver }),
        /senha recusada/,
        'o grupo precisa receber o erro para marcar as UCs'
    );

    assert.equal(browser.contextos.length, 1);
    assert.equal(browser.contextos[0].fechado, true, 'contexto órfão foi fechado');
    assert.deepEqual(supabase.chamadas.upload, [], 'não grava sessão de login que falhou');
});

test('salvar() grava o estado do fim da rodada, não o do login', async () => {
    const sessao = carregarModulo({ SESSAO_PERSISTENTE: 'true' });
    const supabase = fakeSupabase();
    const browser = fakeBrowser();
    const context = await browser.newContext({});

    const ok = await sessao.salvar({
        supabase,
        driver: fakeDriver(),
        subscriberId: 'sub-9',
        context,
        log: () => {},
    });

    assert.equal(ok, true);
    assert.deepEqual(supabase.chamadas.upload, ['sessions/portal-teste/sub-9.json']);
});
