import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import PowerPlantModal from '../../components/PowerPlantModal';
import PlantClosingsHistoryModal from '../../components/PlantClosingsHistoryModal';
import { FileText } from 'lucide-react';
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
    { status: 'em_conexao', label: 'Em Conexão', color: '#9a3412', bg: '#ffedd5' },
    { status: 'gerando', label: 'Gerando', color: '#166534', bg: '#dcfce7' },
    { status: 'manutencao', label: 'Manutenção', color: '#991b1b', bg: '#fee2e2' },
    { status: 'inativa', label: 'Inativa', color: '#64748b', bg: '#f1f5f9' },
    { status: 'cancelada', label: 'Cancelada', color: '#94a3b8', bg: '#f1f5f9' }
];

function KanbanCard({ plant, onClick, onClosingsClick, isOverlay }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: plant.id, disabled: !!isOverlay });

    const statusConfig = KANBAN_STATUSES.find(s => s.status === plant.status) || KANBAN_STATUSES[0];

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
        overflow: 'hidden',
        width: isOverlay ? '300px' : 'auto'
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(plant)}
        >
            <div style={{
                display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '4px',
                fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase',
                background: statusConfig.bg, color: statusConfig.color,
                marginBottom: '0.5rem'
            }}>
                {plant.status?.replace('_', ' ')}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)', lineHeight: '1.2' }}>{plant.name}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-blue)', background: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {plant.concessionaria || 'Sem conc.'}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#666', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {plant.supplier?.name || 'Sem Fornecedor'}
                </span>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', marginBottom: '0.5rem' }}>
                <div style={{ background: 'var(--color-bg-light)', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', flex: 1 }}>
                    <div style={{ color: 'var(--color-text-light)', fontSize: '0.65rem' }}>Potência</div>
                    <div style={{ fontWeight: 'bold' }}>{plant.potencia_kwp} kWp</div>
                </div>
                <div style={{ background: 'var(--color-bg-light)', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', flex: 1 }}>
                    <div style={{ color: 'var(--color-text-light)', fontSize: '0.65rem' }}>Geração Est.</div>
                    <div style={{ fontWeight: 'bold', color: 'var(--color-success)' }}>{plant.geracao_estimada_kwh} kWh</div>
                </div>
            </div>

            {plant.geracao_estimada_kwh > 0 && plant.consumer_units?.length > 0 && (
                <div style={{ marginBottom: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#64748b', marginBottom: '0.2rem' }}>
                        <span>Lotação / Franquia</span>
                        <span style={{ fontWeight: 'bold', color: '#7c3aed' }}>
                            {Math.round((plant.consumer_units.reduce((acc, uc) => acc + (Number(uc.consumo_medio_kwh) || Number(uc.franquia) || 0), 0) / plant.geracao_estimada_kwh) * 100)}%
                        </span>
                    </div>
                    <div style={{ height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                            height: '100%',
                            background: '#7c3aed',
                            width: `${Math.min(100, (plant.consumer_units.reduce((acc, uc) => acc + (Number(uc.consumo_medio_kwh) || Number(uc.franquia) || 0), 0) / plant.geracao_estimada_kwh) * 100)}%`
                        }} />
                    </div>
                </div>
            )}

            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                <span>{plant.address?.cidade}/{plant.address?.uf}</span>
                <button
                    onClick={(e) => { e.stopPropagation(); onClosingsClick(plant); }}
                    style={{
                        background: 'none', border: 'none', color: '#3b82f6', fontSize: '0.8rem',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem'
                    }}
                >
                    <FileText size={14} /> Fechamentos
                </button>
            </div>
        </div>
    );
}

function KanbanColumn({ status, label, color, bg, plants, onCardClick, onClosingsClick }) {
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
                    {plants.length}
                </span>
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: '100px' }}>
                <SortableContext
                    items={plants.map(p => p.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {plants.map(plant => (
                        <KanbanCard
                            key={plant.id}
                            plant={plant}
                            onClick={onCardClick}
                            onClosingsClick={onClosingsClick}
                        />
                    ))}
                </SortableContext>
            </div>
        </div>
    );
}

export default function PowerPlantList() {
    const [usinas, setUsinas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUsina, setEditingUsina] = useState(null);
    const [isClosingsModalOpen, setIsClosingsModalOpen] = useState(false);
    const [selectedUsinaForClosings, setSelectedUsinaForClosings] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('kanban');
    const [activeId, setActiveId] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const filteredUsinas = usinas.filter(u => {
        if (!searchTerm) return true;
        const lower = searchTerm.toLowerCase();
        return (
            u.name?.toLowerCase().includes(lower) ||
            u.concessionaria?.toLowerCase().includes(lower) ||
            u.supplier?.name?.toLowerCase().includes(lower) ||
            u.status?.toLowerCase().includes(lower) ||
            u.address?.cidade?.toLowerCase().includes(lower)
        );
    });

    useEffect(() => {
        fetchUsinas();
    }, []);

    const fetchUsinas = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('usinas')
                .select(`
                    *,
                    supplier:supplier_id (name),
                    consumer_units (*)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setUsinas(data || []);
        } catch (error) {
            console.error('Erro usinas', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = () => {
        fetchUsinas();
        setIsModalOpen(false);
    };

    const handleDelete = (id) => {
        setUsinas(usinas.filter(u => u.id !== id));
        setIsModalOpen(false);
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

        let newStatus = overId;
        const isTargetStatus = KANBAN_STATUSES.some(s => s.status === overId);

        if (!isTargetStatus) {
            const targetPlant = usinas.find(p => p.id === overId);
            newStatus = targetPlant?.status;
        }

        if (!newStatus) return;

        const plantToUpdate = usinas.find(p => p.id === activeId);
        if (plantToUpdate && plantToUpdate.status !== newStatus) {
            setUsinas(prev => prev.map(p =>
                p.id === activeId ? { ...p, status: newStatus } : p
            ));

            try {
                const { error } = await supabase
                    .from('usinas')
                    .update({ status: newStatus })
                    .eq('id', activeId);

                if (error) throw error;
            } catch (error) {
                console.error('Error updating status:', error);
                fetchUsinas();
            }
        }
    };

    const getStatusStyle = (status) => {
        const config = KANBAN_STATUSES.find(s => s.status === status) || { bg: '#f1f5f9', color: '#64748b' };
        return { bg: config.bg, color: config.color };
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Usinas Geradoras</h2>
                <button
                    onClick={() => { setEditingUsina(null); setIsModalOpen(true); }}
                    className="btn btn-primary"
                >
                    + Nova Usina
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flex: 1, alignItems: 'center' }}>
                    <input
                        placeholder="Buscar por Nome, Fornecedor, Concessionária ou Status..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
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
                                {filteredUsinas.length === 0 ? (
                                    <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhuma usina cadastrada.</p>
                                ) : (
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Nome / Concessionária</th>
                                                <th>Fornecedor</th>
                                                <th>Cidade</th>
                                                <th>Geração / Potência</th>
                                                <th>Status</th>
                                                <th>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredUsinas.map(u => {
                                                const statusStyle = getStatusStyle(u.status);
                                                return (
                                                    <tr key={u.id}>
                                                        <td style={{ fontWeight: 'bold' }}>
                                                            <div>{u.name}</div>
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--color-blue)', fontWeight: 'normal', marginTop: '4px' }}>
                                                                {u.concessionaria || '-'}
                                                            </div>
                                                        </td>
                                                        <td>{u.supplier?.name || '-'}</td>
                                                        <td>{u.address?.cidade}/{u.address?.uf}</td>
                                                        <td>
                                                            <div style={{ fontWeight: 'bold', color: 'var(--color-success)', fontSize: '1.05rem' }}>
                                                                {u.geracao_estimada_kwh ? `${u.geracao_estimada_kwh} kWh/mês` : '-'}
                                                            </div>
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)' }}>
                                                                Potência: {u.potencia_kwp} kWp
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <span style={{
                                                                padding: '0.3rem 0.8rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 'bold',
                                                                background: statusStyle.bg, color: statusStyle.color, textTransform: 'uppercase'
                                                            }}>
                                                                {u.status?.replace('_', ' ')}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <button
                                                                onClick={() => { setEditingUsina(u); setIsModalOpen(true); }}
                                                                className="btn btn-secondary"
                                                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', marginRight: '0.5rem' }}
                                                            >
                                                                Editar
                                                            </button>
                                                            <button
                                                                onClick={() => { setSelectedUsinaForClosings(u); setIsClosingsModalOpen(true); }}
                                                                className="btn btn-secondary"
                                                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}
                                                            >
                                                                <FileText size={14} />
                                                            </button>
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
                            collisionDetection={closestCorners}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onDragCancel={() => setActiveId(null)}
                        >
                            <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                                {KANBAN_STATUSES.map(({ status, label, color, bg }) => {
                                    const usinasInStatus = filteredUsinas.filter(u => u.status === status);
                                    return (
                                        <KanbanColumn
                                            key={status}
                                            status={status}
                                            label={label}
                                            color={color}
                                            bg={bg}
                                            plants={usinasInStatus}
                                            onCardClick={(u) => { setEditingUsina(u); setIsModalOpen(true); }}
                                            onClosingsClick={(u) => { setSelectedUsinaForClosings(u); setIsClosingsModalOpen(true); }}
                                        />
                                    );
                                })}
                            </div>
                            <DragOverlay adjustScale={true}>
                                {activeId ? (
                                    <KanbanCard
                                        plant={usinas.find(p => p.id === activeId)}
                                        isOverlay={true}
                                    />
                                ) : null}
                            </DragOverlay>
                        </DndContext>
                    )}
                </>
            )}

            {isModalOpen && (
                <PowerPlantModal
                    usina={editingUsina}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}

            {isClosingsModalOpen && (
                <PlantClosingsHistoryModal
                    usina={selectedUsinaForClosings}
                    onClose={() => setIsClosingsModalOpen(false)}
                />
            )}
        </div>
    );
}
