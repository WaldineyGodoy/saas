import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Search, Filter, ArrowUpRight, ArrowDownLeft, Calendar } from 'lucide-react';

export default function LedgerStatementModal({ onClose }) {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [environment, setEnvironment] = useState('production');

    // Filters
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [typeFilter, setTypeFilter] = useState('all');
    const [entityFilter, setEntityFilter] = useState('');
    const [accountFilter, setAccountFilter] = useState('all');

    const [accounts, setAccounts] = useState([]);

    useEffect(() => {
        fetchConfig();
        fetchAccounts();
    }, []);

    useEffect(() => {
        fetchStatement();
    }, [environment, dateRange, typeFilter, entityFilter, accountFilter]);

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

            // Client-side filtering for "Payer/Receiver" (can search in description or account name)
            let filtered = data || [];
            if (entityFilter) {
                const search = entityFilter.toLowerCase();
                filtered = filtered.filter(e =>
                    (e.description?.toLowerCase().includes(search)) ||
                    (e.account_name?.toLowerCase().includes(search)) ||
                    (e.account_code?.includes(search))
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
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, backdropFilter: 'blur(4px)' }}>
            <div style={{ background: 'white', borderRadius: '12px', width: '95%', maxWidth: '1200px', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>

                {/* Header */}
                <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: environment === 'sandbox' ? '#fffbeb' : '#f8fafc' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            Extrato do Livro Razão
                            <span style={{
                                fontSize: '0.75rem',
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
                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Visualização detalhada de todos os lançamentos contábeis.</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'white', border: '1px solid #e2e8f0', padding: '0.5rem', borderRadius: '8px', cursor: 'pointer', color: '#64748b' }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Filters */}
                <div style={{ padding: '1rem 1.5rem', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'end' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.4rem' }}>Buscar Pagador / Recebedor / Descrição</label>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                            <input
                                placeholder="Filtrar por nome ou motivo..."
                                value={entityFilter}
                                onChange={e => setEntityFilter(e.target.value)}
                                style={{ width: '100%', padding: '0.6rem 0.6rem 0.6rem 2.2rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                            />
                        </div>
                    </div>

                    <div style={{ width: '150px' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.4rem' }}>Tipo</label>
                        <select
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value)}
                            style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                        >
                            <option value="all">Todos os tipos</option>
                            <option value="debit">Débitos (+)</option>
                            <option value="credit">Créditos (-)</option>
                        </select>
                    </div>

                    <div style={{ width: '250px' }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.4rem' }}>Conta Contábil</label>
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

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <div style={{ width: '140px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.4rem' }}>Início</label>
                            <input
                                type="date"
                                value={dateRange.start}
                                onChange={e => setDateRange({ ...dateRange, start: e.target.value })}
                                style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                            />
                        </div>
                        <div style={{ width: '140px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.4rem' }}>Fim</label>
                            <input
                                type="date"
                                value={dateRange.end}
                                onChange={e => setDateRange({ ...dateRange, end: e.target.value })}
                                style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Table */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem' }}>
                    {loading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>Carregando lançamentos...</div>
                    ) : entries.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '5rem', color: '#94a3b8' }}>
                            <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Nenhum lançamento encontrado.</p>
                            <p style={{ fontSize: '0.9rem' }}>Tente ajustar os filtros ou altere o ambiente.</p>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '2px solid #f1f5f9' }}>
                                    <th style={{ padding: '1rem 0.5rem', color: '#64748b', fontWeight: 600, width: '180px' }}>Data/Hora</th>
                                    <th style={{ padding: '1rem 0.5rem', color: '#64748b', fontWeight: 600 }}>Conta</th>
                                    <th style={{ padding: '1rem 0.5rem', color: '#64748b', fontWeight: 600 }}>Descrição / Motivo</th>
                                    <th style={{ padding: '1rem 0.5rem', color: '#64748b', fontWeight: 600, textAlign: 'right', width: '150px' }}>Valor (R$)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map(entry => {
                                    const isDebit = entry.amount > 0;
                                    return (
                                        <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s' }}>
                                            <td style={{ padding: '1rem 0.5rem', color: '#334155' }}>{formatDate(entry.created_at)}</td>
                                            <td style={{ padding: '1rem 0.5rem' }}>
                                                <div style={{ fontWeight: 600, color: '#1e293b' }}>{entry.account_name}</div>
                                                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{entry.account_code}</div>
                                            </td>
                                            <td style={{ padding: '1rem 0.5rem' }}>
                                                <div style={{ color: '#475569' }}>{entry.description}</div>
                                                {entry.reference_type && (
                                                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', background: '#f8fafc', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                                        {entry.reference_type.toUpperCase()} #{entry.reference_id?.substring(0, 8)}
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '1rem 0.5rem', textAlign: 'right' }}>
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
                    )}
                </div>

                {/* Footer / Summary */}
                <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '2rem' }}>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Total Débitos</div>
                        <div style={{ fontWeight: 'bold', color: '#ef4444' }}>{formatCurrency(entries.filter(e => e.amount > 0).reduce((acc, curr) => acc + curr.amount, 0))}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Total Créditos</div>
                        <div style={{ fontWeight: 'bold', color: '#10b981' }}>{formatCurrency(entries.filter(e => e.amount < 0).reduce((acc, curr) => acc + Math.abs(curr.amount), 0))}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
