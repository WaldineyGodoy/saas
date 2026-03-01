import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { Clock, User, Calendar as CalendarIcon, X, FileText, Activity } from 'lucide-react';

export default function InvoiceHistoryModal({ onClose }) {
    const { showAlert } = useUI();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('v_invoice_history')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setHistory(data || []);
        } catch (error) {
            console.error('Error fetching history:', error);
            showAlert('Erro ao carregar histórico', 'error');
        } finally {
            setLoading(false);
        }
    };

    const formatMetadata = (metadata, eventType) => {
        if (!metadata || Object.keys(metadata).length === 0) return null;

        if (eventType === 'Alteração de Vencimento') {
            return (
                <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#64748b' }}>
                    De: <span style={{ textDecoration: 'line-through' }}>{new Date(metadata.de + 'T12:00:00').toLocaleDateString()}</span> →
                    <span style={{ fontWeight: 'bold', color: 'var(--color-blue)', marginLeft: '4px' }}>{new Date(metadata.para + 'T12:00:00').toLocaleDateString()}</span>
                </div>
            );
        }

        if (eventType === 'Alteração de Valor') {
            const formatCurrency = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            return (
                <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#64748b' }}>
                    De: <span style={{ textDecoration: 'line-through' }}>{formatCurrency(metadata.de)}</span> →
                    <span style={{ fontWeight: 'bold', color: 'var(--color-blue)', marginLeft: '4px' }}>{formatCurrency(metadata.para)}</span>
                </div>
            );
        }

        if (eventType === 'Fatura Criada') {
            return (
                <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#64748b' }}>
                    Ref: <span style={{ fontWeight: 600 }}>{metadata.mes_referencia}</span> |
                    Valor: <span style={{ fontWeight: 600 }}>{Number(metadata.valor_a_pagar).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                </div>
            );
        }

        return null;
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100,
            backdropFilter: 'blur(4px)'
        }}>
            <div style={{
                background: 'white',
                padding: '0',
                borderRadius: '12px',
                width: '90%',
                maxWidth: '700px',
                height: '85vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.25rem 1.5rem',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#003366',
                    borderTopLeftRadius: '12px',
                    borderTopRightRadius: '12px',
                    color: 'white'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', borderRadius: '8px' }}>
                            <Activity size={24} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold' }}>Histórico Geral de Faturas</h3>
                            <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.8 }}>Movimentações registradas no sistema</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', color: 'white',
                        padding: '0.5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.2s'
                    }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}>
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', backgroundColor: '#f8fafc' }}>
                    {loading ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
                            <div className="spinner" style={{ width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid #003366', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                            <p style={{ marginTop: '1rem' }}>Carregando histórico...</p>
                        </div>
                    ) : history.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '5rem 0' }}>
                            <Clock size={64} style={{ marginBottom: '1.5rem', opacity: 0.3 }} />
                            <p style={{ fontSize: '1.1rem' }}>Nenhuma movimentação registrada.</p>
                        </div>
                    ) : (
                        <div style={{ position: 'relative', paddingLeft: '2.5rem' }}>
                            {/* Vertical Line */}
                            <div style={{
                                position: 'absolute', left: '11px', top: '0', bottom: '0',
                                width: '2px', background: 'linear-gradient(to bottom, #cbd5e1 0%, #cbd5e1 100%)'
                            }} />

                            {history.map((item, index) => (
                                <div key={item.id} style={{ position: 'relative', marginBottom: '2rem' }}>
                                    {/* Dot */}
                                    <div style={{
                                        position: 'absolute', left: '-36px', top: '0',
                                        width: '24px', height: '24px', borderRadius: '50%',
                                        background: 'white',
                                        border: '4px solid ' + (index === 0 ? '#003366' : '#cbd5e1'),
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                        zIndex: 1
                                    }} />

                                    <div style={{
                                        background: 'white',
                                        padding: '1.25rem',
                                        borderRadius: '12px',
                                        border: '1px solid #e2e8f0',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                                        transition: 'transform 0.2s',
                                        cursor: 'default'
                                    }} onMouseOver={e => e.currentTarget.style.transform = 'translateX(5px)'} onMouseOut={e => e.currentTarget.style.transform = 'translateX(0)'}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                            <div>
                                                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                    {item.uc_name || 'UC Não Identificada'}
                                                </div>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '1rem', marginTop: '0.1rem' }}>
                                                    {item.event_type}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748b', fontSize: '0.8rem' }}>
                                                    <CalendarIcon size={14} />
                                                    {new Date(item.created_at).toLocaleString('pt-BR')}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'flex-end', marginTop: '0.3rem', color: '#003366', fontWeight: 600, fontSize: '0.8rem' }}>
                                                    <User size={14} />
                                                    {item.author_name}
                                                </div>
                                            </div>
                                        </div>

                                        {formatMetadata(item.metadata, item.event_type)}

                                        <div style={{
                                            marginTop: '0.75rem',
                                            paddingTop: '0.75rem',
                                            borderTop: '1px solid #f1f5f9',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            fontSize: '0.75rem',
                                            color: '#94a3b8'
                                        }}>
                                            <FileText size={12} />
                                            <span>Mês de Referência: {item.mes_referencia ? new Date(item.mes_referencia + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '-'}</span>
                                            <span style={{ margin: '0 0.5rem' }}>•</span>
                                            <span>UC: {item.numero_uc || '-'}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e2e8f0', textAlign: 'right', background: '#f8fafc', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
                    <button onClick={onClose} style={{
                        padding: '0.6rem 2rem',
                        background: '#1e293b',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold'
                    }}>
                        Fechar
                    </button>
                </div>
            </div>
            <style>{`
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
