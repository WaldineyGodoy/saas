
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit, Trash, Search, Copy } from 'lucide-react';
import OriginatorModal from '../../components/OriginatorModal';

export default function OriginatorList() {
    const [originators, setOriginators] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedOriginator, setSelectedOriginator] = useState(null);

    useEffect(() => {
        fetchOriginators();
    }, []);

    const fetchOriginators = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('originators_v2')
            .select('*')
            .order('name');

        if (error) console.error('Error fetching originators:', error);
        else setOriginators(data || []);
        setLoading(false);
    };

    const handleProcessCommissions = async () => {
        if (!confirm('Deseja processar as comissões deste mês? Isso irá gerar registros financeiros para todas as faturas pagas.')) return;

        setLoading(true);
        try {
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const { data, error } = await supabase.rpc('generate_monthly_commissions', { target_date: today });

            if (error) throw error;

            alert(`Processamento concluído!\nFaturas processadas: ${data.invoices_processed}\nValor total gerado: R$ ${data.total_commission_value}`);
        } catch (error) {
            console.error('Error processing commissions:', error);
            alert('Erro ao processar comissões: ' + (error.message || 'Erro desconhecido'));
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (originator) => {
        setSelectedOriginator(originator);
        setIsModalOpen(true);
    };

    const handleNew = () => {
        setSelectedOriginator(null);
        setIsModalOpen(true);
    };

    const handleSave = (saved) => {
        fetchOriginators();
    };

    const handleDelete = (id) => {
        fetchOriginators(); // Re-fetch list
    };

    const copyLink = (id) => {
        const url = `${window.location.origin}/clientes?id=${id}`;
        navigator.clipboard.writeText(url);
        alert('Link copiado: ' + url);
    };

    const filtered = originators.filter(o =>
        o.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2>Gestão de Originadores</h2>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button
                        onClick={handleProcessCommissions}
                        className="btn"
                        style={{
                            background: 'var(--color-success)', color: 'white'
                        }}
                    >
                        💲 Processar Comissões
                    </button>
                    <button
                        onClick={handleNew}
                        className="btn btn-accent"
                    >
                        <Plus size={18} /> Novo Originador
                    </button>
                </div>
            </div>

            <div style={{ marginBottom: '1rem', position: 'relative' }}>
                <input
                    type="text"
                    placeholder="Buscar originador..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="input"
                    style={{ paddingLeft: '2.5rem' }}
                />
                <Search size={18} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-light)' }} />
            </div>

            {loading ? <p>Carregando...</p> : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Contato</th>
                                    <th>Comissão (Start/Rec.)</th>
                                    <th>Chave PIX</th>
                                    <th>Link</th>
                                    <th style={{ textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 ? (
                                    <tr><td colSpan="6" style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhum originador encontrado.</td></tr>
                                ) : (
                                    filtered.map(item => (
                                        <tr key={item.id}>
                                            <td>
                                                <div style={{ fontWeight: 'bold', color: 'var(--color-blue)' }}>{item.name}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-medium)' }}>{item.cpf_cnpj}</div>
                                            </td>
                                            <td>
                                                <div style={{ fontSize: '0.9rem' }}>{item.email}</div>
                                                <div style={{ fontSize: '0.9rem' }}>{item.phone}</div>
                                            </td>
                                            <td>
                                                <span className="badge badge-success">
                                                    {item.split_commission?.start || 0}% / {item.split_commission?.recurrent || 0}%
                                                </span>
                                            </td>
                                            <td style={{ fontSize: '0.9rem' }}>{item.pix_key || '-'}</td>
                                            <td>
                                                <button onClick={() => copyLink(item.id)} title="Copiar Link de Indicação" className="btn btn-secondary" style={{ padding: '0.3rem', border: 'none' }}>
                                                    <Copy size={16} color="var(--color-blue)" />
                                                </button>
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                                <button onClick={() => handleEdit(item)} className="btn btn-secondary" style={{ padding: '0.3rem', border: 'none', color: 'var(--color-text-medium)' }}>
                                                    <Edit size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {isModalOpen && (
                <OriginatorModal
                    originator={selectedOriginator}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
