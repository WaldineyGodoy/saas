import { useState, useEffect } from 'react';
import { X, Save, MessageSquare, Mail, Info, Upload, Trash2, Clock, Zap, Users, Layout, Send } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useUI } from '../../../contexts/UIContext';

export default function MessageTriggerModal({ isOpen, onClose, onSave, trigger }) {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(false);
    const [activeSection, setActiveSection] = useState('rules'); // rules, whatsapp, email, recipients
    const [formData, setFormData] = useState({
        name: '',
        entity_type: 'lead',
        trigger_status: '',
        trigger_event: '',
        logic_operator: 'and',
        channels: ['whatsapp'],
        message_body: '',
        delay_type: 'immediate',
        delay_days: 0,
        is_active: true,
        attachments: [],
        timezone: 'America/Sao_Paulo',
        start_time: '09:00',
        end_time: '18:00',
        allowed_days: [1, 2, 3, 4, 5, 6],
        email_subject: '',
        email_body: '',
        recipient_types: ['self'],
        custom_recipients: ''
    });

    const entities = [
        { id: 'lead', label: 'Lead' },
        { id: 'originator', label: 'Originador' },
        { id: 'subscriber', label: 'Assinante' },
        { id: 'consumer_unit', label: 'Unidade Consumidora' },
        { id: 'invoice', label: 'Fatura' },
        { id: 'supplier', label: 'Fornecedor' },
        { id: 'power_plant', label: 'Usina' }
    ];

    const entityStatusOptions = {
        lead: [
            { id: 'indicado', label: 'Indicado' },
            { id: 'simulacao', label: 'Simulação' },
            { id: 'em_negociacao', label: 'Em Negociação' },
            { id: 'ativacao', label: 'Ativação' },
            { id: 'ativo', label: 'Ativo' },
            { id: 'pago', label: 'Pago' },
            { id: 'negocio_perdido', label: 'Negócio Perdido' }
        ],
        subscriber: [
            { id: 'ativacao', label: 'Ativação' },
            { id: 'ativo', label: 'Ativo' },
            { id: 'ativo_inadimplente', label: 'Ativo (Inadimplente)' },
            { id: 'transferido', label: 'Transferido' },
            { id: 'cancelado', label: 'Cancelado' },
            { id: 'cancelado_inadimplente', label: 'Cancelado (Inadimplente)' }
        ],
        originator: [
            { id: 'ativo', label: 'Ativo' },
            { id: 'inativo', label: 'Inativo' },
            { id: 'aguardando_aprovacao', label: 'Aguardando Aprovação' }
        ],
        consumer_unit: [
            { id: 'em_ativacao', label: 'Em Ativação' },
            { id: 'em_transf_titularidade', label: 'Em Transf. de Titularidade' },
            { id: 'aguardando_conexao', label: 'Aguardando Conexão' },
            { id: 'ativo', label: 'Ativo' },
            { id: 'sem_geracao', label: 'Sem Geração' },
            { id: 'desconectado', label: 'Desconectado' },
            { id: 'cancelado', label: 'Cancelado' }
        ],
        invoice: [
            { id: 'pendente', label: 'Pendente' },
            { id: 'paga', label: 'Paga' },
            { id: 'vencida', label: 'Vencida' },
            { id: 'em_atraso', label: 'Em Ativação' },
            { id: 'erro', label: 'Erro no Processamento' }
        ],
        supplier: [
            { id: 'ativo', label: 'Ativo' },
            { id: 'ativacao', label: 'Ativação' },
            { id: 'inativo', label: 'Inativo' },
            { id: 'cancelado', label: 'Cancelado' }
        ],
        power_plant: [
            { id: 'em_conexao', label: 'Em Conexão' },
            { id: 'gerando', label: 'Gerando' },
            { id: 'manutencao', label: 'Manutenção' },
            { id: 'inativa', label: 'Inativa' },
            { id: 'cancelada', label: 'Cancelada' }
        ]
    };

    const commonEvents = [
        'Criação de Registro', 
        'Alteração de Status', 
        'Documento Assinado', 
        'Fatura Gerada', 
        'Pagamento Confirmado',
        'Vencimento Próximo',
        'Vencimento Atrasado'
    ];

    useEffect(() => {
        if (trigger) {
            setFormData({
                ...trigger,
                channels: trigger.channels || (trigger.channel === 'both' ? ['whatsapp', 'email'] : [trigger.channel || 'whatsapp']),
                delay_type: trigger.delay_type || 'immediate',
                delay_days: trigger.delay_days || 0,
                logic_operator: trigger.logic_operator || 'and',
                start_time: trigger.start_time || '09:00',
                end_time: trigger.end_time || '18:00',
                allowed_days: trigger.allowed_days || [1, 2, 3, 4, 5, 6],
                email_subject: trigger.email_subject || '',
                email_body: trigger.email_body || '',
                attachments: trigger.attachments || [],
                recipient_types: trigger.recipient_types || ['self'],
                custom_recipients: trigger.custom_recipients || ''
            });
        } else {
            setFormData({
                name: '',
                entity_type: 'lead',
                trigger_status: '',
                trigger_event: '',
                logic_operator: 'and',
                channels: ['whatsapp'],
                message_body: '',
                delay_type: 'immediate',
                delay_days: 0,
                start_time: '09:00',
                end_time: '18:00',
                allowed_days: [1, 2, 3, 4, 5, 6],
                email_subject: '',
                email_body: '',
                is_active: true,
                attachments: [],
                recipient_types: ['self'],
                custom_recipients: ''
            });
        }
    }, [trigger, isOpen]);

    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            const payload = {
                ...formData,
                created_by: user?.id,
                channel: formData.channels.length > 1 ? 'both' : (formData.channels[0] || 'whatsapp')
            };

            const { error } = trigger 
                ? await supabase.from('notification_triggers').update(payload).eq('id', trigger.id)
                : await supabase.from('notification_triggers').insert([payload]);

            if (error) throw error;

            showAlert(trigger ? 'Gatilho atualizado!' : 'Gatilho criado com sucesso!', 'success');
            onSave();
            onClose();
        } catch (error) {
            console.error('Error saving trigger:', error);
            showAlert('Erro ao salvar gatilho: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const [showVariables, setShowVariables] = useState(false);
    const availableVariables = {
        lead: [
            { label: 'Nome do Lead', key: 'Nome do Lead' },
            { label: 'Status do Lead', key: 'Status do Lead' },
            { label: 'Email', key: 'email' },
            { label: 'Telefone', key: 'telefone' }
        ],
        subscriber: [
            { label: 'Nome do Assinante', key: 'Nome do Assinante' },
            { label: 'Status do Assinante', key: 'Status do Assinante' },
            { label: 'CPF/CNPJ', key: 'cpf_cnpj' }
        ],
        consumer_unit: [
            { label: 'Unidade Consumidora', key: 'Unidade Consumidora' },
            { label: 'Número da UC', key: 'numero_uc' }
        ],
        invoice: [
            { label: 'Vencimento', key: 'Vencimento da Fatura' },
            { label: 'Valor Total', key: 'valor_total' },
            { label: 'Linha Digitável', key: 'Linha Digitável' }
        ],
        originator: [{ label: 'Nome do Originador', key: 'Nome do Originador' }],
        supplier: [{ label: 'Nome do Fornecedor', key: 'Nome do Fornecedor' }],
        power_plant: [{ label: 'Nome da Usina', key: 'Nome da Usina' }]
    };

    const insertVariable = (variableKey, target) => {
        const field = target === 'whatsapp' ? 'message_body' : 'email_body';
        const textarea = document.getElementById(target === 'whatsapp' ? 'whatsapp_textarea' : 'email_textarea');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = formData[field];
        const newTag = `{{${variableKey}}}`;
        const newText = text.substring(0, start) + newTag + text.substring(end);
        
        setFormData({ ...formData, [field]: newText });
        setShowVariables(false);
        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + newTag.length, start + newTag.length);
        }, 0);
    };

    const toggleChannel = (channel) => {
        const newChannels = formData.channels.includes(channel)
            ? formData.channels.filter(c => c !== channel)
            : [...formData.channels, channel];
        setFormData({ ...formData, channels: newChannels });
    };

    const toggleRecipient = (type) => {
        const newTypes = formData.recipient_types.includes(type)
            ? formData.recipient_types.filter(t => t !== type)
            : [...formData.recipient_types, type];
        setFormData({ ...formData, recipient_types: newTypes });
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(8px)', padding: '1rem'
        }}>
            <div style={{
                background: '#f8fafc', width: '100%', maxWidth: '850px', borderRadius: '28px',
                maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                animation: 'modalFadeIn 0.3s ease-out', border: '1px solid #e2e8f0'
            }}>
                <style>{`
                    @keyframes modalFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                    .tab-button { transition: all 0.2s ease; position: relative; }
                    .tab-button.active::after { content: ""; position: absolute; bottom: 0; left: 20%; right: 20%; height: 3px; background: #0284c7; border-radius: 3px 3px 0 0; }
                    .toggle-btn { position: relative; width: 44px; height: 22px; background: #cbd5e1; border-radius: 20px; cursor: pointer; transition: background 0.3s; }
                    .toggle-btn.active { background: #22c55e; }
                    .toggle-btn::before { content: ""; position: absolute; width: 18px; height: 18px; background: white; border-radius: 50%; top: 2px; left: 2px; transition: transform 0.3s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
                    .toggle-btn.active::before { transform: translateX(22px); }
                `}</style>

                {/* Header */}
                <div style={{ padding: '1.5rem 2.5rem', background: 'white', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ padding: '0.75rem', background: '#e0f2fe', borderRadius: '14px', color: '#0284c7' }}>
                            <Zap size={24} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#1e293b', fontWeight: 800 }}>
                                {trigger ? 'Editar Gatilho' : 'Nova Regra de Gatilho'}
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}>Configure a automação de disparos de mensagens.</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '0.5rem', borderRadius: '50%', display: 'flex' }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Horizontal Navigation Menu */}
                <div style={{ background: 'white', padding: '0 2.5rem', display: 'flex', gap: '2rem', borderBottom: '1px solid #f1f5f9' }}>
                    {[
                        { id: 'rules', label: 'Regras', icon: Layout },
                        { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
                        { id: 'email', label: 'E-mail', icon: Mail },
                        { id: 'recipients', label: 'Destinatários', icon: Users }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveSection(tab.id)}
                            className={`tab-button ${activeSection === tab.id ? 'active' : ''}`}
                            style={{
                                padding: '1.25rem 0.5rem', border: 'none', background: 'none', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 700,
                                fontSize: '0.9rem', color: activeSection === tab.id ? '#0284c7' : '#94a3b8',
                            }}
                        >
                            <tab.icon size={18} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div style={{ padding: '2.5rem', flex: 1, overflowY: 'auto' }}>
                    {activeSection === 'rules' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            {/* Block 1: Main Config */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                {/* Row 1: Name and Entity */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                                    <div className="form-group">
                                        <label style={{ display: 'block', marginBottom: '0.6rem', fontWeight: 700, color: '#334155', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Nome da Regra</label>
                                        <input
                                            required
                                            type="text"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="Ex: Boas-vindas Lead Novo"
                                            style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', fontSize: '0.95rem' }}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label style={{ display: 'block', marginBottom: '0.6rem', fontWeight: 700, color: '#334155', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Essa Regra se aplica a :</label>
                                        <select
                                            value={formData.entity_type}
                                            onChange={e => setFormData({ ...formData, entity_type: e.target.value, trigger_status: '' })}
                                            style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', fontSize: '0.95rem' }}
                                        >
                                            {entities.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {/* Row 2: Event, Operator, Status */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1.2fr', gap: '1.5rem', alignItems: 'flex-end' }}>
                                    <div className="form-group">
                                        <label style={{ display: 'block', marginBottom: '0.6rem', fontWeight: 700, color: '#334155', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Evento Gatilho</label>
                                        <select
                                            value={formData.trigger_event}
                                            onChange={e => setFormData({ ...formData, trigger_event: e.target.value })}
                                            style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', fontSize: '0.95rem' }}
                                        >
                                            <option value="">Nenhum Evento</option>
                                            {commonEvents.map(ev => <option key={ev} value={ev}>{ev}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label style={{ display: 'block', marginBottom: '0.6rem', fontWeight: 700, color: '#334155', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>Operador</label>
                                        <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.3rem', borderRadius: '10px' }}>
                                            {['and', 'or', 'not'].map(op => (
                                                <button
                                                    key={op}
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, logic_operator: op })}
                                                    style={{
                                                        flex: 1, padding: '0.5rem 0', borderRadius: '7px', border: 'none',
                                                        background: formData.logic_operator === op ? 'white' : 'transparent',
                                                        color: formData.logic_operator === op ? '#0284c7' : '#94a3b8',
                                                        fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase',
                                                        boxShadow: formData.logic_operator === op ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                                                    }}
                                                >
                                                    {op === 'and' ? 'E' : op === 'or' ? 'OU' : 'NÃO'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label style={{ display: 'block', marginBottom: '0.6rem', fontWeight: 700, color: '#334155', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status Gatilho</label>
                                        <select
                                            value={formData.trigger_status}
                                            onChange={e => setFormData({ ...formData, trigger_status: e.target.value })}
                                            style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', fontSize: '0.95rem' }}
                                        >
                                            <option value="">Nenhum Status</option>
                                            {entityStatusOptions[formData.entity_type]?.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>


                            {/* Block 2: Scheduling */}
                            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                    <Clock size={18} style={{ color: '#0284c7' }} />
                                    <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#1e293b', fontWeight: 700 }}>Tipo de Agendamento</h4>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '2rem' }}>
                                    <select
                                        value={formData.delay_type}
                                        onChange={e => setFormData({ ...formData, delay_type: e.target.value })}
                                        style={{ padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '0.95rem' }}
                                    >
                                        <option value="immediate">Imediato</option>
                                        <option value="before_due">Antes do Vencimento</option>
                                        <option value="after_due">Após o Vencimento</option>
                                        <option value="after_event">Dias após o Evento</option>
                                    </select>
                                    {formData.delay_type !== 'immediate' && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <input
                                                type="number"
                                                min="0"
                                                value={formData.delay_days}
                                                onChange={e => setFormData({ ...formData, delay_days: parseInt(e.target.value) || 0 })}
                                                style={{ width: '80px', padding: '0.85rem', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 700 }}
                                            />
                                            <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 600 }}>dias</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Time Zone (Footer of Rules) */}
                            <div style={{ background: '#f0f9ff', padding: '1.5rem', borderRadius: '16px', border: '1px solid #bae6fd', marginTop: '1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                                    <div style={{ padding: '0.5rem', background: '#0284c7', borderRadius: '8px', color: 'white' }}>
                                        <Clock size={18} />
                                    </div>
                                    <div>
                                        <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#0369a1', fontWeight: 700 }}>Janela de Envio (Time Zone)</h4>
                                        <p style={{ margin: 0, fontSize: '0.75rem', color: '#0ea5e9', fontWeight: 500 }}>Controle o horário de disparo automático.</p>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '2rem', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <input type="time" value={formData.start_time} onChange={e => setFormData({ ...formData, start_time: e.target.value })} style={{ padding: '0.6rem', borderRadius: '10px', border: '1px solid #bae6fd', fontSize: '0.9rem', color: '#0369a1', fontWeight: 600 }} />
                                        <span style={{ color: '#0ea5e9', fontSize: '0.8rem', fontWeight: 700 }}>até</span>
                                        <input type="time" value={formData.end_time} onChange={e => setFormData({ ...formData, end_time: e.target.value })} style={{ padding: '0.6rem', borderRadius: '10px', border: '1px solid #bae6fd', fontSize: '0.9rem', color: '#0369a1', fontWeight: 600 }} />
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                        {[ { id: 1, label: 'SEG' }, { id: 2, label: 'TER' }, { id: 3, label: 'QUA' }, { id: 4, label: 'QUI' }, { id: 5, label: 'SEX' }, { id: 6, label: 'SAB' }, { id: 0, label: 'DOM' } ].map(day => {
                                            const isActive = formData.allowed_days.includes(day.id);
                                            return (
                                                <button key={day.id} type="button" onClick={() => { const newDays = isActive ? formData.allowed_days.filter(d => d !== day.id) : [...formData.allowed_days, day.id]; setFormData({ ...formData, allowed_days: newDays }); }} style={{ flex: 1, padding: '0.5rem 0', borderRadius: '8px', border: '1px solid', borderColor: isActive ? '#0284c7' : '#bae6fd', background: isActive ? '#0284c7' : 'white', color: isActive ? 'white' : '#0ea5e9', fontSize: '0.65rem', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s' }}>
                                                    {day.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSection === 'whatsapp' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{ padding: '0.75rem', background: '#dcfce7', borderRadius: '12px', color: '#22c55e' }}>
                                        <MessageSquare size={24} />
                                    </div>
                                    <div>
                                        <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b', fontWeight: 800 }}>Canal WhatsApp</h4>
                                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Ative o envio de mensagens automáticas via API.</p>
                                    </div>
                                </div>
                                <div 
                                    className={`toggle-btn ${formData.channels.includes('whatsapp') ? 'active' : ''}`}
                                    onClick={() => toggleChannel('whatsapp')}
                                />
                            </div>

                            {formData.channels.includes('whatsapp') && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <label style={{ fontWeight: 700, color: '#334155', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mensagem (WhatsApp)</label>
                                        <button 
                                            type="button"
                                            onClick={() => setShowVariables(!showVariables)}
                                            style={{ background: '#f1f5f9', border: 'none', padding: '0.4rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', color: '#475569', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                        >
                                            <Info size={14} /> Variáveis {'{{}}'}
                                        </button>
                                    </div>

                                    <div style={{ position: 'relative' }}>
                                        <textarea
                                            id="whatsapp_textarea"
                                            value={formData.message_body}
                                            onChange={e => setFormData({ ...formData, message_body: e.target.value })}
                                            placeholder="Digite sua mensagem de WhatsApp..."
                                            style={{ width: '100%', height: '300px', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', background: 'white', fontSize: '1rem', lineHeight: '1.6', resize: 'none' }}
                                        />
                                        
                                        {showVariables && (
                                            <div style={{ position: 'absolute', top: '-10px', right: '10px', transform: 'translateY(-100%)', zIndex: 10, background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)', width: '320px' }}>
                                                <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Variáveis da Entidade:</p>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                    {availableVariables[formData.entity_type]?.map(v => (
                                                        <button key={v.key} type="button" onClick={() => insertVariable(v.key, 'whatsapp')} style={{ fontSize: '0.7rem', padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #f1f5f9', background: '#f8fafc', color: '#1e293b', cursor: 'pointer', fontWeight: 600 }}>{`{{${v.label}}}`}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>* Use quebras de linha para formatar a mensagem no WhatsApp.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeSection === 'email' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{ padding: '0.75rem', background: '#e0f2fe', borderRadius: '12px', color: '#0284c7' }}>
                                        <Mail size={24} />
                                    </div>
                                    <div>
                                        <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b', fontWeight: 800 }}>Canal E-mail</h4>
                                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Ative o envio de e-mails transacionais.</p>
                                    </div>
                                </div>
                                <div 
                                    className={`toggle-btn ${formData.channels.includes('email') ? 'active' : ''}`}
                                    onClick={() => toggleChannel('email')}
                                />
                            </div>

                            {formData.channels.includes('email') && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    <div className="form-group">
                                        <label style={{ display: 'block', marginBottom: '0.6rem', fontWeight: 700, color: '#334155', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Assunto do E-mail</label>
                                        <input
                                            type="text"
                                            value={formData.email_subject}
                                            onChange={e => setFormData({ ...formData, email_subject: e.target.value })}
                                            placeholder="Ex: Confirmação de Cadastro"
                                            style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', fontSize: '0.95rem' }}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                                            <label style={{ fontWeight: 700, color: '#334155', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Corpo do E-mail (HTML)</label>
                                            <button type="button" onClick={() => setShowVariables(!showVariables)} style={{ background: '#f1f5f9', border: 'none', padding: '0.3rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>Variáveis {'{{}}'}</button>
                                        </div>
                                        
                                        <div style={{ position: 'relative' }}>
                                            <textarea
                                                id="email_textarea"
                                                value={formData.email_body}
                                                onChange={e => setFormData({ ...formData, email_body: e.target.value })}
                                                placeholder="Cole aqui o seu código HTML para o e-mail..."
                                                style={{ width: '100%', height: '240px', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', background: '#0f172a', color: '#38bdf8', fontSize: '0.85rem', fontFamily: 'monospace', lineHeight: '1.5', resize: 'none' }}
                                            />
                                            {showVariables && (
                                                <div style={{ position: 'absolute', top: '-10px', right: '10px', transform: 'translateY(-100%)', zIndex: 10, background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1rem', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)', width: '300px' }}>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                        {availableVariables[formData.entity_type]?.map(v => (
                                                            <button key={v.key} type="button" onClick={() => insertVariable(v.key, 'email')} style={{ fontSize: '0.7rem', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #f1f5f9', background: '#f8fafc', color: '#1e293b', cursor: 'pointer', fontWeight: 600 }}>{`{{${v.label}}}`}</button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 700, color: '#475569', fontSize: '0.85rem', cursor: 'pointer' }}>
                                            <Upload size={16} /> Anexos em PDF/IMG (Opcional)
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeSection === 'recipients' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                {[
                                    { id: 'self', label: 'Lead / Alvo', desc: 'A entidade alvo do gatilho' },
                                    { id: 'originator', label: 'Originador', desc: 'Originador vinculado ao registro' },
                                    { id: 'subscriber', label: 'Assinante', desc: 'Assinante titular vinculado' },
                                    { id: 'supplier', label: 'Fornecedor', desc: 'Fornecedor da unidade consumidora' }
                                ].map(rec => (
                                    <div key={rec.id} style={{ background: 'white', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <h5 style={{ margin: 0, fontSize: '0.9rem', color: '#1e293b', fontWeight: 800 }}>{rec.label}</h5>
                                            <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>{rec.desc}</p>
                                        </div>
                                        <div 
                                            className={`toggle-btn ${formData.recipient_types.includes(rec.id) ? 'active' : ''}`}
                                            onClick={() => toggleRecipient(rec.id)}
                                        />
                                    </div>
                                ))}
                            </div>

                            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <div>
                                        <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e293b', fontWeight: 800 }}>Lista de Distribuição</h4>
                                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Envio para números extras cadastrados manualmente.</p>
                                    </div>
                                    <div 
                                        className={`toggle-btn ${formData.custom_recipients ? 'active' : ''}`}
                                        onClick={() => {
                                            if (formData.custom_recipients) setFormData({ ...formData, custom_recipients: '' });
                                            else setFormData({ ...formData, custom_recipients: ' ' });
                                        }}
                                    />
                                </div>
                                {formData.custom_recipients !== undefined && formData.custom_recipients !== null && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        <label style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Números de Telefone (Separe por ponto e vírgula)</label>
                                        <textarea
                                            value={formData.custom_recipients}
                                            onChange={e => setFormData({ ...formData, custom_recipients: e.target.value })}
                                            placeholder="5511999999999; 5511888888888..."
                                            style={{ width: '100%', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', fontSize: '0.95rem', height: '100px', resize: 'none' }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '1.5rem 2.5rem', background: 'white', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div 
                            className={`toggle-btn ${formData.is_active ? 'active' : ''}`}
                            onClick={() => setFormData({ ...formData, is_active: !formData.is_active })}
                        />
                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: formData.is_active ? '#166534' : '#64748b' }}>
                            {formData.is_active ? 'Gatilho Ativado' : 'Gatilho Pausado'}
                        </span>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{ padding: '0.75rem 2rem', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 2.5rem',
                                background: '#0284c7', color: 'white', border: 'none', borderRadius: '12px',
                                fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer',
                                boxShadow: '0 10px 15px -3px rgba(2, 132, 199, 0.3)', transition: 'all 0.2s'
                            }}
                        >
                            {loading ? 'Salvando...' : <><Save size={18} /> Salvar Regra</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

