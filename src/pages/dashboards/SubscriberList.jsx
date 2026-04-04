import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import SubscriberModal from '../../components/SubscriberModal';
import { CreditCard, X, Eye, Pencil, RefreshCw, CheckCircle, AlertCircle, Clock, Calendar } from 'lucide-react';
import { createAsaasCharge } from '../../lib/api';
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
    const [monthFilter, setMonthFilter] = useState(new Date().toISOString().substring(0, 7));
    const [subStats, setSubStats] = useState({});

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
    }, [monthFilter]);

    const fetchSubscribers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('subscribers')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;
            setSubscribers(data || []);
            // Buscar estatísticas após carregar assinantes
            if (data && data.length > 0) {
                fetchStats(data, monthFilter);
            }
        } catch (error) {
            console.error('Error fetching subscribers:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchStats = async (subs, month) => {
        try {
            const subIds = subs.map(s => s.id);

            // 1. Buscar Faturas (Unpaid/Vencido/A Vencer para Total Global E todas do mês selecionado)
            // Filtramos por subscriber_id via consumer_units para performance e precisão
            const { data: allInvoices, error: invError } = await supabase
                .from('invoices')
                .select('id, uc_id, valor_a_pagar, status, mes_referencia, vencimento, consumer_units!inner(subscriber_id)')
                .in('consumer_units.subscriber_id', subIds);

            if (invError) throw invError;

            // 2. Buscar Unidades Consumidoras (para Indicador de Leitura)
            const { data: units } = await supabase
                .from('consumer_units')
                .select('id, subscriber_id, last_scraping_status, last_scraping_at, dia_leitura')
                .in('subscriber_id', subIds);

            // 3. Buscar Faturas Consolidadas do Mês Selecionado (para Cor do Boleto)
            const { data: consolidated } = await supabase
                .from('consolidated_invoices')
                .select('id, subscriber_id, status, asaas_boleto_url, created_at, due_date')
                .in('subscriber_id', subIds);

            // Filtrar consolidados do mês (Vencimento ou Criação)
            const consolidatedThisMonth = consolidated?.filter(c => 
                (c.due_date && c.due_date.startsWith(month)) || 
                c.created_at.startsWith(month)
            ) || [];

            const stats = {};
            subs.forEach(sub => {
                const subInvoices = allInvoices?.filter(inv => inv.consumer_units?.subscriber_id === sub.id) || [];
                const subUnits = units?.filter(u => u.subscriber_id === sub.id) || [];
                
                // Total no Mês Selecionado (Baseado em Vencimento: o que o assinante precisa pagar no mês)
                const invoicesFinance = subInvoices.filter(inv => 
                    inv.vencimento?.startsWith(month) || 
                    inv.mes_referencia?.startsWith(month)
                );
                
                const totalMonth = invoicesFinance.reduce((sum, inv) => 
                    inv.status !== 'pago' ? sum + Number(inv.valor_a_pagar || 0) : sum
                , 0);

                // Total Global (Dívida real: pendentes, vencidas e a vencer)
                const totalGlobal = subInvoices
                    .filter(inv => inv.status === 'pendente' || inv.status === 'vencido' || inv.status === 'a_vencer')
                    .reduce((sum, inv) => sum + Number(inv.valor_a_pagar || 0), 0);

                // Indicador de Leitura (UCs com leitura ou fatura NO MÊS de REFERÊNCIA filtrado)
                const readingTotal = subUnits.length;
                const readingScanned = subUnits.filter(u => {
                    const hasInvThisMonth = subInvoices.some(inv => 
                        inv.uc_id === u.id && inv.mes_referencia?.startsWith(month)
                    );
                    const readThisMonth = u.last_scraping_at?.startsWith(month);
                    return hasInvThisMonth || (readThisMonth && u.last_scraping_status === 'success');
                }).length;

                // Cor do Ícone de Boleto (Baseado no financeiro do mês)
                const subConsolidated = consolidatedThisMonth.find(c => c.subscriber_id === sub.id);
                let boletoColor = '#94a3b8'; // Default Gray
                if (totalMonth > 0) {
                    if (!subConsolidated) {
                        boletoColor = '#ef4444'; // Vermelho (Pendente emissão)
                    } else if (subConsolidated.status === 'PAID') {
                        boletoColor = '#10b981'; // Verde (Pago)
                    } else {
                        boletoColor = '#3b82f6'; // Azul (Emitido/Pendente)
                    }
                } else if (totalGlobal > 0 && subConsolidated) {
                    // Caso tenha boleto emitido mas não seja do mês atual (histórico)
                    boletoColor = subConsolidated.status === 'PAID' ? '#10b981' : '#3b82f6';
                }

                stats[sub.id] = { totalGlobal, totalMonth, readingTotal, readingScanned, boletoColor };
            });

            setSubStats(stats);
        } catch (error) {
            console.error('Error fetching stats:', error);
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
            <style>
                {`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .spin {
                    animation: spin 1s linear infinite;
                }
                `}
            </style>
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
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginBottom: '1.5rem', 
                flexWrap: 'wrap', 
                gap: '1rem',
                padding: '0.5rem',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0'
            }}>
                <div style={{ display: 'flex', gap: '1rem', flex: 1, minWidth: '300px' }}>
                    <input
                        type="text"
                        placeholder="Buscar por nome, email, telefone ou CPF..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            padding: '0.6rem 1rem', width: '100%', maxWidth: '400px',
                            border: '1px solid #cbd5e1', borderRadius: '6px',
                            fontSize: '0.9rem', outline: 'none'
                        }}
                    />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.5rem', 
                        background: 'white', 
                        padding: '0.2rem 0.8rem', 
                        borderRadius: '6px', 
                        border: '1px solid #cbd5e1',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    }}>
                        <Calendar size={16} color="#64748b" />
                        <input
                            type="month"
                            value={monthFilter}
                            onChange={(e) => setMonthFilter(e.target.value)}
                            style={{
                                border: 'none', 
                                background: 'transparent', 
                                padding: '0.4rem 0.2rem', 
                                outline: 'none', 
                                color: '#1e293b', 
                                fontWeight: 700, 
                                fontSize: '0.9rem',
                                cursor: 'pointer'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden', background: 'white' }}>
                        <button
                            onClick={() => setViewMode('list')}
                            style={{
                                padding: '0.6rem 1.2rem', cursor: 'pointer', border: 'none',
                                background: viewMode === 'list' ? 'var(--color-blue)' : 'transparent',
                                color: viewMode === 'list' ? 'white' : '#64748b',
                                fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s'
                            }}
                        >
                            Lista
                        </button>
                        <button
                            onClick={() => setViewMode('kanban')}
                            style={{
                                padding: '0.6rem 1.2rem', cursor: 'pointer', border: 'none',
                                background: viewMode === 'kanban' ? 'var(--color-blue)' : 'transparent',
                                color: viewMode === 'kanban' ? 'white' : '#64748b',
                                fontWeight: 600, fontSize: '0.85rem', transition: 'all 0.2s'
                            }}
                        >
                            Kanban
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                    <RefreshCw size={40} color="var(--color-blue)" className="spin" />
                </div>
            ) : (
                <>
                    {viewMode === 'list' ? (
                        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                            {filteredSubscribers.length === 0 ? (
                                <p style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Nenhum assinante encontrado.</p>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                                            <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nome / CPF / Contato</th>
                                            <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Total no Mês</th>
                                            <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Total a Pagar</th>
                                            <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Status</th>
                                            <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Leitura</th>
                                            <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredSubscribers.map(sub => {
                                            const stats = subStats[sub.id] || { totalMonth: 0, totalGlobal: 0, readingTotal: 0, readingScanned: 0, boletoColor: '#94a3b8' };
                                            
                                            return (
                                                <tr key={sub.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '1rem' }}>
                                                        <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '0.95rem' }}>{sub.name}</div>
                                                        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>{sub.cpf_cnpj}</div>
                                                        <div style={{ mt: '0.2rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                                                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{sub.email}</div>
                                                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{sub.phone}</div>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                                                        <div style={{ fontWeight: 700, color: stats.totalMonth > 0 ? '#ef4444' : '#64748b' }}>
                                                            {stats.totalMonth.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                                                        <div style={{ fontWeight: 700, color: '#1e293b' }}>
                                                            {stats.totalGlobal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                        <span style={{
                                                            padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 900,
                                                            background: `${statusColors[sub.status] || '#64748b'}15`,
                                                            color: statusColors[sub.status] || '#64748b',
                                                            border: `1px solid ${statusColors[sub.status] || '#64748b'}30`,
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            {sub.status?.replace('_', ' ')}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                        <div style={{ 
                                                            display: 'inline-flex', alignItems: 'center', gap: '0.4rem', 
                                                            padding: '0.2rem 0.5rem', borderRadius: '6px', 
                                                            background: stats.readingScanned === stats.readingTotal && stats.readingTotal > 0 ? '#f0fdf4' : '#f8fafc',
                                                            border: '1px solid #e2e8f0'
                                                        }}>
                                                            {stats.readingScanned === stats.readingTotal && stats.readingTotal > 0 ? (
                                                                <CheckCircle size={14} color="#10b981" />
                                                            ) : (
                                                                <RefreshCw size={14} color="#94a3b8" />
                                                            )}
                                                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                                                                {stats.readingScanned}/{stats.readingTotal}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '1rem' }}>
                                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                                            <button
                                                                onClick={() => handleEmission(sub)}
                                                                disabled={generatingId === sub.id}
                                                                title="Emitir Boleto Consolidado"
                                                                style={{
                                                                    background: `${stats.boletoColor}15`, 
                                                                    color: stats.boletoColor, 
                                                                    border: `1px solid ${stats.boletoColor}30`,
                                                                    padding: '0.5rem', borderRadius: '6px', cursor: 'pointer',
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    transition: 'all 0.2s'
                                                                }}
                                                                onMouseEnter={e => e.currentTarget.style.background = `${stats.boletoColor}30`}
                                                                onMouseLeave={e => e.currentTarget.style.background = `${stats.boletoColor}15`}
                                                            >
                                                                {generatingId === sub.id ? <RefreshCw size={14} className="spin" /> : <CreditCard size={14} />}
                                                            </button>
                                                            <button
                                                                onClick={() => { setEditingSubscriber(sub); setIsModalOpen(true); }}
                                                                title="Visualizar Assinante"
                                                                style={{ border: '1px solid #e2e8f0', background: 'white', padding: '0.5rem', borderRadius: '6px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                            >
                                                                <Eye size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => { setEditingSubscriber(sub); setIsModalOpen(true); }}
                                                                title="Editar Assinante"
                                                                style={{ border: '1px solid #e2e8f0', background: 'white', padding: '0.5rem', borderRadius: '6px', cursor: 'pointer', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                            >
                                                                <Pencil size={16} />
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
