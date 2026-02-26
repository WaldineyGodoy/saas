import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import SubscriberModal from '../../components/SubscriberModal';
import { CreditCard, X } from 'lucide-react';
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

export default function SubscriberList() {
    const { profile } = useAuth();
    const [subscribers, setSubscribers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSubscriber, setEditingSubscriber] = useState(null);
    const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban'
    const [searchTerm, setSearchTerm] = useState('');
    const [generatingId, setGeneratingId] = useState(null);
    const [activeId, setActiveId] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragOver = (event) => {
        const { active, over } = event;
        if (!over) return;

        const activeId = active.id;
        const overId = over.id;

        // Determine target status
        let overContainer = overId;
        const isTargetStatus = Object.keys(statusColors).includes(overId);

        if (!isTargetStatus) {
            const targetSub = subscribers.find(s => s.id === overId);
            overContainer = targetSub?.status;
        }

        if (!overContainer) return;

        const subToUpdate = subscribers.find(s => s.id === activeId);
        if (subToUpdate && subToUpdate.status !== overContainer) {
            setSubscribers(prev => prev.map(s =>
                s.id === activeId ? { ...s, status: overContainer } : s
            ));
        }
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);
        if (!over) {
            fetchSubscribers();
            return;
        }

        const activeId = active.id;
        const overId = over.id;

        // Determine target status
        let newStatus = overId;
        const isTargetStatus = Object.keys(statusColors).includes(overId);

        if (!isTargetStatus) {
            const targetSub = subscribers.find(s => s.id === overId);
            newStatus = targetSub?.status;
        }

        if (!newStatus) {
            fetchSubscribers();
            return;
        }

        try {
            const { error } = await supabase
                .from('subscribers')
                .update({ status: newStatus })
                .eq('id', activeId);

            if (error) throw error;
        } catch (error) {
            console.error('Error updating status:', error);
            fetchSubscribers();
        }
    };

    const filteredSubscribers = subscribers.filter(sub => {
        if (!searchTerm) return true;
        const lowerTerm = searchTerm.toLowerCase();
        return (
            sub.name?.toLowerCase().includes(lowerTerm) ||
            sub.email?.toLowerCase().includes(lowerTerm) ||
            sub.phone?.includes(lowerTerm) ||
            sub.cpf_cnpj?.includes(lowerTerm)
        );
    });

    useEffect(() => {
        fetchSubscribers();
    }, []);

    const fetchSubscribers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('subscribers')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setSubscribers(data || []);
        } catch (error) {
            console.error('Error fetching subscribers:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = (savedSub) => {
        const exists = subscribers.find(s => s.id === savedSub.id);
        if (exists) {
            setSubscribers(subscribers.map(s => s.id === savedSub.id ? { ...s, ...savedSub } : s));
        } else {
            setSubscribers([savedSub, ...subscribers]);
        }
    };

    const handleEmission = async (sub) => {
        if (!confirm(`Gerar boleto CONSOLIDADO (todas as faturas pendentes) para ${sub.name}?`)) return;

        setGeneratingId(sub.id);
        try {
            const result = await createAsaasCharge(sub.id, 'subscriber');
            if (result.url) {
                alert('Boleto consolidado gerado com sucesso!');
                window.open(result.url, '_blank');
            }
        } catch (error) {
            console.error(error);
            alert('Erro: ' + (error.message || 'Falha ao gerar boleto. Verifique se há faturas pendentes.'));
        } finally {
            setGeneratingId(null);
        }
    };

    // Color mapping for Subscriber Kanban
    const statusColors = {
        ativacao: '#0ea5e9', // Sky Blue
        ativo: '#22c55e', // Green
        ativo_inadimplente: '#f59e0b', // Amber
        transferido: '#64748b', // Slate
        cancelado: '#ef4444', // Red
        cancelado_inadimplente: '#b91c1c' // Dark Red
    };

    const handleDelete = (deletedId) => {
        setSubscribers(subscribers.filter(s => s.id !== deletedId));
    };

    function KanbanCard({ subscriber, onClick, isOverlay }) {
        const {
            attributes,
            listeners,
            setNodeRef,
            transform,
            transition,
            isDragging
        } = useSortable({ id: subscriber.id, disabled: !!isOverlay });

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
                onClick={() => !isOverlay && onClick(subscriber)}
            >
                <div style={{ fontWeight: 'bold', marginBottom: '0.3rem', color: 'var(--color-text-dark)' }}>{subscriber.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)' }}>{subscriber.cpf_cnpj}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {subscriber.email}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.8rem', fontSize: '0.75rem', color: 'var(--color-text-light)' }}>
                    <span>{subscriber.cidade}</span>
                    <span>{new Date(subscriber.created_at).toLocaleDateString()}</span>
                </div>
            </div>
        );
    }

    function KanbanColumn({ status, label, color, subscribers: subs, onCardClick }) {
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
                        {label.replace('_', ' ')}
                    </span>
                    <span style={{ fontSize: '0.8rem', background: color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                        {subs.length}
                    </span>
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: '100px' }}>
                    <SortableContext
                        items={subs.map(s => s.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {subs.map(sub => (
                            <KanbanCard key={sub.id} subscriber={sub} onClick={onCardClick} />
                        ))}
                    </SortableContext>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Gestão de Assinantes</h2>
                <button
                    onClick={() => { setEditingSubscriber(null); setIsModalOpen(true); }}
                    style={{ padding: '0.6rem 1.2rem', background: 'var(--color-blue)', color: 'white', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    + Novo Assinante
                </button>
            </div>

            {/* Controls Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flex: 1 }}>
                    <input
                        type="text"
                        placeholder="Buscar por nome, email, telefone ou CPF..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            padding: '0.6rem', width: '100%', maxWidth: '350px',
                            border: '1px solid #ddd', borderRadius: '4px'
                        }}
                    />
                    <div style={{ display: 'flex', border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}>
                        <button
                            onClick={() => setViewMode('list')}
                            style={{
                                padding: '0.6rem 1rem', cursor: 'pointer', border: 'none',
                                background: viewMode === 'list' ? 'var(--color-blue)' : 'white',
                                color: viewMode === 'list' ? 'white' : '#333'
                            }}
                        >
                            Lista
                        </button>
                        <button
                            onClick={() => setViewMode('kanban')}
                            style={{
                                padding: '0.6rem 1rem', cursor: 'pointer', border: 'none',
                                background: viewMode === 'kanban' ? 'var(--color-blue)' : 'white',
                                color: viewMode === 'kanban' ? 'white' : '#333'
                            }}
                        >
                            Kanban
                        </button>
                    </div>
                </div>
            </div>

            {loading ? <p>Carregando...</p> : (
                <>
                    {viewMode === 'list' ? (
                        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                            {filteredSubscribers.length === 0 ? (
                                <p style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Nenhum assinante encontrado.</p>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Nome/CPF</th>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Contato</th>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Status</th>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Cidade</th>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredSubscribers.map(sub => (
                                            <tr key={sub.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ fontWeight: 'bold' }}>{sub.name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{sub.cpf_cnpj}</div>
                                                </td>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ fontSize: '0.9rem' }}>{sub.email}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{sub.phone}</div>
                                                </td>
                                                <td style={{ padding: '1rem' }}>
                                                    <span style={{
                                                        padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem',
                                                        background: sub.status?.includes('ativo') ? '#dcfce7' :
                                                            sub.status?.includes('cancelado') ? '#fee2e2' : '#dbeafe',
                                                        color: sub.status?.includes('ativo') ? '#166534' :
                                                            sub.status?.includes('cancelado') ? '#dc2626' : '#1e40af'
                                                    }}>
                                                        {sub.status?.toUpperCase().replace('_', ' ')}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem' }}>{sub.cidade ? `${sub.cidade}/${sub.uf}` : '-'}</td>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            onClick={() => handleEmission(sub)}
                                                            disabled={generatingId === sub.id}
                                                            title="Emitir Boleto Consolidado"
                                                            style={{
                                                                background: '#fff7ed', color: '#c2410c', border: '1px solid #ffedd5',
                                                                padding: '0.4rem 0.6rem', borderRadius: '4px', cursor: 'pointer',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                            }}
                                                        >
                                                            {generatingId === sub.id ? '...' : <CreditCard size={14} />}
                                                        </button>
                                                        <button
                                                            onClick={() => { setEditingSubscriber(sub); setIsModalOpen(true); }}
                                                            style={{ border: '1px solid #ccc', background: 'white', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            Editar
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    ) : (
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
                            onDragCancel={() => { setActiveId(null); fetchSubscribers(); }}
                        >
                            <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                                {['ativacao', 'ativo', 'ativo_inadimplente', 'transferido', 'cancelado', 'cancelado_inadimplente'].map(status => (
                                    <KanbanColumn
                                        key={status}
                                        status={status}
                                        label={status}
                                        color={statusColors[status] || '#64748b'}
                                        subscribers={filteredSubscribers.filter(s => s.status === status)}
                                        onCardClick={(sub) => { setEditingSubscriber(sub); setIsModalOpen(true); }}
                                    />
                                ))}
                            </div>

                            <DragOverlay>
                                {activeId ? (
                                    <KanbanCard
                                        subscriber={subscribers.find(s => s.id === activeId)}
                                        isOverlay
                                    />
                                ) : null}
                            </DragOverlay>
                        </DndContext>
                    )}
                </>
            )}

            {isModalOpen && (
                <SubscriberModal
                    subscriber={editingSubscriber}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
