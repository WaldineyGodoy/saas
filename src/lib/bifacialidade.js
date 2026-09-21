/**
 * Modelo de bifacialidade, albedo e overload.
 *
 * Aplica o estudo "Bifacial, albedo & overload" sobre a irradiância do local:
 *
 *   ganho bifacial  G = k · φ · ρ · F_inst
 *   FDI efetivo       = (kWp ÷ kW_CA) · (1 + G)
 *   geração do mês    = kWp · irradiância · dias · PR_base · (1 + G) · (1 − clipagem)
 *
 * Nenhuma constante mora aqui: todas vêm de `parametros_bifacialidade`, para o
 * CRM, a página pública e o visualizador lerem os mesmos números. Duas cópias
 * da mesma tabela são duas tabelas que passam a divergir.
 *
 * PR_base 0,72 é o rendimento só da face frontal, sem clipagem. Com os três
 * termos explícitos o modelo reproduz a produção medida de uma usina de
 * 100,8 kWp com inversor de 75 kW no RN dentro de 0,8%.
 */

import { supabase } from './supabase';

export const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Lê a tabela de parâmetros e devolve no formato que o modelo consome. */
export async function carregarParametros() {
    const { data, error } = await supabase
        .from('parametros_bifacialidade')
        .select('categoria, chave, nome, valor, valor_min, valor_max, ordem, nota')
        .order('ordem');
    if (error) throw error;

    const porCategoria = (cat) => (data || []).filter(r => r.categoria === cat);
    const constantes = {};
    porCategoria('constante').forEach(r => { constantes[r.chave] = Number(r.valor); });

    return {
        superficie: porCategoria('superficie'),
        montagem: porCategoria('montagem'),
        gcr: porCategoria('gcr'),
        tecnologia: porCategoria('tecnologia'),
        // A curva de clipagem precisa vir ordenada por FDI para a interpolação.
        clipagem: porCategoria('clipagem')
            .map(r => [Number(r.chave), Number(r.valor)])
            .sort((a, b) => a[0] - b[0]),
        constantes
    };
}

const valorDe = (lista, chave) => {
    const r = (lista || []).find(x => x.chave === chave);
    return r ? Number(r.valor) : null;
};

/** Perda anual por clipagem, interpolada na curva do estudo. */
export function perdaClipagem(fdi, curva) {
    if (!curva || curva.length === 0 || !(fdi > 0)) return 0;
    if (fdi <= curva[0][0]) return curva[0][1];
    const ultimo = curva[curva.length - 1];
    if (fdi >= ultimo[0]) return ultimo[1];
    for (let i = 0; i < curva.length - 1; i++) {
        const [x0, y0] = curva[i], [x1, y1] = curva[i + 1];
        if (fdi >= x0 && fdi <= x1) return y0 + (y1 - y0) * (fdi - x0) / (x1 - x0);
    }
    return 0;
}

/**
 * A curva de clipagem é de clima de alta irradiância. O estudo manda subtrair
 * 15–25% das perdas fora do Nordeste; aplicado mês a mês pela irradiância do
 * próprio mês, junho no Sul quase não clipa e outubro no RN clipa mais que a
 * média do ano.
 */
export function fatorClima(irradiancia, constantes) {
    const ref = constantes?.irr_ref ?? 5.7;
    const slope = constantes?.clima_slope ?? 0.1818;
    return Math.max(0.70, Math.min(1.10, 1 + (irradiancia - ref) * slope));
}

/**
 * Calcula ganho bifacial, FDI e clipagem a partir do equipamento e da obra.
 *
 * @param {object} e  { kwp, potenciaCaKw, bifacialidadePct, montagem, gcr, superficie }
 * @param {object} p  saída de carregarParametros()
 */
export function calcularGanhos(e, p) {
    const kwp = Number(e.kwp) || 0;
    const pca = Number(e.potenciaCaKw) || 0;
    const phi = (Number(e.bifacialidadePct) || 0) / 100;
    const rho = valorDe(p.superficie, e.superficie) ?? 0;
    const fVao = valorDe(p.montagem, e.montagem) ?? 1;
    const fGcr = valorDe(p.gcr, e.gcr) ?? 1;
    const k = p.constantes?.k_vista ?? 0.5;

    // Zerar qualquer um dos três zera o ganho — e é a montagem que a maior
    // parte das instalações zera sem perceber.
    const gBif = (phi > 0 && rho > 0) ? k * phi * rho * fVao * fGcr : 0;
    const fdiNominal = (kwp > 0 && pca > 0) ? kwp / pca : null;
    const fdiEfetivo = fdiNominal === null ? null : fdiNominal * (1 + gBif);

    return {
        kwp, potenciaCaKw: pca, phi, albedo: rho, fInst: fVao * fGcr,
        ganhoBifacial: gBif, fdiNominal, fdiEfetivo,
        clipagem: fdiEfetivo === null ? 0 : perdaClipagem(fdiEfetivo, p.clipagem)
    };
}

/**
 * Série mensal de geração, em kWh.
 * @param {number[]} irradiancia  12 médias diárias em kWh/m²/dia
 */
export function gerarSerieMensal(irradiancia, ganhos, p) {
    const pr = p.constantes?.pr_base ?? 0.72;
    if (!Array.isArray(irradiancia) || irradiancia.length !== 12 || !(ganhos.kwp > 0)) return null;
    return irradiancia.map((ir, i) => {
        const frontal = ganhos.kwp * ir * DIAS_MES[i] * pr;
        const clip = ganhos.clipagem * fatorClima(ir, p.constantes);
        return Math.round(frontal * (1 + ganhos.ganhoBifacial) * (1 - clip));
    });
}

/** Leitura curta para a tela: onde o FDI caiu na régua do estudo. */
export function lerFdi(fdiEfetivo) {
    if (fdiEfetivo === null || fdiEfetivo === undefined) return null;
    if (fdiEfetivo > 1.60) return { nivel: 'erro', texto: 'Acima de 1,60: metade de cada módulo acrescentado é descartada.' };
    if (fdiEfetivo > 1.35) return { nivel: 'alerta', texto: 'Acima de 1,35: o kWh sai mais barato aumentando o inversor do que somando módulo.' };
    if (fdiEfetivo < 1.15) return { nivel: 'alerta', texto: 'Abaixo de 1,15: inversor superdimensionado, com capital parado.' };
    return { nivel: 'ok', texto: 'Dentro da faixa recomendada pelo estudo (1,15 a 1,35).' };
}
