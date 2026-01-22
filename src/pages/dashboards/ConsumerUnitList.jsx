import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import ConsumerUnitModal from '../../components/ConsumerUnitModal';

export default function ConsumerUnitList() {
    const [units, setUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('kanban');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUnit, setEditingUnit] = useState(null);

    const filteredUnits = units.filter(u => {
        if (!searchTerm) return true;
        const lower = searchTerm.toLowerCase();
        return (
            u.numero_uc?.toLowerCase().includes(lower) ||
            u.subscriber?.name?.toLowerCase().includes(lower) ||
            u.concessionaria?.toLowerCase().includes(lower) ||
            u.address?.cidade?.toLowerCase().includes(lower) ||
            u.status?.toLowerCase().includes(lower)
        );
    });

    useEffect(() => {
        fetchUnits();
    }, []);

    const fetchUnits = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('consumer_units')
                .select(`
                    *,
                    subscriber:subscriber_id (name, cpf_cnpj)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setUnits(data || []);
        } catch (error) {
            console.error('Error fetching UCs:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = (savedUnit) => {
        // Optimistic update or refresh
        fetchUnits(); // Easiest to just refresh to get relation data properly
        setIsModalOpen(false);
    };

    const handleDelete = (id) => {
        setUnits(units.filter(u => u.id !== id));
        setIsModalOpen(false);
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Gestão de Unidades Consumidoras (UCs)</h2>
                <button
                    onClick={() => { setEditingUnit(null); setIsModalOpen(true); }}
                    style={{ padding: '0.6rem 1.2rem', background: 'var(--color-blue)', color: 'white', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                    + Nova UC
                </button>
            </div>

            {/* Controls Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flex: 1, alignItems: 'center' }}>
                    <input
                        placeholder="Buscar por UC, Assinante, Concessionária ou Status..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="input"
                        style={{ maxWidth: '400px' }}
                    />
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
            </div>

            {loading ? <p>Carregando...</p> : (
                <>
                    {viewMode === 'list' ? (
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div className="table-container">
                                {filteredUnits.length === 0 ? (
                                    <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhuma UC encontrada.</p>
                                ) : (
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>UC</th>
                                                <th>Concessionária</th>
                                                <th>Assinante</th>
                                                <th>Franquia</th>
                                                <th>Status</th>
                                                <th>Cidade</th>
                                                <th>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredUnits.map(uc => (
                                                <tr key={uc.id}>
                                                    <td style={{ fontWeight: 'bold' }}>
                                                        {uc.numero_uc}
                                                    </td>
                                                    <td style={{ color: 'var(--color-text-medium)' }}>
                                                        {uc.concessionaria || '-'}
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 'bold' }}>{uc.subscriber?.name || '-'}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)' }}>{uc.subscriber?.cpf_cnpj}</div>
                                                    </td>
                                                    <td>
                                                        {uc.franquia ? `${Number(uc.franquia).toLocaleString('pt-BR')} kWh` : '-'}
                                                    </td>
                                                    <td>
                                                        <span className="badge" style={{
                                                            background: uc.status === 'ativo' ? 'var(--color-success-light)' : 'var(--color-bg-light)',
                                                            color: uc.status === 'ativo' ? 'var(--color-success)' : 'var(--color-text-light)'
                                                        }}>
                                                            {uc.status?.toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {uc.address?.cidade} / {uc.address?.uf}
                                                    </td>
                                                    <td>
                                                        <button
                                                            onClick={() => { setEditingUnit(uc); setIsModalOpen(true); }}
                                                            className="btn btn-secondary"
                                                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                                                        >
                                                            Editar
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                            {['analise', 'ativo', 'inativo'].map(status => {
                                const unitsInStatus = filteredUnits.filter(u => (u.status || 'analise') === status);
                                const statusColors = {
                                    analise: '#eab308',
                                    ativo: '#22c55e',
                                    inativo: '#94a3b8'
                                };
                                const color = statusColors[status] || '#64748b';

                                return (
                                    <div key={status} style={{ minWidth: '300px', flex: 1, background: 'var(--color-bg-light)', borderRadius: 'var(--radius-md)', padding: '0.5rem', borderTop: `4px solid ${color}`, boxShadow: 'var(--shadow-sm)' }}>
                                        <h4 style={{
                                            padding: '0.8rem', borderBottom: '1px solid var(--color-border)', background: 'white', borderRadius: 'var(--radius-sm)',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem',
                                            color: color
                                        }}>
                                            <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>
                                                {status === 'analise' ? 'Em Análise' : status}
                                            </span>
                                            <span style={{ fontSize: '0.8rem', background: color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                                                {unitsInStatus.length}
                                            </span>
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {unitsInStatus.map(uc => (
                                                <div
                                                    key={uc.id}
                                                    onClick={() => { setEditingUnit(uc); setIsModalOpen(true); }}
                                                    style={{
                                                        background: 'white', padding: '1rem', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)',
                                                        cursor: 'pointer', border: '1px solid transparent', transition: '0.2s'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-blue)'}
                                                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                        <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)' }}>{uc.numero_uc}</span>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-blue)', background: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                                            {uc.concessionaria}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-medium)', marginBottom: '0.2rem' }}>
                                                        {uc.subscriber?.name || 'Sem Assinante'}
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                                        <span>{uc.address?.cidade}/{uc.address?.uf}</span>
                                                        <span>{uc.franquia ? `${Number(uc.franquia).toLocaleString('pt-BR')} kWh` : ''}</span>
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
                <ConsumerUnitModal
                    consumerUnit={editingUnit}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
