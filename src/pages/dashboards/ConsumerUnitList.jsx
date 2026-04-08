import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Calendar as CalendarIcon, List, Layout, Info, Download } from 'lucide-react';
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

    const firstDay = new Date(filterYear, filterMonth - 1, 1).getDay();
    const startOffset = (firstDay + 6) % 7; // Segunda = 0
    const daysInMonth = new Date(filterYear, filterMonth, 0).getDate();
    const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

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
            } else if (unit.last_scraping_status === 'success') {
                status = 'success';
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
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: '1rem',
            padding: '1rem',
            maxWidth: '1600px',
            margin: '0 auto'
        }}>
            <div style={{
                gridColumn: '1 / -1',
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '1rem',
                position: 'sticky',
                top: 'calc(var(--sticky-header-height, 120px) + 1.5rem)',
                zIndex: 10,
                background: '#f8fafc',
                padding: '0.5rem 0',
                margin: '-0.5rem 0 0.5rem 0'
            }}>
                {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map(d => (
                    <div key={d} style={{ 
                        fontWeight: '800', 
                        textAlign: 'center', 
                        padding: '0.5rem', 
                        color: '#64748b', 
                        fontSize: '0.75rem', 
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                    }}>
                        {d}
                    </div>
                ))}
            </div>
            {Array.from({ length: startOffset }).map((_, i) => (
                <div key={`pad-${i}`} style={{ background: '#f8fafc50', borderRadius: 'var(--radius-md)', border: '1px dashed #e2e8f0', minHeight: '180px' }} />
            ))}
            {calendarDays.map(day => {
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
                        overflow: 'hidden'
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
                                <span style={{ fontWeight: 800, color: 'var(--color-blue)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Leit. {day}</span>
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
                                        <div style={{ 
                                            fontWeight: 'bold', 
                                            color: '#0f172a', 
                                            whiteSpace: 'nowrap', 
                                            overflow: 'hidden', 
                                            textOverflow: 'ellipsis' 
                                        }}>
                                            {uc.subscriber?.name || 'S/ Assinante'}
                                        </div>
                                        <div style={{ 
                                            fontSize: '0.7rem', 
                                            color: '#64748b', 
                                            marginTop: '0.2rem',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis'
                                        }}>
                                            UC: {uc.numero_uc}
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

    const [viewMode, setViewMode] = useState('calendar');
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

        const channel = supabase
            .channel('db-all-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'consumer_units' }, () => {
                fetchUnits();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
                fetchUnits();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
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
                } else if (unit.last_scraping_status === 'success') {
                    monthStatus = 'success';
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

                        {viewMode === 'calendar' && (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <div style={{ position: 'relative' }}>
                                    <button 
                                        onClick={() => setShowMonthPicker(!showMonthPicker)} 
                                        style={{ 
                                            padding: '0.6rem 1rem', 
                                            border: '1px solid #e2e8f0', 
                                            borderRadius: '10px', 
                                            cursor: 'pointer', 
                                            background: 'white', 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: '0.5rem', 
                                            fontSize: '0.85rem',
                                            fontWeight: '600',
                                            color: '#334155'
                                        }}
                                    >
                                        <CalendarIcon size={14} style={{ color: 'var(--color-blue)' }} />
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
                                        padding: '0.6rem 1rem', 
                                        border: '1px solid #e2e8f0', 
                                        borderRadius: '10px',
                                        fontSize: '0.85rem',
                                        fontWeight: '600',
                                        color: '#334155',
                                        background: 'white',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value="">Status</option>
                                    <option value="success">Sucesso</option>
                                    <option value="pending">Pendente</option>
                                    <option value="error">Erro</option>
                                </select>
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <div className="btn-group" style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <button onClick={() => setViewMode('list')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'list' ? 'white' : 'transparent', color: viewMode === 'list' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'list' ? '700' : '500', fontSize: '0.85rem', boxShadow: viewMode === 'list' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none' }}>
                                <List size={16} /> Lista
                            </button>
                            <button onClick={() => setViewMode('kanban')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'kanban' ? 'white' : 'transparent', color: viewMode === 'kanban' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'kanban' ? '700' : '500', fontSize: '0.85rem', boxShadow: viewMode === 'kanban' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none' }}>
                                <Layout size={16} /> Kanban
                            </button>
                            <button onClick={() => setViewMode('calendar')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'calendar' ? 'white' : 'transparent', color: viewMode === 'calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'calendar' ? '700' : '500', fontSize: '0.85rem', boxShadow: viewMode === 'calendar' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none' }}>
                                <CalendarIcon size={16} /> Calendário
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {viewMode === 'calendar' && (
                                <button
                                    onClick={() => setIsScraperModalOpen(true)}
                                    style={{ padding: '0.6rem 1.2rem', background: '#f59e0b', color: 'white', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: 'none', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', transition: 'all 0.2s' }}
                                    onMouseOver={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                                    onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
                                >
                                    <Download size={16} /> Extrair
                                </button>
                            )}
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

                {/* Legenda integrada no Sticky Header */}
                {viewMode === 'calendar' && (
                    <div style={{
                        padding: '0.75rem 1rem',
                        background: 'rgba(255, 255, 255, 0.4)',
                        borderRadius: '12px',
                        border: '1px solid rgba(226, 232, 240, 0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2rem'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#22c55e' }}></div>
                            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Sucesso: {stats.month.success}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#f97316' }}></div>
                            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Pendente: {stats.month.pending}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ef4444' }}></div>
                            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Erro: {stats.month.error}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#3b82f6' }}></div>
                            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Processando: {stats.month.processing}</span>
                        </div>
                    </div>
                )}
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
