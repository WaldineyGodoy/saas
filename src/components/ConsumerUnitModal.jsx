import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import { ChevronDown, ChevronUp, History, X, User, Home, Zap, Link, Settings, Key, Eye, EyeOff } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';

export default function ConsumerUnitModal({ consumerUnit, onClose, onSave, onDelete }) {
    const { showAlert, showConfirm } = useUI();
    const [subscribers, setSubscribers] = useState([]);
    const [usinas, setUsinas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showCredentialsModal, setShowCredentialsModal] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    // Helpers for Currency/Numbers
    const formatCurrency = (val) => {
        if (!val && val !== 0) return '';
        const number = Number(val);
        if (isNaN(number)) return '';
        return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4 });
    };

    const parseCurrency = (str) => {
        if (!str || typeof str !== 'string') return 0;
        const digits = str.replace(/\D/g, '');
        return Number(digits) / 10000; // 4 decimals for tariff
    };

    const handleCurrencyChange = (field, value) => {
        const digits = value.replace(/\D/g, '');
        const number = Number(digits) / 10000;
        const formatted = number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4 });
        setFormData(prev => ({ ...prev, [field]: formatted }));
    };

    // Helper for CEP Mask
    const maskCEP = (val) => {
        return val.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9);
    };

    // Status Options
    const statusOptions = [
        { value: 'em_ativacao', label: 'Em Ativação' },
        { value: 'aguardando_conexao', label: 'Aguardando Conexão' },
        { value: 'ativo', label: 'Ativo' },
        { value: 'sem_geracao', label: 'Sem Geração' },
        { value: 'em_atraso', label: 'Em Atraso' },
        { value: 'cancelado', label: 'Cancelado' },
        { value: 'cancelado_inadimplente', label: 'Cancelado (Inadimplente)' }
    ];

    const modalidadeOptions = [
        { value: 'auto_consumo_remoto', label: 'Auto Consumo Remoto' },
        { value: 'geracao_compartilhada', label: 'Geração Compartilhada' }
    ];

    const tipoLigacaoOptions = [
        { value: 'monofasico', label: 'Monofásico' },
        { value: 'bifasico', label: 'Bifásico' },
        { value: 'trifasico', label: 'Trifásico' }
    ];

    const vencimentoOptions = [1, 5, 10, 15, 20, 25, 30];

    const [formData, setFormData] = useState({
        subscriber_id: '',
        usina_id: '',
        status: 'em_ativacao',
        numero_uc: '',
        titular_conta: '',
        modalidade: 'geracao_compartilhada',
        concessionaria: '',
        tipo_ligacao: 'trifasico',
        franquia: '', // kWh
        tarifa_concessionaria: '', // String masked
        te: '', // New
        tusd: '', // New
        fio_b: '', // New
        tarifa_minima: '', // Calculated/Displayed
        desconto_assinante: '',
        dia_vencimento: 10,
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        portal_credentials: { url: '', login: '', password: '' }
    });

    useEffect(() => {
        fetchSubscribers();
        fetchUsinas();
    }, []); // Run once on mount

    useEffect(() => {
        if (consumerUnit) {
            setFormData({
                subscriber_id: consumerUnit.subscriber_id || '',
                usina_id: consumerUnit.usina_id || '',
                status: consumerUnit.status || 'em_ativacao',
                numero_uc: consumerUnit.numero_uc || '',
                titular_conta: consumerUnit.titular_conta || '',
                modalidade: consumerUnit.modalidade || 'geracao_compartilhada',
                concessionaria: consumerUnit.concessionaria || '',
                tipo_ligacao: consumerUnit.tipo_ligacao || 'trifasico',
                franquia: consumerUnit.franquia || '',
                tarifa_concessionaria: formatCurrency(consumerUnit.tarifa_concessionaria),
                te: formatCurrency(consumerUnit.te),
                tusd: formatCurrency(consumerUnit.tusd),
                fio_b: formatCurrency(consumerUnit.fio_b),
                tarifa_minima: '', // Recalculated on render
                desconto_assinante: consumerUnit.desconto_assinante || '',
                dia_vencimento: consumerUnit.dia_vencimento || 10,
                cep: maskCEP(consumerUnit.address?.cep || ''),
                rua: consumerUnit.address?.rua || '',
                numero: consumerUnit.address?.numero || '',
                complemento: consumerUnit.address?.complemento || '',
                bairro: consumerUnit.address?.bairro || '',
                cidade: consumerUnit.address?.cidade || '',
                uf: consumerUnit.address?.uf || '',
                portal_credentials: consumerUnit.portal_credentials || { url: '', login: '', password: '' }
            });
        }
    }, [consumerUnit?.id, consumerUnit?.subscriber_id]); // Stable dependencies

    // Calculate Tarifa Minima automatically
    useEffect(() => {
        const tariff = parseCurrency(formData.tarifa_concessionaria);
        let multiplier = 30; // Monofasico default
        if (formData.tipo_ligacao === 'trifasico') multiplier = 100;
        else if (formData.tipo_ligacao === 'bifasico') multiplier = 50;

        const minTariff = tariff * multiplier;
        const formattedMin = minTariff.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

        setFormData(prev => ({
            ...prev,
            tarifa_minima: formattedMin
        }));
    }, [formData.tarifa_concessionaria, formData.tipo_ligacao]);

    const fetchSubscribers = async () => {
        const { data } = await supabase.from('subscribers').select('id, name, cpf_cnpj').order('name');
        setSubscribers(data || []);
    };

    const fetchUsinas = async () => {
        const { data } = await supabase.from('usinas').select('id, name').order('name');
        setUsinas(data || []);
    };

    const handleCepChange = (e) => {
        const masked = maskCEP(e.target.value);
        setFormData(prev => ({ ...prev, cep: masked }));
    };

    const handleCepBlur = async () => {
        const rawCep = formData.cep.replace(/\D/g, '');
        if (rawCep.length === 8) {
            setSearchingCep(true);
            try {
                const addr = await fetchAddressByCep(rawCep);
                setFormData(prev => ({
                    ...prev,
                    rua: addr.rua || '',
                    bairro: addr.bairro || '',
                    cidade: addr.cidade || '',
                    uf: addr.uf || '',
                    concessionaria: prev.concessionaria || ''
                }));

                // Fetch Offers based on IBGE
                if (addr.ibge) {
                    const offer = await fetchOfferData(addr.ibge);
                    if (offer) {
                        let discountVal = offer['Desconto Assinante'] || 0;
                        if (discountVal <= 1) {
                            discountVal = discountVal * 100;
                        }

                        setFormData(prev => ({
                            ...prev,
                            rua: addr.rua || '',
                            bairro: addr.bairro || '',
                            cidade: addr.cidade || '',
                            uf: addr.uf || '',
                            concessionaria: offer.Concessionaria || prev.concessionaria,
                            tarifa_concessionaria: offer['Tarifa Concessionaria'] ? formatCurrency(offer['Tarifa Concessionaria']) : prev.tarifa_concessionaria,
                            te: offer['TE'] ? formatCurrency(offer['TE']) : prev.te,
                            tusd: offer['TUSD'] ? formatCurrency(offer['TUSD']) : prev.tusd,
                            fio_b: offer['Fio B'] ? formatCurrency(offer['Fio B']) : prev.fio_b,
                            desconto_assinante: discountVal.toFixed(2)
                        }));
                    }
                }

            } catch (error) {
                console.error('Erro CEP', error);
                showAlert('Erro ao buscar CEP/Ofertas: ' + (error.message || 'Não encontrado'), 'error');
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const payload = {
                subscriber_id: formData.subscriber_id || null,
                usina_id: formData.usina_id || null,
                status: formData.status,
                numero_uc: formData.numero_uc,
                titular_conta: formData.titular_conta,
                modalidade: formData.modalidade,
                concessionaria: formData.concessionaria,
                tipo_ligacao: formData.tipo_ligacao,
                franquia: Number(formData.franquia),
                tarifa_concessionaria: parseCurrency(formData.tarifa_concessionaria),
                te: parseCurrency(formData.te),
                tusd: parseCurrency(formData.tusd),
                fio_b: parseCurrency(formData.fio_b),
                desconto_assinante: Number(formData.desconto_assinante),
                dia_vencimento: Number(formData.dia_vencimento),
                address: {
                    cep: formData.cep.replace(/\D/g, ''),
                    rua: formData.rua,
                    numero: formData.numero,
                    complemento: formData.complemento,
                    bairro: formData.bairro,
                    cidade: formData.cidade,
                    uf: formData.uf
                },
                portal_credentials: formData.portal_credentials
            };

            if (!payload.subscriber_id) throw new Error('Assinante é obrigatório.');

            let result;
            if (consumerUnit?.id) {
                result = await supabase.from('consumer_units').update(payload).eq('id', consumerUnit.id).select().single();
            } else {
                result = await supabase.from('consumer_units').insert(payload).select().single();
            }

            if (result.error) throw result.error;
            onSave(result.data);
            onClose();
        } catch (error) {
            showAlert('Erro ao salvar UC: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        const confirm = await showConfirm('Tem certeza que deseja excluir esta Unidade Consumidora?');
        if (!confirm) return;
        setLoading(true);
        try {
            const { error } = await supabase.from('consumer_units').delete().eq('id', consumerUnit.id);
            if (error) throw error;
            if (onDelete) onDelete(consumerUnit.id);
            onClose();
        } catch (error) {
            showAlert('Erro ao excluir: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    // Find subscriber name for header
    const subscriberName = subscribers.find(s => s.id === formData.subscriber_id)?.name || '';

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ background: 'white', padding: '0', borderRadius: '12px', width: '90%', maxWidth: '900px', maxHeight: '95vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Modal Header */}
                <div style={{
                    padding: '1.25rem 2rem',
                    borderBottom: '1px solid #eee',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#f8fafc'
                }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>
                        {consumerUnit?.id ? (
                            subscriberName ? `Editar UC - ${subscriberName}` : 'Editar UC'
                        ) : 'Nova Unidade Consumidora'}
                    </h3>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {consumerUnit?.id && (
                            <button
                                type="button"
                                onClick={() => setShowHistory(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                    background: '#fff', color: 'var(--color-blue)',
                                    border: '1px solid var(--color-blue)',
                                    padding: '0.4rem 0.8rem', borderRadius: '6px',
                                    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600
                                }}
                            >
                                <History size={16} /> Histórico
                            </button>
                        )}
                        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                            <X size={24} />
                        </button>
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
                    <form onSubmit={handleSubmit}>

                        <div style={{ background: 'var(--color-bg-light)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #e2e8f0' }}>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 600 }}>Status da Unidade</label>
                            <select
                                value={formData.status}
                                onChange={e => setFormData({ ...formData, status: e.target.value })}
                                style={{ width: '100%', maxWidth: '300px', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                            >
                                {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>

                        <CollapsibleSection title="Vínculos" icon={Link} defaultOpen={true}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Assinante <span style={{ color: '#ef4444' }}>*</span></label>
                                <select
                                    required
                                    value={formData.subscriber_id}
                                    onChange={e => setFormData({ ...formData, subscriber_id: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                >
                                    <option value="">Selecione...</option>
                                    {subscribers.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} ({s.cpf_cnpj})</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Usina (Opcional)</label>
                                <select
                                    value={formData.usina_id}
                                    onChange={e => setFormData({ ...formData, usina_id: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                >
                                    <option value="">Selecione...</option>
                                    {usinas.map(u => (
                                        <option key={u.id} value={u.id}>{u.name}</option>
                                    ))}
                                </select>
                            </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Endereço de Instalação" icon={Home} defaultOpen={true}>
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <div style={{ width: '150px' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>CEP</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            value={formData.cep}
                                            onChange={handleCepChange}
                                            onBlur={handleCepBlur}
                                            placeholder="00000-000"
                                            maxLength={9}
                                            style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none', background: searchingCep ? '#f0f9ff' : 'white' }}
                                        />
                                        {searchingCep && <span style={{ position: 'absolute', right: '10px', top: '10px', fontSize: '0.7rem', color: '#94a3b8' }}>...</span>}
                                    </div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <input
                                        value={formData.concessionaria}
                                        readOnly
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #f1f5f9', borderRadius: '6px', background: '#f8fafc', color: '#64748b', outline: 'none' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowCredentialsModal(true)}
                                        style={{
                                            marginTop: '0.5rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            padding: '0.4rem 0.8rem',
                                            background: '#fef2f2',
                                            color: '#ef4444',
                                            borderRadius: '6px',
                                            border: '1px solid #fee2e2',
                                            fontSize: '0.8rem',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            width: 'fit-content'
                                        }}
                                    >
                                        <Key size={12} /> Credenciais
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Rua</label>
                                    <input
                                        value={formData.rua}
                                        onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>
                                <div style={{ width: '100px' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Número</label>
                                    <input
                                        value={formData.numero}
                                        onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Bairro</label>
                                <input
                                    value={formData.bairro}
                                    onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Complemento</label>
                                <input
                                    value={formData.complemento}
                                    onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Cidade</label>
                                <input
                                    value={formData.cidade}
                                    onChange={e => setFormData({ ...formData, cidade: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>UF</label>
                                <input
                                    value={formData.uf}
                                    onChange={e => setFormData({ ...formData, uf: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Dados da Unidade" icon={Zap} defaultOpen={true}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Número da UC <span style={{ color: '#ef4444' }}>*</span></label>
                                <input
                                    required
                                    value={formData.numero_uc}
                                    onChange={e => setFormData({ ...formData, numero_uc: e.target.value })}
                                    placeholder="Ex: 7204400277"
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Titular da Conta (Na Fatura)</label>
                                <input
                                    required
                                    value={formData.titular_conta}
                                    onChange={e => setFormData({ ...formData, titular_conta: e.target.value })}
                                    placeholder="Nome Completo / Razão Social"
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Dados Técnicos e Comerciais" icon={Settings} defaultOpen={true}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Tipo de Ligação</label>
                                <select
                                    value={formData.tipo_ligacao}
                                    onChange={e => setFormData({ ...formData, tipo_ligacao: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                >
                                    {tipoLigacaoOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Modalidade</label>
                                <select
                                    value={formData.modalidade}
                                    onChange={e => setFormData({ ...formData, modalidade: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                >
                                    {modalidadeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>

                            <div style={{ gridColumn: '1 / -1', background: '#f0f9ff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #bae6fd', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                                <div style={{ gridColumn: '1 / -1', fontSize: '0.95rem', fontWeight: 600, color: '#0369a1', marginBottom: '0.25rem' }}>Componentes Tarifários</div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#075985' }}>Tarifa Concessionária (R$/kWh)</label>
                                    <input
                                        type="text"
                                        value={formData.tarifa_concessionaria}
                                        onChange={e => handleCurrencyChange('tarifa_concessionaria', e.target.value)}
                                        placeholder="R$ 0,0000"
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #7dd3fc', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#075985' }}>TE (Energia) - R$/kWh</label>
                                    <input
                                        type="text"
                                        value={formData.te}
                                        onChange={e => handleCurrencyChange('te', e.target.value)}
                                        placeholder="R$ 0,0000"
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #7dd3fc', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#075985' }}>TUSD (Distribuição) - R$/kWh</label>
                                    <input
                                        type="text"
                                        value={formData.tusd}
                                        onChange={e => handleCurrencyChange('tusd', e.target.value)}
                                        placeholder="R$ 0,0000"
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #7dd3fc', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#075985' }}>Fio B - R$/kWh</label>
                                    <input
                                        type="text"
                                        value={formData.fio_b}
                                        onChange={e => handleCurrencyChange('fio_b', e.target.value)}
                                        placeholder="R$ 0,0000"
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #7dd3fc', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>
                            </div>

                            <div style={{ background: '#fffbeb', padding: '1rem', borderRadius: '8px', border: '1px solid #fde68a', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <label style={{ fontSize: '0.85rem', color: '#92400e', fontWeight: 600 }}>Tarifa Mínima Estimada</label>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#d97706' }}>
                                    {formData.tarifa_minima || 'R$ 0,00'}
                                </div>
                                <span style={{ fontSize: '0.75rem', color: '#b45309' }}>
                                    Baseada no Tipo de Ligação ({formData.tipo_ligacao}) x Tarifa.
                                </span>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Desconto Assinante (%)</label>
                                <input
                                    type="number" step="0.01"
                                    value={formData.desconto_assinante}
                                    onChange={e => setFormData({ ...formData, desconto_assinante: e.target.value })}
                                    placeholder="%"
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Franquia / Consumo Min (kWh)</label>
                                <input
                                    type="number"
                                    value={formData.franquia}
                                    onChange={e => setFormData({ ...formData, franquia: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Dia de Vencimento</label>
                                <select
                                    value={formData.dia_vencimento}
                                    onChange={e => setFormData({ ...formData, dia_vencimento: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                >
                                    {vencimentoOptions.map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>
                        </CollapsibleSection>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '2rem', padding: '1rem 0', borderTop: '1px solid #eee', alignItems: 'center' }}>
                            {consumerUnit?.id && onDelete && (
                                <button type="button" onClick={handleDelete} style={{ marginRight: 'auto', padding: '0.6rem 1.25rem', background: '#fee2e2', color: '#dc2626', borderRadius: '6px', border: '1px solid #fecaca', fontWeight: 600, cursor: 'pointer' }}>
                                    Excluir UC
                                </button>
                            )}
                            <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.25rem', background: '#f1f5f9', color: '#475569', borderRadius: '6px', border: '1px solid #e2e8f0', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                            <button
                                type="submit"
                                disabled={loading}
                                style={{
                                    padding: '0.6rem 1.25rem',
                                    background: 'var(--color-blue)',
                                    color: 'white',
                                    borderRadius: '6px',
                                    fontWeight: 600,
                                    border: 'none',
                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                                    cursor: loading ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {loading ? 'Salvando...' : 'Salvar UC'}
                            </button>
                        </div>

                    </form>
                </div>
            </div>

            {showHistory && consumerUnit?.id && (
                <HistoryTimeline
                    entityType="uc"
                    entityId={consumerUnit.id}
                    entityName={`UC: ${formData.numero_uc} - ${subscriberName}`}
                    onClose={() => setShowHistory(false)}
                />
            )}

            {/* Credentials Pop-up Modal */}
            {showCredentialsModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100,
                    animation: 'fadeIn 0.2s ease-out'
                }}>
                    <div style={{
                        background: 'white', borderRadius: '16px', width: '90%', maxWidth: '400px',
                        padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                        position: 'relative'
                    }}>
                        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                            <div style={{
                                width: '48px', height: '48px', background: '#fff7ed', borderRadius: '12px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
                                color: '#f97316'
                            }}>
                                <Key size={24} />
                            </div>
                            <h4 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Credenciais</h4>
                            <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>Acesso ao portal da concessionária</p>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>URL do Portal</label>
                                <input
                                    type="url"
                                    value={formData.portal_credentials?.url || ''}
                                    onChange={e => setFormData({
                                        ...formData,
                                        portal_credentials: { ...formData.portal_credentials, url: e.target.value }
                                    })}
                                    placeholder="http://portal.concessionaria.com.br"
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>Email / Login</label>
                                <input
                                    type="text"
                                    value={formData.portal_credentials?.login || ''}
                                    onChange={e => setFormData({
                                        ...formData,
                                        portal_credentials: { ...formData.portal_credentials, login: e.target.value }
                                    })}
                                    placeholder="login@exemplo.com"
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>Senha</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={formData.portal_credentials?.password || ''}
                                        onChange={e => setFormData({
                                            ...formData,
                                            portal_credentials: { ...formData.portal_credentials, password: e.target.value }
                                        })}
                                        placeholder="••••••••"
                                        style={{ width: '100%', padding: '0.7rem', paddingRight: '2.5rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.2rem' }}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '2rem', display: 'flex', gap: '0.8rem' }}>
                            <button
                                type="button"
                                onClick={() => setShowCredentialsModal(false)}
                                style={{ flex: 1, padding: '0.75rem', background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Fechar
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowCredentialsModal(false)}
                                style={{ flex: 1, padding: '0.75rem', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.2)' }}
                            >
                                Salvar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
