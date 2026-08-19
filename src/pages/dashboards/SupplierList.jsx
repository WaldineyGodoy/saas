import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import SupplierModal from '../../components/SupplierModal';
import { Eye, Pencil, RefreshCw, Search, Plus, Building2, User } from 'lucide-react';
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
    { status: 'ativacao', label: 'Em Ativação', color: '#854d0e', bg: '#fef9c3' },
    { status: 'contrato_assinado', label: 'Contrato Assinado', color: '#1e40af', bg: '#dbeafe' },
    { status: 'ativo', label: 'Ativo', color: '#166534', bg: '#dcfce7' },
    { status: 'inativo', label: 'Inativo', color: '#991b1b', bg: '#fee2e2' }
];

function KanbanCard({ supplier, onClick, isOverlay }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: supplier.id, disabled: !!isOverlay });

    const statusConfig = KANBAN_STATUSES.find(s => s.status === supplier.status) || KANBAN_STATUSES[3];

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        zIndex: isDragging ? 1000 : 1,
        position: 'relative',
        overflow: 'hidden',
        width: isOverlay ? '300px' : 'auto'
    };

    return (
        <div
            ref={setNodeRef}
            className="kanban-card"
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(supplier)}
        >
            <div style={{
                display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '4px',
                fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase',
                background: statusConfig.bg, color: statusConfig.color,
                marginBottom: '0.5rem'
            }}>
                {statusConfig.label}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)', lineHeight: '1.2' }}>{supplier.name}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', color: '#666', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    CNPJ: {supplier.cnpj || 'Não informado'}
                </span>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ color: '#64748b' }}>Contato:</span> {supplier.phone || 'Sem contato'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ color: '#64748b' }}>Email:</span> {supplier.email || 'Sem email'}
                </div>
            </div>
        </div>
    );
}

