/**
 * Período de compensação das UCs beneficiárias no extrato da usina, pela
 * regra do repasse (dono, 10/09/2026 e 10/11/2026).
 *
 * M é o mês de referência da conta da UG. A energia injetada em M compensa
 * nas UCs que leem DEPOIS da leitura da UG, até o fim de M+1. Exemplo da BJI
 * em setembro/2026: UG lida em 14/09, UCs lidas de 15/09 a 31/10.
 *
 * A janela de dois meses cruza a do mês seguinte (outubro começa em 15/10).
 * Para não contar a mesma UC duas vezes, cada UC entra só com a PRIMEIRA
 * leitura depois da leitura da UG: a UC lida em 17/09 e em 17/10 entra em
 * setembro com 17/09, e a de 17/10 fica para outubro.
 */
import { addDays, addMonths, endOfMonth, format, parseISO } from 'date-fns';

/**
 * @param {string} ugDataLeitura  leitura da UG no mês M (yyyy-MM-dd)
 * @param {string} mesReferencia  primeiro dia de M (yyyy-MM-01)
 * @returns {{ ini: string, fim: string }}
 */
export function periodoLeituraUcs(ugDataLeitura, mesReferencia) {
    return {
        ini: format(addDays(parseISO(ugDataLeitura), 1), 'yyyy-MM-dd'),
        fim: format(endOfMonth(addMonths(parseISO(mesReferencia), 1)), 'yyyy-MM-dd')
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
