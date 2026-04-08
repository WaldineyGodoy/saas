import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import { ChevronDown, ChevronUp, History, X, User, Home, Zap, Link, Settings, Key, Eye, EyeOff, FileSearch, PlusCircle, Upload } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';
import UCInvoicesModal from './UCInvoicesModal';
import InvoiceFormModal from './InvoiceFormModal';
import ManualInvoiceUploadModal from './ManualInvoiceUploadModal';

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
    const [activeTab, setActiveTab] = useState('vincos'); // 'vincos' | 'dados' | 'endereco' | 'tecnico'
    const [isSaving, setIsSaving] = useState(false);
    const [showIssueInvoiceModal, setShowIssueInvoiceModal] = useState(false);
    const [showManualUploadModal, setShowManualUploadModal] = useState(false);
    const [invoiceToEdit, setInvoiceToEdit] = useState(null);
    const [showInvoiceForm, setShowInvoiceForm] = useState(false);
    const [showZeroInvoiceModal, setShowZeroInvoiceModal] = useState(false);
    const [zeroInvoiceMonth, setZeroInvoiceMonth] = useState(`${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`);

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
    }, []);

    // Assinatura Realtime para a UC específica
    useEffect(() => {
        if (!consumerUnit?.id) return;

        const channel = supabase
            .channel(`uc-edit-${consumerUnit.id}`)
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'consumer_units',
                filter: `id=eq.${consumerUnit.id}`
            }, payload => {
                console.log('Realtime UC update:', payload);
                setFormData(prev => ({ 
                    ...prev, 
                    last_scraping_status: payload.new.last_scraping_status,
                    last_scraping_at: payload.new.last_scraping_at,
                    last_scraping_error: payload.new.last_scraping_error
                }));
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [consumerUnit?.id]); // Run once on mount

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

    const handleIssueZeroInvoice = () => {
        setZeroInvoiceMonth(`${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`);
        setShowZeroInvoiceModal(true);
    };

    const handleConfirmZeroInvoice = async () => {
        const datePattern = /^(\d{2})\/(\d{4})$/;
        const match = zeroInvoiceMonth.trim().match(datePattern);
        
        if (!match) {
            showAlert('Formato inválido. Use MM/AAAA.', 'error');
            return;
        }

        const m = match[1];
        const y = match[2];

        const confirm = await showConfirm(
            `Confirmar emissão de fatura zerada para o mês ${m}/${y}?`, 
            'Emitir Fatura Zerada',
            'Sim, Emitir',
            'Cancelar'
        );
        if (!confirm) return;

        setShowZeroInvoiceModal(false);
        setLoading(true);
        try {
            const mesReferencia = `${y}-${m}-01`;
            
            // Calculate a normal due date
            const dueDay = formData.dia_vencimento || 10; 
            let vDate = new Date(Number(y), Number(m), dueDay);
            const vencimento = vDate.toISOString().split('T')[0];

            const payload = {
                uc_id: consumerUnit.id,
                mes_referencia: mesReferencia,
                vencimento: vencimento,
                consumo_kwh: 0,
                consumo_reais: 0,
                iluminacao_publica: 0,
                outros_lancamentos: 0,
                economia_reais: 0,
                consumo_compensado: 0,
                tarifa_minima: 0,
                data_leitura: null,
                linha_digitavel: null,
                pix_string: null,
                valor_a_pagar: 0,
                valor_concessionaria: 0,
                status: 'pago' // Green color
            };

            const { error } = await supabase.from('invoices').upsert(payload, { onConflict: 'uc_id,mes_referencia' });
            if (error) throw error;

            showAlert('Fatura zerada criada com sucesso!', 'success');
            setShowInvoicesModal(true); // Open the invoices modal to show it
        } catch (err) {
            console.error(err);
            showAlert('Erro ao criar fatura zerada: ' + err.message, 'error');
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
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    {/* Tab Navigation */}
                    <div style={{ 
                        display: 'flex', 
                        gap: '1.5rem', 
                        padding: '0.5rem 2rem 0', 
                        borderBottom: '1px solid #eee',
                        background: '#f8fafc'
                    }}>
                        {[
                            { id: 'vincos', label: 'Vínculos', icon: Link },
                            { id: 'dados', label: 'Dados da UC', icon: Zap },
                            { id: 'endereco', label: 'Endereço', icon: Home },
                            { id: 'tecnico', label: 'Faturamento', icon: Settings }
                        ].map(tab => {
                            const isActive = activeTab === tab.id;
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '1rem 0.5rem',
                                        border: 'none',
                                        background: 'none',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: 600,
                                        color: isActive ? 'var(--color-blue)' : '#64748b',
                                        borderBottom: `2px solid ${isActive ? 'var(--color-blue)' : 'transparent'}`,
                                        transition: 'all 0.2s',
                                        marginBottom: '-1px'
                                    }}
                                >
                                    <Icon size={18} />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    <div style={{ padding: '2rem', flex: 1 }}>
                        <form onSubmit={handleSubmit}>
                            {/* Tab Content: Vínculos */}
                            {activeTab === 'vincos' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Número da UC <span style={{ color: '#ef4444' }}>*</span></label>
                                            <input
                                                required
                                                value={formData.numero_uc}
                                                onChange={e => setFormData({ ...formData, numero_uc: e.target.value })}
                                                placeholder="Ex: 7204400277"
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Identificação na Fatura</label>
                                            <input
                                                required
                                                value={formData.titular_conta}
                                                onChange={e => setFormData({ ...formData, titular_conta: e.target.value })}
                                                placeholder="Nome como aparece na conta"
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.25rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Assinante B2W (Titular)</label>
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
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f8fafc' }}
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
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ 
                                        background: '#f0f9ff', 
                                        padding: '1.25rem', 
                                        borderRadius: '12px', 
                                        border: '1px solid #bae6fd',
                                        marginTop: '0.5rem'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <Zap size={18} color="#0369a1" />
                                                <label style={{ fontSize: '0.9rem', color: '#0369a1', fontWeight: 700 }}>Concessionária e Portal</label>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={!formData.titular_fatura_id}
                                                onClick={() => setShowCredentialsModal(true)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                                    padding: '0.4rem 1rem', background: '#fff', 
                                                    color: formData.titular_fatura_id ? '#0369a1' : '#94a3b8',
                                                    borderRadius: '6px', border: `1px solid ${formData.titular_fatura_id ? '#bae6fd' : '#e2e8f0'}`,
                                                    fontSize: '0.8rem', fontWeight: 700, cursor: formData.titular_fatura_id ? 'pointer' : 'not-allowed'
                                                }}
                                            >
                                                <Key size={14} /> Credenciais Portal
                                            </button>
                                        </div>
                                        
                                        <select
                                            value={formData.concessionaria}
                                            onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                                            style={{ width: '100%', padding: '0.8rem', border: '1px solid #bae6fd', borderRadius: '8px', outline: 'none', background: 'white', color: '#0369a1', fontWeight: 600 }}
                                        >
                                            <option value="">Selecione a concessionária...</option>
                                            {concessionariaOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>

                                        {formData.last_scraping_status && (
                                            <div style={{ 
                                                display: 'flex', alignItems: 'center', gap: '0.75rem', 
                                                padding: '0.75rem', borderRadius: '8px', marginTop: '1rem',
                                                background: formData.last_scraping_status === 'success' ? '#dcfce7' : '#fee2e2',
                                                border: `1px solid ${formData.last_scraping_status === 'success' ? '#86efac' : '#fca5a5'}`
                                            }}>
                                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: formData.last_scraping_status === 'success' ? '#22c55e' : '#ef4444' }} />
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: formData.last_scraping_status === 'success' ? '#166534' : '#991b1b', textTransform: 'uppercase' }}>
                                                        Status Faturista: {formData.last_scraping_status}
                                                    </span>
                                                    {formData.last_scraping_at && (
                                                        <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Sincronizado em: {new Date(formData.last_scraping_at).toLocaleString('pt-BR')}</span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Tab Content: Dados da UC */}
                            {activeTab === 'dados' && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Status da Unidade</label>
                                        <select
                                            value={formData.status}
                                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                        >
                                            {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Tipo da UC</label>
                                        <select
                                            value={formData.tipo_unidade}
                                            onChange={e => setFormData({ ...formData, tipo_unidade: e.target.value })}
                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                        >
                                            {tipoUnidadeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Tipo de Ligação</label>
                                        <select
                                            value={formData.tipo_ligacao}
                                            onChange={e => setFormData({ ...formData, tipo_ligacao: e.target.value })}
                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                        >
                                            {tipoLigacaoOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Dia de Leitura</label>
                                        <select
                                            value={formData.dia_leitura}
                                            onChange={e => setFormData({ ...formData, dia_leitura: e.target.value })}
                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                        >
                                            <option value="">Selecione o dia...</option>
                                            {diaLeituraOptions.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Dia de Vencimento</label>
                                        <select
                                            value={formData.dia_vencimento}
                                            onChange={e => setFormData({ ...formData, dia_vencimento: e.target.value })}
                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                        >
                                            {vencimentoOptions.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {/* Tab Content: Endereço */}
                            {activeTab === 'endereco' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 2fr 100px', gap: '1.25rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>CEP (Busca)</label>
                                            <input
                                                value={formData.cep || ''}
                                                onChange={e => setFormData({ ...formData, cep: maskCEP(e.target.value) })}
                                                onBlur={handleCepBlur}
                                                maxLength={9}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: searchingCep ? '#f0f9ff' : 'white' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Rua / Logradouro</label>
                                            <input
                                                value={formData.rua || ''}
                                                onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Número</label>
                                            <input
                                                value={formData.numero || ''}
                                                onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Complemento</label>
                                            <input
                                                value={formData.complemento || ''}
                                                onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                                placeholder="Apto, Bloco, etc."
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Bairro</label>
                                            <input
                                                value={formData.bairro || ''}
                                                onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '1.25rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Cidade</label>
                                            <input
                                                disabled
                                                value={formData.cidade || ''}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #f1f5f9', borderRadius: '8px', background: '#f8fafc', color: '#64748b' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>UF</label>
                                            <input
                                                disabled
                                                value={formData.uf || ''}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #f1f5f9', borderRadius: '8px', background: '#f8fafc', color: '#64748b' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Tab Content: Dados Técnicos */}
                            {activeTab === 'tecnico' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.2fr', gap: '1.25rem', alignItems: 'end' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Usina Geradora (Opcional)</label>
                                            <select
                                                value={formData.usina_id}
                                                onChange={e => setFormData({ ...formData, usina_id: e.target.value })}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            >
                                                <option value="">Sem vínculo com usina...</option>
                                                {usinas.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Modalidade</label>
                                            <select
                                                value={formData.modalidade}
                                                onChange={e => setFormData({ ...formData, modalidade: e.target.value })}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            >
                                                {modalidadeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <div style={{ 
                                            background: '#eff6ff', padding: '0.6rem 1rem', borderRadius: '10px', border: '1px solid #bfdbfe',
                                            display: 'flex', flexDirection: 'column', gap: '0.4rem'
                                        }}>
                                            <label style={{ fontSize: '0.8rem', color: '#1e40af', fontWeight: 700, textAlign: 'center' }}>Saldo Remanescente</label>
                                            <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem', color: '#1e40af', fontWeight: 500 }}>
                                                    <input type="radio" checked={formData.saldo_remanescente === true} onChange={() => setFormData({ ...formData, saldo_remanescente: true })} /> Sim
                                                </label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem', color: '#1e40af', fontWeight: 500 }}>
                                                    <input type="radio" checked={formData.saldo_remanescente === false} onChange={() => setFormData({ ...formData, saldo_remanescente: false })} /> Não
                                                </label>
                                            </div>
                                        </div>
                                    </div>

                                    {consumerUnit?.id && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                            <button type="button" onClick={() => setShowInvoicesModal(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', padding: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'} onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                                                <FileSearch size={18} /> Ver Faturas
                                            </button>
                                            <button type="button" onClick={() => setShowManualUploadModal(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', padding: '0.75rem', border: 'none', borderRadius: '8px', background: '#22c55e', color: 'white', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 4px rgba(34, 197, 94, 0.2)' }}>
                                                <Upload size={18} /> Upload de conta de energia
                                            </button>
                                            <button type="button" onClick={handleIssueZeroInvoice} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', padding: '0.75rem', border: 'none', borderRadius: '8px', background: '#3b82f6', color: 'white', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)' }}>
                                                <PlusCircle size={18} /> Emitir Fatura avulsa
                                            </button>
                                        </div>
                                    )}

                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem' }}>
                                        <div style={{ background: '#f0f9ff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #bae6fd' }}>
                                            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0369a1', marginBottom: '1rem' }}>Componentes Tarifários</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                                {[
                                                    { id: 'tarifa_concessionaria', label: 'Tarifa (R$/kWh)' },
                                                    { id: 'te', label: 'TE (Energia)' },
                                                    { id: 'tusd', label: 'TUSD' },
                                                    { id: 'fio_b', label: 'Fio B' }
                                                ].map(f => (
                                                    <div key={f.id}>
                                                        <label style={{ display: 'block', fontSize: '0.7rem', color: '#075985', marginBottom: '0.25rem', fontWeight: 600 }}>{f.label}</label>
                                                        <input
                                                            type="text"
                                                            value={formData[f.id]}
                                                            onChange={e => handleCurrencyChange(f.id, e.target.value)}
                                                            placeholder="R$ 0,0000"
                                                            style={{ width: '100%', padding: '0.6rem', border: '1px solid #7dd3fc', borderRadius: '8px', outline: 'none' }}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                            <div style={{ background: '#fffbeb', padding: '1rem', borderRadius: '12px', border: '1px solid #fde68a', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                                <label style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: 700, marginBottom: '0.25rem' }}>Tarifa Mínima Estimada</label>
                                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#d97706' }}>{formData.tarifa_minima || 'R$ 0,00'}</div>
                                                <span style={{ fontSize: '0.65rem', color: '#b45309', marginTop: '0.25rem' }}>Base: Ligação {formData.tipo_ligacao}</span>
                                            </div>
                                            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                <label style={{ display: 'block', fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginBottom: '0.4rem' }}>Desconto Assinante (%)</label>
                                                <input
                                                    type="number" step="0.01"
                                                    value={formData.desconto_assinante}
                                                    onChange={e => setFormData({ ...formData, desconto_assinante: e.target.value })}
                                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '8px', outline: 'none' }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Franquia / Consumo Min (kWh)</label>
                                            <input
                                                type="number"
                                                value={formData.franquia}
                                                onChange={e => setFormData({ ...formData, franquia: e.target.value })}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Actions Footer */}
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'flex-end', 
                                gap: '0.8rem', 
                                marginTop: '3rem', 
                                paddingTop: '1.5rem', 
                                borderTop: '1px solid #eee',
                                alignItems: 'center'
                            }}>
                                {consumerUnit?.id && onDelete && (
                                    <button 
                                        type="button" 
                                        onClick={handleDelete} 
                                        style={{ marginRight: 'auto', padding: '0.7rem 1.5rem', background: '#fee2e2', color: '#dc2626', borderRadius: '10px', border: '1px solid #fecaca', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}
                                    >
                                        Excluir Unidade
                                    </button>
                                )}
                                <button 
                                    type="button" 
                                    onClick={onClose} 
                                    style={{ padding: '0.7rem 1.5rem', background: '#f8fafc', color: '#475569', borderRadius: '10px', border: '1px solid #e2e8f0', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    style={{
                                        padding: '0.7rem 2rem',
                                        background: 'var(--color-blue)',
                                        color: 'white',
                                        borderRadius: '10px',
                                        fontWeight: 700,
                                        border: 'none',
                                        boxShadow: '0 10px 15px -3px rgba(59, 130, 246, 0.3)',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        fontSize: '0.9rem'
                                    }}
                                >
                                    {loading ? 'Salvando...' : 'Salvar Unidade'}
                                </button>
                            </div>
                        </form>
                    </div>
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
            {showManualUploadModal && (
                <ManualInvoiceUploadModal
                    uc={consumerUnit} // full consumer unit object needs to match
                    onClose={() => setShowManualUploadModal(false)}
                    onSuccess={(newInvoice) => {
                        setFormData(prev => ({ ...prev, last_scraping_status: 'success' }));
                        setShowManualUploadModal(false);
                        setInvoiceToEdit(newInvoice);
                        setShowInvoiceForm(true);
                    }}
                />
            )}

            {showInvoiceForm && (
                <InvoiceFormModal
                    invoice={invoiceToEdit}
                    ucs={[consumerUnit]}
                    onClose={() => {
                        setShowInvoiceForm(false);
                        setInvoiceToEdit(null);
                    }}
                    onSave={() => {
                        setShowInvoiceForm(false);
                        setInvoiceToEdit(null);
                        setShowInvoicesModal(true);
                    }}
                />
            )}

            {showZeroInvoiceModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000
                }}>
                    <div style={{
                        background: 'white', padding: '2rem', borderRadius: '16px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                        width: '90%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '1.5rem'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#1e293b' }}>Emitir Fatura Zerada</h3>
                            <button onClick={() => setShowZeroInvoiceModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div>
                            <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: '#64748b' }}>
                                Informe o mês de referência (MM/AAAA) para a fatura avulsa zerada.
                            </p>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase' }}>Mês Referência</label>
                            <input
                                type="text"
                                value={zeroInvoiceMonth}
                                onChange={(e) => {
                                    let val = e.target.value.replace(/\D/g, '');
                                    if (val.length > 2) val = val.substring(0, 2) + '/' + val.substring(2, 6);
                                    setZeroInvoiceMonth(val.substring(0, 7));
                                }}
                                placeholder="03/2026"
                                style={{
                                    width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0',
                                    fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s',
                                    color: '#0f172a'
                                }}
                                onFocus={(e) => e.target.style.borderColor = '#fb923c'}
                                onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                onClick={() => setShowZeroInvoiceModal(false)}
                                style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmZeroInvoice}
                                style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: 'none', background: '#fb923c', color: 'white', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(251, 146, 60, 0.2)' }}
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
