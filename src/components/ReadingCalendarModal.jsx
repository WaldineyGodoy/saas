import React, { useState } from 'react';
import { X, Calendar, User, UserCheck, Zap, Settings, ArrowRight, Play, Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';

export default function ReadingCalendarModal({ isOpen, onClose, uc, onOpenAnalysis, onStatusUpdated }) {
    if (!isOpen || !uc) return null;

    const { showAlert } = useUI();
    const [isUpdating, setIsUpdating] = useState(false);

    // Determines current status based on calendar displayStatus or last_scraping_status
    const currentStatus = uc.last_scraping_status || 'pending';

    const getStatusConfig = (status) => {
        switch (status) {
            case 'success':
                return { label: 'Sucesso', color: '#16a34a', bg: '#dcfce7', icon: CheckCircle };
            case 'error':
                return { label: 'Indisponivel', color: '#dc2626', bg: '#fee2e2', icon: AlertCircle };
            case 'processing':
                return { label: 'Processando', color: '#2563eb', bg: '#dbeafe', icon: Loader2 };
            case 'pending':
                return { label: 'Pendente', color: '#ca8a04', bg: '#fef9c3', icon: Clock };
            default:
                return { label: 'Desconhecido', color: '#475569', bg: '#f1f5f9', icon: Clock };
        }
    };

    const handleUpdateStatus = async (newStatus) => {
        setIsUpdating(true);
        try {
            const { error } = await supabase
                .from('consumer_units')
                .update({ last_scraping_status: newStatus })
                .eq('id', uc.id);

            if (error) throw error;
            showAlert('success', 'Status atualizado com sucesso!');
            if (onStatusUpdated) onStatusUpdated();
            onClose();
        } catch (err) {
            console.error('Error updating status:', err);
            showAlert('error', 'Erro ao atualizar status.');
        } finally {
            setIsUpdating(false);
        }
    };

    const statusConfig = getStatusConfig(currentStatus);
    const StatusIcon = statusConfig.icon;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)'
        }}>
            <div style={{
                background: 'white', borderRadius: '16px', width: '90%', maxWidth: '600px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                overflow: 'hidden', display: 'flex', flexDirection: 'column',
                maxHeight: '90vh'
            }}>
                {/* Header */}
                <div style={{ 
                    padding: '1.5rem', borderBottom: '1px solid #e2e8f0', 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: '#f8fafc'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ background: '#e0e7ff', padding: '0.5rem', borderRadius: '8px' }}>
                            <Calendar size={24} color="#4f46e5" />
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b', fontWeight: 'bold' }}>
                                Calendário de Leitura
                            </h2>
                            <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
                                Gerenciamento de status e processamento
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.5rem', borderRadius: '50%', display: 'flex' }}
                        onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <X size={20} color="#64748b" />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
                    
                    {/* Horizontal Menu for Status Update */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <h3 style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 'bold', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Alterar Status da Leitura
                        </h3>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {['pending', 'error', 'processing', 'success'].map(statusOption => {
                                const optionConfig = getStatusConfig(statusOption);
                                const OptionIcon = optionConfig.icon;
                                const isSelected = currentStatus === statusOption;
                                return (
                                    <button
                                        key={statusOption}
                                        onClick={() => handleUpdateStatus(statusOption)}
                                        disabled={isUpdating}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            padding: '0.5rem 1rem', borderRadius: '8px',
                                            border: `1px solid ${isSelected ? optionConfig.color : '#e2e8f0'}`,
                                            background: isSelected ? optionConfig.bg : 'white',
                                            color: isSelected ? optionConfig.color : '#475569',
                                            fontWeight: isSelected ? 'bold' : 'normal',
                                            cursor: isUpdating ? 'not-allowed' : 'pointer',
                                            transition: 'all 0.2s',
                                            flex: 1,
                                            justifyContent: 'center'
                                        }}
                                    >
                                        <OptionIcon size={16} color={isSelected ? optionConfig.color : '#64748b'} />
                                        <span style={{ fontSize: '0.875rem' }}>{optionConfig.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Current Status Display */}
                    <div style={{ 
                        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', 
                        padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between'
                    }}>
                        <div>
                            <span style={{ fontSize: '0.875rem', color: '#64748b', display: 'block', marginBottom: '0.25rem' }}>Status Atual</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <StatusIcon size={20} color={statusConfig.color} />
                                <span style={{ fontWeight: 'bold', fontSize: '1.125rem', color: statusConfig.color }}>
                                    {statusConfig.label}
                                </span>
                            </div>
                        </div>
                        {isUpdating && <Loader2 size={24} color="#64748b" style={{ animation: 'spin 1s linear infinite' }} />}
                    </div>

                    {/* Info Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div style={{ background: '#f1f5f9', padding: '1rem', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: '#64748b' }}>
                                <Zap size={16} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Unidade Consumidora</span>
                            </div>
                            <div style={{ fontWeight: '600', color: '#1e293b', fontSize: '1rem' }}>
                                {uc.numero_uc || 'N/A'}
                            </div>
                        </div>
                        
                        <div style={{ background: '#f1f5f9', padding: '1rem', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: '#64748b' }}>
                                <UserCheck size={16} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Titular da Conta</span>
                            </div>
                            <div style={{ fontWeight: '600', color: '#1e293b', fontSize: '0.875rem', wordBreak: 'break-word' }}>
                                {uc.titular_conta || uc.titular_fatura?.name || 'Não informado'}
                            </div>
                        </div>

                        <div style={{ background: '#f1f5f9', padding: '1rem', borderRadius: '8px', gridColumn: '1 / -1' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: '#64748b' }}>
                                <User size={16} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Assinante</span>
                            </div>
                            <div style={{ fontWeight: '600', color: '#1e293b', fontSize: '0.875rem' }}>
                                {uc.subscribers?.name || 'Nenhum assinante vinculado'}
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div style={{ 
                        background: '#fff', border: '1px solid #bfdbfe', borderRadius: '12px', 
                        padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' 
                    }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                            <div style={{ background: '#eff6ff', padding: '0.5rem', borderRadius: '8px', color: '#3b82f6' }}>
                                <Play size={20} />
                            </div>
                            <div>
                                <h4 style={{ margin: '0 0 0.25rem 0', color: '#1e3a8a', fontSize: '1rem' }}>Processar PDF (Sandbox)</h4>
                                <p style={{ margin: 0, fontSize: '0.875rem', color: '#475569' }}>
                                    Inicie o processamento da fatura no CRM utilizando o módulo de análise.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                onClose();
                                onOpenAnalysis(uc);
                            }}
                            style={{
                                width: '100%', background: '#3b82f6', color: 'white', border: 'none', 
                                padding: '0.875rem', borderRadius: '8px', fontWeight: 'bold', fontSize: '1rem',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                cursor: 'pointer', transition: 'background 0.2s',
                                boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.5)'
                            }}
                            onMouseOver={e => e.currentTarget.style.background = '#2563eb'}
                            onMouseOut={e => e.currentTarget.style.background = '#3b82f6'}
                        >
                            Processar Contas
                            <ArrowRight size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
