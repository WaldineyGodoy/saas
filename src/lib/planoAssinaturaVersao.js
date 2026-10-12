/**
 * Versão do plano de assinatura (spec 2026-10-06, seção 6, decisão 17).
 * O banco recusa mudar o que move dinheiro num plano com UC ou eletroposto
 * (fn_planos_assinatura_trava); a tela oferece então a nova versão
 * (fn_planos_assinatura_nova_versao) e, depois, mover as UCs em lote
 * (fn_planos_assinatura_mover_ucs).
 */

/** A recusa da trava sempre pede "nova versao". */
export const ehRecusaDeNovaVersao = (erro) => /nova vers[aã]o/i.test(String(erro?.message ?? ''));

export const textoConfirmaNovaVersao = (nome) =>
    `O plano "${nome}" já tem UC ou eletroposto vinculado e os números dele não mudam mais.\n\n` +
    'Salvar cria uma NOVA VERSÃO com estes valores. As UCs e eletropostos atuais continuam no plano antigo ' +
    '(somente contratos) até um admin movê-los em lote; os novos vão para a versão nova.\n\nContinuar?';

/** Versão antiga (somente contratos): não gera versão nova, só a ativa gera. */
export const AVISO_VERSAO_ANTIGA =
    'Esta é uma versão antiga (somente contratos), mantida para as UCs que ainda estão nela. ' +
    'Para mudar números, edite a versão ativa.';

/** Versão ativa no fim da cadeia substitui_plano_id que começa em `plano`. */
export const versaoSucessora = (planos, plano) => {
    let atual = plano;
    const vistos = new Set();
    for (;;) {
        if (!atual || vistos.has(atual.id)) return null;
        vistos.add(atual.id);
        const prox = planos.find(p => p.substitui_plano_id === atual.id);
        if (!prox) return atual.id === plano.id ? null : (atual.status === 'ativo' ? atual : null);
        atual = prox;
    }
};
