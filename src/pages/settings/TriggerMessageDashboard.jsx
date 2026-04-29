import { useState, useEffect } from 'react';
import { Plus, MessageSquare, Mail, Zap, Trash2, Edit2, Power } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useUI } from '../../contexts/UIContext';
import MessageTriggerModal from './components/MessageTriggerModal';

export default function TriggerMessageDashboard() {
    const { showAlert } = useUI();
    const [triggers, setTriggers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTrigger, setEditingTrigger] = useState(null);

    const columns = [
        { id: 'lead', label: 'Leads' },
        { id: 'originator', label: 'Originadores' },
        { id: 'subscriber', label: 'Assinantes' },
        { id: 'consumer_unit', label: 'UCs Faturas' },
        { id: 'supplier', label: 'Fornecedores' },
        { id: 'power_plant', label: 'Usinas' }
    ];

    useEffect(() => {
        fetchTriggers();
    }, []);

    const fetchTriggers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('notification_triggers')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setTriggers(data || []);
        } catch (error) {
            console.error('Error fetching triggers:', error);
            showAlert('Erro ao carregar gatilhos', 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleTriggerStatus = async (id, currentStatus) => {
        try {
            const { error } = await supabase
                .from('notification_triggers')
                .update({ is_active: !currentStatus })
                .eq('id', id);

            if (error) throw error;
            setTriggers(triggers.map(t => t.id === id ? { ...t, is_active: !currentStatus } : t));
            showAlert(`Gatilho ${!currentStatus ? 'ativado' : 'desativado'}!`, 'success');
        } catch (error) {
            showAlert('Erro ao atualizar status', 'error');
        }
    };

    const deleteTrigger = async (id) => {
        if (!confirm('Tem certeza que deseja excluir este gatilho?')) return;
        try {
            const { error } = await supabase
                .from('notification_triggers')
                .delete()
                .eq('id', id);

            if (error) throw error;
            setTriggers(triggers.filter(t => t.id !== id));
            showAlert('Gatilho excluído com sucesso', 'success');
        } catch (error) {
            showAlert('Erro ao excluir gatilho', 'error');
        }
    };

    const renderCard = (trigger) => (
        <div key={trigger.id} style={{
            background: 'white',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '1.25rem',
            marginBottom: '1rem',
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
            transition: 'all 0.2s',
            cursor: 'default',
            position: 'relative'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <h5 style={{ margin: 0, fontSize: '0.95rem', color: '#1e293b', fontWeight: 800 }}>{trigger.name}</h5>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => { setEditingTrigger(trigger); setIsModalOpen(true); }} style={{ padding: '0.4rem', background: '#f1f5f9', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#64748b' }} title="Editar"><Edit2 size={14} /></button>
                    <button onClick={() => deleteTrigger(trigger.id)} style={{ padding: '0.4rem', background: '#fee2e2', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#ef4444' }} title="Excluir"><Trash2 size={14} /></button>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {trigger.trigger_event && (
                        <span style={{ fontSize: '0.7rem', background: '#e0f2fe', color: '#0369a1', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 700 }}>
                            {trigger.trigger_event}
                        </span>
                    )}
                    
                    {trigger.trigger_event && trigger.trigger_status && (
                        <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 800 }}>
                            {trigger.logic_operator === 'and' ? 'E' : trigger.logic_operator === 'or' ? 'OU' : 'NÃO'}
                        </span>
                    )}

                    {trigger.trigger_status && (
                        <span style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 700 }}>
                            Status: {trigger.trigger_status}
                        </span>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Clock size={12} /> 
                        {trigger.delay_type === 'immediate' ? 'Envio Imediato' : 
                         trigger.delay_type === 'before_due' ? `${trigger.delay_days} dias antes` : 
                         trigger.delay_type === 'after_due' ? `${trigger.delay_days} dias após` : 
                         `${trigger.delay_days} dias após evento`}
                    </span>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                    {(trigger.channels || [trigger.channel]).map(ch => (
                        <div key={ch} style={{ color: ch === 'whatsapp' ? '#22c55e' : '#0284c7' }} title={ch === 'whatsapp' ? 'WhatsApp' : 'E-mail'}>
                            {ch === 'whatsapp' ? <MessageSquare size={16} /> : <Mail size={16} />}
                        </div>
                    ))}
                </div>
                <button 
                    onClick={() => toggleTriggerStatus(trigger.id, trigger.is_active)}
                    style={{
                        padding: '0.3rem 0.6rem',
                        borderRadius: '6px',
                        border: 'none',
                        background: trigger.is_active ? '#dcfce7' : '#f1f5f9',
                        color: trigger.is_active ? '#166534' : '#64748b',
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        transition: 'all 0.2s'
                    }}
                >
                    <Power size={10} /> {trigger.is_active ? 'ATIVO' : 'INATIVO'}
                </button>
            </div>
        </div>
    );


    return (
        <div style={{ height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Regras de Gatilhos</h3>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>Configure as mensagens automáticas do CRM.</p>
                </div>
                <button
                    onClick={() => { setEditingTrigger(null); setIsModalOpen(true); }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.75rem 1.5rem',
                        background: '#0284c7',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 4px 6px -1px rgba(2, 132, 199, 0.2)'
                    }}
                >
                    <Plus size={18} /> Nova Regra
                </button>
            </div>

            {loading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Carregando gatilhos...</div>
            ) : (
                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
                    gap: '1.5rem',
                    paddingBottom: '2rem',
                    overflowX: 'auto'
                }}>
                    {columns.map(col => (
                        <div key={col.id} style={{ 
                            background: '#f8fafc', 
                            borderRadius: '16px', 
                            padding: '1.25rem',
                            minHeight: '400px',
                            border: '1px solid #f1f5f9'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    {col.label}
                                </h4>
                                <span style={{ background: '#e2e8f0', color: '#64748b', fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: '10px', fontWeight: 700 }}>
                                    {triggers.filter(t => t.entity_type === col.id).length}
                                </span>
                            </div>
                            
                            <div style={{ maxHeight: '600px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                                {triggers
                                    .filter(t => t.entity_type === col.id)
                                    .map(trigger => renderCard(trigger))
                                }
                                {triggers.filter(t => t.entity_type === col.id).length === 0 && (
                                    <div style={{ 
                                        textAlign: 'center', 
                                        padding: '3rem 1rem', 
                                        color: '#94a3b8', 
                                        fontSize: '0.85rem',
                                        border: '2px dashed #e2e8f0',
                                        borderRadius: '12px'
                                    }}>
                                        Nenhuma regra para {col.label}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isModalOpen && (
                <MessageTriggerModal 
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSave={fetchTriggers}
                    trigger={editingTrigger}
                />
            )}
        </div>
    );
}
