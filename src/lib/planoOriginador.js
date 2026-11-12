/**
 * Plano do Originador — contrato único da tela
 * (spec docs/superpowers/specs/2026-11-10-plano-originador-design.md).
 *
 * A remuneração dos parceiros (Líder, PPE, PPP, PPF) saiu do plano de
 * assinatura e mora em `planos_originador`. O banco é a fonte das regras
 * (motor em handle_invoice_paid_ledger, precedência em
 * fn_plano_originador_efetivo); este módulo garante que a seção de planos, o
 * modal do plano de assinatura e o modal do originador leiam e gravem o mesmo
 * formato.
 */
import { MATRIZ_PADRAO, MAX_NIVEIS } from './planoRecompensas';

/** Os únicos cargos que um Plano do Originador remunera. */
export const CARGOS_ORIGINADOR = ['lider', 'ppe', 'ppp', 'ppf'];

export const ROTULO_CARGO = {
    lider: 'Líder',
    ppe: 'PPE — Embaixador',
    ppp: 'PPP — Pro',
    ppf: 'PPF — Free'
};

// Revisão do dono em 12/11/2026: o Start passou a ter níveis (L1..L3), vale
// para as N primeiras faturas com compensação, e o Híbrido é SEQUENCIAL --
// Start nas N primeiras, recorrência só depois, nunca as duas na mesma fatura.
export const TIPOS_RECOMPENSA = [
    { valor: 'start', rotulo: 'Start', ajuda: 'Paga só nas N primeiras faturas com energia compensada.' },
    { valor: 'recorrente', rotulo: 'Recorrência', ajuda: 'Paga em toda fatura com energia compensada, enquanto o parceiro estiver ativo.' },
    { valor: 'ambos', rotulo: 'Híbrido', ajuda: 'Start nas N primeiras faturas; depois, recorrência. Nunca os dois na mesma fatura.' }
];

/** Níveis guardados no banco (L4 fica sempre 0 no Plano do Originador). */
export const NIVEIS = ['L1', 'L2', 'L3', 'L4'];
/** Níveis que a tela mostra e edita. */
export const NIVEIS_TELA = ['L1', 'L2', 'L3'];
/** Teto de níveis por cargo no Plano do Originador: todos até L3 (revisão de 12/11/2026). */
export const MAX_NIVEIS_ORIGINADOR = { lider: 3, ppe: 3, ppp: 3, ppf: 3 };

// Chaves que NÃO podem existir num Plano do Originador nem sobrar, para os
// parceiros, num plano de assinatura.
const CHAVES_LEGADAS = ['associacao', 'embaixador', 'coordenador', 'assinante'];
export const CHAVES_DE_PARCEIRO = [...CARGOS_ORIGINADOR, ...CHAVES_LEGADAS];

const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

/** Matriz de recorrência dos 4 cargos, completando o que faltar com o default acordado. */
export const matrizPadraoOriginador = () =>
    Object.fromEntries(CARGOS_ORIGINADOR.map(c => [c, {
        niveis: { ...MATRIZ_PADRAO[c] },
        max_niveis: MAX_NIVEIS[c]
    }]));

/** Matriz zerada (ponto de partida do Start). */
export const matrizZeradaOriginador = () =>
    Object.fromEntries(CARGOS_ORIGINADOR.map(c => [c, {
        niveis: { L1: '0', L2: '0', L3: '0', L4: '0' },
        max_niveis: MAX_NIVEIS_ORIGINADOR[c]
    }]));

export const PLANO_ORIGINADOR_VAZIO = {
    nome: '',
    descricao: '',
    status: 'ativo',
    padrao: false,
    tipo_recompensa: 'start',
    // Start: N primeiras faturas com compensação ([1..N]) + matriz cargo x nível.
    start_config: { faturas_elegiveis: [1], regras_multinivel: matrizZeradaOriginador() },
    recorrente_config: { regras_multinivel: matrizPadraoOriginador() }
};

/** Normaliza uma matriz cargo x nível: 4 cargos, teto L3, nível acima do máximo vira 0. */
const normalizarMatriz = (salva, padraoDoCargo) => {
    const matriz = {};
    for (const c of CARGOS_ORIGINADOR) {
        const salvo = (salva || {})[c] || {};
        const teto = MAX_NIVEIS_ORIGINADOR[c];
        const max = Math.max(0, Math.min(Number.isFinite(num(salvo.max_niveis)) ? num(salvo.max_niveis) : teto, teto));
        const niveis = {};
        NIVEIS.forEach((lk, i) => {
            const n = num(salvo.niveis?.[lk]);
            niveis[lk] = i + 1 > max ? '0' : String(Number.isFinite(n) ? n : Number(padraoDoCargo(c, lk)));
        });
        matriz[c] = { niveis, max_niveis: max };
    }
    return matriz;
};

/** Quantas faturas com compensação pagam o Start (N). */
export const quantidadeFaturasStart = (plano) => {
    const fats = plano?.start_config?.faturas_elegiveis || [];
    return fats.filter(n => Number.isInteger(Number(n)) && Number(n) >= 1).length;
};

