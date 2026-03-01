import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CreditCard, FileText, Calculator, DollarSign, Lightbulb, Zap, AlertCircle, Ban } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { createAsaasCharge, cancelAsaasCharge, updateAsaasCharge } from '../lib/api';

export default function InvoiceFormModal({ invoice, ucs, onClose, onSave }) {
    const { profile } = useAuth();
    const canManageStatus = ['super_admin', 'admin', 'manager'].includes(profile?.role);

    // Initial State
    const [formData, setFormData] = useState({
        uc_id: '',
        mes_referencia: new Date().toISOString().substring(0, 7), // YYYY-MM
        vencimento: '',
        consumo_kwh: '',
        iluminacao_publica: '',
        tarifa_minima: '',
        outros_lancamentos: '',
        status: 'a_vencer',

        // Calculated/Display fields
        valor_a_pagar: '',
        economia_reais: '',
        consumo_reais: '', // energy cost before taxes/extras
        consumo_compensado: 0, // kWh
        energia_compensada_reais: '' // R$
    });

    const [selectedUc, setSelectedUc] = useState(null);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [duplicateInfo, setDuplicateInfo] = useState(null); // { existing, type: 'block' | 'ask' }
    const [showDuplicateModal, setShowDuplicateModal] = useState(false);
    const { showAlert, showConfirm } = useUI();

    // Helpers
    const formatCurrency = (val) => {
        if (!val && val !== 0) return 'R$ 0,00';
        return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const parseCurrency = (str) => {
        if (!str) return 0;
        if (typeof str === 'number') return str;
        return Number(str.replace(/\D/g, '')) / 100;
    };

    // Load Invoice Data
    useEffect(() => {
        if (invoice) {
            setFormData({
                uc_id: invoice.uc_id,
                mes_referencia: invoice.mes_referencia ? invoice.mes_referencia.substring(0, 7) : '',
                vencimento: invoice.vencimento ? invoice.vencimento.split('T')[0] : '',
                consumo_kwh: invoice.consumo_kwh,
                iluminacao_publica: invoice.iluminacao_publica ? formatCurrency(invoice.iluminacao_publica) : '',
                tarifa_minima: invoice.tarifa_minima ? formatCurrency(invoice.tarifa_minima) : '',
                outros_lancamentos: invoice.outros_lancamentos ? formatCurrency(invoice.outros_lancamentos) : '',
                valor_a_pagar: formatCurrency(invoice.valor_a_pagar),
                economia_reais: formatCurrency(invoice.economia_reais),
                consumo_reais: invoice.consumo_reais ? formatCurrency(invoice.consumo_reais) : '',
                status: invoice.status
            });
            // Find UC to set tariff info
            if (ucs) {
                const uc = ucs.find(u => u.id === invoice.uc_id);
                setSelectedUc(uc);
            }
        } else if (ucs && ucs.length > 0) {
            setFormData(prev => ({ ...prev, uc_id: ucs[0].id }));
            setSelectedUc(ucs[0]);
        }
    }, [invoice, ucs]);

    // Update Selected UC when changed
    useEffect(() => {
        if (formData.uc_id && ucs) {
            const uc = ucs.find(u => u.id === formData.uc_id);
            setSelectedUc(uc);
        }
    }, [formData.uc_id, ucs]);

    // Calculations
    useEffect(() => {
        // Only calculate if we have Consumption and a selected UC with tariff
        if (formData.consumo_kwh && selectedUc) {
            const consumo = Number(formData.consumo_kwh);
            const rawTarifa = Number(selectedUc.tarifa_concessionaria) || 0;
            const descontoPercent = Number(selectedUc.desconto_assinante) || 0;
            const multiplier = descontoPercent > 1 ? descontoPercent / 100 : descontoPercent;

            // Rule for Minimum Consumption (Cost of Availability)
            const tipoLigacao = selectedUc.tipo_ligacao || 'monofasico';
            const kwhMinimo = tipoLigacao === 'trifasico' ? 100 : (tipoLigacao === 'bifasico' ? 50 : 30);

            // Consumo Compensado = Consumo - Mínimo (cannot be negative)
            const consumoCompensado = Math.max(0, consumo - kwhMinimo);

            // Tarifa Mínima R$ = Mínimo * Tarifa
            const tarifaMinimaReais = kwhMinimo * rawTarifa;

            // Energia Compensada R$ = Consumo Compensado * Tarifa * (1 - Desconto)
            // Note: rawTarifa * (1 - multiplier) is the effective rate after discount
            const energiaCompensadaReais = consumoCompensado * rawTarifa * (1 - multiplier);

            // Economia Gerada (for display/DB): (Consumo Compensado * Tarifa) * Desconto
            const economia = (consumoCompensado * rawTarifa) * multiplier;

            // Consumo Bruto (just for summary display): (Consumo * Tarifa)
            // Consumo Líquido (Consumo R$ field): ConsumoBruto - Economia

            const ip = parseCurrency(formData.iluminacao_publica);
            const outros = parseCurrency(formData.outros_lancamentos);

            // Total = Energia Compensada + Tarifa Mínima + IP + Outros
            const total = energiaCompensadaReais + tarifaMinimaReais + ip + outros;

            setFormData(prev => ({
                ...prev,
                consumo_compensado: consumoCompensado,
                tarifa_minima: formatCurrency(tarifaMinimaReais),
                energia_compensada_reais: formatCurrency(energiaCompensadaReais),
                economia_reais: formatCurrency(economia),
                consumo_reais: formatCurrency(energiaCompensadaReais + tarifaMinimaReais), // Matches total energy cost
                valor_a_pagar: formatCurrency(total)
            }));
        }
    }, [
        formData.consumo_kwh,
        formData.iluminacao_publica,
        // formData.tarifa_minima, // Removed to prevent loop since we automate it
        formData.outros_lancamentos,
        selectedUc
    ]);

    // Automatic Due Date Calculation
    useEffect(() => {
        // Only automate for NEW invoices
        if (!invoice && selectedUc && formData.mes_referencia) {
            const [year, month] = formData.mes_referencia.split('-').map(Number);
            const dueDay = selectedUc.dia_vencimento;

            if (dueDay) {
                // Calculate next month
                let nextMonth = month + 1;
                let nextYear = year;
                if (nextMonth > 12) {
                    nextMonth = 1;
                    nextYear++;
                }

                // Ensure valid date
                const dateObj = new Date(nextYear, nextMonth - 1, dueDay);
                const formattedDate = dateObj.toISOString().split('T')[0];

                setFormData(prev => ({ ...prev, vencimento: formattedDate }));
            }
        }
    }, [formData.mes_referencia, selectedUc, invoice]);


    const handleCurrencyChange = (field, value) => {
        const digits = value.replace(/\D/g, '');
        const number = Number(digits) / 100;
        const formatted = number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        setFormData(prev => ({ ...prev, [field]: formatted }));
    };

    const handleMonthChange = (part, value) => {
        const currentParts = formData.mes_referencia.split('-');
        let year = currentParts[0] || new Date().getFullYear();
        let month = currentParts[1] || '01';
        if (part === 'month') month = value;
        if (part === 'year') year = value;
        setFormData(prev => ({ ...prev, mes_referencia: `${year}-${month}` }));
    };

    const handleCancel = async () => {
        if (!invoice?.id) return;

        const confirmed = await showConfirm(
            'Você realmente deseja cancelar essa fatura? Se houver um boleto emitido no Asaas, ele também será cancelado. Esta ação é irreversível.',
            'Confirmar Cancelamento',
            'Sim, Cancelar',
            'Voltar'
        );

        if (!confirmed) return;

        setLoading(true);
        try {
            await cancelAsaasCharge(invoice.id);
            showAlert('Fatura e cobrança canceladas com sucesso!', 'success');
            onSave();
            onClose();
        } catch (error) {
            console.error('Error canceling invoice:', error);
            showAlert('Erro ao cancelar fatura: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleEmission = async () => {
        if (!invoice?.id) {
            showAlert('Salve a fatura antes de emitir o boleto.', 'warning');
            return;
        }

        const confirmed = await showConfirm(
            'Deseja gerar o boleto Asaas agora para esta fatura?',
            'Emitir Boleto',
            'Gerar Boleto',
            'Cancelar'
        );

        if (!confirmed) return;

        setGenerating(true);
        try {
            const result = await createAsaasCharge(invoice.id);
            if (result.url) {
                showAlert('Boleto gerado com sucesso!', 'success');
                window.open(result.url, '_blank');
                onSave();
                onClose();
            }
        } catch (error) {
            console.error(error);
            showAlert('Erro ao gerar boleto: ' + error.message, 'error');
        } finally {
            setGenerating(false);
        }
    };

    const handleSubmit = async (e, action = null) => {
        if (e) e.preventDefault();
        setLoading(true);

        try {
            const payload = {
                uc_id: formData.uc_id,
                mes_referencia: `${formData.mes_referencia}-01`,
                vencimento: formData.vencimento,
                consumo_kwh: Number(formData.consumo_kwh),
                consumo_reais: parseCurrency(formData.consumo_reais),
                iluminacao_publica: parseCurrency(formData.iluminacao_publica),
                tarifa_minima: parseCurrency(formData.tarifa_minima),
                outros_lancamentos: parseCurrency(formData.outros_lancamentos),
                valor_a_pagar: parseCurrency(formData.valor_a_pagar),
                economia_reais: parseCurrency(formData.economia_reais),
                status: formData.status
            };

            if (!payload.uc_id) throw new Error('Selecione uma Unidade Consumidora.');

            // Duplicate Check (Only for new invoices and if no action has been decided)
            if (!invoice?.id && !action) {
                const { data: existing } = await supabase
                    .from('invoices')
                    .select('id, vencimento')
                    .eq('uc_id', payload.uc_id)
                    .eq('mes_referencia', payload.mes_referencia)
                    .neq('status', 'cancelado');

                if (existing && existing.length > 0) {
                    const exactMatch = existing.find(ex => ex.vencimento === payload.vencimento);
                    if (exactMatch) {
                        setDuplicateInfo({ existing: exactMatch, type: 'block' });
                        setShowDuplicateModal(true);
                        setLoading(false);
                        return;
                    } else {
                        setDuplicateInfo({ existing: existing[0], type: 'ask' });
                        setShowDuplicateModal(true);
                        setLoading(false);
                        return;
                    }
                }
            }

            let result;
            if (invoice?.id || action === 'update') {
                const targetId = invoice?.id || duplicateInfo?.existing?.id;
                result = await supabase.from('invoices').update(payload).eq('id', targetId).select().single();

                // Sincronizar com Asaas se já houver cobrança emitida
                if (!result.error && result.data?.asaas_payment_id) {
                    try {
                        await updateAsaasCharge(targetId, payload.valor_a_pagar, payload.vencimento);
                    } catch (syncError) {
                        console.error('Erro ao sincronizar com Asaas:', syncError);
                        // Opcional: Avisar o usuário que salvou local mas falhou no Asaas
                        showAlert('Fatura salva localmente, mas houve um erro ao atualizar no Asaas: ' + syncError.message, 'warning');
                        onSave();
                        onClose();
                        return;
                    }
                }
            } else {
                result = await supabase.from('invoices').insert(payload).select().single();
            }

            if (result.error) throw result.error;
            showAlert('Fatura salva com sucesso!', 'success');
            onSave();
            onClose();
        } catch (error) {
            showAlert('Erro ao salvar fatura: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
            <div style={{ background: '#f8fafc', borderRadius: '12px', width: '95%', maxWidth: '800px', maxHeight: '95vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>

                {/* Header */}
                <div style={{ padding: '1.5rem', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: '12px', borderTopRightRadius: '12px' }}>
                    <div>
                        <h3 style={{ fontSize: '1.25rem', color: '#1e293b', fontWeight: 'bold' }}>{invoice ? 'Editar Fatura' : 'Nova Fatura'}</h3>
                        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Preencha os dados de consumo e valores</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>

                    {/* UC Selection */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Trocar Unidade Consumidora</label>
                        <select
                            required
                            value={formData.uc_id}
                            onChange={e => setFormData({ ...formData, uc_id: e.target.value })}
                            disabled={!!invoice}
                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', background: 'white' }}
                        >
                            <option value="">Selecione a UC...</option>
                            {ucs && ucs.map(uc => (
                                <option key={uc.id} value={uc.id}>{uc.numero_uc} - {uc.titular_conta}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                        {/* Month/Year */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Mês Referência</label>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <select value={formData.mes_referencia.split('-')[1]} onChange={e => handleMonthChange('month', e.target.value)} style={{ flex: 1, padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                                    {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => <option key={m} value={m}>{['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i]}</option>)}
                                </select>
                                <select value={formData.mes_referencia.split('-')[0]} onChange={e => handleMonthChange('year', e.target.value)} style={{ width: '80px', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                        </div>
                        {/* Due Date */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Vencimento</label>
                            <input type="date" required value={formData.vencimento} onChange={e => setFormData({ ...formData, vencimento: e.target.value })} style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        {/* Status */}
                        {canManageStatus && (
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Status</label>
                                <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                                    <option value="a_vencer">A Vencer</option>
                                    <option value="pago">Pago</option>
                                    <option value="atrasado">Atrasado</option>
                                </select>
                            </div>
                        )}
                    </div>

                    <div style={{ height: '1px', background: '#e2e8f0', margin: '1rem 0' }}></div>

                    {/* Data Entry Section */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>

                        {/* Left Column: Inputs */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <h4 style={{ color: '#334155', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Zap size={18} /> Dados de Consumo</h4>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Consumo (kWh)</label>
                                <input type="number" step="any" required value={formData.consumo_kwh} onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })} placeholder="0" style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Consumo Compensado (kWh)</label>
                                <input type="number" readOnly value={formData.consumo_compensado} style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', color: '#64748b' }} />
                            </div>

                            <h4 style={{ color: '#334155', fontWeight: 'bold', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><DollarSign size={18} /> Valores de energia e Adicionais</h4>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Iluminação Pública (R$)</label>
                                <input type="text" value={formData.iluminacao_publica} onChange={e => handleCurrencyChange('iluminacao_publica', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Energia Compensada (R$)</label>
                                <input type="text" readOnly value={formData.energia_compensada_reais} style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', color: '#0f172a', fontWeight: 600 }} />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Tarifa Mínima (R$)</label>
                                <input type="text" readOnly value={formData.tarifa_minima} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc' }} />
                                <p style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.2rem' }}>Calculado automaticamente (30/50/100 kWh)</p>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Outros Lançamentos (R$)</label>
                                <input type="text" value={formData.outros_lancamentos} onChange={e => handleCurrencyChange('outros_lancamentos', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                            </div>

                            {invoice?.id && !invoice.asaas_boleto_url && (
                                <div style={{ marginTop: '0.5rem' }}>
                                    <button
                                        type="button"
                                        onClick={() => handleEmission()}
                                        disabled={generating}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.5rem',
                                            background: '#fff7ed',
                                            color: '#c2410c',
                                            border: '1px solid #ffedd5',
                                            padding: '0.8rem 1rem',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontWeight: 'bold',
                                            fontSize: '0.9rem',
                                            width: '100%',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={e => { e.currentTarget.style.background = '#ffedd5'; }}
                                        onMouseOut={e => { e.currentTarget.style.background = '#fff7ed'; }}
                                    >
                                        {generating ? 'Gerando...' : <><CreditCard size={18} /> Emitir Boleto Agora</>}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Right Column: Calculated Results */}
                        <div style={{ background: '#f1f5f9', padding: '1.5rem', borderRadius: '8px', border: '1px solid #e2e8f0', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                            <h4 style={{ color: '#334155', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Calculator size={18} /> Detalhamento da Fatura</h4>

                            {selectedUc && (
                                <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', border: '1px solid #334155' }}>
                                    <div style={{ gridColumn: '1 / -1', borderBottom: '1px solid #334155', paddingBottom: '0.5rem', marginBottom: '0.2rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Assinante</label>
                                        <span style={{ fontWeight: 'bold', color: '#f8fafc', fontSize: '0.95rem' }}>{selectedUc.subscribers?.name || selectedUc.titular_fatura?.name || 'Não Inf.'}</span>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Número da UC</label>
                                        <span style={{ fontWeight: 600, color: '#cbd5e1', fontSize: '0.85rem' }}>{selectedUc.numero_uc}</span>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Identificação</label>
                                        <span style={{ fontWeight: 600, color: '#cbd5e1', fontSize: '0.85rem' }}>{selectedUc.titular_conta}</span>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Mês Referência</label>
                                        <span style={{ fontWeight: 600, color: '#cbd5e1', fontSize: '0.85rem' }}>
                                            {(() => {
                                                const [y, m] = formData.mes_referencia.split('-');
                                                const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                                                return `${months[parseInt(m) - 1]}/${y}`;
                                            })()}
                                        </span>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Vencimento</label>
                                        <span style={{ fontWeight: 'bold', color: '#fb7185', fontSize: '0.85rem' }}>
                                            {formData.vencimento ? new Date(formData.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}
                                        </span>
                                    </div>
                                    <div style={{ gridColumn: '1 / -1', marginTop: '0.2rem', paddingTop: '0.5rem', borderTop: '1px solid #334155' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>Tipo de Ligação</span>
                                            <span style={{ background: '#334155', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', color: '#f8fafc', textTransform: 'capitalize' }}>{selectedUc.tipo_ligacao}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: '#64748b' }}>Consumo Compensado ({formData.consumo_compensado} kWh):</span>
                                    <span style={{ fontWeight: 600 }}>R$ {(Number(formData.consumo_compensado) * (Number(selectedUc?.tarifa_concessionaria) || 0)).toFixed(2).replace('.', ',')}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginTop: '-0.4rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem' }}>
                                    <span>Valor da Tarifa:</span>
                                    <span>R$ {Number(selectedUc?.tarifa_concessionaria || 0).toFixed(4).replace('.', ',')}</span>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', background: '#dcfce7', padding: '0.6rem', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#166534' }}>
                                        <span style={{ fontWeight: 600 }}>Economia Gerada:</span>
                                        <span style={{ fontWeight: 'bold' }}>- {formData.economia_reais || 'R$ 0,00'}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#15803d' }}>
                                        <span>Desconto Aplicado:</span>
                                        <span>{selectedUc?.desconto_assinante || 0}%</span>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                                    <span style={{ color: '#64748b', fontWeight: 600 }}>Energia Compensada Líquida:</span>
                                    <span style={{ fontWeight: 'bold', color: '#0f172a' }}>{formData.energia_compensada_reais || 'R$ 0,00'}</span>
                                </div>

                                <div style={{ height: '1px', background: '#cbd5e1', margin: '0.5rem 0' }}></div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: '#64748b' }}>+ Iluminação Pública:</span>
                                    <span>{formData.iluminacao_publica || 'R$ 0,00'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: '#64748b' }}>+ Tarifa Mínima:</span>
                                    <span>{formData.tarifa_minima || 'R$ 0,00'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: '#64748b' }}>+ Outros Lançamentos:</span>
                                    <span>{formData.outros_lancamentos || 'R$ 0,00'}</span>
                                </div>

                                <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
                                    <div style={{
                                        marginLeft: 'auto',
                                        width: 'fit-content',
                                        padding: '1rem',
                                        background: '#f0fdf4',
                                        border: '2px solid #22c55e',
                                        borderRadius: '12px',
                                        textAlign: 'right'
                                    }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', color: '#166534', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Total a Pagar</label>
                                        <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#14532d' }}>
                                            {formData.valor_a_pagar || 'R$ 0,00'}
                                        </div>
                                    </div>
                                </div>

                                {invoice?.asaas_boleto_url && (
                                    <div style={{ marginTop: '1rem', padding: '0.8rem', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'center' }}>
                                        <a href={invoice.asaas_boleto_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#166534', fontWeight: 'bold', textDecoration: 'none', fontSize: '0.9rem' }}>
                                            <FileText size={18} /> Ver Boleto Emitido
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e2e8f0' }}>
                        <div>
                            {invoice?.id && invoice.status !== 'cancelado' && canManageStatus && (
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    disabled={loading}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                        background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca',
                                        padding: '0.6rem 1rem', borderRadius: '6px', cursor: 'pointer',
                                        fontWeight: 'bold', fontSize: '0.9rem', marginLeft: invoice.asaas_boleto_url ? '1rem' : 0,
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={e => { e.currentTarget.style.background = '#fecaca'; }}
                                    onMouseOut={e => { e.currentTarget.style.background = '#fee2e2'; }}
                                >
                                    <Ban size={18} /> Cancelar Fatura
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={onClose} style={{ padding: '0.8rem 1.5rem', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', color: '#475569', fontWeight: 600 }}>Cancelar</button>
                            <button type="submit" disabled={loading} style={{ padding: '0.8rem 2rem', background: 'var(--color-blue)', color: 'white', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}>
                                {loading ? 'Salvando...' : 'Salvar Fatura'}
                            </button>
                        </div>
                    </div>

                </form>
            </div>

            {/* Duplicate Safety Modal */}
            {showDuplicateModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, backdropFilter: 'blur(8px)' }}>
                    <div style={{ background: 'white', borderRadius: '24px', padding: '2rem', width: '90%', maxWidth: '450px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', textAlign: 'center' }}>
                        <div style={{ background: '#fff7ed', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: '#f97316' }}>
                            <AlertCircle size={32} />
                        </div>

                        <h3 style={{ fontSize: '1.4rem', color: '#1e293b', fontWeight: 'bold', marginBottom: '1rem' }}>
                            {duplicateInfo?.type === 'block' ? 'Fatura Já Existente' : 'Fatura Detectada'}
                        </h3>

                        <p style={{ color: '#64748b', marginBottom: '2rem', lineHeight: '1.5' }}>
                            {duplicateInfo?.type === 'block'
                                ? `Já existe uma fatura emitida para esta UC com mês de referência ${formData.mes_referencia} e vencimento em ${new Date(duplicateInfo.existing.vencimento).toLocaleDateString('pt-BR')}.`
                                : `Já existe uma fatura para o mês de referência ${formData.mes_referencia}, porém com uma data de vencimento diferente. O que deseja fazer?`
                            }
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                            {duplicateInfo?.type === 'block' ? (
                                <button
                                    onClick={() => setShowDuplicateModal(false)}
                                    style={{ padding: '1rem', background: '#f1f5f9', color: '#475569', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                                >
                                    Entendido
                                </button>
                            ) : (
                                <>
                                    <button
                                        onClick={() => { setShowDuplicateModal(false); handleSubmit(null, 'new'); }}
                                        style={{ padding: '1rem', background: 'var(--color-blue)', color: 'white', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        Emitir Nova Fatura
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowDuplicateModal(false);
                                            handleSubmit(null, 'update');
                                        }}
                                        style={{ padding: '1rem', background: '#fff7ed', color: '#c2410c', borderRadius: '12px', border: '1px solid #ffedd5', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        Ajustar Data de Vencimento
                                    </button>
                                    <button
                                        onClick={() => setShowDuplicateModal(false)}
                                        style={{ padding: '1rem', background: 'white', color: '#64748b', borderRadius: '12px', border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: '600' }}
                                    >
                                        Cancelar
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
