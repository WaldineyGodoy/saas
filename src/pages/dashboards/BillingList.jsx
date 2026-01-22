import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import BillingModal from '../../components/BillingModal';

export default function BillingList() {
    const [billings, setBillings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('kanban');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedBilling, setSelectedBilling] = useState(null);

    useEffect(() => {
        fetchBillings();
    }, []);

    const fetchBillings = async () => {
        setLoading(true);
        // Join with usinas to get the name
        const { data, error } = await supabase
            .from('generation_production')
            .select(`
                *,
                usinas ( name )
            `)
            .order('mes_referencia', { ascending: false });

        if (error) console.error('Error fetching billing:', error);
        else setBillings(data || []);

        setLoading(false);
    };

    const handleEdit = (billing) => {
        setSelectedBilling(billing);
        setIsModalOpen(true);
    };

    const handleCreate = () => {
        setSelectedBilling(null);
        setIsModalOpen(true);
    };

    const handleDelete = async (id) => {
        if (!confirm('Tem certeza que deseja excluir este fechamento?')) return;
        const { error } = await supabase.from('generation_production').delete().eq('id', id);
        if (error) alert('Erro ao excluir');
        else fetchBillings();
    };

    const handlePay = async (billing) => {
        // Only admin/superadmin - check profile elsewhere or rely on Edge Function auth check (it will fail if not authorized)
        // Check if supplier has pix key
        // We need to fetch supplier/pix details. Billing (generation_production) -> usinas -> supplier (or similar)
        // Billing has usinas relation. usinas has supplier_id ??
        // Let's check generation_production select.

        if (!billing.saldo_receber || billing.saldo_receber <= 0) {
            alert('Saldo a receber deve ser maior que zero.');
            return;
        }

        if (!confirm(`Deseja enviar R$ ${billing.saldo_receber} via Pix para esta usina/fornecedor?`)) return;

        setLoading(true);
        try {
            // Need to get supplier pix info.
            // fetching billing with usinas(param). 
            // We need to fetch the supplier associated with the usina.
            // 'usinas ( name, supplier:suppliers ( pix_key, pix_key_type, name ) )'

            const { data: usinaData, error: usinaError } = await supabase
                .from('usinas')
                .select('supplier:suppliers ( pix_key, pix_key_type, name )')
                .eq('id', billing.usina_id)
                .single();

            if (usinaError || !usinaData || !usinaData.supplier) throw new Error('Fornecedor/Pix não encontrado para esta usina.');

            const supplier = usinaData.supplier;
            if (!supplier.pix_key) throw new Error('Fornecedor sem Chave Pix cadastrada.');

            const { data, error } = await supabase.functions.invoke('transfer-asaas-pix', {
                body: {
                    value: billing.saldo_receber,
                    pix_key: supplier.pix_key,
                    pix_key_type: supplier.pix_key_type,
                    description: `Pagamento Energia - ${billing.mes_referencia} - ${usinaData.name}`,
                    operationType: 'PIX'
                }
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error || 'Erro desconhecido na transferência');

            alert('Pagamento enviado com sucesso! ID: ' + data.data?.id);
            fetchBillings(); // Update status if changed (Edge Function could update, or we do here)
            // Ideally we mark as PAID here?
            await supabase.from('generation_production').update({ status: 'liquidado' }).eq('id', billing.id);
            fetchBillings();

        } catch (error) {
            console.error('Payment Error:', error);
            alert('Erro no pagamento: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = () => {
        fetchBillings();
        setIsModalOpen(false);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const [year, month] = dateStr.split('-');
        const months = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        const monthIndex = parseInt(month, 10) - 1;
        const monthName = months[monthIndex] || '-';
        return `${monthName} ${year}`;
    };

    const formatCurrency = (val) => {
        return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    return (
        <div style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ color: 'var(--color-blue)', fontSize: '1.5rem', fontWeight: 'bold' }}>Fechamento Mensal</h2>
                <button
                    onClick={handleCreate}
                    style={{ background: 'var(--color-orange)', color: 'white', padding: '0.8rem 1.5rem', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                >
                    Novo Fechamento
                </button>
            </div>

            {/* Controls Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div className="btn-group" style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <button
                        onClick={() => setViewMode('list')}
                        className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ borderRadius: 0, border: 'none' }}
                    >
                        Lista
                    </button>
                    <button
                        onClick={() => setViewMode('kanban')}
                        className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ borderRadius: 0, border: 'none' }}
                    >
                        Kanban
                    </button>
                </div>
            </div>

            {loading ? <p>Carregando...</p> : (
                <>
                    {viewMode === 'list' ? (
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Mês Ref.</th>
                                            <th>Usina</th>
                                            <th>Status</th>
                                            <th>Geração (kWh)</th>
                                            <th>Compensado (kWh)</th>
                                            <th>Faturado (R$)</th>
                                            <th>Saldo a Receber (R$)</th>
                                            <th>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {billings.map(b => (
                                            <tr key={b.id}>
                                                <td>{formatDate(b.mes_referencia)}</td>
                                                <td>{b.usinas?.name || '-'}</td>
                                                <td>
                                                    <span className="badge" style={{
                                                        background: b.status === 'liquidado' ? '#dcfce7' : b.status === 'fechado' ? '#e0f2fe' : '#fef9c3',
                                                        color: b.status === 'liquidado' ? '#166534' : b.status === 'fechado' ? '#0369a1' : '#854d0e'
                                                    }}>
                                                        {b.status}
                                                    </span>
                                                </td>
                                                <td>{Number(b.geracao_mensal_kwh).toLocaleString('pt-BR')} kWh</td>
                                                <td>{Number(b.energia_compensada || 0).toLocaleString('pt-BR')} kWh</td>
                                                <td>{formatCurrency(b.faturamento_mensal)}</td>
                                                <td style={{ fontWeight: 'bold', color: 'var(--color-blue)' }}>{formatCurrency(b.saldo_receber)}</td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button onClick={() => handleEdit(b)} className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Editar</button>
                                                        <button onClick={() => handleDelete(b.id)} className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}>Excluir</button>
                                                        <button onClick={() => handlePay(b)} className="btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: '#059669', borderColor: '#d1fae5', background: '#ecfdf5', fontWeight: 'bold' }}>
                                                            💲 Pagar
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                            {['aberto', 'fechado', 'liquidado'].map(status => {
                                const billingsInStatus = billings.filter(b => b.status === status);
                                const statusColors = {
                                    aberto: '#eab308',
                                    fechado: '#0ea5e9',
                                    liquidado: '#22c55e'
                                };
                                const color = statusColors[status] || '#64748b';

                                return (
                                    <div key={status} style={{ minWidth: '320px', flex: 1, background: 'var(--color-bg-light)', borderRadius: 'var(--radius-md)', padding: '0.5rem', borderTop: `4px solid ${color}`, boxShadow: 'var(--shadow-sm)' }}>
                                        <h4 style={{
                                            padding: '0.8rem', borderBottom: '1px solid var(--color-border)', background: 'white', borderRadius: 'var(--radius-sm)',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem',
                                            color: color
                                        }}>
                                            <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>
                                                {status}
                                            </span>
                                            <span style={{ fontSize: '0.8rem', background: color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                                                {formatCurrency(billingsInStatus.reduce((acc, curr) => acc + (Number(curr.saldo_receber) || 0), 0))}
                                            </span>
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {billingsInStatus.map(b => (
                                                <div
                                                    key={b.id}
                                                    onClick={() => handleEdit(b)}
                                                    style={{
                                                        background: 'white', padding: '1rem', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)',
                                                        cursor: 'pointer', border: '1px solid transparent', transition: '0.2s'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-blue)'}
                                                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                        <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)' }}>{b.usinas?.name}</span>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-medium)' }}>
                                                            {formatDate(b.mes_referencia)}
                                                        </span>
                                                    </div>

                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-medium)', marginBottom: '0.8rem' }}>
                                                        <div>
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>Geração</div>
                                                            <div>{Number(b.geracao_mensal_kwh).toLocaleString('pt-BR')} kWh</div>
                                                        </div>
                                                        <div>
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>Saldo</div>
                                                            <div style={{ fontWeight: 'bold', color: 'var(--color-blue)' }}>{formatCurrency(b.saldo_receber)}</div>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                                        {b.status !== 'liquidado' && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handlePay(b); }}
                                                                className="btn"
                                                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: '#059669', borderColor: '#d1fae5', background: '#ecfdf5', fontWeight: 'bold' }}
                                                            >
                                                                💲 Pagar
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {isModalOpen && (
                <BillingModal
                    billing={selectedBilling}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                />
            )}
        </div>
    );
}
