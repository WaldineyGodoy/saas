
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit, Trash, Search, Copy } from 'lucide-react';
import OriginatorModal from '../../components/OriginatorModal';
import { buildReferralUrl } from '../../lib/originador';

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

    // O botão "Processar Comissões" foi removido daqui.
    //
    // Ele chamava a RPC `generate_monthly_commissions`, que calcula por
    // `profiles.commission_split` + `superior_id` — não é a fonte oficial.
    // A comissão que vale é `originators_v2.split_commission`, aplicada pelo
    // gatilho `handle_invoice_paid_ledger` a cada fatura paga, direto no
    // razão (conta 2.1.2). Ou seja: já é lançada sozinha, não há o que
    // "processar" no fim do mês.
    //
    // Manter o botão era um caminho de pagamento em duplicidade: gerava
    // linhas em `commissions` a partir da fonte descartada, e essas linhas
    // alimentavam um botão "Pagar" que dispara PIX de verdade — em cima do
    // que o razão já tinha registrado.

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

    // Recebe o registro inteiro, e não só o id: o link precisa do nome (a
    // saudação da landing) e do `short_url`, quando já houver.
    const copyLink = (originator) => {
        const url = buildReferralUrl(originator);
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
                                                <button onClick={() => copyLink(item)} title="Copiar Link de Indicação" className="btn btn-secondary" style={{ padding: '0.3rem', border: 'none' }}>
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
                    key={selectedOriginator?.id}
                    originator={selectedOriginator}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}
