import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { useBranding } from '../contexts/BrandingContext';
import { X, Hash, Calendar, Layers, Link as LinkIcon, Plus, Save, Clock, ChevronDown, CheckCircle, RefreshCw, FileText } from 'lucide-react';
import HistoryTimeline from './HistoryTimeline';

// Helper to calculate business days (skips Saturday and Sunday)
function calculateBusinessDays(startDate, numDays) {
    if (!startDate || isNaN(numDays) || numDays <= 0) return null;
    let date = new Date(startDate);
    let count = 0;
    while (count < numDays) {
        date.setDate(date.getDate() + 1);
        const day = date.getDay();
        if (day !== 0 && day !== 6) {
            count++;
        }
    }
    return date;
}

function formatDateBR(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function SearchableSelect({ options, value, onChange, placeholder, loading }) {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    
    // Sync initial value or changes
    useEffect(() => {
        const selected = options.find(o => o.id === value);
        if (selected) {
            setSearch(selected.label);
        } else {
            setSearch('');
        }
    }, [value, options]);

    const filtered = options.filter(o => 
        o.label.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{ position: 'relative' }}>
            <input
                type="text"
                placeholder={loading ? "Carregando..." : placeholder}
                value={search}
                onChange={(e) => {
                    setSearch(e.target.value);
                    setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                disabled={loading}
                style={{
                    width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                    outline: 'none', fontSize: '0.85rem', fontWeight: 600, background: 'white'
                }}
            />
            {isOpen && !loading && (
                <>
                    {/* Backdrop to close list when clicking outside */}
                    <div 
                        onClick={() => {
                            setIsOpen(false);
                            const selected = options.find(o => o.id === value);
                            setSearch(selected ? selected.label : '');
                        }}
                        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }} 
                    />
                    <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        backgroundColor: 'white', border: '1px solid #cbd5e1', borderRadius: '8px',
                        marginTop: '4px', maxHeight: '180px', overflowY: 'auto', zIndex: 101,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}>
                        {filtered.length === 0 ? (
                            <div style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#94a3b8' }}>
                                Nenhum registro encontrado
                            </div>
                        ) : (
                            filtered.map(opt => (
                                <div
                                    key={opt.id}
                                    onClick={() => {
                                        onChange(opt.id);
                                        setSearch(opt.label);
                                        setIsOpen(false);
                                    }}
                                    style={{
                                        padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 600,
                                        color: '#334155', cursor: 'pointer', transition: 'background 0.15s',
                                        backgroundColor: opt.id === value ? '#eff6ff' : 'white'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = opt.id === value ? '#eff6ff' : 'white'}
                                >
                                    {opt.label}
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

export default function ProtocolModal({ protocol, parentProtocolId, onClose, onUpdated }) {
    const { showAlert } = useUI();
    const { branding } = useBranding();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Form fields
    const [title, setTitle] = useState(protocol?.title || '');
    const [description, setDescription] = useState(protocol?.description || '');
    const [protocolNumber, setProtocolNumber] = useState(protocol?.protocol_number || '');
    const [status, setStatus] = useState(protocol?.status || 'gerar');
    const [deadlineDays, setDeadlineDays] = useState(protocol?.deadline_days || '');
    const [dueDate, setDueDate] = useState(protocol?.due_date || null);
    
    // Entity linking
    const [linkedEntityType, setLinkedEntityType] = useState(protocol?.linked_entity_type || '');
    const [linkedEntityId, setLinkedEntityId] = useState(protocol?.linked_entity_id || '');
    const [entityOptions, setEntityOptions] = useState([]);
    const [loadingEntities, setLoadingEntities] = useState(false);

    // Sub-protocols state
    const [subProtocols, setSubProtocols] = useState([]);
    const [showSubModal, setShowSubModal] = useState(false);

    const primaryColor = branding?.primary_color || '#003366';

    // Fetch entity options when type changes
    useEffect(() => {
        if (!linkedEntityType) {
            setEntityOptions([]);
            setLinkedEntityId('');
            return;
        }
        fetchEntityOptions();
    }, [linkedEntityType]);

    // Calculate due date automatically
    useEffect(() => {
        if (protocolNumber && deadlineDays && Number(deadlineDays) > 0) {
            const calculated = calculateBusinessDays(new Date(), Number(deadlineDays));
            if (calculated) {
                setDueDate(calculated.toISOString());
                // Auto transition to "em_tratativa" when protocol number and deadline are filled
                setStatus('em_tratativa');
            }
        } else {
            setDueDate(null);
        }
    }, [protocolNumber, deadlineDays]);

    // Fetch child sub-protocols if we have a protocol ID
    useEffect(() => {
        if (protocol?.id) {
            fetchSubProtocols();
        }
    }, [protocol?.id]);

    const fetchSubProtocols = async () => {
        try {
            const { data, error } = await supabase
                .from('protocols')
                .select('*')
                .eq('parent_protocol_id', protocol.id)
                .order('created_at', { ascending: true });
            if (error) throw error;
            setSubProtocols(data || []);
        } catch (err) {
            console.error('Error fetching sub protocols:', err);
        }
    };

    const fetchEntityOptions = async () => {
        setLoadingEntities(true);
        try {
            let data = [];
            let error = null;

            if (linkedEntityType === 'assinante') {
                ({ data, error } = await supabase.from('subscribers').select('id, name').order('name'));
            } else if (linkedEntityType === 'unidade_consumidora') {
                ({ data, error } = await supabase.from('consumer_units').select('id, numero_uc, titular_conta').order('titular_conta'));
            } else if (linkedEntityType === 'conta_energia') {
                // Invoices that are concessionaria bills (valor_concessionaria > 0)
                ({ data, error } = await supabase
                    .from('invoices')
                    .select('id, mes_referencia, concessionaria')
                    .not('concessionaria', 'is', null)
                    .order('mes_referencia', { ascending: false }));
            } else if (linkedEntityType === 'fatura') {
                // Invoices that are subscriber bills
                ({ data, error } = await supabase
                    .from('invoices')
                    .select('id, mes_referencia, valor_a_pagar')
                    .order('mes_referencia', { ascending: false }));
            } else if (linkedEntityType === 'rateio_list') {
                ({ data, error } = await supabase.from('rateio_lists').select('id, usina_name, created_at').order('created_at', { ascending: false }));
            }

            if (error) throw error;

            const mapped = (data || []).map(item => {
                if (linkedEntityType === 'assinante') {
                    return { id: item.id, label: item.name };
                } else if (linkedEntityType === 'unidade_consumidora') {
                    return { id: item.id, label: `${item.titular_conta} (UC: ${item.numero_uc})` };
                } else if (linkedEntityType === 'conta_energia') {
                    return { id: item.id, label: `${item.concessionaria} - Ref: ${item.mes_referencia ? item.mes_referencia.substring(0,7) : ''}` };
                } else if (linkedEntityType === 'fatura') {
                    return { id: item.id, label: `Fatura Ref: ${item.mes_referencia ? item.mes_referencia.substring(0,7) : ''} - Valor: R$ ${Number(item.valor_a_pagar).toFixed(2)}` };
                } else if (linkedEntityType === 'rateio_list') {
                    return { id: item.id, label: `${item.usina_name} - Criada: ${formatDateBR(item.created_at)}` };
                }
                return { id: item.id, label: item.id };
            });

            setEntityOptions(mapped);
            // Default to empty or preserve existing if editing
            if (protocol?.linked_entity_type === linkedEntityType && protocol?.linked_entity_id) {
                setLinkedEntityId(protocol.linked_entity_id);
            } else {
                setLinkedEntityId('');
            }
        } catch (err) {
            console.error('Error fetching linked entities:', err);
            showAlert('Erro ao buscar entidades vinculadas.', 'error');
        } finally {
            setLoadingEntities(false);
        }
    };

    const handleSave = async (e) => {
        if (e) e.preventDefault();
        if (!title.trim()) {
            showAlert('Por favor, informe o título/assunto do protocolo.', 'warning');
            return;
        }

        setSaving(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const now = new Date().toISOString();

            const payload = {
                title,
                description,
                protocol_number: protocolNumber || null,
                status,
                linked_entity_type: linkedEntityType || null,
                linked_entity_id: linkedEntityId || null,
                deadline_days: deadlineDays ? Number(deadlineDays) : null,
                due_date: dueDate,
                parent_protocol_id: parentProtocolId || protocol?.parent_protocol_id || null,
                updated_at: now
            };

            let returnedProtocol = null;

            if (protocol?.id) {
                // Update
                const { data, error } = await supabase
                    .from('protocols')
                    .update(payload)
                    .eq('id', protocol.id)
                    .select()
                    .single();
                if (error) throw error;
                returnedProtocol = data;
                showAlert('Protocolo atualizado com sucesso!', 'success');
            } else {
                // Create new
                payload.created_by = user?.id;
                payload.created_at = now;

                const { data, error } = await supabase
                    .from('protocols')
                    .insert(payload)
                    .select()
                    .single();
                if (error) throw error;
                returnedProtocol = data;

                // LOG TO CRM HISTORY OF THE ENTITY
                if (linkedEntityType && linkedEntityId) {
                    let dbTable = '';
                    if (linkedEntityType === 'assinante') dbTable = 'subscribers';
                    else if (linkedEntityType === 'unidade_consumidora') dbTable = 'consumer_units';
                    else if (linkedEntityType === 'conta_energia' || linkedEntityType === 'fatura') dbTable = 'invoices';
                    else if (linkedEntityType === 'rateio_list') dbTable = 'rateio_lists';

                    if (dbTable) {
                        const contentLog = `Novo protocolo criado: "${title}" ${protocolNumber ? `(Nº: ${protocolNumber})` : ''}`;
                        await supabase.from('crm_history').insert({
                            entity_type: dbTable,
                            entity_id: linkedEntityId,
                            content: contentLog,
                            created_by: user?.id,
                            metadata: {
                                protocol_id: returnedProtocol.id,
                                message: contentLog
                            }
                        });
                    }
                }

                showAlert('Protocolo criado com sucesso!', 'success');
            }

            if (onUpdated) onUpdated();
            onClose();
        } catch (err) {
            console.error('Error saving protocol:', err);
            showAlert('Erro ao salvar protocolo: ' + err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: 1100,
            backdropFilter: 'blur(4px)'
        }}>
            <div style={{
                background: '#f8fafc',
                borderRadius: '18px',
                width: '95%',
                maxWidth: '900px',
                maxHeight: '92vh',
                overflowY: 'auto',
                boxShadow: '0 30px 80px rgba(0,0,0,0.3)',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.25rem 2rem',
                    background: 'white',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderTopLeftRadius: '18px', borderTopRightRadius: '18px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ padding: '0.5rem', background: primaryColor + '15', borderRadius: '10px', color: primaryColor }}>
                            <Layers size={22} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b', fontWeight: 800 }}>
                                {protocol?.id ? `Editar Protocolo` : parentProtocolId ? `Novo Sub-protocolo / Tarefa` : `Criar Novo Protocolo`}
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8' }}>
                                Gerencie atualizações de chamados, prazos e resoluções
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: '#f1f5f9', border: 'none', cursor: 'pointer',
                        color: '#64748b', padding: '0.4rem', borderRadius: '8px',
                        transition: 'all 0.2s', display: 'flex', alignItems: 'center'
                    }}>
                        <X size={20} />
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: protocol?.id ? '1.2fr 1fr' : '1fr', gap: '0', flex: 1, minHeight: 0 }}>
                    {/* Form Panel */}
                    <form onSubmit={handleSave} style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', borderRight: protocol?.id ? '1px solid #e2e8f0' : 'none' }}>
                        
                        {/* Title */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Título / Assunto *</label>
                            <input
                                type="text"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder="Descreva brevemente o assunto..."
                                required
                                style={{
                                    width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                    outline: 'none', fontSize: '0.9rem', fontWeight: 600, transition: 'all 0.2s'
                                }}
                                onFocus={e => e.target.style.borderColor = primaryColor}
                                onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Descrição Inicial</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Insira detalhes adicionais do chamado..."
                                style={{
                                    width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                    outline: 'none', fontSize: '0.88rem', minHeight: '80px', resize: 'vertical'
                                }}
                                onFocus={e => e.target.style.borderColor = primaryColor}
                                onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                            />
                        </div>

                        {/* Protocol Number, Status */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Nº do Protocolo</label>
                                <div style={{ position: 'relative' }}>
                                    <Hash size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                                    <input
                                        type="text"
                                        value={protocolNumber}
                                        onChange={e => setProtocolNumber(e.target.value)}
                                        placeholder="Ex: 2026-10293"
                                        style={{
                                            width: '100%', padding: '0.6rem 0.75rem 0.6rem 2rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                            outline: 'none', fontSize: '0.9rem', fontWeight: 600
                                        }}
                                    />
                                </div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Status</label>
                                <select
                                    value={status}
                                    onChange={e => setStatus(e.target.value)}
                                    style={{
                                        width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                        outline: 'none', fontSize: '0.9rem', fontWeight: 600, background: 'white'
                                    }}
                                >
                                    <option value="gerar">Gerar</option>
                                    <option value="em_tratativa">Em Tratativa</option>
                                    <option value="atrasado">Atrasado</option>
                                    <option value="concluida">Concluída</option>
                                </select>
                            </div>
                        </div>

                        {/* Prazo e Vencimento */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Prazo (Dias Úteis)</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={deadlineDays}
                                    onChange={e => setDeadlineDays(e.target.value)}
                                    placeholder="Dias úteis"
                                    style={{
                                        width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                        outline: 'none', fontSize: '0.9rem', fontWeight: 600
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Vencimento Calculado</label>
                                <div style={{
                                    padding: '0.6rem 0.75rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px',
                                    fontSize: '0.9rem', fontWeight: 700, color: dueDate ? '#ef4444' : '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem'
                                }}>
                                    <Calendar size={15} />
                                    {dueDate ? formatDateBR(dueDate) : (protocolNumber ? 'Inativo' : 'Inativo (Nº obrigatório)')}
                                </div>
                            </div>
                        </div>

                        {/* Entity Linking */}
                        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <LinkIcon size={14} /> Vincular Entidade
                            </h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Tipo de Entidade</label>
                                    <select
                                        value={linkedEntityType}
                                        onChange={e => setLinkedEntityType(e.target.value)}
                                        style={{
                                            width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                            outline: 'none', fontSize: '0.9rem', fontWeight: 600, background: 'white'
                                        }}
                                    >
                                        <option value="">Nenhuma</option>
                                        <option value="assinante">Assinante</option>
                                        <option value="unidade_consumidora">Unidade Consumidora</option>
                                        <option value="conta_energia">Conta de Energia (Concessionária)</option>
                                        <option value="fatura">Fatura (Assinante)</option>
                                        <option value="rateio_list">Lista de Rateio</option>
                                    </select>
                                </div>

                                {linkedEntityType && (
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Selecionar Registro</label>
                                        <SearchableSelect
                                            options={entityOptions}
                                            value={linkedEntityId}
                                            onChange={setLinkedEntityId}
                                            placeholder="Digite para buscar..."
                                            loading={loadingEntities}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    padding: '0.6rem 1.25rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                    background: 'white', color: '#475569', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                style={{
                                    padding: '0.6rem 1.5rem', border: 'none', borderRadius: '8px',
                                    background: primaryColor, color: 'white', fontWeight: 600, fontSize: '0.85rem',
                                    cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                                }}
                            >
                                <Save size={16} />
                                {saving ? 'Salvando...' : 'Salvar Protocolo'}
                            </button>
                        </div>
                    </form>

                    {/* Timeline & Sub-protocols Panel */}
                    {protocol?.id && (
                        <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto', background: '#f1f5f9' }}>
                            
                            {/* Subtasks Section */}
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <h4 style={{ margin: 0, fontSize: '0.82rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Sub-tarefas / Sub-protocolos
                                    </h4>
                                    <button
                                        type="button"
                                        onClick={() => setShowSubModal(true)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.2rem',
                                            background: primaryColor, color: 'white', border: 'none',
                                            borderRadius: '6px', padding: '0.3rem 0.6rem', fontSize: '0.75rem',
                                            fontWeight: 700, cursor: 'pointer'
                                        }}
                                    >
                                        <Plus size={13} /> Nova
                                    </button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {subProtocols.length === 0 ? (
                                        <div style={{ padding: '1rem', background: 'white', borderRadius: '8px', textAlign: 'center', fontSize: '0.8rem', color: '#94a3b8', border: '1px dashed #cbd5e1' }}>
                                            Nenhum sub-protocolo derivado.
                                        </div>
                                    ) : (
                                        subProtocols.map(sub => (
                                            <div key={sub.id} style={{
                                                background: 'white', borderRadius: '8px', padding: '0.6rem 0.8rem',
                                                border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                            }}>
                                                <div>
                                                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b' }}>{sub.title}</div>
                                                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                                        {sub.protocol_number ? `Nº ${sub.protocol_number} · ` : ''} Vence: {sub.due_date ? formatDateBR(sub.due_date) : '-'}
                                                    </div>
                                                </div>
                                                <span style={{
                                                    fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase',
                                                    padding: '0.15rem 0.4rem', borderRadius: '99px',
                                                    background: sub.status === 'concluida' ? '#dcfce7' : sub.status === 'em_tratativa' ? '#fef3c7' : '#eff6ff',
                                                    color: sub.status === 'concluida' ? '#166534' : sub.status === 'em_tratativa' ? '#b45309' : '#1d4ed8'
                                                }}>
                                                    {sub.status === 'em_tratativa' ? 'Em Tratativa' : sub.status === 'concluida' ? 'Concluída' : sub.status}
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* History Timeline */}
                            <div style={{ flex: 1, minHeight: '350px' }}>
                                <HistoryTimeline
                                    entityType="protocol"
                                    entityId={protocol.id}
                                    entityName={title}
                                    isInline={true}
                                    hideHeader={true}
                                    compact={true}
                                />
                            </div>

                        </div>
                    )}
                </div>
            </div>

            {/* Sub protocol creation modal overlay */}
            {showSubModal && (
                <ProtocolModal
                    parentProtocolId={protocol?.id}
                    protocol={{
                        linked_entity_type: linkedEntityType,
                        linked_entity_id: linkedEntityId,
                        title: `Subtarefa de: ${title}`
                    }}
                    onClose={() => setShowSubModal(false)}
                    onUpdated={() => {
                        fetchSubProtocols();
                        setShowSubModal(false);
                    }}
                />
            )}
        </div>
    );
}
