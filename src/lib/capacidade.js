/**
 * Regra de capacidade (franquia ocupada x geração) da usina.
 *
 * Cópia da regra do WorkSpace 2 (src/lib/capacidade.js, testada lá): a área do
 * investidor e este painel precisam mostrar o mesmo número. Se a regra mudar,
 * mude nos dois. Diferença: aqui 'desligado_por_tt' também devolve a franquia.
 */

/**
 * Franquia é capacidade contratada, então fica ocupada desde o vínculo —
 * inclusive enquanto a UC aguarda conexão, e inclusive com o assinante em atraso
 * (a UC segue conectada e compensando; quem está atrasado é o pagamento).
 * Só estes estados devolvem a capacidade para a usina.
 */
export const STATUS_LIBERAM_FRANQUIA = new Set([
    'desconectado', 'cancelado', 'cancelado_inadimplente', 'desligado_por_tt',
]);

export const ocupaFranquia = (uc) => !STATUS_LIBERAM_FRANQUIA.has(uc?.status);

const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * A UC geradora consome no próprio medidor; esse consumo sai da geração ANTES do
 * rateio (lado da oferta) e não entra no comprometido das beneficiárias.
 *
 * @returns {{ geracao: number|null, autoconsumoUG: number, disponivel: number|null,
 *   comprometido: number, livre: number|null, ocupacao: number|null }}
 *   livre < 0 é sobrecarga (overbook); ocupacao é null quando disponivel <= 0.
 */
export function calcularCapacidade({ ucs = [], geracao = null } = {}) {
    const ativas = (ucs || []).filter(ocupaFranquia);

    const autoconsumoUG = ativas
        .filter((uc) => uc.tipo_unidade === 'geradora')
        .reduce((acc, uc) => acc + numero(uc.franquia), 0);
    const comprometido = ativas
        .filter((uc) => uc.tipo_unidade !== 'geradora')
        .reduce((acc, uc) => acc + numero(uc.franquia), 0);

    const bruta = (geracao === null || geracao === undefined || geracao === ''
        || !Number.isFinite(Number(geracao)))
        ? null : Number(geracao);

    const disponivel = bruta === null ? null : bruta - autoconsumoUG;
    const livre = disponivel === null ? null : disponivel - comprometido;
    const ocupacao = (disponivel === null || disponivel <= 0)
        ? null : (comprometido / disponivel) * 100;

    return { geracao: bruta, autoconsumoUG, disponivel, comprometido, livre, ocupacao };
}

/**
 * Leitura de tela: Ocupado = consumo da UG + franquias das beneficiárias, para que
 * Ocupado + Disponível feche na geração estimada. A conta de livre é a mesma de
 * calcularCapacidade (a UG não é somada duas vezes).
 */
export function ocupacaoDaGeracao(cap) {
    const ocupado = cap.autoconsumoUG + cap.comprometido;
    const pct = cap.geracao > 0 ? (ocupado / cap.geracao) * 100 : (ocupado > 0 ? 100 : 0);
    return { ocupado, pct };
}
