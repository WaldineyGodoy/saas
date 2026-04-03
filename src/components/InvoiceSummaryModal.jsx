import React, { useState } from 'react';
import { X, FileText, CreditCard, ExternalLink, Info, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

import { useBranding } from '../contexts/BrandingContext';

export default function InvoiceSummaryModal({ invoice, consumerUnit, onClose, onPaymentSuccess }) {
    const { branding } = useBranding();
    const [loading, setLoading] = useState(false);

    const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'error'

    if (!invoice) return null;

    const formatCurrency = (val) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);
    };

    const handleViewPdf = () => {
        if (invoice.concessionaria_pdf_url) {
            window.open(invoice.concessionaria_pdf_url, '_blank');
        } else {
            alert('PDF da concessionária não disponível para esta fatura.');
        }
    };

    const handlePay = async () => {
        const confirmed = window.confirm(`Deseja processar o pagamento desta conta no valor de ${formatCurrency(invoice.valor_a_pagar)}?`);
        if (!confirmed) return;

        setLoading(true);
        setPaymentStatus(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            
            // Calling the edge function pay_asaas_bill
            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pay_asaas_bill`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    identification: invoice.linha_digitavel,
                    description: `Pagamento Fatura ${invoice.mes_referencia} - UC ${consumerUnit?.numero_uc}`,
                    value: invoice.valor_a_pagar
                })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Erro ao processar pagamento.');
            }

            // Update local status
            const { error: updateError } = await supabase
                .from('invoices')
                .update({ status: 'pago', asaas_status: 'PAID' })
                .eq('id', invoice.id);

            if (updateError) console.error('Erro ao atualizar status local:', updateError);

            setPaymentStatus('success');
            if (onPaymentSuccess) onPaymentSuccess();
            
            setTimeout(() => {
                onClose();
            }, 3000);

        } catch (error) {
            console.error('Erro no pagamento:', error);
            setPaymentStatus('error');
            alert(`Falha no pagamento: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const statusColors = {
        pago: { bg: '#dcfce7', text: '#166534', label: 'PAGO' },
        a_vencer: { bg: '#eff6ff', text: '#1d4ed8', label: 'A VENCER' },
        atrasado: { bg: '#fee2e2', text: '#991b1b', label: 'ATRASADO' },
        cancelado: { bg: '#f1f5f9', text: '#475569', label: 'CANCELADO' }
    };

    const currentStatus = statusColors[invoice.status] || { bg: '#f1f5f9', text: '#475569', label: invoice.status?.toUpperCase() };

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)'
        }}>
            <div className="modal-content" style={{
                backgroundColor: 'white', borderRadius: '20px', width: '90%', maxWidth: '600px',
                maxHeight: '90vh', overflowY: 'auto', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
            }}>
                <button onClick={onClose} style={{
                    position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'none',
                    border: 'none', cursor: 'pointer', color: '#64748b', zIndex: 10
                }}>
                    <X size={24} />
                </button>

                <div style={{ padding: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                        <div style={{ padding: '0.5rem', background: (branding?.primary_color || '#003366') + '10', borderRadius: '10px' }}>
                            <FileText size={24} color={branding?.primary_color || '#003366'} />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                                Resumo da Conta de Energia
                            </h2>
                            <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
                                Detalhamento técnico e financeiro
                            </p>
                        </div>
                    </div>

                    {/* Status e Identificação */}
                    <div style={{ 
                        background: '#f8fafc', padding: '1.25rem', borderRadius: '16px', 
                        marginBottom: '1.5rem', border: '1px solid #e2e8f0',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                        <div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Assinante</div>
                            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '1rem' }}>{consumerUnit?.subscriber?.name || 'N/A'}</div>
                            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>UC: {consumerUnit?.numero_uc}</div>
                        </div>
                        <span style={{ 
                            padding: '0.4rem 0.8rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 800,
                            background: currentStatus.bg, color: currentStatus.text, border: `1px solid ${currentStatus.text}20`
                        }}>
                            {currentStatus.label}
                        </span>
                    </div>

                    {/* Grid de Valores */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Vencimento</div>
                            <div style={{ fontWeight: 800, color: '#ef4444', fontSize: '1.1rem' }}>
                                {invoice.vencimento ? new Date(invoice.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}
                            </div>
                        </div>
                        <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '12px', border: '1px solid #dcfce7' }}>
                            <div style={{ fontSize: '0.65rem', color: '#166534', fontWeight: 700, textTransform: 'uppercase' }}>Mês Referência</div>
                            <div style={{ fontWeight: 800, color: '#166534', fontSize: '1.1rem' }}>
                                {invoice.mes_referencia ? `${invoice.mes_referencia.split('-')[1]}/${invoice.mes_referencia.split('-')[0]}` : 'N/A'}
                            </div>
                        </div>
                    </div>

                    {/* Detalhamento de Consumo */}
                    <div style={{ 
                        background: 'white', padding: '1.5rem', borderRadius: '16px', 
                        border: '1px solid #e2e8f0', marginBottom: '2rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}>
                        <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: '#475569', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Composição da Fatura
                        </h4>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b' }}>
                                <span>Consumo Total (kWh):</span>
                                <span style={{ fontWeight: 700, color: '#1e293b' }}>{invoice.consumo_kwh} kWh</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b' }}>
                                <span>Energia Compensada:</span>
                                <span style={{ fontWeight: 700, color: '#16a34a' }}>- {invoice.consumo_compensado} kWh</span>
                            </div>
                            <hr style={{ border: 'none', borderTop: '1px dashed #e2e8f0', margin: '0.25rem 0' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b' }}>
                                <span>Consumo em Reais:</span>
                                <span style={{ fontWeight: 700, color: '#1e293b' }}>{formatCurrency(invoice.consumo_reais)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b' }}>
                                <span>Iluminação Pública:</span>
                                <span style={{ fontWeight: 700, color: '#1e293b' }}>{formatCurrency(invoice.iluminacao_publica)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b' }}>
                                <span>Tarifa Mínima/Outros:</span>
                                <span style={{ fontWeight: 700, color: '#1e293b' }}>{formatCurrency((Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0))}</span>
                            </div>
                            
                            <div style={{ 
                                marginTop: '1rem', padding: '1rem', borderRadius: '12px', 
                                background: (branding?.secondary_color || '#FF6600') + '05',
                                border: `1px solid ${branding?.secondary_color || '#FF6600'}20`,
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}>
                                <span style={{ fontSize: '1rem', fontWeight: 800, color: branding?.primary_color || '#003366' }}>TOTAL A PAGAR</span>
                                <span style={{ fontSize: '1.5rem', fontWeight: 900, color: branding?.primary_color || '#003366' }}>
                                    {formatCurrency(invoice.valor_a_pagar)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Ações */}
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button 
                            onClick={handleViewPdf}
                            style={{
                                flex: 1, padding: '1rem', borderRadius: '12px', border: '2px solid #e2e8f0',
                                background: 'white', color: '#475569', fontWeight: 700, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                transition: 'all 0.2s'
                            }}
                            onMouseOver={e => e.currentTarget.style.borderColor = branding?.primary_color || '#003366'}
                            onMouseOut={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                        >
                            <ExternalLink size={18} /> Visualizar Conta
                        </button>
                        
                        {invoice.status !== 'pago' && (
                            <button 
                                onClick={handlePay}
                                disabled={loading || paymentStatus === 'success'}
                                style={{
                                    flex: 1, padding: '1rem', borderRadius: '12px', border: 'none',
                                    background: paymentStatus === 'success' ? '#22c55e' : (branding?.secondary_color || '#FF6600'),
                                    color: 'white', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                                    opacity: loading ? 0.7 : 1,
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={e => !loading && (e.currentTarget.style.transform = 'translateY(-2px)')}
                                onMouseOut={e => !loading && (e.currentTarget.style.transform = 'translateY(0)')}
                            >
                                {loading ? (
                                    <div style={{ width: '20px', height: '20px', border: '3px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                                ) : paymentStatus === 'success' ? (
                                    <><CheckCircle2 size={18} /> Pago com Sucesso</>
                                ) : (
                                    <><CreditCard size={18} /> Pagar Agora</>
                                )}
                            </button>
                        )}
                    </div>

                    {paymentStatus === 'success' && (
                        <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#166534', fontSize: '0.85rem' }}>
                            <CheckCircle2 size={16} /> Pagamento processado e status atualizado!
                        </div>
                    )}
                </div>

                <style>{`
                    @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
            </div>
        </div>
    );
}
