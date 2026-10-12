/**
 * Plano de Usina — o que a tela precisa saber dos campos de `planos_usina`
 * (spec docs/superpowers/specs/2026-10-06-plano-usina-design.md).
 *
 * O banco é a fonte das regras (trava de versão em fn_planos_usina_trava,
 * vínculo em fn_usinas_vinculo_plano_usina). Este módulo só garante que a
 * tela de planos, o modal da usina e os dois contratos usem a mesma lista
 * de campos.
 *
 * Desde 10/10/2026 o plano de usina não aponta para plano de assinatura: as
 * recompensas de quem está ligado ao assinante vêm do plano da UC.
 */

// `contrato` é a chave de DEFAULTS_USINA (src/lib/contratosUsina.js) que o
// gerador do contrato de compra e venda lê; `gestao` é a chave de
// DEFAULTS_FORNECEDOR (src/lib/contratoFornecedor.js) que o Contrato de
// Gestão de Créditos lê. null = o campo não vai para aquele contrato.
export const CAMPOS_PLANO_USINA = [
    { chave: 'percentual_recorrente', rotulo: 'Remuneração recorrente — gestão B2W (%)', contrato: 'percentualRecorrente', gestao: 'percentualRecorrente', max: 100 },
    { chave: 'taxa_admin_reais', rotulo: 'Taxa de administração (R$ por consumidor ativo/mês)', contrato: 'taxaAdmin', gestao: 'taxaAdmin', max: null },
    { chave: 'taxa_recuperacao_pct', rotulo: 'Taxa de recuperação de crédito (%)', contrato: 'taxaRecuperacao', gestao: 'taxaRecuperacao', max: 100 },
    { chave: 'retencao_rescisao_pct', rotulo: 'Retenção / multa de rescisão (%)', contrato: 'retencaoRescisao', gestao: null, max: 100 },
    { chave: 'multa_atraso_mes_pct', rotulo: 'Multa de atraso (% ao mês)', contrato: 'multaAtrasoMes', gestao: null, max: null },
    { chave: 'multa_atraso_teto_pct', rotulo: 'Teto da multa de atraso (%)', contrato: 'multaAtrasoTeto', gestao: null, max: null },
    { chave: 'garantia_instalacao_meses', rotulo: 'Garantia da instalação (meses)', contrato: 'garantiaInstalacaoMeses', gestao: null, max: null, inteiro: true },
    { chave: 'desconto_pct', rotulo: 'Desconto ao consumidor (%) — contrato de gestão', contrato: null, gestao: 'desconto', max: 100 },
    { chave: 'dia_corte', rotulo: 'Dia de corte', contrato: null, gestao: 'diaCorte', min: 1, max: 31, inteiro: true },
    { chave: 'dia_repasse', rotulo: 'Dia do repasse', contrato: null, gestao: 'diaRepasse', min: 1, max: 31, inteiro: true },
    { chave: 'prazo_transferencia_dias', rotulo: 'Prazo de transferência (dias)', contrato: null, gestao: 'prazoTransferencia', max: null, inteiro: true },
    { chave: 'prazo_honorarios_dias', rotulo: 'Prazo de honorários (dias)', contrato: null, gestao: 'prazoHonorarios', max: null, inteiro: true },
    { chave: 'originador_recorrente_pct', rotulo: 'Originador da usina — recorrente (%)', contrato: null, gestao: null, max: 100 },
    { chave: 'originador_lider_recorrente_pct', rotulo: 'Líder do originador — recorrente (%)', contrato: null, gestao: null, max: 100 }
];

export const CHAVES_CONTRATO_DO_PLANO = CAMPOS_PLANO_USINA.filter(c => c.contrato).map(c => c.contrato);
export const CHAVES_GESTAO_DO_PLANO = CAMPOS_PLANO_USINA.filter(c => c.gestao).map(c => c.gestao);

// Espelho de fn_planos_usina_trava: o que o banco recusa mudar quando o plano
// já tem usina vinculada.
export const CAMPOS_TRAVADOS = [
    ...CAMPOS_PLANO_USINA.map(c => c.chave),
    'originador_bonus_fechamentos'
];

