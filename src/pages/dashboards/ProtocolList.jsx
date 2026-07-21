import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import { useBranding } from '../../contexts/BrandingContext';
import ProtocolModal from '../../components/ProtocolModal';
import UnificationModal from '../../components/UnificationModal';
import {
    FileText, Clock, CheckCircle, AlertTriangle, List, Columns, Search, RefreshCw, Trash2, Plus, Calendar, Hash, Tag, Link as LinkIcon, Layers
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
        id: 'gerar', label: 'Gerar', color: '#1d4ed8',
        bg: '#eff6ff', border: '#bfdbfe', icon: FileText, lightBg: '#dbeafe'
    },
    {
        id: 'em_tratativa', label: 'Em Tratativa', color: '#b45309',
        bg: '#fffbeb', border: '#fde68a', icon: Clock, lightBg: '#fef3c7'
    },
    {
        id: 'replica', label: 'Réplica', color: '#6d28d9',
        bg: '#f5f3ff', border: '#ddd6fe', icon: RefreshCw, lightBg: '#ede9fe'
    },
    {
        id: 'atrasado', label: 'Atrasado', color: '#dc2626',
        bg: '#fef2f2', border: '#fecaca', icon: AlertTriangle, lightBg: '#fee2e2'
    },
    {
        id: 'concluida', label: 'Concluída', color: '#166534',
        bg: '#f0fdf4', border: '#bbf7d0', icon: CheckCircle, lightBg: '#dcfce7'
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
function KanbanCard({ protocol, onClick, onDelete, isOverlay }) {
    const { branding } = useBranding();
    const { showConfirm } = useUI();
    const {
        attributes, listeners, setNodeRef,
        transform, transition, isDragging
    } = useSortable({ id: protocol.id, disabled: !!isOverlay });

    const statusCfg = STATUSES.find(s => s.id === protocol.status) || STATUSES[0];
    const StatusIcon = statusCfg.icon;

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        width: isOverlay ? '300px' : 'auto'
    };

    const handleDelete = async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm('Excluir Protocolo', 'Esta ação removerá permanentemente o protocolo e subtarefas. Confirmar?', 'Excluir', 'Cancelar');
        if (confirmed) onDelete(protocol.id);
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(protocol)}
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
                {/* Accent bar */}
                <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: '4px', background: statusCfg.color, borderRadius: '12px 0 0 12px'
                }} />

                {/* 1 - Status and Protocol (same line) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase',
                        background: statusCfg.bg, color: statusCfg.color,
                        padding: '0.2rem 0.55rem', borderRadius: '99px', letterSpacing: '0.04em'
                    }}>
                        <StatusIcon size={10} />{statusCfg.label}
                    </span>
                    {(() => {
                        const displayProtoNum = protocol.latest_sub_protocol_number || protocol.protocol_number;
                        return displayProtoNum ? (
                            <span style={{ fontSize: '0.72rem', color: '#6d28d9', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                <Hash size={11} /> {displayProtoNum}
                            </span>
                        ) : (
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic' }}>Sem nº</span>
                        );
                    })()}
                </div>

                {protocol.sub_protocols_count > 0 && (
                    <div style={{ marginBottom: '0.4rem' }}>
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                            fontSize: '0.65rem', fontWeight: 800,
                            background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                            padding: '0.15rem 0.5rem', borderRadius: '6px'
                        }}>
                            <Layers size={11} /> {protocol.sub_protocols_count} {protocol.sub_protocols_count === 1 ? 'Caso Unificado' : 'Casos Unificados'}
                        </span>
                    </div>
                )}

                {/* 2 - Nome da entidade */}
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <LinkIcon size={13} style={{ color: '#64748b', flexShrink: 0 }} />
                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', width: '100%' }}>
                        {protocol.linked_entity_name || 'Entidade não vinculada'}
                    </span>
                </div>

                {/* 3 - Titulo do protocolo (small font) */}
                <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 500, marginBottom: '0.6rem', lineHeight: 1.3 }}>
                    {protocol.title}
                </div>

                {/* 4 - Vencimento */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: '#f8fafc', borderRadius: '8px', padding: '0.4rem 0.6rem',
                    marginBottom: '0.75rem'
                }}>
                    <span style={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Vencimento</span>
                    <span style={{
                        fontSize: '0.72rem', fontWeight: 700,
                        color: protocol.status === 'concluida' ? '#166534' : 
                               (protocol.status === 'atrasado' ? '#ef4444' : '#475569')
                    }}>
                        {protocol.due_date ? formatDateBR(protocol.due_date) : 'Sem prazo'}
                    </span>
                </div>

                {/* 5 - Lixeira e visualizar (same line - inferior) */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    paddingTop: '0.6rem', borderTop: '1px solid #f1f5f9'
                }} onClick={e => e.stopPropagation()}>
                    {!isOverlay ? (
                        <button
                            onClick={handleDelete}
                            style={{
                                background: '#fee2e2', border: 'none', cursor: 'pointer',
                                color: '#ef4444', padding: '0.35rem 0.5rem', borderRadius: '6px',
                                display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.72rem', fontWeight: 700,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#fecaca'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#fee2e2'; }}
                        >
                            <Trash2 size={13} /> Excluir
                        </button>
                    ) : <div />}
                    
                    {!isOverlay ? (
                        <button
                            onClick={() => onClick(protocol)}
                            style={{
                                background: branding?.primary_color || '#003366', border: 'none', cursor: 'pointer',
                                color: 'white', padding: '0.35rem 0.65rem', borderRadius: '6px',
                                display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.72rem', fontWeight: 700,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
                        >
                            Visualizar
                        </button>
                    ) : <div />}
                </div>
            </div>
        </div>
    );
}

/* ── Kanban Column ──────────────────────────────────────────────── */
function KanbanColumn({ status, protocols, onCardClick, onDelete }) {
    const { setNodeRef, isOver } = useDroppable({ id: status.id });
    const StatusIcon = status.icon;

    return (
        <div ref={setNodeRef} style={{
            minWidth: '280px', maxWidth: '280px', flexShrink: 0,
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
                padding: '0.85rem 1rem', background: 'white',
                borderBottom: `1px solid #e2e8f0`,
                borderTop: `4px solid ${status.color}`,
                borderRadius: '14px 14px 0 0',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <StatusIcon size={14} color={status.color} />
                    <span style={{ fontWeight: 800, fontSize: '0.78rem', color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {status.label}
                    </span>
                </div>
                <span style={{
                    background: status.color, color: 'white',
                    borderRadius: '99px', fontSize: '0.7rem', fontWeight: 800,
                    padding: '0.1rem 0.45rem', minWidth: '22px', textAlign: 'center'
                }}>
                    {protocols.length}
                </span>
            </div>

            {/* Column content */}
            <div style={{
                flex: 1, overflowY: 'auto', padding: '0.65rem',
                display: 'flex', flexDirection: 'column', gap: '0.6rem'
            }} className="rateio-col-scroll">
                <SortableContext items={protocols.map(p => p.id)} strategy={verticalListSortingStrategy}>
                    {protocols.length === 0 ? (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            minHeight: '100px', color: '#cbd5e1', textAlign: 'center', padding: '1rem'
                        }}>
                            <StatusIcon size={20} style={{ opacity: 0.4, marginBottom: '0.4rem' }} />
                            <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 600 }}>Nenhum chamado</p>
                        </div>
                    ) : (
                        protocols.map(p => (
                            <KanbanCard
                                key={p.id}
                                protocol={p}
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
export default function ProtocolList() {
    const { branding } = useBranding();
    const { showAlert } = useUI();
    const [protocols, setProtocols] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('kanban');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProtocol, setSelectedProtocol] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [activeId, setActiveId] = useState(null);
    const [sortBy, setSortBy] = useState('created_at_desc');
    const [unifyingSource, setUnifyingSource] = useState(null);
    const [unifyingTarget, setUnifyingTarget] = useState(null);
    const [showUnificationModal, setShowUnificationModal] = useState(false);

    const getSortedKanbanProtocols = (statusId, items) => {
        const list = items.filter(p => p.status === statusId);
        if (statusId === 'gerar') {
            // por data de criação - mais antigos primeiros
            return list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        }
        if (statusId === 'em_tratativa') {
            // por ordem de vencimento: os vencimentos mais proximos primeiros
            return list.sort((a, b) => {
                const dueA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
                const dueB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
                return dueA - dueB;
            });
        }
        if (statusId === 'replica') {
            // por ordem de vencimento: os vencimentos mais proximos primeiros
            return list.sort((a, b) => {
                const dueA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
                const dueB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
                return dueA - dueB;
            });
        }
        if (statusId === 'atrasado') {
            // por ordem de vencimento: os mais atrasados primeiros (oldest due date first)
            return list.sort((a, b) => {
                const dueA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
                const dueB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
                return dueA - dueB;
            });
        }
        if (statusId === 'concluida') {
            // por ordem de modificação: os mais recentes primeiros
            return list.sort((a, b) => {
                const timeA = new Date(a.updated_at || a.created_at).getTime();
                const timeB = new Date(b.updated_at || b.created_at).getTime();
                return timeB - timeA;
            });
        }
        return list;
    };

    const getSortedListProtocols = (items) => {
        const list = [...items];
        return list.sort((a, b) => {
            if (sortBy === 'created_at_desc') {
                return new Date(b.created_at) - new Date(a.created_at);
            }
            if (sortBy === 'created_at_asc') {
                return new Date(a.created_at) - new Date(b.created_at);
            }
            if (sortBy === 'due_date_asc') {
                const dueA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
                const dueB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
                return dueA - dueB;
            }
            if (sortBy === 'due_date_desc') {
                const dueA = a.due_date ? new Date(a.due_date).getTime() : -Infinity;
                const dueB = b.due_date ? new Date(b.due_date).getTime() : -Infinity;
                return dueB - dueA;
            }
            if (sortBy === 'title_asc') {
                return (a.title || '').localeCompare(b.title || '');
            }
            if (sortBy === 'title_desc') {
                return (b.title || '').localeCompare(a.title || '');
            }
            if (sortBy === 'status_asc') {
                return (a.status || '').localeCompare(b.status || '');
            }
            if (sortBy === 'status_desc') {
                return (b.status || '').localeCompare(a.status || '');
            }
            return 0;
        });
    };

    const primaryColor = branding?.primary_color || '#003366';

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    const fetchProtocols = async () => {
        setLoading(true);
        try {
            // Fetch all protocols (parents and subs) to compute effective status/deadlines
            const { data, error } = await supabase
                .from('v_protocols')
                .select('*')
                .order('created_at', { ascending: true }); // ascending to process chronological order naturally
            if (error) throw error;
            
            const rawData = data || [];
            
            // Extract top-level protocols
            const topLevel = rawData.filter(p => p.parent_protocol_id === null);
            
            // Process each top-level protocol to find its latest sub-protocol derivation and active deadlines
            const processed = topLevel.map(parent => {
                // Find all sub-protocols
                const subs = rawData.filter(sub => sub.parent_protocol_id === parent.id);
                
                // Latest derivation (last sub-protocol, or parent if none)
                const latestDerivation = subs.length > 0 ? subs[subs.length - 1] : parent;
                
                // "o prazo em contagem será o prazo do ultimo protocolo ou sub-protocolo aberto."
                // Chain is parent followed by subs
                const chain = [parent, ...subs];
                const openNodes = chain.filter(n => n.status !== 'concluida');
                const lastOpenNode = openNodes.length > 0 ? openNodes[openNodes.length - 1] : chain[chain.length - 1];
                
                // "o status só entra em atraso quando a ultima derivação entra em atraso."
                const isLatestDelayed = latestDerivation.due_date && 
                                        new Date(latestDerivation.due_date) < new Date() && 
                                        latestDerivation.status !== 'concluida';
                                        
                const effectiveStatus = isLatestDelayed ? 'atrasado' : latestDerivation.status;
                
                return {
                    ...parent,
                    protocol_number: latestDerivation.protocol_number || parent.protocol_number,
                    parent_protocol_number: parent.protocol_number,
                    status: effectiveStatus,
                    due_date: lastOpenNode.due_date,
                    deadline_days: lastOpenNode.deadline_days,
                    latest_derivation_id: latestDerivation.id,
                    sub_protocols_count: subs.length,
                    is_delayed: isLatestDelayed
                };
            });
            
            // Sort by created_at desc for displaying in list/kanban
            processed.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            setProtocols(processed);
        } catch (err) {
            console.error('Error fetching protocols:', err);
            showAlert('Erro ao carregar protocolos.', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProtocols();
    }, []);

    // Listen for redirect/deep link on load
    useEffect(() => {
        const targetId = localStorage.getItem('open_protocol_id_on_load');
        if (targetId) {
            localStorage.removeItem('open_protocol_id_on_load');
            fetchAndOpenProtocol(targetId);
        }
    }, [protocols]);

    const fetchAndOpenProtocol = async (id) => {
        try {
            const { data, error } = await supabase
                .from('v_protocols')
                .select('*')
                .eq('id', id)
                .single();
            if (error) throw error;
            if (data) {
                setSelectedProtocol(data);
            }
        } catch (err) {
            console.error('Error loading deep linked protocol:', err);
        }
    };

    /* ── Filtering ─────────────────────────────────────────────── */
    const filtered = protocols.filter(p => {
        if (!searchTerm) return true;
        const q = searchTerm.toLowerCase();
        return (
            p.title?.toLowerCase().includes(q) ||
            p.description?.toLowerCase().includes(q) ||
            p.protocol_number?.toLowerCase().includes(q) ||
            p.parent_protocol_number?.toLowerCase().includes(q) ||
            p.status?.toLowerCase().includes(q) ||
            p.linked_entity_type?.toLowerCase().includes(q)
        );
    });

    /* ── Delete ────────────────────────────────────────────────── */
    const handleDelete = async (id) => {
        try {
            const { error } = await supabase.from('protocols').delete().eq('id', id);
            if (error) throw error;
            setProtocols(prev => prev.filter(p => p.id !== id));
            showAlert('Protocolo excluído com sucesso.', 'success');
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

        const activeProto = protocols.find(p => p.id === active.id);
        const isTargetStatus = STATUSES.some(s => s.id === over.id);

        let newStatus = over.id;
        if (!isTargetStatus) {
            const targetProto = protocols.find(p => p.id === over.id);
            if (targetProto && targetProto.id !== activeProto?.id) {
                // Card dropped onto another card -> Trigger Protocol Unification!
                setUnifyingSource(activeProto);
                setUnifyingTarget(targetProto);
                setShowUnificationModal(true);
                return;
            }
            newStatus = targetProto?.status;
        }

        if (!newStatus || !activeProto || activeProto.status === newStatus) return;

        // Optimistically update status in frontend
        setProtocols(prev => prev.map(p =>
            p.id === active.id ? { ...p, status: newStatus } : p
        ));

        try {
            const targetId = activeProto.latest_derivation_id || active.id;
            const { error } = await supabase
                .from('protocols')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
                .eq('id', targetId);

            if (error) throw error;
            showAlert(`Status atualizado para: ${STATUSES.find(s => s.id === newStatus).label}`, 'success');
        } catch (err) {
            console.error('Error updating status:', err);
            fetchProtocols();
        }
    };

    /* ── Summary stats ─────────────────────────────────────────── */
    const stats = {
        total: protocols.length,
        gerar: protocols.filter(p => p.status === 'gerar').length,
        em_tratativa: protocols.filter(p => p.status === 'em_tratativa').length,
        replica: protocols.filter(p => p.status === 'replica').length,
        atrasado: protocols.filter(p => p.status === 'atrasado').length,
        concluida: protocols.filter(p => p.status === 'concluida').length,
    };

    const activeProto = protocols.find(p => p.id === activeId);

    return (
        <div style={{ fontFamily: "'Inter', sans-serif", minHeight: '100%' }}>
            <style>{`
                .rateio-col-scroll::-webkit-scrollbar { width: 4px; }
                .rateio-col-scroll::-webkit-scrollbar-track { background: transparent; }
                .rateio-col-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
                .rateio-col-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                .rateio-list-row:hover td { background: #f8fafc; }
            `}</style>

            {/* ── Page Header ──────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: '#1e293b' }}>
                        Protocolos / Atendimento
                    </h2>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                        Acompanhe e solucione chamados de atendimento e suporte técnico
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                        onClick={fetchProtocols}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.55rem 1rem', background: 'white',
                            border: '1px solid #e2e8f0', borderRadius: '10px',
                            cursor: 'pointer', fontSize: '0.82rem', color: '#475569', fontWeight: 600
                        }}
                    >
                        <RefreshCw size={14} /> Atualizar
                    </button>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.55rem 1.25rem', background: primaryColor,
                            color: 'white', border: 'none', borderRadius: '10px',
                            cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700
                        }}
                    >
                        <Plus size={14} /> Novo Chamado
                    </button>
                </div>
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
                        placeholder="Buscar por título, protocolo, entidade..."
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

                {/* Sorting Select (Only in List View) */}
                {viewMode === 'list' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#64748b' }}>Ordenar por:</span>
                        <select 
                            value={sortBy} 
                            onChange={e => setSortBy(e.target.value)} 
                            style={{ 
                                padding: '0.45rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: '10px', 
                                fontSize: '0.82rem', color: '#0f172a', background: 'white', fontWeight: '600', 
                                outline: 'none', cursor: 'pointer', transition: 'border-color 0.2s' 
                            }}
                        >
                            <option value="created_at_desc">Criado em: Mais Novo primeiro</option>
                            <option value="created_at_asc">Criado em: Mais Antigo primeiro</option>
                            <option value="due_date_asc">Vencimento: Mais Próximo primeiro</option>
                            <option value="due_date_desc">Vencimento: Mais Distante primeiro</option>
                            <option value="title_asc">Título: A-Z</option>
                            <option value="title_desc">Título: Z-A</option>
                            <option value="status_asc">Status: A-Z</option>
                            <option value="status_desc">Status: Z-A</option>
                        </select>
                    </div>
                )}

                {/* View toggle */}
                <div style={{
                    display: 'flex', border: '1px solid #e2e8f0',
                    borderRadius: '10px', overflow: 'hidden', background: 'white'
                }}>
                    {[
                        { id: 'list', icon: List, label: 'Lista' },
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
                    <p style={{ margin: 0 }}>Carregando chamados...</p>
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
                                    protocols={getSortedKanbanProtocols(status.id, filtered)}
                                    onCardClick={p => setSelectedProtocol(p)}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </div>
                        <DragOverlay adjustScale={false}>
                            {activeId && activeProto ? (
                                <KanbanCard protocol={activeProto} onClick={() => {}} onDelete={() => {}} isOverlay />
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
                            <p style={{ margin: 0, fontWeight: 600 }}>Nenhum protocolo encontrado.</p>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc' }}>
                                    {['Título / Assunto', 'Protocolo', 'Status', 'Entidade Vinculada', 'Prazo (Dias Úteis)', 'Vencimento', 'Criado em', 'Ações'].map((h, i) => (
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
                                {getSortedListProtocols(filtered).map(p => {
                                    const statusCfg = STATUSES.find(s => s.id === p.status) || STATUSES[0];
                                    const StatusIcon = statusCfg.icon;
                                    return (
                                        <tr key={p.id} className="rateio-list-row" style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                                            onClick={() => setSelectedProtocol(p)}>
                                            <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#1e293b' }}>
                                                {p.title}
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem' }}>
                                                {(() => {
                                                    const displayProtoNum = p.latest_sub_protocol_number || p.protocol_number;
                                                    return displayProtoNum ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                            <Hash size={12} color="#6d28d9" />
                                                            <span style={{ fontWeight: 700, color: '#6d28d9' }}>{displayProtoNum}</span>
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: '#cbd5e1' }}>—</span>
                                                    );
                                                })()}
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
                                            <td style={{ padding: '0.9rem 1rem' }}>
                                                {p.linked_entity_type ? (
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                                                        padding: '0.2rem 0.5rem', borderRadius: '6px',
                                                        fontSize: '0.75rem', fontWeight: 600, background: '#f1f5f9', color: '#475569',
                                                        textTransform: 'capitalize'
                                                    }}>
                                                        <LinkIcon size={12} /> {p.linked_entity_type.replace('_', ' ')}
                                                    </span>
                                                ) : (
                                                    <span style={{ color: '#cbd5e1' }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem', fontWeight: 700, color: '#1e293b' }}>
                                                {p.deadline_days !== null ? `${p.deadline_days} dias` : '—'}
                                            </td>
                                            <td style={{ 
                                                padding: '0.9rem 1rem', 
                                                color: p.status === 'concluida' ? '#166534' : 
                                                       (p.status === 'atrasado' ? '#ef4444' : '#475569'), 
                                                fontWeight: 700 
                                            }}>
                                                {p.due_date ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                        <Calendar size={12} />
                                                        {formatDateBR(p.due_date)}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: '#cbd5e1' }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem', color: '#64748b', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                                                {formatDateTimeBR(p.created_at)}
                                            </td>
                                            <td style={{ padding: '0.9rem 1rem' }} onClick={e => e.stopPropagation()}>
                                                <button
                                                    onClick={() => handleDelete(p.id)}
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

            {/* Modals */}
            {selectedProtocol && (
                <ProtocolModal
                    protocol={selectedProtocol}
                    onClose={() => setSelectedProtocol(null)}
                    onUpdated={() => {
                        setSelectedProtocol(null);
                        fetchProtocols();
                    }}
                />
            )}

            {showCreateModal && (
                <ProtocolModal
                    onClose={() => setShowCreateModal(false)}
                    onUpdated={() => {
                        setShowCreateModal(false);
                        fetchProtocols();
                    }}
                />
            )}

            {showUnificationModal && unifyingSource && unifyingTarget && (
                <UnificationModal
                    sourceProtocol={unifyingSource}
                    targetProtocol={unifyingTarget}
                    onClose={() => {
                        setShowUnificationModal(false);
                        setUnifyingSource(null);
                        setUnifyingTarget(null);
                    }}
                    onSuccess={() => {
                        setShowUnificationModal(false);
                        setUnifyingSource(null);
                        setUnifyingTarget(null);
                        fetchProtocols();
                    }}
                />
            )}
        </div>
    );
}
