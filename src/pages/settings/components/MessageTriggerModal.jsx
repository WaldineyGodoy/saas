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
        channel: 'whatsapp',
        message_body: '',
        delay_minutes: 0,
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

    // Status dinâmicos por entidade
    const entityStatusOptions = {
        lead: ['Novo', 'Em Qualificação', 'Simulado', 'Aguardando Documentos', 'Convertido', 'Perdido'],
        subscriber: ['Ativo', 'Inativo', 'Suspenso', 'Aguardando Ativação'],
        originator: ['Ativo', 'Inativo', 'Aguardando Aprovação'],
        consumer_unit: ['Ligada', 'Desligada', 'Em Troca de Titularidade', 'Aguardando Vistoria'],
        supplier: ['Homologado', 'Em Análise', 'Inativo'],
        power_plant: ['Em Produção', 'Manutenção', 'Aguardando Conexão']
    };

    // Eventos comuns
    const commonEvents = ['Criação de Registro', 'Alteração de Status', 'Documento Assinado', 'Fatura Gerada', 'Pagamento Confirmado'];

    useEffect(() => {
        if (trigger) {
            setFormData({
                ...trigger,
                attachments: trigger.attachments || []
            });
        } else {
            setFormData({
                name: '',
                entity_type: 'lead',
                trigger_status: '',
                trigger_event: '',
                channel: 'whatsapp',
                message_body: '',
                delay_minutes: 0,
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
                created_by: user?.id
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

    const insertVariable = (variable) => {
        setFormData(prev => ({
            ...prev,
            message_body: prev.message_body + ` {{${variable}}}`
        }));
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
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Status Gatilho</label>
                                    <select
                                        value={formData.trigger_status}
                                        onChange={e => setFormData({ ...formData, trigger_status: e.target.value })}
                                        style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                                    >
                                        <option value="">Nenhum Status</option>
                                        {entityStatusOptions[formData.entity_type]?.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
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
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Canal de Envio</label>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, channel: 'whatsapp' })}
                                            style={{
                                                flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1',
                                                background: formData.channel === 'whatsapp' ? '#dcfce7' : 'white',
                                                color: formData.channel === 'whatsapp' ? '#166534' : '#64748b',
                                                fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center'
                                            }}
                                        >
                                            <MessageSquare size={16} /> Whats
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, channel: 'email' })}
                                            style={{
                                                flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1',
                                                background: formData.channel === 'email' ? '#e0f2fe' : 'white',
                                                color: formData.channel === 'email' ? '#0369a1' : '#64748b',
                                                fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'center'
                                            }}
                                        >
                                            <Mail size={16} /> E-mail
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Delay (Minutos)</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type="number"
                                            min="0"
                                            value={formData.delay_minutes}
                                            onChange={e => setFormData({ ...formData, delay_minutes: parseInt(e.target.value) || 0 })}
                                            style={{ width: '100%', padding: '0.75rem', paddingLeft: '2.5rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                                        />
                                        <Clock size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Column 2: Message */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div>
                                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>
                                    Mensagem
                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                        {['nome', 'valor', 'vencimento', 'empresa'].map(v => (
                                            <button 
                                                key={v} 
                                                type="button" 
                                                onClick={() => insertVariable(v)}
                                                style={{ fontSize: '0.65rem', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#0284c7', cursor: 'pointer' }}
                                            >
                                                {`{{${v}}}`}
                                            </button>
                                        ))}
                                    </div>
                                </label>
                                <textarea
                                    required
                                    value={formData.message_body}
                                    onChange={e => setFormData({ ...formData, message_body: e.target.value })}
                                    placeholder="Olá {{nome}}, sua fatura no valor de {{valor}} vence em {{vencimento}}..."
                                    style={{ width: '100%', height: '180px', padding: '1rem', borderRadius: '12px', border: '1px solid #cbd5e1', resize: 'none', fontSize: '0.95rem', lineHeight: '1.5' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: '#475569', fontSize: '0.9rem' }}>Anexos</label>
                                <div style={{
                                    border: '2px dashed #e2e8f0', borderRadius: '12px', padding: '1.5rem',
                                    textAlign: 'center', background: '#f8fafc', color: '#94a3b8', fontSize: '0.85rem'
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
