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

// Revisão do dono em 12/11/2026 (2ª): o Start deixou de contar FATURAS e passou
// a contar ENERGIA. O plano diz o multiplicador X; o teto do Start de cada UC é
// X × o consumo médio dela (mediana do histórico de consumo lido na conta de
// energia no cadastro, fixada ali -- `consumer_units.start_base_kwh`). O
// parceiro recebe sobre os kWh compensados de cada fatura até completar o
// teto. Decisão do dono (12/11): cada fatura paga Start sobre no MÁXIMO
// 1 × o consumo médio (teto por fatura); o total para em X × o consumo médio.
// Ex.: médio 1.000, 2×, faturas 600 / 1.200 / 800 → Start sobre 600 / 1.000 / 400.
// O Start tem níveis (L1..L3). O Híbrido é SEQUENCIAL: a fatura que completa o
// Start paga só Start; a recorrência começa na fatura seguinte.
export const TIPOS_RECOMPENSA = [
    {
        valor: 'start',
        rotulo: 'Start',
        ajuda: 'Paga, em cada fatura, sobre os kWh compensados limitados a 1 × o consumo médio da UC, até somar X × o consumo médio. Depois disso, não paga mais.'
    },
    {
        valor: 'recorrente',
        rotulo: 'Recorrência',
        ajuda: 'Paga sobre os kWh compensados de toda fatura paga, enquanto o parceiro estiver ativo.'
    },
    {
        valor: 'ambos',
        rotulo: 'Híbrido',
        ajuda: 'Start (por fatura, até 1 × o consumo médio) até somar X × o consumo médio da UC; a recorrência começa na fatura seguinte à que completa o Start. Nunca os dois na mesma fatura.'
    }
];

/** Como o percentual vira dinheiro (texto único para telas e ajudas). */
export const TEXTO_BASE_PERCENTUAL =
    'O percentual incide sobre os kWh compensados × a tarifa da concessionária impressa na conta, sem descontos (nem o desconto do assinante, nem o Fio B).';

/** Como o teto do Start é medido (texto único para telas e ajudas). */
export const TEXTO_TETO_START =
    'Em cada fatura, o Start paga sobre os kWh compensados limitados a 1 × o consumo médio da UC, até a soma chegar a X × o consumo médio. Consumo médio = mediana do histórico de consumo da conta de energia, fixada no cadastro do assinante (não muda depois). O que passar do teto da fatura ou do total não paga Start.';

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
    // Start: X × o consumo médio da UC, em kWh compensados + matriz cargo x nível.
    start_config: { multiplicador: 1, regras_multinivel: matrizZeradaOriginador() },
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

