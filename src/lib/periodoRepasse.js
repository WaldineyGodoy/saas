/**
 * Período de compensação das UCs beneficiárias no extrato da usina, pela
 * regra do repasse (dono, 10/09/2026, corrigida em 10/11/2026).
 *
 * M é o mês de referência da conta da UG. A energia injetada em M compensa
 * nas UCs que leem do dia seguinte à leitura da UG até um mês depois dela
 * (30 ou 31 dias). Exemplo da BJI em setembro/2026: UG lida em 14/09, UCs
 * lidas de 15/09 a 14/10. Outubro começa em 15/10, sem sobreposição.
 *
 * Se a mesma UC tiver duas leituras na janela, entra só a PRIMEIRA, para
 * nunca contar a UC duas vezes no mesmo mês.
 */
import { addDays, addMonths, format, parseISO } from 'date-fns';

/**
 * @param {string} ugDataLeitura  leitura da UG no mês M (yyyy-MM-dd)
 * @returns {{ ini: string, fim: string }}
 */
export function periodoLeituraUcs(ugDataLeitura) {
    const ug = parseISO(ugDataLeitura);
    return {
        ini: format(addDays(ug, 1), 'yyyy-MM-dd'),
        fim: format(addMonths(ug, 1), 'yyyy-MM-dd')
    };
}

/**
 * As faturas das UCs que entram no mês: por UC, a de leitura mais cedo dentro
 * do período. Fatura sem data de leitura só entra pelo mês de referência, e
 * só se a UC não tiver fatura com leitura no período.
 */
export function faturasDoPeriodo(faturas, { ini, fim, mesReferencia }) {
    const porUc = new Map();
    for (const f of faturas || []) {
        if (!f.data_leitura || f.data_leitura < ini || f.data_leitura > fim) continue;
        const atual = porUc.get(f.uc_id);
        if (!atual || f.data_leitura < atual.data_leitura) porUc.set(f.uc_id, f);
    }
    for (const f of faturas || []) {
        if (f.data_leitura || f.mes_referencia !== mesReferencia || porUc.has(f.uc_id)) continue;
        porUc.set(f.uc_id, f);
    }
    return [...porUc.values()];
}
