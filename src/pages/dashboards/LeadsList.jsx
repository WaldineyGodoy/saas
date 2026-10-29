import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import LeadModal from '../../components/LeadModal';
import SubscriberModal from '../../components/SubscriberModal';
import SupplierModal from '../../components/SupplierModal';
import { getTagColor } from '../../lib/tagHelpers';
import LeadAgenda from '../../components/LeadAgenda';
import { SeloJev } from '../../components/TermometroJev';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    closestCorners,
    rectIntersection,
    pointerWithin,
    getFirstCollision,
    DragOverlay
} from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

// 'sem_interacao' abre o kanban: e onde nasce o contato que chegou pelo
// WhatsApp do Deskcomm e ainda nao disse sobre qual produto quer falar.
const KANBAN_STATUSES = [
    { status: 'sem_interacao', label: 'Sem Interação', color: '#a8a29e' },
    { status: 'indicado', label: 'Indicado', color: '#0ea5e9' },
    { status: 'simulacao', label: 'Simulação', color: '#64748b' },
    { status: 'negociacao', label: 'Negociação', color: '#eab308' },
    { status: 'reuniao_agendada', label: 'Reunião Agendada/Apresentação', color: '#f97316' },
    { status: 'contrato_enviado', label: 'Contrato Enviado', color: '#8b5cf6' },
    { status: 'ativacao', label: 'Ativação', color: '#7c3aed' },
    { status: 'ativo', label: 'Ativo', color: '#22c55e' },
    { status: 'pago', label: 'Pago', color: '#06b6d4' },
    { status: 'negocio_perdido', label: 'Negócio Perdido', color: '#ef4444' }
];

// Categorias do topo da página. O lead guarda a tag com '#' ('#Investidor').
const CATEGORIAS = ['Embaixador', 'Energia por Assinatura', 'Investidor', 'Eletropostos', 'Cotas', 'Consorcio', 'Financiamento', 'Arrendamento de area', 'Locação de Vagas', 'Comercializadora'];
// Lead sem nenhuma das categorias acima (o contato do Deskcomm chega assim).
// Sem esta tag ele nunca teria onde clicar para apagar o aviso de novo.
const SEM_CATEGORIA = '__sem_categoria__';
const COR_SEM_CATEGORIA = { color: '#475569', bg: '#f1f5f9' };
// Lead criado antes do aviso de novo existir não conta como novo.
const INICIO_AVISO_NOVO = '2026-10-20T03:00:00Z';

const semCerquilha = (t) => String(t).replace(/^#/, '').trim().toLowerCase();

// Compara sem '#' e sem caixa: o filtro lista 'Investidor' e o lead guarda
// '#Investidor'.
function categoriasDoLead(lead) {
    const doLead = (lead.tags || []).map(semCerquilha);
    const categorias = CATEGORIAS.filter(c => doLead.includes(semCerquilha(c)));
    return categorias.length > 0 ? categorias : [SEM_CATEGORIA];
}

// Texto branco ou escuro, o que contrastar mais com o fundo. Branco sobre o
// amarelo da Comercializadora ou o verde-limão do Arrendamento não se lê.
function textoSobre(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'white';
    const canal = (i) => {
        const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
    const comBranco = 1.05 / (lum + 0.05);
    const comEscuro = (lum + 0.05) / (0.0091 + 0.05); // #0f172a
    return comBranco >= comEscuro ? 'white' : '#0f172a';
}

const textoNovos = (qtd) => `${qtd} lead${qtd > 1 ? 's' : ''} novo${qtd > 1 ? 's' : ''}`;

function SeloNew() {
    return <span className="lead-selo-new" title="Lead novo">NEW</span>;
}

function KanbanCard({ lead, onClick, isOverlay, novo }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: lead.id, disabled: !!isOverlay });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        zIndex: isDragging ? 1000 : 1,
        position: 'relative',
        width: isOverlay ? '280px' : 'auto'
    };

    return (
        <div
            ref={setNodeRef}
            className="kanban-card"
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(lead)}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.3rem' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--color-text-dark)' }}>{lead.name}</span>
                <span style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexShrink: 0 }}>
                    <SeloJev lead={lead} />
                    {novo && <SeloNew />}
                </span>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-blue)', background: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {lead.concessionaria || 'N/A'}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#047857', background: '#ecfdf5', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {lead.consumo_kwh ? `${Number(lead.consumo_kwh).toLocaleString('pt-BR')} kWh` : '0 kWh'}
                </span>
            </div>

            {lead.tags && lead.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    {lead.tags.map(tag => {
                        const style = getTagColor(tag);
                        return (
                            <span key={tag} style={{
                                fontSize: '0.65rem',
                                color: style.color,
                                backgroundColor: style.bg,
                                padding: '0.1rem 0.3rem',
                                borderRadius: '4px',
                                fontWeight: 500
                            }}>
                                {tag}
                            </span>
                        );
                    })}
                </div>
            )}

            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lead.email}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)', marginTop: '0.2rem' }}>
                {lead.phone}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.8rem', fontSize: '0.75rem', color: 'var(--color-text-light)' }}>
                <span>{lead.originator?.name?.split(' ')[0] || '-'}</span>
                <span>{new Date(lead.created_at).toLocaleDateString()}</span>
            </div>

        </div>
    );
}

