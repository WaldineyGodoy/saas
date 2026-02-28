import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { createAsaasCharge } from '../../lib/api';
import InvoiceFormModal from '../../components/InvoiceFormModal';
import { Search, Filter, Plus, FileText, CheckCircle, AlertCircle, Clock, CreditCard, Trash2 } from 'lucide-react';

import { useUI } from '../../contexts/UIContext';

export default function InvoiceListManager() {
    const { showAlert, showConfirm } = useUI();
    const [invoices, setInvoices] = useState([]);
    const [ucs, setUcs] = useState([]); // List of UCs for the modal
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('kanban');
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [monthFilter, setMonthFilter] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
    const [statusFilter, setStatusFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [generatingId, setGeneratingId] = useState(null);

    const filteredInvoices = invoices.filter(inv => {
        // Status Filter
        if (statusFilter && inv.status !== statusFilter) return false;

        // Search Filter
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            const titular = inv.consumer_units?.titular_conta?.toLowerCase() || '';
            const assinante = inv.consumer_units?.subscribers?.name?.toLowerCase() || '';
            const uc = inv.consumer_units?.numero_uc?.toLowerCase() || '';

            if (!titular.includes(lower) && !assinante.includes(lower) && !uc.includes(lower)) {
                return false;
            }
        }
        return true;
    });

    useEffect(() => {
        fetchInvoices();
        fetchUcs();
    }, [monthFilter]); // Refetch when month changes

    const fetchInvoices = async () => {
        setLoading(true);
        try {
            // Filter by month using the first and last day
            const [year, month] = monthFilter.split('-');
            const startDate = `${year}-${month}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endDate = `${year}-${month}-${lastDay}`;

            const { data, error } = await supabase
                .from('invoices')
                .select(`
                    *,
                    consumer_units (
                        numero_uc,
                        titular_conta,
                        concessionaria,
                        subscribers!consumer_units_subscriber_id_fkey ( name )
                    )
                `)
                .gte('mes_referencia', startDate)
                .lte('mes_referencia', endDate)
                .order('vencimento', { ascending: true });

            if (error) throw error;
            setInvoices(data || []);
        } catch (error) {
            console.error('Error fetching invoices:', error);
            showAlert('Erro ao carregar faturas.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const fetchUcs = async () => {
        const { data, error } = await supabase
            .from('consumer_units')
            .select('id, numero_uc, concessionaria, titular_conta, tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento')
            .eq('status', 'ativo')
            .order('titular_conta');

        if (!error) setUcs(data || []);
    };

    const handleCreate = () => {
        setSelectedInvoice(null);
        setIsModalOpen(true);
    };

    const handleEdit = (inv) => {
        setSelectedInvoice(inv);
        setIsModalOpen(true);
    };

    const handleSave = () => {
        fetchInvoices(); // Refresh list
        setIsModalOpen(false);
    };

    const handleEmission = async (inv) => {
        const confirm = await showConfirm(`Gerar boleto Asaas para a fatura de ${inv.consumer_units?.titular_conta}?`);
        if (!confirm) return;

        setGeneratingId(inv.id);
        try {
            const result = await createAsaasCharge(inv.id);
            if (result.url) {
                showAlert('Boleto gerado com sucesso!', 'success');
                window.open(result.url, '_blank');
                fetchInvoices();
            }
        } catch (error) {
            console.error(error);
            showAlert('Erro ao gerar boleto: ' + error.message, 'error');
        } finally {
            setGeneratingId(null);
        }
    };

    const handleDelete = async (id) => {
        const confirm = await showConfirm('Tem certeza que deseja excluir esta fatura?');
        if (!confirm) return;

        try {
            const { error } = await supabase
                .from('invoices')
                .delete()
                .eq('id', id);

            if (error) throw error;
            fetchInvoices();
        } catch (error) {
            console.error('Erro ao excluir fatura:', error);
            showAlert('Erro ao excluir fatura: ' + error.message, 'error');
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
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', background: s.bg, color: s.color, borderRadius: '99px', fontSize: '0.8rem', width: 'fit-content' }}>
                <Icon size={12} /> {s.label}
            </span>
        );
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ color: 'var(--color-blue)', fontSize: '1.8rem', fontWeight: 'bold' }}>Faturas</h2>
                    <p style={{ color: '#64748b' }}>Gerencie os lançamentos mensais das Unidades Consumidoras</p>
                </div>
                <button
                    onClick={handleCreate}
                    style={{ background: 'var(--color-orange)', color: 'white', padding: '0.8rem 1.5rem', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <Plus size={18} /> Nova Fatura
                </button>
            </div>

            {/* Filters and Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ background: 'white', padding: '0.5rem 1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b' }}>
                        <Filter size={18} />
                        <span style={{ fontWeight: 'bold' }}>Mês:</span>
                    </div>
                    <input
                        type="month"
                        value={monthFilter}
                        onChange={e => setMonthFilter(e.target.value)}
                        style={{ padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '4px' }}
                    />

                    <div style={{ width: '1px', height: '20px', background: '#e2e8f0' }}></div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b' }}>
                        <span style={{ fontWeight: 'bold' }}>Status:</span>
                    </div>
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        style={{ padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '4px' }}
                    >
                        <option value="">Todos</option>
                        <option value="a_vencer">A Vencer</option>
                        <option value="atrasado">Atrasado</option>
                        <option value="pago">Pago</option>
                    </select>

                    <div style={{ width: '1px', height: '20px', background: '#e2e8f0' }}></div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b' }}>
                        <Search size={18} />
                    </div>
                    <input
                        placeholder="Buscar por Nome..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '4px', minWidth: '200px' }}
                    />
                </div>

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
                        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ background: '#f8fafc' }}>
                                    <tr>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Status</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Vencimento</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Unidade Consumidora</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Consumo</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Valor</th>
                                        <th style={{ padding: '1rem', textAlign: 'right', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredInvoices.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                                                Nenhuma fatura encontrada para este mês.
                                            </td>
                                        </tr>
                                    ) : filteredInvoices.map(inv => (
                                        <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '1rem' }}>{getStatusBadge(inv.status)}</td>
                                            <td style={{ padding: '1rem', color: '#334155' }}>
                                                {inv.vencimento ? new Date(inv.vencimento).toLocaleDateString('pt-BR') : '-'}
                                            </td>
                                            <td style={{ padding: '1rem' }}>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>{inv.consumer_units?.numero_uc || 'N/A'}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                    {inv.consumer_units?.titular_conta} ({inv.consumer_units?.concessionaria})
                                                </div>
                                            </td>
                                            <td style={{ padding: '1rem', color: '#334155' }}>
                                                {Number(inv.consumo_kwh).toLocaleString('pt-BR')} kWh
                                            </td>
                                            <td style={{ padding: '1rem', fontWeight: 'bold', color: '#0f172a' }}>
                                                {formatCurrency(inv.valor_a_pagar)}
                                            </td>
                                            <td style={{ padding: '1rem', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                    {inv.asaas_boleto_url ? (
                                                        <a
                                                            href={inv.asaas_boleto_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{
                                                                background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0',
                                                                padding: '0.4rem 0.8rem', borderRadius: '4px', textDecoration: 'none',
                                                                fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'
                                                            }}
                                                            title="Ver Boleto"
                                                        >
                                                            <FileText size={14} /> Boleto
                                                        </a>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleEmission(inv)}
                                                            disabled={generatingId === inv.id}
                                                            style={{
                                                                background: generatingId === inv.id ? '#f1f5f9' : '#fff7ed',
                                                                color: generatingId === inv.id ? '#94a3b8' : '#c2410c',
                                                                border: generatingId === inv.id ? '1px solid #cbd5e1' : '1px solid #ffedd5',
                                                                padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer',
                                                                fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'
                                                            }}
                                                        >
                                                            {generatingId === inv.id ? 'Gerando...' : <><CreditCard size={14} /> Emitir</>}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleEdit(inv)}
                                                        style={{ background: 'none', border: '1px solid #e2e8f0', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', color: '#475569', fontSize: '0.8rem' }}
                                                        title="Editar"
                                                    >
                                                        Editar
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(inv.id)}
                                                        style={{ background: '#fee2e2', border: '1px solid #fecaca', padding: '0.4rem', borderRadius: '4px', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}
                                                        title="Excluir"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                            {['a_vencer', 'atrasado', 'pago'].map(status => {
                                const invoicesInStatus = filteredInvoices.filter(inv => inv.status === status);
                                const statusMap = {
                                    'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago' },
                                    'a_vencer': { color: '#854d0e', bg: '#fef9c3', label: 'A Vencer' },
                                    'atrasado': { color: '#991b1b', bg: '#fee2e2', label: 'Atrasado' },
                                };
                                const s = statusMap[status] || statusMap['a_vencer'];

                                return (
                                    <div key={status} style={{ minWidth: '320px', flex: 1, background: 'var(--color-bg-light)', borderRadius: 'var(--radius-md)', padding: '0.5rem', borderTop: `4px solid ${s.color}`, boxShadow: 'var(--shadow-sm)' }}>
                                        <h4 style={{
                                            padding: '0.8rem', borderBottom: '1px solid var(--color-border)', background: 'white', borderRadius: 'var(--radius-sm)',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem',
                                            color: s.color
                                        }}>
                                            <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>
                                                {s.label}
                                            </span>
                                            <span style={{ fontSize: '0.8rem', background: s.color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                                                {formatCurrency(invoicesInStatus.reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0))}
                                            </span>
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {invoicesInStatus.map(inv => (
                                                <div
                                                    key={inv.id}
                                                    onClick={() => handleEdit(inv)}
                                                    style={{
                                                        background: 'white', padding: '1rem', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)',
                                                        cursor: 'pointer', border: '1px solid transparent', transition: '0.2s'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-blue)'}
                                                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                        <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)' }}>{inv.consumer_units?.numero_uc}</span>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-medium)' }}>
                                                            Venc: {inv.vencimento ? new Date(inv.vencimento).toLocaleDateString('pt-BR') : '-'}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-medium)', marginBottom: '0.5rem' }}>
                                                        {inv.consumer_units?.titular_conta}
                                                    </div>

                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-medium)', marginBottom: '0.8rem' }}>
                                                        <div>
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>Consumo</div>
                                                            <div>{Number(inv.consumo_kwh).toLocaleString('pt-BR')} kWh</div>
                                                        </div>
                                                        <div>
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>Valor</div>
                                                            <div style={{ fontWeight: 'bold', color: 'var(--color-blue)' }}>{formatCurrency(inv.valor_a_pagar)}</div>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                                        {inv.asaas_boleto_url ? (
                                                            <a
                                                                href={inv.asaas_boleto_url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                onClick={e => e.stopPropagation()}
                                                                style={{
                                                                    background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0',
                                                                    padding: '0.4rem 0.8rem', borderRadius: '4px', textDecoration: 'none',
                                                                    fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem'
                                                                }}
                                                                title="Ver Boleto"
                                                            >
                                                                <FileText size={14} /> Boleto
                                                            </a>
                                                        ) : (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleEmission(inv); }}
                                                                className="btn"
                                                                disabled={generatingId === inv.id}
                                                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: '#c2410c', borderColor: '#ffedd5', background: '#fff7ed', fontWeight: 'bold' }}
                                                            >
                                                                {generatingId === inv.id ? '...' : 'Emitir'}
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
                <InvoiceFormModal
                    invoice={selectedInvoice}
                    ucs={ucs}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                />
            )}
        </div>
    );
}
