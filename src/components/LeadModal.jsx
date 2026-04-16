import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { fetchAddressByCep, fetchOfferData, sendWhatsapp } from '../lib/api';
import { maskPhone, validatePhone } from '../lib/validators';
import { Clock, User, Home, Zap, CreditCard, History, X, MessageSquare, FileText } from 'lucide-react';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';

export default function LeadModal({ lead, onClose, onSave, onDelete, onConvert }) {
    const { profile } = useAuth();
    const { showAlert, showConfirm } = useUI();
    const [originators, setOriginators] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [activeTab, setActiveTab] = useState('dados'); // 'dados' or 'comunicados'
    
    // Estados para WhatsApp Manual
    const [manualMessage, setManualMessage] = useState('');
    const [manualFile, setManualFile] = useState(null);
    const [isSendingManualWA, setIsSendingManualWA] = useState(false);

    // Status Options: Simulação, Indicado, Em negociação, Negocio Perdido, Ativo, Pago
    const statusOptions = [
        { value: 'indicado', label: 'Indicado' },
        { value: 'simulacao', label: 'Simulação' },
        { value: 'em_negociacao', label: 'Em Negociação' },
        { value: 'ativacao', label: 'Ativação' },
        { value: 'ativo', label: 'Ativo' },
        { value: 'pago', label: 'Pago' },
        { value: 'negocio_perdido', label: 'Negócio Perdido' },
        { value: 'convertido', label: 'Convertido (Legado)' } // Mantendo caso exista
    ];

    const [formData, setFormData] = useState({
        name: '',
        status: 'simulacao',
        phone: '',
        email: '',
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        concessionaria: '',
        tarifa_concessionaria: '',
        consumo_kwh: '',
        desconto_assinante: '',
        originator_id: ''
    });

    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);

    useEffect(() => {
        fetchOriginators();
        if (lead) {
            setFormData({
                name: lead.name,
                status: lead.status || 'simulacao',
                phone: lead.phone || '',
                email: lead.email || '',
                cep: lead.cep || '',
                rua: lead.rua || '',
                numero: lead.numero || '',
                complemento: lead.complemento || '',
                bairro: lead.bairro || '',
                cidade: lead.cidade || '',
                uf: lead.uf || '',
                concessionaria: lead.concessionaria || '',
                tarifa_concessionaria: lead.tarifa_concessionaria || '',
                consumo_kwh: lead.consumo_kwh || '',
                desconto_assinante: lead.desconto_assinante || '',
                originator_id: lead.originator_id || ''
            });
        } else {
            if (profile?.role === 'originator') {
                setFormData(prev => ({ ...prev, originator_id: profile.id }));
            }
        }
    }, [lead, profile]);

    const addHistory = async (type, id, action, details = {}, customContent = null) => {
        if (!id) {
            console.error('addHistory: Missing entity ID');
            return;
        }
        try {
            console.log(`Adding history: ${type} ${id} - ${action}`, details);
            const { error } = await supabase.from('crm_history').insert({
                entity_type: type,
                entity_id: id,
                content: customContent || `${action === 'email_sent' ? 'E-mail enviado' : action}: ${details.type || ''}`,
                metadata: details,
                created_by: profile?.id
            });
            if (error) {
                console.error('Supabase Error adding history:', error);
                throw error;
            }
        } catch (error) {
            console.error('Error adding history:', error);
        }
    };

    const fetchOriginators = async () => {
        // Fetch from the actual Originators table, not profiles
        const { data } = await supabase
            .from('originators_v2')
            .select('id, name')
            .order('name');
        setOriginators(data || []);
    };

    const handleCepBlur = async () => {
        const rawCep = formData.cep.replace(/\D/g, '');
        if (rawCep.length === 8) {
            setSearchingCep(true);
            try {
                const addr = await fetchAddressByCep(rawCep);

                // Get Offer Info if available
                let offer = {};
                if (addr.ibge) {
                    try {
                        const offerData = await fetchOfferData(addr.ibge);
                        if (offerData) offer = offerData;
                    } catch (e) {
                        console.error('Erro na oferta', e);
                    }
                }

                setFormData(prev => ({
                    ...prev,
                    rua: addr.rua || '',
                    bairro: addr.bairro || '',
                    cidade: addr.cidade || '',
                    uf: addr.uf || '',
                    concessionaria: offer?.Concessionaria || prev.concessionaria || '',
                    tarifa_concessionaria: offer?.['Tarifa Concessionaria'] || prev.tarifa_concessionaria || '',
                    desconto_assinante: (() => {
                        let val = offer?.['Desconto Assinante'] || prev.desconto_assinante || '';
                        if (val && !isNaN(val) && Number(val) > 0 && Number(val) < 1) {
                            return Number(val) * 100;
                        }
                        return val;
                    })()
                }));
            } catch (error) {
                console.error('Erro ao buscar CEP:', error);
                showAlert('Erro ao buscar CEP. Verifique se digitou corretamente.', 'error');
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (formData.phone && !validatePhone(formData.phone)) {
            showAlert('Telefone inválido!', 'warning');
            return;
        }

        setLoading(true);

        try {
            const dataToSave = { ...formData };
            // Sanitize phone for Evolution API (clean digits only)
            if (dataToSave.phone) {
                dataToSave.phone = dataToSave.phone.replace(/\D/g, '');
            }
            // Ensure numbers are numbers and null if empty/invalid
            dataToSave.tarifa_concessionaria = dataToSave.tarifa_concessionaria ? Number(dataToSave.tarifa_concessionaria) : null;
            dataToSave.consumo_kwh = dataToSave.consumo_kwh ? Number(dataToSave.consumo_kwh) : null;
            dataToSave.desconto_assinante = dataToSave.desconto_assinante ? Number(dataToSave.desconto_assinante) : null;
            if (dataToSave.originator_id === '') dataToSave.originator_id = null;

            let result;
            if (lead?.id) {
                result = await supabase
                    .from('leads')
                    .update(dataToSave)
                    .eq('id', lead.id)
                    .select()
                    .single();
            } else {
                result = await supabase
                    .from('leads')
                    .insert(dataToSave)
                    .select()
                    .single();
            }

            if (result.error) throw result.error;

            // [NEW] Notification Logic (On Activation)
            if (dataToSave.status === 'ativo' && (!lead || lead.status !== 'ativo')) {
                const originatorId = dataToSave.originator_id;
                if (originatorId) {
                    try {
                        const { data: originator } = await supabase
                            .from('originators_v2')
                            .select('phone, split_commission, name')
                            .eq('id', originatorId)
                            .maybeSingle();

                        if (originator && originator.phone) {
                            // Calculate values
                            const kwh = Number(dataToSave.consumo_kwh) || 0;
                            const tarifa = Number(dataToSave.tarifa_concessionaria) || 0.85;
                            let discountRate = Number(dataToSave.desconto_assinante) || 15;

                            // Handle decimal inputs (e.g. 0.15 vs 15)
                            if (discountRate < 1 && discountRate > 0) {
                                discountRate = discountRate * 100;
                            }

                            const totalSemDesconto = kwh * tarifa;
                            const economia = totalSemDesconto * (discountRate / 100);
                            const baseCalculo = totalSemDesconto - economia;

                            const comissaoPercent = Number(originator.split_commission) || 0;
                            const comissaoValor = baseCalculo * (comissaoPercent / 100);

                            const formattedValue = comissaoValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                            const leadName = dataToSave.name || 'O Lead';

                            const msg = `${leadName}, aceitou o convite e está proximo de concluir o cadastro, em breve vc receberá o seu cashback ${formattedValue}`;

                            await sendWhatsapp(originator.phone, msg);
                            console.log("Notificação de ativação enviada para:", originator.name);
                        }
                    } catch (notificationError) {
                        console.error("Erro ao enviar notificação de ativação:", notificationError);
                        // Do not fail the save if notification fails
                    }
                }
            }

            onSave(result.data);
            onClose();
        } catch (error) {
            showAlert('Erro ao salvar lead: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSendManualWhatsApp = async () => {
        if (!manualMessage.trim() && !manualFile) {
            showAlert('Por favor, digite uma mensagem ou anexe um arquivo.', 'warning');
            return;
        }

        // Usar dados da prop lead para garantir que não haja "stale state"
        const targetPhone = lead.phone || formData.phone;
        const targetId = lead.id;
        const targetName = lead.name || formData.name;

        if (!targetPhone) {
            showAlert('Telefone do lead não encontrado.', 'error');
            return;
        }

        const confirmed = await showConfirm(
            `Deseja enviar esta mensagem para ${targetName}?`,
            'Confirmar Envio',
            'Sim, Enviar',
            'Cancelar'
        );
        if (!confirmed) return;

        setIsSendingManualWA(true);
        try {
            let mediaBase64 = null;
            let fileName = null;

            if (manualFile) {
                const reader = new FileReader();
                const filePromise = new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                });
                reader.readAsDataURL(manualFile);
                mediaBase64 = await filePromise;
                fileName = manualFile.name;
            }

            // Normalização extra de DDI (Garantir 55 para números brasileiros)
            let phoneToQuery = targetPhone.replace(/\D/g, '');
            if (phoneToQuery.length >= 10 && phoneToQuery.length <= 11 && !phoneToQuery.startsWith('55')) {
                phoneToQuery = `55${phoneToQuery}`;
            }

            const response = await sendWhatsapp(
                phoneToQuery,
                manualMessage,
                null, // mediaUrl
                mediaBase64,
                fileName
            );

            if (response.error) throw new Error(response.error);

            showAlert('Mensagem enviada com sucesso!', 'success');
            
            // Log to history
            await addHistory('lead', targetId, 'whatsapp_manual', {
                message: manualMessage,
                file: fileName,
                phone: phoneToQuery,
                status: 'sent'
            }, `Comunicado WhatsApp: ${manualMessage.substring(0, 50)}${manualMessage.length > 50 ? '...' : ''}`);

            // Clear fields
            setManualMessage('');
            setManualFile(null);
        } catch (error) {
            console.error('Error sending manual WhatsApp:', error);
            showAlert('Erro ao enviar mensagem: ' + error.message, 'error');
        } finally {
            setIsSendingManualWA(false);
        }
    };

    const handleDelete = async () => {
        if (!lead?.id) return;
        const confirm = await showConfirm('Tem certeza que deseja excluir este lead? Esta ação não pode ser desfeita.');
        if (!confirm) return;

        setLoading(true);
        try {
            const { error } = await supabase
                .from('leads')
                .delete()
                .eq('id', lead.id);

            if (error) throw error;

            if (onDelete) onDelete(lead.id); // Notify parent
            onClose();
        } catch (error) {
            showAlert('Erro ao excluir lead: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ background: 'white', padding: '0', borderRadius: '12px', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
                        {lead ? formData.name : 'Novo Lead'}
                    </h3>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {lead && (
                            <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '8px', marginRight: '0.5rem' }}>
                                <button
                                    onClick={() => setActiveTab('dados')}
                                    style={{
                                        padding: '0.4rem 0.8rem', borderRadius: '6px', border: 'none',
                                        background: activeTab === 'dados' ? 'white' : 'transparent',
                                        color: activeTab === 'dados' ? 'var(--color-blue)' : '#64748b',
                                        boxShadow: activeTab === 'dados' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                        cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem'
                                    }}
                                >
                                    <User size={14} /> Dados
                                </button>
                                <button
                                    onClick={() => setActiveTab('comunicados')}
                                    style={{
                                        padding: '0.4rem 0.8rem', borderRadius: '6px', border: 'none',
                                        background: activeTab === 'comunicados' ? 'white' : 'transparent',
                                        color: activeTab === 'comunicados' ? 'var(--color-blue)' : '#64748b',
                                        boxShadow: activeTab === 'comunicados' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                        cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem'
                                    }}
                                >
                                    <MessageSquare size={14} /> Comunicados
                                </button>
                            </div>
                        )}
                        {lead && (
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
                    {activeTab === 'dados' ? (
                        <form onSubmit={handleSubmit}>

                        <CollapsibleSection title="Dados do Lead" icon={User} defaultOpen={true}>
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

                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Nome Completo</label>
                                <input
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Telefone</label>
                                <input
                                    placeholder="55 xx xxxxx xxxx"
                                    value={formData.phone}
                                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
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
                                />
                            </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Endereço e Instalação" icon={Home} defaultOpen={false}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>CEP (Busca)</label>
                                <input
                                    placeholder="00000-000"
                                    value={formData.cep}
                                    onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                    onBlur={handleCepBlur}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: searchingCep ? '#f0f9ff' : 'white', outline: 'none' }}
                                />
                            </div>
                            <div style={{ flex: 2 }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Cidade/UF</label>
                                <input
                                    value={`${formData.cidade} - ${formData.uf} `}
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

                        <CollapsibleSection title="Dados de Energia e Oferta" icon={Zap} defaultOpen={false}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Consumo Médio (kWh)</label>
                                <input
                                    type="number"
                                    value={formData.consumo_kwh}
                                    onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Concessionária</label>
                                <input
                                    value={formData.concessionaria}
                                    onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                                    placeholder="Busca automática..."
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Tarifa (R$)</label>
                                <input
                                    type="number" step="0.0001"
                                    value={formData.tarifa_concessionaria}
                                    onChange={e => setFormData({ ...formData, tarifa_concessionaria: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Desconto Oferta (%)</label>
                                <input
                                    type="number" step="0.01"
                                    value={formData.desconto_assinante}
                                    onChange={e => setFormData({ ...formData, desconto_assinante: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#047857', fontWeight: 'bold' }}>Economia Mensal Estimada (R$)</label>
                                <input
                                    value={(() => {
                                        const kwh = Number(formData.consumo_kwh) || 0;
                                        const tarifa = Number(formData.tarifa_concessionaria) || 0;
                                        const desconto = Number(formData.desconto_assinante) || 0; // percentage
                                        if (kwh && tarifa && desconto) {
                                            const totalSemDesconto = kwh * tarifa;
                                            const economia = totalSemDesconto * (desconto / 100);
                                            return !isNaN(economia) ? economia.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00';
                                        }
                                        return 'R$ 0,00';
                                    })()}
                                    disabled
                                    style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1fae5', borderRadius: '8px', background: '#f0fdf4', color: '#065f46', fontWeight: 'bold', fontSize: '1.1rem' }}
                                />
                            </div>
                        </CollapsibleSection>

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', padding: '1rem 0', borderTop: '1px solid #eee' }}>
                            <div>
                                {lead && onDelete && (
                                    <button type="button" onClick={handleDelete} style={{ padding: '0.6rem 1.25rem', background: '#fee2e2', color: '#dc2626', borderRadius: '6px', border: '1px solid #fecaca', fontWeight: 600 }}>
                                        Excluir Lead
                                    </button>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                {lead && lead.status !== 'convertido' && onConvert && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onConvert(lead);
                                            onClose();
                                        }}
                                        style={{ padding: '0.6rem 1.25rem', background: '#ecfdf5', color: '#047857', border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: 600 }}
                                    >
                                        Converter em Assinante
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
                                        border: 'none',
                                        fontWeight: 600,
                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                    }}
                                >
                                    {loading ? 'Salvando...' : 'Salvar Lead'}
                                </button>
                            </div>
                        </div>
                    </form>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', animate: 'fadeIn 0.3s ease' }}>
                        <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                            <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                <MessageSquare size={18} style={{ color: 'var(--color-blue)' }} />
                                Enviar Novo Comunicado para {formData.name}
                            </h4>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <textarea
                                    placeholder="Digite a mensagem que o lead receberá no WhatsApp..."
                                    value={manualMessage}
                                    onChange={(e) => setManualMessage(e.target.value)}
                                    style={{
                                        width: '100%', minHeight: '120px', padding: '1rem',
                                        borderRadius: '8px', border: '1px solid #cbd5e1',
                                        resize: 'vertical', fontSize: '0.95rem', outline: 'none'
                                    }}
                                />

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <label style={{
                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            padding: '0.5rem 1rem', background: '#fff',
                                            border: '1px solid #cbd5e1', borderRadius: '6px',
                                            cursor: 'pointer', fontSize: '0.85rem', color: '#475569'
                                        }}>
                                            <FileText size={16} />
                                            {manualFile ? manualFile.name : 'Anexar Arquivo'}
                                            <input
                                                type="file"
                                                style={{ display: 'none' }}
                                                onChange={(e) => setManualFile(e.target.files[0])}
                                            />
                                        </label>
                                        {manualFile && (
                                            <button
                                                onClick={() => setManualFile(null)}
                                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem' }}
                                            >
                                                Remover
                                            </button>
                                        )}
                                    </div>

                                    <button
                                        onClick={handleSendManualWhatsApp}
                                        disabled={isSendingManualWA || (!manualMessage.trim() && !manualFile)}
                                        style={{
                                            padding: '0.6rem 2rem', background: 'var(--color-blue)',
                                            color: '#fff', border: 'none', borderRadius: '6px',
                                            fontWeight: '600', cursor: 'pointer',
                                            transition: 'all 0.2s ease',
                                            opacity: (isSendingManualWA || (!manualMessage.trim() && !manualFile)) ? 0.6 : 1
                                        }}
                                    >
                                        {isSendingManualWA ? 'Enviando...' : 'Enviar Agora'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div style={{ borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                            <h4 style={{ fontSize: '0.95rem', color: '#64748b', marginBottom: '1rem' }}>Últimas Interações</h4>
                            <HistoryTimeline 
                                entityType="lead" 
                                entityId={lead.id} 
                                limit={5} 
                                showHeader={false} 
                                isInline={true}
                            />
                        </div>
                    </div>
                )}
                </div>
            </div>

            {showHistory && lead && (
                <HistoryTimeline
                    entityType="lead"
                    entityId={lead.id}
                    entityName={formData.name}
                    onClose={() => setShowHistory(false)}
                    isInline={true}
                />
            )}
        </div>
    );
}
