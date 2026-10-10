import { useState } from 'react';
import { Plus, Edit, Trash2, GitBranch, RefreshCw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import PlanoUsinaModal from './PlanoUsinaModal';

/**
 * Tabela dos Planos de Usina na aba Usinas de Planos e Servicos.
 * `planosUsina` vem com `usinas: [{ count }]` (embed do PostgREST pela FK
 * usinas.plano_usina_id).
 */
export default function PlanosUsinaLista({ planosUsina, planosRecompensa, loading, onRefresh, showAlert }) {
    const [modal, setModal] = useState(null); // { modo, plano, usinas }

    const nUsinas = (p) => p.usinas?.[0]?.count ?? 0;
    const nomeRecompensas = (id) => planosRecompensa.find(p => p.id === id)?.nome;

    const excluir = async (plano) => {
        if (nUsinas(plano) > 0) {
            showAlert(`O plano "${plano.nome}" tem ${nUsinas(plano)} usina(s). Plano com usina não se exclui: crie uma nova versão e mova as usinas, se for o caso.`, 'warning');
            return;
        }
        if (!window.confirm(`Excluir o plano de usina "${plano.nome}"? Esta ação não pode ser desfeita.`)) return;
        const { error } = await supabase.from('planos_usina').delete().eq('id', plano.id);
        if (error) {
            showAlert('Erro ao excluir plano de usina: ' + error.message, 'error');
            return;
        }
        showAlert(`Plano "${plano.nome}" excluído.`, 'success');
        onRefresh();
    };

    const botao = (cor) => ({
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.45rem',
        cursor: 'pointer', color: cor, display: 'flex'
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', background: 'white', padding: '1rem 1.25rem', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                <div>
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>Planos de Usina</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Gestão B2W, termos do contrato, plano de recompensas e originador da usina</div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button onClick={onRefresh} title="Atualizar lista" style={{ padding: '0.6rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', cursor: 'pointer', display: 'flex' }}>
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => setModal({ modo: 'novo', plano: null, usinas: 0 })}
                        style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none', background: '#0284c7', color: 'white', fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        <Plus size={18} />
                        Criar Plano de Usina
                    </button>
                </div>
            </div>

            <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                {planosUsina.length === 0 ? (
                    <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
                        {loading ? 'Carregando planos de usina...' : 'Nenhum plano de usina cadastrado.'}
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    <th style={{ padding: '0.85rem 1rem' }}>Plano</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Gestão</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Administração</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Recuperação</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Originador</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Recompensas</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Usinas</th>
                                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {planosUsina.map(p => (
                                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{p.nome}</div>
                                            {p.descricao && <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{p.descricao}</div>}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>{Number(p.percentual_recorrente)}%</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>R$ {Number(p.taxa_admin_reais).toFixed(2).replace('.', ',')}/consumidor</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>{Number(p.taxa_recuperacao_pct)}%</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            {Number(p.originador_recorrente_pct)}%
                                            {(p.originador_bonus_fechamentos || []).length > 0 && ` + bônus ${p.originador_bonus_fechamentos.join(', ')}º fech.`}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', color: p.plano_assinatura_id ? '#0f172a' : '#b45309' }}>
                                            {nomeRecompensas(p.plano_assinatura_id) || 'sem plano de recompensas'}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', color: p.status === 'ativo' ? '#16a34a' : '#64748b', fontWeight: 600 }}>
                                            {p.status === 'ativo' ? 'Ativo' : 'Somente contratos'}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem' }}>{nUsinas(p)}</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                                                <button title="Editar" onClick={() => setModal({ modo: 'editar', plano: p, usinas: nUsinas(p) })} style={botao('#0284c7')}>
                                                    <Edit size={16} />
                                                </button>
                                                {p.status === 'ativo' && (
                                                    <button title="Criar nova versão" onClick={() => setModal({ modo: 'versao', plano: p, usinas: nUsinas(p) })} style={botao('#7c3aed')}>
                                                        <GitBranch size={16} />
                                                    </button>
                                                )}
                                                <button title="Excluir" onClick={() => excluir(p)} style={botao('#ef4444')}>
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <PlanoUsinaModal
                isOpen={!!modal}
                modo={modal?.modo}
                plano={modal?.plano}
                usinasVinculadas={modal?.usinas ?? 0}
                planosRecompensa={planosRecompensa}
                onClose={() => setModal(null)}
                onSave={onRefresh}
                showAlert={showAlert}
            />
        </div>
    );
}
