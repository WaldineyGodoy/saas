import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Zap,
    Plus,
    Search,
    Edit,
    Trash2,
    CheckCircle2,
    XCircle,
    Layers,
    BatteryCharging,
    SunMedium,
    Sparkles,
    Clock,
    RefreshCw,
    Link2,
    Building2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import PlanModal from './components/PlanModal';
import EletropostoPlanModal, { extractSubscriptionPlanLastro } from './components/EletropostoPlanModal';

export default function PlansServicesSettings() {
    const { showAlert } = useUI();
    const [activeTab, setActiveTab] = useState('assinatura'); // 'assinatura' | 'eletropostos' | 'usinas'

    // Todos os registros carregados de planos_assinatura_energia
    const [planos, setPlanos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchTermEletro, setSearchTermEletro] = useState('');

    // Modais
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState(null);

    const [isEletroModalOpen, setIsEletroModalOpen] = useState(false);
    const [selectedEletroPlan, setSelectedEletroPlan] = useState(null);

    // Carregar planos do Supabase
    const fetchPlanos = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('planos_assinatura_energia')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setPlanos(data || []);
        } catch (err) {
            console.error('Erro ao buscar planos:', err);
            showAlert('Erro ao carregar planos: ' + (err.message || 'Erro de conexão'), 'error');
        } finally {
            setLoading(false);
        }
    }, [showAlert]);

    useEffect(() => {
        fetchPlanos();
    }, [fetchPlanos]);

    // Separação por categoria (Assinatura vs Eletropostos)
    const planosAssinatura = useMemo(
        () => planos.filter(p => p.recorrente_config?.categoria_plano !== 'eletroposto'),
        [planos]
    );

    const planosEletroposto = useMemo(
        () => planos.filter(p => p.recorrente_config?.categoria_plano === 'eletroposto'),
        [planos]
    );

    // Handlers — Planos de Assinatura
    const handleCreateNewAssinatura = () => {
        setSelectedPlan(null);
        setIsModalOpen(true);
    };

    const handleEditAssinatura = (plano) => {
        setSelectedPlan(plano);
        setIsModalOpen(true);
    };

    // Handlers — Planos de Eletroposto
    const handleCreateNewEletroposto = () => {
        setSelectedEletroPlan(null);
        setIsEletroModalOpen(true);
    };

    const handleEditEletroposto = (plano) => {
        setSelectedEletroPlan(plano);
        setIsEletroModalOpen(true);
    };

    // Alternar status ativo/inativo
    const handleToggleStatus = async (plano) => {
        const novoStatus = !plano.ativo;
        try {
            const { error } = await supabase
                .from('planos_assinatura_energia')
                .update({ ativo: novoStatus, updated_at: new Date().toISOString() })
                .eq('id', plano.id);

            if (error) throw error;
            setPlanos(prev => prev.map(p => p.id === plano.id ? { ...p, ativo: novoStatus } : p));
            showAlert(`Plano "${plano.nome}" ${novoStatus ? 'ativado' : 'desativado'} com sucesso!`, 'success');
        } catch (err) {
            console.error('Erro ao alternar status do plano:', err);
            showAlert('Erro ao alterar status: ' + err.message, 'error');
        }
    };

    // Excluir plano
    const handleDelete = async (plano) => {
        if (!window.confirm(`Tem certeza que deseja excluir o plano "${plano.nome}"? Esta ação não pode ser desfeita.`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('planos_assinatura_energia')
                .delete()
                .eq('id', plano.id);

            if (error) throw error;
            setPlanos(prev => prev.filter(p => p.id !== plano.id));
            showAlert(`Plano "${plano.nome}" excluído com sucesso!`, 'success');
        } catch (err) {
            console.error('Erro ao excluir plano:', err);
            showAlert('Erro ao excluir plano: ' + err.message, 'error');
        }
    };

    // Filtros de pesquisa
    const planosAssinaturaFiltrados = planosAssinatura.filter(p =>
        p.nome?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const planosEletropostoFiltrados = planosEletroposto.filter(p =>
        p.nome?.toLowerCase().includes(searchTermEletro.toLowerCase()) ||
        p.recorrente_config?.plano_assinatura_vinculado?.nome?.toLowerCase().includes(searchTermEletro.toLowerCase())
    );

    // Formata o resumo do modelo de recompensas
    const renderRewardBadge = (plano) => {
        if (!plano.recompensas_ativo) {
            return (
                <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    padding: '0.25rem 0.65rem', borderRadius: '20px', fontSize: '0.74rem',
                    fontWeight: 600, background: '#f1f5f9', color: '#64748b'
                }}>
                    Desativada
                </span>
            );
        }

        switch (plano.tipo_recompensa) {
            case 'start':
                return (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                        padding: '0.25rem 0.65rem', borderRadius: '20px', fontSize: '0.74rem',
                        fontWeight: 700, background: '#e0f2fe', color: '#0284c7'
                    }}>
                        <Sparkles size={12} />
                        Start ({plano.start_config?.faturas_elegiveis?.map(f => `Fat. ${f}`).join(', ') || 'Fat. 2'})
                    </span>
                );
            case 'recorrente':
                return (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                        padding: '0.25rem 0.65rem', borderRadius: '20px', fontSize: '0.74rem',
                        fontWeight: 700, background: '#dcfce7', color: '#15803d'
                    }}>
                        <Clock size={12} />
                        Recorrente (Status Ativo)
                    </span>
                );
            case 'hibrido':
                return (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                        padding: '0.25rem 0.65rem', borderRadius: '20px', fontSize: '0.74rem',
                        fontWeight: 700, background: '#f3e8ff', color: '#7e22ce'
                    }}>
                        <Layers size={12} />
                        Híbrido (Start + Status Ativo)
                    </span>
                );
            default:
                return <span>-</span>;
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Header Principal */}
            <div>
                <h3 style={{ margin: '0 0 0.35rem 0', fontSize: '1.4rem', color: '#0f172a', fontWeight: 800 }}>
                    Planos e Serviços
                </h3>
                <p style={{ margin: 0, fontSize: '0.86rem', color: '#64748b' }}>
                    Configure os planos comerciais de Assinatura (Lastro Concessionária) e Eletropostos (Lastro Plano de Assinatura sem Fio B).
                </p>
            </div>

            {/* Navegação por 3 Abas Horizontais */}
            <div style={{
                display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e2e8f0',
                paddingBottom: '0.5rem'
            }}>
                <button
                    onClick={() => setActiveTab('assinatura')}
                    style={{
                        padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none',
                        background: activeTab === 'assinatura' ? '#0284c7' : 'transparent',
                        color: activeTab === 'assinatura' ? 'white' : '#64748b',
                        fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        transition: 'all 0.15s'
                    }}
                >
                    <Zap size={16} />
                    Energia por Assinatura ({planosAssinatura.length})
                </button>

                <button
                    onClick={() => setActiveTab('eletropostos')}
                    style={{
                        padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none',
                        background: activeTab === 'eletropostos' ? '#059669' : 'transparent',
                        color: activeTab === 'eletropostos' ? 'white' : '#64748b',
                        fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        transition: 'all 0.15s'
                    }}
                >
                    <BatteryCharging size={16} />
                    Eletropostos ({planosEletroposto.length})
                </button>

                <button
                    onClick={() => setActiveTab('usinas')}
                    style={{
                        padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none',
                        background: activeTab === 'usinas' ? '#0284c7' : 'transparent',
                        color: activeTab === 'usinas' ? 'white' : '#64748b',
                        fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        transition: 'all 0.15s'
                    }}
                >
                    <SunMedium size={16} />
                    Usinas
                </button>
            </div>

            {/* CONTEÚDO DA ABA 1: ENERGIA POR ASSINATURA */}
            {activeTab === 'assinatura' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Barra de Ações do Topo */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        flexWrap: 'wrap', gap: '1rem', background: 'white', padding: '1rem 1.25rem',
                        borderRadius: '14px', border: '1px solid #e2e8f0'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '240px' }}>
                            <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
                                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                <input
                                    type="text"
                                    placeholder="Buscar plano de assinatura..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    style={{
                                        width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.2rem',
                                        borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem',
                                        outline: 'none', boxSizing: 'border-box'
                                    }}
                                />
                            </div>
                            <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                                {planosAssinaturaFiltrados.length} {planosAssinaturaFiltrados.length === 1 ? 'plano cadastrado' : 'planos cadastrados'}
                            </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button
                                onClick={fetchPlanos}
                                title="Atualizar lista"
                                style={{
                                    padding: '0.6rem', borderRadius: '10px', border: '1px solid #e2e8f0',
                                    background: 'white', color: '#64748b', cursor: 'pointer', display: 'flex',
                                    transition: 'all 0.15s'
                                }}
                            >
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            </button>
                            <button
                                onClick={handleCreateNewAssinatura}
                                style={{
                                    padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none',
                                    background: '#0284c7', color: 'white', fontWeight: 700, fontSize: '0.86rem',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)', transition: 'background 0.15s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#0369a1'}
                                onMouseLeave={e => e.currentTarget.style.background = '#0284c7'}
                            >
                                <Plus size={18} />
                                Criar Plano de Assinatura
                            </button>
                        </div>
                    </div>

                    {/* Tabela de Planos de Assinatura */}
                    <div style={{
                        background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0',
                        overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                        {loading && planosAssinatura.length === 0 ? (
                            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                                <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 0.75rem auto', color: '#0284c7' }} />
                                <p style={{ margin: 0, fontSize: '0.9rem' }}>Carregando planos de assinatura...</p>
                            </div>
                        ) : planosAssinaturaFiltrados.length === 0 ? (
                            <div style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
                                <div style={{
                                    width: '56px', height: '56px', borderRadius: '50%', background: '#f0f9ff',
                                    color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    margin: '0 auto 1rem auto'
                                }}>
                                    <Zap size={28} />
                                </div>
                                <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '1.05rem', color: '#1e293b' }}>
                                    {searchTerm ? 'Nenhum plano corresponde à busca' : 'Nenhum plano de assinatura cadastrado'}
                                </h4>
                                <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.84rem', color: '#64748b', maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto' }}>
                                    {searchTerm
                                        ? 'Tente buscar por outro termo ou limpe o campo de busca.'
                                        : 'Comece criando o primeiro plano comercial com lastro na concessionária e parametrização de recompensas.'}
                                </p>
                                {!searchTerm && (
                                    <button
                                        onClick={handleCreateNewAssinatura}
                                        style={{
                                            padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none',
                                            background: '#0284c7', color: 'white', fontWeight: 600, fontSize: '0.85rem',
                                            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem'
                                        }}
                                    >
                                        <Plus size={16} />
                                        Criar Meu Primeiro Plano
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Nome do Plano</th>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Lastro Concessionária</th>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Desconto Assinante</th>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Modelo de Recompensa</th>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Status</th>
                                            <th style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {planosAssinaturaFiltrados.map(plano => {
                                            const lastroInfo = extractSubscriptionPlanLastro(plano);
                                            return (
                                                <tr key={plano.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.92rem' }}>
                                                            {plano.nome}
                                                        </div>
                                                        <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '2px' }}>
                                                            Criado em {new Date(plano.created_at).toLocaleDateString('pt-BR')}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#334155', fontSize: '0.84rem' }}>
                                                            <Building2 size={14} color="#0284c7" />
                                                            {lastroInfo.concessionariaNome}
                                                        </div>
                                                        <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                                                            Tarifa: R$ {lastroInfo.tarifaConcessionaria.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        <span style={{
                                                            fontSize: '0.95rem', fontWeight: 800, color: '#0284c7',
                                                            background: '#e0f2fe', padding: '0.2rem 0.6rem', borderRadius: '8px'
                                                        }}>
                                                            {Number(plano.desconto_assinante).toFixed(2)}%
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        {renderRewardBadge(plano)}
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        <button
                                                            onClick={() => handleToggleStatus(plano)}
                                                            style={{
                                                                background: 'none', border: 'none', cursor: 'pointer',
                                                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                                                color: plano.ativo ? '#16a34a' : '#94a3b8', fontWeight: 600, fontSize: '0.8rem',
                                                                padding: 0
                                                            }}
                                                        >
                                                            {plano.ativo ? (
                                                                <>
                                                                    <CheckCircle2 size={16} color="#16a34a" />
                                                                    Ativo
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <XCircle size={16} color="#94a3b8" />
                                                                    Inativo
                                                                </>
                                                            )}
                                                        </button>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem', textAlign: 'right' }}>
                                                        <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                                                            <button
                                                                onClick={() => handleEditAssinatura(plano)}
                                                                title="Editar plano"
                                                                style={{
                                                                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
                                                                    padding: '0.45rem', cursor: 'pointer', color: '#0284c7', display: 'flex',
                                                                    transition: 'all 0.15s'
                                                                }}
                                                            >
                                                                <Edit size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(plano)}
                                                                title="Excluir plano"
                                                                style={{
                                                                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
                                                                    padding: '0.45rem', cursor: 'pointer', color: '#ef4444', display: 'flex',
                                                                    transition: 'all 0.15s'
                                                                }}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* CONTEÚDO DA ABA 2: ELETROPOSTOS (COM LASTRO NO PLANO DE ASSINATURA E SEM FIO B) */}
            {activeTab === 'eletropostos' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Barra de Ações Eletropostos */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        flexWrap: 'wrap', gap: '1rem', background: 'white', padding: '1rem 1.25rem',
                        borderRadius: '14px', border: '1px solid #e2e8f0'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '240px' }}>
                            <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
                                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                <input
                                    type="text"
                                    placeholder="Buscar plano de eletroposto..."
                                    value={searchTermEletro}
                                    onChange={e => setSearchTermEletro(e.target.value)}
                                    style={{
                                        width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.2rem',
                                        borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem',
                                        outline: 'none', boxSizing: 'border-box'
                                    }}
                                />
                            </div>
                            <span style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                                {planosEletropostoFiltrados.length} {planosEletropostoFiltrados.length === 1 ? 'plano de eletroposto' : 'planos de eletroposto'}
                            </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button
                                onClick={fetchPlanos}
                                title="Atualizar lista"
                                style={{
                                    padding: '0.6rem', borderRadius: '10px', border: '1px solid #e2e8f0',
                                    background: 'white', color: '#64748b', cursor: 'pointer', display: 'flex'
                                }}
                            >
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            </button>
                            <button
                                onClick={handleCreateNewEletroposto}
                                style={{
                                    padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none',
                                    background: '#059669', color: 'white', fontWeight: 700, fontSize: '0.86rem',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    boxShadow: '0 2px 4px rgba(5, 150, 105, 0.25)', transition: 'background 0.15s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#047857'}
                                onMouseLeave={e => e.currentTarget.style.background = '#059669'}
                            >
                                <Plus size={18} />
                                Criar Plano de Eletroposto
                            </button>
                        </div>
                    </div>

                    {/* Tabela de Planos de Eletropostos */}
                    <div style={{
                        background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0',
                        overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                    }}>
                        {loading && planosEletroposto.length === 0 ? (
                            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                                <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 0.75rem auto', color: '#059669' }} />
                                <p style={{ margin: 0, fontSize: '0.9rem' }}>Carregando planos de eletropostos...</p>
                            </div>
                        ) : planosEletropostoFiltrados.length === 0 ? (
                            <div style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
                                <div style={{
                                    width: '60px', height: '60px', borderRadius: '50%', background: '#ecfdf5',
                                    color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    margin: '0 auto 1rem auto'
                                }}>
                                    <BatteryCharging size={30} />
                                </div>
                                <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '1.08rem', color: '#1e293b', fontWeight: 700 }}>
                                    {searchTermEletro ? 'Nenhum plano de eletroposto encontrado' : 'Nenhum Plano de Eletroposto Cadastrado'}
                                </h4>
                                <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.85rem', color: '#64748b', maxWidth: '480px', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
                                    Crie planos de recarga para eletropostos vinculados ao Lastro de um Plano de Assinatura (Tarifa da Concessionária menos o Desconto do Assinante, sem Fio B).
                                </p>
                                {!searchTermEletro && (
                                    <button
                                        onClick={handleCreateNewEletroposto}
                                        style={{
                                            padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none',
                                            background: '#059669', color: 'white', fontWeight: 700, fontSize: '0.85rem',
                                            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem'
                                        }}
                                    >
                                        <Plus size={16} />
                                        Criar Primeiro Plano de Eletroposto
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Plano de Eletroposto</th>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Lastro (Plano de Assinatura Vinculado)</th>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Desconto Recarga</th>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Modelo de Recompensa</th>
                                            <th style={{ padding: '0.85rem 1.25rem' }}>Status</th>
                                            <th style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {planosEletropostoFiltrados.map(plano => {
                                            const vinc = plano.recorrente_config?.plano_assinatura_vinculado || {};
                                            const lastroVal = Number(plano.recorrente_config?.lastro_tarifario?.tarifa_bruta ?? vinc.valor_lastro_eletroposto ?? 0.8755);
                                            return (
                                                <tr key={plano.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.92rem' }}>
                                                            {plano.nome}
                                                        </div>
                                                        <div style={{ fontSize: '0.74rem', color: '#059669', fontWeight: 600, marginTop: '2px' }}>
                                                            Isento de Fio B (deduzido na assinatura)
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#1e293b', fontSize: '0.84rem' }}>
                                                            <Link2 size={14} color="#059669" />
                                                            {vinc.nome || 'Plano de Assinatura'}
                                                        </div>
                                                        <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                                                            Lastro: <strong>R$ {lastroVal.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}/kWh</strong>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        <span style={{
                                                            fontSize: '0.95rem', fontWeight: 800, color: '#059669',
                                                            background: '#ecfdf5', padding: '0.2rem 0.6rem', borderRadius: '8px'
                                                        }}>
                                                            {Number(plano.desconto_assinante).toFixed(2)}%
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        {renderRewardBadge(plano)}
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem' }}>
                                                        <button
                                                            onClick={() => handleToggleStatus(plano)}
                                                            style={{
                                                                background: 'none', border: 'none', cursor: 'pointer',
                                                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                                                color: plano.ativo ? '#16a34a' : '#94a3b8', fontWeight: 600, fontSize: '0.8rem',
                                                                padding: 0
                                                            }}
                                                        >
                                                            {plano.ativo ? (
                                                                <>
                                                                    <CheckCircle2 size={16} color="#16a34a" />
                                                                    Ativo
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <XCircle size={16} color="#94a3b8" />
                                                                    Inativo
                                                                </>
                                                            )}
                                                        </button>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.25rem', textAlign: 'right' }}>
                                                        <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                                                            <button
                                                                onClick={() => handleEditEletroposto(plano)}
                                                                title="Editar plano de eletroposto"
                                                                style={{
                                                                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
                                                                    padding: '0.45rem', cursor: 'pointer', color: '#059669', display: 'flex'
                                                                }}
                                                            >
                                                                <Edit size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(plano)}
                                                                title="Excluir plano de eletroposto"
                                                                style={{
                                                                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
                                                                    padding: '0.45rem', cursor: 'pointer', color: '#ef4444', display: 'flex'
                                                                }}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* CONTEÚDO DA ABA 3: USINAS (PLACEHOLDER) */}
            {activeTab === 'usinas' && (
                <div style={{
                    background: 'white', borderRadius: '16px', border: '1px dashed #cbd5e1',
                    padding: '4rem 2rem', textAlign: 'center'
                }}>
                    <div style={{
                        width: '64px', height: '64px', borderRadius: '50%', background: '#fffbeb',
                        color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 1.25rem auto'
                    }}>
                        <SunMedium size={32} />
                    </div>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', color: '#1e293b', fontWeight: 700 }}>
                        Módulo de Usinas
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: '#64748b', maxWidth: '460px', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
                        As políticas de remuneração de geração, faixas de rateio e tarifas de usinas parceiras serão configuradas nesta seção em breve.
                    </p>
                </div>
            )}

            {/* Modal de Criação / Edição — Planos de Assinatura (Lastro Concessionária) */}
            <PlanModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={fetchPlanos}
                planToEdit={selectedPlan}
            />

            {/* Modal de Criação / Edição — Planos de Eletroposto (Lastro Plano de Assinatura sem Fio B) */}
            <EletropostoPlanModal
                isOpen={isEletroModalOpen}
                onClose={() => setIsEletroModalOpen(false)}
                onSave={fetchPlanos}
                planToEdit={selectedEletroPlan}
                subscriptionPlans={planosAssinatura}
            />
        </div>
    );
}
