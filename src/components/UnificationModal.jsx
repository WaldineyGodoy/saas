import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { useBranding } from '../contexts/BrandingContext';
import { X, Layers, ShieldAlert, ArrowRight, CheckCircle, Loader2, Save } from 'lucide-react';

export default function UnificationModal({ sourceProtocol, targetProtocol, onClose, onSuccess }) {
    const { branding } = useBranding();
    const primaryColor = branding?.primary_color || '#003366';
    const { showAlert } = useUI();

    const [mode, setMode] = useState('direct'); // 'direct' (b under a) or 'escalate' (new master)
    const [escalationCategory, setEscalationCategory] = useState('Ouvidoria');
    const [masterTitle, setMasterTitle] = useState(`Escalonamento ${escalationCategory}: ${targetProtocol?.title || ''}`);
    const [deadlineDays, setDeadlineDays] = useState('5');
    const [submitting, setSubmitting] = useState(false);

    const handleConfirm = async () => {
        if (!sourceProtocol?.id || !targetProtocol?.id) {
            showAlert('Erro: Protocolos selecionados não são válidos.', 'error');
            return;
        }

        setSubmitting(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const userId = user?.id || null;

            if (mode === 'direct') {
                // Incorporate sourceProtocol under targetProtocol as its sub-protocol
                const { error: updateError } = await supabase
                    .from('protocols')
                    .update({
                        parent_protocol_id: targetProtocol.id,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', sourceProtocol.id);

                if (updateError) throw updateError;

                // Log to history for both protocols
                const sourceLog = `Protocolo incorporado como sub-protocolo ao Protocolo #${targetProtocol.protocol_number || targetProtocol.id.substring(0,8)}.`;
                const targetLog = `Protocolo #${sourceProtocol.protocol_number || sourceProtocol.id.substring(0,8)} ("${sourceProtocol.title}") foi incorporado a este chamado.`;

                try {
                    await supabase.from('crm_history').insert([
                        {
                            entity_type: 'protocol',
                            entity_id: sourceProtocol.id,
                            content: sourceLog,
                            created_by: userId,
                            metadata: { target_protocol_id: targetProtocol.id }
                        },
                        {
                            entity_type: 'protocol',
                            entity_id: targetProtocol.id,
                            content: targetLog,
                            created_by: userId,
                            metadata: { source_protocol_id: sourceProtocol.id }
                        }
                    ]);
                } catch (histErr) {
                    console.error('Erro ao gravar histórico:', histErr);
                }

                showAlert(`Protocolos unificados com sucesso! #${sourceProtocol.protocol_number || ''} foi incorporado a #${targetProtocol.protocol_number || ''}.`, 'success');
            } else {
                // Escalate: Create a new Master protocol (e.g. Ouvidoria) and attach BOTH source & target under it
                const daysNum = parseInt(deadlineDays) || 5;
                const dueDate = new Date();
                dueDate.setDate(dueDate.getDate() + daysNum);

                const rawEntityType = targetProtocol?.linked_entity_type || sourceProtocol?.linked_entity_type;
                const linkedEntityType = (rawEntityType && typeof rawEntityType === 'string' && rawEntityType.trim() !== '') ? rawEntityType.trim() : null;

                const rawEntityId = targetProtocol?.linked_entity_id || sourceProtocol?.linked_entity_id;
                const linkedEntityId = (rawEntityId && typeof rawEntityId === 'string' && rawEntityId.trim() !== '' && rawEntityId !== 'undefined' && rawEntityId !== 'null') ? rawEntityId : null;

                const { data: newMaster, error: masterError } = await supabase
                    .from('protocols')
                    .insert({
                        title: `[${escalationCategory}] ${masterTitle}`,
                        description: `Tratativa unificada de escalonamento para a esfera ${escalationCategory}. Incorpora os protocolos #${sourceProtocol.protocol_number || sourceProtocol.id.substring(0,8)} e #${targetProtocol.protocol_number || targetProtocol.id.substring(0,8)}.`,
                        status: 'gerar',
                        deadline_days: daysNum,
                        due_date: dueDate.toISOString(),
                        linked_entity_type: linkedEntityType,
                        linked_entity_id: linkedEntityId,
                        created_by: userId,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (masterError) throw masterError;

                // Update both source and target protocols to have newMaster as parent
                const { error: batchUpdateError } = await supabase
                    .from('protocols')
                    .update({
                        parent_protocol_id: newMaster.id,
                        updated_at: new Date().toISOString()
                    })
                    .in('id', [sourceProtocol.id, targetProtocol.id]);

                if (batchUpdateError) throw batchUpdateError;

                // Register history logs
                const escLog = `Escalonado para esfera ${escalationCategory} no chamado Master #${newMaster.protocol_number || newMaster.id.substring(0,8)}.`;
                try {
                    await supabase.from('crm_history').insert([
                        {
                            entity_type: 'protocol',
                            entity_id: newMaster.id,
                            content: `Chamado unificado de ${escalationCategory} criado. Incorporou os protocolos #${sourceProtocol.protocol_number || ''} e #${targetProtocol.protocol_number || ''}.`,
                            created_by: userId
                        },
                        {
                            entity_type: 'protocol',
                            entity_id: sourceProtocol.id,
                            content: escLog,
                            created_by: userId,
                            metadata: { master_protocol_id: newMaster.id }
                        },
                        {
                            entity_type: 'protocol',
                            entity_id: targetProtocol.id,
                            content: escLog,
                            created_by: userId,
                            metadata: { master_protocol_id: newMaster.id }
                        }
                    ]);
                } catch (histErr) {
                    console.error('Erro ao gravar histórico de escalonamento:', histErr);
                }

                showAlert(`Novo chamado de ${escalationCategory} criado e protocolos incorporados com sucesso!`, 'success');
            }

            if (onSuccess) onSuccess();
            onClose();
        } catch (err) {
            console.error('Erro ao unificar protocolos:', err);
            showAlert('Erro ao unificar protocolos: ' + err.message, 'error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: 3000,
            backdropFilter: 'blur(6px)', animation: 'fadeIn 0.2s ease-in-out'
        }}>
            <div style={{
                background: 'white',
                borderRadius: '16px',
                width: '90%',
                maxWidth: '540px',
                maxHeight: '90vh',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '1.25rem 1.5rem', borderBottom: '1px solid #f1f5f9'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div style={{
                            width: '38px', height: '38px', borderRadius: '10px',
                            background: '#eff6ff', color: primaryColor,
                            display: 'flex', justifyContent: 'center', alignItems: 'center'
                        }}>
                            <Layers size={22} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                                Unificação de Protocolos
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
                                Reunir tratativas para escalonamento ou resolução conjunta
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body (Scrollable) */}
                <div style={{
                    padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1,
                    display: 'flex', flexDirection: 'column', gap: '1.25rem'
                }}>
                    {/* Cards comparison */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        background: '#f8fafc', padding: '0.85rem', borderRadius: '10px',
                        border: '1px solid #e2e8f0', fontSize: '0.825rem'
                    }}>
                        <div style={{ flex: 1, background: 'white', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b' }}>PROTOCOLO AINDA SOLTO</div>
                            <div style={{ fontWeight: 700, color: '#1e293b' }}>#{sourceProtocol?.protocol_number || sourceProtocol?.id?.substring(0,8)}</div>
                            <div style={{ color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sourceProtocol?.title}</div>
                        </div>
                        <ArrowRight size={18} style={{ color: '#94a3b8', flexShrink: 0 }} />
                        <div style={{ flex: 1, background: 'white', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: primaryColor }}>PROTOCOLO DESTINO</div>
                            <div style={{ fontWeight: 700, color: '#1e293b' }}>#{targetProtocol?.protocol_number || targetProtocol?.id?.substring(0,8)}</div>
                            <div style={{ color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{targetProtocol?.title}</div>
                        </div>
                    </div>

                    {/* Mode Selector */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
                            Como deseja unificar estes chamados?
                        </label>

                        <div
                            onClick={() => setMode('direct')}
                            style={{
                                padding: '0.85rem 1rem', borderRadius: '10px', cursor: 'pointer',
                                border: `2px solid ${mode === 'direct' ? primaryColor : '#e2e8f0'}`,
                                background: mode === 'direct' ? '#f0f9ff' : 'white',
                                display: 'flex', alignItems: 'flex-start', gap: '0.75rem', transition: 'all 0.2s'
                            }}
                        >
                            <div style={{ marginTop: '2px', color: mode === 'direct' ? primaryColor : '#94a3b8' }}>
                                <CheckCircle size={18} />
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>
                                    Incorporar como Sub-protocolo direto
                                </div>
                                <div style={{ fontSize: '0.775rem', color: '#64748b', marginTop: '2px' }}>
                                    O protocolo #{sourceProtocol?.protocol_number || 'A'} passa a ser uma ramificação/sub-tarefa de #{targetProtocol?.protocol_number || 'B'}.
                                </div>
                            </div>
                        </div>

                        <div
                            onClick={() => {
                                setMode('escalate');
                                setMasterTitle(`Escalonamento ${escalationCategory}: ${targetProtocol?.title || ''}`);
                            }}
                            style={{
                                padding: '0.85rem 1rem', borderRadius: '10px', cursor: 'pointer',
                                border: `2px solid ${mode === 'escalate' ? primaryColor : '#e2e8f0'}`,
                                background: mode === 'escalate' ? '#f0f9ff' : 'white',
                                display: 'flex', alignItems: 'flex-start', gap: '0.75rem', transition: 'all 0.2s'
                            }}
                        >
                            <div style={{ marginTop: '2px', color: mode === 'escalate' ? primaryColor : '#94a3b8' }}>
                                <ShieldAlert size={18} />
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>
                                    Escalonar para Esfera Superior (Ouvidoria / PROCON)
                                </div>
                                <div style={{ fontSize: '0.775rem', color: '#64748b', marginTop: '2px' }}>
                                    Cria um novo chamado Master e incorpora ambos os protocolos sob a tratativa unificada.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Additional Form when 'escalate' is selected */}
                    {mode === 'escalate' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                                    Esfera / Categoria de Escalonamento:
                                </label>
                                <select
                                    value={escalationCategory}
                                    onChange={e => {
                                        setEscalationCategory(e.target.value);
                                        setMasterTitle(`Escalonamento ${e.target.value}: ${targetProtocol?.title || ''}`);
                                    }}
                                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 600 }}
                                >
                                    <option value="Ouvidoria">Ouvidoria</option>
                                    <option value="PROCON">PROCON</option>
                                    <option value="Agência Reguladora">Agência Reguladora (ANEEL / Concessionária)</option>
                                    <option value="Judicial / Jurídico">Judicial / Jurídico</option>
                                    <option value="Tratativa Especial">Tratativa Especial</option>
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                                    Título do Novo Chamado Master:
                                </label>
                                <input
                                    type="text"
                                    value={masterTitle}
                                    onChange={e => setMasterTitle(e.target.value)}
                                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                                    Prazo do Novo Chamado (dias úteis):
                                </label>
                                <input
                                    type="number"
                                    value={deadlineDays}
                                    onChange={e => setDeadlineDays(e.target.value)}
                                    min="1"
                                    max="60"
                                    style={{ width: '100px', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Fixed Footer Actions */}
                <div style={{
                    display: 'flex', justifyContent: 'flex-end', gap: '0.75rem',
                    padding: '1rem 1.5rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0'
                }}>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        style={{
                            padding: '0.65rem 1.25rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                            background: 'white', color: '#475569', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer'
                        }}
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={submitting}
                        style={{
                            padding: '0.65rem 1.5rem', border: 'none', borderRadius: '8px',
                            backgroundColor: '#003366', color: '#ffffff', fontWeight: 700, fontSize: '0.85rem',
                            cursor: submitting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.45rem',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                    >
                        {submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />}
                        {submitting ? 'Salvando Unificação...' : 'Salvar Unificação'}
                    </button>
                </div>
            </div>
        </div>
    );
}
