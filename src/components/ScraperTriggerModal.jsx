import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Calendar, Layers, Hash, X, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ScraperTriggerModal({ onClose }) {
    const [type, setType] = useState('day');
    const [dateValue, setDateValue] = useState(new Date().toISOString().split('T')[0]);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null); // 'success' | 'error'
    const [message, setMessage] = useState('');

    const handleTrigger = async () => {
        setLoading(true);
        setStatus(null);
        try {
            const { data, error } = await supabase.functions.invoke('trigger-faturista', {
                body: { type, value: dateValue }
            });

            if (error) throw error;

            setStatus('success');
            setMessage(`Agente Faturista acionado com sucesso para o(s) dia(s) de leitura: ${data.targetDays}`);
            setTimeout(() => onClose(), 4000);
        } catch (err) {
            console.error('Erro ao acionar scraper:', err);
            setStatus('error');
            setMessage(err.message || 'Falha ao acionar o robô no GitHub.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
            <div className="modal-content" style={{
                background: 'white', padding: '2.5rem', borderRadius: '16px',
                width: '100%', maxWidth: '480px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                position: 'relative', border: '1px solid #e2e8f0'
            }}>
                <button onClick={onClose} style={{
                    position: 'absolute', top: '1.25rem', right: '1.25rem',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8'
                }}>
                    <X size={24} />
                </button>

                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{
                        width: '64px', height: '64px', background: 'var(--color-blue)',
                        borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 1.25rem', color: 'white'
                    }}>
                        <Download size={32} />
                    </div>
                    <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#1e293b', marginBottom: '0.5rem' }}>
                        Extração Manual de Faturas
                    </h3>
                    <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                        O Agente Faturista será acionado no GitHub para buscar as faturas do período selecionado.
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#475569', marginBottom: '0.75rem' }}>
                            Modo de Seleção (Dia de Leitura)
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                            {[
                                { id: 'day', label: 'Dia Único', icon: <Hash size={16} /> },
                                { id: 'week', label: 'Semana', icon: <Layers size={16} /> },
                                { id: 'month', label: 'Mês Inteiro', icon: <Calendar size={16} /> }
                            ].map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => setType(opt.id)}
                                    style={{
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
                                        padding: '0.75rem', borderRadius: '10px', fontSize: '0.8rem', fontWeight: '600',
                                        border: type === opt.id ? '2px solid var(--color-blue)' : '1px solid #e2e8f0',
                                        background: type === opt.id ? '#eff6ff' : 'white',
                                        color: type === opt.id ? 'var(--color-blue)' : '#64748b',
                                        cursor: 'pointer', transition: 'all 0.2s'
                                    }}
                                >
                                    {opt.icon}
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '700', color: '#475569', marginBottom: '0.75rem' }}>
                            {type === 'month' ? 'Selecione o Mês Ref.' : 'Selecione a Data Ref.'}
                        </label>
                        <input
                            type={type === 'month' ? 'month' : 'date'}
                            value={dateValue}
                            onChange={(e) => setDateValue(e.target.value)}
                            style={{
                                width: '100%', padding: '0.75rem 1rem', borderRadius: '10px',
                                border: '1px solid #e2e8f0', fontSize: '1rem'
                            }}
                        />
                    </div>

                    {status && (
                        <div style={{
                            padding: '1rem', borderRadius: '10px',
                            background: status === 'success' ? '#f0fdf4' : '#fef2f2',
                            color: status === 'success' ? '#166534' : '#991b1b',
                            fontSize: '0.85rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start'
                        }}>
                            {status === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                            <span>{message}</span>
                        </div>
                    )}

                    <button
                        onClick={handleTrigger}
                        disabled={loading || status === 'success'}
                        style={{
                            width: '100%', padding: '1rem', borderRadius: '10px', background: 'var(--color-blue)',
                            color: 'white', fontWeight: '700', fontSize: '1rem', border: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
                            opacity: loading || status === 'success' ? 0.7 : 1, transition: 'all 0.2s'
                        }}
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                        {loading ? 'Processando...' : 'Iniciar Extração'}
                    </button>
                </div>
            </div>
        </div>
    );
}
