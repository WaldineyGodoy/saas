import { test, expect, describe } from 'vitest';
import {
    CAMPOS_PLANO_USINA,
    CHAVES_CONTRATO_DO_PLANO,
    CHAVES_GESTAO_DO_PLANO,
    CAMPOS_TRAVADOS,
    PLANO_USINA_VAZIO,
    termosContratoDoPlano,
    termosGestaoDoPlano,
    lerFechamentos,
    validarPlanoUsina,
    rascunhoNovaVersao,
    payloadPlanoUsina,
    planoAceitaUsina,
    condicoesIniciaisGestao
} from '../src/lib/planoUsina.js';

const PLANO = {
    id: 'p1', nome: 'Plano A', descricao: 'd', status: 'ativo',
    percentual_recorrente: 12, taxa_admin_reais: 9.5, taxa_recuperacao_pct: 7,
    retencao_rescisao_pct: 11, multa_atraso_mes_pct: 0.4, multa_atraso_teto_pct: 9,
    garantia_instalacao_meses: 24,
    desconto_pct: 18, dia_corte: 6, dia_repasse: 16, prazo_transferencia_dias: 60, prazo_honorarios_dias: 150,
    originador_recorrente_pct: 3, originador_bonus_fechamentos: [2], plano_assinatura_id: 'rec1'
};

describe('campos do plano de usina', () => {
    test('o contrato de compra e venda recebe os 7 termos comerciais (spec secao 1)', () => {
        expect(CHAVES_CONTRATO_DO_PLANO).toEqual([
            'percentualRecorrente', 'taxaAdmin', 'taxaRecuperacao', 'retencaoRescisao',
            'multaAtrasoMes', 'multaAtrasoTeto', 'garantiaInstalacaoMeses'
        ]);
    });

    test('o contrato de gestao recebe os 8 campos de CAMPOS_CONDICOES (spec decisoes 10 e 11)', () => {
        expect([...CHAVES_GESTAO_DO_PLANO].sort()).toEqual([
            'desconto', 'diaCorte', 'diaRepasse', 'percentualRecorrente', 'prazoHonorarios',
            'prazoTransferencia', 'taxaAdmin', 'taxaRecuperacao'
        ]);
    });

    test('a trava espelha fn_planos_usina_trava', () => {
        expect(CAMPOS_TRAVADOS).toEqual([
            'percentual_recorrente', 'taxa_admin_reais', 'taxa_recuperacao_pct', 'retencao_rescisao_pct',
            'multa_atraso_mes_pct', 'multa_atraso_teto_pct', 'garantia_instalacao_meses',
            'desconto_pct', 'dia_corte', 'dia_repasse', 'prazo_transferencia_dias', 'prazo_honorarios_dias',
            'originador_recorrente_pct', 'originador_bonus_fechamentos', 'plano_assinatura_id'
        ]);
    });

    test('o vazio tem os mesmos defaults da migracao 20261006e', () => {
        expect(PLANO_USINA_VAZIO).toMatchObject({
            percentual_recorrente: 10, taxa_admin_reais: 10, taxa_recuperacao_pct: 8,
            retencao_rescisao_pct: 10, multa_atraso_mes_pct: 0.5, multa_atraso_teto_pct: 10,
            garantia_instalacao_meses: 12,
            desconto_pct: 20, dia_corte: 5, dia_repasse: 15, prazo_transferencia_dias: 90, prazo_honorarios_dias: 180,
            originador_recorrente_pct: 0, originador_bonus_fechamentos: [], plano_assinatura_id: null
        });
        expect(CAMPOS_PLANO_USINA.every(c => c.chave in PLANO_USINA_VAZIO)).toBe(true);
    });
});

describe('termos para os contratos', () => {
    test('compra e venda: colunas do plano viram as chaves do gerador', () => {
        expect(termosContratoDoPlano(PLANO)).toEqual({
            percentualRecorrente: 12, taxaAdmin: 9.5, taxaRecuperacao: 7, retencaoRescisao: 11,
            multaAtrasoMes: 0.4, multaAtrasoTeto: 9, garantiaInstalacaoMeses: 24
        });
    });

    test('gestao de creditos: colunas do plano viram as chaves de DEFAULTS_FORNECEDOR', () => {
        expect(termosGestaoDoPlano(PLANO)).toEqual({
            desconto: 18, percentualRecorrente: 12, taxaAdmin: 9.5, taxaRecuperacao: 7,
            diaCorte: 6, diaRepasse: 16, prazoTransferencia: 60, prazoHonorarios: 150
        });
    });

    test('numeric do Postgres chega como string e vira numero', () => {
        expect(termosContratoDoPlano({ ...PLANO, percentual_recorrente: '12.50' }).percentualRecorrente).toBe(12.5);
        expect(termosGestaoDoPlano({ ...PLANO, desconto_pct: '17.5' }).desconto).toBe(17.5);
    });

    test('sem plano, nada', () => {
        expect(termosContratoDoPlano(null)).toEqual({});
        expect(termosGestaoDoPlano(null)).toEqual({});
    });
});

