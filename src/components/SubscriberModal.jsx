import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { fetchAddressByCep, fetchCpfCnpjData, createAsaasCharge, manageAsaasCustomer } from '../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone } from '../lib/validators';
import { CreditCard, Plus, Trash2, History, User, Home, Zap, X, Eye, DollarSign } from 'lucide-react';
import ConsumerUnitModal from './ConsumerUnitModal';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';

export default function SubscriberModal({ subscriber, onClose, onSave, onDelete }) {
    const { showAlert, showConfirm } = useUI();
    const { profile } = useAuth();
    const [originators, setOriginators] = useState([]);
    const [consumerUnits, setConsumerUnits] = useState([]);
    const [generating, setGenerating] = useState(false);
    const [showUcModal, setShowUcModal] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [previewUC, setPreviewUC] = useState(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [editingUC, setEditingUC] = useState(null);
    const [ucModalMode, setUcModalMode] = useState('all'); // 'all' | 'technical'

    // Status Options: ativacao, ativo, ativo_inadimplente, transferido, cancelado, cancelado_inadimplente
    const statusOptions = [
        { value: 'ativacao', label: 'Em Ativação' },
        { value: 'ativo', label: 'Ativo' },
        { value: 'ativo_inadimplente', label: 'Ativo (Inadimplente)' },
        { value: 'transferido', label: 'Transferido' },
        { value: 'cancelado', label: 'Cancelado' },
        { value: 'cancelado_inadimplente', label: 'Cancelado (Inadimplente)' }
    ];

    const [formData, setFormData] = useState({
        name: '',
        cpf_cnpj: '',
        status: 'ativacao',
        phone: '',
        email: '',
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        originator_id: ''
    });

    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);
    const [searchingDoc, setSearchingDoc] = useState(false);

    useEffect(() => {
        fetchOriginators();
    }, []); // Run once on mount

    useEffect(() => {
        if (subscriber) {
            setFormData({
                name: subscriber.name || '',
                cpf_cnpj: subscriber.cpf_cnpj || '',
                status: subscriber.status || 'ativacao',
                phone: subscriber.phone || '',
                email: subscriber.email || '',
                cep: subscriber.cep || '',
                rua: subscriber.rua || '',
                numero: subscriber.numero || '',
                complemento: subscriber.complemento || '',
                bairro: subscriber.bairro || '',
                cidade: subscriber.cidade || '',
                uf: subscriber.uf || '',
                originator_id: subscriber.originator_id || ''
            });
            fetchConsumerUnits(subscriber.id);
        }
    }, [subscriber?.id]); // Stable dependency

    const fetchOriginators = async () => {
        const { data } = await supabase
            .from('originators_v2')
            .select('id, name')
            .order('name');
        setOriginators(data || []);
    };

    const fetchConsumerUnits = async (subscriberId) => {
        const { data } = await supabase
            .from('consumer_units')
            .select('*')
            .eq('subscriber_id', subscriberId);
        setConsumerUnits(data || []);
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
                    uf: addr.uf || ''
                }));
            } catch (error) {
                console.error('Erro ao buscar CEP:', error);
                showAlert('Erro ao buscar CEP. Verifique se digitou corretamente.', 'error');
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handleDocBlur = async () => {
        const doc = formData.cpf_cnpj.replace(/\D/g, '');
        if (doc.length > 11) { // CNPJ
            setSearchingDoc(true);
            try {
                const data = await fetchCpfCnpjData(doc);
                if (data.nome) {
                    setFormData(prev => ({
                        ...prev,
                        name: data.nome || prev.name,
                        email: data.email || prev.email,
                        phone: data.telefone ? maskPhone(data.telefone) : prev.phone,
                        cep: data.address?.cep || prev.cep,
                        rua: data.address?.logradouro || prev.rua,
                        numero: data.address?.numero || prev.numero,
                        complemento: data.address?.complemento || prev.complemento,
                        bairro: data.address?.bairro || prev.bairro,
                        cidade: data.address?.municipio || prev.cidade,
                        uf: data.address?.uf || prev.uf
                    }));
                }
            } catch (error) {
                console.error('Erro buscar doc', error);
            } finally {
                setSearchingDoc(false);
            }
        } else if (doc.length === 11) { // CPF
            setSearchingDoc(true);
            try {
                const data = await fetchCpfCnpjData(doc);
                if (data.nome) {
                    setFormData(prev => ({ ...prev, name: data.nome }));
                }
            } catch (error) {
                console.error('Erro buscar doc', error);
            } finally {
                setSearchingDoc(false);
            }
        }
    };

    const handleEmission = async () => {
        if (!subscriber?.id) {
            showAlert('Salve o assinante antes de gerar boletos.', 'warning');
            return;
        }

        const confirm = await showConfirm(`Gerar boleto CONSOLIDADO (todas as faturas pendentes) para ${formData.name}?`);
        if (!confirm) return;

        setGenerating(true);
        try {
            const result = await createAsaasCharge(subscriber.id, 'subscriber');
            if (result.url) {
                showAlert('Boleto consolidado gerado com sucesso!', 'success');
                window.open(result.url, '_blank');
            }
        } catch (error) {
            console.error(error);
            showAlert('Erro: ' + (error.message || 'Falha ao gerar boleto. Verifique se há faturas pendentes.'), 'error');
        } finally {
            setGenerating(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validateDocument(formData.cpf_cnpj)) {
            showAlert('CPF/CNPJ inválido!', 'warning');
            return;
        }
        if (formData.phone && !validatePhone(formData.phone)) {
            showAlert('Telefone inválido!', 'warning');
            return;
        }

        setLoading(true);

        try {
            // 1. Check for duplicates
            let query = supabase
                .from('subscribers')
                .select('id')
                .eq('cpf_cnpj', formData.cpf_cnpj);

            if (subscriber?.id) {
                query = query.neq('id', subscriber.id);
            }

            const { data: existing, error: searchError } = await query;

            if (searchError) throw searchError;
            if (existing && existing.length > 0) {
                throw new Error('Já existe um assinante cadastrado com este CPF/CNPJ.');
            }

            // 2. Sync with Asaas
            let asaasId = null;
            let asaasSyncSuccess = false;

            try {
                const asaasResult = await manageAsaasCustomer({
                    id: subscriber?.asaas_customer_id,
                    name: formData.name,
                    cpfCnpj: formData.cpf_cnpj,
                    email: formData.email,
                    phone: formData.phone,
                    postalCode: formData.cep,
                    addressNumber: formData.numero,
                    address: formData.rua,
                    province: formData.bairro
                });

                if (asaasResult && asaasResult.success) {
                    asaasId = asaasResult.asaas_id;
                    asaasSyncSuccess = true;
                } else if (asaasResult) {
                    throw new Error(asaasResult.error || 'Erro desconhecido');
                }

            } catch (asaasError) {
                console.error("Asaas Sync Error:", asaasError);
                const proceed = await showConfirm(
                    `Falha ao sincronizar com Asaas: ${asaasError.message}.\n\nDeseja salvar apenas no CRM (Localmente)?`,
                    'Erro de Sincronização',
                    'Salvar Localmente',
                    'Corrigir Dados'
                );
                if (!proceed) {
                    setLoading(false);
                    return;
                }
            }

            // 3. Save to Supabase
            const dataToSave = { ...formData };
            if (asaasId) dataToSave.asaas_customer_id = asaasId;
            if (dataToSave.originator_id === '') dataToSave.originator_id = null;

            let result;
            if (subscriber?.id) {
                result = await supabase
                    .from('subscribers')
                    .update(dataToSave)
                    .eq('id', subscriber.id)
                    .select()
                    .single();
            } else {
                result = await supabase
                    .from('subscribers')
                    .insert(dataToSave)
                    .select()
                    .single();
            }

            if (result.error) throw result.error;

            if (asaasSyncSuccess) {
                showAlert('Cliente salvo e sincronizado com Asaas!', 'success');
            } else {
                showAlert('Cliente salvo APENAS LOCALMENTE (Erro Asaas ignorado).', 'warning');
            }

            // 4. Sync Lead Status
            try {
                let newLeadStatus = null;
                if (dataToSave.status === 'ativacao') {
                    newLeadStatus = 'ativacao';
                } else if (dataToSave.status === 'ativo') {
                    newLeadStatus = 'ativo';
                }

                if (newLeadStatus && dataToSave.email) {
                    const { data: leadsComp } = await supabase
                        .from('leads')
                        .select('id, status')
                        .eq('email', dataToSave.email)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (leadsComp && leadsComp.length > 0) {
                        const targetLead = leadsComp[0];
                        if (targetLead.status !== newLeadStatus) {
                            await supabase
                                .from('leads')
                                .update({ status: newLeadStatus })
                                .eq('id', targetLead.id);
                        }
                    }
                }
            } catch (syncErr) {
                console.error('Lead sync error:', syncErr);
            }

            onSave(result.data);
            onClose();
        } catch (error) {
            showAlert('Erro ao salvar assinante: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!subscriber?.id) return;
        const confirm = await showConfirm('Tem certeza que deseja excluir este assinante?', 'Excluir Assinante', 'Excluir', 'Cancelar');
        if (!confirm) return;

        setLoading(true);
        try {
            const { error } = await supabase
                .from('subscribers')
                .delete()
                .eq('id', subscriber.id);

            if (error) throw error;

            if (onDelete) onDelete(subscriber.id);
            onClose();
        } catch (error) {
            showAlert('Erro ao excluir: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleUnlinkUC = async (ucId) => {
        const confirm = await showConfirm('Deseja desvincular esta UC do assinante? A UC não será excluída, apenas removida deste cliente.', 'Desvincular UC');
        if (!confirm) return;

        try {
            const { error } = await supabase
                .from('consumer_units')
                .update({ subscriber_id: null })
                .eq('id', ucId);

            if (error) throw error;

            fetchConsumerUnits(subscriber.id);
            showAlert('UC desvinculada com sucesso!', 'success');
        } catch (error) {
            showAlert('Erro ao desvincular UC: ' + error.message, 'error');
        }
    };

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
                        {subscriber ? `Assinante - ${formData.name}` : 'Novo Assinante'}
                    </h3>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {subscriber && (
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

                        <CollapsibleSection title="Dados Cadastrais" icon={User} defaultOpen={true}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Status</label>
                                <select
                                    value={formData.status}
                                    onChange={e => setFormData({ ...formData, status: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                >
                                    {statusOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Originador</label>
                                <select
                                    value={formData.originator_id}
                                    onChange={e => setFormData({ ...formData, originator_id: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                >
                                    <option value="">Selecione...</option>
                                    {originators.map(o => (
                                        <option key={o.id} value={o.id}>{o.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>CPF/CNPJ</label>
                                <input
                                    value={formData.cpf_cnpj}
                                    onChange={e => setFormData({ ...formData, cpf_cnpj: maskCpfCnpj(e.target.value) })}
                                    onBlur={handleDocBlur}
                                    placeholder="000.000.000-00"
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: searchingDoc ? '#f0f9ff' : 'white', outline: 'none' }}
                                    required
                                />
                            </div>

                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Nome Completo / Razão Social</label>
                                <input
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Email</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    required
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Telefone</label>
                                <input
                                    value={formData.phone}
                                    onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                                    placeholder="(00) 00000-0000"
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Endereço" icon={Home} defaultOpen={false}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>CEP (Busca)</label>
                                <input
                                    value={formData.cep}
                                    onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                    onBlur={handleCepBlur}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: searchingCep ? '#f0f9ff' : 'white', outline: 'none' }}
                                />
                            </div>
                            <div style={{ flex: 2 }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Cidade/UF</label>
                                <input
                                    value={`${formData.cidade} - ${formData.uf}`}
                                    disabled
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #f1f5f9', borderRadius: '6px', background: '#f8fafc', color: '#64748b' }}
                                />
                            </div>

                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Rua</label>
                                <input
                                    value={formData.rua}
                                    onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Número</label>
                                <input
                                    value={formData.numero}
                                    onChange={e => setFormData({ ...formData, numero: e.target.value })}
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
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Bairro</label>
                                <input
                                    value={formData.bairro}
                                    onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Unidades Consumidoras (UCs)" icon={Zap} defaultOpen={false}>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                                    {subscriber?.id && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEditingUC({ subscriber_id: subscriber.id });
                                                setUcModalMode('all');
                                                setShowUcModal(true);
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '0.3rem',
                                                background: '#ecfdf5', color: '#059669', border: '1px solid #d1fae5',
                                                padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600
                                            }}
                                        >
                                            <Plus size={16} /> Cadastrar UCs
                                        </button>
                                    )}
                                </div>

                                {consumerUnits.length > 0 ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        {consumerUnits.map(uc => (
                                            <div key={uc.id} style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div style={{ flex: 1 }}>
                                                    <span style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>UC: {uc.numero_uc}</span>
                                                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>{uc.titular_conta}</span>
                                                    <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8' }}>{uc.concessionaria} - {uc.status?.replace('_', ' ').toUpperCase()}</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPreviewUC(uc);
                                                            setShowPreviewModal(true);
                                                        }}
                                                        style={{ padding: '0.4rem', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}
                                                        title="Ver Detalhes"
                                                    >
                                                        <Eye size={16} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setEditingUC(uc);
                                                            setUcModalMode('technical');
                                                            setShowUcModal(true);
                                                        }}
                                                        style={{ padding: '0.4rem', color: '#f59e0b', background: 'none', border: 'none', cursor: 'pointer' }}
                                                        title="Dados Técnicos e Comerciais"
                                                    >
                                                        <DollarSign size={16} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUnlinkUC(uc.id)}
                                                        style={{ padding: '0.4rem', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}
                                                        title="Desvincular UC"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '1.5rem', border: '2px dashed #e2e8f0', borderRadius: '8px' }}>
                                        <p style={{ margin: 0, fontSize: '0.9rem' }}>Nenhuma UC vinculada.</p>
                                    </div>
                                )}
                            </div>
                        </CollapsibleSection>

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', padding: '1rem 0', borderTop: '1px solid #eee', alignItems: 'center' }}>
                            <div>
                                {subscriber?.id && (
                                    <button
                                        type="button"
                                        onClick={handleEmission}
                                        disabled={generating}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            background: '#fff7ed', color: '#c2410c', border: '1px solid #ffedd5',
                                            padding: '0.6rem 1.25rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600
                                        }}
                                    >
                                        <CreditCard size={18} /> {generating ? 'Processando...' : 'Emitir Fatura Consolidada'}
                                    </button>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                {subscriber && onDelete && (
                                    <button type="button" onClick={handleDelete} style={{ padding: '0.6rem 1.25rem', background: '#fee2e2', color: '#dc2626', borderRadius: '6px', border: '1px solid #fecaca', fontWeight: 600 }}>
                                        Excluir
                                    </button>
                                )}
                                <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.25rem', background: '#f1f5f9', color: '#475569', borderRadius: '6px', border: '1px solid #e2e8f0', fontWeight: 600 }}>Cancelar</button>
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
                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                    }}
                                >
                                    {loading ? 'Salvando...' : 'Salvar Assinante'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>

            {showHistory && subscriber && (
                <HistoryTimeline
                    entityType="subscriber"
                    entityId={subscriber.id}
                    entityName={formData.name}
                    onClose={() => setShowHistory(false)}
                />
            )}

            {showUcModal && subscriber && (
                <ConsumerUnitModal
                    consumerUnit={editingUC}
                    defaultSection={ucModalMode}
                    onClose={() => {
                        setShowUcModal(false);
                        setEditingUC(null);
                        setUcModalMode('all');
                    }}
                    onSave={() => {
                        fetchConsumerUnits(subscriber.id);
                        setShowUcModal(false);
                        setEditingUC(null);
                        setUcModalMode('all');
                    }}
                />
            )}

            {/* UC Detail Preview Modal */}
            {showPreviewModal && previewUC && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1200
                }}>
                    <div style={{
                        background: 'white', borderRadius: '16px', width: '95%', maxWidth: '550px',
                        padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                        position: 'relative', maxHeight: '90vh', overflowY: 'auto'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                <div style={{ padding: '0.6rem', background: '#f0f9ff', color: '#0369a1', borderRadius: '10px' }}>
                                    <Zap size={24} />
                                </div>
                                <div>
                                    <h4 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Detalhes da Unidade Consumidora</h4>
                                    <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
                                        UC: <strong>{previewUC.numero_uc}</strong> - {previewUC.titular_conta}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setShowPreviewModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                                <X size={24} />
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Status</label>
                                <span style={{ fontSize: '0.85rem', padding: '0.2rem 0.6rem', borderRadius: '20px', background: '#f0fdf4', color: '#166534', fontWeight: 600 }}>
                                    {previewUC.status?.replace('_', ' ').toUpperCase()}
                                </span>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Concessionária</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b', fontWeight: 500 }}>{previewUC.concessionaria}</div>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Identificação na Fatura</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b' }}>{previewUC.titular_conta}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Tipo de Ligação</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b', textTransform: 'capitalize' }}>{previewUC.tipo_ligacao || 'Não inf.'}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Modalidade</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b' }}>{previewUC.modalidade?.replace(/_/g, ' ') || 'Não inf.'}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Consumo Médio</label>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#059669' }}>{previewUC.consumo_medio_kwh || previewUC.franquia || 0} kWh</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Vencimento</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b' }}>Dia {previewUC.dia_vencimento || 'N/A'}</div>
                            </div>
                            <div style={{ height: '1px', background: '#f1f5f9', gridColumn: '1 / -1' }}></div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Endereço da Unidade</label>
                                <div style={{ fontSize: '0.9rem', color: '#475569', lineHeight: 1.4 }}>
                                    {previewUC.address?.rua || 'N/A'}{previewUC.address?.numero ? `, ${previewUC.address.numero}` : ''}<br />
                                    {previewUC.address?.bairro || 'N/A'} - {previewUC.address?.cidade || 'N/A'}/{previewUC.address?.uf || 'N/A'}<br />
                                    CEP: {previewUC.address?.cep || 'N/A'}
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '2.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowPreviewModal(false)}
                                style={{ padding: '0.7rem 2.5rem', background: 'var(--color-blue)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
