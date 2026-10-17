/**
 * Status "pago + divergência" da conta de energia (concessionária).
 *
 * Caso real (17/10/2026): a B2W pagou uma conta, e depois a concessionária
 * reprocessou e passou a mostrar outro valor para a mesma referência. A conta
 * não está mais só "paga" nem só "inconsistente": os dois fatos valem.
 *
 *   inconsistente_pago  -> pago, mas o portal hoje mostra valor diferente
 *   contestada_pago     -> pago, e há contestação em andamento
 *
 * REGRA DE FILTRO (decisão do dono): cada um entra nos DOIS filtros dos quais
 * descende. "Inconsistente Pago" aparece ao filtrar Pago e ao filtrar
 * Inconsistente; "Contestado Pago" aparece ao filtrar Pago e ao filtrar
 * Contestada. Toda tela que filtra por status de conta deve passar por
 * `energyStatusMatchesFilter`, para a regra não divergir entre telas.
 *
 * `energy_bill_status` é texto livre, sem enum nem CHECK no banco.
 */

export const ENERGY_PAID_DIVERGENT = {
    inconsistente_pago: {
        base: 'inconsistente',
        label: 'Inconsistente Pago',
        color: '#9a3412',
        bg: '#fed7aa',
    },
    contestada_pago: {
        base: 'contestada',
        label: 'Contestado Pago',
        color: '#5b21b6',
        bg: '#ddd6fe',
    },
};

export const isEnergyPaidDivergent = (status) =>
    Object.prototype.hasOwnProperty.call(ENERGY_PAID_DIVERGENT, status);

/** Conta já paga, seja `pago` simples ou um dos status "pago + divergência". */
export const isEnergyBillPaid = (status) => status === 'pago' || isEnergyPaidDivergent(status);

/**
 * `resolved` é o status que a tela mostra (ou a coluna do kanban); `filterKey`
 * é o que o usuário escolheu no filtro. Vazio = sem filtro.
 */
export const energyStatusMatchesFilter = (resolved, filterKey) => {
    if (!filterKey) return true;
    if (resolved === filterKey) return true;
    if (filterKey === 'pago') return isEnergyPaidDivergent(resolved);
    const variant = ENERGY_PAID_DIVERGENT[resolved];
    return !!variant && variant.base === filterKey;
};
