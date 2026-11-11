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

export const TIPOS_RECOMPENSA = [
    { valor: 'start', rotulo: 'Só Bônus Start' },
    { valor: 'recorrente', rotulo: 'Só recorrência' },
    { valor: 'ambos', rotulo: 'Start + recorrência' }
];

export const NIVEIS = ['L1', 'L2', 'L3', 'L4'];

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

export const PLANO_ORIGINADOR_VAZIO = {
    nome: '',
    descricao: '',
    status: 'ativo',
    padrao: false,
    tipo_recompensa: 'start',
    start_config: { faturas_elegiveis: [], regras: {} },
    recorrente_config: { regras_multinivel: matrizPadraoOriginador() }
};

/** Deixa o plano no formato exato que o banco aceita: só os 4 cargos, ordinais inteiros ≥ 1. */
export const normalizarPlanoOriginador = (plano) => {
    const p = plano || {};
    const elegiveis = [...new Set((p.start_config?.faturas_elegiveis || [])
        .map(Number).filter(n => Number.isInteger(n) && n >= 1))].sort((a, b) => a - b);

    const regras = {};
    for (const ord of elegiveis) {
        const doOrdinal = p.start_config?.regras?.[String(ord)] || {};
        regras[String(ord)] = Object.fromEntries(CARGOS_ORIGINADOR.map(c => {
            const n = num(doOrdinal[c]);
            return [c, Number.isFinite(n) ? n : 0];
        }));
    }

    const matrizSalva = p.recorrente_config?.regras_multinivel || {};
    const regras_multinivel = {};
    for (const c of CARGOS_ORIGINADOR) {
        const salvo = matrizSalva[c] || {};
        const teto = MAX_NIVEIS[c];
        const max = Math.min(Number.isFinite(num(salvo.max_niveis)) ? num(salvo.max_niveis) : teto, teto);
        const niveis = {};
        NIVEIS.forEach((lk, i) => {
            const n = num(salvo.niveis?.[lk]);
            niveis[lk] = i + 1 > max ? '0' : String(Number.isFinite(n) ? n : Number(MATRIZ_PADRAO[c][lk]));
        });
        regras_multinivel[c] = { niveis, max_niveis: max };
    }

    return {
        ...p,
        nome: String(p.nome ?? '').trim(),
        descricao: String(p.descricao ?? '').trim() || null,
        status: p.status === 'inativo' ? 'inativo' : 'ativo',
        tipo_recompensa: TIPOS_RECOMPENSA.some(t => t.valor === p.tipo_recompensa) ? p.tipo_recompensa : 'start',
        start_config: { faturas_elegiveis: elegiveis, regras },
        recorrente_config: { regras_multinivel }
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
        erros.push('Informe em quais faturas (com compensação) o Bônus Start é pago, como 1 ou 1, 2.');
    }
    for (const [ord, porCargo] of Object.entries(p.start_config.regras)) {
        for (const c of CARGOS_ORIGINADOR) {
            const n = Number(porCargo[c]);
            if (n < 0 || n > 100) erros.push(`Start, fatura ${ord}, ${ROTULO_CARGO[c]}: entre 0 e 100%.`);
        }
    }
    for (const c of CARGOS_ORIGINADOR) {
        for (const lk of NIVEIS) {
            const n = Number(p.recorrente_config.regras_multinivel[c].niveis[lk]);
            if (!Number.isFinite(n) || n < 0 || n > 100) erros.push(`Recorrência, ${ROTULO_CARGO[c]} ${lk}: entre 0 e 100%.`);
        }
    }
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

/** Resumo de uma linha para selects e listas, ex.: "Start nas faturas 1 e 2 · PPF 50%". */
export const resumoPlanoOriginador = (plano, cargo) => {
    if (!plano) return '—';
    const p = normalizarPlanoOriginador(plano);
    const partes = [];
    if (p.tipo_recompensa !== 'recorrente' && p.start_config.faturas_elegiveis.length) {
        const fats = p.start_config.faturas_elegiveis;
        const lista = fats.length === 1 ? `fatura ${fats[0]}` : `faturas ${fats.slice(0, -1).join(', ')} e ${fats.at(-1)}`;
        const pcts = cargo
            ? fats.map(f => `${p.start_config.regras[String(f)]?.[cargo] ?? 0}%`).join(' / ')
            : null;
        partes.push(`Start na ${lista}${pcts ? ` (${pcts})` : ''}`);
    }
    if (p.tipo_recompensa !== 'start') {
        const linha = cargo ? p.recorrente_config.regras_multinivel[cargo] : null;
        partes.push(linha
            ? `Recorrência ${NIVEIS.slice(0, linha.max_niveis).map(lk => `${linha.niveis[lk]}%`).join('/') || '0%'}`
            : 'Recorrência');
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
