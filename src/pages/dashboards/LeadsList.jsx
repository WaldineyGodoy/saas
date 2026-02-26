import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import LeadModal from '../../components/LeadModal';
import SubscriberModal from '../../components/SubscriberModal';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    closestCorners,
    DragOverlay
} from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

const KANBAN_STATUSES = [
    { status: 'indicado', label: 'Indicado', color: '#0ea5e9' },
    { status: 'simulacao', label: 'Simulação', color: '#64748b' },
    { status: 'em_negociacao', label: 'Em Negociação', color: '#eab308' },
    { status: 'ativacao', label: 'Ativação', color: '#7c3aed' },
    { status: 'ativo', label: 'Ativo', color: '#22c55e' },
    { status: 'pago', label: 'Pago', color: '#8b5cf6' },
    { status: 'negocio_perdido', label: 'Negócio Perdido', color: '#ef4444' }
];

function KanbanCard({ lead, onClick, isOverlay }) {
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
        background: 'white',
        padding: '1rem',
        borderRadius: 'var(--radius-sm)',
        boxShadow: isOverlay ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
        cursor: isOverlay ? 'grabbing' : 'grab',
        border: '1px solid transparent',
        zIndex: isDragging ? 1000 : 1,
        position: 'relative',
        width: isOverlay ? '280px' : 'auto'
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(lead)}
        >
            <div style={{ fontWeight: 'bold', marginBottom: '0.3rem', color: 'var(--color-text-dark)' }}>{lead.name}</div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-blue)', background: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {lead.concessionaria || 'N/A'}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#047857', background: '#ecfdf5', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {lead.consumo_kwh ? `${Number(lead.consumo_kwh).toLocaleString('pt-BR')} kWh` : '0 kWh'}
                </span>
            </div>

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

