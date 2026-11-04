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
    Search,
    Plus,
    X,
    Columns3,
    List,
    Calendar,
    Zap,
    Mail,
    Phone,
    Tag,
    Filter
} from 'lucide-react';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    rectIntersection,
    pointerWithin,
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
    // Mesmos nomes das etapas do Deskcomm (padronização de 03/11/2026).
    { status: 'qualificando', label: 'Qualificando', color: '#14b8a6' },
    { status: 'simulacao', label: 'Simulação', color: '#64748b' },
    { status: 'negociacao', label: 'Negociação', color: '#eab308' },
    { status: 'reuniao_agendada', label: 'Reunião Agendada', color: '#f97316' },
    { status: 'contrato_enviado', label: 'Contrato Enviado', color: '#8b5cf6' }, // taste-skill-ignore
    { status: 'ativacao', label: 'Ativação', color: '#7c3aed' }, // taste-skill-ignore
    { status: 'ativo', label: 'Ativo', color: '#22c55e' }, // taste-skill-ignore
    { status: 'pago', label: 'Pago', color: '#06b6d4' },
    { status: 'negocio_perdido', label: 'Negócio Perdido', color: '#ef4444' } // taste-skill-ignore
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

// Paleta de avatares neutra/distinta (evitando violeta/indigo conforme app-screens.md)
const AVATAR_PALETTES = [
    { bg: '#e0f2fe', color: '#0369a1' },
    { bg: '#dcfce7', color: '#15803d' },
    { bg: '#fef3c7', color: '#b45309' },
    { bg: '#ffe4e6', color: '#be123c' },
    { bg: '#ccfbf1', color: '#0f766e' },
    { bg: '#ffedd5', color: '#c2410c' }
];

function iniciaisDoNome(nome) {
    if (!nome) return '?';
    const partes = String(nome).trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return '?';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function corAvatar(nome) {
    const str = String(nome || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

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
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 1000 : 1,
        position: 'relative',
        width: isOverlay ? '292px' : 'auto',
        boxShadow: isOverlay ? '0 14px 28px -6px rgba(15, 23, 42, 0.18)' : undefined
    };

    const temConsumo = Number(lead.consumo_kwh) > 0;
    const origName = lead.originator?.name;
    const origAvatar = origName ? corAvatar(origName) : null;

    return (
        <div
            ref={setNodeRef}
            className={`kanban-card${novo ? ' is-new-lead' : ''}`}
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(lead)}
        >
            <div className="leads-card-header">
                <span className="leads-card-name">{lead.name || 'Sem nome'}</span>
                <span className="leads-card-badges">
                    <SeloJev lead={lead} />
                    {novo && <SeloNew />}
                </span>
            </div>

            <div className="leads-card-energy-bar">
                <span className="leads-card-concessionaria" title={lead.concessionaria || 'N/A'}>
                    <Zap size={12} style={{ color: '#0284c7', flexShrink: 0 }} aria-hidden />
                    {lead.concessionaria || 'N/A'}
                </span>
                <span className={`leads-card-kwh${temConsumo ? '' : ' is-zero'}`}>
                    {temConsumo ? `${Number(lead.consumo_kwh).toLocaleString('pt-BR')} kWh` : '0 kWh'}
                </span>
            </div>

            {lead.tags && lead.tags.length > 0 && (
                <div className="leads-card-tags">
                    {lead.tags.map(tag => {
                        const tagStyle = getTagColor(tag);
                        return (
                            <span
                                key={tag}
                                className="leads-card-tag"
                                style={{
                                    color: tagStyle.color,
                                    backgroundColor: tagStyle.bg,
                                    border: `1px solid color-mix(in srgb, ${tagStyle.color} 22%, transparent)`
                                }}
                            >
                                {tag}
                            </span>
                        );
                    })}
                </div>
            )}

            <div className="leads-card-contacts">
                {lead.email && (
                    <div className="leads-card-contact-line" title={lead.email}>
                        <Mail size={12} aria-hidden />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.email}</span>
                    </div>
                )}
                {lead.phone && (
                    <div className="leads-card-contact-line">
                        <Phone size={12} aria-hidden />
                        <span>{lead.phone}</span>
                    </div>
                )}
                {!lead.email && !lead.phone && (
                    <div className="leads-card-contact-line" style={{ color: '#6b6b6b' }}>
                        <span>Sem dados de contato</span>
                    </div>
                )}
            </div>

            <div className="leads-card-footer">
                <span className="leads-card-originator" title={origName || ' Sem originador'}>
                    {origName ? (
                        <>
                            <span
                                className="leads-avatar-mini"
                                style={{ backgroundColor: origAvatar.bg, color: origAvatar.color }}
                            >
                                {iniciaisDoNome(origName)}
                            </span>
                            <span>{origName.split(' ')[0]}</span>
                        </>
                    ) : (
                        <span>-</span>
                    )}
                </span>
                <span>{new Date(lead.created_at).toLocaleDateString('pt-BR')}</span>
            </div>
        </div>
    );
}

