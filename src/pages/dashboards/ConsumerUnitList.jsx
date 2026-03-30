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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontWeight: 800, color: 'var(--color-blue)', fontSize: '0.95rem' }}>Dia {day}</span>
                                {dayUnits.some(u => u.last_scraping_status === 'processing') && (
                                    <svg width="18" height="18" viewBox="0 0 96 96" fill="#3b82f6" style={{ animation: 'spin 1.5s infinite linear' }} title="Processando extração...">
                                        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                                        <g><g><path fillRule="evenodd" clipRule="evenodd" fill="currentColor" d="M89.282,56.138c0,0-3.007-1.649-3.007-8.138c0-6.487,3.007-8.139,3.007-8.139c4.467-2.45,7.424-6.548,6.57-9.104c-0.853-2.557-8.015-7.62-12.905-6.195c0,0-3.294,0.959-7.882-3.627c-4.588-4.588-3.629-7.882-3.629-7.882c1.425-4.892,0.646-9.871-1.731-11.066c-2.378-1.195-11.116,0.264-13.567,4.73c0,0-1.649,3.007-8.138,3.007c-6.487,0-8.139-3.007-8.139-3.007c-2.45-4.467-6.548-7.423-9.104-6.571C28.201,1,23.138,8.162,24.562,13.053c0,0,0.961,3.294-3.628,7.882c-4.587,4.587-7.881,3.627-7.881,3.627c-4.891-1.425-9.871-0.646-11.066,1.731C0.792,28.673,2.25,37.411,6.718,39.861c0,0,3.006,1.651,3.006,8.139c0,6.488-3.006,8.138-3.006,8.138c-4.467,2.451-7.424,6.549-6.571,9.104c0.853,2.557,8.016,7.619,12.907,6.194c0,0,3.294-0.959,7.881,3.629c4.589,4.588,3.628,7.882,3.628,7.882c-1.425,4.891-0.646,9.871,1.731,11.066c2.379,1.195,11.117-0.265,13.567-4.731c0,0,1.651-3.007,8.139-3.007c6.488,0,8.138,3.007,8.138,3.007c2.451,4.467,6.549,7.424,9.104,6.571c2.557-0.854,7.619-8.016,6.194-12.906c0,0-0.959-3.294,3.629-7.882s7.882-3.629,7.882-3.629c4.891,1.425,9.871,0.646,11.066-1.73C95.209,67.326,93.749,58.589,89.282,56.138z M48.001,75C33.09,75,21,62.912,21,48.001S33.09,21,48.001,21S75,33.09,75,48.001S62.912,75,48.001,75z M48,33c-8.283,0-15,6.717-15,15c0,8.284,6.717,15,15,15c8.284,0,15-6.716,15-15C63,39.717,56.284,33,48,33z" /></g></g>
                                    </svg>
                                )}
                            </div>
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
                                            background: uc.last_scraping_status === 'success' ? '#f0fdf4' : 
                                                        uc.last_scraping_status === 'processing' ? '#eff6ff' :
                                                        uc.last_scraping_status === 'not_available' ? '#fefce8' : 
                                                        uc.last_scraping_status === 'error' ? '#fef2f2' : '#f8fafc',
                                            borderLeft: `5px solid ${
                                                uc.last_scraping_status === 'success' ? '#22c55e' : 
                                                uc.last_scraping_status === 'processing' ? '#3b82f6' :
                                                uc.last_scraping_status === 'not_available' ? '#eab308' : 
                                                uc.last_scraping_status === 'error' ? '#ef4444' : 
                                                (KANBAN_STATUSES.find(s => s.status === uc.status)?.color || '#cbd5e1')
                                            }`,
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            transition: 'all 0.2s',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                            position: 'relative'
                                        }}
                                        onMouseOver={e => {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
                                        }}
                                        onMouseOut={e => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
                                        }}
                                        title={(() => {
                                            if (uc.last_scraping_status === 'processing') return 'Processando...';
                                            const hasCreds = (uc.subscriber?.portal_credentials?.login && uc.subscriber?.portal_credentials?.password) ||
                                                             (uc.titular_fatura?.portal_credentials?.login && uc.titular_fatura?.portal_credentials?.password);
                                            
                                            if (hasCreds && uc.last_scraping_error?.includes('Credenciais')) {
                                                return '';
                                            }
                                            return uc.last_scraping_error || '';
                                        })()}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div style={{ fontWeight: 'bold', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '80%' }}>
                                                {uc.subscriber?.name || 'S/ Assinante'}
                                            </div>
                                            {uc.last_scraping_status && uc.last_scraping_status !== 'processing' && (
                                                <div style={{ 
                                                    width: '8px', 
                                                    height: '8px', 
                                                    borderRadius: '50%', 
                                                    background: uc.last_scraping_status === 'success' ? '#22c55e' : 
                                                                uc.last_scraping_status === 'not_available' ? '#eab308' : 
                                                                uc.last_scraping_status === 'error' ? '#ef4444' : '#cbd5e1'
                                                }}></div>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span>UC: {uc.numero_uc}</span>
                                            <span style={{ fontStyle: 'italic', fontSize: '0.65rem', background: 'rgba(0,0,0,0.05)', padding: '0 0.3rem', borderRadius: '4px' }}>
                                                {uc.concessionaria?.split(' ')[0]}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                );
            })}

            {/* Legenda de Cores */}
            <div style={{
                marginTop: '1.5rem',
                padding: '1.5rem',
                background: 'white',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                gridColumn: '1 / -1'
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#22c55e', border: '1px solid rgba(0,0,0,0.05)' }}></div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Sucesso</span>
                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Fatura extraída com sucesso</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#eab308', border: '1px solid rgba(0,0,0,0.05)' }}></div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Não Disponível</span>
                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Ainda não liberada no portal</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#ef4444', border: '1px solid rgba(0,0,0,0.05)' }}></div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Erro / Atenção</span>
                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Falha na extração ou sem credenciais</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#cbd5e1', border: '1px solid rgba(0,0,0,0.05)' }}></div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Pendente</span>
                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Aguardando processamento ou sem status</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#eff6ff', border: '1px solid #3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="12" height="12" viewBox="0 0 96 96" fill="#3b82f6" title="Exemplo de carregamento">
                                <g><g><path fillRule="evenodd" clipRule="evenodd" fill="currentColor" d="M89.282,56.138c0,0-3.007-1.649-3.007-8.138c0-6.487,3.007-8.139,3.007-8.139c4.467-2.45,7.424-6.548,6.57-9.104c-0.853-2.557-8.015-7.62-12.905-6.195c0,0-3.294,0.959-7.882-3.627c-4.588-4.588-3.629-7.882-3.629-7.882c1.425-4.892,0.646-9.871-1.731-11.066c-2.378-1.195-11.116,0.264-13.567,4.73c0,0-1.649,3.007-8.138,3.007c-6.487,0-8.139-3.007-8.139-3.007c-2.45-4.467-6.548-7.423-9.104-6.571C28.201,1,23.138,8.162,24.562,13.053c0,0,0.961,3.294-3.628,7.882c-4.587,4.587-7.881,3.627-7.881,3.627c-4.891-1.425-9.871-0.646-11.066,1.731C0.792,28.673,2.25,37.411,6.718,39.861c0,0,3.006,1.651,3.006,8.139c0,6.488-3.006,8.138-3.006,8.138c-4.467,2.451-7.424,6.549-6.571,9.104c0.853,2.557,8.016,7.619,12.907,6.194c0,0,3.294-0.959,7.881,3.629c4.589,4.588,3.628,7.882,3.628,7.882c-1.425,4.891-0.646,9.871,1.731,11.066c2.379,1.195,11.117-0.265,13.567-4.731c0,0,1.651-3.007,8.139-3.007c6.488,0,8.138,3.007,8.138,3.007c2.451,4.467,6.549,7.424,9.104,6.571c2.557-0.854,7.619-8.016,6.194-12.906c0,0-0.959-3.294,3.629-7.882s7.882-3.629,7.882-3.629c4.891,1.425,9.871,0.646,11.066-1.73C95.209,67.326,93.749,58.589,89.282,56.138z M48.001,75C33.09,75,21,62.912,21,48.001S33.09,21,48.001,21S75,33.09,75,48.001S62.912,75,48.001,75z M48,33c-8.283,0-15,6.717-15,15c0,8.284,6.717,15,15,15c8.284,0,15-6.716,15-15C63,39.717,56.284,33,48,33z" /></g></g>
                            </svg>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '700' }}>Processando</span>
                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Agente extraindo fatura atual</span>
                        </div>
                    </div>
                </div>
            </div>
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
                    subscriber:subscriber_id (name, cpf_cnpj, portal_credentials),
                    titular_fatura:titular_fatura_id (name, portal_credentials)
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
            {isScraperModalOpen && (
                <ScraperTriggerModal onClose={() => {
                    setIsScraperModalOpen(false);
                    fetchUnits(); // Refresh to catch processing status
                }} />
            )}
        </div>
    );
}
