import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { fetchAddressByCep, fetchCpfCnpjData, createAsaasCharge, manageAsaasCustomer } from '../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone } from '../lib/validators';
import { CreditCard } from 'lucide-react';

export default function SubscriberModal({ subscriber, onClose, onSave, onDelete }) {
    const { profile } = useAuth();
    const [originators, setOriginators] = useState([]);
    const [consumerUnits, setConsumerUnits] = useState([]);
    const [generating, setGenerating] = useState(false);

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
    }, [subscriber]);

    const fetchOriginators = async () => {
        const { data } = await supabase
            .from('profiles')
            .select('id, name')
            .in('role', ['originator', 'coordinator', 'admin', 'super_admin'])
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
        if (doc.length >= 11) {
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
            alert('Salve o assinante antes de gerar boletos.');
            return;
        }

        if (!confirm(`Gerar boleto CONSOLIDADO (todas as faturas pendentes) para ${formData.name}?`)) return;

        setGenerating(true);
        try {
            const result = await createAsaasCharge(subscriber.id, 'subscriber');
            if (result.url) {
                alert('Boleto consolidado gerado com sucesso!');
                window.open(result.url, '_blank');
            }
        } catch (error) {
            console.error(error);
            alert('Erro: ' + (error.message || 'Falha ao gerar boleto. Verifique se há faturas pendentes.'));
        } finally {
            setGenerating(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validateDocument(formData.cpf_cnpj)) {
            alert('CPF/CNPJ inválido!');
            return;
        }
        if (formData.phone && !validatePhone(formData.phone)) {
            alert('Telefone inválido!');
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
            const asaasResult = await manageAsaasCustomer({
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
                throw new Error('Falha ao sincronizar cliente com Asaas: ' + (asaasResult?.error || 'Erro desconhecido'));
            }

            const asaasId = asaasResult.asaas_id;

            // 3. Save to Supabase
            const dataToSave = {
                ...formData,
                asaas_customer_id: asaasId
            };
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

            if (asaasResult.is_new) {
                alert('Cliente cadastrado com sucesso no CRM e criado no Asaas!');
            } else {
                alert('Cliente salvo no CRM e sincronizado com Asaas!');
            }

            onSave(result.data);
            onClose();
        } catch (error) {
            console.error(error);
            alert('Erro ao salvar assinante: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!subscriber?.id) return;
        if (!confirm('Tem certeza que deseja excluir este assinante?')) return;

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
            alert('Erro ao excluir: ' + error.message);
        } finally {
            setLoading(false);
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
                    <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem', color: 'var(--color-blue)' }}>Unidades Consumidoras (UCs)</div>
                    <div style={{ gridColumn: '1 / -1' }}>
                        {consumerUnits.length > 0 ? (
                            <ul style={{ listStyle: 'none', padding: 0 }}>
                                {consumerUnits.map(uc => (
                                    <li key={uc.id} style={{ background: '#f8fafc', padding: '0.5rem', marginBottom: '0.5rem', borderRadius: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                        <span>UC: {uc.numero_uc} - {uc.concessionaria}</span>
                                        <span style={{ fontSize: '0.8rem', color: '#666' }}>{uc.status}</span>
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
        </div>
    );
}
