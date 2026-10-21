import { ETAPAS_OBRA, resumoCronograma, textoItem, diasAte, formatarData } from '../lib/cronogramaObra';

// Kanban "Construção" da lista de usinas: só usinas em Pré-Operação, em colunas
// pelas macroetapas do cronograma da obra (aba Planta). A coluna vem da fase
// atual (primeira etapa não concluída), então não há arrastar: para mover, atualize
// o cronograma. A etapa 3 é a ligação à rede da concessionária durante a obra; o
// status "Em Conexão" do Kanban Operação é outra coisa (usina pronta entrando no
// sistema B2W).

const COLUNAS = {
    homologacao: { cor: '#6d28d9', fundo: '#ede9fe', dica: 'Orçamento, padrão de entrada e parecer de acesso' },
    construcao: { cor: '#b45309', fundo: '#fef3c7', dica: 'Estrutura, cercamento, abrigo e cabos' },
    conexao: { cor: '#1d4ed8', fundo: '#dbeafe', dica: 'Ligação à rede da concessionária' },
    geracao: { cor: '#166534', fundo: '#dcfce7', dica: 'Início de geração e primeiras faturas' }
};

const proximaEntrega = (etapaResumo) => {
    if (!etapaResumo) return null;
    const pendentes = etapaResumo.itens
        .filter(({ item }) => item.status !== 'concluido' && item.previsto_para)
        .sort((a, b) => a.item.previsto_para.localeCompare(b.item.previsto_para));
    return pendentes[0] || null;
};

function CardConstrucao({ usina, onClick }) {
    const resumo = resumoCronograma(usina.cronograma_obra);
    const etapa = resumo.atual;
    const cfg = COLUNAS[etapa?.etapa.id || 'geracao'];
    const proxima = proximaEntrega(etapa);
    const inicio = resumo.inicioGeracao;
    const diasInicio = diasAte(inicio.previsto_para);

    return (
        <div className="kanban-card" style={{ cursor: 'pointer' }} onClick={() => onClick(usina)}>
            <div style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold', background: cfg.fundo, color: cfg.cor, marginBottom: '0.5rem' }}>
                {etapa ? etapa.selo : 'OBRA CONCLUÍDA'}
            </div>

            <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)', lineHeight: 1.2, marginBottom: '0.5rem' }}>{usina.name}</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-blue)', background: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {usina.concessionaria || 'Sem conc.'}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#666', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {usina.supplier?.name || 'Sem Fornecedor'}
                </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#64748b', marginBottom: '0.2rem' }}>
                <span>{etapa ? `Etapa ${ETAPAS_OBRA.indexOf(etapa.etapa) + 1} · ${etapa.etapa.titulo}` : 'Todas as etapas concluídas'}</span>
                <span style={{ fontWeight: 'bold', color: cfg.cor }}>{etapa ? etapa.progresso : 100}%</span>
            </div>
            <div style={{ height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${etapa ? etapa.progresso : 100}%`, background: cfg.cor }} />
            </div>
            <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.25rem' }}>Obra geral: {resumo.geral}%</div>

            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.75rem' }}>
                {proxima && (
                    <div style={{ color: diasAte(proxima.item.previsto_para) < 0 ? '#991b1b' : '#334155' }}>
                        <strong>Próxima:</strong> {proxima.def.label} · {textoItem(proxima.def, proxima.item)}
                    </div>
                )}
                <div style={{ color: diasInicio !== null && diasInicio < 0 && inicio.status !== 'concluido' ? '#991b1b' : '#475569' }}>
                    <strong>Início de geração:</strong>{' '}
                    {inicio.status === 'concluido'
                        ? `iniciado${inicio.concluido_em ? ` em ${formatarData(inicio.concluido_em)}` : ''}`
                        : inicio.previsto_para ? formatarData(inicio.previsto_para) : 'sem previsão'}
                </div>
                {!etapa && (
                    <div style={{ color: '#b45309', fontWeight: 600 }}>Obra concluída: atualize o status da usina.</div>
                )}
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', marginTop: '0.6rem' }}>
                {usina.address?.cidade}/{usina.address?.uf}
            </div>
        </div>
    );
}

export default function KanbanConstrucaoUsinas({ usinas, onCardClick }) {
    const emObra = (usinas || []).filter(u => u.status === 'pre_operacao');
    const porEtapa = (id) => emObra.filter(u => (resumoCronograma(u.cronograma_obra).atual?.etapa.id || 'geracao') === id);

    return (
        <>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#64748b' }}>
                Usinas em Pré-Operação pela fase atual do cronograma da obra (aba Planta). A etapa 3 é a ligação à rede
                da concessionária; o status "Em Conexão" do Kanban Operação é a entrada da usina pronta no sistema B2W.
            </p>
            <div className="kanban-box">
                <div className="kanban-board">
                    {ETAPAS_OBRA.map((etapa, i) => {
                        const cfg = COLUNAS[etapa.id];
                        const lista = porEtapa(etapa.id);
                        return (
                            <div key={etapa.id} className="kanban-column" style={{ borderTop: `4px solid ${cfg.cor}` }}>
                                <div className="kanban-column-header" style={{ color: cfg.cor, flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>{i + 1}. {etapa.curto}</span>
                                        <span style={{ fontSize: '0.8rem', background: cfg.cor, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>{lista.length}</span>
                                    </div>
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 500 }}>{cfg.dica}</span>
                                </div>
                                <div className="kanban-column-content">
                                    {lista.map(u => <CardConstrucao key={u.id} usina={u} onClick={onCardClick} />)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </>
    );
}
