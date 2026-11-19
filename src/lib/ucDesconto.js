/**
 * Desconto que o modal da UC grava em `consumer_units.desconto_assinante`.
 *
 * O sistema mantem na UC o MESMO desconto do plano dela: `fn_planos_assinatura_mover_ucs`,
 * a adesao publica (`fn_criar_assinante_publico`) e o aditivo (`fn_criar_uc_do_aditivo`)
 * gravam o desconto do plano junto com o plano. So o modal do CRM nao fazia:
 *
 *   - a busca por CEP preenche o campo com o desconto do MUNICIPIO (20% em Natal);
 *   - o campo "Desconto Herdado" mostra o desconto do PLANO, desabilitado;
 *   - e o salvar mandava o campo, nao o que a tela mostrava.
 *
 * Resultado (MULTI TV, 19/11/2026): tela dizendo 15% (Ultra Connect), UC gravada
 * com 20%, e o contrato, que le a UC, saindo com 20%. A cobranca tambem le a UC.
 */

const paraNumero = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

const descontoDoPlano = (planoId, planos) => {
    if (!planoId || !Array.isArray(planos)) return null;
    const n = paraNumero(planos.find((p) => p.id === planoId)?.desconto_assinante);
    return n !== null && n > 0 ? n : null;
};

/**
 * Com plano escolhido, vale o desconto do plano. Sem plano, ou com plano sem
 * desconto definido (ou fora da lista carregada), vale o campo, como antes:
 * nunca zera a UC por falta de dado.
 */
export function descontoParaGravar({ plano_assinatura_id, desconto_assinante }, planos) {
    const doPlano = descontoDoPlano(plano_assinatura_id, planos);
    return doPlano !== null ? doPlano : Number(desconto_assinante);
}

/** Texto para o campo ao escolher o plano ("15.00"), ou nulo para nao mexer nele. */
export function descontoDoPlanoParaCampo(planoId, planos) {
    const n = descontoDoPlano(planoId, planos);
    return n === null ? null : n.toFixed(2);
}
