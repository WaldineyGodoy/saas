import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import SupplierModal from '../../components/SupplierModal';
import { Eye, Pencil, RefreshCw, Search, Plus, Building2, User } from 'lucide-react';

export default function SupplierList() {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetchSuppliers();
    }, []);

    const fetchSuppliers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('suppliers')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;
            setSuppliers(data || []);
        } catch (error) {
            console.error('Erro suppliers', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredSuppliers = useMemo(() => {
        return suppliers.filter(s => {
            const lowerTerm = searchTerm.toLowerCase();
            return (
                s.name?.toLowerCase().includes(lowerTerm) ||
                s.cnpj?.includes(lowerTerm) ||
                s.email?.toLowerCase().includes(lowerTerm)
            );
        });
    }, [suppliers, searchTerm]);

    const handleSave = () => {
        fetchSuppliers();
        setIsModalOpen(false);
    };

    const handleDelete = (id) => {
        setSuppliers(suppliers.filter(s => s.id !== id));
        setIsModalOpen(false);
    };

    // Status colors mapping
    const statusColors = {
        ativo: { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
        ativacao: { bg: '#fef9c3', text: '#854d0e', border: '#fef08a' },
        inativo: { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0' },
        cancelado: { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' }
    };

    return (
        <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
            <style>
                {`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .spin { animation: spin 1s linear infinite; }
                `}
            </style>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.2rem' }}>Fornecedores (Geradores)</h2>
                    <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Gerencie os parceiros de geração e infraestrutura do sistema.</p>
                </div>
                <button
                    onClick={() => { setEditingSupplier(null); setIsModalOpen(true); }}
                    style={{ 
                        padding: '0.75rem 1.5rem', 
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', 
                        color: 'white', 
                        borderRadius: '14px', 
                        fontWeight: 700, 
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        boxShadow: '0 10px 15px -3px rgba(37, 99, 235, 0.3)',
                        transition: 'transform 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                >
                    <Plus size={18} strokeWidth={3} />
                    Novo Fornecedor
                </button>
            </div>

            {/* Summary Bar */}
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '220px', background: 'white', padding: '1.2rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '0.8rem', background: '#eff6ff', borderRadius: '12px' }}>
                        <Building2 size={24} color="#3b82f6" />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.025em' }}>Total Fornecedores</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>{suppliers.length}</div>
                    </div>
                </div>
                <div style={{ flex: 1, minWidth: '220px', background: 'white', padding: '1.2rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '0.8rem', background: '#ecfdf5', borderRadius: '12px' }}>
                        <Building2 size={24} color="#10b981" />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.025em' }}>Ativos</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981' }}>{suppliers.filter(s => s.status === 'ativo').length}</div>
                    </div>
                </div>
                <div style={{ flex: 1, minWidth: '220px', background: 'white', padding: '1.2rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '0.8rem', background: '#fffbeb', borderRadius: '12px' }}>
                        <Building2 size={24} color="#f59e0b" />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.025em' }}>Em Ativação</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f59e0b' }}>{suppliers.filter(s => s.status === 'ativacao').length}</div>
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div style={{ 
                display: 'flex', 
                gap: '1rem', 
                marginBottom: '1.5rem',
                background: 'white',
                padding: '1rem',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
            }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                    <Search size={18} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        placeholder="Buscar por nome, CNPJ ou email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '0.7rem 1rem 0.7rem 2.5rem',
                            border: '1px solid #e2e8f0',
                            borderRadius: '12px',
                            fontSize: '0.9rem',
                            outline: 'none',
                            transition: 'border-color 0.2s',
                            background: '#f8fafc'
                        }}
                        onFocus={e => e.target.style.borderColor = '#3b82f6'}
                        onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                    />
                </div>
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                    <RefreshCw size={40} color="#3b82f6" className="spin" />
                </div>
            ) : (
                <div style={{ 
                    background: 'white', 
                    borderRadius: '24px', 
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)', 
                    overflow: 'hidden',
                    border: '1px solid #e2e8f0'
                }}>
                    <div style={{ overflowX: 'auto' }}>
                        {filteredSuppliers.length === 0 ? (
                            <div style={{ padding: '4rem', textAlign: 'center' }}>
                                <Building2 size={48} color="#cbd5e1" style={{ marginBottom: '1rem' }} />
                                <p style={{ color: '#94a3b8', fontSize: '1rem' }}>Nenhum fornecedor encontrado.</p>
                            </div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                        <th style={{ padding: '1.2rem 1.5rem', textAlign: 'left', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fornecedor</th>
                                        <th style={{ padding: '1.2rem 1.5rem', textAlign: 'left', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CNPJ</th>
                                        <th style={{ padding: '1.2rem 1.5rem', textAlign: 'left', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contato</th>
                                        <th style={{ padding: '1.2rem 1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                                        <th style={{ padding: '1.2rem 1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSuppliers.map(s => {
                                        const status = statusColors[s.status] || statusColors.inativo;
                                        return (
                                            <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                <td style={{ padding: '1.2rem 1.5rem' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                        <div style={{ padding: '0.5rem', background: '#eff6ff', borderRadius: '10px' }}>
                                                            <Building2 size={20} color="#3b82f6" />
                                                        </div>
                                                        <div>
                                                            <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '0.95rem' }}>{s.name}</div>
                                                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Cod: {s.id.substring(0, 8)}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td style={{ padding: '1.2rem 1.5rem', color: '#475569', fontSize: '0.9rem', fontFamily: 'monospace' }}>
                                                    {s.cnpj}
                                                </td>
                                                <td style={{ padding: '1.2rem 1.5rem' }}>
                                                    <div style={{ fontSize: '0.9rem', color: '#1e293b', fontWeight: 500 }}>{s.email}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{s.phone}</div>
                                                </td>
                                                <td style={{ padding: '1.2rem 1.5rem', textAlign: 'center' }}>
                                                    <span style={{
                                                        padding: '0.3rem 0.8rem', 
                                                        borderRadius: '8px', 
                                                        fontSize: '0.7rem', 
                                                        fontWeight: 800,
                                                        background: status.bg,
                                                        color: status.text,
                                                        border: `1px solid ${status.border}`,
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        {s.status === 'ativacao' ? 'ATIVAÇÃO' : s.status || 'INATIVO'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1.2rem 1.5rem' }}>
                                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                                        <button
                                                            onClick={() => { setEditingSupplier(s); setIsModalOpen(true); }}
                                                            title="Visualizar Detalhes"
                                                            style={{ 
                                                                padding: '0.5rem', 
                                                                borderRadius: '10px', 
                                                                border: '1px solid #e2e8f0', 
                                                                background: 'white', 
                                                                color: '#64748b',
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                transition: 'all 0.2s'
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#3b82f6'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b'; }}
                                                        >
                                                            <Eye size={18} />
                                                        </button>
                                                        <button
                                                            onClick={() => { setEditingSupplier(s); setIsModalOpen(true); }}
                                                            title="Editar Fornecedor"
                                                            style={{ 
                                                                padding: '0.5rem', 
                                                                borderRadius: '10px', 
                                                                border: '1px solid #e2e8f0', 
                                                                background: 'white', 
                                                                color: '#2563eb',
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                transition: 'all 0.2s'
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.background = '#f0f7ff'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = 'white'; }}
                                                        >
                                                            <Pencil size={18} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {isModalOpen && (
                <SupplierModal
                    key={editingSupplier?.id}
                    supplier={editingSupplier}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
