import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import SupplierModal from '../../components/SupplierModal';

export default function SupplierList() {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);

    useEffect(() => {
        fetchSuppliers();
    }, []);

    const fetchSuppliers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('suppliers')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setSuppliers(data || []);
        } catch (error) {
            console.error('Erro suppliers', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = () => {
        fetchSuppliers();
        setIsModalOpen(false);
    };

    const handleDelete = (id) => {
        setSuppliers(suppliers.filter(s => s.id !== id));
        setIsModalOpen(false);
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Fornecedores (Geradores)</h2>
                <button
                    onClick={() => { setEditingSupplier(null); setIsModalOpen(true); }}
                    className="btn btn-primary"
                >
                    + Novo Fornecedor
                </button>
            </div>

            {loading ? <p>Carregando...</p> : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="table-container">
                        {suppliers.length === 0 ? (
                            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhum fornecedor cadastrado.</p>
                        ) : (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Nome/Razão Social</th>
                                        <th>CNPJ</th>
                                        <th>Contato</th>
                                        <th>Status</th>
                                        <th>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {suppliers.map(s => (
                                        <tr key={s.id}>
                                            <td style={{ fontWeight: 'bold' }}>{s.name}</td>
                                            <td>{s.cnpj}</td>
                                            <td>
                                                <div>{s.email}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)' }}>{s.phone}</div>
                                            </td>
                                            <td>
                                                <span style={{
                                                    padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '0.8rem', fontWeight: '500',
                                                    background: s.status === 'ativo' ? '#dcfce7' : s.status === 'ativacao' ? '#fef9c3' : '#f1f5f9',
                                                    color: s.status === 'ativo' ? '#166534' : s.status === 'ativacao' ? '#854d0e' : '#64748b'
                                                }}>
                                                    {s.status === 'ativacao' ? 'ATIVAÇÃO' : s.status?.toUpperCase()}
                                                </span>
                                            </td>
                                            <td>
                                                <button
                                                    onClick={() => { setEditingSupplier(s); setIsModalOpen(true); }}
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
            )}

            {isModalOpen && (
                <SupplierModal
                    supplier={editingSupplier}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
