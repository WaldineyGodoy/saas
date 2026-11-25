import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anterioresPendentes, concluirAnteriores } from './cronogramaObra.js';

const crono = {
    inicio: '2026-10-01',
    itens: {
        orcamento_conexao: { status: 'concluido', concluido_em: '2026-10-05' },
        terraplanagem: { status: 'andamento', pct: 50, previsto_para: '2026-10-31' },
        estrutura_solo: { status: 'previsto', previsto_para: '2026-11-30' }
    }
};

test('anteriores pendentes seguem a ordem do catálogo, entre macroetapas', () => {
    assert.deepEqual(anterioresPendentes(crono, 'estrutura_solo'), ['terraplanagem', 'padrao_entrada', 'parecer_acesso']);
    assert.deepEqual(anterioresPendentes(crono, 'orcamento_conexao'), []);
});

test('concluir anteriores grava a data da alteração e preserva o que já estava concluído', () => {
    const r = concluirAnteriores(crono, 'estrutura_solo', '2026-11-25');
    assert.equal(r.itens.orcamento_conexao.concluido_em, '2026-10-05');
    for (const id of ['terraplanagem', 'padrao_entrada', 'parecer_acesso']) {
        assert.equal(r.itens[id].status, 'concluido');
        assert.equal(r.itens[id].concluido_em, '2026-11-25');
    }
    assert.equal(r.itens.terraplanagem.previsto_para, '2026-10-31');
    assert.equal(r.itens.estrutura_solo.status, 'previsto');
    assert.equal(crono.itens.terraplanagem.status, 'andamento'); // não muta a entrada
});