/** "2", "1,5" ou "1.5" → número; vazio ou não numérico → NaN. Aceita decimal. */
export const lerMultiplicador = (texto) => {
    const s = String(texto ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (!s || !/^\d*\.?\d+$/.test(s)) return NaN;
    return Number(s);
};

/** Multiplicador válido: número finito maior que zero. */
export const multiplicadorValido = (x) => Number.isFinite(Number(x)) && Number(x) > 0;

/**
 * O multiplicador X do Start ("Start de X × o consumo médio").
 *
 * Lê os DOIS formatos, porque o banco de produção ainda guarda o antigo:
 *  - novo: `start_config.multiplicador`;
 *  - antigo: `start_config.faturas_elegiveis` (N faturas) → X = N (1 fatura → 1×),
 *    a mesma conversão da migração.
 * Devolve 0 quando nenhum dos dois traz um valor válido.
 */
export const multiplicadorStart = (plano) => {
    const sc = plano?.start_config || {};
    const x = num(sc.multiplicador);
    if (multiplicadorValido(x)) return Math.round(x * 10000) / 10000;
    if (Array.isArray(sc.faturas_elegiveis)) {
        const n = new Set(sc.faturas_elegiveis.map(Number).filter(f => Number.isInteger(f) && f >= 1)).size;
        if (n > 0) return n;
    }
    return 0;
};

/** 2 → "2×"; 1.5 → "1,5×". */
export const formatarMultiplicador = (x) =>
    `${Number(x || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}×`;

/**
 * Espelho da regra do motor para a tela: em cada fatura o Start incide sobre
 * min(kWh compensado, 1 × consumo médio, saldo até X × consumo médio).
 * Valor = kWh do Start × tarifa cheia × %.
 *
 * simularStart({ consumoMedioKwh: 1000, multiplicador: 2, compensados: [600, 1200, 800] })
 *   → faturas com kwhStart 600 / 1000 / 400; totalKwh 2000.
 */
export const simularStart = ({ consumoMedioKwh, multiplicador, compensados = [], tarifa = 0, pct = 0 }) => {
    const medio = Math.max(0, Number(consumoMedioKwh) || 0);
    const tetoKwh = medio * Math.max(0, Number(multiplicador) || 0);
    const fator = Math.max(0, Number(tarifa) || 0) * (Math.max(0, Number(pct) || 0) / 100);
    let acumulado = 0;
    const faturas = compensados.map((c) => {
        const compensado = Math.max(0, Number(c) || 0);
        const kwhStart = Math.max(0, Math.min(compensado, medio, tetoKwh - acumulado));
        acumulado += kwhStart;
        return { compensado, kwhStart, acumulado, valor: kwhStart * fator, encerrou: kwhStart > 0 && acumulado >= tetoKwh };
    });
    return { tetoKwh, tetoFaturaKwh: medio, faturas, totalKwh: acumulado, totalValor: acumulado * fator };
};

/**
 * Converte o Start antigo (`regras` por fatura, só L1) para a matriz por nível:
 * o % da MENOR fatura elegível vira o L1 de cada cargo (`max_niveis` 1).
 */
const matrizDoStartAntigo = (sc) => {
    const regras = sc.regras;
    const ordinais = Object.keys(regras).map(Number).filter(Number.isFinite);
    const elegiveis = (Array.isArray(sc.faturas_elegiveis) ? sc.faturas_elegiveis : [])
        .map(Number).filter(f => ordinais.includes(f));
    const menor = (elegiveis.length ? elegiveis : ordinais).sort((a, b) => a - b)[0];
    const doOrdinal = menor !== undefined ? regras[String(menor)] || {} : {};
    return Object.fromEntries(CARGOS_ORIGINADOR.map(c => {
        const n = num(doOrdinal[c]);
        return [c, { niveis: { L1: String(Number.isFinite(n) ? n : 0), L2: '0', L3: '0', L4: '0' }, max_niveis: 1 }];
    }));
};

/**
 * Deixa o plano no formato exato que o banco aceita.
 * Start: { multiplicador: X, regras_multinivel: matriz }. Lê também o formato
 * antigo de produção ({ faturas_elegiveis, regras } por fatura): X = nº de
 * faturas elegíveis e o % da menor fatura vira o L1. Nunca devolve
 * `faturas_elegiveis` nem `regras` -- só o formato novo é gravado.
 */
export const normalizarPlanoOriginador = (plano) => {
    const p = plano || {};
    const sc = p.start_config || {};

    let matrizStart = sc.regras_multinivel;
    if (!matrizStart && sc.regras && typeof sc.regras === 'object') matrizStart = matrizDoStartAntigo(sc);

    const tipo = TIPOS_RECOMPENSA.some(t => t.valor === p.tipo_recompensa) ? p.tipo_recompensa : 'start';
    const x = multiplicadorStart(p);

    return {
        ...p,
        nome: String(p.nome ?? '').trim(),
        descricao: String(p.descricao ?? '').trim() || null,
        status: p.status === 'inativo' ? 'inativo' : 'ativo',
        tipo_recompensa: tipo,
        start_config: {
            // Plano só de recorrência não usa X; grava 1 para o jsonb ficar válido.
            multiplicador: x > 0 ? x : (tipo === 'recorrente' ? 1 : 0),
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
    if (usaStart && !multiplicadorValido(p.start_config.multiplicador)) {
        erros.push('Start: informe quantas vezes o consumo médio ele paga (número maior que zero; aceita decimal, ex.: 1,5).');
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
 * "Start de 2× o consumo médio (L1 50% · L2 10% · L3 5%) · depois recorrência (L1 4% · L2 2% · L3 1%)".
 */
export const resumoPlanoOriginador = (plano, cargo) => {
    if (!plano) return '—';
    const p = normalizarPlanoOriginador(plano);
    const x = p.start_config.multiplicador;
    const partes = [];
    if (p.tipo_recompensa !== 'recorrente' && multiplicadorValido(x)) {
        partes.push(`Start de ${formatarMultiplicador(x)} o consumo médio${cargo ? ` (${niveisDoCargo(p.start_config.regras_multinivel, cargo)})` : ''}`);
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
