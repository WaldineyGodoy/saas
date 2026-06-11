import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import { useBranding } from '../../contexts/BrandingContext';
import RateioListModal from '../../components/RateioListModal';
import {
    FileText, Clock, CheckCircle, Zap, Users, Calendar, Hash,
    Search, LayoutList, Columns, RefreshCw, Trash2, AlertTriangle, XCircle
} from 'lucide-react';
import {
    DndContext, PointerSensor, useSensor, useSensors,
    closestCorners, DragOverlay
} from '@dnd-kit/core';
import {
    SortableContext, verticalListSortingStrategy, useSortable
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

/* ── Constants ──────────────────────────────────────────────────── */
const STATUSES = [
    {
        id: 'criada', label: 'Criada', color: '#1d4ed8',
        bg: '#eff6ff', border: '#bfdbfe', icon: FileText, lightBg: '#dbeafe'
    },
    {
        id: 'processando', label: 'Processando', color: '#b45309',
        bg: '#fffbeb', border: '#fde68a', icon: Clock, lightBg: '#fef3c7'
    },
    {
        id: 'reprovada', label: 'Reprovada', color: '#dc2626',
        bg: '#fef2f2', border: '#fca5a5', icon: AlertTriangle, lightBg: '#fee2e2'
    },
    {
        id: 'concluida', label: 'Concluída', color: '#166534',
        bg: '#f0fdf4', border: '#bbf7d0', icon: CheckCircle, lightBg: '#dcfce7'
    },
    {
        id: 'cancelada', label: 'Cancelada', color: '#4b5563',
        bg: '#f3f4f6', border: '#d1d5db', icon: XCircle, lightBg: '#e5e7eb'
    }
];

function formatDateBR(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTimeBR(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/* ── Kanban Card ────────────────────────────────────────────────── */
function KanbanCard({ rateio, onClick, onDelete, isOverlay }) {
    const { branding } = useBranding();
    const { showConfirm } = useUI();
    const {
        attributes, listeners, setNodeRef,
        transform, transition, isDragging
    } = useSortable({ id: rateio.id, disabled: !!isOverlay });

    const statusCfg = STATUSES.find(s => s.id === rateio.status) || STATUSES[0];
    const StatusIcon = statusCfg.icon;

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        width: isOverlay ? '300px' : 'auto'
    };

    const handleDelete = async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm('Excluir Lista de Rateio', 'Esta ação não pode ser desfeita. Confirmar?', 'Sim, Excluir', 'Cancelar');
        if (confirmed) onDelete(rateio.id);
    };

    // Determine which date to show based on current status
    const statusDates = rateio.status_dates || {};
    let currentStatusDate = null;
    if (rateio.status === 'criada') currentStatusDate = rateio.created_at;
    else if (rateio.status === 'processando') currentStatusDate = statusDates.processando_at;
    else if (rateio.status === 'reprovada') currentStatusDate = statusDates.reprovada_at;
    else if (rateio.status === 'concluida') currentStatusDate = statusDates.concluida_at;
    else if (rateio.status === 'cancelada') currentStatusDate = statusDates.cancelada_at;

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(rateio)}
        >
            <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '1.1rem 1.2rem',
                border: `1px solid ${statusCfg.border}`,
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative',
                overflow: 'hidden'
            }}
                onMouseEnter={e => {
                    if (!isOverlay) {
                        e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.1)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.borderColor = branding?.primary_color || '#003366';
                    }
                }}
                onMouseLeave={e => {
                    if (!isOverlay) {
                        e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.borderColor = statusCfg.border;
                    }
                }}
            >
                {/* Left accent bar */}
                <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: '4px', background: statusCfg.color, borderRadius: '12px 0 0 12px'
                }} />

                {/* Status badge + delete */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', paddingLeft: '0.25rem' }}>
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                        fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase',
                        background: statusCfg.bg, color: statusCfg.color,
                        padding: '0.2rem 0.55rem', borderRadius: '99px', letterSpacing: '0.05em'
                    }}>
                        <StatusIcon size={10} />{statusCfg.label}
                    </span>
                    {!isOverlay && (
                        <button
                            onClick={handleDelete}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#cbd5e1', padding: '0.25rem', borderRadius: '6px',
                                lineHeight: 1, transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fee2e2'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.background = 'none'; }}
                        >
                            <Trash2 size={13} />
                        </button>
                    )}
                </div>

                {/* Usina name */}
                <div style={{ fontSize: '0.97rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.3rem', paddingLeft: '0.25rem', lineHeight: 1.3 }}>
                    {rateio.usina_name || 'Usina'}
                </div>

                {/* UG */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.65rem', paddingLeft: '0.25rem' }}>
                    <Zap size={12} color="#f59e0b" />
                    <span style={{ fontSize: '0.77rem', color: '#64748b', fontWeight: 600 }}>
                        UG: <strong style={{ color: '#1e293b' }}>{rateio.unidade_geradora || '-'}</strong>
                    </span>
                </div>

                {/* Protocolo (if set) */}
                {rateio.protocolo && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        marginBottom: '0.65rem', paddingLeft: '0.25rem',
                        background: '#f8fafc', borderRadius: '6px', padding: '0.3rem 0.5rem'
                    }}>
                        <Hash size={12} color="#8b5cf6" />
                        <span style={{ fontSize: '0.75rem', color: '#6d28d9', fontWeight: 700 }}>
                            {rateio.protocolo}
                        </span>
                    </div>
                )}

                {/* Stats row */}
                <div style={{
                    display: 'flex', gap: '0.5rem', marginTop: '0.5rem',
                    paddingTop: '0.6rem', borderTop: '1px solid #f1f5f9'
                }}>
                    <div style={{
                        flex: 1, background: '#f8fafc', borderRadius: '8px',
                        padding: '0.35rem 0.5rem', textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>UCs</div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#3b82f6' }}>{rateio.qtd_ucs || 0}</div>
                    </div>
                    <div style={{
                        flex: 2, background: '#f8fafc', borderRadius: '8px',
                        padding: '0.35rem 0.5rem'
                    }}>
                        <div style={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
                            {rateio.status === 'criada' ? 'Criado em' : 
                             rateio.status === 'processando' ? 'Iniciado em' : 
                             rateio.status === 'reprovada' ? 'Reprovado em' :
                             rateio.status === 'concluida' ? 'Concluído em' : 
                             rateio.status === 'cancelada' ? 'Cancelado em' : 'Atualizado em'}
                        </div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                            {currentStatusDate ? formatDateBR(currentStatusDate) : '-'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── Kanban Column ──────────────────────────────────────────────── */
function KanbanColumn({ status, rateios, onCardClick, onDelete }) {
    const { setNodeRef, isOver } = useDroppable({ id: status.id });
    const StatusIcon = status.icon;

    return (
        <div ref={setNodeRef} style={{
            minWidth: '300px', maxWidth: '300px', flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            background: isOver ? '#f1f5f9' : '#f8fafc',
            borderRadius: '14px',
            border: `1px solid ${isOver ? status.border : '#f1f5f9'}`,
            height: '100%',
            transition: 'all 0.2s ease',
            overflow: 'hidden'
        }}>
            {/* Column Header */}
            <div style={{
                padding: '1rem', background: 'white',
                borderBottom: `1px solid #e2e8f0`,
                borderTop: `4px solid ${status.color}`,
                borderRadius: '14px 14px 0 0',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <StatusIcon size={16} color={status.color} />
                    <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {status.label}
                    </span>
                </div>
                <span style={{
                    background: status.color, color: 'white',
                    borderRadius: '99px', fontSize: '0.75rem', fontWeight: 800,
                    padding: '0.15rem 0.55rem', minWidth: '26px', textAlign: 'center'
                }}>
                    {rateios.length}
                </span>
            </div>

            {/* Column content */}
            <div style={{
                flex: 1, overflowY: 'auto', padding: '0.75rem',
                display: 'flex', flexDirection: 'column', gap: '0.65rem'
            }} className="rateio-col-scroll">
                <SortableContext items={rateios.map(r => r.id)} strategy={verticalListSortingStrategy}>
                    {rateios.length === 0 ? (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            minHeight: '120px', color: '#cbd5e1', textAlign: 'center', padding: '1rem'
                        }}>
                            <StatusIcon size={24} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
                            <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 600 }}>Nenhum rateio aqui</p>
                        </div>
                    ) : (
                        rateios.map(r => (
                            <KanbanCard
                                key={r.id}
                                rateio={r}
                                onClick={onCardClick}
                                onDelete={onDelete}
                            />
                        ))
                    )}
                </SortableContext>
            </div>
        </div>
    );
}

/* ── Main Component ─────────────────────────────────────────────── */
export default function RateioList() {
    const { branding } = useBranding();
    const { showAlert } = useUI();
    const [rateios, setRateios] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('kanban');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRateio, setSelectedRateio] = useState(null);
    const [activeId, setActiveId] = useState(null);

    const primaryColor = branding?.primary_color || '#003366';

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    /* ── Data fetching ─────────────────────────────────────────── */
    const fetchRateios = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('rateio_lists')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            setRateios(data || []);
        } catch (err) {
            console.error('Error fetching rateios:', err);
            showAlert('Erro ao carregar listas de rateio.', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchRateios(); }, []);

    /* ── Filtering ─────────────────────────────────────────────── */
    const filtered = rateios.filter(r => {
        if (!searchTerm) return true;
        const q = searchTerm.toLowerCase();
        return (
            r.usina_name?.toLowerCase().includes(q) ||
            r.unidade_geradora?.toLowerCase().includes(q) ||
            r.concessionaria?.toLowerCase().includes(q) ||
            r.protocolo?.toLowerCase().includes(q) ||
            r.status?.toLowerCase().includes(q)
        );
    });

    /* ── Delete ────────────────────────────────────────────────── */
    const handleDelete = async (id) => {
        try {
            const { error } = await supabase.from('rateio_lists').delete().eq('id', id);
            if (error) throw error;
            setRateios(prev => prev.filter(r => r.id !== id));
            showAlert('Lista de Rateio excluída.', 'success');
        } catch (err) {
            showAlert('Erro ao excluir: ' + err.message, 'error');
        }
    };

    /* ── Drag & Drop ───────────────────────────────────────────── */
    const handleDragStart = (event) => setActiveId(event.active.id);

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);
        if (!over) return;

        const activeRateio = rateios.find(r => r.id === active.id);
        const isTargetStatus = STATUSES.some(s => s.id === over.id);

        let newStatus = over.id;
        if (!isTargetStatus) {
            const targetRateio = rateios.find(r => r.id === over.id);
            newStatus = targetRateio?.status;
        }

        if (!newStatus || !activeRateio || activeRateio.status === newStatus) return;

        const now = new Date().toISOString();
        const newStatusDates = {
            ...(activeRateio.status_dates || {}),
            [`${newStatus}_at`]: now
        };

        setRateios(prev => prev.map(r =>
            r.id === active.id ? { ...r, status: newStatus, status_dates: newStatusDates } : r
        ));

        try {
            const { error } = await supabase
                .from('rateio_lists')
                .update({ status: newStatus, status_dates: newStatusDates, updated_at: now })
                .eq('id', active.id);

            if (error) throw error;

            // If dragged to 'concluida', activate UCs
            if (newStatus === 'concluida' && activeRateio.usina_id) {
                const ucIds = (activeRateio.ucs_snapshot || [])
                    .filter(uc => !['ativo', 'cancelado', 'cancelado_inadimplente'].includes(uc.status))
                    .map(uc => uc.id).filter(Boolean);
                if (ucIds.length > 0) {
                    await supabase.from('consumer_units').update({ status: 'ativo' }).in('id', ucIds);
                }
            }
        } catch (err) {
            console.error('Error updating status:', err);
            fetchRateios();
        }
    };

    /* ── Summary stats ─────────────────────────────────────────── */
    const stats = {
        total: rateios.length,
        criada: rateios.filter(r => r.status === 'criada').length,
        processando: rateios.filter(r => r.status === 'processando').length,
        reprovada: rateios.filter(r => r.status === 'reprovada').length,
        concluida: rateios.filter(r => r.status === 'concluida').length,
        cancelada: rateios.filter(r => r.status === 'cancelada').length,
    };

    const activeRateio = rateios.find(r => r.id === activeId);

    return (
        <div style={{ fontFamily: "'Inter', sans-serif", minHeight: '100%' }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                .rateio-col-scroll::-webkit-scrollbar { width: 5px; }
                .rateio-col-scroll::-webkit-scrollbar-track { background: transparent; }
                .rateio-col-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
                .rateio-col-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                .rateio-list-row:hover td { background: #f8fafc; }
            `}</style>

            {/* ── Page Header ──────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: '#1e293b' }}>
                        Lista de Rateio
                    </h2>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                        Gerencie e acompanhe os rateios das usinas
                    </p>
                </div>
                <button
                    onClick={fetchRateios}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        padding: '0.55rem 1rem', background: 'white',
                        border: '1px solid #e2e8f0', borderRadius: '10px',
                        cursor: 'pointer', fontSize: '0.82rem', color: '#475569', fontWeight: 600
                    }}
                >
                    <RefreshCw size={14} /> Atualizar
                </button>
            </div>

            {/* ── Summary Cards ────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    { label: 'Total', value: stats.total, color: primaryColor, bg: primaryColor + '12', icon: FileText },
                    ...STATUSES.map(s => ({
                        label: s.label, value: stats[s.id],
                        color: s.color, bg: s.bg, icon: s.icon
                    }))
                ].map((stat, i) => (
                    <div key={i} style={{
                        background: 'white', borderRadius: '14px', padding: '1rem 1.25rem',
                        border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.75rem',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
                    }}>
                        <div style={{ padding: '0.55rem', background: stat.bg, borderRadius: '10px', color: stat.color, flexShrink: 0 }}>
                            <stat.icon size={18} />
                        </div>
                        <div>
                            <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{stat.label}</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#1e293b', lineHeight: 1 }}>{stat.value}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Toolbar ──────────────────────────────────────── */}
            <div style={{
                display: 'flex', gap: '1rem', marginBottom: '1.25rem',
                alignItems: 'center', flexWrap: 'wrap'
            }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: '380px' }}>
                    <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                        placeholder="Buscar por usina, UG, protocolo, concessionária..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.25rem',
                            border: '1px solid #e2e8f0', borderRadius: '10px',
                            fontSize: '0.85rem', outline: 'none', background: 'white',
                            fontFamily: 'inherit', color: '#1e293b',
                            transition: 'border-color 0.2s'
                        }}
                        onFocus={e => e.target.style.borderColor = primaryColor}
                        onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                    />
                </div>

                {/* View toggle */}
                <div style={{
                    display: 'flex', border: '1px solid #e2e8f0',
                    borderRadius: '10px', overflow: 'hidden', background: 'white'
                }}>
                    {[
                        { id: 'list', icon: LayoutList, label: 'Lista' },
                        { id: 'kanban', icon: Columns, label: 'Kanban' }
                    ].map(v => (
                        <button key={v.id} onClick={() => setViewMode(v.id)} style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.5rem 0.9rem', border: 'none',
                            background: viewMode === v.id ? primaryColor : 'transparent',
                            color: viewMode === v.id ? 'white' : '#64748b',
                            cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
                            transition: 'all 0.2s'
                        }}>
                            <v.icon size={14} />{v.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Content ──────────────────────────────────────── */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#94a3b8' }}>
                    <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: '0.75rem' }} />
                    <p style={{ margin: 0 }}>Carregando...</p>
                </div>
            ) : viewMode === 'kanban' ? (

                /* ── Kanban View ─────────────────────────────── */
                <div style={{
                    background: 'white', borderRadius: '16px',
                    border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    padding: '1.25rem', overflowX: 'auto', overflowY: 'hidden',
                    height: 'calc(100vh - 320px)', display: 'flex', flexDirection: 'column'
                }}>
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCorners}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragCancel={() => setActiveId(null)}
                    >
                        <div style={{ display: 'flex', gap: '1rem', flex: 1, minHeight: 0, alignItems: 'stretch' }}>
                            {STATUSES.map(status => (
                                <KanbanColumn
                                    key={status.id}
                                    status={status}
                                    rateios={filtered.filter(r => r.status === status.id)}
                                    onCardClick={r => setSelectedRateio(r)}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </div>
                        <DragOverlay adjustScale={false}>
                            {activeId && activeRateio ? (
                                <KanbanCard rateio={activeRateio} onClick={() => {}} onDelete={() => {}} isOverlay />
                            ) : null}
                        </DragOverlay>
                    </DndContext>
                </div>

            ) : (

                /* ── List View ───────────────────────────────── */
                <div style={{
                    background: 'white', borderRadius: '16px',
                    border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    overflow: 'hidden'
                }}>
                    {filtered.length === 0 ? (
                        <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                            <FileText size={32} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
                            <p style={{ margin: 0, fontWeight: 600 }}>Nenhuma lista de rateio encontrada.</p>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc' }}>
                                    {['Usina', 'Unid. Geradora', 'Protocolo', 'Concessionária', 'UCs', 'Status', 'Criado em', 'Última Atualização', 'Ações'].map((h, i) => (
                                        <th key={i} style={{
                                            padding: '0.85rem 1rem', textAlign: 'left',
                                            color: '#64748b', fontWeight: 700, fontSize: '0.72rem',
                                            textTransform: 'uppercase', letterSpacing: '0.04em',
                                            borderBottom: '1px solid #e2e8f0',
                                            whiteSpace: 'nowrap'
                                        }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(r => {
                                    const statusCfg = STATUSES.find(s => s.id === r.status) || STATUSES[0];
                                    const StatusIcon = statusCfg.icon;
                                    return (
                                        <tr key={r.id} className="rateio-list-row" style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                                            onClick={() => setSelectedRateio(r)}>
                                            <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#1e293b' }}>
                                                {r.usina_name || '-'}
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                    <Zap size={13} color="#f59e0b" />
                                                    <span style={{ fontWeight: 600, color: '#475569' }}>{r.unidade_geradora || '-'}</span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem' }}>
                                                {r.protocolo ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                        <Hash size={12} color="#8b5cf6" />
                                                        <span style={{ fontWeight: 700, color: '#6d28d9', fontSize: '0.82rem' }}>{r.protocolo}</span>
                                                    </div>
                                                ) : (
                                                    <span style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem', color: '#475569' }}>{r.concessionaria || '-'}</td>
                                            <td style={{ padding: '0.9rem 1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                    <Users size={13} color="#3b82f6" />
                                                    <span style={{ fontWeight: 700, color: '#1e293b' }}>{r.qtd_ucs || 0}</span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem' }}>
                                                <span style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                                                    padding: '0.3rem 0.7rem', borderRadius: '99px',
                                                    fontSize: '0.72rem', fontWeight: 800,
                                                    background: statusCfg.bg, color: statusCfg.color
                                                }}>
                                                    <StatusIcon size={11} />{statusCfg.label}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem', color: '#64748b', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                    <Calendar size={12} />
                                                    {formatDateTimeBR(r.created_at)}
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem', color: '#64748b', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                    <Calendar size={12} />
                                                    {formatDateTimeBR(r.updated_at)}
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem' }} onClick={e => e.stopPropagation()}>
                                                <button
                                                    onClick={() => handleDelete(r.id)}
                                                    style={{
                                                        background: '#fee2e2', border: 'none', borderRadius: '7px',
                                                        padding: '0.35rem 0.5rem', cursor: 'pointer', color: '#ef4444',
                                                        lineHeight: 1
                                                    }}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* ── Modal ──────────────────────────────────────── */}
            {selectedRateio && (
                <RateioListModal
                    rateio={selectedRateio}
                    onClose={() => setSelectedRateio(null)}
                    onUpdated={() => {
                        setSelectedRateio(null);
                        fetchRateios();
                    }}
                />
            )}
        </div>
    );
}
