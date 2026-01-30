import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import PowerPlantModal from '../../components/PowerPlantModal';
import PlantClosingsHistoryModal from '../../components/PlantClosingsHistoryModal';
import { FileText } from 'lucide-react';

export default function PowerPlantList() {
    const [usinas, setUsinas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUsina, setEditingUsina] = useState(null);
    const [isClosingsModalOpen, setIsClosingsModalOpen] = useState(false);
    const [selectedUsinaForClosings, setSelectedUsinaForClosings] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('kanban');

    const filteredUsinas = usinas.filter(u => {
        if (!searchTerm) return true;
        const lower = searchTerm.toLowerCase();
        return (
            u.name?.toLowerCase().includes(lower) ||
            u.concessionaria?.toLowerCase().includes(lower) ||
            u.supplier?.name?.toLowerCase().includes(lower) ||
            u.status?.toLowerCase().includes(lower) ||
            u.address?.cidade?.toLowerCase().includes(lower)
        );
    });

    useEffect(() => {
        fetchUsinas();
    }, []);

    const fetchUsinas = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('usinas')
                .select(`
                    *,
                    supplier:supplier_id (name)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setUsinas(data || []);
        } catch (error) {
            console.error('Erro usinas', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = () => {
        fetchUsinas();
        setIsModalOpen(false);
    };

    const handleDelete = (id) => {
        setUsinas(usinas.filter(u => u.id !== id));
        setIsModalOpen(false);
    };

    const getStatusStyle = (status) => {
        switch (status) {
            case 'gerando': return { bg: '#dcfce7', color: '#166534' };
            case 'em_conexao': return { bg: '#ffedd5', color: '#9a3412' }; // Orange
            case 'manutencao': return { bg: '#fee2e2', color: '#991b1b' }; // Red
            case 'inativa': return { bg: '#f1f5f9', color: '#64748b' };
            case 'cancelada': return { bg: '#f1f5f9', color: '#94a3b8' };
            default: return { bg: '#f1f5f9', color: '#64748b' };
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Usinas Geradoras</h2>
                <button
                    onClick={() => { setEditingUsina(null); setIsModalOpen(true); }}
                    className="btn btn-primary"
                >
                    + Nova Usina
                </button>
            </div>

            {/* Controls Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flex: 1, alignItems: 'center' }}>
                    <input
                        placeholder="Buscar por Nome, Fornecedor, Concessionária ou Status..."
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
                                {filteredUsinas.length === 0 ? (
                                    <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhuma usina cadastrada.</p>
                                ) : (
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Nome / Concessionária</th>
                                                <th>Fornecedor</th>
                                                <th>Cidade</th>
                                                <th>Geração / Potência</th>
                                                <th>Status</th>
                                                <th>Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredUsinas.map(u => {
                                                const statusStyle = getStatusStyle(u.status);
                                                return (
                                                    <tr key={u.id}>
                                                        <td style={{ fontWeight: 'bold' }}>
                                                            <div>{u.name}</div>
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--color-blue)', fontWeight: 'normal', marginTop: '4px' }}>
                                                                {u.concessionaria || '-'}
                                                            </div>
                                                        </td>
                                                        <td>{u.supplier?.name || '-'}</td>
                                                        <td>
                                                            {u.address?.cidade}/{u.address?.uf}
                                                        </td>
                                                        <td>
                                                            <div style={{ fontWeight: 'bold', color: 'var(--color-success)', fontSize: '1.05rem' }}>
                                                                {u.geracao_estimada_kwh ? `${u.geracao_estimada_kwh} kWh/mês` : '-'}
                                                            </div>
                                                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)' }}>
                                                                Potência: {u.potencia_kwp} kWp
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <span style={{
                                                                padding: '0.3rem 0.8rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 'bold',
                                                                background: statusStyle.bg,
                                                                color: statusStyle.color,
                                                                textTransform: 'uppercase'
                                                            }}>
                                                                {u.status?.replace('_', ' ')}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <button
                                                                onClick={() => { setEditingUsina(u); setIsModalOpen(true); }}
                                                                className="btn btn-secondary"
                                                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', marginRight: '0.5rem' }}
                                                            >
                                                                Editar
                                                            </button>
                                                            <button
                                                                onClick={() => { setSelectedUsinaForClosings(u); setIsClosingsModalOpen(true); }}
                                                                className="btn btn-secondary"
                                                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}
                                                                title="Fechamentos Financeiros"
                                                            >
                                                                <FileText size={14} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                            {['em_conexao', 'gerando', 'manutencao', 'inativa', 'cancelada'].map(status => {
                                const usinasInStatus = filteredUsinas.filter(u => u.status === status);
                                const statusStyle = getStatusStyle(status);

                                return (
                                    <div key={status} style={{ minWidth: '300px', flex: 1, background: 'var(--color-bg-light)', borderRadius: 'var(--radius-md)', padding: '0.5rem', borderTop: `4px solid ${statusStyle.color}`, boxShadow: 'var(--shadow-sm)' }}>
                                        <h4 style={{
                                            padding: '0.8rem', borderBottom: '1px solid var(--color-border)', background: 'white', borderRadius: 'var(--radius-sm)',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem',
                                            color: statusStyle.color
                                        }}>
                                            <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>
                                                {status.replace('_', ' ')}
                                            </span>
                                            <span style={{ fontSize: '0.8rem', background: statusStyle.color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                                                {usinasInStatus.length}
                                            </span>
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {usinasInStatus.map(u => (
                                                <div
                                                    key={u.id}
                                                    onClick={() => { setEditingUsina(u); setIsModalOpen(true); }}
                                                    style={{
                                                        background: 'white', padding: '1rem', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)',
                                                        cursor: 'pointer', border: '1px solid transparent', transition: '0.2s',
                                                        position: 'relative', overflow: 'hidden'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-blue)'}
                                                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                                                >
                                                    {/* Status Badge at Top */}
                                                    <div style={{
                                                        display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '4px',
                                                        fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase',
                                                        background: statusStyle.bg, color: statusStyle.color,
                                                        marginBottom: '0.5rem'
                                                    }}>
                                                        {status.replace('_', ' ')}
                                                    </div>

                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                                                        <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)', lineHeight: '1.2' }}>{u.name}</span>
                                                    </div>

                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-blue)', background: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                                            {u.concessionaria || 'Sem conc.'}
                                                        </span>
                                                        <span style={{ fontSize: '0.75rem', color: '#666', background: '#f3f4f6', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                                            {u.supplier?.name || 'Sem Fornecedor'}
                                                        </span>
                                                    </div>

                                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', marginBottom: '0.5rem' }}>
                                                        <div style={{ background: 'var(--color-bg-light)', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', flex: 1 }}>
                                                            <div style={{ color: 'var(--color-text-light)', fontSize: '0.65rem' }}>Potência</div>
                                                            <div style={{ fontWeight: 'bold' }}>{u.potencia_kwp} kWp</div>
                                                        </div>
                                                        <div style={{ background: 'var(--color-bg-light)', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', flex: 1 }}>
                                                            <div style={{ color: 'var(--color-text-light)', fontSize: '0.65rem' }}>Geração Est.</div>
                                                            <div style={{ fontWeight: 'bold', color: 'var(--color-success)' }}>{u.geracao_estimada_kwh} kWh</div>
                                                        </div>
                                                    </div>

                                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                                        <span>{u.address?.cidade}/{u.address?.uf}</span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setSelectedUsinaForClosings(u); setIsClosingsModalOpen(true); }}
                                                            style={{
                                                                background: 'none', border: 'none', color: '#3b82f6', fontSize: '0.8rem',
                                                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem'
                                                            }}
                                                        >
                                                            <FileText size={14} /> Fechamentos
                                                        </button>
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
                <PowerPlantModal
                    usina={editingUsina}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}

            {isClosingsModalOpen && (
                <PlantClosingsHistoryModal
                    usina={selectedUsinaForClosings}
                    onClose={() => setIsClosingsModalOpen(false)}
                />
            )}
        </div>
    );
}
