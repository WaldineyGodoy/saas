import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usinasParaVincular, STATUS_USINA_VINCULAVEL } from './usinasParaVincular.js';

const usina = (id, geracao, extra = {}) => ({ id, name: `Usina ${id}`, status: 'gerando', geracao_estimada_kwh: geracao, ...extra });
const benef = (usina_id, franquia, extra = {}) => ({ id: `uc-${usina_id}-${franquia}`, usina_id, status: 'ativo', tipo_unidade: 'beneficiaria', franquia, ...extra });
const ids = (r) => r.map((u) => u.id);

test('só Em Conexão e Gerando entram na lista', () => {
    assert.deepEqual([...STATUS_USINA_VINCULAVEL].sort(), ['em_conexao', 'gerando']);
    const usinas = [
        usina('a', 1000, { status: 'gerando' }),
        usina('b', 1000, { status: 'em_conexao' }),
        usina('c', 1000, { status: 'pre_operacao' }),
        usina('d', 1000, { status: 'cancelada' }),
        usina('e', 1000, { status: 'manutencao' }),
        usina('f', 1000, { status: 'inativa' }),
    ];
    assert.deepEqual(ids(usinasParaVincular({ usinas, ucs: [], franquia: 100 })).sort(), ['a', 'b']);
});

test('disponível = geração − franquias que ocupam (a mesma regra do painel da usina)', () => {
    const r = usinasParaVincular({
        usinas: [usina('a', 1000)],
        ucs: [benef('a', 300), benef('a', 200, { status: 'cancelado' })],
        franquia: 100,
    });
    // a UC cancelada devolve a franquia; sobram 1000 − 300
    assert.equal(r[0].disponivel, 700);
});

test('consumo da UG sai da geração antes do rateio', () => {
    const r = usinasParaVincular({
        usinas: [usina('a', 1000)],
        ucs: [{ id: 'ug', usina_id: 'a', status: 'ativo', tipo_unidade: 'geradora', franquia: 100 }, benef('a', 300)],
        franquia: 50,
    });
    assert.equal(r[0].disponivel, 600);
});

test('primeiro as que comportam a franquia, da que sobra MENOS para a que sobra mais', () => {
    const usinas = [usina('folgada', 5000), usina('justa', 1100), usina('media', 2000)];
    const r = usinasParaVincular({ usinas, ucs: [], franquia: 1000 });
    assert.deepEqual(ids(r), ['justa', 'media', 'folgada']);
});

test('depois as que não comportam, da mais próxima da franquia para a mais distante', () => {
    const usinas = [usina('longe', 100), usina('perto', 900), usina('meio', 500)];
    const r = usinasParaVincular({ usinas, ucs: [], franquia: 1000 });
    assert.deepEqual(ids(r), ['perto', 'meio', 'longe']);
});

test('as duas faixas juntas: as que cabem vêm antes, mesmo sendo as mais folgadas', () => {
    const usinas = [usina('nao-cabe-perto', 950), usina('cabe-folgada', 9000), usina('cabe-justa', 1000), usina('nao-cabe-longe', 10)];
    const r = usinasParaVincular({ usinas, ucs: [], franquia: 1000 });
    assert.deepEqual(ids(r), ['cabe-justa', 'cabe-folgada', 'nao-cabe-perto', 'nao-cabe-longe']);
});

test('disponível igual à franquia cabe (borda)', () => {
    const r = usinasParaVincular({ usinas: [usina('a', 1000), usina('b', 999)], ucs: [], franquia: 1000 });
    assert.deepEqual(ids(r), ['a', 'b']);
    assert.equal(r[0].comporta, true);
    assert.equal(r[1].comporta, false);
});

test('usina em overbook fica com disponível negativo no cálculo e no fim da faixa que não cabe', () => {
    const usinas = [usina('estourada', 500), usina('livre', 300)];
    const r = usinasParaVincular({ usinas, ucs: [benef('estourada', 800)], franquia: 1000 });
    assert.equal(r.find((u) => u.id === 'estourada').disponivel, -300);
    assert.deepEqual(ids(r), ['livre', 'estourada']);
});

test('usina sem geração estimada não tem como medir: vai por último, por nome', () => {
    const usinas = [usina('z', null, { name: 'Zeta' }), usina('a', 5000), usina('m', undefined, { name: 'Alfa' })];
    const r = usinasParaVincular({ usinas, ucs: [], franquia: 1000 });
    assert.deepEqual(ids(r), ['a', 'm', 'z']);
    assert.equal(r[1].disponivel, null);
    assert.equal(r[1].comporta, null);
});

test('ao editar uma UC já vinculada, a franquia dela não conta contra a própria usina', () => {
    const minha = benef('a', 400, { id: 'minha-uc' });
    const r = usinasParaVincular({
        usinas: [usina('a', 1000), usina('b', 450)],
        ucs: [minha, benef('a', 300)],
        franquia: 400,
        ucAtualId: 'minha-uc',
    });
    // 'a': 1000 − 300 = 700 (sem a própria UC); sem a exclusão seria 300 e não caberia
    assert.equal(r.find((u) => u.id === 'a').disponivel, 700);
    assert.deepEqual(ids(r), ['b', 'a']);
});

test('franquia vazia, texto ou inválida vale 0: todas as com folga cabem', () => {
    const usinas = [usina('a', 800), usina('b', 200)];
    assert.deepEqual(ids(usinasParaVincular({ usinas, ucs: [], franquia: '' })), ['b', 'a']);
    assert.deepEqual(ids(usinasParaVincular({ usinas, ucs: [], franquia: 'abc' })), ['b', 'a']);
    assert.deepEqual(ids(usinasParaVincular({ usinas, ucs: [], franquia: '250' })), ['a', 'b']);
});

test('geração como texto numérico (o banco devolve numeric como string)', () => {
    const r = usinasParaVincular({ usinas: [usina('a', '1192')], ucs: [], franquia: 100 });
    assert.equal(r[0].disponivel, 1192);
});

test('entradas vazias não quebram', () => {
    assert.deepEqual(usinasParaVincular({ usinas: [], ucs: [], franquia: 1 }), []);
    assert.deepEqual(usinasParaVincular({}), []);
    assert.deepEqual(usinasParaVincular(), []);
});

test('empate no disponível desempata pelo nome', () => {
    const usinas = [usina('b', 1000, { name: 'Beta' }), usina('a', 1000, { name: 'Alfa' })];
    assert.deepEqual(ids(usinasParaVincular({ usinas, ucs: [], franquia: 500 })), ['a', 'b']);
});