function KanbanColumn({ status, label, color, leads, onCardClick, leadEhNovo }) {
    const { setNodeRef, isOver } = useDroppable({
        id: status,
    });

    return (
        <div
            ref={setNodeRef}
            className="kanban-column"
            style={{
                borderTop: `4px solid ${color}`,
                background: isOver ? '#e2e8f0' : '#f8fafc',
                transition: 'background 0.2s ease'
            }}
        >
            <div className="kanban-column-header" style={{ color: color }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ textTransform: 'uppercase', fontSize: '0.8rem', fontWeight: 'bold' }}>
                        {label}
                    </span>
                    {leads.some(leadEhNovo) && <SeloNew />}
                </span>
                <span style={{ fontSize: '0.8rem', background: color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                    {leads.length}
                </span>
            </div>
            <div className="kanban-column-content">
                <SortableContext
                    items={leads.map(l => l.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {leads.map(lead => (
                        <KanbanCard key={lead.id} lead={lead} onClick={onCardClick} novo={leadEhNovo(lead)} />
                    ))}
                </SortableContext>
            </div>
        </div>
    );
}

export default function LeadsList() {
    const { profile } = useAuth();
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubscriberModalOpen, setIsSubscriberModalOpen] = useState(false);
    const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
    const [editingLead, setEditingLead] = useState(null);
    const [leadToConvert, setLeadToConvert] = useState(null);
    const [viewMode, setViewMode] = useState('kanban'); // Default to kanban
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedStatuses, setSelectedStatuses] = useState([]);
    const [hideEmptyStatuses, setHideEmptyStatuses] = useState(false);
    // Simulação parada há 90 dias é arquivada (20261006b) e some do padrão.
    const [mostrarArquivados, setMostrarArquivados] = useState(false);
    const [activeId, setActiveId] = useState(null);
    // Leads que este usuário já viu. `null` até carregar: antes disso nenhum
    // lead é tratado como novo, senão todos piscariam como novos ao abrir.
    const [vistos, setVistos] = useState(null);
    const arrastandoRef = useRef(false);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    // Recebe os filtros por parâmetro para o clique numa tag ou num status
    // saber quais leads a tela vai mostrar depois dele.
    const passaNoFiltro = (lead, tags, statuses) => {
        if (lead.arquivado_em && !mostrarArquivados) return false;
        let matchesSearch = true;
        let matchesTags = true;
        let matchesStatus = true;
        
        if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase();
            const hasTagMatch = lead.tags?.some(tag => tag.toLowerCase().includes(lowerTerm));
            matchesSearch = (
                lead.name?.toLowerCase().includes(lowerTerm) ||
                lead.email?.toLowerCase().includes(lowerTerm) ||
                lead.phone?.includes(lowerTerm) ||
                lead.concessionaria?.toLowerCase().includes(lowerTerm) ||
                hasTagMatch
            );
        }

        if (tags.length > 0) {
            const doLead = categoriasDoLead(lead);
            matchesTags = tags.some(t => doLead.includes(t));
        }

        if (statuses.length > 0) {
            matchesStatus = statuses.includes(lead.status);
        }

        return matchesSearch && matchesTags && matchesStatus;
    };

    const filteredLeads = leads.filter(lead => passaNoFiltro(lead, selectedTags, selectedStatuses));

    const statusDoLead = (lead) => lead.status || 'simulacao';

    const leadEhNovo = (lead) =>
        vistos !== null &&
        !lead.arquivado_em &&
        new Date(lead.created_at) > new Date(INICIO_AVISO_NOVO) &&
        !vistos.has(lead.id);

    const novosPorCategoria = {};
    const novosPorStatus = {};
    for (const lead of leads) {
        if (!leadEhNovo(lead)) continue;
        for (const categoria of categoriasDoLead(lead)) {
            (novosPorCategoria[categoria] ||= []).push(lead);
        }
        (novosPorStatus[statusDoLead(lead)] ||= []).push(lead);
    }

    const marcarVistos = (ids) => {
        if (ids.length === 0) return;
        setVistos(prev => new Set([...(prev || []), ...ids]));
        supabase.rpc('fn_marcar_leads_vistos', { p_leads: ids })
            .then(({ error }) => { if (error) console.error('Erro ao marcar leads como vistos:', error); });
    };

    // Ligar uma tag ou um status conta como ver os leads novos daquele filtro
    // que a tela passa a mostrar. Lead novo escondido por outro filtro ligado
    // continua novo, porque ninguém olhou para ele.
    const marcarVistosNaTela = (novos, tags, statuses) =>
        marcarVistos((novos || []).filter(l => passaNoFiltro(l, tags, statuses)).map(l => l.id));

    const alternarCategoria = (categoria) => {
        const ligando = !selectedTags.includes(categoria);
        const proximas = ligando ? [...selectedTags, categoria] : selectedTags.filter(t => t !== categoria);
        setSelectedTags(proximas);
        if (ligando) marcarVistosNaTela(novosPorCategoria[categoria], proximas, selectedStatuses);
    };

    const alternarStatus = (status) => {
        const ligando = !selectedStatuses.includes(status);
        const proximos = ligando ? [...selectedStatuses, status] : selectedStatuses.filter(s => s !== status);
        setSelectedStatuses(proximos);
        if (ligando) marcarVistosNaTela(novosPorStatus[status], selectedTags, proximos);
    };

    const abrirLead = (lead) => {
        setEditingLead(lead);
        setIsModalOpen(true);
        if (leadEhNovo(lead)) marcarVistos([lead.id]);
    };

    useEffect(() => {
        fetchLeads();
        supabase.from('lead_visto').select('lead_id')
            .then(({ data, error }) => {
                if (error) { console.error('Erro ao ler leads vistos:', error); return; }
                setVistos(new Set((data || []).map(r => r.lead_id)));
            });

        // Lead que chega com a página aberta aparece sem recarregar. Durante
        // um arraste o recarregamento desfaria a posição do card.
        const canal = supabase
            .channel('leads-kanban')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
                if (!arrastandoRef.current) fetchLeads({ silencioso: true });
            })
            .subscribe();

        return () => { supabase.removeChannel(canal); };
    }, []);

    const fetchLeads = async ({ silencioso = false } = {}) => {
        if (!silencioso) setLoading(true);
        try {
            const { data, error } = await supabase
                .from('leads')
                .select(`
                    *,
                    originator:originator_id (name)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setLeads(data || []);
        } catch (error) {
            console.error('Error fetching leads:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = (savedLead) => {
        fetchLeads();
        setIsModalOpen(false);
    };

    const handleDelete = (deletedLeadId) => {
        setLeads(leads.filter(l => l.id !== deletedLeadId));
        setIsModalOpen(false);
    };

    const handleConvert = (lead, type = 'assinante') => {
        setLeadToConvert(lead);
        if (type === 'assinante') {
            setIsSubscriberModalOpen(true);
        } else if (type === 'fornecedor') {
            setIsSupplierModalOpen(true);
        }
    };

    const handleSupplierSaved = async () => {
        try {
            fetchLeads();
            alert('Lead convertido em Fornecedor!');
        } catch (e) {
            console.error('Erro ao converter', e);
        }
    };

    const handleSubscriberSaved = async (newSubscriber) => {
        try {
            // Só grava o VÍNCULO. O status do lead é derivado do status do
            // assinante pelo gatilho `trg_sync_lead_status`, que conhece a
            // regra: assinante em 'ativacao' ainda não assinou o contrato,
            // logo o lead é 'contrato_enviado'; ele só vira 'ativacao' quando a
            // Autentique confirma a assinatura.
            //
            // Definir o status aqui na mão foi o que produziu leads em
            // 'ativacao' sem contrato assinado.
            if (newSubscriber?.id) {
                await supabase.from('subscribers')
                    .update({ lead_id: leadToConvert.id })
                    .eq('id', newSubscriber.id);
            }

            fetchLeads();
            alert('Lead convertido em Assinante! Aguardando a assinatura do contrato.');
        } catch (e) {
            console.error('Erro ao vincular o lead ao assinante', e);
        }
    };

    const handleDragStart = (event) => {
        arrastandoRef.current = true;
        setActiveId(event.active.id);
    };

    const handleDragOver = (event) => {
        const { active, over } = event;
        if (!over) return;

        const activeId = active.id;
        const overId = over.id;

        // Find the container
        let overContainer = overId;
        const isTargetStatus = KANBAN_STATUSES.some(s => s.status === overId);

        if (!isTargetStatus) {
            const targetLead = leads.find(l => l.id === overId);
            overContainer = targetLead?.status;
        }

        if (!overContainer) return;

        const leadToUpdate = leads.find(l => l.id === activeId);
        if (leadToUpdate && leadToUpdate.status !== overContainer) {
            setLeads(prev => prev.map(l =>
                l.id === activeId ? { ...l, status: overContainer } : l
            ));
        }
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        arrastandoRef.current = false;
        setActiveId(null);
        if (!over) {
            fetchLeads(); // Reset to original if dropped outside
            return;
        }

        const activeId = active.id;
        const overId = over.id;

        // Determine target status
        let newStatus = overId;
        const isTargetStatus = KANBAN_STATUSES.some(s => s.status === overId);

        if (!isTargetStatus) {
            const targetLead = leads.find(l => l.id === overId);
            newStatus = targetLead?.status;
        }

        if (!newStatus) {
            fetchLeads();
            return;
        }

        const leadToUpdate = leads.find(l => l.id === activeId);
        // We don't check leadToUpdate.status !== newStatus here because handleDragOver might have already updated the local state

        try {
            const { error } = await supabase
                .from('leads')
                .update({ status: newStatus })
                .eq('id', activeId);

            if (error) throw error;
        } catch (error) {
            console.error('Error updating lead status:', error);
            fetchLeads(); // Rollback
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Gestão de Leads</h2>
                <button
                    onClick={() => { setEditingLead(null); setIsModalOpen(true); }}
                    className="btn btn-primary"
                >
                    + Novo Lead
                </button>
            </div>

            {/* Controls Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flex: 1, alignItems: 'center' }}>
                    <input
                        type="text"
                        placeholder="Buscar por nome, email, telefone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input"
                        style={{ maxWidth: '300px' }}
                    />
                    
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flex: 1, alignItems: 'center' }}>
                        {[...CATEGORIAS, SEM_CATEGORIA].map(tag => {
                            // A tag selecionada usava var(--color-primary), que
                            // não existe no CSS: o fundo sumia e o texto branco
                            // ficava sobre a página. Cada tag usa a própria cor,
                            // no mesmo padrão do filtro de status.
                            const cor = tag === SEM_CATEGORIA ? COR_SEM_CATEGORIA : getTagColor(`#${tag}`);
                            const selecionada = selectedTags.includes(tag);
                            const qtdNovos = novosPorCategoria[tag]?.length || 0;
                            return (
                                <button
                                    key={tag}
                                    onClick={() => alternarCategoria(tag)}
                                    className={qtdNovos > 0 ? 'lead-tag-pulso' : undefined}
                                    title={qtdNovos > 0 ? textoNovos(qtdNovos) : undefined}
                                    aria-pressed={selecionada}
                                    style={{
                                        '--pulso-cor': cor.color,
                                        fontSize: '0.75rem',
                                        padding: '0.2rem 0.6rem',
                                        borderRadius: '16px',
                                        border: `1px solid ${cor.color}`,
                                        background: selecionada ? cor.color : cor.bg,
                                        color: selecionada ? textoSobre(cor.color) : cor.color,
                                        fontWeight: selecionada ? 600 : 500,
                                        cursor: 'pointer',
                                        transition: 'background 0.2s, color 0.2s'
                                    }}
                                >
                                    {tag === SEM_CATEGORIA ? 'Sem categoria' : tag}
                                </button>
                            );
                        })}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flex: 1, alignItems: 'center', marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Filtrar Status:</span>
                        {KANBAN_STATUSES.map(s => {
                            const qtdNovos = novosPorStatus[s.status]?.length || 0;
                            return (
                            <button
                                key={s.status}
                                onClick={() => alternarStatus(s.status)}
                                className={qtdNovos > 0 ? 'lead-tag-pulso' : undefined}
                                title={qtdNovos > 0 ? textoNovos(qtdNovos) : undefined}
                                aria-pressed={selectedStatuses.includes(s.status)}
                                style={{
                                    '--pulso-cor': s.color,
                                    fontSize: '0.75rem',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '16px',
                                    border: `1px solid ${selectedStatuses.includes(s.status) ? s.color : s.color + '40'}`,
                                    background: selectedStatuses.includes(s.status) ? s.color : s.color + '15',
                                    color: selectedStatuses.includes(s.status) ? 'white' : s.color,
                                    fontWeight: selectedStatuses.includes(s.status) ? 600 : 500,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {s.label}
                            </button>
                            );
                        })}
                    </div>
                    {viewMode === 'kanban' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', marginTop: '0.5rem' }}>
                            <input 
                                type="checkbox" 
                                id="hide-empty" 
                                checked={hideEmptyStatuses}
                                onChange={e => setHideEmptyStatuses(e.target.checked)}
                            />
                            <label htmlFor="hide-empty" style={{ fontSize: '0.85rem', color: '#64748b', cursor: 'pointer' }}>Ocultar colunas vazias</label>
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <input
                            type="checkbox"
                            id="mostrar-arquivados"
                            checked={mostrarArquivados}
                            onChange={e => setMostrarArquivados(e.target.checked)}
                        />
                        <label htmlFor="mostrar-arquivados" style={{ fontSize: '0.85rem', color: '#64748b', cursor: 'pointer' }}>
                            Mostrar arquivados ({leads.filter(l => l.arquivado_em).length})
                        </label>
                    </div>
                    <div className="btn-group" style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Lista
                        </button>
                        <button
                            onClick={() => setViewMode('kanban')}
                            className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Kanban
                        </button>
                        <button
                            onClick={() => setViewMode('agenda')}
                            className={`btn ${viewMode === 'agenda' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ borderRadius: 0, border: 'none' }}
                        >
                            Agenda
                        </button>
                    </div>
                </div>
            </div>

            {loading ? <p>Carregando...</p> : (
                <>
                    {viewMode === 'agenda' ? (
                        <LeadAgenda onLeadClick={abrirLead} />
                    ) : viewMode === 'list' ? (
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div className="table-container">
                                {filteredLeads.length === 0 ? (
                                    <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhum lead encontrado.</p>
                                ) : (
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Nome</th>
                                                <th>Concessionária</th>
                                                <th>Consumo (kWh)</th>
                                                <th>Contato</th>
                                                <th>Status</th>
                                                <th>Originador</th>
                                                <th>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredLeads.map(lead => (
                                                <tr key={lead.id}>
                                                    <td style={{ fontWeight: 'bold' }}>{lead.name}{leadEhNovo(lead) && <> <SeloNew /></>}</td>
                                                    <td>{lead.concessionaria || '-'}</td>
                                                    <td>{lead.consumo_kwh ? `${Number(lead.consumo_kwh).toLocaleString('pt-BR')} kWh` : '-'}</td>
                                                    <td>
                                                        <div style={{ fontSize: '0.9rem' }}>{lead.email}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)' }}>{lead.phone}</div>
                                                    </td>
                                                    <td>
                                                        <span style={{
                                                            padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: '500',
                                                            background: (KANBAN_STATUSES.find(s => s.status === lead.status)?.color || '#94a3b8') + '20',
                                                            color: KANBAN_STATUSES.find(s => s.status === lead.status)?.color || '#94a3b8'
                                                        }}>
                                                            {KANBAN_STATUSES.find(s => s.status === lead.status)?.label || lead.status}
                                                        </span>
                                                        {lead.tags && lead.tags.length > 0 && (
                                                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                                                                {lead.tags.map(tag => {
                                                                    const style = getTagColor(tag);
                                                                    return (
                                                                        <span key={tag} style={{
                                                                            fontSize: '0.65rem', color: style.color,
                                                                            backgroundColor: style.bg, padding: '0.1rem 0.3rem',
                                                                            borderRadius: '4px', fontWeight: 500
                                                                        }}>
                                                                            {tag}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>{lead.originator?.name || '-'}</td>
                                                    <td style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            onClick={() => abrirLead(lead)}
                                                            className="btn btn-secondary"
                                                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                                                        >
                                                            Editar
                                                        </button>
                                                        {!['ativacao', 'ativo', 'pago', 'negocio_perdido'].includes(lead.status) && (
        <select
            onChange={(e) => {
                if (e.target.value) {
                    if (e.target.value === 'assinante' || e.target.value === 'fornecedor') {
                        handleConvert(lead, e.target.value);
                    } else {
                        alert('Conversão para ' + e.target.value + ' em desenvolvimento!');
                    }
                    e.target.value = '';
                }
            }}
            className="input"
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', border: '1px solid var(--color-success)', color: 'var(--color-success)', background: 'white', maxWidth: '120px' }}
        >
            <option value="">Converter...</option>
            <option value="embaixador">Embaixador</option>
            <option value="assinante">Assinante</option>
            <option value="fornecedor">Fornecedor</option>
            <option value="dono_areas">Dono de Áreas/Vagas</option>
        </select>
    )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={(args) => {
                                // First try pointerWithin (good for empty columns)
                                const pointerCollisions = pointerWithin(args);
                                if (pointerCollisions.length > 0) return pointerCollisions;

                                // Fallback to rectIntersection
                                return rectIntersection(args);
                            }}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDragEnd={handleDragEnd}
                            onDragCancel={() => { arrastandoRef.current = false; setActiveId(null); fetchLeads(); }}
                        >
                            <div className="kanban-box">
                                <div className="kanban-board">
                                    {KANBAN_STATUSES.map(({ status, label, color }) => {
                                        const leadsInStatus = filteredLeads.filter(l => (l.status || 'simulacao') === status);
                                        if (hideEmptyStatuses && leadsInStatus.length === 0) return null;
                                        return (
                                            <KanbanColumn
                                                key={status}
                                                status={status}
                                                label={label}
                                                color={color}
                                                leads={leadsInStatus}
                                                onCardClick={abrirLead}
                                                leadEhNovo={leadEhNovo}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                            <DragOverlay adjustScale={true}>
                                {activeId ? (
                                    <KanbanCard
                                        lead={leads.find(l => l.id === activeId)}
                                        isOverlay={true}
                                    />
                                ) : null}
                            </DragOverlay>
                        </DndContext>
                    )}
                </>
            )}

            {isModalOpen && (
                <LeadModal
                    key={editingLead?.id}
                    lead={editingLead}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onConvert={handleConvert}
                />
            )}

            {isSubscriberModalOpen && (
                <SubscriberModal
                    key={leadToConvert?.id}
                    subscriber={leadToConvert ? {
                        ...leadToConvert,
                        id: null,
                        status: 'ativacao',
                        originator_id: leadToConvert.originator_id
                    } : null}
                    onClose={() => setIsSubscriberModalOpen(false)}
                    onSave={handleSubscriberSaved}
                />
            )}

            {isSupplierModalOpen && (
                <SupplierModal
                    supplier={leadToConvert ? {
                        name: leadToConvert.name,
                        email: leadToConvert.email,
                        phone: leadToConvert.phone,
                        cnpj: leadToConvert.cpf_cnpj,
                        lead_id: leadToConvert.id,
                        // o banco copia o originador do lead (20261010d); aqui
                        // ele so aparece na tela desde a abertura do modal
                        originator_id: leadToConvert.originator_id,
                        address: {
                            cep: leadToConvert.cep,
                            logradouro: leadToConvert.rua,
                            rua: leadToConvert.rua,
                            numero: leadToConvert.numero,
                            complemento: leadToConvert.complemento,
                            bairro: leadToConvert.bairro,
                            municipio: leadToConvert.cidade,
                            cidade: leadToConvert.cidade,
                            uf: leadToConvert.uf
                        }
                    } : null}
                    onClose={() => setIsSupplierModalOpen(false)}
                    onSave={handleSupplierSaved}
                />
            )}
        </div>
    );
}