function KanbanColumn({ status, label, color, leads, onCardClick }) {
    const { setNodeRef, isOver } = useDroppable({
        id: status,
    });

    return (
        <div
            ref={setNodeRef}
            style={{
                minWidth: '280px',
                flex: 1,
                background: isOver ? '#e2e8f0' : 'var(--color-bg-light)',
                borderRadius: 'var(--radius-md)',
                padding: '0.5rem',
                borderTop: `4px solid ${color}`,
                boxShadow: 'var(--shadow-sm)',
                transition: 'background 0.2s ease'
            }}
        >
            <h4 style={{
                padding: '0.8rem', borderBottom: '1px solid var(--color-border)', background: 'white', borderRadius: 'var(--radius-sm)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem',
                color: color
            }}>
                <span style={{ textTransform: 'uppercase', fontSize: '0.8rem', fontWeight: 'bold' }}>
                    {label}
                </span>
                <span style={{ fontSize: '0.8rem', background: color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                    {leads.length}
                </span>
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: '100px' }}>
                <SortableContext
                    items={leads.map(l => l.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {leads.map(lead => (
                        <KanbanCard key={lead.id} lead={lead} onClick={onCardClick} />
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
    const [editingLead, setEditingLead] = useState(null);
    const [leadToConvert, setLeadToConvert] = useState(null);
    const [viewMode, setViewMode] = useState('kanban'); // Default to kanban
    const [searchTerm, setSearchTerm] = useState('');
    const [activeId, setActiveId] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const filteredLeads = leads.filter(lead => {
        if (!searchTerm) return true;
        const lowerTerm = searchTerm.toLowerCase();
        return (
            lead.name?.toLowerCase().includes(lowerTerm) ||
            lead.email?.toLowerCase().includes(lowerTerm) ||
            lead.phone?.includes(lowerTerm) ||
            lead.concessionaria?.toLowerCase().includes(lowerTerm)
        );
    });

    useEffect(() => {
        fetchLeads();
    }, []);

    const fetchLeads = async () => {
        setLoading(true);
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

    const handleConvert = (lead) => {
        setLeadToConvert(lead);
        setIsSubscriberModalOpen(true);
    };

    const handleSubscriberSaved = async (newSubscriber) => {
        try {
            await supabase.from('leads').update({ status: 'em_negociacao' }).eq('id', leadToConvert.id);
            fetchLeads();
            alert('Lead convertido em Assinante! Status atualizado para "Em Negociação".');
        } catch (e) {
            console.error('Erro ao atualizar status do lead', e);
        }
    };

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);
        if (!over) return;

        const activeId = active.id;
        const overId = over.id;

        // Determine target status
        let newStatus = overId;
        const isTargetStatus = KANBAN_STATUSES.some(s => s.status === overId);

        if (!isTargetStatus) {
            const targetLead = leads.find(l => l.id === overId);
            newStatus = targetLead?.status;
        }

        if (!newStatus) return;

        const leadToUpdate = leads.find(l => l.id === activeId);
        if (leadToUpdate && leadToUpdate.status !== newStatus) {
            // Optimistic update
            setLeads(prev => prev.map(l =>
                l.id === activeId ? { ...l, status: newStatus } : l
            ));

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
                        placeholder="Buscar por nome, email, telefone ou concessionária..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input"
                        style={{ maxWidth: '400px' }}
                    />
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
                    </div>
                </div>
            </div>

            {loading ? <p>Carregando...</p> : (
                <>
                    {viewMode === 'list' ? (
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
                                                    <td style={{ fontWeight: 'bold' }}>{lead.name}</td>
                                                    <td>{lead.concessionaria || '-'}</td>
                                                    <td>{lead.consumo_kwh ? `${Number(lead.consumo_kwh).toLocaleString('pt-BR')} kWh` : '-'}</td>
                                                    <td>
                                                        <div style={{ fontSize: '0.9rem' }}>{lead.email}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)' }}>{lead.phone}</div>
                                                    </td>
                                                    <td>
                                                        <span style={{
                                                            padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: '500',
                                                            background: lead.status === 'simulacao' ? '#f1f5f9' :
                                                                lead.status === 'em_negociacao' ? '#fef9c3' :
                                                                    lead.status === 'ativo' ? '#dcfce7' : '#f1f5f9',
                                                            color: lead.status === 'simulacao' ? '#64748b' :
                                                                lead.status === 'em_negociacao' ? '#a16207' :
                                                                    lead.status === 'ativo' ? '#166534' : '#64748b'
                                                        }}>
                                                            {lead.status.toUpperCase().replace('_', ' ')}
                                                        </span>
                                                    </td>
                                                    <td>{lead.originator?.name || '-'}</td>
                                                    <td style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            onClick={() => { setEditingLead(lead); setIsModalOpen(true); }}
                                                            className="btn btn-secondary"
                                                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                                                        >
                                                            Editar
                                                        </button>
                                                        {lead.status !== 'convertido' && (
                                                            <button
                                                                onClick={() => handleConvert(lead)}
                                                                className="btn"
                                                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', border: '1px solid var(--color-success)', color: 'var(--color-success)', background: 'white' }}
                                                            >
                                                                Converter
                                                            </button>
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
                            collisionDetection={closestCorners}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onDragCancel={() => setActiveId(null)}
                        >
                            <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                                {KANBAN_STATUSES.map(({ status, label, color }) => {
                                    const leadsInStatus = filteredLeads.filter(l => (l.status || 'simulacao') === status);
                                    return (
                                        <KanbanColumn
                                            key={status}
                                            status={status}
                                            label={label}
                                            color={color}
                                            leads={leadsInStatus}
                                            onCardClick={(lead) => { setEditingLead(lead); setIsModalOpen(true); }}
                                        />
                                    );
                                })}
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
                    lead={editingLead}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onConvert={handleConvert}
                />
            )}

            {isSubscriberModalOpen && (
                <SubscriberModal
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
        </div>
    );
}
