import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { fetchAddressByCep, fetchOfferData, sendWhatsapp } from '../lib/api';
import { maskPhone, validatePhone } from '../lib/validators';
import { Clock, User, Home, Zap, CreditCard, History, X, MessageSquare, FileText, Calendar, MessageCircle } from 'lucide-react';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';
import TagInput from './TagInput';

export default function LeadModal({ lead, onClose, onSave, onDelete, onConvert }) {
    const { profile } = useAuth();
    const { showAlert, showConfirm } = useUI();
    const [originators, setOriginators] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [activeTab, setActiveTab] = useState('dados'); 
    
    // Estados para WhatsApp Manual
    const [manualMessage, setManualMessage] = useState('');
    const [manualFile, setManualFile] = useState(null);
    const [isSendingManualWA, setIsSendingManualWA] = useState(false);

    // Estados para Agendamentos
    const [appointments, setAppointments] = useState([]);
    const [loadingAppointments, setLoadingAppointments] = useState(false);
    const [newAppointment, setNewAppointment] = useState({ date: '', time: '', reason: 'Ligação', notes: '' });

    // Status Options
    const statusOptions = [
        { value: 'indicado', label: 'Indicado' },
        { value: 'simulacao', label: 'Simulação' },
        { value: 'em_negociacao', label: 'Em Negociação' },
        { value: 'ativacao', label: 'Ativação' },
        { value: 'ativo', label: 'Ativo' },
        { value: 'pago', label: 'Pago' },
        { value: 'negocio_perdido', label: 'Negócio Perdido' },
        { value: 'convertido', label: 'Convertido (Legado)' }
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
        originator_id: '',
        tags: []
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
                originator_id: lead.originator_id || '',
                tags: lead.tags || []
            });
        } else {
            if (profile?.role === 'originator') {
                setFormData(prev => ({ ...prev, originator_id: profile.id }));
            }
        }
    }, [lead, profile]);

    const fetchAppointments = async () => {
        if (!lead?.id) return;
        setLoadingAppointments(true);
        try {
            const { data, error } = await supabase
                .from('lead_appointments')
                .select('*')
                .eq('lead_id', lead.id)
                .order('appointment_date', { ascending: false })
                .order('appointment_time', { ascending: false });
            if (error) throw error;
            setAppointments(data || []);
        } catch (error) {
            console.error('Error fetching appointments:', error);
        } finally {
            setLoadingAppointments(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'agendamentos') {
            fetchAppointments();
        }
    }, [activeTab, lead?.id]);

    const handleSaveAppointment = async (e) => {
        e.preventDefault();
        try {
            const { error } = await supabase
                .from('lead_appointments')
                .insert({
                    lead_id: lead.id,
                    appointment_date: newAppointment.date,
                    appointment_time: newAppointment.time,
                    reason: newAppointment.reason,
                    notes: newAppointment.notes,
                    created_by: profile?.id
                });
            if (error) throw error;
            showAlert('Agendamento criado com sucesso!', 'success');
            setNewAppointment({ date: '', time: '', reason: 'Ligação', notes: '' });
            fetchAppointments();
            addHistory('lead', lead.id, 'agendamento_criado', { reason: newAppointment.reason, date: newAppointment.date, time: newAppointment.time });
        } catch (error) {
            showAlert('Erro ao criar agendamento: ' + error.message, 'error');
        }
    };

    const addHistory = async (type, id, action, details = {}, customContent = null) => {
        if (!id) {
            console.error('addHistory: Missing entity ID');
            return;
        }
        try {
            const { error } = await supabase.from('crm_history').insert({
                entity_type: type,
                entity_id: id,
                content: customContent || `${action === 'email_sent' ? 'E-mail enviado' : action}: ${details.type || ''}`,
                metadata: details,
                created_by: profile?.id
            });
            if (error) throw error;
        } catch (error) {
            console.error('Error adding history:', error);
        }
    };

    const fetchOriginators = async () => {
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
            if (dataToSave.phone) {
                dataToSave.phone = dataToSave.phone.replace(/\D/g, '');
            }
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
                            const kwh = Number(dataToSave.consumo_kwh) || 0;
                            const tarifa = Number(dataToSave.tarifa_concessionaria) || 0.85;
                            let discountRate = Number(dataToSave.desconto_assinante) || 15;
                            if (discountRate < 1 && discountRate > 0) discountRate = discountRate * 100;

                            const totalSemDesconto = kwh * tarifa;
                            const economia = totalSemDesconto * (discountRate / 100);
                            const baseCalculo = totalSemDesconto - economia;
                            const split = originator.split_commission || {};
                            const comissaoPercent = Number(split.start ?? split.recurrent) || 0;
                            const comissaoValor = baseCalculo * (comissaoPercent / 100);

                            const formattedValue = comissaoValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                            const leadName = dataToSave.name || 'O Lead';

                            const msg = comissaoPercent > 0
                                ? `${leadName} aceitou o convite e está próximo de concluir o cadastro. Em breve você recebe seu cashback de ${formattedValue}.`
                                : `${leadName} aceitou o convite e está próximo de concluir o cadastro.`;

                            await sendWhatsapp(originator.phone, msg);
                        }
                    } catch (notificationError) {
                        console.error("Erro ao enviar notificação de ativação:", notificationError);
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

        const targetPhone = lead?.phone || formData.phone;
        const targetId = lead?.id;
        const targetName = lead?.name || formData.name;

        if (!targetPhone) {
            showAlert('Telefone do lead não encontrado.', 'error');
            return;
        }

        const confirmed = await showConfirm(`Deseja enviar esta mensagem para ${targetName}?`, 'Confirmar Envio', 'Sim, Enviar', 'Cancelar');
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

            let phoneToQuery = targetPhone.replace(/\D/g, '');
            if (phoneToQuery.length >= 10 && phoneToQuery.length <= 11 && !phoneToQuery.startsWith('55')) {
                phoneToQuery = `55${phoneToQuery}`;
            }

            const response = await sendWhatsapp(
                phoneToQuery,
                manualMessage,
                null, 
                mediaBase64,
                fileName
            );

            if (response.error) throw new Error(response.error);

            showAlert('Mensagem enviada com sucesso!', 'success');
            
            await addHistory('lead', targetId, 'whatsapp_manual', {
                message: manualMessage,
                file: fileName,
                phone: phoneToQuery,
                status: 'sent'
            }, `Comunicado WhatsApp: ${manualMessage.substring(0, 50)}${manualMessage.length > 50 ? '...' : ''}`);

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

            if (onDelete) onDelete(lead.id);
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
                        {lead ? `Lead - ${formData.name}` : 'Novo Lead'}
                    </h3>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
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

                {/* Tabs Menu */}
                <div style={{
                    display: 'flex',
                    background: 'white',
                    padding: '0 2rem',
                    borderBottom: '1px solid #e2e8f0',
                    gap: '2rem'
                }}>
                    {[
                        { id: 'dados', label: 'Dados Cadastrais', icon: User, color: '#003366', bg: '#f0f9ff' },
                        { id: 'endereco_energia', label: 'Endereço e Energia', icon: Zap, color: '#10b981', bg: '#ecfdf5' },
                        { id: 'agendamentos', label: 'Agendamentos', icon: Calendar, color: '#f59e0b', bg: '#fff7ed' },
                        { id: 'comunicacao', label: 'Comunicados', icon: MessageCircle, color: '#25D366', bg: '#f0fdf4' }
                    ].filter(tab => lead || ['dados', 'endereco_energia'].includes(tab.id)).map(tab => {
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
                                    gap: '0.6rem',
                                    padding: '1rem 0',
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    color: isActive ? tab.color : '#64748b',
                                    borderBottom: `3px solid ${isActive ? tab.color : 'transparent'}`,
                                    transition: 'all 0.2s',
                                    fontSize: '0.9rem',
                                    fontWeight: isActive ? 700 : 500,
                                    position: 'relative'
                                }}
                            >
                                <div style={{
                                    padding: '0.4rem',
                                    borderRadius: '8px',
                                    background: isActive ? tab.bg : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: isActive ? tab.color : '#94a3b8'
                                }}>
                                    <Icon size={18} />
                                </div>
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '2rem', background: '#f8fafc' }}>
                    {activeTab === 'dados' && (
                        <form id="lead-form-dados" onSubmit={handleSubmit}>
                            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <h4 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <User size={18} style={{ color: '#003366' }} /> Dados Principais
                                </h4>
                                
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Status</label>
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

                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Tags</label>
                                    <TagInput 
                                        value={formData.tags || []} 
                                        onChange={(newTags) => setFormData({ ...formData, tags: newTags })} 
                                    />
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Originador</label>
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
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Nome Completo</label>
                                    <input
                                        required
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Telefone</label>
                                        <input
                                            placeholder="55 xx xxxxx xxxx"
                                            value={formData.phone}
                                            onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                            style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Email</label>
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                                            style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </form>
                    )}

                    {activeTab === 'endereco_energia' && (
                        <form id="lead-form-endereco" onSubmit={handleSubmit}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <h4 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Home size={18} style={{ color: '#f59e0b' }} /> Endereço
                                    </h4>
                                    
                                    <div style={{ display: 'flex', gap: '1rem' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>CEP (Busca)</label>
                                            <input
                                                placeholder="00000-000"
                                                value={formData.cep}
                                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                                onBlur={handleCepBlur}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: searchingCep ? '#f0f9ff' : 'white', outline: 'none' }}
                                            />
                                        </div>
                                        <div style={{ flex: 2 }}>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Cidade/UF</label>
                                            <input
                                                value={`${formData.cidade} - ${formData.uf} `}
                                                disabled
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #f1f5f9', borderRadius: '6px', background: '#f8fafc', color: '#64748b' }}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Rua</label>
                                        <input
                                            value={formData.rua}
                                            onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                            style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Número</label>
                                            <input
                                                value={formData.numero}
                                                onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Complemento</label>
                                            <input
                                                value={formData.complemento}
                                                onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Bairro</label>
                                            <input
                                                value={formData.bairro}
                                                onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <h4 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Zap size={18} style={{ color: '#10b981' }} /> Dados de Energia e Oferta
                                    </h4>
                                    
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Consumo Médio (kWh)</label>
                                            <input
                                                type="number"
                                                value={formData.consumo_kwh}
                                                onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Concessionária</label>
                                            <input
                                                value={formData.concessionaria}
                                                onChange={e => setFormData({ ...formData, concessionaria: e.target.value })}
                                                placeholder="Busca automática..."
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', outline: 'none' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Tarifa (R$)</label>
                                            <input
                                                type="number" step="0.0001"
                                                value={formData.tarifa_concessionaria}
                                                onChange={e => setFormData({ ...formData, tarifa_concessionaria: e.target.value })}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Desconto Oferta (%)</label>
                                            <input
                                                type="number" step="0.01"
                                                value={formData.desconto_assinante}
                                                onChange={e => setFormData({ ...formData, desconto_assinante: e.target.value })}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#047857', fontWeight: 'bold' }}>Economia Mensal Estimada (R$)</label>
                                        <input
                                            value={(() => {
                                                const kwh = Number(formData.consumo_kwh) || 0;
                                                const tarifa = Number(formData.tarifa_concessionaria) || 0;
                                                const desconto = Number(formData.desconto_assinante) || 0; 
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
                                </div>
                            </div>
                        </form>
                    )}

                    {activeTab === 'agendamentos' && lead && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                    <Calendar size={18} style={{ color: '#f59e0b' }} />
                                    Novo Agendamento
                                </h4>
                                <form onSubmit={handleSaveAppointment} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Data</label>
                                            <input 
                                                type="date" 
                                                required 
                                                value={newAppointment.date}
                                                onChange={e => setNewAppointment({ ...newAppointment, date: e.target.value })}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Hora</label>
                                            <input 
                                                type="time" 
                                                required 
                                                value={newAppointment.time}
                                                onChange={e => setNewAppointment({ ...newAppointment, time: e.target.value })}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Motivo</label>
                                            <select 
                                                required
                                                value={newAppointment.reason}
                                                onChange={e => setNewAppointment({ ...newAppointment, reason: e.target.value })}
                                                style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                                            >
                                                <option value="Ligação">Ligação</option>
                                                <option value="Mensagem">Mensagem</option>
                                                <option value="Reunião presencial">Reunião presencial</option>
                                                <option value="Reunião video chamada">Reunião video chamada</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b', fontWeight: 600 }}>Anotações</label>
                                        <textarea
                                            value={newAppointment.notes}
                                            onChange={e => setNewAppointment({ ...newAppointment, notes: e.target.value })}
                                            placeholder="Detalhes adicionais..."
                                            style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', minHeight: '80px', resize: 'vertical' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <button type="submit" className="btn btn-primary">
                                            Salvar Agendamento
                                        </button>
                                    </div>
                                </form>
                            </div>
                            
                            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ margin: '0 0 1rem 0', color: '#1e293b' }}>Agendamentos Registrados</h4>
                                {loadingAppointments ? (
                                    <p style={{ color: '#64748b' }}>Carregando...</p>
                                ) : appointments.length === 0 ? (
                                    <p style={{ color: '#64748b', textAlign: 'center', padding: '2rem 0' }}>Nenhum agendamento encontrado.</p>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {appointments.map(app => (
                                            <div key={app.id} style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                    <strong style={{ color: '#0f172a' }}>{app.reason}</strong>
                                                    <span style={{ fontSize: '0.85rem', color: '#64748b', background: '#e2e8f0', padding: '0.1rem 0.5rem', borderRadius: '999px' }}>
                                                        {new Date(app.appointment_date + 'T00:00:00').toLocaleDateString()} às {app.appointment_time.substring(0, 5)}
                                                    </span>
                                                </div>
                                                <p style={{ margin: 0, fontSize: '0.9rem', color: '#475569' }}>{app.notes || 'Sem anotações'}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'comunicacao' && lead && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', animate: 'fadeIn 0.3s ease' }}>
                            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
                                    <MessageSquare size={18} style={{ color: '#25D366' }} />
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
                                                padding: '0.5rem 1rem', background: '#f8fafc',
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
                                                padding: '0.6rem 2rem', background: '#25D366',
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

                            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <h4 style={{ fontSize: '1rem', color: '#1e293b', marginBottom: '1rem' }}>Últimas Interações</h4>
                                <HistoryTimeline 
                                    entityType="lead" 
                                    entityId={lead.id} 
                                    limit={10} 
                                    showHeader={false} 
                                    isInline={true}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Controls */}
                <div style={{
                    padding: '1rem 2rem',
                    borderTop: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <div>
                        {lead && onDelete && (
                            <button type="button" onClick={handleDelete} style={{ padding: '0.6rem 1.25rem', background: '#fee2e2', color: '#dc2626', borderRadius: '6px', border: '1px solid #fecaca', fontWeight: 600 }}>
                                Excluir Lead
                            </button>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {lead && !['ativacao', 'ativo', 'pago', 'negocio_perdido'].includes(lead.status) && onConvert && (
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
                        <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.25rem', background: 'white', color: '#475569', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 600 }}>Cancelar</button>
                        {['dados', 'endereco_energia'].includes(activeTab) && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    const formId = activeTab === 'dados' ? 'lead-form-dados' : 'lead-form-endereco';
                                    document.getElementById(formId).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                                }}
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
                        )}
                    </div>
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
