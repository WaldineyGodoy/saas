import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { createAsaasCharge } from '../../lib/api';
import InvoiceFormModal from '../../components/InvoiceFormModal';
import InvoiceHistoryModal from '../../components/InvoiceHistoryModal';
import { Search, Filter, Plus, FileText, CheckCircle, AlertCircle, Clock, CreditCard, Trash2, Ban, Calendar, History, Layout, List, Info, Calendar as CalendarIcon } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';

export default function InvoiceListManager() {
    const { showAlert, showConfirm } = useUI();
    const [invoices, setInvoices] = useState([]);
    const [ucs, setUcs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('kanban');
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [monthFilter, setMonthFilter] = useState(new Date().toISOString().substring(0, 7));
    const [statusFilter, setStatusFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [generatingId, setGeneratingId] = useState(null);
    const [showMonthPicker, setShowMonthPicker] = useState(false);
    const [showTooltip, setShowTooltip] = useState(false);

    const filteredInvoices = invoices.filter(inv => {
        if (statusFilter && inv.status !== statusFilter) return false;
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            const titular = inv.consumer_units?.titular_conta?.toLowerCase() || '';
            const assinante = inv.consumer_units?.subscribers?.name?.toLowerCase() || '';
            const uc = inv.consumer_units?.numero_uc?.toLowerCase() || '';
            const invoiceId = inv.id?.toLowerCase() || '';
            if (!titular.includes(lower) && !assinante.includes(lower) && !uc.includes(lower) && !invoiceId.includes(lower)) {
                return false;
            }
        }
        return true;
    });

    useEffect(() => {
        fetchInvoices();
        fetchUcs();
    }, [monthFilter]);

    const fetchInvoices = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('invoices')
                .select(`
                    *,
                    consumer_units (
                        numero_uc,
                        titular_conta,
                        concessionaria,
                        subscribers!consumer_units_subscriber_id_fkey(name)
                    )
                `);

            if (monthFilter !== 'all') {
                const [year, month] = monthFilter.split('-');
                const startDate = `${year}-${month}-01`;
                const lastDay = new Date(year, month, 0).getDate();
                const endDate = `${year}-${month}-${lastDay}`;
                query = query.gte('vencimento', startDate).lte('vencimento', endDate);
            }

            const { data, error } = await query.order('vencimento', { ascending: true });
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
            .select(`
                id, numero_uc, concessionaria, titular_conta, 
                tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento,
                subscribers!consumer_units_subscriber_id_fkey(name),
                titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name)
            `)
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
        fetchInvoices();
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
            const { error } = await supabase.from('invoices').delete().eq('id', id);
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
            'atrasado': { color: '#dc2626', bg: '#fee2e2', label: 'Atrasado', icon: AlertCircle },
            'cancelado': { color: '#475569', bg: '#f1f5f9', label: 'Cancelada', icon: Ban },
        };
        const s = map[status] || map['a_vencer'];
        const Icon = s.icon;
        return (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', background: s.bg, color: s.color, borderRadius: '99px', fontSize: '0.8rem', width: 'fit-content' }}>
                <Icon size={12} /> {s.label}
            </span>
        );
    };

    const CalendarView = ({ invoices, onEdit }) => {
        const days = Array.from({ length: 31 }, (_, i) => i + 1);
        const groupedInvoices = invoices.reduce((acc, inv) => {
            if (inv.vencimento) {
                const date = new Date(inv.vencimento);
                const day = date.getUTCDate();
                if (!acc[day]) acc[day] = [];
                acc[day].push(inv);
            }
            return acc;
        }, {});

        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1.5rem', padding: '1rem' }}>
                {days.map(day => {
                    const dayInvoices = groupedInvoices[day] || [];
                    const totalAmount = dayInvoices.reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0);
                    return (
                        <div key={day} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', minHeight: '180px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-sm)', transition: 'all 0.2s' }}>
                            <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: '12px', borderTopRightRadius: '12px' }}>
                                <span style={{ fontWeight: 800, color: 'var(--color-blue)', fontSize: '0.95rem' }}>Dia {day}</span>
                                {totalAmount > 0 && (
                                    <span style={{ fontSize: '0.75rem', color: '#166534', background: '#dcfce7', padding: '0.2rem 0.5rem', borderRadius: '12px', fontWeight: 700 }}>
                                        {formatCurrency(totalAmount)}
                                    </span>
                                )}
                            </div>
                            <div style={{ padding: '0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto', maxHeight: '250px' }}>
                                {dayInvoices.length === 0 ? (
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginTop: '2.5rem', fontStyle: 'italic', opacity: 0.6 }}>Sem faturas</div>
                                ) : (
                                    dayInvoices.map(inv => {
                                        const statusColors = { 'pago': '#166534', 'atrasado': '#dc2626', 'a_vencer': '#854d0e', 'cancelado': '#64748b' };
                                        return (
                                            <div key={inv.id} onClick={() => onEdit(inv)} style={{ padding: '0.6rem', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: `4px solid ${statusColors[inv.status] || '#cbd5e1'}`, cursor: 'pointer', transition: 'all 0.2s' }}>
                                                <div style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {inv.consumer_units?.subscribers?.name || 'S/ Assinante'}
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.65rem', color: '#64748b' }}>UC: {inv.consumer_units?.numero_uc}</span>
                                                    <span style={{ fontWeight: '700', fontSize: '0.75rem', color: 'var(--color-blue)' }}>{formatCurrency(inv.valor_a_pagar)}</span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ color: 'var(--color-blue)', fontSize: '1.8rem', fontWeight: 'bold' }}>Faturas</h2>
                    <p style={{ color: '#64748b' }}>Gerencie os lançamentos mensais das Unidades Consumidoras</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button onClick={() => setIsHistoryModalOpen(true)} style={{ background: 'white', color: '#475569', padding: '0.8rem 1.5rem', borderRadius: '4px', border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <History size={18} /> Histórico
                    </button>
                    <button onClick={handleCreate} style={{ background: 'var(--color-orange)', color: 'white', padding: '0.8rem 1.5rem', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Plus size={18} /> Nova Fatura
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ background: 'white', padding: '0.5rem 1rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b' }}>
                        <Calendar size={18} />
                        <span style={{ fontWeight: 'bold' }}>Mês:</span>
                    </div>
                    <div style={{ position: 'relative' }}>
                        <button onClick={() => setShowMonthPicker(!showMonthPicker)} style={{ padding: '0.5rem 1rem', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer', background: 'white', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '140px' }}>
                            <span>{monthFilter === 'all' ? 'Qualquer Data' : new Date(`${monthFilter}-01T00:00:00`).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                        </button>
                        {showMonthPicker && (
                            <div style={{ position: 'absolute', top: '110%', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 100, padding: '1rem', width: '280px' }}>
                                <div style={{ marginBottom: '1rem' }}>
                                    <button onClick={() => { setMonthFilter('all'); setShowMonthPicker(false); }} style={{ width: '100%', padding: '0.6rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: monthFilter === 'all' ? 'var(--color-blue)' : 'white', color: monthFilter === 'all' ? 'white' : '#475569', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>Qualquer Data</button>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
                                    <button onClick={() => { const parts = monthFilter === 'all' ? [new Date().getFullYear(), '01'] : monthFilter.split('-'); setMonthFilter(`${Number(parts[0]) - 1}-${parts[1]}`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 'bold' }}>&lt;</button>
                                    <span style={{ fontWeight: 'bold' }}>{monthFilter === 'all' ? new Date().getFullYear() : monthFilter.split('-')[0]}</span>
                                    <button onClick={() => { const parts = monthFilter === 'all' ? [new Date().getFullYear(), '01'] : monthFilter.split('-'); setMonthFilter(`${Number(parts[0]) + 1}-${parts[1]}`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 'bold' }}>&gt;</button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                                    {['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'].map((m, idx) => {
                                        const mVal = String(idx + 1).padStart(2, '0');
                                        const currentYear = monthFilter === 'all' ? new Date().getFullYear() : monthFilter.split('-')[0];
                                        const isSelected = monthFilter === `${currentYear}-${mVal}`;
                                        return <button key={m} onClick={() => { setMonthFilter(`${currentYear}-${mVal}`); setShowMonthPicker(false); }} style={{ padding: '0.5rem', border: 'none', borderRadius: '6px', background: isSelected ? 'var(--color-blue)' : '#f8fafc', color: isSelected ? 'white' : '#475569', cursor: 'pointer', fontSize: '0.85rem' }}>{m}</button>;
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    <div style={{ width: '1px', height: '20px', background: '#e2e8f0' }}></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b' }}><span style={{ fontWeight: 'bold' }}>Status:</span></div>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                        <option value="">Todos</option>
                        <option value="a_vencer">A Vencer</option>
                        <option value="atrasado">Atrasado</option>
                        <option value="pago">Pago</option>
                    </select>
                    <div style={{ width: '1px', height: '20px', background: '#e2e8f0' }}></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b' }}><Search size={18} /></div>
                    <input placeholder="Buscar por Nome, UC ou ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '4px', minWidth: '220px' }} />
                </div>

                <div className="btn-group" style={{ display: 'flex', background: '#f1f5f9', padding: '0.3rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <button onClick={() => setViewMode('list')} className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', background: viewMode === 'list' ? 'white' : 'transparent', color: viewMode === 'list' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'list' ? '700' : '500' }}>
                        <List size={18} /> Lista
                    </button>
                    <button onClick={() => setViewMode('kanban')} className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', background: viewMode === 'kanban' ? 'white' : 'transparent', color: viewMode === 'kanban' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'kanban' ? '700' : '500' }}>
                        <Layout size={18} /> Kanban
                    </button>
                    <div style={{ position: 'relative' }}>
                        <button onClick={() => setViewMode('calendar')} onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)} className={`btn ${viewMode === 'calendar' ? 'btn-primary' : 'btn-secondary'}`} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', background: viewMode === 'calendar' ? 'white' : 'transparent', color: viewMode === 'calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'calendar' ? '700' : '500' }}>
                            <CalendarIcon size={18} /> Calendário
                        </button>
                        {showTooltip && (
                            <div style={{ position: 'absolute', top: '130%', right: 0, background: '#1e293b', color: 'white', padding: '0.75rem 1.25rem', borderRadius: '10px', fontSize: '0.85rem', zIndex: 1000, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.6rem', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255,255,255,0.1)' }}>
                                <Info size={16} style={{ color: '#3b82f6' }} /> Calendário agrupa as faturas por dia de vencimento.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {loading ? <p>Carregando...</p> : filteredInvoices.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', background: 'white', borderRadius: '12px', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '1rem' }}><FileText size={48} /></div>
                    <h3 style={{ color: '#475569', fontWeight: 'bold' }}>{monthFilter === 'all' ? 'Nenhuma Fatura encontrada' : 'Nenhuma Fatura emitida para o Mês selecionado'}</h3>
                </div>
            ) : (
                <>
                    {viewMode === 'list' ? (
                        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ background: '#f8fafc' }}>
                                    <tr>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Status</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Vencimento</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Unidade Consumidora</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Valor</th>
                                        <th style={{ padding: '1rem', textAlign: 'right', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredInvoices.map(inv => (
                                        <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '1rem' }}>{getStatusBadge(inv.status)}</td>
                                            <td style={{ padding: '1rem', color: '#334155' }}>{inv.vencimento ? new Date(inv.vencimento).toLocaleDateString('pt-BR') : '-'}</td>
                                            <td style={{ padding: '1rem' }}>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>{inv.consumer_units?.numero_uc || 'N/A'}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{inv.consumer_units?.subscribers?.name}</div>
                                            </td>
                                            <td style={{ padding: '1rem', fontWeight: 'bold', color: '#0f172a' }}>{formatCurrency(inv.valor_a_pagar)}</td>
                                            <td style={{ padding: '1rem', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                    {inv.asaas_boleto_url && <a href={inv.asaas_boleto_url} target="_blank" rel="noopener noreferrer" style={{ background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', padding: '0.4rem 0.8rem', borderRadius: '4px', textDecoration: 'none', fontSize: '0.8rem' }}><FileText size={14} /></a>}
                                                    <button onClick={() => handleEdit(inv)} style={{ background: 'none', border: '1px solid #e2e8f0', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Editar</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : viewMode === 'kanban' ? (
                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                            {['a_vencer', 'atrasado', 'pago'].map(status => {
                                const invoicesInStatus = filteredInvoices.filter(inv => inv.status === status);
                                const statusMap = { 'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago' }, 'a_vencer': { color: '#854d0e', bg: '#fef9c3', label: 'A Vencer' }, 'atrasado': { color: '#dc2626', bg: '#fee2e2', label: 'Atrasado' } };
                                const s = statusMap[status] || statusMap['a_vencer'];
                                return (
                                    <div key={status} style={{ minWidth: '320px', flex: 1, background: 'var(--color-bg-light)', borderRadius: 'var(--radius-md)', padding: '0.5rem', borderTop: `4px solid ${s.color}`, boxShadow: 'var(--shadow-sm)' }}>
                                        <h4 style={{ padding: '0.8rem', borderBottom: '1px solid var(--color-border)', background: 'white', borderRadius: 'var(--radius-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', color: s.color }}>
                                            <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>{s.label}</span>
                                            <span style={{ fontSize: '0.8rem', background: s.color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>{formatCurrency(invoicesInStatus.reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0))}</span>
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {invoicesInStatus.map(inv => (
                                                <div key={inv.id} onClick={() => handleEdit(inv)} style={{ background: 'white', padding: '1rem', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', border: '1px solid transparent', transition: '0.2s' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                        <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)' }}>{inv.consumer_units?.numero_uc}</span>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-medium)' }}>{inv.vencimento ? new Date(inv.vencimento).toLocaleDateString('pt-BR') : '-'}</span>
                                                    </div>
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-dark)', fontWeight: '500' }}>{inv.consumer_units?.subscribers?.name}</div>
                                                    <div style={{ fontWeight: 'bold', color: 'var(--color-blue)', marginTop: '0.5rem' }}>{formatCurrency(inv.valor_a_pagar)}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{ background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                            <CalendarView invoices={filteredInvoices} onEdit={handleEdit} />
                        </div>
                    )}
                </>
            )}

            {isModalOpen && <InvoiceFormModal invoice={selectedInvoice} ucs={ucs} onClose={() => setIsModalOpen(false)} onSave={handleSave} />}
            {isHistoryModalOpen && <InvoiceHistoryModal onClose={() => setIsHistoryModalOpen(false)} />}
        </div>
    );
}
