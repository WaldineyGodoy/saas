import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import ConsumerUnitModal from '../../components/ConsumerUnitModal';
import { Calendar as CalendarIcon, List, Layout, Info } from 'lucide-react';
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

const KANBAN_STATUSES = [
    { status: 'em_ativacao', label: 'Em Ativação', color: '#3b82f6' },
    { status: 'aguardando_conexao', label: 'Aguardando Conexão', color: '#eab308' },
    { status: 'ativo', label: 'Ativo', color: '#22c55e' },
    { status: 'sem_geracao', label: 'Sem Geração', color: '#64748b' },
    { status: 'em_atraso', label: 'Em Atraso', color: '#f97316' },
    { status: 'cancelado', label: 'Cancelado', color: '#ef4444' },
    { status: 'cancelado_inadimplente', label: 'Cancelado (Inad.)', color: '#991b1b' }
];

function KanbanCard({ uc, onClick, isOverlay }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: uc.id, disabled: !!isOverlay });

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
        width: isOverlay ? '300px' : 'auto'
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(uc)}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)' }}>{uc.numero_uc}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-blue)', background: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {uc.concessionaria}
                </span>
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--color-text-medium)', marginBottom: '0.2rem' }}>
                {uc.subscriber?.name || 'Sem Assinante'}
            </div>
            {uc.titular_conta && (
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', marginBottom: '0.5rem', fontStyle: 'italic' }}>
                    Identificação: {uc.titular_conta}
                </div>
            )}
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ flex: 1, paddingRight: '0.5rem' }}>
                        {uc.address?.rua}{uc.address?.numero ? `, ${uc.address.numero}` : ''}
                        {uc.address?.bairro ? ` - ${uc.address.bairro}` : ''}
                        <br />
                        {uc.address?.cidade}/{uc.address?.uf} {uc.address?.cep ? `- CEP: ${uc.address.cep}` : ''}
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--color-success)', whiteSpace: 'nowrap' }}>
                        {uc.franquia ? `${Number(uc.franquia).toLocaleString('pt-BR')} kWh` : ''}
                    </span>
                </div>
            </div>
        </div>
    );
}

