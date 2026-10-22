// Cronograma da obra da usina, nos moldes de b2winvest.com.br/usinas-disponiveis/
// (4 macroetapas com itens fixos). Fica em usinas.cronograma_obra (jsonb):
//   { inicio, suspensao: { desde, historico: [{ de, ate, dias }] },
//     itens: { <item_id>: { status, pct, concluido_em, previsto_para } } }
// status: 'previsto' | 'andamento' | 'concluido'. Datas em 'AAAA-MM-DD'.
// Dinâmico: "Iniciar" preenche previsto_para = início + prazo do item (modelo da
// São Vicente I na página). Suspender congela a contagem; Retomar empurra as
// previsões pendentes pelos dias suspensos.
// A página pública ainda é alimentada à parte; quando for ligada ao CRM, ela
// deve ler este mesmo formato.

export const ETAPAS_OBRA = [
    {
        id: 'homologacao', titulo: 'Fase de Homologação', curto: 'Homolog.', fase: 'Homologação',
        itens: [
            { id: 'orcamento_conexao', prazo: 30, label: 'Orçamento de Conexão', ok: 'Emitido' },
            { id: 'terraplanagem', prazo: 30, label: 'Terraplanagem', ok: 'Concluída' },
            { id: 'padrao_entrada', prazo: 30, label: 'Padrão de Entrada', ok: 'Pronto' },
            { id: 'parecer_acesso', prazo: 30, label: 'Parecer de Acesso', ok: 'Emitido' }
        ]
    },
    {
        id: 'construcao', titulo: 'Incorporação e Construção', curto: 'Constr.', fase: 'Incorporação',
        itens: [
            { id: 'estrutura_solo', prazo: 60, label: 'Estrutura de Solo', ok: 'Concluído' },
            { id: 'cercamento', prazo: 60, label: 'Cercamento', ok: 'Concluído' },
            { id: 'abrigo_inversor', prazo: 60, label: 'Abrigo do Inversor', ok: 'Concluído' },
            { id: 'passagem_cabos', prazo: 60, label: 'Passagem dos Cabos', ok: 'Concluído' }
        ]
    },
    {
        id: 'conexao', titulo: 'Conexão e Comissionamento', curto: 'Conexão', fase: 'Conexão',
        itens: [
            { id: 'instalacao_modulos', prazo: 90, label: 'Instalação dos Módulos', ok: 'Concluído' },
            { id: 'instalacao_inversores', prazo: 90, label: 'Instalação dos Inversores', ok: 'Concluído' },
            { id: 'comissionamento_conexao', prazo: 120, label: 'Comissionamento & Conexão', ok: 'Concluído' }
        ]
    },
    {
        id: 'geracao', titulo: 'Geração', curto: 'Geração', fase: 'Geração',
        itens: [
            { id: 'inicio_geracao', prazo: 120, label: 'Início de Geração', ok: '100%' },
            { id: 'compensacao_assinantes', prazo: 150, label: 'Compensação Energia Assinantes', ok: 'Compensado' },
            { id: 'fatura_1', prazo: 180, label: 'Emissão 1ª Fatura', ok: 'Emitido' },
            { id: 'fatura_2', prazo: 210, label: 'Emissão 2ª Fatura', ok: 'Emitido' },
            { id: 'fatura_3', prazo: 240, label: 'Emissão 3ª Fatura', ok: 'Emitido' }
        ]
    }
];

const MS_DIA = 24 * 60 * 60 * 1000;

const hojeLocal = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

const dataLocal = (iso) => {
    if (!iso) return null;
    const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!a || !m || !d) return null;
    return new Date(a, m - 1, d);
};

const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const hojeISO = () => isoLocal(hojeLocal());

export const somarDias = (iso, n) => {
    const d = dataLocal(iso);
    if (!d) return '';
    d.setDate(d.getDate() + n);
    return isoLocal(d);
};

const diasEntre = (deIso, ateIso) => {
    const de = dataLocal(deIso);
    const ate = dataLocal(ateIso);
    return de && ate ? Math.round((ate - de) / MS_DIA) : 0;
};

/** Dias da suspensão em curso (0 se a obra não está suspensa). */
export const diasSuspensoAtual = (cronograma) => {
    const desde = cronograma?.suspensao?.desde;
    return desde ? Math.max(0, diasEntre(desde, hojeISO())) : 0;
};

