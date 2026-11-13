
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit, Trash, Search, Copy } from 'lucide-react';
import OriginatorModal from '../../components/OriginatorModal';
import { buildReferralUrl } from '../../lib/originador';
import { listarPlanosOriginador, planoOriginadorAusente, planoPadraoDe, resumoPlanoOriginador } from '../../lib/planoOriginador';

export default function OriginatorList() {
    const [originators, setOriginators] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedOriginator, setSelectedOriginator] = useState(null);
    // null = Planos do Originador ainda não existem no banco (migração não aplicada).
    const [planos, setPlanos] = useState([]);

    useEffect(() => {
        fetchOriginators();
        listarPlanosOriginador(supabase)
            .then(setPlanos)
            .catch(error => {
                if (!planoOriginadorAusente(error)) console.error('Erro ao carregar Planos do Originador:', error);
                setPlanos(null);
            });
    }, []);

    const planoPadrao = planoPadraoDe(planos || []);
    // Padrão: a regra muda conforme o plano de assinatura de cada UC, então
    // a lista não promete número. Exceção: o resumo vale para todas as UCs.
    const celulaPlano = (item) => {
        if (planos === null) {
            return <span style={{ fontSize: '0.8rem', color: 'var(--color-text-light)' }} title="Planos do Originador ainda não disponíveis neste ambiente">—</span>;
        }
        const plano = (planos.find(p => p.id === item.plano_originador_id)) || planoPadrao;
        if (!plano) return <span style={{ fontSize: '0.8rem', color: 'var(--color-text-light)' }}>—</span>;
        const cargo = (item.cargo || 'ppf').toLowerCase();
        return (
            <div>
                <span className="badge badge-success">{plano.nome}</span>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-medium)', marginTop: '0.25rem' }}>
                    {plano.padrao ? 'segue o plano de assinatura de cada UC' : resumoPlanoOriginador(plano, cargo)}
                </div>
            </div>
        );
    };

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
    // A comissão que vale é a do Plano do Originador (`planos_originador`,
    // pela precedência de `fn_plano_originador_efetivo`), aplicada pelo
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
                                    <th>Plano</th>
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
                                            <td>{celulaPlano(item)}</td>
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
