import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function BillingModal({ billing, onClose, onSave }) {
    const [usinas, setUsinas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [reconciling, setReconciling] = useState(false);

    // Initial state with string values for currency fields to handle formatting
    const [formData, setFormData] = useState({
        usina_id: '',
        status: 'em_producao',
        mes_referencia: new Date().toISOString().substring(0, 7), // YYYY-MM
        fechamento: new Date().toISOString().substring(0, 10), // YYYY-MM-DD
        geracao_mensal_kwh: '',
        energia_compensada: '', // New field (kWh)
        faturamento_mensal: '', // String "R$ ..."
        faturas_pagas: '',
        custo_disponibilidade: '',
        manutencao: '',
        gestao_reais: '',
        arrendamento: '',
        servicos: '',
        total_despesas: '',
        saldo_receber: ''
    });

    const [managementPercent, setManagementPercent] = useState(0);

    const statusOptions = ['em_producao', 'fechado', 'liquidado'];

    // Helper: Format number to BRL string
    const formatCurrency = (val) => {
        if (!val && val !== 0) return '';
        const number = Number(val);
        if (isNaN(number)) return '';
        return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    // Helper: Parse BRL string to number
    const parseCurrency = (str) => {
        if (!str || typeof str !== 'string') return 0;
        // Keep digits only, then divide by 100
        const digits = str.replace(/\D/g, '');
        return Number(digits) / 100;
    };

    // Helper for Input Change Handling (Applies Mask)
    const handleCurrencyChange = (field, value) => {
        const digits = value.replace(/\D/g, '');
        const number = Number(digits) / 100;
        const formatted = number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        setFormData(prev => ({ ...prev, [field]: formatted }));
    };

    useEffect(() => {
        fetchUsinas();
        if (billing) {
            setFormData({
                usina_id: billing.usina_id,
                status: billing.status || 'em_producao',
                mes_referencia: billing.mes_referencia ? billing.mes_referencia.substring(0, 7) : '',
                fechamento: billing.fechamento || '',
                geracao_mensal_kwh: billing.geracao_mensal_kwh || '',
                energia_compensada: billing.energia_compensada || '',
                faturamento_mensal: formatCurrency(billing.faturamento_mensal),
                faturas_pagas: formatCurrency(billing.faturas_pagas),
                custo_disponibilidade: formatCurrency(billing.custo_disponibilidade),
                manutencao: formatCurrency(billing.manutencao),
                gestao_reais: formatCurrency(billing.gestao_reais),
                arrendamento: formatCurrency(billing.arrendamento),
                servicos: formatCurrency(billing.servicos),
                total_despesas: formatCurrency(billing.total_despesas),
                saldo_receber: formatCurrency(billing.saldo_receber)
            });
            fetchUsinaDetails(billing.usina_id);
        }
    }, [billing]);

    // Recalculate totals whenever dependent fields change
    useEffect(() => {
        calculateTotals();
    }, [
        formData.faturas_pagas,
        formData.custo_disponibilidade,
        formData.manutencao,
        formData.arrendamento,
        formData.servicos,
        managementPercent
    ]);

    const fetchUsinas = async () => {
        const { data } = await supabase.from('usinas').select('id, name');
        setUsinas(data || []);
    };

    const fetchUsinaDetails = async (id) => {
        if (!id) return;
        const { data } = await supabase.from('usinas').select('gestao_percentual').eq('id', id).single();
        if (data) setManagementPercent(Number(data.gestao_percentual) || 0);
    };

    const handleUsinaChange = async (e) => {
        const id = e.target.value;
        setFormData(prev => ({ ...prev, usina_id: id }));
        await fetchUsinaDetails(id);
    };

    const calculateTotals = () => {
        const paidInvoices = parseCurrency(formData.faturas_pagas);
        const custoDisp = parseCurrency(formData.custo_disponibilidade);
        const manutencao = parseCurrency(formData.manutencao);
        const arrendamento = parseCurrency(formData.arrendamento);
        const servicos = parseCurrency(formData.servicos);

        let gestao = 0;
        if (managementPercent > 0) {
            gestao = paidInvoices * (managementPercent / 100);
        }

        const totalExpenses = custoDisp + manutencao + gestao + arrendamento + servicos;
        const saldo = paidInvoices - totalExpenses;

        const currentGestao = parseCurrency(formData.gestao_reais);
        const currentTotal = parseCurrency(formData.total_despesas);
        const currentSaldo = parseCurrency(formData.saldo_receber);

        if (
            Math.abs(currentGestao - gestao) < 0.01 &&
            Math.abs(currentTotal - totalExpenses) < 0.01 &&
            Math.abs(currentSaldo - saldo) < 0.01
        ) return;

        setFormData(prev => ({
            ...prev,
            gestao_reais: formatCurrency(gestao),
            total_despesas: formatCurrency(totalExpenses),
            saldo_receber: formatCurrency(saldo)
        }));
    };

    const handleReconcile = async () => {
        if (!formData.usina_id || !formData.mes_referencia) {
            alert('Selecione uma Usina e um Mês de Referência.');
            return;
        }
        setReconciling(true);
        try {
            const { data: ucs, error: ucError } = await supabase.from('consumer_units').select('id').eq('usina_id', formData.usina_id);
            if (ucError) throw ucError;
            if (!ucs || ucs.length === 0) {
                alert('Nenhuma UC vinculada a esta usina.');
                setReconciling(false);
                return;
            }

            const ucIds = ucs.map(u => u.id);
            const [year, month] = formData.mes_referencia.split('-');
            const startDate = `${year}-${month}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endDate = `${year}-${month}-${lastDay}`;

            const { data: invoices, error: invError } = await supabase
                .from('invoices')
                .select('valor_a_pagar, status')
                .in('uc_id', ucIds)
                .gte('mes_referencia', startDate)
                .lte('mes_referencia', endDate);

            if (invError) throw invError;

            let totalBilled = 0;
            let totalPaid = 0;

            invoices.forEach(inv => {
                const val = Number(inv.valor_a_pagar) || 0;
                totalBilled += val;
                if (inv.status === 'pago') totalPaid += val;
            });

            setFormData(prev => ({
                ...prev,
                faturamento_mensal: formatCurrency(totalBilled),
                faturas_pagas: formatCurrency(totalPaid)
            }));

        } catch (err) {
            console.error('Reconciliation error:', err);
            alert('Erro ao buscar faturas: ' + err.message);
        } finally {
            setReconciling(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const payload = {
                usina_id: formData.usina_id,
                status: formData.status,
                mes_referencia: `${formData.mes_referencia}-01`,
                fechamento: formData.fechamento,
                geracao_mensal_kwh: Number(formData.geracao_mensal_kwh),
                energia_compensada: Number(formData.energia_compensada),
                faturamento_mensal: parseCurrency(formData.faturamento_mensal),
                faturas_pagas: parseCurrency(formData.faturas_pagas),
                custo_disponibilidade: parseCurrency(formData.custo_disponibilidade),
                manutencao: parseCurrency(formData.manutencao),
                gestao_reais: parseCurrency(formData.gestao_reais),
                arrendamento: parseCurrency(formData.arrendamento),
                servicos: parseCurrency(formData.servicos),
                total_despesas: parseCurrency(formData.total_despesas),
                saldo_receber: parseCurrency(formData.saldo_receber)
            };

            let result;
            if (billing?.id) {
                result = await supabase.from('generation_production').update(payload).eq('id', billing.id);
            } else {
                result = await supabase.from('generation_production').insert(payload);
            }

            if (result.error) throw result.error;
            onSave();
            onClose();

        } catch (error) {
            console.error('Save error:', error);
            alert('Erro ao salvar: ' + (error.message || JSON.stringify(error)));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
            <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '90%', maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto' }}>
                <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
                    {billing ? 'Editar Fechamento' : 'Novo Fechamento'}
                </h3>

                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

                    {/* Header */}
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem', background: '#f8fafc', padding: '1rem', borderRadius: '4px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.2rem' }}>Usina</label>
                            <select
                                required
                                value={formData.usina_id}
                                onChange={handleUsinaChange}
                                style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
                            >
                                <option value="">Selecione...</option>
                                {usinas.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                        </div>
                        <div style={{ width: '220px', display: 'flex', gap: '0.5rem' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.2rem' }}>Mês Ref.</label>
                                <select
                                    value={formData.mes_referencia.split('-')[1]}
                                    onChange={e => {
                                        const year = formData.mes_referencia.split('-')[0];
                                        setFormData({ ...formData, mes_referencia: `${year}-${e.target.value}` });
                                    }}
                                    style={{ width: '100%', padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px' }}
                                >
                                    {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => (
                                        <option key={m} value={m}>{['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][i]}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ width: '80px' }}>
                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.2rem' }}>Ano</label>
                                <select
                                    value={formData.mes_referencia.split('-')[0]}
                                    onChange={e => {
                                        const month = formData.mes_referencia.split('-')[1];
                                        setFormData({ ...formData, mes_referencia: `${e.target.value}-${month}` });
                                    }}
                                    style={{ width: '100%', padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px' }}
                                >
                                    {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                                        <option key={y} value={y}>{y}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div style={{ width: '150px' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.2rem' }}>Data Fechamento</label>
                            <input type="date" required value={formData.fechamento} onChange={e => setFormData({ ...formData, fechamento: e.target.value })} style={{ width: '100%', padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px' }} />
                        </div>
                        <div style={{ width: '120px' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.2rem' }}>Status</label>
                            <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}>
                                {statusOptions.map(o => <option key={o} value={o}>{o.replace('_', ' ').toUpperCase()}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={handleReconcile} disabled={reconciling || !formData.usina_id}
                                style={{ padding: '0.5rem 1rem', background: 'var(--color-blue)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', opacity: reconciling ? 0.7 : 1 }}
                            >
                                {reconciling ? 'Buscando...' : 'Buscar Faturas'}
                            </button>
                        </div>
                    </div>

                    {/* Section: Generation */}
                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Produção e Receita</div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem' }}>Geração Mensal (kWh)</label>
                        <input type="number" required value={formData.geracao_mensal_kwh} onChange={e => setFormData({ ...formData, geracao_mensal_kwh: e.target.value })} style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }} />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem' }}>Energia Compensada (kWh)</label>
                        <input type="number" value={formData.energia_compensada} onChange={e => setFormData({ ...formData, energia_compensada: e.target.value })} style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }} />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem' }}>Faturamento Mensal (R$ Total)</label>
                        <input type="text" value={formData.faturamento_mensal} onChange={e => handleCurrencyChange('faturamento_mensal', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }} />
                    </div>

                    <div style={{ gridColumn: '1 / -1', background: '#ecfdf5', padding: '1rem', borderRadius: '4px', border: '1px solid #d1fae5' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', color: '#047857', fontWeight: 'bold' }}>Faturas Pagas (Base de Cálculo) - R$</label>
                        <input type="text" value={formData.faturas_pagas} onChange={e => handleCurrencyChange('faturas_pagas', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.5rem', border: '1px solid #10b981', borderRadius: '4px', fontSize: '1.2rem', fontWeight: 'bold', color: '#047857' }} />
                        <span style={{ fontSize: '0.8rem', color: '#059669' }}>Valor efetivamente recebido dos assinantes.</span>
                    </div>

                    {/* Section: Expenses */}
                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Despesas Operacionais</div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem' }}>Custo Disp. (R$)</label>
                        <input type="text" value={formData.custo_disponibilidade} onChange={e => handleCurrencyChange('custo_disponibilidade', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem' }}>Manutenção (R$)</label>
                        <input type="text" value={formData.manutencao} onChange={e => handleCurrencyChange('manutencao', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem' }}>Arrendamento (R$)</label>
                        <input type="text" value={formData.arrendamento} onChange={e => handleCurrencyChange('arrendamento', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem' }}>Serviços (R$)</label>
                        <input type="text" value={formData.servicos} onChange={e => handleCurrencyChange('servicos', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }} />
                    </div>

                    <div style={{ gridColumn: '1 / -1', background: '#fef3c7', padding: '1rem', borderRadius: '4px', marginTop: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', border: '1px solid #fcd34d' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', color: '#b45309' }}>Taxa de Gestão ({managementPercent}%)</label>
                            <input disabled value={formData.gestao_reais} style={{ width: '100%', padding: '0.5rem', border: '1px solid #fbbf24', borderRadius: '4px', background: 'white' }} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', color: '#b45309', fontWeight: 'bold' }}>Total Despesas</label>
                            <input disabled value={formData.total_despesas} style={{ width: '100%', padding: '0.5rem', border: '1px solid #fbbf24', borderRadius: '4px', background: 'white', fontWeight: 'bold' }} />
                        </div>
                    </div>

                    {/* Section: Result */}
                    <div style={{ gridColumn: '1 / -1', background: '#eff6ff', padding: '1.5rem', borderRadius: '4px', border: '1px solid #bfdbfe', marginTop: '1rem', textAlign: 'center' }}>
                        <label style={{ display: 'block', fontSize: '1rem', color: '#1e40af', marginBottom: '0.5rem' }}>Saldo Líquido a Receber</label>
                        <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1e3a8a' }}>
                            {formData.saldo_receber}
                        </div>
                        <span style={{ fontSize: '0.8rem', color: '#60a5fa' }}>Faturas Pagas - Total Despesas</span>
                    </div>


                    <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                        <button type="button" onClick={onClose} style={{ padding: '0.8rem 1.5rem', background: '#ccc', borderRadius: '4px', border: 'none', cursor: 'pointer' }}>Cancelar</button>
                        <button type="submit" disabled={loading} style={{ padding: '0.8rem 1.5rem', background: 'var(--color-blue)', color: 'white', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                            {loading ? 'Salvando...' : 'Confirmar Fechamento'}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
