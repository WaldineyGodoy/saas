import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import { ChevronDown, ChevronUp, History, X, User, Home, Zap, Link, Settings, Key, Eye, EyeOff, FileSearch, PlusCircle } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';
import UCInvoicesModal from './UCInvoicesModal';
import InvoiceFormModal from './InvoiceFormModal';

export default function ConsumerUnitModal({ consumerUnit, onClose, onSave, onDelete, defaultSection = 'all' }) {
    const { showAlert, showConfirm } = useUI();
    const [subscribers, setSubscribers] = useState([]);
    const [usinas, setUsinas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showCredentialsModal, setShowCredentialsModal] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showInvoicesModal, setShowInvoicesModal] = useState(false);
    const [showIssueInvoiceModal, setShowIssueInvoiceModal] = useState(false);

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

    const tipoUnidadeOptions = [
        { value: 'beneficiaria', label: 'Beneficiária' },
        { value: 'geradora', label: 'Geradora' }
    ];

    const diaLeituraOptions = Array.from({ length: 31 }, (_, i) => i + 1);
    
    const concessionariaOptions = [
        { value: 'Neoenergia Cosern', label: 'Neoenergia Cosern' },
        { value: 'Neoenergia Coelba', label: 'Neoenergia Coelba' },
        { value: 'Neoenergia Elektro', label: 'Neoenergia Elektro' },
        { value: 'Neoenergia Pernambuco', label: 'Neoenergia Pernambuco' },
        { value: 'Enel Ceará', label: 'Enel Ceará' },
        { value: 'Enel Rio', label: 'Enel Rio' },
        { value: 'Enel São Paulo', label: 'Enel São Paulo' },
        { value: 'CPFL Paulista', label: 'CPFL Paulista' },
        { value: 'Equatorial Maranhão', label: 'Equatorial Maranhão' },
        { value: 'Equatorial Pará', label: 'Equatorial Pará' },
        { value: 'Equatorial Piauí', label: 'Equatorial Piauí' },
        { value: 'Equatorial Alagoas', label: 'Equatorial Alagoas' },
        { value: 'Cemig', label: 'Cemig' },
        { value: 'Copel', label: 'Copel' },
        { value: 'Celesc', label: 'Celesc' }
    ];

    const [formData, setFormData] = useState({
        subscriber_id: '',
        usina_id: '',
        status: 'em_ativacao',
        numero_uc: '',
        titular_conta: '',
        titular_fatura_id: '',
        cpf_cnpj_fatura: '',
        tipo_unidade: 'beneficiaria',
        dia_leitura: 1,
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
        portal_credentials: { url: '', login: '', password: '' },
        saldo_remanescente: false
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
                titular_fatura_id: consumerUnit.titular_fatura_id || '',
                cpf_cnpj_fatura: consumerUnit.cpf_cnpj_fatura || '',
                tipo_unidade: consumerUnit.tipo_unidade || 'beneficiaria',
                dia_leitura: consumerUnit.dia_leitura || 1,
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
                portal_credentials: consumerUnit.portal_credentials || { url: '', login: '', password: '' },
                saldo_remanescente: !!consumerUnit.saldo_remanescente,
                last_scraping_status: consumerUnit.last_scraping_status || 'pending',
                last_scraping_at: consumerUnit.last_scraping_at || null,
                last_scraping_error: consumerUnit.last_scraping_error || null
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
        const { data } = await supabase.from('subscribers').select('id, name, cpf_cnpj, portal_credentials').order('name');
        setSubscribers(data || []);
    };

    const fetchUsinas = async () => {
        const { data } = await supabase.from('usinas').select('id, name').order('name');
        setUsinas(data || []);
    };

    // Sync portal_credentials with titular when subscribers or titular changes
    useEffect(() => {
        if (formData.titular_fatura_id && subscribers.length > 0) {
            const titular = subscribers.find(s => s.id === formData.titular_fatura_id);
            if (titular && titular.portal_credentials) {
                setFormData(prev => ({
                    ...prev,
                    portal_credentials: titular.portal_credentials
                }));
            }
        }
    }, [formData.titular_fatura_id, subscribers]);

    const handleSubscriberChange = async (subscriberId) => {
        setFormData(prev => ({ ...prev, subscriber_id: subscriberId }));
        if (subscriberId) {
            try {
                const { data, error } = await supabase
                    .from('subscribers')
                    .select('consolidated_due_day, billing_mode')
                    .eq('id', subscriberId)
                    .single();

                if (!error && data && data.billing_mode === 'consolidada') {
                    setFormData(prev => ({
                        ...prev,
                        dia_vencimento: data.consolidated_due_day || 10
                    }));
                }
            } catch (err) {
                console.error('Erro ao buscar dados do assinante:', err);
            }
        }
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
                titular_fatura_id: formData.titular_fatura_id || null,
                cpf_cnpj_fatura: formData.cpf_cnpj_fatura,
                tipo_unidade: formData.tipo_unidade,
                dia_leitura: Number(formData.dia_leitura),
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
                // portal_credentials move to subscriber
                saldo_remanescente: formData.saldo_remanescente
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
                            `${formData.numero_uc} - ${subscriberName} - ${formData.titular_conta}`
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

                        <CollapsibleSection title="Vínculos" icon={Link} defaultOpen={defaultSection === 'all' || defaultSection === 'technical'}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Assinante <span style={{ color: '#ef4444' }}>*</span></label>
                                    <select
                                        required
                                        value={formData.subscriber_id}
                                        onChange={e => handleSubscriberChange(e.target.value)}
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    >
                                        <option value="">Selecione...</option>
                                        {subscribers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s.cpf_cnpj})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Endereço de Instalação" icon={Home} defaultOpen={defaultSection === 'all'}>
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
                                    {/* Fields moved to Dados da Unidade */}
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

                        <CollapsibleSection title="Dados da Unidade" icon={Zap} defaultOpen={defaultSection === 'all'}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Número da UC <span style={{ color: '#ef4444' }}>*</span></label>
                                    <input
                                        required
                                        value={formData.numero_uc}
                                        onChange={e => setFormData({ ...formData, numero_uc: e.target.value })}
                                        placeholder="Ex: 7204400277"
                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f8fafc' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Identificação da Fatura</label>
                                    <input
                                        required
                                        value={formData.titular_conta}
                                        onChange={e => setFormData({ ...formData, titular_conta: e.target.value })}
                                        placeholder="Nome Completo / Razão Social como consta no documento"
                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f8fafc' }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem', marginBottom: '1.25rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Assinante (Titular)</label>
                                    <select
                                        value={formData.titular_fatura_id}
                                        onChange={e => {
                                            const sub = subscribers.find(s => s.id === e.target.value);
                                            setFormData({
                                                ...formData,
                                                titular_fatura_id: e.target.value,
                                                cpf_cnpj_fatura: sub ? sub.cpf_cnpj : formData.cpf_cnpj_fatura,
                                                portal_credentials: sub?.portal_credentials || { url: '', login: '', password: '' }
                                            });
                                        }}
                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f0f9ff', color: '#0369a1' }}
                                    >
                                        <option value="">Selecione o assinante...</option>
                                        {subscribers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>CPF/CNPJ do Titular</label>
                                    <input
                                        value={formData.cpf_cnpj_fatura}
                                        onChange={e => setFormData({ ...formData, cpf_cnpj_fatura: e.target.value })}
                                        placeholder="000.000.000-00"
                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f8fafc' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Tipo da UC</label>
                                    <select
                                        value={formData.tipo_unidade}
                                        onChange={e => setFormData({ ...formData, tipo_unidade: e.target.value })}
                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f8fafc' }}
                                    >
                                        {tipoUnidadeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.25rem', alignItems: 'flex-start' }}>
                                <div style={{ 
                                    gridColumn: 'span 2', 
                                    background: '#f0fdf4', 
                                    padding: '1rem', 
                                    borderRadius: '12px', 
                                    border: '1px solid #dcfce7',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.75rem',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }}></div>
                                            <label style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 600 }}>Concessionária de Energia</label>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={!formData.titular_fatura_id}
                                            onClick={() => setShowCredentialsModal(true)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.4rem',
                                                padding: '0.35rem 0.8rem',
                                                background: formData.titular_fatura_id ? '#fff' : '#f1f5f9',
                                                color: formData.titular_fatura_id ? '#ef4444' : '#94a3b8',
                                                borderRadius: '6px',
                                                border: `1px solid ${formData.titular_fatura_id ? '#fee2e2' : '#e2e8f0'}`,
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                cursor: formData.titular_fatura_id ? 'pointer' : 'not-allowed',
                                                transition: 'all 0.2s',
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                            }}
                                        >
                                            <Key size={12} /> Portal
                                        </button>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.25rem' }}>
                                        <select
                                            value={formData.concessionaria}
                                            onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                                            style={{ flex: 1, padding: '0.7rem', border: '1px solid #bbf7d0', borderRadius: '8px', outline: 'none', background: 'white', color: '#166534', fontWeight: 600 }}
                                        >
                                            <option value="">Selecione a concessionária...</option>
                                            {concessionariaOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>

                                        {formData.last_scraping_status && formData.concessionaria === 'Neoenergia Cosern' && (
                                            <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '0.5rem', 
                                                padding: '0.5rem 0.75rem', 
                                                borderRadius: '8px',
                                                background: formData.last_scraping_status === 'success' ? '#dcfce7' : 
                                                            formData.last_scraping_status === 'not_available' ? '#fef9c3' : '#fee2e2',
                                                border: `1px solid ${
                                                    formData.last_scraping_status === 'success' ? '#86efac' : 
                                                    formData.last_scraping_status === 'not_available' ? '#fde047' : '#fca5a5'
                                                }`
                                            }}>
                                                <div style={{ 
                                                    width: '8px', 
                                                    height: '8px', 
                                                    borderRadius: '50%', 
                                                    background: formData.last_scraping_status === 'success' ? '#22c55e' : 
                                                                formData.last_scraping_status === 'not_available' ? '#eab308' : '#ef4444'
                                                }} />
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ 
                                                        fontSize: '0.65rem', 
                                                        fontWeight: 700, 
                                                        color: formData.last_scraping_status === 'success' ? '#166534' : 
                                                               formData.last_scraping_status === 'not_available' ? '#854d0e' : '#991b1b',
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        Status Agente: {formData.last_scraping_status}
                                                    </span>
                                                    {formData.last_scraping_at && (
                                                        <span style={{ fontSize: '0.6rem', color: '#64748b' }}>
                                                            {new Date(formData.last_scraping_at).toLocaleString('pt-BR')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {formData.last_scraping_status === 'error' && formData.last_scraping_error && (
                                        <div style={{ fontSize: '0.7rem', color: '#991b1b', background: '#fff', padding: '0.4rem', borderRadius: '4px', border: '1px solid #fee2e2', marginTop: '0.25rem' }}>
                                            <strong>Erro:</strong> {formData.last_scraping_error}
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Tipo de Ligação</label>
                                        <select
                                            value={formData.tipo_ligacao}
                                            onChange={e => setFormData({ ...formData, tipo_ligacao: e.target.value })}
                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f8fafc' }}
                                        >
                                            {tipoLigacaoOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Dia de Leitura</label>
                                        <select
                                            value={formData.dia_leitura}
                                            onChange={e => setFormData({ ...formData, dia_leitura: e.target.value })}
                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f8fafc' }}
                                        >
                                            <option value="">Selecione o dia...</option>
                                            {diaLeituraOptions.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Dados Técnicos e Comerciais" icon={Settings} defaultOpen={defaultSection === 'all' || defaultSection === 'technical'}>
                            <div style={{ gridColumn: '1 / -1' }}>
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

                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.5fr) 1fr', gap: '1.5rem', alignItems: 'end' }}>
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

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <label style={{ fontSize: '0.9rem', color: '#64748b' }}>Saldo Remanescente</label>
                                        {consumerUnit?.id && (
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowInvoicesModal(true)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.6rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', color: '#475569', fontWeight: 600 }}
                                                >
                                                    <FileSearch size={14} /> Visualizar
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowIssueInvoiceModal(true)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.6rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', color: '#2563eb', fontWeight: 600 }}
                                                >
                                                    <PlusCircle size={14} /> Emitir Fatura
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '1.25rem', padding: '0.55rem 0' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: '#475569' }}>
                                            <input
                                                type="radio"
                                                name="saldo_remanescente"
                                                checked={formData.saldo_remanescente === true}
                                                onChange={() => setFormData({ ...formData, saldo_remanescente: true })}
                                                style={{ cursor: 'pointer', accentColor: 'var(--color-blue)' }}
                                            />
                                            Sim
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: '#475569' }}>
                                            <input
                                                type="radio"
                                                name="saldo_remanescente"
                                                checked={formData.saldo_remanescente === false}
                                                onChange={() => setFormData({ ...formData, saldo_remanescente: false })}
                                                style={{ cursor: 'pointer', accentColor: 'var(--color-blue)' }}
                                            />
                                            Não
                                        </label>
                                    </div>
                                </div>
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
                            <h4 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Credenciais do Titular</h4>
                            <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>
                                {subscribers.find(s => s.id === formData.titular_fatura_id)?.name || 'Portal da concessionária'}
                            </p>
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
                                onClick={async () => {
                                    if (!formData.titular_fatura_id) return;
                                    setLoading(true);
                                    try {
                                        const { error } = await supabase
                                            .from('subscribers')
                                            .update({ portal_credentials: formData.portal_credentials })
                                            .eq('id', formData.titular_fatura_id);

                                        if (error) throw error;

                                        // Update local subscribers state
                                        setSubscribers(prev => prev.map(s => 
                                            s.id === formData.titular_fatura_id 
                                                ? { ...s, portal_credentials: formData.portal_credentials }
                                                : s
                                        ));

                                        showAlert('Credenciais do titular salvas com sucesso!', 'success');
                                        setShowCredentialsModal(false);
                                    } catch (err) {
                                        showAlert('Erro ao salvar credenciais: ' + err.message, 'error');
                                    } finally {
                                        setLoading(false);
                                    }
                                }}
                                style={{ flex: 1, padding: '0.75rem', background: '#22c55e', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.2)' }}
                            >
                                Salvar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showInvoicesModal && (
                <UCInvoicesModal
                    uc={consumerUnit}
                    onClose={() => setShowInvoicesModal(false)}
                />
            )}

            {showIssueInvoiceModal && (
                <InvoiceFormModal
                    ucs={[consumerUnit]}
                    onClose={() => setShowIssueInvoiceModal(false)}
                    onSave={() => {
                        setShowIssueInvoiceModal(false);
                        setShowInvoicesModal(true);
                    }}
                />
            )}
        </div>
    );
}