export const obraSuspensa = (cronograma) => !!cronograma?.suspensao?.desde;

/** Total de dias suspensos (histórico + suspensão em curso). */
export const diasSuspensosTotal = (cronograma) =>
    (cronograma?.suspensao?.historico || []).reduce((acc, h) => acc + (Number(h.dias) || 0), 0)
    + diasSuspensoAtual(cronograma);

export const formatarData = (iso) => {
    const d = dataLocal(iso);
    return d ? d.toLocaleDateString('pt-BR') : '';
};

/** Dias de hoje até a data (negativo = já passou); null sem data. */
export const diasAte = (iso) => {
    const d = dataLocal(iso);
    return d ? Math.round((d - hojeLocal()) / MS_DIA) : null;
};

/**
 * Item normalizado. previsto_para é a previsão EFETIVA: com a obra suspensa, a
 * data anda junto com os dias de suspensão, então a contagem fica congelada.
 * previsto_base é o valor gravado.
 */
export const itemDoCronograma = (cronograma, itemId) => {
    const it = cronograma?.itens?.[itemId] || {};
    const status = ['andamento', 'concluido'].includes(it.status) ? it.status : 'previsto';
    const base = it.previsto_para || '';
    const suspenso = status !== 'concluido' ? diasSuspensoAtual(cronograma) : 0;
    return {
        status,
        pct: Math.max(0, Math.min(100, Number(it.pct) || 0)),
        concluido_em: it.concluido_em || '',
        previsto_base: base,
        previsto_para: base && suspenso ? somarDias(base, suspenso) : base
    };
};

/** Gravar no item uma previsão vista na tela (efetiva) desconta a suspensão em curso. */
export const previsaoParaGravar = (cronograma, isoEfetivo) => {
    const suspenso = diasSuspensoAtual(cronograma);
    return isoEfetivo && suspenso ? somarDias(isoEfetivo, -suspenso) : isoEfetivo;
};

const todosItens = () => ETAPAS_OBRA.flatMap(e => e.itens);

/**
 * Inicia a obra: previsão de cada item não concluído = início + prazo do item.
 * Situação e % dos itens são mantidos.
 */
export const iniciarCronograma = (cronograma, inicioIso) => {
    const itens = { ...(cronograma?.itens || {}) };
    todosItens().forEach(def => {
        const atual = itens[def.id] || {};
        if (atual.status === 'concluido') return;
        itens[def.id] = { ...atual, previsto_para: somarDias(inicioIso, def.prazo) };
    });
    return { ...(cronograma || {}), inicio: inicioIso, itens };
};

/** Muda a data de início e desloca as previsões pendentes pela mesma diferença. */
export const alterarInicio = (cronograma, novoIso) => {
    const antigo = cronograma?.inicio;
    if (!antigo || !novoIso) return iniciarCronograma(cronograma, novoIso);
    const delta = diasEntre(antigo, novoIso);
    return { ...deslocarPendentes(cronograma, delta), inicio: novoIso };
};

const deslocarPendentes = (cronograma, dias) => {
    if (!dias) return cronograma;
    const itens = { ...(cronograma?.itens || {}) };
    Object.entries(itens).forEach(([id, it]) => {
        if (it?.status === 'concluido' || !it?.previsto_para) return;
        itens[id] = { ...it, previsto_para: somarDias(it.previsto_para, dias) };
    });
    return { ...cronograma, itens };
};

export const suspenderCronograma = (cronograma) => ({
    ...cronograma,
    suspensao: { ...(cronograma?.suspensao || {}), desde: hojeISO() }
});

/** Retoma: as previsões pendentes andam os dias suspensos e o período vai ao histórico. */
export const retomarCronograma = (cronograma) => {
    const desde = cronograma?.suspensao?.desde;
    if (!desde) return cronograma;
    const ate = hojeISO();
    const dias = Math.max(0, diasEntre(desde, ate));
    const deslocado = deslocarPendentes(cronograma, dias);
    return {
        ...deslocado,
        suspensao: {
            desde: null,
            // Suspender e retomar no mesmo dia não mexe em prazo: não vai ao histórico.
            historico: dias > 0
                ? [...(cronograma.suspensao.historico || []), { de: desde, ate, dias }]
                : (cronograma.suspensao.historico || [])
        }
    };
};

