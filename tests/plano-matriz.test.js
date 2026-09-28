import { test, expect, describe } from 'vitest';
import {
    CARGOS,
    MATRIZ_PADRAO,
    MAX_NIVEIS,
    normalizarRecorrenteConfig
} from '../src/lib/planoRecompensas.js';

const CHAVES_LEGADAS = ['associacao', 'embaixador', 'coordenador', 'assinante'];

describe('matriz acordada (decisao do dono, 28/09/2026)', () => {
    test('CARGOS lista os 5 cargos que recebem comissao (sem b2w)', () => {
        expect(CARGOS).toEqual(['lider', 'ppe', 'ppp', 'ppf', 'assinante_conect']);
    });

    test('MAX_NIVEIS bate com a matriz acordada', () => {
        expect(MAX_NIVEIS).toEqual({
            b2w: 4,
            lider: 3,
            ppe: 2,
            ppp: 2,
            ppf: 2,
            assinante_conect: 1
        });
    });

    test('MATRIZ_PADRAO bate com a matriz acordada (percentuais relativos a quem recebe)', () => {
        expect(MATRIZ_PADRAO.b2w).toEqual({ L1: '10', L2: '10', L3: '10', L4: '10' });
        expect(MATRIZ_PADRAO.lider).toEqual({ L1: '1', L2: '1', L3: '1', L4: '0' });
        expect(MATRIZ_PADRAO.ppe).toEqual({ L1: '5', L2: '2', L3: '0', L4: '0' });
        expect(MATRIZ_PADRAO.ppp).toEqual({ L1: '4', L2: '2', L3: '0', L4: '0' });
        expect(MATRIZ_PADRAO.ppf).toEqual({ L1: '2', L2: '2', L3: '0', L4: '0' });
        expect(MATRIZ_PADRAO.assinante_conect).toEqual({ L1: '2', L2: '0', L3: '0', L4: '0' });
    });
});

