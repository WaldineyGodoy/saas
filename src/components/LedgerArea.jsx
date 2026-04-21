import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Search, ArrowUpRight, ArrowDownLeft, Calendar, FileText, Download } from 'lucide-react';

export default function LedgerArea() {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [environment, setEnvironment] = useState('production');

    // Filters
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [typeFilter, setTypeFilter] = useState('all');
    const [searchFilter, setSearchFilter] = useState('');
    const [accountFilter, setAccountFilter] = useState('all');
    const [originDestFilter, setOriginDestFilter] = useState('');

    const [accounts, setAccounts] = useState([]);

    useEffect(() => {
        fetchConfig();
        fetchAccounts();
    }, []);

    useEffect(() => {
        fetchStatement();
    }, [environment, dateRange, typeFilter, searchFilter, accountFilter, originDestFilter]);

    const fetchConfig = async () => {
        const { data } = await supabase
            .from('integrations_config')
            .select('environment')
            .eq('service_name', 'financial_api')
            .single();
        if (data) setEnvironment(data.environment || 'production');
    };

    const fetchAccounts = async () => {
        const { data } = await supabase
            .from('ledger_accounts')
            .select('id, code, name')
            .order('code');
        setAccounts(data || []);
    };

    const fetchStatement = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('view_ledger_enriched')
                .select('*')
                .eq('is_sandbox', environment === 'sandbox')
                .order('created_at', { ascending: false });

            if (dateRange.start) query = query.gte('created_at', dateRange.start);
            if (dateRange.end) query = query.lte('created_at', dateRange.end + 'T23:59:59');

            if (typeFilter === 'credit') query = query.lt('amount', 0);
            if (typeFilter === 'debit') query = query.gt('amount', 0);

            if (accountFilter !== 'all') query = query.eq('account_id', accountFilter);

            const { data, error } = await query;

            if (error) throw error;

            // Client-side filtering for Search and Origin/Destination
            let filtered = data || [];
            
            if (searchFilter) {
                const search = searchFilter.toLowerCase();
                filtered = filtered.filter(e =>
                    (e.description?.toLowerCase().includes(search)) ||
                    (e.account_name?.toLowerCase().includes(search)) ||
                    (e.account_code?.includes(search))
                );
            }

            if (originDestFilter) {
                const search = originDestFilter.toLowerCase();
                filtered = filtered.filter(e =>
                    (e.entity_name?.toLowerCase().includes(search))
                );
            }

            setEntries(filtered);
        } catch (error) {
            console.error('Error fetching ledger:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val) => {
        return Math.abs(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'white', borderRadius: '12px', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
            
            {/* Environment Badge & Summary Header */}
            <div style={{ padding: '1.5rem', background: environment === 'sandbox' ? '#fffbeb' : '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        Livro Razão (Extrato)
                        <span style={{
                            fontSize: '0.7rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '99px',
                            background: environment === 'sandbox' ? '#f59e0b' : '#3b82f6',
                            color: 'white',
                            textTransform: 'uppercase',
                            fontWeight: 'bold'
                        }}>
                            {environment}
                        </span>
                    </h3>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Detalhamento contábil e movimentações financeiras.</p>
                </div>
                
                <div style={{ display: 'flex', gap: '1rem' }}>
                     <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Crédito (-)</div>
                        <div style={{ fontWeight: 'bold', color: '#10b981', fontSize: '1.1rem' }}>{formatCurrency(entries.filter(e => e.amount < 0).reduce((acc, curr) => acc + Math.abs(curr.amount), 0))}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Débito (+)</div>
                        <div style={{ fontWeight: 'bold', color: '#ef4444', fontSize: '1.1rem' }}>{formatCurrency(entries.filter(e => e.amount > 0).reduce((acc, curr) => acc + curr.amount, 0))}</div>
                    </div>
                </div>
            </div>

            {/* Filters Section */}
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', background: 'white' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    
                    {/* Search Description */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Descrição / Lançamento</label>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                placeholder="Buscar motivo..."
                                value={searchFilter}
                                onChange={e => setSearchFilter(e.target.value)}
                                style={{ width: '100%', padding: '0.6rem 0.6rem 0.6rem 2.2rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                            />
                        </div>
                    </div>

                    {/* Origin / Destination Filter */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Origem / Destino</label>
                        <div style={{ position: 'relative' }}>
                            <FileText size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                placeholder="Nome Usina / Assinante / Originador / Investidor..."
                                value={originDestFilter}
                                onChange={e => setOriginDestFilter(e.target.value)}
                                style={{ width: '100%', padding: '0.6rem 0.6rem 0.6rem 2.2rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                            />
                        </div>
                    </div>

                    {/* Account Selector */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Conta Contábil</label>
                        <select
                            value={accountFilter}
                            onChange={e => setAccountFilter(e.target.value)}
                            style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                        >
                            <option value="all">Todas as contas</option>
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Date Filters */}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Início</label>
                            <input
                                type="date"
                                value={dateRange.start}
                                onChange={e => setDateRange({ ...dateRange, start: e.target.value })}
                                style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                            />
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Fim</label>
                            <input
                                type="date"
                                value={dateRange.end}
                                onChange={e => setDateRange({ ...dateRange, end: e.target.value })}
                                style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Table Area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
                {loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem', gap: '1rem' }}>
                        <div className="spinner-border text-primary" role="status"></div>
                        <p style={{ color: '#64748b' }}>Carregando lançamentos...</p>
                    </div>
                ) : entries.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '5rem', color: '#94a3b8' }}>
                        <FileText size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                        <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem', fontWeight: 500 }}>Nenhum lançamento encontrado.</p>
                        <p style={{ fontSize: '0.9rem' }}>Experimente mudar os filtros ou o ambiente.</p>
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table className="table" style={{ margin: 0 }}>
                            <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 10 }}>
                                <tr>
                                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 600, borderTop: 'none' }}>Data/Hora</th>
                                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 600, borderTop: 'none' }}>Entidade / Tipo</th>
                                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 600, borderTop: 'none' }}>Descrição do Lançamento</th>
                                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 600, borderTop: 'none', textAlign: 'right' }}>Valor (R$)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map(entry => {
                                    const isDebit = entry.amount > 0;
                                    const entityName = entry.entity_name || '-';
                                    
                                    return (
                                        <tr key={entry.id} style={{ transition: 'background 0.2s' }}>
                                            <td style={{ padding: '1rem 1.5rem', color: '#334155', verticalAlign: 'middle' }}>
                                                {formatDate(entry.created_at)}
                                            </td>
                                            <td style={{ padding: '1rem 1.5rem', verticalAlign: 'middle' }}>
                                                <div style={{ color: '#1e293b', fontWeight: 500 }}>{entityName}</div>
                                                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{entry.reference_type_pt} #{entry.reference_id?.substring(0, 8)}</div>
                                            </td>
                                            <td style={{ padding: '1rem 1.5rem', verticalAlign: 'middle' }}>
                                                <div style={{ color: '#475569', fontWeight: 600 }}>{entry.description}</div>
                                                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{entry.account_name} ({entry.account_code})</div>
                                            </td>
                                            <td style={{ padding: '1rem 1.5rem', textAlign: 'right', verticalAlign: 'middle' }}>
                                                <div style={{
                                                    fontWeight: 'bold',
                                                    color: isDebit ? '#ef4444' : '#10b981',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'flex-end',
                                                    gap: '0.4rem'
                                                }}>
                                                    {isDebit ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                                                    {formatCurrency(entry.amount)}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Bottom Footer with Status and Export placeholder */}
            <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Mostrando <strong>{entries.length}</strong> lançamentos.
                </div>
                <button
                    onClick={() => alert('Função de exportação será implementada em breve.')}
                    className="btn btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}
                >
                    <Download size={14} /> Exportar CSV
                </button>
            </div>
        </div>
    );
}
