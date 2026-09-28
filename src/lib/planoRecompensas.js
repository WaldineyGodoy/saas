// Matriz de comissao por cargo/nivel do Split de Pagamentos (decisao do dono,
// 27-28/09/2026). Percentuais relativos a quem recebe. Fonte unica dos
// defaults e da normalizacao gravada pela tela de Planos (PlanModal.jsx e
// EletropostoPlanModal.jsx) -- ver .superpowers/sdd/2026-09-27-split-de-pagamentos/
// task-9-brief.md e global-constraints.md.
//
// O mesmo formato ja foi aplicado nos 2 planos em producao pela migracao
// supabase/migrations/20260928a_plano_como_fonte.sql (Task 3).

// Cargos que recebem comissao configuravel pela tela (b2w e fixo/plataforma
// e nao entra nesta lista, mas participa de MATRIZ_PADRAO e MAX_NIVEIS).
export const CARGOS = ['lider', 'ppe', 'ppp', 'ppf', 'assinante_conect'];

// Todos os 6 cargos que existem em regras_multinivel / regras (inclui b2w).
const TODOS_OS_CARGOS = ['b2w', ...CARGOS];

const LEVEL_KEYS = ['L1', 'L2', 'L3', 'L4'];

// Chaves legadas de vocabulario antigo que nao podem mais ser gravadas
// (global-constraints.md): "Legacy keys ... must stop being written".
const CHAVES_LEGADAS = ['associacao', 'embaixador', 'coordenador', 'assinante'];

// Matriz padrao acordada com o dono (28/09/2026): ppe 5/2, ppp 4/2, ppf 2/2
// (max 2 todos); lider 1/1/1 (max 3); b2w 10 fixo em todos os niveis (max 4,
// nunca corta); assinante_conect 2 so no nivel 1 (max 1).
export const MATRIZ_PADRAO = {
    b2w: { L1: '10', L2: '10', L3: '10', L4: '10' },
    lider: { L1: '1', L2: '1', L3: '1', L4: '0' },
    ppe: { L1: '5', L2: '2', L3: '0', L4: '0' },
    ppp: { L1: '4', L2: '2', L3: '0', L4: '0' },
    ppf: { L1: '2', L2: '2', L3: '0', L4: '0' },
    assinante_conect: { L1: '2', L2: '0', L3: '0', L4: '0' }
};

// Quantidade padrao de niveis que cada cargo tem direito a receber.
export const MAX_NIVEIS = {
    b2w: 4,
    lider: 3,
    ppe: 2,
    ppp: 2,
    ppf: 2,
    assinante_conect: 1
};

const isNumeroValido = (v) => v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v));

/**
 * Normaliza a config multinivel de um cargo: completa niveis faltantes com o
 * default da matriz acordada, respeita valor ja salvo dentro do max_niveis
 * (mesmo que diferente do default, mesmo que zero), zera qualquer nivel
 * acima do max_niveis configurado, e NUNCA deixa o max_niveis salvo passar
 * do teto acordado para o cargo (fix round 1, F1: um max_niveis explicito
 * acima do teto -- ex.: ppe/ppp com 3 -- estava sendo aceito como estava,
 * permitindo L3 pago para cargos cujo teto e 2).
 */
function normalizarCargo(cargo, cfgCargo) {
    const cfg = cfgCargo || {};
    const maxNiveisSalvo = Number(cfg.max_niveis);
    const tetoDoCargo = MAX_NIVEIS[cargo] ?? 0;
    const maxNiveis = Math.min(
        Number.isFinite(maxNiveisSalvo) ? maxNiveisSalvo : tetoDoCargo,
        tetoDoCargo
    );
    const niveisSalvos = cfg.niveis || {};
    const defaultCargo = MATRIZ_PADRAO[cargo] || { L1: '0', L2: '0', L3: '0', L4: '0' };

    const niveis = {};
    LEVEL_KEYS.forEach((lk, idx) => {
        const levelIdx = idx + 1;
        const dentroDoLimite = levelIdx <= maxNiveis;

        if (!dentroDoLimite) {
            niveis[lk] = '0';
        } else if (isNumeroValido(niveisSalvos[lk])) {
            niveis[lk] = String(niveisSalvos[lk]);
        } else {
            niveis[lk] = defaultCargo[lk];
        }
    });

    return { max_niveis: maxNiveis, niveis };
}

/**
 * Normaliza regras_multinivel completo (todos os 6 cargos).
 */
export function normalizarRegrasMultinivel(regrasMultinivelAtual) {
    const atual = regrasMultinivelAtual || {};
    const resultado = {};
    TODOS_OS_CARGOS.forEach(cargo => {
        resultado[cargo] = normalizarCargo(cargo, atual[cargo]);
    });
    return resultado;
}

/**
 * Deriva o objeto `regras` (flat, legado por compatibilidade de leitura) a
 * partir do nivel 1 de regras_multinivel, somente com as 6 chaves modernas
 * -- nunca associacao/embaixador/coordenador/assinante.
 */
function derivarRegrasDoNivel1(regrasMultinivel) {
    const regras = {};
    TODOS_OS_CARGOS.forEach(cargo => {
        regras[cargo] = Number(regrasMultinivel[cargo]?.niveis?.L1) || 0;
    });
    return regras;
}

/**
 * Normaliza recorrente_config inteiro: recalcula regras_multinivel (defaults
 * da matriz acordada, respeitando o que ja estava dentro do max_niveis) e
 * regras (derivado do nivel 1), removendo qualquer chave legada. Demais
 * chaves do cfg (lastro_tarifario, vigencia_tipo, meses, ...) sao
 * preservadas como estavam.
 */
export function normalizarRecorrenteConfig(cfg) {
    const cfgAtual = cfg || {};
    const regras_multinivel = normalizarRegrasMultinivel(cfgAtual.regras_multinivel);
    const regras = derivarRegrasDoNivel1(regras_multinivel);

    return {
        ...cfgAtual,
        regras_multinivel,
        regras
    };
}

/**
 * Verifica se um cargo tem direito a receber em determinado nivel (L1..L4),
 * de acordo com o max_niveis efetivo configurado na tela -- sempre clampado
 * ao teto do cargo (MAX_NIVEIS), fonte unica. B2W (gestao/plataforma)
 * recebe em todos os niveis, sempre. Os demais cargos -- incluindo
 * assinante_conect -- recebem em L1..max_niveis, sem nenhum deslocamento
 * especial (fix round 1, F2: assinante_conect era tratado, no modal, como
 * se so recebesse a partir de L2, mas a matriz acordada paga em L1).
 */
export function nivelPermitidoParaCargo(cargo, levelKey, maxNiveisAtual) {
    if (cargo === 'b2w') return true;
    const levelIdx = LEVEL_KEYS.indexOf(levelKey) + 1;
    if (levelIdx <= 0) return false;
    const teto = Math.min(Number(maxNiveisAtual) || 0, MAX_NIVEIS[cargo] ?? 0);
    return levelIdx <= teto;
}

/**
 * Remove as chaves legadas de um objeto de regras flat (usado tambem em
 * start_config.regras.{1,2,3}, que tem o mesmo vocabulario de 6 chaves
 * modernas + 4 legadas).
 */
export function semChavesLegadas(regrasObj) {
    const out = { ...(regrasObj || {}) };
    CHAVES_LEGADAS.forEach(k => delete out[k]);
    return out;
}

export { CHAVES_LEGADAS };
