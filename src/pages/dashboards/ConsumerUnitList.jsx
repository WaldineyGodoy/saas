import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Calendar as CalendarIcon, List, Layout, Info, Download, Pencil, Trash2 } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';
import ConsumerUnitModal from '../../components/ConsumerUnitModal';

import ScraperTriggerModal from '../../components/ScraperTriggerModal';



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
    { status: 'vinculado', label: 'Vinculado a Usina', color: '#4f46e5' },
    { status: 'em_transf_titularidade', label: 'Em Transf. de Titularidade', color: '#db2777' },
    { status: 'aguardando_conexao', label: 'Aguardando Conexão', color: '#eab308' },
    { status: 'ativo', label: 'Ativo', color: '#22c55e' },
    { status: 'sem_geracao', label: 'Sem Geração', color: '#64748b' },
    { status: 'em_atraso', label: 'Em Atraso', color: '#f97316' },
    { status: 'desconectado', label: 'Desconectado', color: '#4b5563' },
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
        zIndex: isDragging ? 1000 : 1,
        position: 'relative',
        width: isOverlay ? '300px' : 'auto'
    };

    return (
        <div
            ref={setNodeRef}
            className="kanban-card"
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
                    {units.length}
                </span>
            </div>
            <div className="kanban-column-content">
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

const getStatusBadgeStyle = (status) => {
    switch (status) {
        case 'ativo':
            return { bg: '#dcfce7', text: '#15803d', label: 'Ativo' };
        case 'em_ativacao':
            return { bg: '#eff6ff', text: '#1d4ed8', label: 'Em Ativação' };
        case 'vinculado':
            return { bg: '#e0e7ff', text: '#4338ca', label: 'Vinculado a Usina' };
        case 'em_transf_titularidade':
            return { bg: '#fce7f3', text: '#be185d', label: 'Em Transf. Titularidade' };
        case 'aguardando_conexao':
            return { bg: '#fef9c3', text: '#a16207', label: 'Aguardando Conexão' };
        case 'sem_geracao':
            return { bg: '#f1f5f9', text: '#475569', label: 'Sem Geração' };
        case 'em_atraso':
            return { bg: '#ffe4e6', text: '#b91c1c', label: 'Em Atraso' };
        case 'desconectado':
            return { bg: '#f3e8ff', text: '#6b21a8', label: 'Desconectado' };
        case 'cancelado':
            return { bg: '#fee2e2', text: '#991b1b', label: 'Cancelado' };
        case 'cancelado_inadimplente':
            return { bg: '#fee2e2', text: '#991b1b', label: 'Cancelado (Inad.)' };
        default:
            return { bg: '#f1f5f9', text: '#475569', label: status?.replace('_', ' ').toUpperCase() || '-' };
    }
};

export default function ConsumerUnitList() {
    const { showAlert, showConfirm } = useUI();
    const [units, setUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const [viewMode, setViewMode] = useState('list');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUnit, setEditingUnit] = useState(null);
    const [activeId, setActiveId] = useState(null);
    const [showTooltip, setShowTooltip] = useState(false);
    const [isScraperModalOpen, setIsScraperModalOpen] = useState(false);

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
            u.titular_fatura?.name?.toLowerCase().includes(lower) ||
            u.titular_conta?.toLowerCase().includes(lower) ||
            u.concessionaria?.toLowerCase().includes(lower) ||
            u.address?.cidade?.toLowerCase().includes(lower) ||
            u.status?.toLowerCase().includes(lower)
        );
    });

    useEffect(() => {
        fetchUnits();

        const channel = supabase
            .channel('db-all-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'consumer_units' }, () => {
                fetchUnits();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchUnits = async () => {
        setLoading(true);
        try {
            // 1. Buscar Unidades Consumidoras
            const { data: unitsData, error: unitsError } = await supabase
                .from('consumer_units')
                .select(`
                    *,
                    subscriber:subscriber_id (name, cpf_cnpj, portal_credentials),
                    titular_fatura:titular_fatura_id (name, portal_credentials),
                    supplier:supplier_id (name, cnpj, email, phone)
                `)
                .order('created_at', { ascending: false });

            if (unitsError) throw unitsError;
            setUnits(unitsData || []);

        } catch (error) {
            console.error('Error fetching data:', error);
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
        <div style={{ padding: '1.5rem', maxWidth: '1600px', margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ color: '#1e293b', fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.025em', margin: 0 }}>
                    Gestão de Unidades Consumidoras
                </h2>
            </div>

            {/* Cabeçalho Fixo (Filtros + Ações + Legenda) */}
            <div style={{
                position: 'sticky',
                top: 0,
                zIndex: 100,
                background: 'rgba(248, 250, 252, 0.8)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: '1rem 0',
                margin: '0 -1.5rem 1.5rem -1.5rem',
                paddingLeft: '1.5rem',
                paddingRight: '1.5rem',
                borderBottom: '1px solid rgba(226, 232, 240, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', flex: 1, alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                            <input
                                placeholder="Buscar UC, Assinante..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="input"
                                style={{
                                    width: '100%',
                                    padding: '0.6rem 1rem',
                                    borderRadius: '10px',
                                    border: '1px solid #e2e8f0',
                                    fontSize: '0.9rem'
                                }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <div className="btn-group" style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <button onClick={() => setViewMode('list')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'list' ? 'white' : 'transparent', color: viewMode === 'list' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'list' ? '700' : '500', fontSize: '0.85rem', boxShadow: viewMode === 'list' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none' }}>
                                <List size={16} /> Lista
                            </button>
                            <button onClick={() => setViewMode('kanban')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'kanban' ? 'white' : 'transparent', color: viewMode === 'kanban' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'kanban' ? '700' : '500', fontSize: '0.85rem', boxShadow: viewMode === 'kanban' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none' }}>
                                <Layout size={16} /> Kanban
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                                onClick={() => { setEditingUnit(null); setIsModalOpen(true); }}
                                style={{ padding: '0.6rem 1.2rem', background: 'var(--color-blue)', color: 'white', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: 'none', fontSize: '0.85rem', transition: 'all 0.2s' }}
                                onMouseOver={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                                onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                            >
                                + Nova UC
                            </button>
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
                                    <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ background: '#f8fafc', padding: '12px 16px', fontSize: '0.75rem', fontWeight: '800', color: '#475569', textTransform: 'uppercase', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>UC</th>
                                                <th style={{ background: '#f8fafc', padding: '12px 16px', fontSize: '0.75rem', fontWeight: '800', color: '#475569', textTransform: 'uppercase', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>Concessionária</th>
                                                <th style={{ background: '#f8fafc', padding: '12px 16px', fontSize: '0.75rem', fontWeight: '800', color: '#475569', textTransform: 'uppercase', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>Assinante ou Fornecedor</th>
                                                <th style={{ background: '#f8fafc', padding: '12px 16px', fontSize: '0.75rem', fontWeight: '800', color: '#475569', textTransform: 'uppercase', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>Identificação na Fatura</th>
                                                <th style={{ background: '#f8fafc', padding: '12px 16px', fontSize: '0.75rem', fontWeight: '800', color: '#475569', textTransform: 'uppercase', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>Franquia</th>
                                                <th style={{ background: '#f8fafc', padding: '12px 16px', fontSize: '0.75rem', fontWeight: '800', color: '#475569', textTransform: 'uppercase', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>Status</th>
                                                <th style={{ background: '#f8fafc', padding: '12px 16px', fontSize: '0.75rem', fontWeight: '800', color: '#475569', textTransform: 'uppercase', textAlign: 'center', borderBottom: '2px solid #e2e8f0' }}>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredUnits.map(uc => {
                                                const badgeStyle = getStatusBadgeStyle(uc.status);
                                                return (
                                                    <tr key={uc.id} style={{ borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                                                            <span 
                                                                onClick={() => { setEditingUnit(uc); setIsModalOpen(true); }}
                                                                style={{
                                                                    color: '#1d4ed8',
                                                                    background: '#eff6ff',
                                                                    padding: '6px 12px',
                                                                    borderRadius: '9999px',
                                                                    fontWeight: '600',
                                                                    cursor: 'pointer',
                                                                    display: 'inline-block',
                                                                    transition: 'all 0.2s',
                                                                    fontSize: '0.85rem'
                                                                }}
                                                                onMouseOver={e => { e.currentTarget.style.background = '#dbeafe'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                                                onMouseOut={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                                            >
                                                                {uc.numero_uc}
                                                            </span>
                                                        </td>
                                                        <td style={{ padding: '14px 16px', color: '#475569', fontWeight: '500', verticalAlign: 'middle' }}>{uc.concessionaria || '-'}</td>
                                                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                                                             {uc.subscriber ? (
                                                                 <>
                                                                     <div style={{ fontWeight: '700', color: '#1e293b' }}>{uc.subscriber.name}</div>
                                                                     <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>{uc.subscriber.cpf_cnpj}</div>
                                                                 </>
                                                             ) : uc.supplier ? (
                                                                 <>
                                                                     <div style={{ fontWeight: '700', color: '#d946ef' }}>{uc.supplier.name} <span style={{ fontSize: '0.65rem', background: '#fae8ff', color: '#d946ef', padding: '1px 5px', borderRadius: '4px', marginLeft: '4px', display: 'inline-block', fontWeight: '700' }}>Fornecedor</span></div>
                                                                     <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>{uc.supplier.cnpj}</div>
                                                                 </>
                                                             ) : (
                                                                 <div style={{ color: '#94a3b8' }}>-</div>
                                                             )}
                                                        </td>
                                                        <td style={{ padding: '14px 16px', color: '#1e293b', fontWeight: '600', verticalAlign: 'middle' }}>
                                                            {uc.titular_conta || '-'}
                                                        </td>
                                                        <td style={{ padding: '14px 16px', fontWeight: '700', color: '#16a34a', verticalAlign: 'middle' }}>
                                                            {uc.franquia ? `${Number(uc.franquia).toLocaleString('pt-BR')} kWh` : '-'}
                                                        </td>
                                                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                                                            <span className="badge" style={{
                                                                padding: '6px 12px',
                                                                borderRadius: '9999px',
                                                                background: badgeStyle.bg,
                                                                color: badgeStyle.text,
                                                                fontSize: '0.75rem',
                                                                fontWeight: '700',
                                                                display: 'inline-block'
                                                            }}>
                                                                {badgeStyle.label}
                                                            </span>
                                                        </td>
                                                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                                                                <button
                                                                    onClick={() => { setEditingUnit(uc); setIsModalOpen(true); }}
                                                                    style={{
                                                                        padding: '6px 10px',
                                                                        background: '#eff6ff',
                                                                        border: 'none',
                                                                        borderRadius: '8px',
                                                                        cursor: 'pointer',
                                                                        color: '#2563eb',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                        fontSize: '0.8rem',
                                                                        fontWeight: '600',
                                                                        transition: 'all 0.2s'
                                                                    }}
                                                                    onMouseOver={e => { e.currentTarget.style.background = '#dbeafe'; }}
                                                                    onMouseOut={e => { e.currentTarget.style.background = '#eff6ff'; }}
                                                                    title="Editar UC"
                                                                >
                                                                    <Pencil size={14} />
                                                                    <span>Editar</span>
                                                                </button>
                                                                <button
                                                                    onClick={async () => {
                                                                        const confirm = await showConfirm(
                                                                            `Tem certeza que deseja excluir permanentemente a Unidade Consumidora ${uc.numero_uc}? Esta ação não pode ser desfeita.`,
                                                                            'Excluir Unidade Consumidora',
                                                                            'Excluir',
                                                                            'Cancelar'
                                                                        );
                                                                        if (confirm) {
                                                                            try {
                                                                                const { error } = await supabase.from('consumer_units').delete().eq('id', uc.id);
                                                                                if (error) throw error;
                                                                                showAlert('Unidade Consumidora excluída com sucesso!', 'success');
                                                                                fetchUnits();
                                                                            } catch (err) {
                                                                                showAlert('Erro ao excluir Unidade Consumidora: ' + err.message, 'error');
                                                                            }
                                                                        }
                                                                    }}
                                                                    style={{
                                                                        padding: '6px 10px',
                                                                        background: '#fef2f2',
                                                                        border: 'none',
                                                                        borderRadius: '8px',
                                                                        cursor: 'pointer',
                                                                        color: '#dc2626',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px',
                                                                        fontSize: '0.8rem',
                                                                        fontWeight: '600',
                                                                        transition: 'all 0.2s'
                                                                    }}
                                                                    onMouseOver={e => { e.currentTarget.style.background = '#fee2e2'; }}
                                                                    onMouseOut={e => { e.currentTarget.style.background = '#fef2f2'; }}
                                                                    title="Excluir UC"
                                                                >
                                                                    <Trash2 size={14} />
                                                                    <span>Excluir</span>
                                                                </button>
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
                                const pointerCollisions = pointerWithin(args);
                                if (pointerCollisions.length > 0) return pointerCollisions;
                                return rectIntersection(args);
                            }}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDragEnd={handleDragEnd}
                            onDragCancel={() => { setActiveId(null); fetchUnits(); }}
                        >
                            <div className="kanban-box">
                                <div className="kanban-board">
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