describe('normalizarRecorrenteConfig', () => {
    test('remove as 4 chaves legadas de regras e nao inventa nenhuma', () => {
        const cfg = {
            regras: {
                b2w: 10, lider: 1, ppe: 5, ppp: 4, ppf: 2, assinante_conect: 2,
                associacao: 10, coordenador: 1, embaixador: 5, assinante: 2
            },
            regras_multinivel: {
                b2w: { max_niveis: 4, niveis: { L1: '10', L2: '10', L3: '10', L4: '10' } },
                lider: { max_niveis: 3, niveis: { L1: '1', L2: '1', L3: '1', L4: '0' } },
                ppe: { max_niveis: 2, niveis: { L1: '5', L2: '2', L3: '0', L4: '0' } },
                ppp: { max_niveis: 2, niveis: { L1: '4', L2: '2', L3: '0', L4: '0' } },
                ppf: { max_niveis: 2, niveis: { L1: '2', L2: '2', L3: '0', L4: '0' } },
                assinante_conect: { max_niveis: 1, niveis: { L1: '2', L2: '0', L3: '0', L4: '0' } }
            }
        };

        const out = normalizarRecorrenteConfig(cfg);

        CHAVES_LEGADAS.forEach(k => {
            expect(out.regras[k]).toBeUndefined();
        });
        expect(Object.keys(out.regras).sort()).toEqual(
            ['assinante_conect', 'b2w', 'lider', 'ppe', 'ppp', 'ppf'].sort()
        );
    });

    test('completa niveis faltantes (chaves L1..L4 ausentes) com o default da matriz acordada', () => {
        // cargo presente e com max_niveis explicito, mas so L1 foi gravado
        const cfg = {
            regras_multinivel: {
                ppf: { max_niveis: 2, niveis: { L1: '2' } }
            }
        };

        const out = normalizarRecorrenteConfig(cfg);

        expect(out.regras_multinivel.ppf).toEqual({ max_niveis: 2, niveis: { L1: '2', L2: '2', L3: '0', L4: '0' } });
    });

    test('cargo com max_niveis ausente do cfg usa o max_niveis padrao da matriz acordada', () => {
        // simula o formato antigo/divergente: ppf so tinha L1 e nunca declarava max_niveis 2
        const cfgPpf = normalizarRecorrenteConfig({ regras_multinivel: { ppf: { niveis: { L1: '2' } } } });
        expect(cfgPpf.regras_multinivel.ppf).toEqual({ max_niveis: 2, niveis: { L1: '2', L2: '2', L3: '0', L4: '0' } });

        // assinante_conect sem max_niveis tambem cai no padrao (1) e usa o default L1=2
        const cfgConect = normalizarRecorrenteConfig({ regras_multinivel: { assinante_conect: { niveis: {} } } });
        expect(cfgConect.regras_multinivel.assinante_conect).toEqual({ max_niveis: 1, niveis: { L1: '2', L2: '0', L3: '0', L4: '0' } });
    });

    test('cargo ausente do cfg recebe a matriz padrao inteira', () => {
        const out = normalizarRecorrenteConfig({});

        expect(out.regras_multinivel.b2w).toEqual({ max_niveis: 4, niveis: MATRIZ_PADRAO.b2w });
        expect(out.regras_multinivel.lider).toEqual({ max_niveis: 3, niveis: MATRIZ_PADRAO.lider });
        expect(out.regras_multinivel.ppe).toEqual({ max_niveis: 2, niveis: MATRIZ_PADRAO.ppe });
        expect(out.regras_multinivel.ppp).toEqual({ max_niveis: 2, niveis: MATRIZ_PADRAO.ppp });
        expect(out.regras_multinivel.ppf).toEqual({ max_niveis: 2, niveis: MATRIZ_PADRAO.ppf });
        expect(out.regras_multinivel.assinante_conect).toEqual({ max_niveis: 1, niveis: MATRIZ_PADRAO.assinante_conect });
    });

    test('respeita valor ja salvo dentro do max_niveis, mesmo diferente do default', () => {
        const cfg = {
            regras_multinivel: {
                ppe: { max_niveis: 2, niveis: { L1: '7', L2: '3', L3: '0', L4: '0' } }
            }
        };

        const out = normalizarRecorrenteConfig(cfg);

        expect(out.regras_multinivel.ppe).toEqual({ max_niveis: 2, niveis: { L1: '7', L2: '3', L3: '0', L4: '0' } });
    });

    test('zera niveis acima do max_niveis configurado, mesmo que o valor salvo nao fosse zero', () => {
        const cfg = {
            regras_multinivel: {
                lider: { max_niveis: 1, niveis: { L1: '1', L2: '1', L3: '1', L4: '1' } }
            }
        };

        const out = normalizarRecorrenteConfig(cfg);

        expect(out.regras_multinivel.lider).toEqual({ max_niveis: 1, niveis: { L1: '1', L2: '0', L3: '0', L4: '0' } });
    });

    test('regras (flat, legado) e derivado do nivel 1 de regras_multinivel, com as 6 chaves modernas', () => {
        const cfg = {
            regras_multinivel: {
                b2w: { max_niveis: 4, niveis: { L1: '10', L2: '10', L3: '10', L4: '10' } },
                lider: { max_niveis: 3, niveis: { L1: '1', L2: '1', L3: '1', L4: '0' } },
                ppe: { max_niveis: 2, niveis: { L1: '5', L2: '2', L3: '0', L4: '0' } },
                ppp: { max_niveis: 2, niveis: { L1: '4', L2: '2', L3: '0', L4: '0' } },
                ppf: { max_niveis: 2, niveis: { L1: '2', L2: '2', L3: '0', L4: '0' } },
                assinante_conect: { max_niveis: 1, niveis: { L1: '2', L2: '0', L3: '0', L4: '0' } }
            }
        };

        const out = normalizarRecorrenteConfig(cfg);

        expect(out.regras).toEqual({
            b2w: 10, lider: 1, ppe: 5, ppp: 4, ppf: 2, assinante_conect: 2
        });
    });

    test('preserva as demais chaves do cfg (lastro_tarifario, vigencia_tipo etc.)', () => {
        const cfg = {
            vigencia_tipo: 'status_ativo_entidade',
            meses: null,
            lastro_tarifario: { tarifa_bruta: 1.03, fio_b: 0.213 },
            regras_multinivel: {}
        };

        const out = normalizarRecorrenteConfig(cfg);

        expect(out.vigencia_tipo).toBe('status_ativo_entidade');
        expect(out.lastro_tarifario).toEqual({ tarifa_bruta: 1.03, fio_b: 0.213 });
    });
});
