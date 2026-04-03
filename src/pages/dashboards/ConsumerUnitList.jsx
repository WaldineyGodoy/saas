import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
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

function CalendarView({ units, invoices, monthFilter, searchTerm, readingStatusFilter, onCardClick }) {
    const today = new Date();
    const currentYearNum = today.getFullYear();
    const currentMonthNum = today.getMonth() + 1;
    const currentDayNum = today.getDate();

    const [filterYear, filterMonth] = (monthFilter || '').split('-').map(Number);
    const isCurrentMonth = filterYear === currentYearNum && filterMonth === currentMonthNum;

    const days = Array.from({ length: 31 }, (_, i) => i + 1);

    // 1. Filtrar apenas Ativas para o Calendário
    const activeUnits = units.filter(u => u.status === 'ativo');

    // 2. Agrupar e Calcular Status
    const groupedUnits = activeUnits.reduce((acc, unit) => {
        const unitDate = new Date(unit.created_at);
        const unitYear = unitDate.getFullYear();
        const unitMonth = unitDate.getMonth() + 1;
        
        if (unitYear > filterYear || (unitYear === filterYear && unitMonth > filterMonth)) {
            return acc;
        }

        const day = unit.dia_leitura || 0;
        const monthRef = `${monthFilter}-01`;
        const hasInvoice = invoices.some(inv => 
            inv.uc_id === unit.id && 
            inv.mes_referencia === monthRef && 
            inv.status !== 'cancelado'
        );

        let status = 'pending';
        if (hasInvoice) {
            status = 'success';
        } else if (unit.last_scraping_status === 'processing') {
            status = 'processing';
        } else {
            const isFuture = (filterYear > currentYearNum) || 
                           (filterYear === currentYearNum && filterMonth > currentMonthNum) || 
                           (isCurrentMonth && day > currentDayNum);

            if (isFuture) {
                status = 'not_available';
            } else if (unit.last_scraping_status === 'error') {
                status = 'error';
            } else {
                status = 'pending';
            }
        }

        if (readingStatusFilter && status !== readingStatusFilter) return acc;

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            const matchesSearch = 
                unit.numero_uc?.toLowerCase().includes(lower) ||
                unit.subscriber?.name?.toLowerCase().includes(lower) ||
                unit.concessionaria?.toLowerCase().includes(lower);
            if (!matchesSearch) return acc;
        }

        if (!acc[day]) acc[day] = [];
        acc[day].push({ ...unit, displayStatus: status });
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
                const dayUnits = groupedUnits[day] || [];
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
                    }}>
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontWeight: 800, color: 'var(--color-blue)', fontSize: '0.95rem' }}>Leitura Dia {day}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                                {[
                                    { key: 'success', bg: '#dcfce7', color: '#166534' },
                                    { key: 'pending', bg: '#fff7ed', color: '#c2410c' },
                                    { key: 'error', bg: '#fee2e2', color: '#991b1b' },
                                    { key: 'processing', bg: '#eff6ff', color: '#1d4ed8' },
                                    { key: 'not_available', bg: '#f1f5f9', color: '#475569' }
                                ].map(status => {
                                    const count = dayUnits.filter(u => u.displayStatus === status.key).length;
                                    if (count === 0) return null;
                                    return (
                                        <span key={status.key} style={{ 
                                            fontSize: '0.7rem', color: status.color, background: status.bg, 
                                            padding: '0.15rem 0.4rem', borderRadius: '6px', fontWeight: '800',
                                            minWidth: '1.2rem', textAlign: 'center', border: `1px solid ${status.color}20`
                                        }}>
                                            {count}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                        <div style={{ padding: '0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto', maxHeight: '250px' }}>
                            {dayUnits.length === 0 ? (
                                <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginTop: '2rem', fontStyle: 'italic', opacity: 0.6 }}>Sem leituras</div>
                            ) : (
                                dayUnits.map(uc => (
                                    <div key={uc.id} onClick={() => onCardClick(uc)} style={{
                                        padding: '0.6rem', borderRadius: '8px',
                                        background: uc.displayStatus === 'success' ? '#f0fdf4' : 
                                                    uc.displayStatus === 'processing' ? '#eff6ff' :
                                                    uc.displayStatus === 'pending' ? '#fff7ed' :
                                                    uc.displayStatus === 'error' ? '#fef2f2' : '#f8fafc',
                                        borderLeft: `5px solid ${
                                            uc.displayStatus === 'success' ? '#22c55e' : 
                                            uc.displayStatus === 'processing' ? '#3b82f6' :
                                            uc.displayStatus === 'pending' ? '#f97316' :
                                            uc.displayStatus === 'error' ? '#ef4444' : '#cbd5e1'
                                        }`,
                                        cursor: 'pointer', fontSize: '0.8rem', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                    }}>
                                        <div style={{ fontWeight: 'bold', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {uc.subscriber?.name || 'S/ Assinante'}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>UC: {uc.numero_uc}</div>
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
    const [isScraperModalOpen, setIsScraperModalOpen] = useState(false);
    
    // Filtros do Calendário e Extrações
    const [monthFilter, setMonthFilter] = useState(new Date().toISOString().substring(0, 7));
    const [showMonthPicker, setShowMonthPicker] = useState(false);
    const [readingStatusFilter, setReadingStatusFilter] = useState('');
    const [invoicesForMonth, setInvoicesForMonth] = useState([]);



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
    }, [monthFilter]);

    const fetchUnits = async () => {
        setLoading(true);
        try {
            // 1. Buscar Unidades Consumidoras
            const { data: unitsData, error: unitsError } = await supabase
                .from('consumer_units')
                .select(`
                    *,
                    subscriber:subscriber_id (name, cpf_cnpj, portal_credentials),
                    titular_fatura:titular_fatura_id (name, portal_credentials)
                `)
                .order('created_at', { ascending: false });

            if (unitsError) throw unitsError;
            setUnits(unitsData || []);

            // 2. Buscar Faturas do Ano Selecionado
            const [year] = monthFilter.split('-');
            const yearStart = `${year}-01-01`;
            const yearEnd = `${year}-12-31`;
            
            const { data: invData, error: invError } = await supabase
                .from('invoices')
                .select('uc_id, status, mes_referencia')
                .gte('mes_referencia', yearStart)
                .lte('mes_referencia', yearEnd);
            
            if (invError) throw invError;
            setInvoicesForMonth(invData || []);

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

    const getStats = () => {
        const today = new Date();
        const currentYearNum = today.getFullYear();
        const currentMonthNum = today.getMonth() + 1;
        const currentDayNum = today.getDate();

        const [filterYear, filterMonth] = monthFilter.split('-').map(Number);
        const isCurrentMonthSelected = filterYear === currentYearNum && filterMonth === currentMonthNum;
        
        const stats = {
            month: { success: 0, error: 0, not_available: 0, processing: 0, pending: 0 },
            year: { success: 0, error: 0, not_available: 0, pending: 0 }
        };

        const activeUnits = units.filter(u => u.status === 'ativo');

        activeUnits.forEach(unit => {
            const unitDate = new Date(unit.created_at);
            const unitYear = unitDate.getFullYear();
            const unitMonth = unitDate.getMonth() + 1;
            
            const day = unit.dia_leitura || 0;
            
            // Cálculo do Mês Selecionado
            const monthRef = `${monthFilter}-01`;
            const hasMonthInvoice = invoicesForMonth.some(inv => 
                inv.uc_id === unit.id && 
                inv.mes_referencia === monthRef && 
                inv.status !== 'cancelado'
            );
            
            let monthStatus = 'pending';
            
            // Ignorar se a UC não existia no mês selecionado
            if (unitYear > filterYear || (unitYear === filterYear && unitMonth > filterMonth)) {
                return;
            }

            if (hasMonthInvoice) monthStatus = 'success';
            else if (unit.last_scraping_status === 'processing' && isCurrentMonthSelected) monthStatus = 'processing';
            else {
                const isFuture = (filterYear > currentYearNum) || 
                               (filterYear === currentYearNum && filterMonth > currentMonthNum) || 
                               (isCurrentMonthSelected && day > currentDayNum);

                if (isFuture) {
                    monthStatus = 'not_available';
                } else if (unit.last_scraping_status === 'error') {
                    monthStatus = 'error';
                } else {
                    monthStatus = 'pending';
                }
            }
            if (stats.month[monthStatus] !== undefined) stats.month[monthStatus]++;

            // Cálculo do Ano Accumulado (até o mês selecionado)
            for (let m = 1; m <= filterMonth; m++) {
                const mStr = String(m).padStart(2, '0');
                const mRef = `${filterYear}-${mStr}-01`;
                
                // Ignorar meses anteriores à criação da UC
                if (unitYear > filterYear || (unitYear === filterYear && unitMonth > m)) {
                    continue;
                }

                const hasInv = invoicesForMonth.some(inv => 
                    inv.uc_id === unit.id && 
                    inv.mes_referencia === mRef && 
                    inv.status !== 'cancelado'
                );
                
                if (hasInv) {
                    stats.year.success++;
                } else {
                    const isMCurrent = filterYear === currentYearNum && m === currentMonthNum;
                    const isMFuture = (filterYear > currentYearNum) || (filterYear === currentYearNum && m > currentMonthNum);
                    const isFutureReading = isMFuture || (isMCurrent && day > currentDayNum);
                    
                    if (isFutureReading) {
                        stats.year.not_available++;
                    } else if (unit.last_scraping_status === 'error') {
                        stats.year.error++; 
                    } else {
                        stats.year.pending++;
                    }
                }
            }
        });
        
        return stats;
    };

    const stats = getStats();

    return (
        <div style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
                <h2 style={{ color: '#1e293b', fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.025em' }}>
                    Gestão de Unidades Consumidoras
                </h2>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    {viewMode === 'calendar' && (
                        <button
                            onClick={() => setIsScraperModalOpen(true)}
                            style={{
                                padding: '0.75rem 1.5rem',
                                background: '#f59e0b',
                                color: 'white',
                                borderRadius: '8px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                border: 'none',
                                boxShadow: '0 4px 6px -1px rgba(245, 158, 11, 0.2)',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}
                            onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                            onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                        >
                            <Download size={18} /> Extrair Faturas
                        </button>
                    )}
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

                    {viewMode === 'calendar' && (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <div style={{ position: 'relative' }}>
                                <button 
                                    onClick={() => setShowMonthPicker(!showMonthPicker)} 
                                    style={{ 
                                        padding: '0.75rem 1rem', 
                                        border: '1px solid #e2e8f0', 
                                        borderRadius: '10px', 
                                        cursor: 'pointer', 
                                        background: 'white', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '0.5rem', 
                                        minWidth: '160px',
                                        fontSize: '0.9rem',
                                        fontWeight: '600',
                                        color: '#334155'
                                    }}
                                >
                                    <CalendarIcon size={16} style={{ color: 'var(--color-blue)' }} />
                                    <span>{new Date(`${monthFilter}-01T00:00:00`).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                                </button>
                                {showMonthPicker && (
                                    <div style={{ position: 'absolute', top: '110%', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 100, padding: '1rem', width: '280px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <button onClick={() => { const [y, m] = monthFilter.split('-'); setMonthFilter(`${Number(y) - 1}-${m}`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 'bold' }}>&lt;</button>
                                            <span style={{ fontWeight: 'bold' }}>{monthFilter.split('-')[0]}</span>
                                            <button onClick={() => { const [y, m] = monthFilter.split('-'); setMonthFilter(`${Number(y) + 1}-${m}`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 'bold' }}>&gt;</button>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                                            {['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'].map((m, idx) => {
                                                const mVal = String(idx + 1).padStart(2, '0');
                                                const currentYear = monthFilter.split('-')[0];
                                                const isSelected = monthFilter === `${currentYear}-${mVal}`;
                                                return <button key={m} onClick={() => { setMonthFilter(`${currentYear}-${mVal}`); setShowMonthPicker(false); }} style={{ padding: '0.5rem', border: 'none', borderRadius: '6px', background: isSelected ? 'var(--color-blue)' : '#f8fafc', color: isSelected ? 'white' : '#475569', cursor: 'pointer', fontSize: '0.85rem' }}>{m}</button>;
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <select 
                                value={readingStatusFilter} 
                                onChange={e => setReadingStatusFilter(e.target.value)}
                                style={{ 
                                    padding: '0.75rem 1rem', 
                                    border: '1px solid #e2e8f0', 
                                    borderRadius: '10px',
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    color: '#334155',
                                    background: 'white',
                                    outline: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="">Todos os Status</option>
                                <option value="success">Sucesso</option>
                                <option value="not_available">Não Disponível</option>
                                <option value="pending">Pendente</option>
                                <option value="error">Erro / Atenção</option>
                                <option value="processing">Processando</option>
                            </select>
                        </div>
                    )}

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
                                <CalendarIcon size={18} /> Calendário de Leituras
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
                                    Calendário de Leituras agrupa as UCs por dia de leitura.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Legenda de Cores */}
            {viewMode === 'calendar' && (
                <div style={{
                    marginBottom: '1.5rem',
                    padding: '1.5rem',
                    background: 'white',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.25rem',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                }}>
                    <div style={{ 
                        fontWeight: '800', 
                        color: '#1e293b', 
                        fontSize: '0.8rem', 
                        textTransform: 'uppercase', 
                        letterSpacing: '0.05em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}>
                        <div style={{ width: '4px', height: '16px', background: 'var(--color-blue)', borderRadius: '2px' }}></div>
                        Legenda de Status (Extração de Faturas)
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#22c55e', border: '1px solid rgba(0,0,0,0.05)' }}></div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Sucesso</span>
                                    <span style={{ fontSize: '0.65rem', background: '#dcfce7', color: '#166534', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '800' }}>
                                        Mês: {stats.month.success} | Faturas no Ano: {stats.year.success}
                                    </span>
                                </div>
                                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Fatura extraída com sucesso</span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#94a3b8', border: '1px solid rgba(0,0,0,0.05)' }}></div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Não Disponível</span>
                                    <span style={{ fontSize: '0.65rem', background: '#f1f5f9', color: '#475569', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '800' }}>
                                        Mês: {stats.month.not_available} | Previstas no Ano: {stats.year.not_available}
                                    </span>
                                </div>
                                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Datas futuras ou ciclo não iniciado</span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#f97316', border: '1px solid rgba(0,0,0,0.05)' }}></div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Pendente</span>
                                    <span style={{ fontSize: '0.65rem', background: '#fff7ed', color: '#c2410c', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '800' }}>
                                        Mês: {stats.month.pending} | Ausentes no Ano: {stats.year.pending}
                                    </span>
                                </div>
                                <span style={{ fontSize: '0.7rem', color: '#f97316', fontWeight: '700' }}>Ação Necessária: Aguardando leitura</span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#ef4444', border: '1px solid rgba(0,0,0,0.05)' }}></div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Erro / Atenção</span>
                                    <span style={{ fontSize: '0.65rem', background: '#fee2e2', color: '#991b1b', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '800' }}>
                                        Mês: {stats.month.error} | Falhas no Ano: {stats.year.error}
                                    </span>
                                </div>
                                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Falha na extração ou erro técnico</span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#3b82f6', border: '1px solid rgba(0,0,0,0.05)' }}></div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Processando</span>
                                    <span style={{ fontSize: '0.65rem', background: '#eff6ff', color: '#1d4ed8', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '800' }}>
                                        Mês: {stats.month.processing}
                                    </span>
                                </div>
                                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Extração em curso pelo agente</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                                units={units}
                                invoices={invoicesForMonth}
                                monthFilter={monthFilter}
                                searchTerm={searchTerm}
                                readingStatusFilter={readingStatusFilter}
                                onCardClick={(uc) => { setEditingUnit(uc); setIsModalOpen(true); }}
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
            {isScraperModalOpen && (
                <ScraperTriggerModal onClose={() => {
                    setIsScraperModalOpen(false);
                    fetchUnits(); // Refresh to catch processing status
                }} />
            )}
        </div>
    );
}