/** N → [1, 2, ..., N]: "as N primeiras faturas com energia compensada". */
export const faturasDoStart = (n) => {
    const q = Math.max(0, Math.trunc(Number(n) || 0));
    return Array.from({ length: q }, (_, i) => i + 1);
};

/**
 * Deixa o plano no formato exato que o banco aceita.
 * Start: { faturas_elegiveis: [1..N], regras_multinivel: matriz }. O formato
 * antigo (regras por fatura, só nível 1) é convertido: o % da primeira fatura
 * elegível vira o L1 de cada cargo.
 */
export const normalizarPlanoOriginador = (plano) => {
    const p = plano || {};
    const sc = p.start_config || {};

    let matrizStart = sc.regras_multinivel;
    if (!matrizStart && sc.regras && typeof sc.regras === 'object') {
        const primeira = Object.keys(sc.regras).map(Number).filter(Number.isFinite).sort((a, b) => a - b)[0];
        const doOrdinal = primeira ? sc.regras[String(primeira)] || {} : {};
        matrizStart = Object.fromEntries(CARGOS_ORIGINADOR.map(c => {
            const n = num(doOrdinal[c]);
            return [c, { niveis: { L1: String(Number.isFinite(n) ? n : 0), L2: '0', L3: '0', L4: '0' }, max_niveis: 1 }];
        }));
    }

    return {
        ...p,
        nome: String(p.nome ?? '').trim(),
        descricao: String(p.descricao ?? '').trim() || null,
        status: p.status === 'inativo' ? 'inativo' : 'ativo',
        tipo_recompensa: TIPOS_RECOMPENSA.some(t => t.valor === p.tipo_recompensa) ? p.tipo_recompensa : 'start',
        start_config: {
            faturas_elegiveis: faturasDoStart(quantidadeFaturasStart(p)),
            regras_multinivel: normalizarMatriz(matrizStart, () => 0)
        },
        recorrente_config: {
            regras_multinivel: normalizarMatriz(p.recorrente_config?.regras_multinivel, (c, lk) => MATRIZ_PADRAO[c]?.[lk] ?? 0)
        }
    };
};

/** Erros em português, prontos para a tela; lista vazia = pode gravar. */
export const validarPlanoOriginador = (dados) => {
    const erros = [];
    const p = normalizarPlanoOriginador(dados);
    if (!p.nome) erros.push('Informe o nome do plano.');
    if (p.padrao && p.status !== 'ativo') erros.push('O Plano Padrão não pode ficar inativo.');

    const usaStart = p.tipo_recompensa !== 'recorrente';
    if (usaStart && p.start_config.faturas_elegiveis.length === 0) {
        erros.push('Informe em quantas faturas com energia compensada o Start é pago (1 ou mais).');
    }
    const confere = (matriz, rotulo) => {
        for (const c of CARGOS_ORIGINADOR) {
            for (const lk of NIVEIS_TELA) {
                const n = Number(matriz[c].niveis[lk]);
                if (!Number.isFinite(n) || n < 0 || n > 100) erros.push(`${rotulo}, ${ROTULO_CARGO[c]} ${lk}: entre 0 e 100%.`);
            }
        }
    };
    if (usaStart) confere(p.start_config.regras_multinivel, 'Start');
    if (p.tipo_recompensa !== 'start') confere(p.recorrente_config.regras_multinivel, 'Recorrência');
    return erros;
};

/** O que vai para o banco (INSERT/UPDATE). `padrao` não é gravado pela tela. */
export const payloadPlanoOriginador = (dados) => {
    const p = normalizarPlanoOriginador(dados);
    return {
        nome: p.nome,
        descricao: p.descricao,
        status: p.status,
        tipo_recompensa: p.tipo_recompensa,
        start_config: p.start_config,
        recorrente_config: p.recorrente_config
    };
};

/** "2" ou "1, 2" → [1, 2]; vazio → []; qualquer coisa que não seja inteiro ≥ 1 → null. */
export const lerFaturasElegiveis = (texto) => {
    const partes = String(texto ?? '').split(/[,;\s]+/).filter(Boolean);
    const nums = partes.map(Number);
    if (nums.some(n => !Number.isInteger(n) || n < 1)) return null;
    return [...new Set(nums)].sort((a, b) => a - b);
};

export const listarPlanosOriginador = async (supabase) => {
    const { data, error } = await supabase
        .from('planos_originador')
        .select('*')
        .order('padrao', { ascending: false })
        .order('nome');
    if (error) throw error;
    return data || [];
};

export const planoPadraoDe = (planos) => (planos || []).find(p => p.padrao) || null;

/**
 * Espelho de fn_plano_originador_efetivo (precedência "exceção do originador
 * vence"), para a tela explicar de onde vem a regra. O banco é quem decide.
 */
export const planoEfetivo = ({ planos, planoDoOriginadorId, planoDoAssinanteId }) => {
    const porId = (id) => (planos || []).find(p => p.id === id) || null;
    const padrao = planoPadraoDe(planos);
    const doOriginador = porId(planoDoOriginadorId);
    if (doOriginador && !doOriginador.padrao) return { plano: doOriginador, origem: 'originador' };
    const doAssinante = porId(planoDoAssinanteId);
    if (doAssinante) return { plano: doAssinante, origem: 'plano_assinatura' };
    return { plano: padrao, origem: 'padrao' };
};

