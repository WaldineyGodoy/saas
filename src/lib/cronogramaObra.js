// Cronograma da obra da usina, nos moldes de b2winvest.com.br/usinas-disponiveis/
// (4 macroetapas com itens fixos). Fica em usinas.cronograma_obra (jsonb):
//   { itens: { <item_id>: { status, pct, concluido_em, previsto_para } } }
// status: 'previsto' | 'andamento' | 'concluido'. Datas em 'AAAA-MM-DD'.
// A página pública ainda é alimentada à parte; quando for ligada ao CRM, ela
// deve ler este mesmo formato.

export const ETAPAS_OBRA = [
    {
        id: 'homologacao', titulo: 'Fase de Homologação', curto: 'Homolog.', fase: 'Homologação',
        itens: [
            { id: 'orcamento_conexao', label: 'Orçamento de Conexão', ok: 'Emitido' },
            { id: 'terraplanagem', label: 'Terraplanagem', ok: 'Concluída' },
            { id: 'padrao_entrada', label: 'Padrão de Entrada', ok: 'Pronto' },
            { id: 'parecer_acesso', label: 'Parecer de Acesso', ok: 'Emitido' }
        ]
    },
    {
        id: 'construcao', titulo: 'Incorporação e Construção', curto: 'Constr.', fase: 'Incorporação',
        itens: [
            { id: 'estrutura_solo', label: 'Estrutura de Solo', ok: 'Concluído' },
            { id: 'cercamento', label: 'Cercamento', ok: 'Concluído' },
            { id: 'abrigo_inversor', label: 'Abrigo do Inversor', ok: 'Concluído' },
            { id: 'passagem_cabos', label: 'Passagem dos Cabos', ok: 'Concluído' }
        ]
    },
    {
        id: 'conexao', titulo: 'Conexão e Comissionamento', curto: 'Conexão', fase: 'Conexão',
        itens: [
            { id: 'instalacao_modulos', label: 'Instalação dos Módulos', ok: 'Concluído' },
            { id: 'instalacao_inversores', label: 'Instalação dos Inversores', ok: 'Concluído' },
            { id: 'comissionamento_conexao', label: 'Comissionamento & Conexão', ok: 'Concluído' }
        ]
    },
    {
        id: 'geracao', titulo: 'Geração', curto: 'Geração', fase: 'Geração',
        itens: [
            { id: 'inicio_geracao', label: 'Início de Geração', ok: '100%' },
            { id: 'compensacao_assinantes', label: 'Compensação Energia Assinantes', ok: 'Compensado' },
            { id: 'fatura_1', label: 'Emissão 1ª Fatura', ok: 'Emitido' },
            { id: 'fatura_2', label: 'Emissão 2ª Fatura', ok: 'Emitido' },
            { id: 'fatura_3', label: 'Emissão 3ª Fatura', ok: 'Emitido' }
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

export const formatarData = (iso) => {
    const d = dataLocal(iso);
    return d ? d.toLocaleDateString('pt-BR') : '';
};

/** Dias de hoje até a data (negativo = já passou); null sem data. */
export const diasAte = (iso) => {
    const d = dataLocal(iso);
    return d ? Math.round((d - hojeLocal()) / MS_DIA) : null;
};

export const itemDoCronograma = (cronograma, itemId) => {
    const it = cronograma?.itens?.[itemId] || {};
    return {
        status: ['andamento', 'concluido'].includes(it.status) ? it.status : 'previsto',
        pct: Math.max(0, Math.min(100, Number(it.pct) || 0)),
        concluido_em: it.concluido_em || '',
        previsto_para: it.previsto_para || ''
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

/** Fase atual = primeira macroetapa não concluída. */
export const resumoCronograma = (cronograma) => {
    const etapas = ETAPAS_OBRA.map(e => ({ etapa: e, ...resumoEtapa(e, cronograma) }));
    const atual = etapas.find(e => !e.concluida) || null;
    const total = etapas.reduce((acc, e) => acc + e.itens.length, 0);
    const geral = Math.round(etapas.reduce((acc, e) => acc + e.itens.reduce((a, { item }) => a + progressoItem(item), 0), 0) / total);
    const inicioGeracao = itemDoCronograma(cronograma, 'inicio_geracao');

    let cabecalho;
    if (!atual) cabecalho = '100% EXECUTADO';
    else if (atual.etapa.id === 'geracao') cabecalho = 'EM FASE DE GERAÇÃO';
    else cabecalho = `FASE ATUAL: ${atual.etapa.fase.toUpperCase()}${atual.progresso > 0 ? ` (${atual.progresso}%)` : ''}`;

    return { etapas, atual, geral, cabecalho, inicioGeracao };
};
