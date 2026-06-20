import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep, fetchOfferData } from '../lib/api';
import { 
    ChevronDown, ChevronUp, History, X, User, Home, Zap, Link, Settings, Key, Eye, EyeOff, 
    FileSearch, PlusCircle, Upload, MessageSquare, Smartphone, Mail, Paperclip, Send, 
    Loader2, Trash2, Smartphone as PhoneIcon, MessageCircle, FileText, Smartphone as MobileIcon,
    History as HistoryIcon, DollarSign, Globe, MapPin, Building2, CreditCard,
    Filter, Clock, Ban, AlertCircle, CheckCircle, Info, Lock, Unlock
} from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';
import UCInvoicesModal from './UCInvoicesModal';
import InvoiceFormModal from './InvoiceFormModal';
import ManualInvoiceUploadModal from './ManualInvoiceUploadModal';
import { sendWhatsapp } from '../lib/api';
import SubscriberModal from './SubscriberModal';
import InvoiceSummaryModal from './InvoiceSummaryModal';

export default function ConsumerUnitModal({ consumerUnit, onClose, onSave, onDelete, defaultSection = 'geral' }) {
    const { showAlert, showConfirm } = useUI();
    const { profile } = useAuth();
    const [subscribers, setSubscribers] = useState([]);
    const [usinas, setUsinas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showCredentialsModal, setShowCredentialsModal] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showInvoicesModal, setShowInvoicesModal] = useState(false);
    const [activeTab, setActiveTab] = useState(defaultSection); // 'geral' | 'tecnico' | 'financeiro' | 'comunicados'
    const [manualMessage, setManualMessage] = useState('');
    const [manualFile, setManualFile] = useState(null);
    const [isSendingManualWA, setIsSendingManualWA] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showIssueInvoiceModal, setShowIssueInvoiceModal] = useState(false);
    const [showManualUploadModal, setShowManualUploadModal] = useState(false);
    const [invoiceToEdit, setInvoiceToEdit] = useState(null);
    const [showInvoiceForm, setShowInvoiceForm] = useState(false);
    const [showZeroInvoiceModal, setShowZeroInvoiceModal] = useState(false);
    const [zeroInvoiceMonth, setZeroInvoiceMonth] = useState(`${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`);
    const [subscriberSearchTerm, setSubscriberSearchTerm] = useState('');
    const [showSubscriberDropdown, setShowSubscriberDropdown] = useState(false);
    const [titularSearchTerm, setTitularSearchTerm] = useState('');
    const [showTitularDropdown, setShowTitularDropdown] = useState(false);
    const [activeSubscriberForModal, setActiveSubscriberForModal] = useState(null);
    const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);
    const [invoices, setInvoices] = useState([]);
    const [invoicesLoading, setInvoicesLoading] = useState(false);
    const [yearFilter, setYearFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedInvoiceForSummary, setSelectedInvoiceForSummary] = useState(null);
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [editingCredentialsType, setEditingCredentialsType] = useState(null);
    const [tempCredentials, setTempCredentials] = useState({ url: '', login: '', password: '' });
    const [isUcNumberLocked, setIsUcNumberLocked] = useState(true);
    const [usinaSearchTerm, setUsinaSearchTerm] = useState('');
    const [showUsinaDropdown, setShowUsinaDropdown] = useState(false);

    // Helpers for Currency/Numbers
    const formatCurrency = (val) => {
        if (!val && val !== 0) return '';
        const number = Number(val);
        if (isNaN(number)) return '';
        return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const formatCurrency4 = (val) => {
        if (!val && val !== 0) return '';
        const number = Number(val);
        if (isNaN(number)) return '';
        return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 });
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
        { value: 'vinculado', label: 'Vinculado a Usina' },
        { value: 'em_transf_titularidade', label: 'Em Transf. de Titularidade' },
        { value: 'aguardando_conexao', label: 'Aguardando Conexão' },
        { value: 'ativo', label: 'Ativo' },
        { value: 'sem_geracao', label: 'Sem Geração' },
        { value: 'em_atraso', label: 'Em Atraso' },
        { value: 'desconectado', label: 'Desconectado' },
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
        data_ativacao: '',
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

    const fetchUCInvoices = async () => {
        if (!consumerUnit?.id) return;
        setInvoicesLoading(true);
        try {
            const { data, error } = await supabase
                .from('invoices')
                .select('*')
                .eq('uc_id', consumerUnit.id)
                .neq('status', 'cancelado')
                .order('mes_referencia', { ascending: false });

            if (error) throw error;
            setInvoices(data || []);
        } catch (error) {
            console.error('Error fetching UC invoices:', error);
        } finally {
            setInvoicesLoading(false);
        }
    };

    useEffect(() => {
        if (!consumerUnit?.id) return;
        fetchUCInvoices();

        const channel = supabase
            .channel(`uc-invoices-list-${consumerUnit.id}`)
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'invoices',
                filter: `uc_id=eq.${consumerUnit.id}`
            }, () => {
                fetchUCInvoices();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [consumerUnit?.id]);

    const addHistory = async (type, id, content, metadata = {}) => {
        try {
            const { error } = await supabase.from('crm_history').insert({
                entity_type: type,
                entity_id: id,
                content,
                metadata,
                created_by: profile?.id
            });
            if (error) throw error;
            setHistoryRefreshTrigger(prev => prev + 1);
        } catch (err) {
            console.warn('History log error:', err);
        }
    };

    const handleSendManualWA = async () => {
        const subscriber = subscribers.find(s => s.id === formData.subscriber_id);
        if (!subscriber?.phone) {
            showAlert('Assinante sem telefone cadastrado!', 'warning');
            return;
        }
        if (!manualMessage.trim()) {
            showAlert('Digite uma mensagem!', 'warning');
            return;
        }

        // Validação de tamanho de arquivo (Max 5MB)
        if (manualFile && manualFile.size > 5 * 1024 * 1024) {
            showAlert('O arquivo é muito grande! O limite é de 5MB.', 'warning');
            return;
        }

        setIsSendingManualWA(true);
        try {
            let fileBase64 = null;
            if (manualFile) {
                const reader = new FileReader();
                fileBase64 = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(manualFile);
                });
            }

            const result = await sendWhatsapp(
                subscriber.phone,
                manualMessage,
                null, 
                fileBase64,
                manualFile ? manualFile.name : null
            );

            if (result.success) {
                showAlert('Comunicado enviado com sucesso!', 'success');
                await addHistory(
                    'uc', 
                    consumerUnit.id, 
                    `WhatsApp: ${manualMessage}`, 
                    { 
                        message: manualMessage,
                        attached_file: manualFile ? manualFile.name : null,
                        recipient: subscriber.name,
                        status: 'sent'
                    }
                );
                setManualMessage('');
                setManualFile(null);
            } else {
                throw new Error(result.error || 'Falha ao enviar');
            }
        } catch (error) {
            console.error('Error sending manual WA:', error);
            showAlert('Erro ao enviar WhatsApp: ' + error.message, 'error');
        } finally {
            setIsSendingManualWA(false);
        }
    };

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
                tarifa_concessionaria: formatCurrency4(consumerUnit.tarifa_concessionaria),
                te: formatCurrency4(consumerUnit.te),
                tusd: formatCurrency4(consumerUnit.tusd),
                fio_b: formatCurrency4(consumerUnit.fio_b),
                tarifa_minima: '', // Recalculated on render
                desconto_assinante: (() => {
                    const val = consumerUnit.desconto_assinante;
                    // Normalize decimal to percentage for display (e.g. 0.20 -> 20.00)
                    if (val && !isNaN(val) && Number(val) > 0 && Number(val) <= 1) {
                        return (Number(val) * 100).toFixed(2);
                    }
                    return val || '';
                })(),
                dia_vencimento: consumerUnit.dia_vencimento || 10,
                data_ativacao: consumerUnit.data_ativacao || '',
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
        const { data } = await supabase.from('subscribers').select('*').order('name');
        setSubscribers(data || []);
    };

    const fetchUsinas = async () => {
        const { data } = await supabase.from('usinas').select('id, name, status, concessionaria, cnpj_cpf, portal_credentials, modalidade, potencia_kwp').order('name');
        setUsinas(data || []);
    };

    const openTitularCredentials = () => {
        const titular = subscribers.find(s => s.id === formData.titular_fatura_id);
        setTempCredentials(titular?.portal_credentials || { url: '', login: '', password: '' });
        setEditingCredentialsType('titular');
        setShowCredentialsModal(true);
    };

    const openUsinaCredentials = () => {
        const usina = usinas.find(u => u.id === formData.usina_id);
        setTempCredentials(usina?.portal_credentials || { url: '', login: '', password: '' });
        setEditingCredentialsType('usina');
        setShowCredentialsModal(true);
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
        setFormData(prev => {
            const sub = subscribers.find(s => s.id === subscriberId);
            return {
                ...prev,
                subscriber_id: subscriberId,
                cpf_cnpj_fatura: prev.cpf_cnpj_fatura || (sub ? sub.cpf_cnpj : '')
            };
        });
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

    const handleSubscriberSaved = (savedSub) => {
        setSubscribers(prev => prev.map(s => s.id === savedSub.id ? { ...s, ...savedSub } : s));
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
                
                // Mapear concessionária padrão por UF
                const defaultConcessionarias = {
                    'RN': 'Neoenergia Cosern',
                    'BA': 'Neoenergia Coelba',
                    'PE': 'Neoenergia Pernambuco',
                    'CE': 'Enel Ceará',
                    'RJ': 'Enel Rio',
                    'SP': 'Enel São Paulo',
                    'MG': 'Cemig',
                    'PR': 'Copel',
                    'SC': 'Celesc',
                    'MA': 'Equatorial Maranhão',
                    'PA': 'Equatorial Pará',
                    'PI': 'Equatorial Piauí',
                    'AL': 'Equatorial Alagoas'
                };
                const ufUpper = addr.uf ? addr.uf.toUpperCase() : '';
                const fallbackConcessionaria = defaultConcessionarias[ufUpper] || '';

                setFormData(prev => ({
                    ...prev,
                    rua: addr.rua || '',
                    bairro: addr.bairro || '',
                    cidade: addr.cidade || '',
                    uf: addr.uf || '',
                    concessionaria: fallbackConcessionaria || prev.concessionaria || ''
                }));

                // Fetch Offers based on IBGE
                if (addr.ibge) {
                    const offer = await fetchOfferData(addr.ibge);
                    if (offer) {
                        let discountVal = offer['Desconto Assinante'] || 0;
                        // Normalize safely: only multiply if it's clearly a decimal (e.g. 0.20)
                        // and not already a percentage (e.g. 20)
                        if (discountVal && !isNaN(discountVal) && Number(discountVal) > 0 && Number(discountVal) <= 1) {
                            discountVal = Number(discountVal) * 100;
                        }

                        setFormData(prev => ({
                            ...prev,
                            rua: addr.rua || '',
                            bairro: addr.bairro || '',
                            cidade: addr.cidade || '',
                            uf: addr.uf || '',
                            concessionaria: offer.Concessionaria || fallbackConcessionaria || prev.concessionaria,
                            tarifa_concessionaria: offer['Tarifa Concessionaria'] ? formatCurrency4(offer['Tarifa Concessionaria']) : prev.tarifa_concessionaria,
                            te: offer['TE'] ? formatCurrency4(offer['TE']) : prev.te,
                            tusd: offer['TUSD'] ? formatCurrency4(offer['TUSD']) : prev.tusd,
                            fio_b: offer['Fio B'] ? formatCurrency4(offer['Fio B']) : prev.fio_b,
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
                data_ativacao: formData.data_ativacao || null,
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
                status: 'sem_faturamento',
                energy_bill_status: 'pago'
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

    // Helper to format month name capitalized
    const formatMonth = (dateStr) => {
        if (!dateStr) return '-';
        const [year, month] = dateStr.split('-');
        if (!year || !month) return dateStr;
        const date = new Date(year, parseInt(month) - 1, 1);
        const formatted = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    };

    // Helper for commercial status badge
    const getStatusBadge = (status) => {
        const map = {
            'sem_faturamento': { color: '#1e40af', bg: '#eff6ff', label: 'Sem Faturamento', icon: FileText },
            'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago', icon: CheckCircle },
            'a_vencer': { color: '#854d0e', bg: '#fef9c3', label: 'A Vencer', icon: Clock },
            'atrasado': { color: '#991b1b', bg: '#fee2e2', label: 'Atrasado', icon: AlertCircle },
            'em_transf_titularidade': { color: '#5b21b6', bg: '#f5f3ff', label: 'Em Transf. de Titularidade', icon: Clock },
            'desconectado': { color: '#be123c', bg: '#fff1f2', label: 'Desconectado', icon: X },
            'ag_emissao_boleto': { color: '#1e40af', bg: '#eff6ff', label: 'Sem Faturamento', icon: FileText },
            'cancelado': { color: '#475569', bg: '#f1f5f9', label: 'Cancelado', icon: X },
        };
        const s = map[status] || map['a_vencer'];
        const Icon = s.icon;
        return (
            <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.2rem 0.6rem',
                background: s.bg,
                color: s.color,
                borderRadius: '99px',
                fontSize: '0.75rem',
                fontWeight: 600
            }}>
                <Icon size={12} /> {s.label}
            </span>
        );
    };

    // Helper for concessionaire status badge
    const getEnergyStatusBadge = (status, isPastDue) => {
        const statusMap = {
            'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago', icon: CheckCircle },
            'pendente': isPastDue 
                ? { color: '#dc2626', bg: '#fee2e2', label: 'Atrasado', icon: AlertCircle }
                : { color: '#2563eb', bg: '#eff6ff', label: 'A Vencer', icon: Clock },
            'erro': { color: '#991b1b', bg: '#fef2f2', label: 'Erro', icon: AlertCircle },
            'parcelada': { color: '#ca8a04', bg: '#fef9c3', label: 'Parcelado', icon: Info },
            'contestada': { color: '#7c3aed', bg: '#f3e8ff', label: 'Contestado', icon: Ban }
        };
        const s = statusMap[status] || statusMap['pendente'];
        const Icon = s.icon;
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', background: s.bg, color: s.color, borderRadius: '99px', fontSize: '0.75rem', width: 'fit-content', fontWeight: 600 }}>
                <Icon size={12} /> {s.label}
            </span>
        );
    };

    const getEnergyStatus = (inv) => {
        const ebStatus = inv.energy_bill_status || 'pendente';
        if (ebStatus === 'pago') return 'pago';
        if (ebStatus === 'erro') return 'erro';
        if (ebStatus === 'parcelada') return 'parcelada';
        if (ebStatus === 'contestada') return 'contestada';
        const today = new Date().toISOString().split('T')[0];
        const dueDate = inv.vencimento_concessionaria || inv.vencimento;
        const isPastDue = dueDate && dueDate < today;
        return isPastDue ? 'atrasado' : 'a_vencer';
    };

    // Filtered lists for the new parallel view
    const filteredInvoicesCommercial = invoices.filter(inv => {
        // 1. Year Filter
        if (yearFilter !== 'all' && inv.mes_referencia) {
            const year = inv.mes_referencia.split('-')[0];
            if (year !== yearFilter) return false;
        }
        // 2. Status Filter
        if (statusFilter !== 'all') {
            const normalizedStatus = inv.status === 'ag_emissao_boleto' ? 'sem_faturamento' : inv.status;
            if (normalizedStatus !== statusFilter) return false;
        }
        return true;
    });

    const filteredInvoicesConcessionaire = invoices.filter(inv => {
        // 1. Year Filter
        if (yearFilter !== 'all' && inv.mes_referencia) {
            const year = inv.mes_referencia.split('-')[0];
            if (year !== yearFilter) return false;
        }
        // 2. Status Filter
        if (statusFilter !== 'all') {
            const energyStatus = getEnergyStatus(inv);
            if (energyStatus !== statusFilter) return false;
        }
        return true;
    });

    // Extract dynamic years represented in invoices + current years
    const dynamicYears = Array.from(new Set([
        new Date().getFullYear().toString(),
        (new Date().getFullYear() - 1).toString(),
        (new Date().getFullYear() - 2).toString(),
        ...invoices.map(inv => inv.mes_referencia ? inv.mes_referencia.split('-')[0] : null).filter(Boolean)
    ])).sort((a, b) => Number(b) - Number(a));

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
                    <div style={{ 
                        display: 'flex', 
                        gap: '1.5rem', 
                        padding: '0 2rem', 
                        borderBottom: '1px solid #eee',
                        background: '#f8fafc',
                        alignItems: 'center'
                    }}>
                        {/* Status Badge */}
                        {consumerUnit?.id && (
                            <div style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '20px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.025em',
                                marginRight: '1rem',
                                background: statusOptions.find(o => o.value === formData.status)?.value === 'ativo' ? '#ecfdf5' : 
                                           statusOptions.find(o => o.value === formData.status)?.value === 'em_ativacao' ? '#eff6ff' :
                                           statusOptions.find(o => o.value === formData.status)?.value === 'vinculado' ? '#e0e7ff' :
                                           statusOptions.find(o => o.value === formData.status)?.value === 'em_atraso' ? '#fff1f2' : '#f1f5f9',
                                color: statusOptions.find(o => o.value === formData.status)?.value === 'ativo' ? '#059669' : 
                                       statusOptions.find(o => o.value === formData.status)?.value === 'em_ativacao' ? '#2563eb' :
                                       statusOptions.find(o => o.value === formData.status)?.value === 'vinculado' ? '#4f46e5' :
                                       statusOptions.find(o => o.value === formData.status)?.value === 'em_atraso' ? '#e11d48' : '#475569',
                                border: `1px solid ${
                                    statusOptions.find(o => o.value === formData.status)?.value === 'ativo' ? '#d1fae5' : 
                                    statusOptions.find(o => o.value === formData.status)?.value === 'em_ativacao' ? '#dbeafe' :
                                    statusOptions.find(o => o.value === formData.status)?.value === 'vinculado' ? '#c7d2fe' :
                                    statusOptions.find(o => o.value === formData.status)?.value === 'em_atraso' ? '#ffe4e6' : '#e2e8f0'
                                }`
                            }}>
                                {statusOptions.find(o => o.value === formData.status)?.label || formData.status}
                            </div>
                        )}
                        {[
                            { id: 'geral', label: 'Geral', icon: User },
                            { id: 'tecnico', label: 'Técnico', icon: Zap },
                            { id: 'faturas_contas', label: 'Faturas e Contas de Energia', icon: FileText },
                            { id: 'financeiro', label: 'Financeiro', icon: CreditCard },
                            { id: 'comunicados', label: 'Comunicados', icon: MessageSquare }
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

                    {/* Quick Status Selector Block */}
                    <div style={{
                        padding: '1rem 2rem',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Alterar Status da UC
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {statusOptions.map(opt => {
                                const isSelected = formData.status === opt.value;
                                
                                // Color system mapping
                                let bg = '#f1f5f9';
                                let color = '#475569';
                                let border = '#cbd5e1';
                                
                                if (opt.value === 'ativo') {
                                    bg = isSelected ? '#10b981' : '#ecfdf5';
                                    color = isSelected ? '#ffffff' : '#059669';
                                    border = isSelected ? '#10b981' : '#a7f3d0';
                                } else if (opt.value === 'em_ativacao') {
                                    bg = isSelected ? '#3b82f6' : '#eff6ff';
                                    color = isSelected ? '#ffffff' : '#2563eb';
                                    border = isSelected ? '#3b82f6' : '#bfdbfe';
                                } else if (opt.value === 'vinculado') {
                                    bg = isSelected ? '#4f46e5' : '#e0e7ff';
                                    color = isSelected ? '#ffffff' : '#4338ca';
                                    border = isSelected ? '#4f46e5' : '#c7d2fe';
                                } else if (opt.value === 'em_atraso' || opt.value === 'cancelado' || opt.value === 'cancelado_inadimplente') {
                                    bg = isSelected ? '#ef4444' : '#fff1f2';
                                    color = isSelected ? '#ffffff' : '#e11d48';
                                    border = isSelected ? '#ef4444' : '#fecaca';
                                } else if (opt.value === 'aguardando_conexao' || opt.value === 'em_transf_titularidade') {
                                    bg = isSelected ? '#f59e0b' : '#fffbeb';
                                    color = isSelected ? '#ffffff' : '#d97706';
                                    border = isSelected ? '#f59e0b' : '#fde68a';
                                } else {
                                    bg = isSelected ? '#64748b' : '#f8fafc';
                                    color = isSelected ? '#ffffff' : '#475569';
                                    border = isSelected ? '#64748b' : '#cbd5e1';
                                }

                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={async () => {
                                            const newStatus = opt.value;
                                            
                                            // 1. Update form data locally
                                            let activationDate = formData.data_ativacao;
                                            if (newStatus === 'ativo' && !formData.data_ativacao) {
                                                activationDate = new Date().toISOString().split('T')[0];
                                            }
                                            
                                            setFormData(prev => ({
                                                ...prev,
                                                status: newStatus,
                                                data_ativacao: activationDate
                                            }));

                                            // 2. If it's an existing consumer unit, update the database immediately
                                            if (consumerUnit?.id) {
                                                try {
                                                    const { error } = await supabase
                                                        .from('consumer_units')
                                                        .update({
                                                            status: newStatus,
                                                            data_ativacao: activationDate || null
                                                        })
                                                        .eq('id', consumerUnit.id);
                                                    
                                                    if (error) throw error;
                                                    
                                                    // Add to chronological CRM history log
                                                    const statusLabel = opt.label;
                                                    await addHistory(
                                                        'uc',
                                                        consumerUnit.id,
                                                        `Status alterado diretamente no modal para: ${statusLabel}`,
                                                        { 
                                                            status: newStatus,
                                                            data_ativacao: activationDate || null
                                                        }
                                                    );
                                                    
                                                    showAlert(`Status da UC alterado para "${statusLabel}" com sucesso!`, 'success');
                                                } catch (err) {
                                                    console.error('Error updating status immediately:', err);
                                                    showAlert('Erro ao atualizar status: ' + err.message, 'error');
                                                }
                                            }
                                        }}
                                        style={{
                                            padding: '0.35rem 0.75rem',
                                            borderRadius: '20px',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            border: `1.5px solid ${border}`,
                                            background: bg,
                                            color: color,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.25rem',
                                            boxShadow: isSelected ? '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' : 'none',
                                            transform: isSelected ? 'scale(1.05)' : 'none'
                                        }}
                                        onMouseEnter={e => {
                                            if (!isSelected) {
                                                e.currentTarget.style.borderColor = color;
                                                e.currentTarget.style.background = isSelected ? bg : '#e2e8f0';
                                            }
                                        }}
                                        onMouseLeave={e => {
                                            if (!isSelected) {
                                                e.currentTarget.style.borderColor = border;
                                                e.currentTarget.style.background = bg;
                                            }
                                        }}
                                    >
                                        {isSelected && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'white', display: 'inline-block' }}></span>}
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ padding: '2rem', flex: 1 }}>
                        <form onSubmit={handleSubmit}>
                            {/* Tab Content: Geral */}
                            {activeTab === 'geral' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                        <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <Zap size={18} color="var(--color-blue)" /> Identificação da UC
                                            </h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Número da UC <span style={{ color: '#ef4444' }}>*</span></label>
                                                    <div style={{ position: 'relative' }}>
                                                        <input
                                                            required
                                                            readOnly={isUcNumberLocked}
                                                            value={formData.numero_uc}
                                                            onChange={e => setFormData({ ...formData, numero_uc: e.target.value })}
                                                            placeholder="Ex: 7204400277"
                                                            style={{ 
                                                                width: '100%', 
                                                                padding: '0.7rem 2.5rem 0.7rem 0.7rem', 
                                                                border: '1px solid #e2e8f0', 
                                                                borderRadius: '8px', 
                                                                outline: 'none',
                                                                background: isUcNumberLocked ? '#f1f5f9' : 'white',
                                                                color: isUcNumberLocked ? '#64748b' : '#0f172a',
                                                                cursor: isUcNumberLocked ? 'not-allowed' : 'text'
                                                            }}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsUcNumberLocked(!isUcNumberLocked)}
                                                            style={{
                                                                position: 'absolute',
                                                                right: '0.5rem',
                                                                top: '50%',
                                                                transform: 'translateY(-50%)',
                                                                background: 'none',
                                                                border: 'none',
                                                                cursor: 'pointer',
                                                                padding: '0.4rem',
                                                                color: isUcNumberLocked ? '#ef4444' : '#22c55e',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                borderRadius: '4px',
                                                                transition: 'all 0.2s'
                                                            }}
                                                            title={isUcNumberLocked ? "Desbloquear campo para editar" : "Bloquear campo contra alterações"}
                                                        >
                                                            {isUcNumberLocked ? <Lock size={16} /> : <Unlock size={16} />}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Identificação na Fatura</label>
                                                    <input
                                                        required
                                                        value={formData.titular_conta}
                                                        onChange={e => setFormData({ ...formData, titular_conta: e.target.value })}
                                                        placeholder="Nome como aparece na conta"
                                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <Link size={18} color="var(--color-blue)" /> Vínculos
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                <div style={{ position: 'relative' }}>
                                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Assinante Vinculado</label>
                                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                        <div style={{ position: 'relative', flex: 1 }}>
                                                            <input
                                                                type="text"
                                                                value={subscriberSearchTerm}
                                                                onFocus={() => setShowSubscriberDropdown(true)}
                                                                onBlur={() => setTimeout(() => setShowSubscriberDropdown(false), 250)}
                                                                onChange={e => {
                                                                    setSubscriberSearchTerm(e.target.value);
                                                                    setShowSubscriberDropdown(true);
                                                                }}
                                                                placeholder={
                                                                    formData.subscriber_id 
                                                                        ? subscribers.find(s => s.id === formData.subscriber_id)?.name || "Buscar para trocar assinante..." 
                                                                        : "Buscar assinante por nome, CPF/CNPJ..."
                                                                }
                                                                style={{ 
                                                                    width: '100%', 
                                                                    padding: '0.7rem 2.5rem 0.7rem 0.7rem', 
                                                                    border: '1px solid #e2e8f0', 
                                                                    borderRadius: '8px', 
                                                                    outline: 'none',
                                                                    fontSize: '0.9rem',
                                                                    transition: 'border-color 0.2s',
                                                                    borderColor: showSubscriberDropdown ? 'var(--color-blue)' : '#e2e8f0'
                                                                }}
                                                            />
                                                            <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                                                                <FileSearch size={18} />
                                                            </div>
                                                        </div>
                                                        {formData.subscriber_id && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setFormData(prev => ({ ...prev, subscriber_id: '' }));
                                                                    setSubscriberSearchTerm('');
                                                                }}
                                                                style={{
                                                                    padding: '0.7rem 1rem',
                                                                    background: '#ef4444',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '8px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    fontWeight: 500,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.25rem',
                                                                    boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)'
                                                                }}
                                                            >
                                                                Desvincular
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Dropdown de Resultados da Busca */}
                                                    {showSubscriberDropdown && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: '100%',
                                                            left: 0,
                                                            right: 0,
                                                            background: 'white',
                                                            border: '1px solid #e2e8f0',
                                                            borderRadius: '8px',
                                                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                                                            maxHeight: '200px',
                                                            overflowY: 'auto',
                                                            zIndex: 100,
                                                            marginTop: '4px'
                                                        }}>
                                                            {subscribers
                                                                .filter(s => {
                                                                    const term = subscriberSearchTerm.toLowerCase().trim();
                                                                    if (!term) return true;
                                                                    return (
                                                                        s.name?.toLowerCase().includes(term) ||
                                                                        s.cpf_cnpj?.toLowerCase().includes(term) ||
                                                                        s.email?.toLowerCase().includes(term) ||
                                                                        s.phone?.toLowerCase().includes(term)
                                                                    );
                                                                })
                                                                .map(s => (
                                                                    <div
                                                                        key={s.id}
                                                                        onMouseDown={() => {
                                                                            handleSubscriberChange(s.id);
                                                                            setSubscriberSearchTerm('');
                                                                            setShowSubscriberDropdown(false);
                                                                        }}
                                                                        style={{
                                                                            padding: '0.75rem 1rem',
                                                                            cursor: 'pointer',
                                                                            borderBottom: '1px solid #f1f5f9',
                                                                            transition: 'background 0.15s'
                                                                        }}
                                                                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                                    >
                                                                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.875rem' }}>{s.name}</div>
                                                                        <div style={{ display: 'flex', gap: '1rem', color: '#64748b', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                                                                            <span>CPF/CNPJ: {s.cpf_cnpj}</span>
                                                                            {s.email && <span>E-mail: {s.email}</span>}
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            }
                                                            {subscribers.filter(s => {
                                                                const term = subscriberSearchTerm.toLowerCase().trim();
                                                                if (!term) return true;
                                                                return (
                                                                    s.name?.toLowerCase().includes(term) ||
                                                                    s.cpf_cnpj?.toLowerCase().includes(term) ||
                                                                    s.email?.toLowerCase().includes(term) ||
                                                                    s.phone?.toLowerCase().includes(term)
                                                                );
                                                            }).length === 0 && (
                                                                <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>
                                                                    Nenhum assinante encontrado.
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Card do Assinante Vinculado */}
                                                {(() => {
                                                    const sub = subscribers.find(s => s.id === formData.subscriber_id);
                                                    if (!sub) return null;
                                                    return (
                                                        <div 
                                                            onClick={() => setActiveSubscriberForModal(sub)}
                                                            style={{
                                                                background: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)',
                                                                border: '1.5px solid #bfdbfe',
                                                                borderRadius: '12px',
                                                                padding: '1rem',
                                                                cursor: 'pointer',
                                                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
                                                                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '0.75rem',
                                                                position: 'relative',
                                                                overflow: 'hidden'
                                                            }}
                                                            onMouseEnter={e => {
                                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                                e.currentTarget.style.borderColor = 'var(--color-blue)';
                                                                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(37, 99, 235, 0.1), 0 4px 6px -4px rgba(37, 99, 235, 0.1)';
                                                            }}
                                                            onMouseLeave={e => {
                                                                e.currentTarget.style.transform = 'translateY(0)';
                                                                e.currentTarget.style.borderColor = '#bfdbfe';
                                                                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)';
                                                            }}
                                                        >
                                                            {/* Background accent line */}
                                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--color-blue)' }}></div>
                                                            
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '0.25rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                    <User size={18} color="var(--color-blue)" style={{ minWidth: '18px' }} />
                                                                    <h5 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>{sub.name}</h5>
                                                                </div>
                                                                <span style={{
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: 600,
                                                                    background: '#dbeafe',
                                                                    color: 'var(--color-blue)',
                                                                    padding: '0.2rem 0.6rem',
                                                                    borderRadius: '20px',
                                                                    textTransform: 'uppercase',
                                                                    letterSpacing: '0.05em'
                                                                }}>
                                                                    Ver Cadastro
                                                                </span>
                                                            </div>

                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem', color: '#475569', borderTop: '1px dashed #e2e8f0', paddingTop: '0.75rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <CreditCard size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span style={{ fontWeight: 500 }}>{sub.cpf_cnpj || 'Sem CPF/CNPJ'}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <Smartphone size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span>{sub.phone || 'Sem Telefone'}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', gridColumn: 'span 2' }}>
                                                                    <Mail size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{sub.email || 'Sem E-mail'}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}

                                                {/* Titular da Fatura Field */}
                                                <div style={{ position: 'relative', marginTop: '0.5rem' }}>
                                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Titular da Conta de Energia ( concessionária )</label>
                                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                        <div style={{ position: 'relative', flex: 1 }}>
                                                            <input
                                                                type="text"
                                                                value={titularSearchTerm}
                                                                onFocus={() => setShowTitularDropdown(true)}
                                                                onBlur={() => setTimeout(() => setShowTitularDropdown(false), 250)}
                                                                onChange={e => {
                                                                    setTitularSearchTerm(e.target.value);
                                                                    setShowTitularDropdown(true);
                                                                }}
                                                                placeholder={
                                                                    formData.titular_fatura_id 
                                                                        ? subscribers.find(s => s.id === formData.titular_fatura_id)?.name || "Buscar para trocar titular..." 
                                                                        : "Buscar titular por nome, CPF/CNPJ..."
                                                                }
                                                                style={{ 
                                                                    width: '100%', 
                                                                    padding: '0.7rem 2.5rem 0.7rem 0.7rem', 
                                                                    border: '1px solid #e2e8f0', 
                                                                    borderRadius: '8px', 
                                                                    outline: 'none',
                                                                    fontSize: '0.9rem',
                                                                    transition: 'border-color 0.2s',
                                                                    borderColor: showTitularDropdown ? 'var(--color-blue)' : '#e2e8f0'
                                                                }}
                                                            />
                                                            <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                                                                <FileSearch size={18} />
                                                            </div>
                                                        </div>
                                                        {formData.titular_fatura_id && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setFormData(prev => ({ ...prev, titular_fatura_id: '' }));
                                                                    setTitularSearchTerm('');
                                                                }}
                                                                style={{
                                                                    padding: '0.7rem 1rem',
                                                                    background: '#ef4444',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '8px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    fontWeight: 500,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.25rem',
                                                                    boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)'
                                                                }}
                                                            >
                                                                Desvincular
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Dropdown de Resultados da Busca do Titular */}
                                                    {showTitularDropdown && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: '100%',
                                                            left: 0,
                                                            right: 0,
                                                            background: 'white',
                                                            border: '1px solid #e2e8f0',
                                                            borderRadius: '8px',
                                                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                                                            maxHeight: '200px',
                                                            overflowY: 'auto',
                                                            zIndex: 100,
                                                            marginTop: '4px'
                                                        }}>
                                                            {subscribers
                                                                .filter(s => {
                                                                    const term = titularSearchTerm.toLowerCase().trim();
                                                                    if (!term) return true;
                                                                    return (
                                                                        s.name?.toLowerCase().includes(term) ||
                                                                        s.cpf_cnpj?.toLowerCase().includes(term) ||
                                                                        s.email?.toLowerCase().includes(term) ||
                                                                        s.phone?.toLowerCase().includes(term)
                                                                    );
                                                                })
                                                                .map(s => (
                                                                    <div
                                                                        key={s.id}
                                                                        onMouseDown={() => {
                                                                            setFormData(prev => ({ 
                                                                                ...prev, 
                                                                                titular_fatura_id: s.id,
                                                                                cpf_cnpj_fatura: prev.cpf_cnpj_fatura || s.cpf_cnpj,
                                                                                portal_credentials: s.portal_credentials || prev.portal_credentials || { url: '', login: '', password: '' }
                                                                            }));
                                                                            setTitularSearchTerm('');
                                                                            setShowTitularDropdown(false);
                                                                        }}
                                                                        style={{
                                                                            padding: '0.75rem 1rem',
                                                                            cursor: 'pointer',
                                                                            borderBottom: '1px solid #f1f5f9',
                                                                            transition: 'background 0.15s'
                                                                        }}
                                                                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                                    >
                                                                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.875rem' }}>{s.name}</div>
                                                                        <div style={{ display: 'flex', gap: '1rem', color: '#64748b', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                                                                            <span>CPF/CNPJ: {s.cpf_cnpj}</span>
                                                                            {s.email && <span>E-mail: {s.email}</span>}
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            }
                                                            {subscribers.filter(s => {
                                                                const term = titularSearchTerm.toLowerCase().trim();
                                                                if (!term) return true;
                                                                return (
                                                                    s.name?.toLowerCase().includes(term) ||
                                                                    s.cpf_cnpj?.toLowerCase().includes(term) ||
                                                                    s.email?.toLowerCase().includes(term) ||
                                                                    s.phone?.toLowerCase().includes(term)
                                                                );
                                                            }).length === 0 && (
                                                                <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>
                                                                    Nenhum titular encontrado.
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Card do Titular da Fatura */}
                                                {(() => {
                                                    const sub = subscribers.find(s => s.id === formData.titular_fatura_id);
                                                    if (!sub) return null;
                                                    return (
                                                        <div 
                                                            style={{
                                                                background: 'linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%)',
                                                                border: '1.5px solid #bbf7d0',
                                                                borderRadius: '12px',
                                                                padding: '1rem',
                                                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
                                                                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '0.75rem',
                                                                position: 'relative',
                                                                overflow: 'hidden'
                                                            }}
                                                            onMouseEnter={e => {
                                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                                e.currentTarget.style.borderColor = '#22c55e';
                                                                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(34, 197, 94, 0.1), 0 4px 6px -4px rgba(34, 197, 94, 0.1)';
                                                            }}
                                                            onMouseLeave={e => {
                                                                e.currentTarget.style.transform = 'translateY(0)';
                                                                e.currentTarget.style.borderColor = '#bbf7d0';
                                                                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)';
                                                            }}
                                                        >
                                                            {/* Background accent line */}
                                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: '#22c55e' }}></div>
                                                            
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '0.25rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                    <User size={18} color="#22c55e" style={{ minWidth: '18px' }} />
                                                                    <h5 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>{sub.name}</h5>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={openTitularCredentials}
                                                                    style={{
                                                                        fontSize: '0.7rem',
                                                                        fontWeight: 700,
                                                                        background: '#dcfce7',
                                                                        color: '#15803d',
                                                                        padding: '0.2rem 0.6rem',
                                                                        borderRadius: '20px',
                                                                        border: 'none',
                                                                        cursor: 'pointer',
                                                                        textTransform: 'uppercase',
                                                                        letterSpacing: '0.05em',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.25rem'
                                                                    }}
                                                                >
                                                                    <Key size={12} /> Credenciais
                                                                </button>
                                                            </div>
 
                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem', color: '#475569', borderTop: '1px dashed #e2e8f0', paddingTop: '0.75rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <CreditCard size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span style={{ fontWeight: 500 }}>{sub.cpf_cnpj || 'Sem CPF/CNPJ'}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <Smartphone size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span>{sub.phone || 'Sem Telefone'}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', gridColumn: 'span 2' }}>
                                                                    <Mail size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{sub.email || 'Sem E-mail'}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}

                                                {/* Usina Vinculada Field */}
                                                <div style={{ position: 'relative', marginTop: '0.5rem' }}>
                                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Usina Vinculada</label>
                                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                        <div style={{ position: 'relative', flex: 1 }}>
                                                            <input
                                                                type="text"
                                                                value={usinaSearchTerm}
                                                                onFocus={() => setShowUsinaDropdown(true)}
                                                                onBlur={() => setTimeout(() => setShowUsinaDropdown(false), 250)}
                                                                onChange={e => {
                                                                    setUsinaSearchTerm(e.target.value);
                                                                    setShowUsinaDropdown(true);
                                                                }}
                                                                placeholder={
                                                                    formData.usina_id 
                                                                        ? usinas.find(u => u.id === formData.usina_id)?.name || "Buscar para trocar usina..." 
                                                                        : "Buscar usina por nome, CNPJ/CPF..."
                                                                }
                                                                style={{ 
                                                                    width: '100%', 
                                                                    padding: '0.7rem 2.5rem 0.7rem 0.7rem', 
                                                                    border: '1px solid #e2e8f0', 
                                                                    borderRadius: '8px', 
                                                                    outline: 'none',
                                                                    fontSize: '0.9rem',
                                                                    transition: 'border-color 0.2s',
                                                                    borderColor: showUsinaDropdown ? 'var(--color-blue)' : '#e2e8f0'
                                                                }}
                                                            />
                                                            <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                                                                <FileSearch size={18} />
                                                            </div>
                                                        </div>
                                                        {formData.usina_id && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setFormData(prev => ({ ...prev, usina_id: '' }));
                                                                    setUsinaSearchTerm('');
                                                                }}
                                                                style={{
                                                                    padding: '0.7rem 1rem',
                                                                    background: '#ef4444',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '8px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem',
                                                                    fontWeight: 500,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.25rem',
                                                                    boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)'
                                                                }}
                                                            >
                                                                Desvincular
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Dropdown de Resultados da Busca da Usina */}
                                                    {showUsinaDropdown && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: '100%',
                                                            left: 0,
                                                            right: 0,
                                                            background: 'white',
                                                            border: '1px solid #e2e8f0',
                                                            borderRadius: '8px',
                                                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                                                            maxHeight: '200px',
                                                            overflowY: 'auto',
                                                            zIndex: 100,
                                                            marginTop: '4px'
                                                        }}>
                                                            {usinas
                                                                .filter(u => {
                                                                    const term = usinaSearchTerm.toLowerCase().trim();
                                                                    if (!term) return true;
                                                                    return (
                                                                        u.name?.toLowerCase().includes(term) ||
                                                                        u.cnpj_cpf?.toLowerCase().includes(term) ||
                                                                        u.concessionaria?.toLowerCase().includes(term)
                                                                    );
                                                                })
                                                                .map(u => (
                                                                    <div
                                                                        key={u.id}
                                                                        onMouseDown={() => {
                                                                            setFormData(prev => ({ 
                                                                                ...prev, 
                                                                                usina_id: u.id
                                                                            }));
                                                                            setUsinaSearchTerm('');
                                                                            setShowUsinaDropdown(false);
                                                                        }}
                                                                        style={{
                                                                            padding: '0.75rem 1rem',
                                                                            cursor: 'pointer',
                                                                            borderBottom: '1px solid #f1f5f9',
                                                                            transition: 'background 0.15s'
                                                                        }}
                                                                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                                    >
                                                                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.875rem' }}>{u.name}</div>
                                                                        <div style={{ display: 'flex', gap: '1rem', color: '#64748b', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                                                                            <span>CNPJ/CPF: {u.cnpj_cpf || 'Sem CNPJ/CPF'}</span>
                                                                            <span>Concessionária: {u.concessionaria}</span>
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            }
                                                            {usinas.filter(u => {
                                                                const term = usinaSearchTerm.toLowerCase().trim();
                                                                if (!term) return true;
                                                                return (
                                                                    u.name?.toLowerCase().includes(term) ||
                                                                    u.cnpj_cpf?.toLowerCase().includes(term) ||
                                                                    u.concessionaria?.toLowerCase().includes(term)
                                                                );
                                                            }).length === 0 && (
                                                                <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>
                                                                    Nenhuma usina encontrada.
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Card da Usina Vinculada */}
                                                {(() => {
                                                    const usina = usinas.find(u => u.id === formData.usina_id);
                                                    if (!usina) return null;
                                                    return (
                                                        <div 
                                                            style={{
                                                                background: 'linear-gradient(135deg, #fffbeb 0%, #ffffff 100%)',
                                                                border: '1.5px solid #fde68a',
                                                                borderRadius: '12px',
                                                                padding: '1rem',
                                                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
                                                                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '0.75rem',
                                                                position: 'relative',
                                                                overflow: 'hidden'
                                                            }}
                                                            onMouseEnter={e => {
                                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                                e.currentTarget.style.borderColor = '#d97706';
                                                                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(217, 119, 6, 0.1), 0 4px 6px -4px rgba(217, 119, 6, 0.1)';
                                                            }}
                                                            onMouseLeave={e => {
                                                                e.currentTarget.style.transform = 'translateY(0)';
                                                                e.currentTarget.style.borderColor = '#fde68a';
                                                                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)';
                                                            }}
                                                        >
                                                            {/* Background accent line */}
                                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: '#f59e0b' }}></div>
                                                            
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '0.25rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                    <Building2 size={18} color="#f59e0b" style={{ minWidth: '18px' }} />
                                                                    <h5 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>{usina.name}</h5>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={openUsinaCredentials}
                                                                    style={{
                                                                        fontSize: '0.7rem',
                                                                        fontWeight: 700,
                                                                        background: '#fef3c7',
                                                                        color: '#b45309',
                                                                        padding: '0.2rem 0.6rem',
                                                                        borderRadius: '20px',
                                                                        border: 'none',
                                                                        cursor: 'pointer',
                                                                        textTransform: 'uppercase',
                                                                        letterSpacing: '0.05em',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.25rem'
                                                                    }}
                                                                >
                                                                    <Key size={12} /> Credenciais
                                                                </button>
                                                            </div>
 
                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem', color: '#475569', borderTop: '1px dashed #e2e8f0', paddingTop: '0.75rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <CreditCard size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span style={{ fontWeight: 500 }}>CNPJ/CPF: {usina.cnpj_cpf || 'Sem CNPJ/CPF'}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <Zap size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span>Potência: {usina.potencia_kwp || '0'} kWp</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <Globe size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span>Concessionária: {usina.concessionaria}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                    <Clock size={14} color="#64748b" style={{ minWidth: '14px' }} />
                                                                    <span style={{ textTransform: 'capitalize' }}>Status: {usina.status}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                        <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <MapPin size={18} color="var(--color-blue)" /> Localização
                                        </h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '150px 2fr 1fr 1.5fr', gap: '1rem' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>CEP</label>
                                                <input
                                                    value={formData.cep}
                                                    onChange={handleCepChange}
                                                    onBlur={handleCepBlur}
                                                    maxLength={9}
                                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Rua</label>
                                                <input
                                                    value={formData.rua}
                                                    onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Número</label>
                                                <input
                                                    value={formData.numero}
                                                    onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Complemento</label>
                                                <input
                                                    value={formData.complemento}
                                                    onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                                    placeholder="Ex: Apto 101"
                                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                                />
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: '1rem', marginTop: '1rem' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Bairro</label>
                                                <input
                                                    value={formData.bairro}
                                                    onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Cidade</label>
                                                <input
                                                    disabled
                                                    value={formData.cidade}
                                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f1f5f9' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>UF</label>
                                                <input
                                                    disabled
                                                    value={formData.uf}
                                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', background: '#f1f5f9' }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Tab Content: Técnico */}
                            {activeTab === 'tecnico' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1.25rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Status</label>
                                            <select
                                                value={formData.status}
                                                onChange={e => {
                                                    const newStatus = e.target.value;
                                                    setFormData(prev => {
                                                        const updated = { ...prev, status: newStatus };
                                                        if (newStatus === 'ativo' && !prev.data_ativacao) {
                                                            updated.data_ativacao = new Date().toISOString().split('T')[0];
                                                        }
                                                        return updated;
                                                    });
                                                }}
                                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                            >
                                                {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Data de Ativação</label>
                                            <input
                                                type="date"
                                                value={formData.data_ativacao}
                                                onChange={e => setFormData({ ...formData, data_ativacao: e.target.value })}
                                                style={{ width: '100%', padding: '0.62rem 0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none', color: '#0f172a' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Tipo de Unidade</label>
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
                                                {diaLeituraOptions.map(d => <option key={d} value={d}>{d}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    <div style={{ marginBottom: '1.25rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Concessionária</label>
                                        <select
                                            value={formData.concessionaria}
                                            onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                        >
                                            <option value="">Selecione...</option>
                                            {concessionariaOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>

                                </div>
                            )}

                            {/* Tab Content: Financeiro */}
                            {activeTab === 'financeiro' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <DollarSign size={18} color="var(--color-blue)" /> Faturamento
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Dia de Vencimento</label>
                                                    <select
                                                        value={formData.dia_vencimento}
                                                        onChange={e => setFormData({ ...formData, dia_vencimento: e.target.value })}
                                                        style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                                    >
                                                        {vencimentoOptions.map(d => <option key={d} value={d}>{d}</option>)}
                                                    </select>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Desconto (%)</label>
                                                        <input
                                                            type="number" step="0.01"
                                                            value={formData.desconto_assinante}
                                                            onChange={e => setFormData({ ...formData, desconto_assinante: e.target.value })}
                                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.4rem', color: '#64748b', fontWeight: 500 }}>Franquia (kWh)</label>
                                                        <input
                                                            type="number"
                                                            value={formData.franquia}
                                                            onChange={e => setFormData({ ...formData, franquia: e.target.value })}
                                                            style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', outline: 'none' }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ background: '#f0f9ff', padding: '1.25rem', borderRadius: '12px', border: '1px solid #bae6fd' }}>
                                            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <Zap size={18} color="#0369a1" /> Tarifas Atuais
                                            </h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.75rem', color: '#0369a1', marginBottom: '0.4rem' }}>Tarifa Concessionária</label>
                                                    <div style={{ padding: '0.7rem', background: '#fff', border: '1px solid #bae6fd', borderRadius: '8px', color: '#0369a1', fontWeight: 600 }}>
                                                        {formData.tarifa_concessionaria || 'R$ 0,00'}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.75rem', color: '#0369a1', marginBottom: '0.4rem' }}>Mínima Estimada</label>
                                                    <div style={{ padding: '0.7rem', background: '#fff', border: '1px solid #bae6fd', borderRadius: '8px', color: '#0369a1', fontWeight: 600 }}>
                                                        {formData.tarifa_minima || 'R$ 0,00'}
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ marginTop: '1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                    <input type="checkbox" checked={formData.saldo_remanescente} onChange={e => setFormData({ ...formData, saldo_remanescente: e.target.checked })} id="saldo_rem" />
                                                    <label htmlFor="saldo_rem" style={{ fontSize: '0.85rem', color: '#0369a1', fontWeight: 500, cursor: 'pointer' }}>Utilizar Saldo Remanescente</label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Tab Content: Faturas e Contas de Energia */}
                            {activeTab === 'faturas_contas' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    {/* Moved Gestão de Faturas Block */}
                                    {consumerUnit?.id && (
                                        <div style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
                                            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <FileText size={18} color="var(--color-blue)" /> Gestão de Faturas e Contas
                                            </h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                                                <button 
                                                    type="button" 
                                                    onClick={() => setShowIssueInvoiceModal(true)} 
                                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', background: 'var(--color-blue)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 2px 4px -1px rgba(59, 130, 246, 0.2)' }}
                                                    onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                                                    onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                                                >
                                                    <PlusCircle size={15} /> Nova Fatura
                                                </button>
                                                <button 
                                                    type="button" 
                                                    onClick={() => setShowManualUploadModal(true)} 
                                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', background: '#22c55e', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 2px 4px -1px rgba(34, 197, 94, 0.2)' }}
                                                    onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                                                    onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                                                >
                                                    <Upload size={15} /> Upload Conta
                                                </button>
                                                <button 
                                                    type="button" 
                                                    onClick={handleIssueZeroInvoice} 
                                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem', background: '#64748b', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 2px 4px -1px rgba(100, 116, 139, 0.2)' }}
                                                    onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                                                    onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                                                >
                                                    <Ban size={15} /> Sem Faturamento
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Unified Synchronized Filter Header */}
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'space-between', 
                                        background: '#f8fafc', 
                                        padding: '0.85rem 1.25rem', 
                                        borderRadius: '12px', 
                                        border: '1px solid #e2e8f0',
                                        gap: '1rem',
                                        flexWrap: 'wrap'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#475569', fontWeight: 700, fontSize: '0.9rem' }}>
                                            <Filter size={18} color="var(--color-blue)" /> Filtros Sincronizados
                                        </div>
                                        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Ano Referência:</span>
                                                <select
                                                    value={yearFilter}
                                                    onChange={e => setYearFilter(e.target.value)}
                                                    style={{ padding: '0.4rem 0.8rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', outline: 'none', background: 'white', minWidth: '110px', color: '#334155', fontWeight: 500 }}
                                                >
                                                    <option value="all">Todos</option>
                                                    {dynamicYears.map(y => (
                                                        <option key={y} value={y}>{y}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Status:</span>
                                                <select
                                                    value={statusFilter}
                                                    onChange={e => setStatusFilter(e.target.value)}
                                                    style={{ padding: '0.4rem 0.8rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', outline: 'none', background: 'white', minWidth: '150px', color: '#334155', fontWeight: 500 }}
                                                >
                                                    <option value="all">Todos</option>
                                                    <option value="pago">Pago</option>
                                                    <option value="a_vencer">A Vencer</option>
                                                    <option value="atrasado">Atrasado</option>
                                                    <option value="sem_faturamento">Sem Faturamento</option>
                                                    <option value="parcelada">Parcelado</option>
                                                    <option value="contestada">Contestado</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Parallel Lists Grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        
                                        {/* Column 1: Faturas da UC (Commercial) */}
                                        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1.5px solid #f1f5f9', paddingBottom: '0.85rem' }}>
                                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <FileText size={18} color="var(--color-blue)" /> Faturas da UC
                                                </h4>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--color-blue)', background: '#eff6ff', border: '1px solid #dbeafe', padding: '0.2rem 0.6rem', borderRadius: '20px', fontWeight: 700 }}>
                                                    {filteredInvoicesCommercial.length} fatura(s)
                                                </span>
                                            </div>

                                            {invoicesLoading ? (
                                                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: '#64748b' }}>
                                                    <Loader2 className="animate-spin" size={24} />
                                                </div>
                                            ) : filteredInvoicesCommercial.length === 0 ? (
                                                <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                                                    <Info size={36} color="#cbd5e1" />
                                                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Nenhuma fatura comercial encontrada.</span>
                                                </div>
                                            ) : (
                                                <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', tableLayout: 'fixed' }}>
                                                        <thead>
                                                            <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', textAlign: 'left', position: 'sticky', top: 0, background: 'white', zIndex: 10 }}>
                                                                <th style={{ width: '28%', padding: '0.75rem 0.5rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mês Ref.</th>
                                                                <th style={{ width: '25%', padding: '0.75rem 0.5rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Valor</th>
                                                                <th style={{ width: '27%', padding: '0.75rem 0.5rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                                                                <th style={{ width: '20%', padding: '0.75rem 0.5rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Ações</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {filteredInvoicesCommercial.map(inv => (
                                                                <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                                    <td style={{ padding: '0.85rem 0.5rem', fontWeight: 600, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {formatMonth(inv.mes_referencia)}
                                                                    </td>
                                                                    <td style={{ padding: '0.85rem 0.5rem', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {Number(inv.valor_a_pagar) === 0 && inv.status === 'sem_faturamento' ? 'R$ 0,00' : formatCurrency(inv.valor_a_pagar)}
                                                                    </td>
                                                                    <td style={{ padding: '0.85rem 0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {getStatusBadge(inv.status)}
                                                                    </td>
                                                                    <td style={{ padding: '0.85rem 0.5rem', textAlign: 'right' }}>
                                                                        <button 
                                                                            type="button" 
                                                                            onClick={() => {
                                                                                setInvoiceToEdit(inv);
                                                                                setShowInvoiceForm(true);
                                                                            }}
                                                                            style={{ padding: '0.4rem 0.8rem', border: '1.5px solid #cbd5e1', background: 'white', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: '#475569', transition: 'all 0.2s' }}
                                                                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-blue)'; e.currentTarget.style.color = 'var(--color-blue)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(59, 130, 246, 0.1)'; }}
                                                                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.boxShadow = 'none'; }}
                                                                        >
                                                                            Editar
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>

                                        {/* Column 2: Contas de Concessionária */}
                                        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1.5px solid #f1f5f9', paddingBottom: '0.85rem' }}>
                                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <Zap size={18} color="#eab308" /> Contas de Energia
                                                </h4>
                                                <span style={{ fontSize: '0.75rem', color: '#ca8a04', background: '#fef9c3', border: '1px solid #fef08a', padding: '0.2rem 0.6rem', borderRadius: '20px', fontWeight: 700 }}>
                                                    {filteredInvoicesConcessionaire.length} conta(s)
                                                </span>
                                            </div>

                                            {invoicesLoading ? (
                                                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: '#64748b' }}>
                                                    <Loader2 className="animate-spin" size={24} />
                                                </div>
                                            ) : filteredInvoicesConcessionaire.length === 0 ? (
                                                <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                                                    <Info size={36} color="#cbd5e1" />
                                                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Nenhuma conta de concessionária encontrada.</span>
                                                </div>
                                            ) : (
                                                <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', tableLayout: 'fixed' }}>
                                                        <thead>
                                                            <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', textAlign: 'left', position: 'sticky', top: 0, background: 'white', zIndex: 10 }}>
                                                                <th style={{ width: '28%', padding: '0.75rem 0.5rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mês Ref.</th>
                                                                <th style={{ width: '25%', padding: '0.75rem 0.5rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Valor</th>
                                                                <th style={{ width: '27%', padding: '0.75rem 0.5rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                                                                <th style={{ width: '20%', padding: '0.75rem 0.5rem', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Ações</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {filteredInvoicesConcessionaire.map(inv => {
                                                                const energyBillValue = Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0) + (Number(inv.consumo_reais) || 0));
                                                                const today = new Date().toISOString().split('T')[0];
                                                                const dueDate = inv.vencimento_concessionaria || inv.vencimento;
                                                                const isPastDue = dueDate && dueDate < today && inv.energy_bill_status !== 'pago';
                                                                return (
                                                                    <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                                        <td style={{ padding: '0.85rem 0.5rem', fontWeight: 600, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {formatMonth(inv.mes_referencia)}
                                                                        </td>
                                                                        <td style={{ padding: '0.85rem 0.5rem', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {formatCurrency(energyBillValue)}
                                                                        </td>
                                                                        <td style={{ padding: '0.85rem 0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {getEnergyStatusBadge(inv.energy_bill_status || 'pendente', isPastDue)}
                                                                        </td>
                                                                        <td style={{ padding: '0.85rem 0.5rem', textAlign: 'right' }}>
                                                                            <button 
                                                                                type="button" 
                                                                                onClick={() => {
                                                                                    setSelectedInvoiceForSummary(inv);
                                                                                    setShowSummaryModal(true);
                                                                                }}
                                                                                style={{ padding: '0.4rem 0.6rem', border: '1.5px solid #cbd5e1', background: 'white', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, color: '#475569', transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                                                                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-blue)'; e.currentTarget.style.color = 'var(--color-blue)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(59, 130, 246, 0.1)'; }}
                                                                                onMouseLeave={e => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.boxShadow = 'none'; }}
                                                                            >
                                                                                <Eye size={14} /> Visualizar
                                                                            </button>
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
                                </div>
                            )}

                            {/* Tab Content: Comunicados */}
                            {activeTab === 'comunicados' && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', height: '100%' }}>
                                    {/* Left: WhatsApp Composer */}
                                    <div style={{ background: '#f0fdf4', padding: '1.5rem', borderRadius: '12px', border: '1px solid #dcfce7', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#166534', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <MessageCircle size={20} /> Enviar WhatsApp
                                            </h4>
                                            <div style={{ fontSize: '0.8rem', color: '#15803d', fontWeight: 600, background: '#dcfce7', padding: '0.25rem 0.75rem', borderRadius: '20px' }}>
                                                {subscribers.find(s => s.id === formData.subscriber_id)?.phone || 'Sem Telefone'}
                                            </div>
                                        </div>

                                        <div style={{ flex: 1, position: 'relative' }}>
                                            <textarea
                                                value={manualMessage}
                                                onChange={e => setManualMessage(e.target.value)}
                                                placeholder="Digite sua mensagem aqui..."
                                                style={{
                                                    width: '100%', height: '200px', padding: '1rem', border: '1px solid #bbf7d0', borderRadius: '12px', outline: 'none', fontSize: '0.95rem', resize: 'none', background: 'white'
                                                }}
                                            />
                                            <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', right: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.8rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#166534', fontSize: '0.85rem', fontWeight: 600 }}>
                                                        <Paperclip size={16} /> {manualFile ? manualFile.name.substring(0, 15) + '...' : 'Anexo'}
                                                        <input type="file" style={{ display: 'none' }} onChange={e => setManualFile(e.target.files[0])} />
                                                    </label>
                                                    {manualFile && (
                                                        <button type="button" onClick={() => setManualFile(null)} style={{ padding: '0.4rem', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={isSendingManualWA || !manualMessage.trim()}
                                                    onClick={handleSendManualWA}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1.5rem', background: '#22c55e', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.4)'
                                                    }}
                                                >
                                                    {isSendingManualWA ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                                    Enviar
                                                </button>
                                            </div>
                                        </div>
                                        <p style={{ margin: 0, fontSize: '0.75rem', color: '#166534', opacity: 0.8 }}>
                                            * A mensagem será enviada diretamente para o WhatsApp do assinante vinculado.
                                        </p>
                                    </div>

                                    {/* Right: History Preview */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '400px' }}>
                                        <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <HistoryIcon size={20} color="var(--color-blue)" /> Últimas Interações
                                        </h4>
                                        <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                            {consumerUnit?.id ? (
                                                <HistoryTimeline
                                                    entityType="uc"
                                                    entityId={consumerUnit.id}
                                                    isInline={true}
                                                    compact={true}
                                                    hideHeader={true}
                                                    refreshTrigger={historyRefreshTrigger}
                                                />
                                            ) : (
                                                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                                                    Salve a UC para visualizar o histórico.
                                                </div>
                                            )}
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
                    isInline={false}
                    refreshTrigger={historyRefreshTrigger}
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
                            <h4 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
                                {editingCredentialsType === 'usina' ? 'Credenciais da Usina' : 'Credenciais do Titular'}
                            </h4>
                            <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>
                                {editingCredentialsType === 'usina' 
                                    ? (usinas.find(u => u.id === formData.usina_id)?.name || 'Portal da Usina')
                                    : (subscribers.find(s => s.id === formData.titular_fatura_id)?.name || 'Portal da concessionária')
                                }
                            </p>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>URL do Portal</label>
                                <input
                                    type="url"
                                    value={tempCredentials?.url || ''}
                                    onChange={e => setTempCredentials({
                                        ...tempCredentials,
                                        url: e.target.value
                                    })}
                                    placeholder="http://portal.concessionaria.com.br"
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>Email / Login</label>
                                <input
                                    type="text"
                                    value={tempCredentials?.login || ''}
                                    onChange={e => setTempCredentials({
                                        ...tempCredentials,
                                        login: e.target.value
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
                                        value={tempCredentials?.password || ''}
                                        onChange={e => setTempCredentials({
                                            ...tempCredentials,
                                            password: e.target.value
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
                                    setLoading(true);
                                    try {
                                        if (editingCredentialsType === 'titular') {
                                            if (!formData.titular_fatura_id) return;
                                            const { error } = await supabase
                                                .from('subscribers')
                                                .update({ portal_credentials: tempCredentials })
                                                .eq('id', formData.titular_fatura_id);

                                            if (error) throw error;

                                            setSubscribers(prev => prev.map(s => 
                                                s.id === formData.titular_fatura_id 
                                                    ? { ...s, portal_credentials: tempCredentials }
                                                    : s
                                            ));
                                            showAlert('Credenciais do titular salvas com sucesso!', 'success');
                                        } else if (editingCredentialsType === 'usina') {
                                            if (!formData.usina_id) return;
                                            const { error } = await supabase
                                                .from('usinas')
                                                .update({ portal_credentials: tempCredentials })
                                                .eq('id', formData.usina_id);

                                            if (error) throw error;

                                            setUsinas(prev => prev.map(u => 
                                                u.id === formData.usina_id 
                                                    ? { ...u, portal_credentials: tempCredentials }
                                                    : u
                                            ));
                                            showAlert('Credenciais da usina salvas com sucesso!', 'success');
                                        }
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

            {activeSubscriberForModal && (
                <SubscriberModal
                    key={activeSubscriberForModal.id}
                    subscriber={activeSubscriberForModal}
                    onClose={() => setActiveSubscriberForModal(null)}
                    onSave={handleSubscriberSaved}
                />
            )}

            {showSummaryModal && selectedInvoiceForSummary && (
                <InvoiceSummaryModal
                    invoice={selectedInvoiceForSummary}
                    consumerUnit={consumerUnit}
                    onClose={() => {
                        setShowSummaryModal(false);
                        setSelectedInvoiceForSummary(null);
                    }}
                    onPaymentSuccess={fetchUCInvoices}
                />
            )}
        </div>
    );
}