describe('lerFechamentos', () => {
    test('aceita um ou varios, ordena e tira repetidos', () => {
        expect(lerFechamentos('2')).toEqual([2]);
        expect(lerFechamentos('3, 2;2 5')).toEqual([2, 3, 5]);
    });

    test('vazio e lista vazia', () => {
        expect(lerFechamentos('')).toEqual([]);
        expect(lerFechamentos(null)).toEqual([]);
    });

    test('zero, negativo, fracao ou texto -> null', () => {
        expect(lerFechamentos('0')).toBeNull();
        expect(lerFechamentos('-1')).toBeNull();
        expect(lerFechamentos('1.5')).toBeNull();
        expect(lerFechamentos('dois')).toBeNull();
    });
});

describe('validarPlanoUsina', () => {
    test('plano completo nao tem erro', () => {
        expect(validarPlanoUsina(PLANO)).toEqual([]);
    });

    test('nome vazio, acima do maximo, negativo, fracao, dia 0 e bonus invalido', () => {
        const erros = validarPlanoUsina({
            ...PLANO, nome: '  ', percentual_recorrente: 101, taxa_admin_reais: -1,
            garantia_instalacao_meses: 1.5, dia_corte: 0, originador_bonus_fechamentos: null
        });
        expect(erros).toHaveLength(6);
        expect(erros[0]).toMatch(/nome/i);
    });
});

describe('versao e gravacao', () => {
    test('rascunho da nova versao copia os valores e marca o nome', () => {
        const r = rascunhoNovaVersao(PLANO);
        expect(r.nome).toBe('Plano A (nova versão)');
        expect(r.percentual_recorrente).toBe(12);
        expect(r.dia_repasse).toBe(16);
        expect(r.plano_assinatura_id).toBe('rec1');
        expect(r).not.toHaveProperty('id');
        expect(r).not.toHaveProperty('status');
    });

    test('payload converte numeros e manda null no lugar de string vazia', () => {
        const p = payloadPlanoUsina({ ...PLANO, nome: ' X ', descricao: '', percentual_recorrente: '12', dia_corte: '7', plano_assinatura_id: '' });
        expect(p.nome).toBe('X');
        expect(p.descricao).toBeNull();
        expect(p.percentual_recorrente).toBe(12);
        expect(p.dia_corte).toBe(7);
        expect(p.plano_assinatura_id).toBeNull();
        expect(p).not.toHaveProperty('id');
        expect(p).not.toHaveProperty('status');
    });

    test('so plano ativo com plano de recompensas aceita usina', () => {
        expect(planoAceitaUsina(PLANO)).toBe(true);
        expect(planoAceitaUsina({ ...PLANO, status: 'somente_contratos' })).toBe(false);
        expect(planoAceitaUsina({ ...PLANO, plano_assinatura_id: null })).toBe(false);
        expect(planoAceitaUsina(null)).toBe(false);
    });
});

describe('condicoesIniciaisGestao (spec decisao 10)', () => {
    const plano = { desconto_pct: 18, percentual_recorrente: 12, taxa_admin_reais: 9, taxa_recuperacao_pct: 7,
                    dia_corte: 6, dia_repasse: 16, prazo_transferencia_dias: 60, prazo_honorarios_dias: 150 };

    test('sem nada gravado no fornecedor, o plano da usina aberta sugere os oito campos', () => {
        expect(condicoesIniciaisGestao({ plano, gravados: null, gestaoUsina: 10 })).toEqual({
            desconto: 18, percentualRecorrente: 12, taxaAdmin: 9, taxaRecuperacao: 7,
            diaCorte: 6, diaRepasse: 16, prazoTransferencia: 60, prazoHonorarios: 150
        });
    });

    test('o gravado no fornecedor vence campo a campo; o que falta vem do plano', () => {
        const r = condicoesIniciaisGestao({ plano, gravados: { desconto: 20, foro: 'Natal/RN', minutas: { gestao: 'x' } }, gestaoUsina: 10 });
        expect(r.desconto).toBe(20);
        expect(r.diaRepasse).toBe(16);
        expect(r.foro).toBe('Natal/RN');
        expect(r.minutas).toEqual({ gestao: 'x' });
    });

    test('sem plano, a taxa de gestao da usina sugere a recorrente, como antes', () => {
        expect(condicoesIniciaisGestao({ plano: null, gravados: {}, gestaoUsina: 10 })).toEqual({ percentualRecorrente: 10 });
        expect(condicoesIniciaisGestao({ plano: null, gravados: { percentualRecorrente: 9 }, gestaoUsina: 10 })).toEqual({ percentualRecorrente: 9 });
        expect(condicoesIniciaisGestao({ plano: null, gravados: null, gestaoUsina: 0 })).toEqual({});
    });
});
