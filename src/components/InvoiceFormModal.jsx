import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { createAsaasCharge } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { CreditCard, FileText } from 'lucide-react';

export default function InvoiceFormModal({ invoice, ucs, onClose, onSave }) {
    const { profile } = useAuth();
    const canManageStatus = ['super_admin', 'admin', 'manager'].includes(profile?.role);

    // Helpers for Currency
    const formatCurrency = (val) => {
        if (!val && val !== 0) return '';
        const number = Number(val);
        if (isNaN(number)) return '';
        return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const parseCurrency = (str) => {
        if (!str || typeof str !== 'string') return 0;
        const digits = str.replace(/\D/g, '');
        return Number(digits) / 100;
    };

    const [formData, setFormData] = useState({
        uc_id: '',
        mes_referencia: new Date().toISOString().substring(0, 7), // YYYY-MM
        vencimento: '',
        consumo_kwh: '',
        valor_a_pagar: '', // String like "R$ 100,00"
        economia_reais: '', // String like "R$ 50,00"
        status: 'a_vencer'
    });

    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        if (invoice) {
            setFormData({
                uc_id: invoice.uc_id,
                mes_referencia: invoice.mes_referencia ? invoice.mes_referencia.substring(0, 7) : '',
                vencimento: invoice.vencimento ? invoice.vencimento.split('T')[0] : '',
                consumo_kwh: invoice.consumo_kwh,
                valor_a_pagar: formatCurrency(invoice.valor_a_pagar),
                economia_reais: formatCurrency(invoice.economia_reais),
                status: invoice.status
            });
        } else if (ucs && ucs.length > 0) {
            // Default to first UC only if creating new
            setFormData(prev => ({ ...prev, uc_id: ucs[0].id }));
        }
    }, [invoice, ucs]);

    // Handle Masked Input Change
    const handleCurrencyChange = (field, value) => {
        const digits = value.replace(/\D/g, '');
        const number = Number(digits) / 100;
        const formatted = number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        setFormData(prev => ({ ...prev, [field]: formatted }));
    };

    // Handle Month/Year Change
    const handleMonthChange = (part, value) => {
        const currentParts = formData.mes_referencia.split('-');
        let year = currentParts[0] || new Date().getFullYear();
        let month = currentParts[1] || '01';

        if (part === 'month') month = value;
        if (part === 'year') year = value;

        setFormData(prev => ({ ...prev, mes_referencia: `${year}-${month}` }));
    };

    const handleEmission = async () => {
        if (!invoice?.id) {
            alert('Salve a fatura antes de emitir o boleto.');
            return;
        }
        if (!confirm('Gerar boleto Asaas agora?')) return;

        setGenerating(true);
        try {
            const result = await createAsaasCharge(invoice.id);
            if (result.url) {
                alert('Boleto gerado com sucesso!');
                window.open(result.url, '_blank');
                onSave(); // Refetch parent
                onClose(); // Close modal? Or stay? Let's close for now or just update UI if we had state
            }
        } catch (error) {
            console.error(error);
            alert('Erro ao gerar boleto: ' + error.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const dataToSave = {
                uc_id: formData.uc_id,
                mes_referencia: `${formData.mes_referencia}-01`, // Save as first day
                vencimento: formData.vencimento, // YYYY-MM-DD
                consumo_kwh: Number(formData.consumo_kwh),
                valor_a_pagar: parseCurrency(formData.valor_a_pagar),
                economia_reais: parseCurrency(formData.economia_reais),
                status: formData.status
            };

            if (!dataToSave.uc_id) throw new Error('Selecione uma Unidade Consumidora (UC).');

            let result;
            if (invoice?.id) {
                result = await supabase.from('invoices').update(dataToSave).eq('id', invoice.id).select().single();
            } else {
                result = await supabase.from('invoices').insert(dataToSave).select().single();
            }

            if (result.error) throw result.error;
            onSave();
            onClose();
        } catch (error) {
            alert('Erro ao salvar fatura: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '90%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
                    {invoice ? 'Editar Fatura' : 'Nova Fatura'}
                </h3>

                <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
                    {/* ... fields ... */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Unidade Consumidora</label>
                        <select
                            required
                            value={formData.uc_id}
                            onChange={e => setFormData({ ...formData, uc_id: e.target.value })}
                            disabled={!!invoice}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            <option value="">Selecione a UC...</option>
                            {ucs && ucs.map(uc => (
                                <option key={uc.id} value={uc.id}>
                                    {uc.numero_uc} - {uc.titular_conta} ({uc.concessionaria})
                                </option>
                            ))}
                        </select>
                        {(!ucs || ucs.length === 0) && <p style={{ color: 'red', fontSize: '0.8rem' }}>Nenhuma UC ativa encontrada. Cadastre uma UC primeiro.</p>}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Mês Referência (Mês/Ano)</label>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <select
                                    value={formData.mes_referencia.split('-')[1]}
                                    onChange={e => handleMonthChange('month', e.target.value)}
                                    style={{ flex: 1, padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                                >
                                    {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => (
                                        <option key={m} value={m}>{['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][i]}</option>
                                    ))}
                                </select>
                                <select
                                    value={formData.mes_referencia.split('-')[0]}
                                    onChange={e => handleMonthChange('year', e.target.value)}
                                    style={{ width: '80px', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                                >
                                    {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Vencimento</label>
                            <input
                                type="date"
                                required
                                value={formData.vencimento}
                                onChange={e => setFormData({ ...formData, vencimento: e.target.value })}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Consumo (kWh)</label>
                            <input
                                type="number"
                                step="any"
                                required
                                value={formData.consumo_kwh}
                                onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Valor a Pagar (R$)</label>
                            <input
                                type="text"
                                required
                                value={formData.valor_a_pagar}
                                onChange={e => handleCurrencyChange('valor_a_pagar', e.target.value)}
                                placeholder="R$ 0,00"
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Economia Gerada (R$) <span style={{ color: '#888', fontWeight: 'normal' }}>(Opcional)</span></label>
                        <input
                            type="text"
                            value={formData.economia_reais}
                            onChange={e => handleCurrencyChange('economia_reais', e.target.value)}
                            placeholder="R$ 0,00"
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    {canManageStatus && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Status</label>
                            <select
                                value={formData.status}
                                onChange={e => setFormData({ ...formData, status: e.target.value })}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                            >
                                <option value="a_vencer">A Vencer</option>
                                <option value="pago">Pago</option>
                                <option value="atrasado">Atrasado</option>
                            </select>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
                        <div>
                            {invoice?.id && (
                                <>
                                    {invoice.asaas_boleto_url ? (
                                        <a
                                            href={invoice.asaas_boleto_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                textDecoration: 'none', color: '#166534', fontWeight: 'bold'
                                            }}
                                        >
                                            <FileText size={18} /> Ver Boleto
                                        </a>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleEmission}
                                            disabled={generating}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                background: '#fff7ed', color: '#c2410c', border: '1px solid #ffedd5',
                                                padding: '0.6rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                                            }}
                                        >
                                            {generating ? 'Gerando...' : <><CreditCard size={18} /> Emitir Boleto</>}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={onClose} style={{ padding: '0.8rem 1.5rem', background: '#ccc', borderRadius: '4px', border: 'none', cursor: 'pointer' }}>Cancelar</button>
                            <button type="submit" disabled={loading} style={{ padding: '0.8rem 1.5rem', background: 'var(--color-blue)', color: 'white', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                                {loading ? 'Salvando...' : 'Salvar Fatura'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
