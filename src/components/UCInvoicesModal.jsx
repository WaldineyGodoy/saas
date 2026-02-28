import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, X, AlertCircle, CheckCircle, Clock, ExternalLink } from 'lucide-react';

export default function UCInvoicesModal({ uc, onClose }) {
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (uc?.id) {
            fetchInvoices();
        }
    }, [uc]);

    const fetchInvoices = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('invoices')
                .select('*')
                .eq('uc_id', uc.id)
                .order('mes_referencia', { ascending: false });

            if (error) throw error;
            setInvoices(data || []);
        } catch (error) {
            console.error('Error fetching UC invoices:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val) => Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const getStatusBadge = (status) => {
        const map = {
            'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago', icon: CheckCircle },
            'a_vencer': { color: '#854d0e', bg: '#fef9c3', label: 'A Vencer', icon: Clock },
            'atrasado': { color: '#991b1b', bg: '#fee2e2', label: 'Atrasado', icon: AlertCircle },
        };
        const s = map[status] || map['a_vencer'];
        const Icon = s.icon;
        return (
            <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.2rem 0.6rem',
                background: s.bg,
                color: s.color,
                borderRadius: '99px',
                fontSize: '0.75rem',
                fontWeight: 600
            }}>
                <Icon size={12} /> {s.label}
            </span>
        );
    };

    const formatMonth = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, backdropFilter: 'blur(4px)' }}>
            <div style={{ background: 'white', borderRadius: '12px', width: '90%', maxWidth: '800px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>

                {/* Header */}
                <div style={{ padding: '1.2rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#1e293b' }}>Faturas da Unidade Consumidora</h3>
                        <p style={{ fontSize: '0.85rem', color: '#64748b' }}>{uc?.numero_uc} - {uc?.titular_conta}</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Carregando faturas...</div>
                    ) : invoices.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                            <FileText size={48} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
                            <p>Nenhuma fatura encontrada para esta UC.</p>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ position: 'sticky', top: 0, background: 'white', zIndex: 10 }}>
                                <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>Mês Ref.</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>Vencimento</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>Valor</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>Status</th>
                                    <th style={{ textAlign: 'right', padding: '0.75rem', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>Link</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((inv) => (
                                    <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9', transition: '0.2s' }}>
                                        <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#334155', textTransform: 'capitalize' }}>
                                            {formatMonth(inv.mes_referencia)}
                                        </td>
                                        <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#334155' }}>
                                            {inv.vencimento ? new Date(inv.vencimento).toLocaleDateString('pt-BR') : '-'}
                                        </td>
                                        <td style={{ padding: '0.75rem', fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>
                                            {formatCurrency(inv.valor_a_pagar)}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            {getStatusBadge(inv.status)}
                                        </td>
                                        <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                            {inv.asaas_boleto_url ? (
                                                <a
                                                    href={inv.asaas_boleto_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: '#3b82f6', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600 }}
                                                >
                                                    Boleto <ExternalLink size={14} />
                                                </a>
                                            ) : (
                                                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={onClose}
                        style={{ padding: '0.5rem 1.5rem', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#475569', fontWeight: 600, cursor: 'pointer' }}
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
}