// Mesmos defaults da migração 20261006e (DEFAULTS_USINA e DEFAULTS_FORNECEDOR).
export const PLANO_USINA_VAZIO = {
    nome: '',
    descricao: '',
    percentual_recorrente: 10,
    taxa_admin_reais: 10,
    taxa_recuperacao_pct: 8,
    retencao_rescisao_pct: 10,
    multa_atraso_mes_pct: 0.5,
    multa_atraso_teto_pct: 10,
    garantia_instalacao_meses: 12,
    desconto_pct: 20,
    dia_corte: 5,
    dia_repasse: 15,
    prazo_transferencia_dias: 90,
    prazo_honorarios_dias: 180,
    originador_recorrente_pct: 0,
    originador_lider_recorrente_pct: 0,
    originador_bonus_fechamentos: []
};

const vazio = (v) => v === null || v === undefined || v === '';

const termosPara = (plano, destino) => {
    if (!plano) return {};
    const termos = {};
    for (const c of CAMPOS_PLANO_USINA) {
        if (!c[destino] || vazio(plano[c.chave])) continue;
        const n = Number(plano[c.chave]);
        if (Number.isFinite(n)) termos[c[destino]] = n;
    }
    return termos;
};

/** Colunas do plano → chaves que o gerador do contrato de compra e venda lê. */
export const termosContratoDoPlano = (plano) => termosPara(plano, 'contrato');

/** Colunas do plano → chaves do Contrato de Gestão de Créditos (DEFAULTS_FORNECEDOR). */
export const termosGestaoDoPlano = (plano) => termosPara(plano, 'gestao');

/** "2" ou "2, 3" → [2, 3]; vazio → []; qualquer coisa que não seja inteiro positivo → null. */
export const lerFechamentos = (texto) => {
    const partes = String(texto ?? '').split(/[,;\s]+/).filter(Boolean);
    const nums = partes.map(Number);
    if (nums.some(n => !Number.isInteger(n) || n <= 0)) return null;
    return [...new Set(nums)].sort((a, b) => a - b);
};

/** Erros em português, prontos para a tela; lista vazia = pode gravar. */
export const validarPlanoUsina = (dados) => {
    const erros = [];
    if (!String(dados.nome ?? '').trim()) erros.push('Informe o nome do plano.');
    for (const c of CAMPOS_PLANO_USINA) {
        const bruto = dados[c.chave];
        const n = Number(bruto);
        const minimo = c.min ?? 0;
        if (vazio(bruto) || !Number.isFinite(n) || n < minimo) {
            erros.push(`${c.rotulo}: informe um número maior ou igual a ${minimo}.`);
        } else if (c.max !== null && n > c.max) {
            erros.push(`${c.rotulo}: no máximo ${c.max}.`);
        } else if (c.inteiro && !Number.isInteger(n)) {
            erros.push(`${c.rotulo}: use um número inteiro.`);
        }
    }
    if (!Array.isArray(dados.originador_bonus_fechamentos)) {
        erros.push('Bônus do originador: use números de fechamento separados por vírgula, como 2 ou 2, 3.');
    }
    return erros;
};

/** Ponto de partida da tela "Criar nova versão". */
export const rascunhoNovaVersao = (plano) => ({
    ...Object.fromEntries(Object.keys(PLANO_USINA_VAZIO).map(k => [k, plano[k] ?? PLANO_USINA_VAZIO[k]])),
    nome: `${plano.nome} (nova versão)`
});

/** O que vai para o banco (INSERT, UPDATE ou p_dados da RPC de nova versão). */
export const payloadPlanoUsina = (dados) => ({
    nome: String(dados.nome ?? '').trim(),
    descricao: String(dados.descricao ?? '').trim() || null,
    ...Object.fromEntries(CAMPOS_PLANO_USINA.map(c => [c.chave, Number(dados[c.chave])])),
    originador_bonus_fechamentos: dados.originador_bonus_fechamentos
});

/** Mesma regra de fn_usinas_vinculo_plano_usina (20261010a): basta estar ativo. */
export const planoAceitaUsina = (plano) => !!plano && plano.status === 'ativo';

/**
 * Valores iniciais do Contrato de Gestão de Créditos (spec, decisão 10).
 * Por campo: o gravado em suppliers.contract_terms > o plano da usina de
 * onde o contrato foi aberto > nada (a tela completa com DEFAULTS_FORNECEDOR).
 * Sem plano, a taxa de gestão da usina sugere a Remuneração Recorrente,
 * como a tela já fazia.
 */
export const condicoesIniciaisGestao = ({ plano, gravados, gestaoUsina }) => {
    const sugestao = plano ? termosGestaoDoPlano(plano) : {};
    if (!plano && Number(gestaoUsina) > 0) sugestao.percentualRecorrente = Number(gestaoUsina);
    return { ...sugestao, ...(gravados || {}) };
};
