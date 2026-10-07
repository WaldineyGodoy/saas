import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    STATUS_ELETROPOSTO,
    statusConfig,
    usinaDoEletroposto,
    filtrarEletropostos,
    somaPercentuais,
    validarFornecedores,
    paraPayloadFornecedores,
    montarPayloadEletroposto,
    mensagemErroEletroposto,
    casaBusca,
} from './eletropostos.js';

const E1 = {
    id: 'e1', nome: 'Posto Centro', status: 'operando', originator_id: 'o1',
    endereco: { cidade: 'Natal', uf: 'RN' },
    consumer_unit: { id: 'uc1', numero_uc: '7010192824', usina: { id: 'u1', name: 'Bom Jesus II' } },
    fornecedores: [{ supplier_id: 's1', percentual: 60, ativo: true }, { supplier_id: 's2', percentual: 40, ativo: true }],
};
const E2 = {
    id: 'e2', nome: 'Shopping Sul', status: 'pre_operacao', originator_id: null,
    endereco: { cidade: 'Parnamirim', uf: 'RN' },
    consumer_unit: null,
    fornecedores: [{ supplier_id: 's3', percentual: 100, ativo: true }],
};

test('status: seis colunas na ordem do Kanban', () => {
    assert.deepEqual(
        STATUS_ELETROPOSTO.map(s => s.status),
        ['pre_operacao', 'em_instalacao', 'operando', 'manutencao', 'inativo', 'cancelado'],
    );
    assert.equal(statusConfig('operando').label, 'Operando');
    assert.equal(statusConfig('xpto').status, 'pre_operacao');
});

test('usina vem da UC, e nulo sem UC', () => {
    assert.equal(usinaDoEletroposto(E1).name, 'Bom Jesus II');
    assert.equal(usinaDoEletroposto(E2), null);
    assert.equal(usinaDoEletroposto(null), null);
});

test('filtros: busca por nome, UC e cidade, sem diferenciar maiusculas', () => {
    const lista = [E1, E2];
    assert.deepEqual(filtrarEletropostos(lista, { busca: 'centro' }).map(e => e.id), ['e1']);
    assert.deepEqual(filtrarEletropostos(lista, { busca: '7010192' }).map(e => e.id), ['e1']);
    assert.deepEqual(filtrarEletropostos(lista, { busca: 'PARNA' }).map(e => e.id), ['e2']);
    assert.deepEqual(filtrarEletropostos(lista, {}).map(e => e.id), ['e1', 'e2']);
});

test('filtros: status, usina, fornecedor e originador combinam', () => {
    const lista = [E1, E2];
    assert.deepEqual(filtrarEletropostos(lista, { status: 'pre_operacao' }).map(e => e.id), ['e2']);
    assert.deepEqual(filtrarEletropostos(lista, { usinaId: 'u1' }).map(e => e.id), ['e1']);
    assert.deepEqual(filtrarEletropostos(lista, { supplierId: 's3' }).map(e => e.id), ['e2']);
    assert.deepEqual(filtrarEletropostos(lista, { originatorId: 'o1' }).map(e => e.id), ['e1']);
    assert.deepEqual(filtrarEletropostos(lista, { originatorId: 'o1', status: 'pre_operacao' }), []);
});

test('soma: so os ativos, duas casas', () => {
    assert.equal(somaPercentuais([{ percentual: '33.33' }, { percentual: 33.33 }, { percentual: '33.34' }]), 100);
    assert.equal(somaPercentuais([{ percentual: 60 }, { percentual: 40, ativo: false }]), 60);
    assert.equal(somaPercentuais([]), 0);
    assert.equal(somaPercentuais(undefined), 0);
});

test('validacao dos fornecedores', () => {
    assert.equal(validarFornecedores([]), null);
    assert.equal(validarFornecedores([{ supplier_id: 's1', percentual: '60' }, { supplier_id: 's2', percentual: '40' }]), null);
    assert.match(validarFornecedores([{ supplier_id: '', percentual: '10' }]), /Escolha o fornecedor/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '10' }, { supplier_id: 's1', percentual: '10' }]), /duas vezes/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '0' }]), /maior que 0/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '' }]), /maior que 0/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '100.5' }]), /maior que 0/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '70' }, { supplier_id: 's2', percentual: '40' }]), /passa de 100% \(110%\)/);
    // inativo nao entra na soma
    assert.equal(validarFornecedores([{ supplier_id: 's1', percentual: '70' }, { supplier_id: 's2', percentual: '40', ativo: false }]), null);
});

test('payload dos fornecedores para a RPC', () => {
    assert.deepEqual(
        paraPayloadFornecedores([{ supplier_id: 's1', percentual: '60.5' }, { supplier_id: 's2', percentual: 39.5, ativo: false }]),
        [{ supplier_id: 's1', percentual: 60.5, ativo: true }, { supplier_id: 's2', percentual: 39.5, ativo: false }],
    );
});

test('payload do eletroposto: vazios viram null e endereco vira jsonb', () => {
    const form = {
        nome: '  Posto Centro ', status: 'operando', plano_id: '', originator_id: 'o1',
        tarifa_investidor_kwh: '0.85', consumer_unit_id: '', cep: '59000-000', rua: 'Rua A', numero: '10',
        bairro: 'Centro', cidade: 'Natal', uf: 'RN', ibge: '2408102', qtd_carregadores: '2', potencia_kw: '',
        tipo_recarga: '', fabricante: ' Joult ', modelo: '', observacoes: '',
    };
    assert.deepEqual(montarPayloadEletroposto(form), {
        nome: 'Posto Centro', status: 'operando', plano_id: null, originator_id: 'o1',
        tarifa_investidor_kwh: 0.85, consumer_unit_id: null,
        endereco: { cep: '59000-000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Natal', uf: 'RN', ibge: '2408102' },
        qtd_carregadores: 2, potencia_kw: null, tipo_recarga: null, fabricante: 'Joult', modelo: null, observacoes: null,
    });
});

test('mensagem de erro: UC ja usada, plano errado e generico', () => {
    assert.equal(
        mensagemErroEletroposto({ code: '23505', message: 'duplicate key value violates unique constraint "eletropostos_consumer_unit_id_key"' }),
        'Essa UC já está ligada a outro eletroposto.',
    );
    assert.equal(
        mensagemErroEletroposto({ code: '23514', message: 'O plano escolhido não é um plano de eletroposto.' }),
        'O plano escolhido não é um plano de eletroposto.',
    );
    assert.equal(mensagemErroEletroposto({ message: 'falhou' }), 'falhou');
    assert.equal(mensagemErroEletroposto(null), 'Erro desconhecido.');
});

test('busca: numero da UC casa com ou sem pontuacao', () => {
    const e = { ...E1, consumer_unit: { ...E1.consumer_unit, numero_uc: '2.100.615.032-02' } };
    assert.deepEqual(filtrarEletropostos([e, E2], { busca: '2100615' }).map(x => x.id), ['e1']);
    assert.deepEqual(filtrarEletropostos([e, E2], { busca: '2.100.615' }).map(x => x.id), ['e1']);
    assert.deepEqual(filtrarEletropostos([e, E2], { busca: '032-02' }).map(x => x.id), ['e1']);
    assert.equal(casaBusca('2100615', ['2.100.615.032-02']), true);
    assert.equal(casaBusca('paulo', ['2.100.615.032-02', 'Paulo Vitor']), true);
    assert.equal(casaBusca('', ['qualquer']), true);
    // dois digitos soltos nao casam por digito (evita "12" achar metade da base)
    assert.equal(casaBusca('12', ['1.2']), false);
});
