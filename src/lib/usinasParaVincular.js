import { calcularCapacidade, capacidadeMensal } from './capacidade.js';

/**
 * Quais usinas oferecer ao vincular uma UC, e em que ordem.
 *
 * Só usina que está recebendo ou prestes a receber energia serve de destino:
 * Em Conexão e Gerando. Pré-operação ainda é obra, e manutenção, inativa e
 * cancelada não geram.
 */
export const STATUS_USINA_VINCULAVEL = ['em_conexao', 'gerando'];

const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Lista as usinas vinculáveis com a energia disponível de cada uma, ordenadas
 * pela franquia da UC:
 *
 *  1. as que COMPORTAM a franquia (disponível >= franquia), da que sobra menos
 *     para a que sobra mais — encaixa a UC na usina mais justa e deixa as
 *     folgadas para as UCs grandes;
 *  2. as que NÃO comportam, da mais próxima da franquia para a mais distante;
 *  3. as sem geração estimada (não há como medir), por nome.
 *
 * O disponível é o `livre` de `calcularCapacidade` — a mesma regra do painel da
 * usina: geração estimada menos o consumo da UG e menos as franquias das
 * beneficiárias que ocupam. Pode ser negativo (overbook); a tela decide como
 * mostrar, a ordenação usa o valor real.
 *
 * @param {object} p
 * @param {Array} p.usinas     usinas com id, name, status e geracao_estimada_kwh
 * @param {Array} p.ucs        UCs vinculadas a alguma usina (usina_id, status, tipo_unidade, franquia)
 * @param {number|string} p.franquia  franquia da UC que está sendo vinculada
 * @param {string} [p.ucAtualId]      a própria UC, se já existe: sua franquia não conta
 *                                    contra a usina onde ela já está
 * @param {Object} [p.geracaoMensal]  {usinaId: {"01":kwh,...}} da fn_geracao_estimada_mensal;
 *                                    sem ele a geração do ano é plana (os 12 meses iguais)
 * @returns {Array<object>} cada usina com `disponivel` (kWh ou null), `comporta` (bool ou null)
 *   e o retrato do ano: `menorMes` / `maiorMes` ({mes, rotulo, livre}) e `mediaLivre` — a
 *   energia livre mês a mês (geração estimada − consumo da UG − franquias que ocupam).
 *   `menorMes.livre` negativo é overbook naquele mês. Tudo null sem geração estimada.
 */
export function usinasParaVincular({ usinas = [], ucs = [], franquia = 0, ucAtualId = null, geracaoMensal = {} } = {}) {
    const alvo = numero(franquia);
    const porUsina = new Map();
    for (const uc of ucs || []) {
        if (!uc?.usina_id || (ucAtualId && uc.id === ucAtualId)) continue;
        if (!porUsina.has(uc.usina_id)) porUsina.set(uc.usina_id, []);
        porUsina.get(uc.usina_id).push(uc);
    }

    const lista = (usinas || [])
        .filter((u) => STATUS_USINA_VINCULAVEL.includes(u?.status))
        .map((u) => {
            const bruta = u.geracao_estimada_kwh;
            const mensuravel = bruta !== null && bruta !== undefined && bruta !== ''
                && Number.isFinite(Number(bruta));
            const { livre } = calcularCapacidade({ ucs: porUsina.get(u.id) || [], geracao: mensuravel ? bruta : null });
            const disponivel = mensuravel ? livre : null;
            const ano = mensuravel
                ? capacidadeMensal(u, porUsina.get(u.id) || [], geracaoMensal?.[u.id] ?? null)
                    .filter((l) => l.livre !== null)
                : [];
            const extremo = (a, b) => (b.livre < a.livre ? b : a);
            const menor = ano.length ? ano.reduce(extremo) : null;
            const maior = ano.length ? ano.reduce((a, b) => (b.livre > a.livre ? b : a)) : null;
            const pick = (l) => (l ? { mes: l.mes, rotulo: l.rotulo, livre: l.livre } : null);
            return {
                ...u,
                disponivel,
                comporta: disponivel === null ? null : disponivel >= alvo,
                menorMes: pick(menor),
                maiorMes: pick(maior),
                mediaLivre: ano.length ? ano.reduce((acc, l) => acc + l.livre, 0) / ano.length : null,
            };
        });

    const nome = (u) => String(u.name || '');
    const porNome = (a, b) => nome(a).localeCompare(nome(b), 'pt-BR');

    return lista.sort((a, b) => {
        const faixa = (u) => (u.comporta === null ? 2 : u.comporta ? 0 : 1);
        if (faixa(a) !== faixa(b)) return faixa(a) - faixa(b);
        if (faixa(a) === 0 && a.disponivel !== b.disponivel) return a.disponivel - b.disponivel;
        if (faixa(a) === 1 && a.disponivel !== b.disponivel) return b.disponivel - a.disponivel;
        return porNome(a, b);
    });
}