function KanbanColumn({ status, label, color, units, onCardClick }) {
    const { setNodeRef, isOver } = useDroppable({
        id: status,
    });

    return (
        <div
            ref={setNodeRef}
            style={{
                minWidth: '300px',
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
                <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>
                    {label}
                </span>
                <span style={{ fontSize: '0.8rem', background: color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                    {units.length}
                </span>
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: '100px' }}>
                <SortableContext
                    items={units.map(u => u.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {units.map(uc => (
                        <KanbanCard key={uc.id} uc={uc} onClick={onCardClick} />
                    ))}
                </SortableContext>
            </div>
        </div>
    );
}

function CalendarView({ units, onCardClick, searchTerm }) {
    const days = Array.from({ length: 31 }, (_, i) => i + 1);

    const groupedUnits = units.reduce((acc, unit) => {
        const day = unit.dia_leitura || 0;
        if (!acc[day]) acc[day] = [];
        acc[day].push(unit);
        return acc;
    }, {});

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '1.5rem',
            padding: '1rem'
        }}>
            {days.map(day => {
                const dayUnits = (groupedUnits[day] || []).filter(u => {
                    if (!searchTerm) return true;
                    const lower = searchTerm.toLowerCase();
                    return (
                        u.numero_uc?.toLowerCase().includes(lower) ||
                        u.subscriber?.name?.toLowerCase().includes(lower) ||
                        u.concessionaria?.toLowerCase().includes(lower)
                    );
                });

                return (
                    <div key={day} style={{
                        background: 'white',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        minHeight: '180px',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: 'var(--shadow-sm)',
                        transition: 'transform 0.2s',
                    }} onMouseOver={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'} onMouseOut={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}>
                        <div style={{
                            padding: '0.6rem 1rem',
                            borderBottom: '1px solid var(--color-border)',
                            background: '#f8fafc',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            borderTopLeftRadius: 'var(--radius-md)',
                            borderTopRightRadius: 'var(--radius-md)'
                        }}>
                            <span style={{ fontWeight: 800, color: 'var(--color-blue)', fontSize: '0.95rem' }}>Dia {day}</span>
                            <span style={{ fontSize: '0.75rem', color: '#64748b', background: '#e2e8f0', padding: '0.2rem 0.5rem', borderRadius: '12px', fontWeight: 600 }}>
                                {dayUnits.length}
                            </span>
                        </div>
                        <div style={{ padding: '0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto', maxHeight: '250px' }}>
                            {dayUnits.length === 0 ? (
                                <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginTop: '2rem', fontStyle: 'italic', opacity: 0.6 }}>Sem leituras</div>
                            ) : (
                                dayUnits.map(uc => (
                                    <div
                                        key={uc.id}
                                        onClick={() => onCardClick(uc)}
                                        style={{
                                            padding: '0.6rem',
                                            borderRadius: '8px',
                                            background: '#f1f5f9',
                                            borderLeft: `4px solid ${KANBAN_STATUSES.find(s => s.status === uc.status)?.color || '#cbd5e1'}`,
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={e => {
                                            e.currentTarget.style.transform = 'translateX(4px)';
                                            e.currentTarget.style.background = '#e2e8f0';
                                        }}
                                        onMouseOut={e => {
                                            e.currentTarget.style.transform = 'translateX(0)';
                                            e.currentTarget.style.background = '#f1f5f9';
                                        }}
                                    >
                                        <div style={{ fontWeight: 'bold', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {uc.subscriber?.name || 'S/ Assinante'}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.1rem', display: 'flex', justifyContent: 'space-between' }}>
                                            <span>UC: {uc.numero_uc}</span>
                                            <span style={{ fontStyle: 'italic', fontSize: '0.6rem' }}>{uc.concessionaria}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default function ConsumerUnitList() {
    const [units, setUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('kanban');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUnit, setEditingUnit] = useState(null);
    const [activeId, setActiveId] = useState(null);
    const [showTooltip, setShowTooltip] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const filteredUnits = units.filter(u => {
        if (!searchTerm) return true;
        const lower = searchTerm.toLowerCase();
        return (
            u.numero_uc?.toLowerCase().includes(lower) ||
            u.subscriber?.name?.toLowerCase().includes(lower) ||
            u.concessionaria?.toLowerCase().includes(lower) ||
            u.address?.cidade?.toLowerCase().includes(lower) ||
            u.status?.toLowerCase().includes(lower)
        );
    });

    useEffect(() => {
        fetchUnits();
    }, []);

    const fetchUnits = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('consumer_units')
                .select(`
                    *,
                    subscriber:subscriber_id (name, cpf_cnpj)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setUnits(data || []);
        } catch (error) {
            console.error('Error fetching UCs:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = (savedUnit) => {
        fetchUnits();
        setIsModalOpen(false);
    };

    const handleDelete = (id) => {
        setUnits(units.filter(u => u.id !== id));
        setIsModalOpen(false);
    };

    const handleDragOver = (event) => {
        const { active, over } = event;
        if (!over) return;

        const activeId = active.id;
        const overId = over.id;

        // Determine target status
        let overContainer = overId;
        const isTargetStatus = KANBAN_STATUSES.some(s => s.status === overId);

        if (!isTargetStatus) {
            const targetUnit = units.find(u => u.id === overId);
            overContainer = targetUnit?.status;
        }

        if (!overContainer) return;

        const unitToUpdate = units.find(u => u.id === activeId);
        if (unitToUpdate && unitToUpdate.status !== overContainer) {
            setUnits(prev => prev.map(u =>
                u.id === activeId ? { ...u, status: overContainer } : u
            ));
        }
    };

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);
        if (!over) {
            fetchUnits();
            return;
        }

        const activeId = active.id;
        const overId = over.id;

        // Determine target status
        let newStatus = overId;
        const isTargetStatus = KANBAN_STATUSES.some(s => s.status === overId);

        if (!isTargetStatus) {
            // Dropped over another card, get its status
            const targetUnit = units.find(u => u.id === overId);
            newStatus = targetUnit?.status;
        }

        if (!newStatus) {
            fetchUnits();
            return;
        }

        try {
            const { error } = await supabase
                .from('consumer_units')
                .update({ status: newStatus })
                .eq('id', activeId);

            if (error) throw error;
        } catch (error) {
            console.error('Error updating status:', error);
            fetchUnits(); // Rollback to actual data
        }
    };

    return (
        <div style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
                <h2 style={{ color: '#1e293b', fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.025em' }}>
                    Gestão de Unidades Consumidoras
                </h2>
                <button
                    onClick={() => { setEditingUnit(null); setIsModalOpen(true); }}
                    style={{
                        padding: '0.75rem 1.5rem',
                        background: 'var(--color-blue)',
                        color: 'white',
                        borderRadius: '8px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        border: 'none',
                        boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.2)',
                        transition: 'all 0.2s'
                    }}
                    onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                >
                    + Nova UC
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', gap: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flex: 1, alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, maxWidth: '450px' }}>
                        <input
                            placeholder="Buscar por UC, Assinante, Concessionária..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="input"
                            style={{
                                width: '100%',
                                padding: '0.75rem 1rem',
                                borderRadius: '10px',
                                border: '1px solid #e2e8f0',
                                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                            }}
                        />
                    </div>

                    <div className="btn-group" style={{
                        display: 'flex',
                        background: '#f1f5f9',
                        padding: '0.3rem',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0'
                    }}>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{
                                borderRadius: '8px',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.6rem 1.2rem',
                                background: viewMode === 'list' ? 'white' : 'transparent',
                                color: viewMode === 'list' ? 'var(--color-blue)' : '#64748b',
                                boxShadow: viewMode === 'list' ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none',
                                fontWeight: viewMode === 'list' ? '700' : '500'
                            }}
                        >
                            <List size={18} /> Lista
                        </button>
                        <button
                            onClick={() => setViewMode('kanban')}
                            className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{
                                borderRadius: '8px',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.6rem 1.2rem',
                                background: viewMode === 'kanban' ? 'white' : 'transparent',
                                color: viewMode === 'kanban' ? 'var(--color-blue)' : '#64748b',
                                boxShadow: viewMode === 'kanban' ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none',
                                fontWeight: viewMode === 'kanban' ? '700' : '500'
                            }}
                        >
                            <Layout size={18} /> Kanban
                        </button>
                        <div style={{ position: 'relative' }}>
                            <button
                                onClick={() => setViewMode('calendar')}
                                className={`btn ${viewMode === 'calendar' ? 'btn-primary' : 'btn-secondary'}`}
                                style={{
                                    borderRadius: '8px',
                                    border: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.6rem 1.2rem',
                                    background: viewMode === 'calendar' ? 'white' : 'transparent',
                                    color: viewMode === 'calendar' ? 'var(--color-blue)' : '#64748b',
                                    boxShadow: viewMode === 'calendar' ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none',
                                    fontWeight: viewMode === 'calendar' ? '700' : '500'
                                }}
                                onMouseEnter={() => setShowTooltip(true)}
                                onMouseLeave={() => setShowTooltip(false)}
                            >
                                <CalendarIcon size={18} /> Calendário
                            </button>
                            {showTooltip && (
                                <div style={{
                                    position: 'absolute',
                                    top: '130%',
                                    right: 0,
                                    background: '#1e293b',
                                    color: 'white',
                                    padding: '0.75rem 1.25rem',
                                    borderRadius: '10px',
                                    fontSize: '0.85rem',
                                    zIndex: 1000,
                                    whiteSpace: 'nowrap',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.6rem',
                                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
                                    pointerEvents: 'none',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                }}>
                                    <Info size={16} style={{ color: '#3b82f6' }} />
                                    Calendário agrupa as UCs por dia de leitura.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
                    <p style={{ color: '#64748b', fontWeight: '600' }}>Carregando Unidades...</p>
                </div>
            ) : (
                <div style={{ minHeight: '600px' }}>
                    {viewMode === 'list' ? (
                        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                            <div className="table-container">
                                {filteredUnits.length === 0 ? (
                                    <p style={{ padding: '4rem', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>Nenhuma Unidade Consumidora encontrada.</p>
                                ) : (
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th style={{ background: '#f8fafc' }}>UC</th>
                                                <th style={{ background: '#f8fafc' }}>Concessionária</th>
                                                <th style={{ background: '#f8fafc' }}>Assinante</th>
                                                <th style={{ background: '#f8fafc' }}>Franquia</th>
                                                <th style={{ background: '#f8fafc' }}>Status</th>
                                                <th style={{ background: '#f8fafc' }}>Cidade</th>
                                                <th style={{ background: '#f8fafc' }}>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredUnits.map(uc => (
                                                <tr key={uc.id} style={{ transition: 'background 0.2s' }}>
                                                    <td style={{ fontWeight: '700', color: '#1e293b' }}>{uc.numero_uc}</td>
                                                    <td style={{ color: '#64748b' }}>{uc.concessionaria || '-'}</td>
                                                    <td>
                                                        <div style={{ fontWeight: '700', color: '#334155' }}>{uc.subscriber?.name || '-'}</div>
                                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{uc.subscriber?.cpf_cnpj}</div>
                                                    </td>
                                                    <td style={{ fontWeight: '600', color: 'var(--color-success)' }}>
                                                        {uc.franquia ? `${Number(uc.franquia).toLocaleString('pt-BR')} kWh` : '-'}
                                                    </td>
                                                    <td>
                                                        <span className="badge" style={{
                                                            padding: '0.35rem 0.75rem',
                                                            borderRadius: '99px',
                                                            background: uc.status === 'ativo' ? '#dcfce7' :
                                                                uc.status === 'em_atraso' || uc.status === 'cancelado_inadimplente' ? '#fee2e2' : '#f1f5f9',
                                                            color: uc.status === 'ativo' ? '#166534' :
                                                                uc.status === 'em_atraso' || uc.status === 'cancelado_inadimplente' ? '#991b1b' : '#475569',
                                                            fontSize: '0.7rem',
                                                            fontWeight: '700'
                                                        }}>
                                                            {uc.status?.replace('_', ' ').toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td style={{ color: '#64748b' }}>{uc.address?.cidade} / {uc.address?.uf}</td>
                                                    <td>
                                                        <button
                                                            onClick={() => { setEditingUnit(uc); setIsModalOpen(true); }}
                                                            className="btn btn-secondary"
                                                            style={{
                                                                padding: '0.4rem 0.8rem',
                                                                fontSize: '0.75rem',
                                                                borderRadius: '6px',
                                                                fontWeight: '600',
                                                                border: '1px solid #e2e8f0'
                                                            }}
                                                        >
                                                            Editar
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    ) : viewMode === 'kanban' ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={(args) => {
                                const pointerCollisions = pointerWithin(args);
                                if (pointerCollisions.length > 0) return pointerCollisions;
                                return rectIntersection(args);
                            }}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDragEnd={handleDragEnd}
                            onDragCancel={() => { setActiveId(null); fetchUnits(); }}
                        >
                            <div style={{ display: 'flex', gap: '1.5rem', overflowX: 'auto', paddingBottom: '2rem' }}>
                                {KANBAN_STATUSES.map(({ status, label, color }) => {
                                    const unitsInStatus = filteredUnits.filter(u => (u.status || 'em_ativacao') === status);
                                    return (
                                        <KanbanColumn
                                            key={status}
                                            status={status}
                                            label={label}
                                            color={color}
                                            units={unitsInStatus}
                                            onCardClick={(uc) => { setEditingUnit(uc); setIsModalOpen(true); }}
                                        />
                                    );
                                })}
                            </div>
                            <DragOverlay adjustScale={true}>
                                {activeId ? (
                                    <KanbanCard
                                        uc={units.find(u => u.id === activeId)}
                                        isOverlay={true}
                                    />
                                ) : null}
                            </DragOverlay>
                        </DndContext>
                    ) : (
                        <div style={{ background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', minHeight: '600px' }}>
                            <CalendarView
                                units={filteredUnits}
                                onCardClick={(uc) => { setEditingUnit(uc); setIsModalOpen(true); }}
                                searchTerm={searchTerm}
                            />
                        </div>
                    )}
                </div>
            )}

            {isModalOpen && (
                <ConsumerUnitModal
                    consumerUnit={editingUnit}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
