// node --test scraper/tt_filler.test.js  (precisa de playwright, dotenv e supabase-js instalados)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { avaliarEnvioAutomatico } = require('./tt_filler');

const ok = () => ({
    endereco: { ok: true, achados: [] },
    resumoTemUC: true,
    resumoTemCessionario: true,
    vencimento: '16',
});

test('tudo conferido: o envio automático é liberado', () => {
    assert.deepEqual(avaliarEnvioAutomatico(ok()), []);
});

test('endereço do portal que não confere com a UC barra o envio', () => {
    const motivos = avaliarEnvioAutomatico({ ...ok(), endereco: { ok: false, achados: [] } });
    assert.equal(motivos.length, 1);
    assert.match(motivos[0], /endereço/);
});

test('Resumo sem a UC cedente ou sem o cessionário barra o envio', () => {
    assert.match(avaliarEnvioAutomatico({ ...ok(), resumoTemUC: false }).join(), /UC cedente/);
    assert.match(avaliarEnvioAutomatico({ ...ok(), resumoTemCessionario: false }).join(), /cessionário/);
});

test('sem vencimento escolhido barra o envio', () => {
    assert.match(avaliarEnvioAutomatico({ ...ok(), vencimento: null }).join(), /vencimento/);
});

test('dados ausentes nunca liberam: na dúvida, não envia', () => {
    assert.equal(avaliarEnvioAutomatico(undefined).length, 4);
    assert.equal(avaliarEnvioAutomatico({}).length, 4);
});