function KanbanColumn({ status, label, color, leads, onCardClick, leadEhNovo }) {
    const { setNodeRef, isOver } = useDroppable({
        id: status,
    });

    const somaKwh = leads.reduce((acc, l) => acc + (Number(l.consumo_kwh) || 0), 0);
    const temNovos = leads.some(leadEhNovo);

    return (
        <div
            ref={setNodeRef}
            className={`kanban-column${isOver ? ' is-over' : ''}`}
            style={{
                borderTop: `3px solid ${color}`
            }}
        >
            <div className="kanban-column-header">
                <div className="leads-col-title-wrap">
                    <span
                        className="leads-col-dot"
                        style={{ backgroundColor: color }}
                        aria-hidden
                    />
                    <span className="leads-col-title" title={label}>
                        {label}
                    </span>
                    {temNovos && <SeloNew />}
                </div>
                <div className="leads-col-meta">
                    {somaKwh > 0 && (
                        <span className="leads-col-kwh" title={`${somaKwh.toLocaleString('pt-BR')} kWh nesta etapa`}>
                            {somaKwh >= 10000
                                ? `${(somaKwh / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k kWh`
                                : `${somaKwh.toLocaleString('pt-BR')} kWh`}
                        </span>
                    )}
                    <span
                        className="leads-col-count"
                        style={{
                            background: `color-mix(in srgb, ${color} 15%, #ffffff)`,
                            color: color,
                            border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`
                        }}
                    >
                        {leads.length}
                    </span>
                </div>
            </div>
            <div className="kanban-column-content">
                <SortableContext
                    items={leads.map(l => l.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {leads.length === 0 ? (
                        <div className="leads-kanban-empty">
                            {isOver ? 'Solte para mover para esta etapa' : 'Nenhum lead nesta etapa'}
                        </div>
                    ) : (
                        leads.map(lead => (
                            <KanbanCard key={lead.id} lead={lead} onClick={onCardClick} novo={leadEhNovo(lead)} />
                        ))
                    )}
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
    const contagemPorCategoria = {};
    const contagemPorStatus = {};

    for (const lead of leads) {
        const visivelNaBase = !lead.arquivado_em || mostrarArquivados;
        if (visivelNaBase) {
            for (const categoria of categoriasDoLead(lead)) {
                contagemPorCategoria[categoria] = (contagemPorCategoria[categoria] || 0) + 1;
            }
            const st = statusDoLead(lead);
            contagemPorStatus[st] = (contagemPorStatus[st] || 0) + 1;
        }

        if (!leadEhNovo(lead)) continue;
        for (const categoria of categoriasDoLead(lead)) {
            (novosPorCategoria[categoria] ||= []).push(lead);
        }
        (novosPorStatus[statusDoLead(lead)] ||= []).push(lead);
    }

    const totalNovos = leads.filter(leadEhNovo).length;
    const totalKwhFiltrado = filteredLeads.reduce((acc, l) => acc + (Number(l.consumo_kwh) || 0), 0);
    const qtdArquivados = leads.filter(l => l.arquivado_em).length;
    const temFiltroAtivo = selectedTags.length > 0 || selectedStatuses.length > 0 || Boolean(searchTerm);

    const limparFiltros = () => {
        setSelectedTags([]);
        setSelectedStatuses([]);
        setSearchTerm('');
    };

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
        <div className="leads-workspace">
            {/* Top Bar: Title, Live Metrics Strip, View Switcher & Primary CTA */}
            <div className="leads-top-bar">
                <div className="leads-title-group">
                    <h1 className="leads-page-title">Gestão de Leads</h1>
                    <div className="leads-kpi-strip">
                        <span className="leads-kpi-item">
                            <strong>{filteredLeads.length}</strong> {filteredLeads.length === 1 ? 'lead exibido' : 'leads exibidos'}
                        </span>
                        <span className="leads-kpi-divider" aria-hidden />
                        <span className="leads-kpi-item">
                            Volume no funil: <strong>{totalKwhFiltrado.toLocaleString('pt-BR')} kWh</strong>
                        </span>
                        {totalNovos > 0 && (
                            <>
                                <span className="leads-kpi-divider" aria-hidden />
                                <span className="leads-kpi-new-badge" title="Leads recentes ainda não visualizados">
                                    <span className="leads-kpi-new-dot" aria-hidden />
                                    {textoNovos(totalNovos)}
                                </span>
                            </>
                        )}
                    </div>
                </div>

                <div className="leads-top-actions">
                    <div className="leads-view-segmented" role="group" aria-label="Modo de visualização">
                        <button
                            type="button"
                            onClick={() => setViewMode('kanban')}
                            className={`leads-view-tab ${viewMode === 'kanban' ? 'is-active' : ''}`}
                        >
                            <Columns3 size={14} aria-hidden />
                            Kanban
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('list')}
                            className={`leads-view-tab ${viewMode === 'list' ? 'is-active' : ''}`}
                        >
                            <List size={14} aria-hidden />
                            Lista
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('agenda')}
                            className={`leads-view-tab ${viewMode === 'agenda' ? 'is-active' : ''}`}
                        >
                            <Calendar size={14} aria-hidden />
                            Agenda
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => { setEditingLead(null); setIsModalOpen(true); }}
                        className="leads-btn-new"
                    >
                        <Plus size={15} aria-hidden />
                        Novo Lead
                    </button>
                </div>
            </div>

            {/* Reorganized Control & Filter Console */}
            <div className="leads-filter-panel">
                {/* Row 1: Search & View Toggles */}
                <div className="leads-toolbar-row">
                    <div className="leads-search-box">
                        <Search size={15} className="leads-search-icon" aria-hidden />
                        <input
                            type="text"
                            placeholder="Buscar por nome, email, telefone, concessionária..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="leads-search-input"
                            aria-label="Buscar leads"
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={() => setSearchTerm('')}
                                className="leads-search-clear"
                                title="Limpar busca"
                                aria-label="Limpar busca"
                            >
                                <X size={13} />
                            </button>
                        )}
                    </div>

                    <div className="leads-toolbar-toggles">
                        {temFiltroAtivo && (
                            <button
                                type="button"
                                onClick={limparFiltros}
                                className="leads-clear-filters-btn"
                            >
                                <X size={13} aria-hidden />
                                Limpar filtros ({selectedTags.length + selectedStatuses.length + (searchTerm ? 1 : 0)})
                            </button>
                        )}

                        {viewMode === 'kanban' && (
                            <label
                                htmlFor="hide-empty"
                                className={`leads-toggle-pill ${hideEmptyStatuses ? 'is-checked' : ''}`}
                            >
                                <input
                                    type="checkbox"
                                    id="hide-empty"
                                    checked={hideEmptyStatuses}
                                    onChange={e => setHideEmptyStatuses(e.target.checked)}
                                />
                                Ocultar colunas vazias
                            </label>
                        )}

                        <label
                            htmlFor="mostrar-arquivados"
                            className={`leads-toggle-pill ${mostrarArquivados ? 'is-checked' : ''}`}
                        >
                            <input
                                type="checkbox"
                                id="mostrar-arquivados"
                                checked={mostrarArquivados}
                                onChange={e => setMostrarArquivados(e.target.checked)}
                            />
                            Mostrar arquivados ({qtdArquivados})
                        </label>
                    </div>
                </div>

                {/* Row 2 & 3: Structured Tag Selector & Status Filter (Preserving Pulse on New Leads) */}
                <div className="leads-filter-rows">
                    {/* Seletor de Tags / Categorias */}
                    <div className="leads-filter-row">
                        <div className="leads-filter-label">
                            <Tag size={13} aria-hidden />
                            <span>Categorias:</span>
                        </div>
                        <div className="leads-filter-rail">
                            {[...CATEGORIAS, SEM_CATEGORIA].map(tag => {
                                const cor = tag === SEM_CATEGORIA ? COR_SEM_CATEGORIA : getTagColor(`#${tag}`);
                                const selecionada = selectedTags.includes(tag);
                                const qtdNovos = novosPorCategoria[tag]?.length || 0;
                                const qtdTotal = contagemPorCategoria[tag] || 0;
                                const corTextoSelecionado = textoSobre(cor.color);

                                return (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => alternarCategoria(tag)}
                                        className={`lead-filter-chip${qtdNovos > 0 ? ' lead-tag-pulso' : ''}`}
                                        title={qtdNovos > 0 ? textoNovos(qtdNovos) : undefined}
                                        aria-pressed={selecionada}
                                        style={{
                                            '--pulso-cor': cor.color,
                                            border: `1px solid ${selecionada ? cor.color : `color-mix(in srgb, ${cor.color} 38%, transparent)`}`,
                                            background: selecionada ? cor.color : cor.bg,
                                            color: selecionada ? corTextoSelecionado : cor.color,
                                            fontWeight: selecionada ? 600 : 500
                                        }}
                                    >
                                        <span
                                            className="lead-filter-chip-dot"
                                            style={{ backgroundColor: selecionada ? corTextoSelecionado : cor.color }}
                                            aria-hidden
                                        />
                                        <span>{tag === SEM_CATEGORIA ? 'Sem categoria' : tag}</span>
                                        <span className="lead-filter-chip-count">{qtdTotal}</span>
                                        {qtdNovos > 0 && (
                                            <span className="lead-filter-chip-new">+{qtdNovos}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Filtro de Status / Etapas */}
                    <div className="leads-filter-row">
                        <div className="leads-filter-label">
                            <Filter size={13} aria-hidden />
                            <span>Filtrar Status:</span>
                        </div>
                        <div className="leads-filter-rail">
                            {KANBAN_STATUSES.map(s => {
                                const selecionada = selectedStatuses.includes(s.status);
                                const qtdNovos = novosPorStatus[s.status]?.length || 0;
                                const qtdTotal = contagemPorStatus[s.status] || 0;
                                const corTextoSelecionado = textoSobre(s.color);

                                return (
                                    <button
                                        key={s.status}
                                        type="button"
                                        onClick={() => alternarStatus(s.status)}
                                        className={`lead-filter-chip${qtdNovos > 0 ? ' lead-tag-pulso' : ''}`}
                                        title={qtdNovos > 0 ? textoNovos(qtdNovos) : undefined}
                                        aria-pressed={selecionada}
                                        style={{
                                            '--pulso-cor': s.color,
                                            border: `1px solid ${selecionada ? s.color : s.color + '45'}`,
                                            background: selecionada ? s.color : s.color + '14',
                                            color: selecionada ? corTextoSelecionado : s.color,
                                            fontWeight: selecionada ? 600 : 500
                                        }}
                                    >
                                        <span
                                            className="lead-filter-chip-dot"
                                            style={{ backgroundColor: selecionada ? corTextoSelecionado : s.color }}
                                            aria-hidden
                                        />
                                        <span>{s.label}</span>
                                        <span className="lead-filter-chip-count">{qtdTotal}</span>
                                        {qtdNovos > 0 && (
                                            <span className="lead-filter-chip-new">+{qtdNovos}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="leads-table-panel" style={{ padding: '2.5rem', textAlign: 'center', color: '#5f6368' }}>
                    Carregando leads...
                </div>
            ) : (
                <>
                    {viewMode === 'agenda' ? (
                        <LeadAgenda onLeadClick={abrirLead} />
                    ) : viewMode === 'list' ? (
                        <div className="leads-table-panel">
                            <div className="leads-table-summary">
                                <span>
                                    Mostrando <strong>{filteredLeads.length}</strong> {filteredLeads.length === 1 ? 'registro' : 'registros'}
                                    {temFiltroAtivo ? ' com os filtros aplicados' : ''}
                                </span>
                                <span>
                                    Consumo somado na lista: <strong>{totalKwhFiltrado.toLocaleString('pt-BR')} kWh</strong>
                                </span>
                            </div>
                            <div className="table-container">
                                {filteredLeads.length === 0 ? (
                                    <p style={{ padding: '2.5rem', textAlign: 'center', color: '#5f6368', fontSize: '0.875rem' }}>
                                        Nenhum lead encontrado para os filtros selecionados.
                                    </p>
                                ) : (
                                    <table className="leads-modern-table">
                                        <thead>
                                            <tr>
                                                <th>Nome</th>
                                                <th>Concessionária</th>
                                                <th className="num">Consumo (kWh)</th>
                                                <th>Contato</th>
                                                <th>Status</th>
                                                <th>Originador</th>
                                                <th style={{ textAlign: 'right' }}>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredLeads.map(lead => {
                                                const ehNovo = leadEhNovo(lead);
                                                const avatar = corAvatar(lead.name);
                                                const statusObj = KANBAN_STATUSES.find(s => s.status === lead.status);
                                                const statusColor = statusObj?.color || '#64748b';
                                                const statusLabel = statusObj?.label || lead.status;
                                                const origName = lead.originator?.name;
                                                const origAvatar = origName ? corAvatar(origName) : null;
                                                const temConsumo = Number(lead.consumo_kwh) > 0;

                                                return (
                                                    <tr key={lead.id} className={ehNovo ? 'is-new-row' : undefined}>
                                                        <td>
                                                            <div className="leads-list-identity">
                                                                <span
                                                                    className="leads-avatar-md"
                                                                    style={{ backgroundColor: avatar.bg, color: avatar.color }}
                                                                    aria-hidden
                                                                >
                                                                    {iniciaisDoNome(lead.name)}
                                                                </span>
                                                                <div className="leads-list-name-block">
                                                                    <div className="leads-list-name-row">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => abrirLead(lead)}
                                                                            className="leads-list-name-btn"
                                                                        >
                                                                            {lead.name || 'Sem nome'}
                                                                        </button>
                                                                        {ehNovo && <SeloNew />}
                                                                        <SeloJev lead={lead} />
                                                                    </div>
                                                                    <span className="leads-list-subdate">
                                                                        Criado em {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            {lead.concessionaria ? (
                                                                <span style={{ fontWeight: 500, color: '#334155' }}>
                                                                    {lead.concessionaria}
                                                                </span>
                                                            ) : (
                                                                <span style={{ color: '#6b6b6b' }}>-</span>
                                                            )}
                                                        </td>
                                                        <td className="num">
                                                            {temConsumo ? (
                                                                <span>
                                                                    <strong style={{ color: '#111827', fontWeight: 600 }}>
                                                                        {Number(lead.consumo_kwh).toLocaleString('pt-BR')}
                                                                    </strong>{' '}
                                                                    <span style={{ fontSize: '0.75rem', color: '#5f6368' }}>kWh</span>
                                                                </span>
                                                            ) : (
                                                                <span style={{ color: '#6b6b6b' }}>-</span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <div style={{ fontSize: '0.84rem', color: '#1f2937', lineHeight: 1.35 }}>
                                                                {lead.email || '-'}
                                                            </div>
                                                            <div style={{ fontSize: '0.76rem', color: '#5f6368', marginTop: '0.15rem', fontVariantNumeric: 'tabular-nums' }}>
                                                                {lead.phone || '-'}
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <span
                                                                className="leads-status-pill"
                                                                style={{
                                                                    background: `color-mix(in srgb, ${statusColor} 14%, #ffffff)`,
                                                                    color: statusColor,
                                                                    border: `1px solid color-mix(in srgb, ${statusColor} 30%, transparent)`
                                                                }}
                                                            >
                                                                <span
                                                                    className="lead-filter-chip-dot"
                                                                    style={{ backgroundColor: statusColor }}
                                                                    aria-hidden
                                                                />
                                                                {statusLabel}
                                                            </span>
                                                            {lead.tags && lead.tags.length > 0 && (
                                                                <div style={{ display: 'flex', gap: '0.28rem', flexWrap: 'wrap', marginTop: '0.38rem' }}>
                                                                    {lead.tags.map(tag => {
                                                                        const style = getTagColor(tag);
                                                                        return (
                                                                            <span
                                                                                key={tag}
                                                                                className="leads-card-tag"
                                                                                style={{
                                                                                    color: style.color,
                                                                                    backgroundColor: style.bg,
                                                                                    border: `1px solid color-mix(in srgb, ${style.color} 22%, transparent)`
                                                                                }}
                                                                            >
                                                                                {tag}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td>
                                                            {origName ? (
                                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#334155', fontSize: '0.8125rem' }}>
                                                                    <span
                                                                        className="leads-avatar-mini"
                                                                        style={{ backgroundColor: origAvatar.bg, color: origAvatar.color }}
                                                                        aria-hidden
                                                                    >
                                                                        {iniciaisDoNome(origName)}
                                                                    </span>
                                                                    <span>{origName}</span>
                                                                </span>
                                                            ) : (
                                                                <span style={{ color: '#6b6b6b' }}>-</span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <div className="leads-row-actions">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => abrirLead(lead)}
                                                                    className="leads-action-btn"
                                                                >
                                                                    Editar
                                                                </button>
                                                                {!['ativacao', 'ativo', 'pago', 'negocio_perdido'].includes(lead.status) && (
                                                                    <select
                                                                        aria-label={`Converter lead ${lead.name || ''}`}
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
                                                                        className="leads-convert-select"
                                                                    >
                                                                        <option value="">Converter...</option>
                                                                        <option value="embaixador">Embaixador</option>
                                                                        <option value="assinante">Assinante</option>
                                                                        <option value="fornecedor">Fornecedor</option>
                                                                        <option value="dono_areas">Dono de Áreas/Vagas</option>
                                                                    </select>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
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