export const ROTULO_ORIGEM = {
    originador: 'exceção do originador',
    plano_assinatura: 'herdado do plano de assinatura',
    padrao: 'Plano Padrão'
};

/** "L1 50% · L2 10% · L3 5%" para um cargo (só os níveis liberados). */
export const niveisDoCargo = (matriz, cargo) => {
    const linha = matriz?.[cargo];
    if (!linha || !linha.max_niveis) return '0%';
    return NIVEIS_TELA.slice(0, linha.max_niveis).map(lk => `${lk} ${linha.niveis[lk]}%`).join(' · ');
};

/**
 * Resumo de uma linha para selects e listas, ex.:
 * "Start nas 2 primeiras faturas (L1 50% · L2 10%) · depois recorrência (L1 4%)".
 */
export const resumoPlanoOriginador = (plano, cargo) => {
    if (!plano) return '—';
    const p = normalizarPlanoOriginador(plano);
    const n = p.start_config.faturas_elegiveis.length;
    const partes = [];
    if (p.tipo_recompensa !== 'recorrente' && n) {
        const qtd = n === 1 ? 'na 1ª fatura' : `nas ${n} primeiras faturas`;
        partes.push(`Start ${qtd}${cargo ? ` (${niveisDoCargo(p.start_config.regras_multinivel, cargo)})` : ''}`);
    }
    if (p.tipo_recompensa !== 'start') {
        const prefixo = p.tipo_recompensa === 'ambos' ? 'depois recorrência' : 'Recorrência';
        partes.push(`${prefixo}${cargo ? ` (${niveisDoCargo(p.recorrente_config.regras_multinivel, cargo)})` : ''}`);
    }
    return partes.join(' · ') || 'Sem remuneração';
};

/**
 * Remove de um plano de assinatura tudo o que é remuneração de parceiro
 * (decisão 2). Usado pelo PlanModal ao gravar. NÃO usar em plano de
 * eletroposto, que continua com os cargos próprios.
 */
export const semCargosDeParceiro = (planoAssinatura) => {
    const p = { ...(planoAssinatura || {}) };
    const limpa = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !CHAVES_DE_PARCEIRO.includes(k)));
    if (p.start_config) {
        p.start_config = {
            ...p.start_config,
            regras: Object.fromEntries(Object.entries(p.start_config.regras || {}).map(([ord, r]) => [ord, limpa(r)]))
        };
    }
    if (p.recorrente_config) {
        p.recorrente_config = {
            ...p.recorrente_config,
            ...(p.recorrente_config.regras_multinivel ? { regras_multinivel: limpa(p.recorrente_config.regras_multinivel) } : {}),
            ...(p.recorrente_config.regras ? { regras: limpa(p.recorrente_config.regras) } : {})
        };
    }
    return p;
};

/**
 * Erro do Supabase de tabela/coluna ainda inexistente (migração não aplicada):
 * 42P01 (Postgres), PGRST205/PGRST200 (cache do PostgREST) ou a mensagem.
 */
export const tabelaPlanoOriginadorAusente = (err) => {
    if (!err) return false;
    if (['42P01', 'PGRST205', 'PGRST200'].includes(err.code)) return true;
    const msg = String(err.message || '').toLowerCase();
    return msg.includes('planos_originador') && (msg.includes('does not exist') || msg.includes('could not find'));
};

/** Erro do Supabase ao gravar/excluir um Plano do Originador, em português. */
export const mensagemErroPlanoOriginador = (err) => {
    if (!err) return 'Erro desconhecido.';
    if (tabelaPlanoOriginadorAusente(err)) return 'A tabela de Planos do Originador ainda não foi criada no banco.';
    if (err.code === '23503') return 'Este plano está em uso por originadores ou planos de assinatura e não pode ser excluído.';
    if (err.code === '42501') return 'Só administradores podem alterar Planos do Originador.';
    if (err.code === '23514') return 'Algum valor está fora do permitido pelo banco. Confira status, tipo de recompensa e percentuais.';
    return err.message || 'Erro desconhecido.';
};

/**
 * Como `tabelaPlanoOriginadorAusente`, mas cobre também a coluna
 * `plano_originador_id` ainda inexistente em `originators_v2` (42703 no
 * Postgres, PGRST204 no PostgREST ao gravar). As telas do originador mostram
 * um aviso discreto no lugar do plano e deixam de enviar a coluna, em vez de
 * quebrar. Acrescentado pelo cadastro do originador (Agente D).
 */
export const planoOriginadorAusente = (error) => {
    if (!error) return false;
    if (tabelaPlanoOriginadorAusente(error)) return true;
    const msg = String(`${error.message || ''} ${error.details || ''}`).toLowerCase();
    return ['42703', 'PGRST204'].includes(error.code)
        ? msg.includes('plano_originador_id') || !msg.trim()
        : msg.includes('plano_originador_id') && (msg.includes('does not exist') || msg.includes('could not find'));
};
