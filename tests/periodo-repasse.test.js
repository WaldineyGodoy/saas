import { describe, it, expect } from 'vitest';
import { periodoLeituraUcs, faturasDoPeriodo } from '../src/lib/periodoRepasse';

// Leituras reais da UFV Bom Jesus I (consulta de 10/11/2026).
const f = (uc, data_leitura, comp, mes) => ({ uc_id: uc, data_leitura, consumo_compensado: comp, mes_referencia: mes });

describe('período das UCs pela regra do repasse', () => {
    it('setembro: dia seguinte à leitura da UG até o fim de M+1', () => {
        expect(periodoLeituraUcs('2026-09-14', '2026-09-01')).toEqual({ ini: '2026-09-15', fim: '2026-10-31' });
    });

    it('cada UC entra só com a primeira leitura depois da UG', () => {
        const p = { ...periodoLeituraUcs('2026-09-14', '2026-09-01'), mesReferencia: '2026-09-01' };
        const faturas = [
            f('46476003280', '2026-09-17', 859, '2026-09-01'),
            f('46476003280', '2026-10-17', 900, '2026-10-01'),   // vai para outubro
            f('80926303262', '2026-09-02', 320, '2026-09-01'),   // antes da UG: agosto
            f('80926303262', '2026-10-02', 330, '2026-10-01'),
            f('197911803202', '2026-10-09', 5099, '2026-10-01'),
            f('99', '2026-11-03', 10, '2026-11-01')               // depois de 31/10
        ];
        const r = faturasDoPeriodo(faturas, p);
        expect(r.map(x => x.data_leitura).sort()).toEqual(['2026-09-17', '2026-10-02', '2026-10-09']);
    });

    it('outubro pega a leitura de 17/10 que setembro deixou', () => {
        const p = { ...periodoLeituraUcs('2026-10-14', '2026-10-01'), mesReferencia: '2026-10-01' };
        const r = faturasDoPeriodo([f('46476003280', '2026-09-17', 859, '2026-09-01'), f('46476003280', '2026-10-17', 900, '2026-10-01')], p);
        expect(r).toHaveLength(1);
        expect(r[0].data_leitura).toBe('2026-10-17');
    });

    it('fatura sem leitura entra pelo mês de referência, se a UC não tiver outra', () => {
        const p = { ini: '2026-09-15', fim: '2026-10-31', mesReferencia: '2026-09-01' };
        const r = faturasDoPeriodo([f('a', null, 1, '2026-09-01'), f('b', null, 1, '2026-09-01'), f('b', '2026-09-20', 2, '2026-09-01')], p);
        expect(r.map(x => x.uc_id + ':' + x.consumo_compensado).sort()).toEqual(['a:1', 'b:2']);
    });
});
