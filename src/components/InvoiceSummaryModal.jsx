import React, { useState } from 'react';
import { X, FileText, CreditCard, ExternalLink, Info, CheckCircle2, AlertCircle, Pencil, Trash2, Save, RotateCcw, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createAsaasCharge } from '../lib/api';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';

import { useBranding } from '../contexts/BrandingContext';
import { useUI } from '../contexts/UIContext';

export default function InvoiceSummaryModal({ invoice, consumerUnit, onClose, onPaymentSuccess }) {
    const { branding } = useBranding();
    const { showAlert, showConfirm } = useUI();
    const [loading, setLoading] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [energyStatus, setEnergyStatus] = useState(invoice?.energy_bill_status || 'pendente');

    const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'error'
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState(null);

    if (!invoice) return null;

    const formatCurrency = (val) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);
    };

    const handleViewPdf = () => {
        if (invoice.concessionaria_pdf_url) {
            window.open(invoice.concessionaria_pdf_url, '_blank');
        } else {
            showAlert('PDF da concessionária não disponível para esta fatura.', 'warning');
        }
    };

    const handlePay = async () => {
        const utilityValue = Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0));

        const confirmed = await showConfirm(`Deseja pagar a conta de energia da concessionária no valor de ${formatCurrency(utilityValue)}?`, 'Confirmar Pagamento');
        if (!confirmed) return;

        setLoading(true);
        setPaymentStatus(null);

        try {
            const { data, error } = await supabase.functions.invoke('pay-asaas-bill', {
                body: {
                    identification: invoice.linha_digitavel,
                    value: utilityValue,
                    description: `Pagamento Conta Energia - ${consumerUnit?.titular_conta || 'UC'}`,
                    scheduleDate: null
                }
            });

            if (error) throw error;

            if (data?.data?.id || data?.success) {
                // Update local status - IMPORTANT: Also update energy_bill_status to 'pago'
                const { error: updateError } = await supabase
                    .from('invoices')
                    .update({ 
                        status: 'pago', 
                        asaas_status: 'PAID',
                        energy_bill_status: 'pago' 
                    })
                    .eq('id', invoice.id);

                if (updateError) throw updateError;

                // Registrar liquidação no Ledger (Livro Razão)
                const { error: ledgerError } = await supabase.rpc('liquidate_concessionaria_payment', {
                    p_invoice_id: invoice.id,
                    p_amount: utilityValue
                });

                if (ledgerError) {
                    console.error('Erro ao registrar no ledger:', ledgerError);
                    showAlert('Pagamento concluído, mas houve um erro ao registrar no Livro Razão.', 'warning');
                }

                setEnergyStatus('pago');
                setPaymentStatus('success');
                if (onPaymentSuccess) onPaymentSuccess();
                
                setTimeout(() => {
                    onClose();
                }, 3000);
            } else {
                throw new Error(data?.message || 'Falha ao processar pagamento');
            }

        } catch (error) {
            console.error('Erro no pagamento:', error);
            setPaymentStatus('error');
            showAlert(`Falha no pagamento: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateEnergyStatus = async (newStatus) => {
        if (updatingStatus) return;
        setUpdatingStatus(true);
        try {
            const { error } = await supabase
                .from('invoices')
                .update({ energy_bill_status: newStatus })
                .eq('id', invoice.id);

            if (error) throw error;
            setEnergyStatus(newStatus);
            if (onPaymentSuccess) onPaymentSuccess();
            showAlert('Status da conta atualizado com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao atualizar status da conta:', error);
            showAlert('Erro ao atualizar status: ' + error.message, 'error');
        } finally {
            setUpdatingStatus(false);
        }
    };

    const handleGenerateBilling = async () => {
        const confirmed = await showConfirm(`Deseja gerar faturamento e emitir cobrança (Asaas) para esta conta no valor de ${formatCurrency(invoice.valor_a_pagar)}?`, 'Gerar Faturamento');
        if (!confirmed) return;

        setLoading(true);
        try {
            const result = await createAsaasCharge(invoice.id, 'invoice');

            if (!result.success && !result.url) {
                throw new Error('Falha ao gerar cobrança no Asaas.');
            }

            const { error: updateError } = await supabase
                .from('invoices')
                .update({ 
                    status: 'a_vencer',
                    asaas_boleto_url: result.url || null,
                    asaas_status: 'PENDING'
                })
                .eq('id', invoice.id);

            if (updateError) throw updateError;

            showAlert('Faturamento gerado e boleto emitido com sucesso!', 'success');
            if (result.url) {
                window.open(result.url, '_blank');
            }
            if (onPaymentSuccess) onPaymentSuccess();
            onClose();

        } catch (error) {
            console.error('Erro ao gerar faturamento:', error);
            showAlert(`Falha ao gerar faturamento: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleEdit = () => {
        if (isEditing) {
            setIsEditing(false);
            setEditData(null);
        } else {
            setEditData({
                mes_referencia: invoice.mes_referencia ? invoice.mes_referencia.substring(0, 7) : '',
                vencimento: invoice.vencimento || '',
                data_leitura_anterior: invoice.data_leitura_anterior || '',
                data_leitura: invoice.data_leitura || '',
                consumo_kwh: invoice.consumo_kwh || 0,
                energia_injetada: invoice.energia_injetada || 0,
                consumo_compensado: invoice.consumo_compensado || 0,
                consumo_reais: invoice.consumo_reais || 0,
                iluminacao_publica: invoice.iluminacao_publica || 0,
                tarifa_minima: invoice.tarifa_minima || 0,
                outros_lancamentos: invoice.outros_lancamentos || 0,
                valor_concessionaria: invoice.valor_concessionaria || 0,
                valor_a_pagar: invoice.valor_a_pagar || 0
            });
            setIsEditing(true);
        }
    };

    const handleEditChange = (field, value) => {
        const newData = { ...editData, [field]: value };
        
        // Recalcular Total Concessionária se algum valor financeiro mudar
        if (['consumo_reais', 'iluminacao_publica', 'tarifa_minima', 'outros_lancamentos'].includes(field)) {
            newData.valor_concessionaria = 
                (Number(newData.consumo_reais) || 0) + 
                (Number(newData.iluminacao_publica) || 0) + 
                (Number(newData.tarifa_minima) || 0) + 
                (Number(newData.outros_lancamentos) || 0);
        }
        
        setEditData(newData);
    };

    const handleSaveEdit = async () => {
        if (!editData.vencimento || !editData.mes_referencia) {
            showAlert('Por favor, preencha o vencimento e o mês de referência.', 'warning');
            return;
        }

        setLoading(true);
        try {
            const payload = {
                ...editData,
                // Garantir que mes_referencia tenha o dia 01 se for apenas YYYY-MM
                mes_referencia: editData.mes_referencia.length === 7 ? `${editData.mes_referencia}-01` : editData.mes_referencia
            };

            const { error } = await supabase
                .from('invoices')
                .update(payload)
                .eq('id', invoice.id);

            if (error) throw error;
            
            if (onPaymentSuccess) await onPaymentSuccess();
            showAlert('Fatura atualizada com sucesso!', 'success');
            setIsEditing(false);
            onClose(); 
        } catch (error) {
            console.error('Erro ao salvar edição:', error);
            showAlert('Erro ao salvar: ' + (error.message || 'Erro desconhecido'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!await showConfirm('Tem certeza que deseja excluir permanentemente esta fatura? Esta ação não pode ser desfeita.', 'Excluir Fatura', 'Excluir', 'Cancelar')) return;
        
        setLoading(true);
        try {
            const { error } = await supabase
                .from('invoices')
                .delete()
                .eq('id', invoice.id);

            if (error) throw error;
            
            if (onPaymentSuccess) onPaymentSuccess();
            onClose();
            showAlert('Fatura excluída com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao excluir fatura:', error);
            showAlert('Erro ao excluir: ' + error.message, 'error');
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

        const getUtilityDueDate = () => {
            if (!invoice.vencimento) return 'N/A';
            // Mostrar a data exata da fatura, sem forçar o dia do cadastro da UC
            // Isso evita confusão quando o usuário edita a data e a UI continua mostrando a antiga
            return new Date(invoice.vencimento + 'T12:00:00').toLocaleDateString('pt-BR');
        };

        const currentStatus = invoice.status === 'cancelado' 
            ? statusColors.cancelado 
            : statusColors[invoice.status] || statusColors.a_vencer;

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
                    <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', display: 'flex', gap: '0.75rem', zIndex: 10 }}>
                        <button 
                            onClick={handleDelete}
                            title="Excluir Fatura"
                            style={{ background: '#fee2e2', border: 'none', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}
                        >
                            <Trash2 size={20} />
                        </button>
                        <button 
                            onClick={handleToggleEdit}
                            title={isEditing ? "Cancelar Edição" : "Editar Fatura"}
                            style={{ background: isEditing ? '#f1f5f9' : '#eff6ff', border: 'none', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer', color: isEditing ? '#64748b' : '#2563eb', display: 'flex', alignItems: 'center' }}
                        >
                            {isEditing ? <RotateCcw size={20} /> : <Pencil size={20} />}
                        </button>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                            <X size={24} />
                        </button>
                    </div>
    
                    <div style={{ padding: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                            <div style={{ padding: '0.5rem', background: (branding?.primary_color || '#003366') + '10', borderRadius: '10px' }}>
                                <FileText size={24} color={branding?.primary_color || '#003366'} />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                                    {isEditing ? 'Editando Fatura de Energia' : 'Resumo da Conta de Energia'}
                                </h2>
                                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
                                    {isEditing ? 'Altere os dados técnicos e financeiros abaixo' : 'Detalhamento técnico e financeiro'}
                                </p>
                            </div>
                        </div>

                        {/* Status e Identificação (Assinante / Fatura do Assinante) */}
                        <div style={{ 
                            background: '#f8fafc', padding: '1.25rem', borderRadius: '16px', 
                            marginBottom: '1.5rem', border: '1px solid #e2e8f0',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <div>
                                <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Status da Fatura do Assinante</div>
                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '1rem' }}>{consumerUnit?.subscribers?.name || 'Assinante'}</div>
                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>UC: {consumerUnit?.numero_uc}</div>
                            </div>
                            <span style={{ 
                                padding: '0.4rem 0.8rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 800,
                                background: currentStatus.bg, color: currentStatus.text, border: `1px solid ${currentStatus.text}20`
                            }}>
                                {currentStatus.label}
                            </span>
                        </div>

                        {/* Energy Bill Status Toggle - Manual Override */}
                        <div style={{ 
                            background: '#f1f5f9', 
                            padding: '1rem', 
                            borderRadius: '16px', 
                            marginBottom: '1.5rem',
                            border: '1px solid #e2e8f0'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Status da Conta de energia</span>
                                {updatingStatus && <span style={{ fontSize: '0.7rem', color: '#3b82f6' }}>Salvando...</span>}
                            </div>
                             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.25rem', background: 'white', padding: '0.25rem', borderRadius: '12px' }}>
                                 {[
                                     { id: 'pendente', label: 'Pendente', color: '#2563eb' },
                                     { id: 'pago', label: 'Pago', color: '#166534' },
                                     { id: 'erro', label: 'Erro', color: '#dc2626' },
                                     { id: 'parcelada', label: 'Parcelada', color: '#ca8a04' },
                                     { id: 'contestada', label: 'Contestada', color: '#7c3aed' }
                                 ].map(s => (
                                     <button
                                         key={s.id}
                                         onClick={() => handleUpdateEnergyStatus(s.id)}
                                         disabled={updatingStatus}
                                         style={{
                                             padding: '0.5rem 0.1rem',
                                             borderRadius: '8px',
                                             border: 'none',
                                             fontSize: '0.75rem',
                                             fontWeight: energyStatus === s.id ? '800' : '600',
                                             cursor: 'pointer',
                                             transition: 'all 0.2s',
                                             background: energyStatus === s.id ? s.color : 'transparent',
                                             color: energyStatus === s.id ? 'white' : '#64748b',
                                             boxShadow: energyStatus === s.id ? `0 4px 12px ${s.color}40` : 'none',
                                             whiteSpace: 'nowrap',
                                             textAlign: 'center'
                                         }}
                                     >
                                         {s.label}
                                     </button>
                                 ))}
                             </div>
                        </div>
    
                        {/* Grid de Valores */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Vencimento</div>
                                {isEditing ? (
                                    <input 
                                        type="date" 
                                        value={editData.vencimento} 
                                        onChange={e => handleEditChange('vencimento', e.target.value)}
                                        style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.9rem', marginTop: '0.25rem' }}
                                    />
                                ) : (
                                    <div style={{ fontWeight: 800, color: '#ef4444', fontSize: '1.1rem' }}>
                                        {getUtilityDueDate()}
                                    </div>
                                )}
                            </div>
                            <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '12px', border: '1px solid #dcfce7' }}>
                                <div style={{ fontSize: '0.65rem', color: '#166534', fontWeight: 700, textTransform: 'uppercase' }}>Mês Referência</div>
                                {isEditing ? (
                                    <input 
                                        type="month" 
                                        value={editData.mes_referencia} 
                                        onChange={e => handleEditChange('mes_referencia', e.target.value)}
                                        style={{ width: '100%', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.9rem', marginTop: '0.25rem' }}
                                    />
                                ) : (
                                    <div style={{ fontWeight: 800, color: '#166534', fontSize: '1.1rem' }}>
                                        {invoice.mes_referencia ? (() => {
                                            const [year, month] = invoice.mes_referencia.split('-');
                                            return new Date(year, parseInt(month) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                                        })() : 'N/A'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Grid de Leituras */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Leitura Anterior</div>
                                {isEditing ? (
                                    <input 
                                        type="date" 
                                        value={editData.data_leitura_anterior || ''} 
                                        onChange={e => handleEditChange('data_leitura_anterior', e.target.value)}
                                        style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.9rem', marginTop: '0.25rem' }}
                                    />
                                ) : (
                                    <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '1.1rem' }}>
                                        {invoice.data_leitura_anterior ? new Date(invoice.data_leitura_anterior + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}
                                    </div>
                                )}
                            </div>
                            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Leitura Atual</div>
                                {isEditing ? (
                                    <input 
                                        type="date" 
                                        value={editData.data_leitura || ''} 
                                        onChange={e => handleEditChange('data_leitura', e.target.value)}
                                        style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.9rem', marginTop: '0.25rem' }}
                                    />
                                ) : (
                                    <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '1.1rem' }}>
                                        {invoice.data_leitura ? new Date(invoice.data_leitura + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}
                                    </div>
                                )}
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                <span>Consumo Total (kWh):</span>
                                {isEditing ? (
                                    <input type="number" value={editData.consumo_kwh} onChange={e => handleEditChange('consumo_kwh', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                ) : (
                                    <span style={{ fontWeight: 700, color: '#1e293b' }}>{invoice.consumo_kwh} kWh</span>
                                )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                <span>Energia Injetada:</span>
                                {isEditing ? (
                                    <input type="number" value={editData.energia_injetada} onChange={e => handleEditChange('energia_injetada', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                ) : (
                                    <span style={{ fontWeight: 700, color: '#0284c7' }}>{invoice.energia_injetada || 0} kWh</span>
                                )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                <span>Energia Compensada:</span>
                                {isEditing ? (
                                    <input type="number" value={editData.consumo_compensado} onChange={e => handleEditChange('consumo_compensado', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                ) : (
                                    <span style={{ fontWeight: 700, color: '#16a34a' }}>- {invoice.consumo_compensado} kWh</span>
                                )}
                            </div>
                            <hr style={{ border: 'none', borderTop: '1px dashed #e2e8f0', margin: '0.25rem 0' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                <span>Consumo em Reais:</span>
                                {isEditing ? (
                                    <input type="number" step="0.01" value={editData.consumo_reais} onChange={e => handleEditChange('consumo_reais', e.target.value)} style={{ width: '100px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                ) : (
                                    <span style={{ fontWeight: 700, color: '#1e293b' }}>{formatCurrency(invoice.consumo_reais)}</span>
                                )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                <span>Iluminação Pública:</span>
                                {isEditing ? (
                                    <input type="number" step="0.01" value={editData.iluminacao_publica} onChange={e => handleEditChange('iluminacao_publica', e.target.value)} style={{ width: '100px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                ) : (
                                    <span style={{ fontWeight: 700, color: '#1e293b' }}>{formatCurrency(invoice.iluminacao_publica)}</span>
                                )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                <span>Tarifa Mínima/Outros:</span>
                                {isEditing ? (
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <input type="number" step="0.01" value={editData.tarifa_minima} onChange={e => handleEditChange('tarifa_minima', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} placeholder="Min" />
                                        <input type="number" step="0.01" value={editData.outros_lancamentos} onChange={e => handleEditChange('outros_lancamentos', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} placeholder="Outros" />
                                    </div>
                                ) : (
                                    <span style={{ fontWeight: 700, color: '#1e293b' }}>{formatCurrency((Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0))}</span>
                                )}
                            </div>
                            
                            <div style={{ 
                                marginTop: '1rem', 
                                padding: '1.25rem', 
                                borderRadius: '16px', 
                                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                                border: '1px solid #e2e8f0',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                                display: 'flex', 
                                flexDirection: 'column', 
                                gap: '0.75rem'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                    {/* Left Side: Label and View Pdf Button */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.9rem', fontWeight: 800, color: branding?.primary_color || '#003366', letterSpacing: '0.05em' }}>
                                            TOTAL CONCESSIONÁRIA
                                        </span>
                                        
                                        {!isEditing && (
                                            <button 
                                                type="button"
                                                onClick={handleViewPdf}
                                                style={{
                                                    alignSelf: 'flex-start',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.35rem',
                                                    padding: '0.35rem 0.7rem',
                                                    borderRadius: '6px',
                                                    border: '1.5px solid #cbd5e1',
                                                    background: 'white',
                                                    color: '#475569',
                                                    fontSize: '0.75rem',
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = branding?.primary_color || '#003366'; e.currentTarget.style.color = branding?.primary_color || '#003366'; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; }}
                                            >
                                                <ExternalLink size={13} /> Visualizar Conta
                                            </button>
                                        )}
                                    </div>

                                    {/* Right Side: Value and Pay Button */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '1.4rem', fontWeight: 900, color: branding?.primary_color || '#003366' }}>
                                            {formatCurrency(isEditing ? editData.valor_concessionaria : (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0))))}
                                        </span>

                                        {!isEditing && (
                                            (() => {
                                                if (energyStatus === 'pago') {
                                                    return (
                                                        <span style={{ 
                                                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                            padding: '0.3rem 0.6rem', borderRadius: '6px',
                                                            background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0',
                                                            fontSize: '0.72rem', fontWeight: 700
                                                        }}>
                                                            <CheckCircle2 size={13} /> Pago
                                                        </span>
                                                    );
                                                }
                                                if (invoice.linha_digitavel) {
                                                    return (
                                                        <button 
                                                            type="button"
                                                            onClick={handlePay}
                                                            disabled={loading || paymentStatus === 'success'}
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '0.35rem',
                                                                padding: '0.35rem 0.75rem',
                                                                borderRadius: '6px',
                                                                border: 'none',
                                                                background: paymentStatus === 'success' ? '#22c55e' : '#10b981',
                                                                color: 'white',
                                                                fontSize: '0.75rem',
                                                                fontWeight: 700,
                                                                cursor: loading ? 'not-allowed' : 'pointer',
                                                                transition: 'all 0.2s',
                                                                boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)'
                                                            }}
                                                            onMouseEnter={e => { if(!loading) e.currentTarget.style.background = '#059669'; }}
                                                            onMouseLeave={e => { if(!loading) e.currentTarget.style.background = '#10b981'; }}
                                                        >
                                                            {loading ? 'Carregando...' : <><CreditCard size={13} /> Pagar Conta</>}
                                                        </button>
                                                    );
                                                }
                                                return null;
                                            })()
                                        )}
                                    </div>
                                </div>
                            </div>
                            
                            {/* Desconto Snapshot Display */}
                            <div style={{ marginTop: '0.5rem', textAlign: 'right', fontSize: '0.8rem', color: '#64748b' }}>
                                Desconto aplicado nesta fatura: <strong>{invoice.desconto_aplicado !== undefined ? invoice.desconto_aplicado : (consumerUnit?.desconto_assinante || 0)}%</strong>
                            </div>

                            <hr style={{ margin: '1.5rem 0', border: 'none', borderTop: '2px solid #f1f5f9' }} />

                            <div style={{ 
                                padding: '1.25rem', 
                                borderRadius: '16px', 
                                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                                border: '1px solid #e2e8f0',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                                display: 'flex', 
                                flexDirection: 'column', 
                                gap: '0.75rem'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                    {/* Left Side: Label and descriptor/Open Boleto button */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#475569', letterSpacing: '0.05em' }}>
                                            VALOR DO ASSINANTE (BOLETO)
                                        </span>
                                        
                                        {!isEditing && invoice.asaas_boleto_url && invoice.status !== 'pago' && (
                                            <a 
                                                href={invoice.asaas_boleto_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    alignSelf: 'flex-start',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.35rem',
                                                    padding: '0.35rem 0.7rem',
                                                    borderRadius: '6px',
                                                    border: '1.5px solid #bbf7d0',
                                                    background: '#dcfce7',
                                                    color: '#15803d',
                                                    fontSize: '0.75rem',
                                                    fontWeight: 700,
                                                    textDecoration: 'none',
                                                    transition: 'all 0.2s',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.background = '#bbf7d0'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = '#dcfce7'; }}
                                            >
                                                <ExternalLink size={13} /> Abrir Boleto
                                            </a>
                                        )}
                                    </div>

                                    {/* Right Side: Value and Gerar Faturamento button */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                                        {isEditing ? (
                                            <input 
                                                type="number" 
                                                step="0.01" 
                                                value={editData.valor_a_pagar} 
                                                onChange={e => handleEditChange('valor_a_pagar', e.target.value)} 
                                                style={{ 
                                                    width: '120px', 
                                                    border: '2px solid var(--color-blue)', 
                                                    borderRadius: '8px', 
                                                    textAlign: 'right', 
                                                    padding: '0.4rem',
                                                    fontSize: '1.1rem',
                                                    fontWeight: 'bold'
                                                }} 
                                            />
                                        ) : (
                                            <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--color-blue)' }}>
                                                {formatCurrency(invoice.valor_a_pagar)}
                                            </span>
                                        )}

                                        {!isEditing && (
                                            (() => {
                                                if (invoice.status === 'sem_faturamento') {
                                                    return (
                                                        <button 
                                                            type="button"
                                                            onClick={handleGenerateBilling}
                                                            disabled={loading}
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '0.35rem',
                                                                padding: '0.35rem 0.75rem',
                                                                borderRadius: '6px',
                                                                border: 'none',
                                                                background: '#0284c7',
                                                                color: 'white',
                                                                fontSize: '0.75rem',
                                                                fontWeight: 700,
                                                                cursor: loading ? 'not-allowed' : 'pointer',
                                                                transition: 'all 0.2s',
                                                                boxShadow: '0 2px 4px rgba(2, 132, 199, 0.2)'
                                                            }}
                                                            onMouseEnter={e => { if(!loading) e.currentTarget.style.background = '#0369a1'; }}
                                                            onMouseLeave={e => { if(!loading) e.currentTarget.style.background = '#0284c7'; }}
                                                        >
                                                            {loading ? 'Gerando...' : <><FileText size={13} /> Gerar Fatura</>}
                                                        </button>
                                                    );
                                                }
                                                if (invoice.status === 'pago') {
                                                    return (
                                                        <span style={{ 
                                                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                            padding: '0.3rem 0.6rem', borderRadius: '6px',
                                                            background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0',
                                                            fontSize: '0.72rem', fontWeight: 700
                                                        }}>
                                                            <CheckCircle2 size={13} /> Fatura Paga
                                                        </span>
                                                    );
                                                }
                                                return null;
                                            })()
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Saldo Display */}
                            {!isEditing && (
                                <div style={{ 
                                    marginTop: '1rem', padding: '1rem', borderRadius: '12px', 
                                    background: (invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0)))) >= -0.01 ? '#f0fdf4' : '#fef2f2',
                                    border: `1px solid ${(invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0)))) >= -0.01 ? '#bbf7d0' : '#fecaca'}`,
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                }}>
                                    <span style={{ fontSize: '1rem', fontWeight: 800, color: (invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0)))) >= -0.01 ? '#166534' : '#dc2626' }}>SALDO (MARGEM)</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: 900, color: (invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0)))) >= -0.01 ? '#166534' : '#dc2626' }}>
                                        {formatCurrency(invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0))))}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {!isEditing && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <CollapsibleSection title="Histórico e Observações" icon={Clock} defaultOpen={false} noGrid={true}>
                                <div style={{ width: '100%' }}>
                                    <HistoryTimeline
                                        entityType="invoice"
                                        entityId={invoice.id}
                                        entityName={`Fatura ${invoice.mes_referencia} - UC ${consumerUnit?.numero_uc}`}
                                        isInline={true}
                                        compact={true}
                                        hideHeader={true}
                                    />
                                </div>
                            </CollapsibleSection>
                        </div>
                    )}

                    {/* Ações */}
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        {isEditing ? (
                            <>
                                <button 
                                    onClick={handleToggleEdit}
                                    style={{ flex: 1, padding: '1rem', borderRadius: '12px', border: '2px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
                                >
                                    Cancelar
                                </button>
                                <button 
                                    onClick={handleSaveEdit}
                                    disabled={loading}
                                    style={{ flex: 1, padding: '1rem', borderRadius: '12px', border: 'none', background: branding?.primary_color || '#003366', color: 'white', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                                >
                                    {loading ? 'Salvando...' : <><Save size={18} /> Salvar Alterações</>}
                                </button>
                            </>
                        ) : (
                            <>
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
                                
                                {invoice.status === 'sem_faturamento' && (
                                    <button 
                                        onClick={handleGenerateBilling}
                                        disabled={loading}
                                        style={{
                                            flex: 1, padding: '1rem', borderRadius: '12px', border: 'none',
                                            background: '#0284c7',
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
                                        ) : (
                                            <><FileText size={18} /> Gerar Faturamento (Cobrança)</>
                                        )}
                                    </button>
                                )}

                                {energyStatus !== 'pago' && invoice.linha_digitavel && (
                                    <button 
                                        onClick={handlePay}
                                        disabled={loading || paymentStatus === 'success'}
                                        style={{
                                            flex: 1, padding: '1rem', borderRadius: '12px', border: 'none',
                                            background: paymentStatus === 'success' ? '#22c55e' : '#10b981',
                                            color: 'white', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                                            opacity: loading ? 0.7 : 1,
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={e => !loading && (e.currentTarget.style.background = '#059669')}
                                        onMouseOut={e => !loading && (e.currentTarget.style.background = '#10b981')}
                                    >
                                        {loading ? (
                                            <div style={{ width: '20px', height: '20px', border: '3px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                                        ) : paymentStatus === 'success' ? (
                                            <><CheckCircle2 size={18} /> Pago com Sucesso</>
                                        ) : (
                                            <><CreditCard size={18} /> Pagar Conta Energia</>
                                        )}
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {paymentStatus === 'success' && (
                        <div style={{ 
                            marginTop: '1.5rem', 
                            padding: '1.25rem', 
                            background: '#f0fdf4', 
                            border: '1px solid #22c55e', 
                            borderRadius: '16px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.75rem', 
                            color: '#166534', 
                            fontSize: '0.9rem',
                            animation: 'slideUp 0.3s ease-out'
                        }}>
                            <div style={{ background: '#22c55e', color: 'white', borderRadius: '50%', padding: '4px', display: 'flex' }}>
                                <CheckCircle2 size={16} />
                            </div>
                            <span style={{ fontWeight: 600 }}>Pagamento processado e status atualizado com sucesso!</span>
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
