import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { createAsaasCharge } from '../../lib/api';
import SubscriberModal from '../../components/SubscriberModal';
import { CreditCard } from 'lucide-react';

export default function SubscriberList() {
    const { profile } = useAuth();
    const [subscribers, setSubscribers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSubscriber, setEditingSubscriber] = useState(null);
    const [viewMode, setViewMode] = useState('list'); // 'list' | 'kanban'
    const [searchTerm, setSearchTerm] = useState('');
    const [generatingId, setGeneratingId] = useState(null);

    const filteredSubscribers = subscribers.filter(sub => {
        if (!searchTerm) return true;
        const lowerTerm = searchTerm.toLowerCase();
        return (
            sub.name?.toLowerCase().includes(lowerTerm) ||
            sub.email?.toLowerCase().includes(lowerTerm) ||
            sub.phone?.includes(lowerTerm) ||
            sub.cpf_cnpj?.includes(lowerTerm)
        );
    });

    useEffect(() => {
        fetchSubscribers();
    }, []);

    const fetchSubscribers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('subscribers')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setSubscribers(data || []);
        } catch (error) {
            console.error('Error fetching subscribers:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = (savedSub) => {
        const exists = subscribers.find(s => s.id === savedSub.id);
        if (exists) {
            setSubscribers(subscribers.map(s => s.id === savedSub.id ? { ...s, ...savedSub } : s));
        } else {
            setSubscribers([savedSub, ...subscribers]);
        }
    };

    const handleEmission = async (sub) => {
        if (!confirm(`Gerar boleto CONSOLIDADO (todas as faturas pendentes) para ${sub.name}?`)) return;

        setGeneratingId(sub.id);
        try {
            const result = await createAsaasCharge(sub.id, 'subscriber');
            if (result.url) {
                alert('Boleto consolidado gerado com sucesso!');
                window.open(result.url, '_blank');
            }
        } catch (error) {
            console.error(error);
            alert('Erro: ' + (error.message || 'Falha ao gerar boleto. Verifique se há faturas pendentes.'));
        } finally {
            setGeneratingId(null);
        }
    };

    // Color mapping for Subscriber Kanban
    const statusColors = {
        ativacao: '#0ea5e9', // Sky Blue
        ativo: '#22c55e', // Green
        ativo_inadimplente: '#f59e0b', // Amber
        transferido: '#64748b', // Slate
        cancelado: '#ef4444', // Red
        cancelado_inadimplente: '#b91c1c' // Dark Red
    };

    const handleDelete = (deletedId) => {
        setSubscribers(subscribers.filter(s => s.id !== deletedId));
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Gestão de Assinantes</h2>
                <button
                    onClick={() => { setEditingSubscriber(null); setIsModalOpen(true); }}
                    style={{ padding: '0.6rem 1.2rem', background: 'var(--color-blue)', color: 'white', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    + Novo Assinante
                </button>
            </div>

            {/* Controls Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flex: 1 }}>
                    <input
                        type="text"
                        placeholder="Buscar por nome, email, telefone ou CPF..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            padding: '0.6rem', width: '100%', maxWidth: '350px',
                            border: '1px solid #ddd', borderRadius: '4px'
                        }}
                    />
                    <div style={{ display: 'flex', border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}>
                        <button
                            onClick={() => setViewMode('list')}
                            style={{
                                padding: '0.6rem 1rem', cursor: 'pointer', border: 'none',
                                background: viewMode === 'list' ? 'var(--color-blue)' : 'white',
                                color: viewMode === 'list' ? 'white' : '#333'
                            }}
                        >
                            Lista
                        </button>
                        <button
                            onClick={() => setViewMode('kanban')}
                            style={{
                                padding: '0.6rem 1rem', cursor: 'pointer', border: 'none',
                                background: viewMode === 'kanban' ? 'var(--color-blue)' : 'white',
                                color: viewMode === 'kanban' ? 'white' : '#333'
                            }}
                        >
                            Kanban
                        </button>
                    </div>
                </div>
            </div>

            {loading ? <p>Carregando...</p> : (
                <>
                    {viewMode === 'list' ? (
                        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                            {filteredSubscribers.length === 0 ? (
                                <p style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>Nenhum assinante encontrado.</p>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Nome/CPF</th>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Contato</th>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Status</th>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Cidade</th>
                                            <th style={{ padding: '1rem', color: '#64748b' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredSubscribers.map(sub => (
                                            <tr key={sub.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ fontWeight: 'bold' }}>{sub.name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{sub.cpf_cnpj}</div>
                                                </td>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ fontSize: '0.9rem' }}>{sub.email}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{sub.phone}</div>
                                                </td>
                                                <td style={{ padding: '1rem' }}>
                                                    <span style={{
                                                        padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.85rem',
                                                        background: sub.status?.includes('ativo') ? '#dcfce7' :
                                                            sub.status?.includes('cancelado') ? '#fee2e2' : '#dbeafe',
                                                        color: sub.status?.includes('ativo') ? '#166534' :
                                                            sub.status?.includes('cancelado') ? '#dc2626' : '#1e40af'
                                                    }}>
                                                        {sub.status?.toUpperCase().replace('_', ' ')}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem' }}>{sub.cidade ? `${sub.cidade}/${sub.uf}` : '-'}</td>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            onClick={() => handleEmission(sub)}
                                                            disabled={generatingId === sub.id}
                                                            title="Emitir Boleto Consolidado"
                                                            style={{
                                                                background: '#fff7ed', color: '#c2410c', border: '1px solid #ffedd5',
                                                                padding: '0.4rem 0.6rem', borderRadius: '4px', cursor: 'pointer',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                            }}
                                                        >
                                                            {generatingId === sub.id ? '...' : <CreditCard size={14} />}
                                                        </button>
                                                        <button
                                                            onClick={() => { setEditingSubscriber(sub); setIsModalOpen(true); }}
                                                            style={{ border: '1px solid #ccc', background: 'white', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            Editar
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                            {['ativacao', 'ativo', 'ativo_inadimplente', 'transferido', 'cancelado', 'cancelado_inadimplente'].map(status => {
                                const subsInStatus = filteredSubscribers.filter(s => s.status === status);
                                const statusColor = statusColors[status] || '#64748b';

                                return (
                                    <div key={status} style={{ minWidth: '280px', flex: 1, background: '#f8fafc', borderRadius: '8px', padding: '0.5rem', borderTop: `4px solid ${statusColor}` }}>
                                        <h4 style={{
                                            padding: '0.8rem', borderBottom: '1px solid #e2e8f0', background: 'white', borderRadius: '4px',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem',
                                            color: statusColor
                                        }}>
                                            <span style={{ textTransform: 'uppercase', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                {status.replace('_', ' ')}
                                            </span>
                                            <span style={{ fontSize: '0.8rem', background: statusColor, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                                                {subsInStatus.length}
                                            </span>
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {subsInStatus.map(sub => (
                                                <div
                                                    key={sub.id}
                                                    onClick={() => { setEditingSubscriber(sub); setIsModalOpen(true); }}
                                                    style={{
                                                        background: 'white', padding: '1rem', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                                        cursor: 'pointer', border: '1px solid transparent', transition: '0.2s'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-blue)'}
                                                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                                                >
                                                    <div style={{ fontWeight: 'bold', marginBottom: '0.3rem' }}>{sub.name}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{sub.cpf_cnpj}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{sub.email}</div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.8rem', fontSize: '0.75rem', color: '#999' }}>
                                                        <span>{sub.cidade}</span>
                                                        <span>{new Date(sub.created_at).toLocaleDateString()}</span>
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
                <SubscriberModal
                    subscriber={editingSubscriber}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
