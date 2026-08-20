import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths, addWeeks, subWeeks, subDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Phone, MessageCircle, Users, Video } from 'lucide-react';
import { useUI } from '../contexts/UIContext';

const getReasonIcon = (reason) => {
    if (reason?.toLowerCase().includes('ligação')) return <Phone size={14} />;
    if (reason?.toLowerCase().includes('mensagem')) return <MessageCircle size={14} />;
    if (reason?.toLowerCase().includes('presencial')) return <Users size={14} />;
    if (reason?.toLowerCase().includes('video')) return <Video size={14} />;
    return <CalendarIcon size={14} />;
};

export default function LeadAgenda({ onLeadClick }) {
    const { showAlert } = useUI();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState('month'); // 'month', 'week', 'day'
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchAppointments();
    }, [currentDate, viewMode]);

    const fetchAppointments = async () => {
        setLoading(true);
        try {
            // Load appointments for the displayed range
            let start, end;
            
            if (viewMode === 'month') {
                start = startOfWeek(startOfMonth(currentDate));
                end = endOfWeek(endOfMonth(currentDate));
            } else if (viewMode === 'week') {
                start = startOfWeek(currentDate);
                end = endOfWeek(currentDate);
            } else {
                start = new Date(currentDate);
                start.setHours(0,0,0,0);
                end = new Date(currentDate);
                end.setHours(23,59,59,999);
            }

            const { data, error } = await supabase
                .from('lead_appointments')
                .select(`*, leads (id, name, phone)`)
                .gte('appointment_date', format(start, 'yyyy-MM-dd'))
                .lte('appointment_date', format(end, 'yyyy-MM-dd'));

            if (error) throw error;
            setAppointments(data || []);
        } catch (error) {
            console.error('Error fetching agenda:', error);
            showAlert('Erro ao carregar agenda', 'error');
        } finally {
            setLoading(false);
        }
    };

    const nextTime = () => {
        if (viewMode === 'month') setCurrentDate(addMonths(currentDate, 1));
        if (viewMode === 'week') setCurrentDate(addWeeks(currentDate, 1));
        if (viewMode === 'day') setCurrentDate(addDays(currentDate, 1));
    };

    const prevTime = () => {
        if (viewMode === 'month') setCurrentDate(subMonths(currentDate, 1));
        if (viewMode === 'week') setCurrentDate(subWeeks(currentDate, 1));
        if (viewMode === 'day') setCurrentDate(subDays(currentDate, 1));
    };

    const getDayAppointments = (day) => {
        return appointments.filter(app => {
            return app.appointment_date === format(day, 'yyyy-MM-dd');
        }).sort((a, b) => a.appointment_time.localeCompare(b.appointment_time));
    };

    const renderHeader = () => {
        let label = '';
        if (viewMode === 'month') label = format(currentDate, 'MMMM yyyy', { locale: ptBR });
        if (viewMode === 'week') label = `Semana de ${format(startOfWeek(currentDate), 'dd/MM', { locale: ptBR })} a ${format(endOfWeek(currentDate), 'dd/MM', { locale: ptBR })}`;
        if (viewMode === 'day') label = format(currentDate, 'dd MMMM yyyy', { locale: ptBR });

        return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', background: 'white', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', gap: '0.5rem', background: '#f1f5f9', padding: '0.25rem', borderRadius: '8px' }}>
                    <button 
                        onClick={() => setViewMode('month')}
                        style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', background: viewMode === 'month' ? 'white' : 'transparent', color: viewMode === 'month' ? 'var(--color-blue)' : '#64748b', fontWeight: 600, cursor: 'pointer', boxShadow: viewMode === 'month' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
                    >Mês</button>
                    <button 
                        onClick={() => setViewMode('week')}
                        style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', background: viewMode === 'week' ? 'white' : 'transparent', color: viewMode === 'week' ? 'var(--color-blue)' : '#64748b', fontWeight: 600, cursor: 'pointer', boxShadow: viewMode === 'week' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
                    >Semana</button>
                    <button 
                        onClick={() => setViewMode('day')}
                        style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', background: viewMode === 'day' ? 'white' : 'transparent', color: viewMode === 'day' ? 'var(--color-blue)' : '#64748b', fontWeight: 600, cursor: 'pointer', boxShadow: viewMode === 'day' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
                    >Dia</button>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button onClick={prevTime} style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569' }}>
                        <ChevronLeft size={20} />
                    </button>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#1e293b', minWidth: '200px', textAlign: 'center', textTransform: 'capitalize' }}>
                        {label}
                    </h3>
                    <button onClick={nextTime} style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569' }}>
                        <ChevronRight size={20} />
                    </button>
                </div>

                <button 
                    onClick={() => setCurrentDate(new Date())}
                    style={{ padding: '0.5rem 1rem', background: '#ecfdf5', color: '#047857', border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
                >
                    Hoje
                </button>
            </div>
        );
    };

    const renderMonthView = () => {
        const monthStart = startOfMonth(currentDate);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(endOfMonth(monthStart));
        
        const rows = [];
        let days = [];
        let day = startDate;

        while (day <= endDate) {
            for (let i = 0; i < 7; i++) {
                const cloneDay = day;
                const isCurrentMonth = isSameMonth(cloneDay, monthStart);
                const isToday = isSameDay(cloneDay, new Date());
                const dayApps = getDayAppointments(cloneDay);
                
                days.push(
                    <div 
                        key={cloneDay.toISOString()} 
                        style={{ 
                            minHeight: '120px', 
                            border: '1px solid #e2e8f0', 
                            background: isCurrentMonth ? 'white' : '#f8fafc', 
                            padding: '0.5rem',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <span style={{ 
                                fontWeight: isToday ? 'bold' : 'normal', 
                                color: isToday ? 'white' : (isCurrentMonth ? '#1e293b' : '#94a3b8'),
                                background: isToday ? 'var(--color-blue)' : 'transparent',
                                borderRadius: '50%',
                                width: '28px', height: '28px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                {format(cloneDay, 'd')}
                            </span>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            {dayApps.map(app => (
                                <div 
                                    key={app.id} 
                                    onClick={() => onLeadClick(app.leads)}
                                    style={{ 
                                        background: '#f0f9ff', borderLeft: '3px solid var(--color-blue)', 
                                        padding: '0.2rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem',
                                        cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                        display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#0369a1'
                                    }}
                                >
                                    <strong>{app.appointment_time.substring(0,5)}</strong> {app.leads?.name}
                                </div>
                            ))}
                        </div>
                    </div>
                );
                day = addDays(day, 1);
            }
            rows.push(<div key={day.toISOString()} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>{days}</div>);
            days = [];
        }

        const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

        return (
            <div style={{ display: 'flex', flexDirection: 'column', background: 'white', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    {weekDays.map(wd => (
                        <div key={wd} style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#64748b', fontSize: '0.9rem' }}>{wd}</div>
                    ))}
                </div>
                {rows}
            </div>
        );
    };

    const renderDailyList = (apps, emptyMessage = "Nenhum compromisso") => {
        if (apps.length === 0) return <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>{emptyMessage}</div>;
        
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
                {apps.map(app => (
                    <div 
                        key={app.id} 
                        onClick={() => onLeadClick(app.leads)}
                        style={{ 
                            display: 'flex', background: 'white', border: '1px solid #e2e8f0', 
                            borderRadius: '12px', padding: '1rem', cursor: 'pointer',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)', gap: '1.5rem', alignItems: 'center'
                        }}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '60px' }}>
                            <strong style={{ fontSize: '1.2rem', color: '#0f172a' }}>{app.appointment_time.substring(0,5)}</strong>
                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{format(parseISO(app.appointment_date), 'dd/MM')}</span>
                        </div>
                        
                        <div style={{ width: '4px', height: '40px', background: '#3b82f6', borderRadius: '4px' }}></div>
                        
                        <div style={{ flex: 1 }}>
                            <h4 style={{ margin: '0 0 0.25rem 0', color: '#1e293b', fontSize: '1.1rem' }}>{app.leads?.name}</h4>
                            <div style={{ display: 'flex', gap: '1rem', color: '#64748b', fontSize: '0.9rem' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                    {getReasonIcon(app.reason)} {app.reason}
                                </span>
                                {app.leads?.phone && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                        <Phone size={14} /> {app.leads.phone}
                                    </span>
                                )}
                            </div>
                            {app.notes && <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: '#475569' }}>{app.notes}</p>}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderWeekView = () => {
        const start = startOfWeek(currentDate);
        let days = [];
        
        for (let i = 0; i < 7; i++) {
            const day = addDays(start, i);
            const dayApps = getDayAppointments(day);
            days.push(
                <div key={day.toISOString()} style={{ flex: 1, minWidth: 0, borderRight: i < 6 ? '1px solid #e2e8f0' : 'none' }}>
                    <div style={{ padding: '0.75rem', textAlign: 'center', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{format(day, 'EEEE', { locale: ptBR })}</div>
                        <div style={{ color: '#64748b', fontSize: '0.9rem' }}>{format(day, 'dd/MM')}</div>
                    </div>
                    <div style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', height: '600px', overflowY: 'auto' }}>
                        {dayApps.map(app => (
                            <div 
                                key={app.id} 
                                onClick={() => onLeadClick(app.leads)}
                                style={{ 
                                    background: 'white', border: '1px solid #cbd5e1', borderLeft: '4px solid var(--color-blue)', 
                                    padding: '0.5rem', borderRadius: '6px', cursor: 'pointer',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                }}
                            >
                                <strong style={{ display: 'block', color: '#0f172a', fontSize: '0.85rem', marginBottom: '0.2rem' }}>{app.appointment_time.substring(0,5)}</strong>
                                <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.leads?.name}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                                    {getReasonIcon(app.reason)} <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.reason}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        return (
            <div style={{ display: 'flex', background: 'white', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                {days}
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem', padding: '1rem' }}>
            {renderHeader()}
            
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>Carregando agenda...</div>
            ) : (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {viewMode === 'month' && renderMonthView()}
                    {viewMode === 'week' && renderWeekView()}
                    {viewMode === 'day' && renderDailyList(getDayAppointments(currentDate))}
                </div>
            )}
        </div>
    );
}