/** Progresso do item: concluído 100, em andamento o %, previsto 0. */
export const progressoItem = (item) =>
    item.status === 'concluido' ? 100 : item.status === 'andamento' ? item.pct : 0;

/** Texto do item como na página: rótulo de concluído, %, "N dias" ou atraso. */
export const textoItem = (def, item) => {
    if (item.status === 'concluido') return def.ok;
    if (item.status === 'andamento') return `${item.pct}%`;
    const dias = diasAte(item.previsto_para);
    if (dias === null) return 'Sem previsão';
    if (dias < 0) return `Atrasado ${-dias} dias`;
    return dias === 0 ? 'Hoje' : `${dias} dias`;
};

export const resumoEtapa = (etapa, cronograma) => {
    const itens = etapa.itens.map(def => ({ def, item: itemDoCronograma(cronograma, def.id) }));
    const progresso = Math.round(itens.reduce((acc, { item }) => acc + progressoItem(item), 0) / itens.length);
    const concluida = itens.every(({ item }) => item.status === 'concluido');
    const iniciada = itens.some(({ item }) => item.status !== 'previsto');
    const previsoes = itens
        .map(({ item }) => diasAte(item.previsto_para))
        .filter(d => d !== null);
    const proxima = previsoes.length ? Math.min(...previsoes) : null;

    let selo;
    if (concluida) selo = etapa.id === 'geracao' ? '100% OPERACIONAL' : 'CONCLUÍDO';
    else if (iniciada) selo = progresso > 0 ? `INICIADO ${progresso}%` : 'INICIADO';
    else if (proxima !== null) selo = proxima < 0 ? `ATRASADO ${-proxima} DIAS` : `PROV. ${proxima} DIAS`;
    else selo = 'SEM PREVISÃO';

    return { itens, progresso, concluida, iniciada, selo };
};

/**
 * Situação de cada macroetapa no formato do link da página pública da usina
 * (b2winvest.com.br/paginas/usinasroiv2/): 'ok' concluída, 'i<N>' iniciada com N%,
 * 'p<N>' começa em N dias. Cronograma sem nenhum item preenchido devolve undefined:
 * a página então não afirma fase nenhuma, em vez de dizer "prevista em 0 dias".
 */
export const etapasParaPagina = (cronograma) => {
    if (!cronograma || !Object.keys(cronograma.itens || {}).length) return undefined;
    const r = {};
    ETAPAS_OBRA.forEach(etapa => {
        const { itens, progresso, concluida, iniciada } = resumoEtapa(etapa, cronograma);
        if (concluida) r[etapa.id] = 'ok';
        else if (iniciada) r[etapa.id] = `i${progresso}`;
        else {
            const dias = itens.map(({ item }) => diasAte(item.previsto_para)).filter(d => d !== null);
            r[etapa.id] = `p${dias.length ? Math.max(0, Math.min(...dias)) : 0}`;
        }
    });
    return r;
};

/** Fase atual = primeira macroetapa não concluída. */
export const resumoCronograma = (cronograma) => {
    const etapas = ETAPAS_OBRA.map(e => ({ etapa: e, ...resumoEtapa(e, cronograma) }));
    const atual = etapas.find(e => !e.concluida) || null;
    const total = etapas.reduce((acc, e) => acc + e.itens.length, 0);
    const geral = Math.round(etapas.reduce((acc, e) => acc + e.itens.reduce((a, { item }) => a + progressoItem(item), 0), 0) / total);
    const inicioGeracao = itemDoCronograma(cronograma, 'inicio_geracao');

    let cabecalho;
    if (obraSuspensa(cronograma)) cabecalho = `OBRA SUSPENSA DESDE ${formatarData(cronograma.suspensao.desde)}`;
    else if (!atual) cabecalho = '100% EXECUTADO';
    else if (atual.etapa.id === 'geracao') cabecalho = 'EM FASE DE GERAÇÃO';
    else cabecalho = `FASE ATUAL: ${atual.etapa.fase.toUpperCase()}${atual.progresso > 0 ? ` (${atual.progresso}%)` : ''}`;

    return { etapas, atual, geral, cabecalho, inicioGeracao, suspensa: obraSuspensa(cronograma) };
};
