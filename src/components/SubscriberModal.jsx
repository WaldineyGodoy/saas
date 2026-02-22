import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { fetchAddressByCep, fetchCpfCnpjData, createAsaasCharge, manageAsaasCustomer } from '../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone } from '../lib/validators';
import { CreditCard, Plus, Trash2 } from 'lucide-react';
import ConsumerUnitModal from './ConsumerUnitModal';

export default function SubscriberModal({ subscriber, onClose, onSave, onDelete }) {
    const { showAlert, showConfirm } = useUI();
    const { profile } = useAuth();
    const [originators, setOriginators] = useState([]);
    const [consumerUnits, setConsumerUnits] = useState([]);
    const [generating, setGenerating] = useState(false);
    const [showUcModal, setShowUcModal] = useState(false);

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
                alert('Erro ao buscar CEP. Verifique se digitou corretamente.');
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
            // 1. Check for duplicates in Supabase (Application Level Check)
            const cleanDoc = formData.cpf_cnpj.replace(/\D/g, '');
            // Unique key usually expects checking logical uniqueness. 
            // We search for the exact string first? 
            // Problem: some might be saved with mask, some without?
            // Assuming maskCpfCnpj always formats it consistent.

            let query = supabase
                .from('subscribers')
                .select('id')
                .eq('cpf_cnpj', formData.cpf_cnpj); // Check exact match of formatted string

            if (subscriber?.id) {
                query = query.neq('id', subscriber.id);
            }

            const { data: existing, error: searchError } = await query;

            if (searchError) throw searchError;
            if (existing && existing.length > 0) {
                throw new Error('Já existe um assinante cadastrado com este CPF/CNPJ.');
            }

            // 2. Sync with Asaas
            console.log("Syncing with Asaas...");
            let asaasId = null;
            let asaasSyncSuccess = false;

            try {
                const asaasResult = await manageAsaasCustomer({
                    id: subscriber?.asaas_customer_id, // Pass existing ID to force update
                    name: formData.name,
                    cpfCnpj: formData.cpf_cnpj,
                    email: formData.email,
                    phone: formData.phone,
                    postalCode: formData.cep,
                    addressNumber: formData.numero,
                    address: formData.rua,
                    province: formData.bairro
                });

                if (!asaasResult || !asaasResult.success) {
                    throw new Error(asaasResult?.error || 'Erro desconhecido');
                }

                asaasId = asaasResult.asaas_id;
                asaasSyncSuccess = true;

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
                    return; // Abort save
                }
            }

            // 3. Save to Supabase
            const dataToSave = {
                ...formData
            };

            if (asaasId) {
                dataToSave.asaas_customer_id = asaasId;
            }

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

            // 4. Sync Lead Status (Try to find a lead with this email and update its status)
            try {
                // Determine new status for Lead
                let newLeadStatus = null;
                if (dataToSave.status === 'ativacao') {
                    newLeadStatus = 'em_negociacao'; // Mapped: 'ativacao' not in Lead Enum
                } else if (dataToSave.status === 'ativo') {
                    newLeadStatus = 'ativo';
                }

                if (newLeadStatus && dataToSave.email) {
                    // Find the most recent lead with this email
                    const { data: leadsComp, error: leadFetchError } = await supabase
                        .from('leads')
                        .select('id, status')
                        .eq('email', dataToSave.email)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (!leadFetchError && leadsComp && leadsComp.length > 0) {
                        const targetLead = leadsComp[0];
                        // Only update if status is different
                        if (targetLead.status !== newLeadStatus) {
                            const { error: leadUpdateError } = await supabase
                                .from('leads')
                                .update({ status: newLeadStatus })
                                .eq('id', targetLead.id);

                            if (leadUpdateError) {
                                console.error('Error auto-updating lead status:', leadUpdateError);
                            } else {
                                console.log(`Lead ${targetLead.id} auto-updated to ${newLeadStatus}`);
                            }
                        }
                    }
                }
            } catch (syncErr) {
                console.error('Lead sync error:', syncErr);
            }

            onSave(result.data);
            onClose();
        } catch (error) {
            console.error(error);
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

            // Refresh
            fetchConsumerUnits(subscriber.id);
            showAlert('UC desvinculada com sucesso!', 'success');
        } catch (error) {
            console.error(error);
            showAlert('Erro ao desvincular UC: ' + error.message, 'error');
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '90%', maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto' }}>
                <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>
                    {subscriber ? 'Editar Assinante' : 'Novo Assinante'}
                </h3>

                <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '0.5rem', color: 'var(--color-blue)' }}>Dados Cadastrais</div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Status</label>
                        <select
                            value={formData.status}
                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            {statusOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Originador</label>
                        <select
                            value={formData.originator_id}
                            onChange={e => setFormData({ ...formData, originator_id: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        >
                            <option value="">Selecione...</option>
                            {originators.map(o => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>CPF/CNPJ (Busca Automática)</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                                value={formData.cpf_cnpj}
                                onChange={e => setFormData({ ...formData, cpf_cnpj: maskCpfCnpj(e.target.value) })}
                                onBlur={handleDocBlur}
                                placeholder="000.000.000-00"
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: searchingDoc ? '#f0f9ff' : 'white' }}
                                required
                            />
                        </div>
                    </div>

                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Nome Completo / Razão Social</label>
                        <input
                            required
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Email</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                            required
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Telefone</label>
                        <input
                            value={formData.phone}
                            onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                            placeholder="(00) 00000-0000"
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    {/* --- Endereço --- */}
                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem', color: 'var(--color-blue)' }}>Endereço</div>

                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>CEP (Busca)</label>
                            <input
                                value={formData.cep}
                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                onBlur={handleCepBlur}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: searchingCep ? '#f0f9ff' : 'white' }}
                            />
                        </div>
                        <div style={{ flex: 2 }}>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Cidade/UF</label>
                            <input
                                value={`${formData.cidade} - ${formData.uf}`}
                                disabled
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#f9fafb' }}
                            />
                        </div>
                    </div>

                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Rua</label>
                        <input
                            value={formData.rua}
                            onChange={e => setFormData({ ...formData, rua: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Número</label>
                        <input
                            value={formData.numero}
                            onChange={e => setFormData({ ...formData, numero: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Complemento</label>
                        <input
                            value={formData.complemento}
                            onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem' }}>Bairro</label>
                        <input
                            value={formData.bairro}
                            onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                        />
                    </div>

                    {/* --- UCs --- */}
                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem', color: 'var(--color-blue)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Unidades Consumidoras (UCs)</span>
                        {subscriber?.id && (
                            <button
                                type="button"
                                onClick={() => setShowUcModal(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                                    background: '#ecfdf5', color: '#059669', border: '1px solid #d1fae5',
                                    padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem'
                                }}
                            >
                                <Plus size={16} /> Cadastrar UCs
                            </button>
                        )}
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                        {consumerUnits.length > 0 ? (
                            <ul style={{ listStyle: 'none', padding: 0 }}>
                                {consumerUnits.map(uc => (
                                    <li key={uc.id} style={{ background: '#f8fafc', padding: '0.5rem', marginBottom: '0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ flex: 1 }}>
                                            <span>UC: {uc.numero_uc} - {uc.concessionaria}</span>
                                            <span style={{ display: 'block', fontSize: '0.8rem', color: '#666' }}>{uc.status?.replace('_', ' ').toUpperCase()}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleUnlinkUC(uc.id)}
                                            style={{
                                                padding: '0.3rem', background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer'
                                            }}
                                            title="Desvincular UC"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p style={{ color: '#999', fontSize: '0.9rem' }}>Nenhuma UC vinculada. Você pode adicionar UCs na tela de "Unidades Consumidoras" após salvar.</p>
                        )}
                        {/* Future: Add 'Link UC' button here */}
                    </div>

                    <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #eee', alignItems: 'center' }}>
                        <div>
                            {subscriber?.id && (
                                <button
                                    type="button"
                                    onClick={handleEmission}
                                    disabled={generating}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        background: '#fff7ed', color: '#c2410c', border: '1px solid #ffedd5',
                                        padding: '0.6rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                                    }}
                                >
                                    {generating ? 'Processando...' : <><CreditCard size={18} /> Emitir Fatura Consolidada</>}
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            {subscriber && onDelete && (
                                <button type="button" onClick={handleDelete} style={{ padding: '0.5rem 1rem', background: '#fee2e2', color: '#dc2626', borderRadius: '4px', border: '1px solid #fecaca', height: 'fit-content' }}>
                                    Excluir
                                </button>
                            )}
                            <button type="button" onClick={onClose} style={{ padding: '0.5rem 1rem', background: '#ccc', borderRadius: '4px' }}>Cancelar</button>
                            <button type="submit" disabled={loading} style={{ padding: '0.5rem 1rem', background: 'var(--color-blue)', color: 'white', borderRadius: '4px' }}>
                                {loading ? 'Salvando...' : 'Salvar Assinante'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            {showUcModal && subscriber && (
                <ConsumerUnitModal
                    consumerUnit={(() => {
                        // Use a memoized-like approach or handle with a stable ID check in child
                        // For simplicity here, we pass a stable reference if possible or just rely on child's new deps
                        return { subscriber_id: subscriber.id };
                    })()}
                    onClose={() => setShowUcModal(false)}
                    onSave={() => {
                        fetchConsumerUnits(subscriber.id); // Refresh List
                        setShowUcModal(false);
                    }}
                />
            )}
        </div>
    );
}