function KanbanColumn({ status, label, color, suppliers, onCardClick }) {
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
                <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>
                    {label}
                </span>
                <span style={{ fontSize: '0.8rem', background: color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                    {suppliers.length}
                </span>
            </div>
            <div className="kanban-column-content">
                <SortableContext
                    items={suppliers.map(p => p.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {suppliers.map(supplier => (
                        <KanbanCard
                            key={supplier.id}
                            supplier={supplier}
                            onClick={onCardClick}
                        />
                    ))}
                </SortableContext>
            </div>
        </div>
    );
}


export default function SupplierList() {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('kanban');
    const [activeId, setActiveId] = useState(null);

    useEffect(() => {
        fetchSuppliers();
    }, []);

    const fetchSuppliers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('suppliers')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;
            setSuppliers(data || []);
        } catch (error) {
            console.error('Erro suppliers', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredSuppliers = useMemo(() => {
        return suppliers.filter(s => {
            const lowerTerm = searchTerm.toLowerCase();
            return (
                s.name?.toLowerCase().includes(lowerTerm) ||
                s.cnpj?.includes(lowerTerm) ||
                s.email?.toLowerCase().includes(lowerTerm)
            );
        });
    }, [suppliers, searchTerm]);

    
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        })
    );

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
            const targetSupplier = suppliers.find(p => p.id === overId);
            newStatus = targetSupplier?.status;
        }

        const activeSupplier = suppliers.find(p => p.id === activeId);
        if (activeSupplier && activeSupplier.status !== newStatus) {
            // Optimistic update
            setSuppliers(prev => prev.map(p => {
                if (p.id === activeId) return { ...p, status: newStatus };
                return p;
            }));

            // API update
            const { error } = await supabase
                .from('suppliers')
                .update({ status: newStatus })
                .eq('id', activeId);

            if (error) {
                console.error('Erro update status', error);
                // Revert
                setSuppliers(prev => prev.map(p => {
                    if (p.id === activeId) return { ...p, status: activeSupplier.status };
                    return p;
                }));
            }
        }
    };

    const handleSave = () => {
        fetchSuppliers();
        setIsModalOpen(false);
    };

    const handleDelete = (id) => {
        setSuppliers(suppliers.filter(s => s.id !== id));
        setIsModalOpen(false);
    };
    return (
        <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
            <style>
                {`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .spin { animation: spin 1s linear infinite; }
                `}
            </style>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.2rem' }}>Fornecedores (Geradores)</h2>
                    <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Gerencie os parceiros de geração e infraestrutura do sistema.</p>
                </div>
                <button
                    onClick={() => { setEditingSupplier(null); setIsModalOpen(true); }}
                    style={{ 
                        padding: '0.75rem 1.5rem', 
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', 
                        color: 'white', 
                        borderRadius: '14px', 
                        fontWeight: 700, 
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        boxShadow: '0 10px 15px -3px rgba(37, 99, 235, 0.3)',
                        transition: 'transform 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                >
                    <Plus size={18} strokeWidth={3} />
                    Novo Fornecedor
                </button>
            </div>

            {/* Summary Bar */}
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '220px', background: 'white', padding: '1.2rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '0.8rem', background: '#eff6ff', borderRadius: '12px' }}>
                        <Building2 size={24} color="#3b82f6" />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.025em' }}>Total Fornecedores</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>{suppliers.length}</div>
                    </div>
                </div>
                <div style={{ flex: 1, minWidth: '220px', background: 'white', padding: '1.2rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '0.8rem', background: '#ecfdf5', borderRadius: '12px' }}>
                        <Building2 size={24} color="#10b981" />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.025em' }}>Ativos</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981' }}>{suppliers.filter(s => s.status === 'ativo').length}</div>
                    </div>
                </div>
                <div style={{ flex: 1, minWidth: '220px', background: 'white', padding: '1.2rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '0.8rem', background: '#fffbeb', borderRadius: '12px' }}>
                        <Building2 size={24} color="#f59e0b" />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.025em' }}>Em Ativação</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f59e0b' }}>{suppliers.filter(s => s.status === 'ativacao').length}</div>
                    </div>
                </div>
            </div>

            
            {/* Toolbar */}
            <div style={{ 
                display: 'flex', 
                gap: '1rem', 
                marginBottom: '1.5rem',
                background: 'white',
                padding: '1rem',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                    <Search size={18} color="#94a3b8" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                    <input 
                        type="text" 
                        placeholder="Buscar por nome, CNPJ ou email..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ 
                            width: '100%', 
                            padding: '0.8rem 1rem 0.8rem 2.8rem', 
                            borderRadius: '12px', 
                            border: '1px solid #e2e8f0',
                            fontSize: '0.9rem',
                            outline: 'none',
                            transition: 'all 0.2s',
                            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
                        }}
                        onFocus={e => e.target.style.borderColor = '#3b82f6'}
                        onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                    />
                </div>
                
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <div className="btn-group">
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

                    <button 
                        onClick={fetchSuppliers}
                        className="btn btn-secondary"
                        style={{ padding: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Atualizar"
                    >
                        <RefreshCw size={18} className={loading ? 'spin' : ''} />
                    </button>
                    <button 
                        onClick={() => { setEditingSupplier(null); setIsModalOpen(true); }}
                        className="btn btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 1.5rem', fontWeight: 600, letterSpacing: '0.025em' }}
                    >
                        <Plus size={18} />
                        Novo Fornecedor
                    </button>
                </div>
            </div>
            
{loading ? (
                <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
                    <div className="spin" style={{ display: 'inline-block', marginBottom: '1rem' }}>
                        <RefreshCw size={32} color="#3b82f6" />
                    </div>
                    <div>Carregando fornecedores...</div>
                </div>
            ) : filteredSuppliers.length === 0 ? (
                <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                    Nenhum fornecedor encontrado.
                </div>
            ) : viewMode === 'list' ? (
                <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                                    <th style={{ padding: '1.2rem 1.5rem', textAlign: 'left', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fornecedor</th>
                                    <th style={{ padding: '1.2rem 1.5rem', textAlign: 'left', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CNPJ</th>
                                    <th style={{ padding: '1.2rem 1.5rem', textAlign: 'left', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contato</th>
                                    <th style={{ padding: '1.2rem 1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                                    <th style={{ padding: '1.2rem 1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredSuppliers.map(s => {
                                    const statusConfig = KANBAN_STATUSES.find(st => st.status === s.status) || KANBAN_STATUSES[3];
                                    return (
                                        <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <td style={{ padding: '1.2rem 1.5rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <div style={{ padding: '0.5rem', background: '#eff6ff', borderRadius: '10px' }}>
                                                        <Building2 size={20} color="#3b82f6" />
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '0.95rem' }}>{s.name}</div>
                                                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Cod: {s.id.substring(0, 8)}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: '1.2rem 1.5rem', color: '#475569', fontSize: '0.9rem', fontFamily: 'monospace' }}>
                                                {s.cnpj}
                                            </td>
                                            <td style={{ padding: '1.2rem 1.5rem' }}>
                                                <div style={{ fontSize: '0.9rem', color: '#1e293b', fontWeight: 500 }}>{s.email}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{s.phone}</div>
                                            </td>
                                            <td style={{ padding: '1.2rem 1.5rem', textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '0.3rem 0.8rem', 
                                                    borderRadius: '8px', 
                                                    fontSize: '0.7rem', 
                                                    fontWeight: 800,
                                                    background: statusConfig.bg,
                                                    color: statusConfig.color,
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {statusConfig.label}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1.2rem 1.5rem' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                                    <button
                                                        onClick={() => { setEditingSupplier(s); setIsModalOpen(true); }}
                                                        title="Visualizar Detalhes"
                                                        style={{ 
                                                            padding: '0.5rem', 
                                                            borderRadius: '10px', 
                                                            border: '1px solid #e2e8f0', 
                                                            background: 'white', 
                                                            color: '#64748b',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            transition: 'all 0.2s'
                                                        }}
                                                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#3b82f6'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b'; }}
                                                    >
                                                        <Eye size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => { setEditingSupplier(s); setIsModalOpen(true); }}
                                                        title="Editar Fornecedor"
                                                        style={{ 
                                                            padding: '0.5rem', 
                                                            borderRadius: '10px', 
                                                            border: '1px solid #e2e8f0', 
                                                            background: 'white', 
                                                            color: '#2563eb',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            transition: 'all 0.2s'
                                                        }}
                                                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.background = '#f0f7ff'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = 'white'; }}
                                                    >
                                                        <Pencil size={18} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div style={{ flex: 1, minHeight: 0, paddingBottom: '2rem' }}>
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCorners}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragCancel={() => setActiveId(null)}
                    >
                        <div className="kanban-box">
                            <div className="kanban-board">
                                {KANBAN_STATUSES.map(({ status, label, color }) => {
                                    const suppliersInStatus = filteredSuppliers.filter(s => s.status === status);
                                    return (
                                        <KanbanColumn
                                            key={status}
                                            status={status}
                                            label={label}
                                            color={color}
                                            suppliers={suppliersInStatus}
                                            onCardClick={(s) => { setEditingSupplier(s); setIsModalOpen(true); }}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                        <DragOverlay adjustScale={true}>
                            {activeId ? (
                                <KanbanCard
                                    supplier={suppliers.find(p => p.id === activeId)}
                                    isOverlay={true}
                                />
                            ) : null}
                        </DragOverlay>
                    </DndContext>
                </div>
            )}


            {isModalOpen && (
                <SupplierModal
                    key={editingSupplier?.id}
                    supplier={editingSupplier}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
