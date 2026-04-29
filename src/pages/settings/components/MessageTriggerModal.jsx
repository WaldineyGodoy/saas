import { useState, useEffect } from 'react';
import { X, Save, MessageSquare, Mail, Info, Upload, Trash2, Clock } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useUI } from '../../../contexts/UIContext';

export default function MessageTriggerModal({ isOpen, onClose, onSave, trigger }) {
    const { showAlert } = useUI();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        entity_type: 'lead',
        trigger_status: '',
        trigger_event: '',
        logic_operator: 'and', // and, or, none
        channels: ['whatsapp'], // Array para múltiplos canais
        message_body: '',
        delay_type: 'immediate', // immediate, before_due, after_due, after_event
        delay_days: 0,
        is_active: true,
        attachments: []
    });

    const entities = [
        { id: 'lead', label: 'Lead' },
        { id: 'originator', label: 'Originador' },
        { id: 'subscriber', label: 'Assinante' },
        { id: 'consumer_unit', label: 'UC Fatura' },
        { id: 'supplier', label: 'Fornecedor' },
        { id: 'power_plant', label: 'Usina' }
    ];

    // Status dinâmicos auditados conforme os quadros Kanban/Listas
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
            { id: 'aguardando_conexao', label: 'Aguardando Conexão' },
            { id: 'ativo', label: 'Ativo' },
            { id: 'sem_geracao', label: 'Sem Geração' },
            { id: 'em_atraso', label: 'Em Atraso' },
            { id: 'cancelado', label: 'Cancelado' },
            { id: 'cancelado_inadimplente', label: 'Cancelado (Inadimplente)' }
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

    // Eventos comuns
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
                attachments: trigger.attachments || []
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
                is_active: true,
                attachments: []
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
                // Garantir compatibilidade com colunas legadas se necessário
                channel: formData.channels.length > 1 ? 'both' : formData.channels[0]
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
        lead: ['nome', 'email', 'telefone', 'empresa', 'status', 'origem', 'vendedor'],
        subscriber: ['nome', 'cpf_cnpj', 'email', 'telefone', 'plano', 'valor_assinatura', 'data_adesao', 'nome_originador'],
        consumer_unit: ['numero_uc', 'nome_titular', 'endereco', 'distribuidora', 'status_ativacao'],
        originator: ['nome', 'email', 'telefone', 'codigo_indica', 'total_assinantes'],
        supplier: ['nome_fantasia', 'razao_social', 'cnpj', 'categoria'],
        power_plant: ['nome_usina', 'potencia_kwp', 'tecnologia', 'localizacao']
    };

    const insertVariable = (variable) => {
        const textarea = document.getElementById('message_body_textarea');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = formData.message_body;
        const before = text.substring(0, start);
        const after = text.substring(end);
        
        const newText = before + `{{${variable}}}` + after;
        setFormData({ ...formData, message_body: newText });
        setShowVariables(false);
        
        // Focar novamente no textarea após inserir
        setTimeout(() => {
            textarea.focus();
            const newCursorPos = start + variable.length + 4;
            textarea.setSelectionRange(newCursorPos, newCursorPos);
        }, 0);
    };

    if (!isOpen) return null;


    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(8px)', padding: '1rem'
        }}>
            <div style={{
                background: 'white', width: '100%', maxWidth: '800px', borderRadius: '24px',
                maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                animation: 'modalFadeIn 0.3s ease-out'
            }}>
                <style>{`
                    @keyframes modalFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                `}</style>

                {/* Header */}
                <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.5rem', color: '#1e293b', fontWeight: 700 }}>
                            {trigger ? 'Editar Regra' : 'Nova Regra de Gatilho'}
                        </h3>
                        <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>Configure as condições e a mensagem do gatilho.</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSave} style={{ padding: '2rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                        {/* Column 1: Config */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Nome da Regra</label>
                                <input
                                    required
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="Ex: Boas-vindas Lead Novo"
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Receptor (Entidade)</label>
                                <select
                                    value={formData.entity_type}
                                    onChange={e => setFormData({ ...formData, entity_type: e.target.value, trigger_status: '' })}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                                >
                                    {entities.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                                </select>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                     <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Evento Gatilho</label>
                                     <select
                                         value={formData.trigger_event}
                                         onChange={e => setFormData({ ...formData, trigger_event: e.target.value })}
                                         style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                                     >
                                         <option value="">Nenhum Evento</option>
                                         {commonEvents.map(ev => <option key={ev} value={ev}>{ev}</option>)}
                                     </select>
                                 </div>
                                 <div>
                                     <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Operador Lógico</label>
                                     <div style={{ display: 'flex', gap: '0.25rem', background: '#f1f5f9', padding: '0.25rem', borderRadius: '8px' }}>
                                         {['and', 'or', 'not'].map(op => (
                                             <button
                                                 key={op}
                                                 type="button"
                                                 onClick={() => setFormData({ ...formData, logic_operator: op })}
                                                 style={{
                                                     flex: 1, padding: '0.4rem', borderRadius: '6px', border: 'none',
                                                     background: formData.logic_operator === op ? 'white' : 'transparent',
                                                     color: formData.logic_operator === op ? '#0284c7' : '#64748b',
                                                     fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase',
                                                     boxShadow: formData.logic_operator === op ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                                 }}
                                             >
                                                 {op === 'and' ? 'E' : op === 'or' ? 'OU' : 'NÃO'}
                                             </button>
                                         ))}
                                     </div>
                                 </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Status Gatilho</label>
                                <select
                                    value={formData.trigger_status}
                                    onChange={e => setFormData({ ...formData, trigger_status: e.target.value })}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                                >
                                    <option value="">Nenhum Status</option>
                                    {entityStatusOptions[formData.entity_type]?.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                </select>
                            </div>

                            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '1.5rem', marginTop: '0.5rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Canais de Envio</label>
                                <div style={{ display: 'flex', gap: '0.75rem' }}>
                                    {[
                                        { id: 'whatsapp', label: 'WhatsApp', icon: <MessageSquare size={16} />, color: '#22c55e' },
                                        { id: 'email', label: 'E-mail', icon: <Mail size={16} />, color: '#0284c7' }
                                    ].map(ch => (
                                        <button
                                            key={ch.id}
                                            type="button"
                                            onClick={() => {
                                                const newChannels = formData.channels.includes(ch.id)
                                                    ? formData.channels.filter(c => c !== ch.id)
                                                    : [...formData.channels, ch.id];
                                                if (newChannels.length > 0) setFormData({ ...formData, channels: newChannels });
                                            }}
                                            style={{
                                                flex: 1, padding: '0.75rem', borderRadius: '12px', border: '2px solid',
                                                borderColor: formData.channels.includes(ch.id) ? ch.color : '#e2e8f0',
                                                background: formData.channels.includes(ch.id) ? `${ch.color}10` : 'white',
                                                color: formData.channels.includes(ch.id) ? ch.color : '#64748b',
                                                fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {ch.icon} {ch.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Tipo de Agendamento</label>
                                    <select
                                        value={formData.delay_type}
                                        onChange={e => setFormData({ ...formData, delay_type: e.target.value })}
                                        style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                                    >
                                        <option value="immediate">Imediato</option>
                                        <option value="before_due">Antes do Vencimento</option>
                                        <option value="after_due">Após o Vencimento</option>
                                        <option value="after_event">Dias após o Evento</option>
                                    </select>
                                </div>
                                {formData.delay_type !== 'immediate' && (
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Quantidade (Dias)</label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type="number"
                                                min="0"
                                                value={formData.delay_days}
                                                onChange={e => setFormData({ ...formData, delay_days: parseInt(e.target.value) || 0 })}
                                                style={{ width: '100%', padding: '0.75rem', paddingLeft: '2.5rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                                            />
                                            <Clock size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Column 2: Message */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <label style={{ fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Mensagem</label>
                                    <button 
                                        type="button" 
                                        onClick={() => setShowVariables(!showVariables)}
                                        style={{ 
                                            fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '6px', 
                                            border: '1px solid #0284c7', background: showVariables ? '#0284c7' : 'white', 
                                            color: showVariables ? 'white' : '#0284c7', cursor: 'pointer',
                                            fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem'
                                        }}
                                    >
                                        <Info size={14} /> Variáveis {'{{}}'}
                                    </button>
                                </div>

                                {showVariables && (
                                    <div style={{ 
                                        background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px', 
                                        padding: '1rem', marginBottom: '1rem', animation: 'fadeIn 0.2s ease-out'
                                    }}>
                                        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', color: '#0369a1', fontWeight: 600 }}>Clique para inserir na mensagem:</p>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            {(availableVariables[formData.entity_type] || []).map(v => (
                                                <button 
                                                    key={v} 
                                                    type="button" 
                                                    onClick={() => insertVariable(v)}
                                                    style={{ 
                                                        fontSize: '0.7rem', padding: '0.3rem 0.6rem', borderRadius: '6px', 
                                                        border: '1px solid #e2e8f0', background: 'white', color: '#334155', 
                                                        cursor: 'pointer', transition: 'all 0.2s', fontWeight: 500
                                                    }}
                                                    onMouseOver={e => e.currentTarget.style.borderColor = '#0284c7'}
                                                    onMouseOut={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                                                >
                                                    {`{{${v}}}`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <textarea
                                    id="message_body_textarea"
                                    required
                                    value={formData.message_body}
                                    onChange={e => setFormData({ ...formData, message_body: e.target.value })}
                                    onFocus={() => setShowVariables(false)}
                                    placeholder="Digite sua mensagem aqui... Use {{variavel}} para campos dinâmicos."
                                    style={{ width: '100%', height: '240px', padding: '1rem', borderRadius: '12px', border: '1px solid #cbd5e1', resize: 'none', fontSize: '0.95rem', lineHeight: '1.5', transition: 'border-color 0.2s' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Anexos</label>
                                <div style={{
                                    border: '2px dashed #e2e8f0', borderRadius: '12px', padding: '1.5rem',
                                    textAlign: 'center', background: '#f8fafc', color: '#94a3b8', fontSize: '0.85rem',
                                    cursor: 'pointer'
                                }}>
                                    <Upload size={24} style={{ marginBottom: '0.5rem' }} />
                                    <p style={{ margin: 0 }}>Clique para carregar arquivos (PDF/IMG)</p>
                                    <p style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>Máx: 5MB</p>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: 'auto' }}>
                                <input
                                    type="checkbox"
                                    id="is_active"
                                    checked={formData.is_active}
                                    onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                />
                                <label htmlFor="is_active" style={{ fontSize: '0.95rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>Gatilho Ativo</label>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '3rem', borderTop: '1px solid #f1f5f9', paddingTop: '2rem' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{ padding: '0.8rem 2rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 600, cursor: 'pointer' }}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.8rem 3rem',
                                background: '#0284c7', color: 'white', border: 'none', borderRadius: '10px',
                                fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer',
                                boxShadow: '0 4px 6px -1px rgba(2, 132, 199, 0.2)'
                            }}
                        >
                            {loading ? 'Salvando...' : <><Save size={20} /> Salvar Regra</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
