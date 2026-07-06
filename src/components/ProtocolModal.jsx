import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useUI } from '../contexts/UIContext';
import { useBranding } from '../contexts/BrandingContext';
import { X, Hash, Calendar, Layers, Link as LinkIcon, Plus, Save, Clock, ChevronDown, CheckCircle, RefreshCw, FileText, User, Zap, ExternalLink, Loader2, AlertCircle, Info, MessageSquare } from 'lucide-react';
import HistoryTimeline from './HistoryTimeline';
import SubscriberModal from './SubscriberModal';
import ConsumerUnitModal from './ConsumerUnitModal';
import InvoiceSummaryModal from './InvoiceSummaryModal';
import RateioListModal from './RateioListModal';
import PowerPlantModal from './PowerPlantModal';

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

    // Form fields & tree state
    const [currentProtocol, setCurrentProtocol] = useState(protocol);
    const [parentProtocol, setParentProtocol] = useState(null);
    const [treeSubProtocols, setTreeSubProtocols] = useState([]);
    const [initialSelectDone, setInitialSelectDone] = useState(false);

    const [title, setTitle] = useState(currentProtocol?.title || '');
    const [description, setDescription] = useState(currentProtocol?.description || '');
    const [protocolNumber, setProtocolNumber] = useState(currentProtocol?.protocol_number || '');
    const [status, setStatus] = useState(currentProtocol?.status || 'gerar');
    const [deadlineDays, setDeadlineDays] = useState(currentProtocol?.deadline_days || '');
    const [dueDate, setDueDate] = useState(currentProtocol?.due_date || null);
    
    // Entity linking
    const [linkedEntityType, setLinkedEntityType] = useState(currentProtocol?.linked_entity_type || '');
    const [linkedEntityId, setLinkedEntityId] = useState(currentProtocol?.linked_entity_id || '');
    const [entityOptions, setEntityOptions] = useState([]);
    const [loadingEntities, setLoadingEntities] = useState(false);

    const [showSubModal, setShowSubModal] = useState(false);

    // Entity details modals states
    const [loadingEntityDetail, setLoadingEntityDetail] = useState(false);
    const [activeSubscriber, setActiveSubscriber] = useState(null);
    const [activeConsumerUnit, setActiveConsumerUnit] = useState(null);
    const [activeInvoice, setActiveInvoice] = useState(null);
    const [activeInvoiceCU, setActiveInvoiceCU] = useState(null);
    const [activeRateio, setActiveRateio] = useState(null);
    const [activeUsina, setActiveUsina] = useState(null);
    const [activeTab, setActiveTab] = useState('tratativa');
    const [showReplicaJustification, setShowReplicaJustification] = useState(false);
    const [replicaJustification, setReplicaJustification] = useState('');
    const [historyRefresh, setHistoryRefresh] = useState(0);

    // Keep currentProtocol in sync with prop if it changes externally
    useEffect(() => {
        setCurrentProtocol(protocol);
        setInitialSelectDone(false);
    }, [protocol]);

    // Sync form inputs when active protocol changes
    useEffect(() => {
        if (currentProtocol) {
            setTitle(currentProtocol.title || '');
            setDescription(currentProtocol.description || '');
            setProtocolNumber(currentProtocol.protocol_number || '');
            
            // Check if overdue
            const isDelayed = currentProtocol.due_date && 
                              new Date(currentProtocol.due_date) < new Date() && 
                              currentProtocol.status !== 'concluida';
            setStatus(isDelayed ? 'atrasado' : (currentProtocol.status || 'gerar'));
            
            setDeadlineDays(currentProtocol.deadline_days || '');
            setDueDate(currentProtocol.due_date || null);
            setLinkedEntityType(currentProtocol.linked_entity_type || '');
            setLinkedEntityId(currentProtocol.linked_entity_id || '');
        } else {
            setTitle('');
            setDescription('');
            setProtocolNumber('');
            setStatus('gerar');
            setDeadlineDays('');
            setDueDate(null);
            setLinkedEntityType('');
            setLinkedEntityId('');
        }
    }, [currentProtocol]);

    const handleOpenEntityModal = async () => {
        if (!linkedEntityType || !linkedEntityId || linkedEntityId === 'undefined' || linkedEntityId === 'null') return;
        setLoadingEntityDetail(true);
        try {
            if (linkedEntityType === 'assinante') {
                const { data, error } = await supabase
                    .from('subscribers')
                    .select('*')
                    .eq('id', linkedEntityId)
                    .single();
                if (error) throw error;
                setActiveSubscriber(data);
            } else if (linkedEntityType === 'unidade_consumidora') {
                const { data, error } = await supabase
                    .from('consumer_units')
                    .select('*')
                    .eq('id', linkedEntityId)
                    .single();
                if (error) throw error;
                setActiveConsumerUnit(data);
            } else if (linkedEntityType === 'conta_energia' || linkedEntityType === 'fatura') {
                const { data: invoiceData, error: invError } = await supabase
                    .from('invoices')
                    .select('*')
                    .eq('id', linkedEntityId)
                    .single();
                if (invError) throw invError;
                
                let cuData = null;
                if (invoiceData?.consumer_unit_id && invoiceData.consumer_unit_id !== 'undefined' && invoiceData.consumer_unit_id !== 'null') {
                    const { data, error: cuError } = await supabase
                        .from('consumer_units')
                        .select('*')
                        .eq('id', invoiceData.consumer_unit_id)
                        .maybeSingle();
                    if (cuError) console.error('Error fetching invoice consumer unit:', cuError);
                    else cuData = data;
                }

                setActiveInvoice(invoiceData);
                setActiveInvoiceCU(cuData);
            } else if (linkedEntityType === 'rateio_list') {
                const { data, error } = await supabase
                    .from('rateio_lists')
                    .select('*')
                    .eq('id', linkedEntityId)
                    .single();
                if (error) throw error;
                setActiveRateio(data);
            } else if (linkedEntityType === 'usina') {
                const { data, error } = await supabase
                    .from('usinas')
                    .select('*')
                    .eq('id', linkedEntityId)
                    .single();
                if (error) throw error;
                setActiveUsina(data);
            }
        } catch (err) {
            console.error('Error fetching entity details:', err);
            showAlert('Erro ao carregar detalhes da entidade.', 'error');
        } finally {
            setLoadingEntityDetail(false);
        }
    };

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

    // Calculate due date automatically (only on manual user edits)
    useEffect(() => {
        const currentProtoNum = currentProtocol?.protocol_number || '';
        const currentDeadline = currentProtocol?.deadline_days === null || currentProtocol?.deadline_days === undefined 
            ? '' 
            : String(currentProtocol.deadline_days);

        if (protocolNumber === currentProtoNum && String(deadlineDays) === currentDeadline) {
            return;
        }

        if (protocolNumber && deadlineDays) {
            const days = Number(deadlineDays);
            if (!isNaN(days) && days >= 0) {
                const calculated = calculateBusinessDays(new Date(), days);
                setDueDate(calculated.toISOString());
                // Auto transition to "em_tratativa" when protocol number and deadline are filled
                setStatus('em_tratativa');
            }
        } else {
            setDueDate(null);
        }
    }, [protocolNumber, deadlineDays, currentProtocol]);

    // Load parent and sub-protocols tree
    const loadTreeData = async () => {
        const rootId = currentProtocol?.parent_protocol_id || currentProtocol?.id || parentProtocolId;
        if (!rootId) {
            setParentProtocol(null);
            setTreeSubProtocols([]);
            return;
        }

        try {
            // Fetch clean root parent from DB to make sure we don't have overridden values from list view
            const { data: rootParent, error: parentError } = await supabase
                .from('protocols')
                .select('*')
                .eq('id', rootId)
                .single();
            if (parentError) throw parentError;
            setParentProtocol(rootParent);

            if (rootParent?.id) {
                const { data: subs, error: subsError } = await supabase
                    .from('protocols')
                    .select('*')
                    .eq('parent_protocol_id', rootParent.id)
                    .order('created_at', { ascending: true });
                if (subsError) throw subsError;
                
                const subProtocolsList = subs || [];
                setTreeSubProtocols(subProtocolsList);

                // Auto-select the last open protocol/sub-protocol on first load (only if editing existing)
                if (!initialSelectDone) {
                    if (protocol?.id) {
                        const chain = [rootParent, ...subProtocolsList];
                        const openNodes = chain.filter(n => n.status !== 'concluida');
                        const target = openNodes.length > 0 ? openNodes[openNodes.length - 1] : chain[chain.length - 1];
                        if (target && target.id !== currentProtocol?.id) {
                            setCurrentProtocol(target);
                        }
                    }
                    setInitialSelectDone(true);
                }
            }
        } catch (err) {
            console.error('Error loading tree data:', err);
        }
    };

    useEffect(() => {
        loadTreeData();
    }, [currentProtocol, parentProtocolId]);

    // Listen to 'open-protocol' event inside the modal to navigate between protocols/sub-protocols
    useEffect(() => {
        const handleOpenProtocolInModal = async (e) => {
            const protoId = e.detail?.protocolId;
            if (!protoId) return;

            // Stop propagation to avoid global triggers if needed, but allow changing the local active card
            if (parentProtocol?.id === protoId) {
                setCurrentProtocol(parentProtocol);
                setActiveTab('tratativa');
                return;
            }

            const found = treeSubProtocols.find(p => p.id === protoId);
            if (found) {
                setCurrentProtocol(found);
                setActiveTab('tratativa');
                return;
            }

            if (currentProtocol?.id === protoId) {
                setActiveTab('tratativa');
                return;
            }

            // Fallback: Fetch protocol if it belongs to another tree but clicked from this modal's history
            try {
                const { data, error } = await supabase
                    .from('protocols')
                    .select('*')
                    .eq('id', protoId)
                    .single();
                if (data && !error) {
                    setCurrentProtocol(data);
                    setActiveTab('tratativa');
                }
            } catch (err) {
                console.error('Error opening protocol from timeline event:', err);
            }
        };

        window.addEventListener('open-protocol', handleOpenProtocolInModal);
        return () => window.removeEventListener('open-protocol', handleOpenProtocolInModal);
    }, [parentProtocol, treeSubProtocols, currentProtocol]);

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
                    .select('id, mes_referencia, valor_concessionaria, consumer_units(numero_uc, titular_conta, concessionaria)')
                    .not('valor_concessionaria', 'is', null)
                    .order('mes_referencia', { ascending: false }));
            } else if (linkedEntityType === 'fatura') {
                // Invoices that are subscriber bills
                ({ data, error } = await supabase
                    .from('invoices')
                    .select('id, mes_referencia, valor_a_pagar, consumer_units(numero_uc, titular_conta)')
                    .order('mes_referencia', { ascending: false }));
            } else if (linkedEntityType === 'rateio_list') {
                ({ data, error } = await supabase.from('rateio_lists').select('id, usina_name, created_at').order('created_at', { ascending: false }));
            } else if (linkedEntityType === 'usina') {
                ({ data, error } = await supabase.from('usinas').select('id, name').order('name'));
            }

            if (error) throw error;

            const mapped = (data || []).map(item => {
                if (linkedEntityType === 'assinante') {
                    return { id: item.id, label: item.name };
                } else if (linkedEntityType === 'unidade_consumidora') {
                    return { id: item.id, label: `${item.titular_conta} (UC: ${item.numero_uc})` };
                } else if (linkedEntityType === 'conta_energia') {
                    const conName = item.consumer_units?.concessionaria || 'Concessionária';
                    const ucNum = item.consumer_units?.numero_uc || 'Sem UC';
                    const titular = item.consumer_units?.titular_conta || 'Sem Assinante';
                    let refMonth = '';
                    if (item.mes_referencia) {
                        const parts = item.mes_referencia.substring(0, 7).split('-');
                        if (parts.length === 2) {
                            refMonth = `${parts[1]}-${parts[0]}`;
                        } else {
                            refMonth = item.mes_referencia.substring(0, 7);
                        }
                    }
                    return { id: item.id, label: `UC ${ucNum} - Ref. ${refMonth} - ${titular} - ${conName}` };
                } else if (linkedEntityType === 'fatura') {
                    const ucInfo = item.consumer_units ? ` (UC: ${item.consumer_units.numero_uc} - ${item.consumer_units.titular_conta})` : '';
                    return { id: item.id, label: `Fatura Ref: ${item.mes_referencia ? item.mes_referencia.substring(0,7) : ''}${ucInfo} - Valor: R$ ${Number(item.valor_a_pagar).toFixed(2)}` };
                } else if (linkedEntityType === 'rateio_list') {
                    return { id: item.id, label: `${item.usina_name} - Criada: ${formatDateBR(item.created_at)}` };
                } else if (linkedEntityType === 'usina') {
                    return { id: item.id, label: item.name };
                }
                return { id: item.id, label: item.id };
            });

            setEntityOptions(mapped);
            // Default to empty or preserve existing if editing
            if (currentProtocol?.linked_entity_type === linkedEntityType && currentProtocol?.linked_entity_id) {
                setLinkedEntityId(currentProtocol.linked_entity_id);
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
                parent_protocol_id: parentProtocolId || currentProtocol?.parent_protocol_id || null,
                updated_at: now
            };

            let returnedProtocol = null;

            if (currentProtocol?.id) {
                // Update
                const { data, error } = await supabase
                    .from('protocols')
                    .update(payload)
                    .eq('id', currentProtocol.id)
                    .select()
                    .single();
                if (error) throw error;
                returnedProtocol = data;

                if (status === 'replica' && replicaJustification.trim()) {
                    await supabase
                        .from('crm_history')
                        .insert({
                            entity_type: 'protocol',
                            entity_id: returnedProtocol.id,
                            content: `Motivo da Réplica:\n${replicaJustification.trim()}`,
                            created_by: user?.id,
                            metadata: {
                                protocol_id: returnedProtocol.id,
                                message: `Motivo da Réplica: ${replicaJustification.trim()}`
                            }
                        });
                    setReplicaJustification('');
                }

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

                if (status === 'replica' && replicaJustification.trim()) {
                    await supabase
                        .from('crm_history')
                        .insert({
                            entity_type: 'protocol',
                            entity_id: returnedProtocol.id,
                            content: `Motivo da Réplica:\n${replicaJustification.trim()}`,
                            created_by: user?.id,
                            metadata: {
                                protocol_id: returnedProtocol.id,
                                message: `Motivo da Réplica: ${replicaJustification.trim()}`
                            }
                        });
                    setReplicaJustification('');
                }

                // LOG TO CRM HISTORY OF THE ENTITY
                if (linkedEntityType && linkedEntityId) {
                    let crmEntityType = '';
                    if (linkedEntityType === 'assinante') crmEntityType = 'subscriber';
                    else if (linkedEntityType === 'unidade_consumidora') crmEntityType = 'uc';
                    else if (linkedEntityType === 'conta_energia' || linkedEntityType === 'fatura') crmEntityType = 'invoice';
                    else if (linkedEntityType === 'rateio_list') crmEntityType = 'rateio_list';
                    else if (linkedEntityType === 'usina') crmEntityType = 'usina';

                    if (crmEntityType) {
                        const contentLog = `Novo protocolo criado: "${title}" ${protocolNumber ? `(Nº: ${protocolNumber})` : ''}`;
                        await supabase.from('crm_history').insert({
                            entity_type: crmEntityType,
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

            // Automacao: Se o status for tratativa e estiver vinculado a uma conta de energia, muda o status da conta para contestada
            if (status === 'tratativa' && linkedEntityType === 'conta_energia' && linkedEntityId) {
                try {
                    await supabase
                        .from('invoices')
                        .update({ energy_bill_status: 'contestada' })
                        .eq('id', linkedEntityId);
                } catch (updateErr) {
                    console.error('Erro ao atualizar status da conta de energia para contestada:', updateErr);
                }
            }

            if (onUpdated) onUpdated(returnedProtocol);
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
                                {currentProtocol?.id ? (currentProtocol.parent_protocol_id ? `Editar Sub-protocolo` : `Editar Protocolo`) : parentProtocolId ? `Novo Sub-protocolo / Tarefa` : `Criar Novo Protocolo`}
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

                {/* Pipeline de Status no topo */}
                <div style={{
                    padding: '1.25rem 2rem',
                    background: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: primaryColor }}></div>
                            Status do Protocolo
                        </label>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>Clique para alterar o status</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                        {[
                            { id: 'gerar', label: 'Gerar', icon: Plus, color: '#475569', bg: '#f1f5f9' },
                            { id: 'em_tratativa', label: 'Em Tratativa', icon: Clock, color: '#ca8a04', bg: '#fef9c3' },
                            { id: 'replica', label: 'Réplica', icon: RefreshCw, color: '#6d28d9', bg: '#f5f3ff' },
                            { id: 'atrasado', label: 'Atrasado', icon: AlertCircle, color: '#dc2626', bg: '#fee2e2' },
                            { id: 'concluida', label: 'Concluída', icon: CheckCircle, color: '#166534', bg: '#dcfce7' }
                        ].map((s) => {
                            const isActive = status === s.id;
                            const Icon = s.icon;
                            return (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => {
                                        if (s.id === 'replica') {
                                            setShowReplicaJustification(true);
                                        } else {
                                            setStatus(s.id);
                                        }
                                    }}
                                    style={{
                                        flex: '1 1 auto',
                                        minWidth: '120px',
                                        padding: '0.6rem 0.8rem',
                                        borderRadius: '10px',
                                        border: '1px solid',
                                        borderColor: isActive ? s.color : '#e2e8f0',
                                        background: isActive ? s.bg : 'white',
                                        color: isActive ? s.color : '#64748b',
                                        fontWeight: isActive ? 700 : 500,
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.5rem',
                                        boxShadow: isActive ? `0 4px 6px -1px ${s.color}20` : 'none',
                                        transform: isActive ? 'translateY(-1px)' : 'none'
                                    }}
                                >
                                    <Icon size={14} strokeWidth={isActive ? 2.5 : 2} />
                                    {s.label}
                                </button>
                            );
                        })}
                    </div>
                    {status === 'replica' && replicaJustification && (
                        <div style={{
                            marginTop: '0.5rem',
                            padding: '0.6rem 1rem',
                            background: '#f5f3ff',
                            border: '1px dashed #6d28d9',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            color: '#6d28d9',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                Motivo: "{replicaJustification}"
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowReplicaJustification(true)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#6d28d9',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    textDecoration: 'underline',
                                    padding: 0
                                }}
                            >
                                Editar Motivo
                            </button>
                        </div>
                    )}
                </div>

                {/* Tabs Navigation */}
                <div style={{
                    display: 'flex',
                    borderBottom: '1px solid #e2e8f0',
                    background: 'white',
                    padding: '0 1.25rem',
                    flexWrap: 'nowrap',
                    overflowX: 'auto',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    width: '100%',
                    gap: '0.25rem'
                }}>
                    {[
                        { id: 'tratativa', label: 'Tratativa', icon: <Clock size={18} /> },
                        ...((currentProtocol?.id) ? [{ id: 'historico', label: 'Histórico', icon: <MessageSquare size={18} /> }] : [])
                    ].map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.6rem',
                                padding: '1rem 1.25rem',
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: activeTab === tab.id ? '700' : '500',
                                color: activeTab === tab.id ? primaryColor : '#64748b',
                                borderBottom: activeTab === tab.id ? `3px solid ${primaryColor}` : '3px solid transparent',
                                transition: 'all 0.2s ease-in-out',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                outline: 'none',
                                opacity: activeTab === tab.id ? 1 : 0.8
                            }}
                            onMouseOver={e => {
                                if (activeTab !== tab.id) {
                                    e.currentTarget.style.color = primaryColor;
                                    e.currentTarget.style.opacity = '1';
                                }
                            }}
                            onMouseOut={e => {
                                if (activeTab !== tab.id) {
                                    e.currentTarget.style.color = '#64748b';
                                    e.currentTarget.style.opacity = '0.8';
                                }
                            }}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    {/* Form Panel */}
                    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                        <div style={{ padding: '2rem', minHeight: '350px' }}>
                            {activeTab === 'tratativa' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', animation: 'fadeIn 0.2s ease-in-out' }}>
                                    <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                                    
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
                                                width: '100%', padding: '0.65rem 0.85rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                                outline: 'none', fontSize: '0.9rem', fontWeight: 600, transition: 'all 0.2s'
                                            }}
                                            onFocus={e => e.target.style.borderColor = primaryColor}
                                            onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                                        />
                                    </div>

                                    {/* Fallback fields for new top-level protocol (when parentProtocol is null) */}
                                    {!parentProtocol && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem', padding: '1.5rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                            <h4 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Detalhes do Novo Protocolo</h4>
                                            
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                                                    Nº do Protocolo
                                                </label>
                                                <input
                                                    type="text"
                                                    value={protocolNumber}
                                                    onChange={e => setProtocolNumber(e.target.value)}
                                                    placeholder="Ex: 8058025076"
                                                    style={{
                                                        width: '100%', padding: '0.65rem 0.85rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                                        outline: 'none', fontSize: '0.9rem', fontWeight: 600, background: 'white'
                                                    }}
                                                />
                                            </div>
                                            
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                                                        Prazo (Dias Úteis)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={deadlineDays}
                                                        onChange={e => setDeadlineDays(e.target.value)}
                                                        placeholder="Dias"
                                                        style={{
                                                            width: '100%', padding: '0.65rem 0.85rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                                            outline: 'none', fontSize: '0.9rem', fontWeight: 600, background: 'white'
                                                        }}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                                                        Vencimento
                                                    </label>
                                                    <div style={{
                                                        padding: '0.65rem 0.85rem',
                                                        background: '#f1f5f9',
                                                        border: '1px solid #cbd5e1',
                                                        borderRadius: '8px',
                                                        fontSize: '0.9rem',
                                                        fontWeight: 700,
                                                        color: '#dc2626',
                                                        height: '42px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.4rem'
                                                    }}>
                                                        <Calendar size={16} />
                                                        {dueDate ? formatDateBR(dueDate) : 'Inativo (Preencha Nº e Prazo)'}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                                                    Descrição da Tratativa
                                                </label>
                                                <textarea
                                                    value={description}
                                                    onChange={e => setDescription(e.target.value)}
                                                    placeholder="Insira detalhes da tratativa..."
                                                    style={{
                                                        width: '100%', padding: '0.65rem 0.85rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                                        outline: 'none', fontSize: '0.9rem', color: '#1e293b', background: 'white',
                                                        minHeight: '80px', resize: 'vertical'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Sub-protocols Organogram Tree & Fields */}
                                    {parentProtocol && (
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Organograma de Sub-protocolos</label>
                                            <div style={{
                                                padding: '1.5rem',
                                                background: '#f8fafc',
                                                borderRadius: '12px',
                                                border: '1px solid #e2e8f0',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                position: 'relative'
                                            }}>
                                                {/* Parent Node Card */}
                                                <div 
                                                    onClick={() => setCurrentProtocol(parentProtocol)}
                                                    style={{
                                                        background: currentProtocol?.id === parentProtocol.id ? primaryColor : '#eff6ff',
                                                        color: currentProtocol?.id === parentProtocol.id ? 'white' : '#1e3a8a',
                                                        border: currentProtocol?.id === parentProtocol.id ? `2px solid ${primaryColor}` : '1px solid #bfdbfe',
                                                        borderRadius: '12px',
                                                        padding: '0.85rem 1.25rem',
                                                        minWidth: '280px',
                                                        cursor: 'pointer',
                                                        fontWeight: 700,
                                                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
                                                        transition: 'all 0.2s',
                                                        zIndex: 2,
                                                        position: 'relative'
                                                    }}
                                                    onMouseEnter={e => {
                                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                                        e.currentTarget.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.1)';
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.transform = 'none';
                                                        e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.05)';
                                                    }}
                                                >
                                                    <div style={{ fontSize: '0.7rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>
                                                        Protocolo Pai {parentProtocol.protocol_number ? `(${parentProtocol.protocol_number})` : ''}
                                                    </div>
                                                    <div style={{ marginTop: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', fontSize: '0.9rem' }}>
                                                        {parentProtocol.title}
                                                    </div>

                                                    {/* Fields inside active Parent Card */}
                                                    {currentProtocol?.id === parentProtocol.id ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
                                                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '0.5rem' }}>
                                                                <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                    Nº do Protocolo
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={protocolNumber}
                                                                    onChange={e => setProtocolNumber(e.target.value)}
                                                                    placeholder="Ex: 8058025076"
                                                                    style={{
                                                                        width: '100%',
                                                                        padding: '0.3rem 0.5rem',
                                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                                        borderRadius: '6px',
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: 600,
                                                                        color: 'white',
                                                                        background: 'rgba(255,255,255,0.1)',
                                                                        outline: 'none'
                                                                    }}
                                                                />
                                                            </div>
                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                                                <div>
                                                                    <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                        Prazo (Dias)
                                                                    </label>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        value={deadlineDays}
                                                                        onChange={e => setDeadlineDays(e.target.value)}
                                                                        placeholder="Dias"
                                                                        style={{
                                                                            width: '100%',
                                                                            padding: '0.3rem 0.5rem',
                                                                            border: '1px solid rgba(255,255,255,0.2)',
                                                                            borderRadius: '6px',
                                                                            fontSize: '0.75rem',
                                                                            fontWeight: 600,
                                                                            color: 'white',
                                                                            background: 'rgba(255,255,255,0.1)',
                                                                            outline: 'none'
                                                                        }}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                        Vencimento
                                                                    </label>
                                                                    <div style={{
                                                                        padding: '0.3rem 0.5rem',
                                                                        background: 'rgba(255,255,255,0.05)',
                                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                                        borderRadius: '6px',
                                                                        fontSize: '0.72rem',
                                                                        fontWeight: 700,
                                                                        color: '#fca5a5',
                                                                        height: '25px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.25rem'
                                                                    }}>
                                                                        <Calendar size={11} />
                                                                        {dueDate ? formatDateBR(dueDate) : 'Inativo'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                    Descrição da Tratativa
                                                                </label>
                                                                <textarea
                                                                    value={description}
                                                                    onChange={e => setDescription(e.target.value)}
                                                                    placeholder="Insira detalhes da tratativa..."
                                                                    style={{
                                                                        width: '100%',
                                                                        padding: '0.35rem 0.5rem',
                                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                                        borderRadius: '6px',
                                                                        fontSize: '0.75rem',
                                                                        color: 'white',
                                                                        background: 'rgba(255,255,255,0.1)',
                                                                        outline: 'none',
                                                                        minHeight: '60px',
                                                                        resize: 'vertical'
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '0.5rem', borderTop: '1px solid #bfdbfe', paddingTop: '0.5rem' }}>
                                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem', color: '#1e3a8a', fontWeight: 600 }}>
                                                                    <Hash size={11} />
                                                                    {parentProtocol.protocol_number || 'Sem número'}
                                                                </span>
                                                                {parentProtocol.deadline_days && (
                                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem', color: '#1e3a8a', fontWeight: 600 }}>
                                                                        <Clock size={11} />
                                                                        {parentProtocol.deadline_days}d
                                                                    </span>
                                                                )}
                                                                {parentProtocol.due_date && (
                                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem', color: '#1e3a8a', fontWeight: 600 }}>
                                                                        <Calendar size={11} />
                                                                        {formatDateBR(parentProtocol.due_date)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {parentProtocol.description && (
                                                                <div style={{ fontSize: '0.75rem', color: '#1e3a8a', opacity: 0.9, fontStyle: 'italic', marginTop: '0.35rem', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                                    {parentProtocol.description}
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </div>

                                                {(treeSubProtocols.length > 0 || !currentProtocol?.id) && (
                                                    <>
                                                        {/* Spacer with vertical stem line below parent */}
                                                        <div style={{ position: 'relative', height: '1.5rem', width: '100%' }}>
                                                            <div style={{
                                                                position: 'absolute',
                                                                left: '50%',
                                                                top: 0,
                                                                bottom: 0,
                                                                width: '2px',
                                                                backgroundColor: '#94a3b8'
                                                            }} />
                                                        </div>

                                                        {/* Children container list */}
                                                        <div style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '1rem',
                                                            width: '100%',
                                                            position: 'relative'
                                                        }}>
                                                            {treeSubProtocols.map((sub, index) => {
                                                                const isSelected = currentProtocol?.id === sub.id;
                                                                const isLast = index === treeSubProtocols.length - 1 && currentProtocol?.id;
                                                                
                                                                // Precompute dynamic overdue status to prevent JSX syntax issues
                                                                const isSubDelayed = sub.due_date && 
                                                                                    new Date(sub.due_date) < new Date() && 
                                                                                    sub.status !== 'concluida';
                                                                const displaySubStatus = isSubDelayed ? 'atrasado' : sub.status;

                                                                return (
                                                                    <div 
                                                                        key={sub.id}
                                                                        style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            position: 'relative',
                                                                            width: '100%',
                                                                            paddingLeft: 'calc(50% + 2rem)',
                                                                            minHeight: '3.5rem'
                                                                        }}
                                                                    >
                                                                        {/* Top-half stem line */}
                                                                        <div style={{
                                                                            position: 'absolute',
                                                                            left: '50%',
                                                                            top: 0,
                                                                            bottom: '50%',
                                                                            width: '2px',
                                                                            backgroundColor: '#94a3b8'
                                                                        }} />

                                                                        {/* Bottom-half stem line (if not last or if new sub protocol is appended below) */}
                                                                        {(!isLast || !currentProtocol?.id) && (
                                                                            <div style={{
                                                                                position: 'absolute',
                                                                                left: '50%',
                                                                                top: '50%',
                                                                                bottom: 0,
                                                                                width: '2px',
                                                                                backgroundColor: '#94a3b8'
                                                                            }} />
                                                                        )}

                                                                        {/* Horizontal branch line */}
                                                                        <div style={{
                                                                            position: 'absolute',
                                                                            left: '50%',
                                                                            width: '2rem',
                                                                            height: '1.5rem',
                                                                            top: 'calc(50% - 1.5rem)',
                                                                            borderBottom: '2px solid #94a3b8',
                                                                            borderLeft: '2px solid #94a3b8',
                                                                            borderBottomLeftRadius: '8px',
                                                                            pointerEvents: 'none'
                                                                        }} />

                                                                        {/* Sub-protocol Card */}
                                                                        <div 
                                                                            onClick={() => setCurrentProtocol(sub)}
                                                                            style={{
                                                                                background: isSelected ? primaryColor : 'white',
                                                                                color: isSelected ? 'white' : '#334155',
                                                                                border: isSelected ? `2px solid ${primaryColor}` : '1px solid #cbd5e1',
                                                                                borderRadius: '8px',
                                                                                padding: '0.85rem 1rem',
                                                                                minWidth: '280px',
                                                                                maxWidth: '320px',
                                                                                cursor: 'pointer',
                                                                                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                                                                                transition: 'all 0.2s',
                                                                                zIndex: 1
                                                                            }}
                                                                            onMouseEnter={e => {
                                                                                e.currentTarget.style.transform = 'translateY(-1px)';
                                                                                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)';
                                                                            }}
                                                                            onMouseLeave={e => {
                                                                                e.currentTarget.style.transform = 'none';
                                                                                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.05)';
                                                                            }}
                                                                        >
                                                                            <div style={{ fontSize: '0.65rem', color: isSelected ? 'rgba(255,255,255,0.8)' : '#b91c1c', fontWeight: 800, textTransform: 'uppercase' }}>
                                                                                {sub.protocol_number ? `Sub Protocolo (${sub.protocol_number})` : 'Sub Protocolo'}
                                                                            </div>
                                                                            <div style={{ fontSize: '0.8rem', fontWeight: 700, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                                {sub.title}
                                                                            </div>

                                                                            {/* Fields inside active Sub-protocol Card */}
                                                                            {isSelected ? (
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
                                                                                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '0.5rem' }}>
                                                                                        <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                                            Nº do Protocolo
                                                                                        </label>
                                                                                        <input
                                                                                            type="text"
                                                                                            value={protocolNumber}
                                                                                            onChange={e => setProtocolNumber(e.target.value)}
                                                                                            placeholder="Ex: 8058025076"
                                                                                            style={{
                                                                                                width: '100%',
                                                                                                padding: '0.3rem 0.5rem',
                                                                                                border: '1px solid rgba(255,255,255,0.2)',
                                                                                                borderRadius: '6px',
                                                                                                fontSize: '0.75rem',
                                                                                                fontWeight: 600,
                                                                                                color: 'white',
                                                                                                background: 'rgba(255,255,255,0.1)',
                                                                                                outline: 'none'
                                                                                            }}
                                                                                        />
                                                                                    </div>
                                                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                                                                        <div>
                                                                                            <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                                                Prazo (Dias)
                                                                                            </label>
                                                                                            <input
                                                                                                type="number"
                                                                                                min="0"
                                                                                                value={deadlineDays}
                                                                                                onChange={e => setDeadlineDays(e.target.value)}
                                                                                                placeholder="Dias"
                                                                                                style={{
                                                                                                    width: '100%',
                                                                                                    padding: '0.3rem 0.5rem',
                                                                                                    border: '1px solid rgba(255,255,255,0.2)',
                                                                                                    borderRadius: '6px',
                                                                                                    fontSize: '0.75rem',
                                                                                                    fontWeight: 600,
                                                                                                    color: 'white',
                                                                                                    background: 'rgba(255,255,255,0.1)',
                                                                                                    outline: 'none'
                                                                                                }}
                                                                                            />
                                                                                        </div>
                                                                                        <div>
                                                                                            <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                                                Vencimento
                                                                                            </label>
                                                                                            <div style={{
                                                                                                padding: '0.3rem 0.5rem',
                                                                                                background: 'rgba(255,255,255,0.05)',
                                                                                                border: '1px solid rgba(255,255,255,0.2)',
                                                                                                borderRadius: '6px',
                                                                                                fontSize: '0.72rem',
                                                                                                fontWeight: 700,
                                                                                                color: '#fca5a5',
                                                                                                height: '25px',
                                                                                                display: 'flex',
                                                                                                alignItems: 'center',
                                                                                                gap: '0.25rem'
                                                                                            }}>
                                                                                                <Calendar size={11} />
                                                                                                {dueDate ? formatDateBR(dueDate) : 'Inativo'}
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                                            Descrição da Tratativa
                                                                                        </label>
                                                                                        <textarea
                                                                                            value={description}
                                                                                            onChange={e => setDescription(e.target.value)}
                                                                                            placeholder="Insira detalhes da tratativa..."
                                                                                            style={{
                                                                                                width: '100%',
                                                                                                padding: '0.35rem 0.5rem',
                                                                                                border: '1px solid rgba(255,255,255,0.2)',
                                                                                                borderRadius: '6px',
                                                                                                fontSize: '0.75rem',
                                                                                                color: 'white',
                                                                                                background: 'rgba(255,255,255,0.1)',
                                                                                                outline: 'none',
                                                                                                minHeight: '60px',
                                                                                                resize: 'vertical'
                                                                                            }}
                                                                                        />
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem', fontSize: '0.65rem' }}>
                                                                                        <span style={{
                                                                                            fontWeight: 700,
                                                                                            padding: '0.1rem 0.35rem',
                                                                                            borderRadius: '99px',
                                                                                            background: 'rgba(255,255,255,0.2)',
                                                                                            color: 'white'
                                                                                        }}>
                                                                                            {status === 'em_tratativa' ? 'Em Tratativa' : status === 'replica' ? 'Réplica' : status === 'concluida' ? 'Concluída' : status === 'atrasado' ? 'Atrasado' : status}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem' }}>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem' }}>
                                                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: '#64748b', fontWeight: 600 }}>
                                                                                            <Hash size={11} />
                                                                                            {sub.protocol_number || 'Sem número'}
                                                                                        </span>
                                                                                        <span style={{
                                                                                            fontWeight: 700,
                                                                                            padding: '0.1rem 0.35rem',
                                                                                            borderRadius: '99px',
                                                                                            background: displaySubStatus === 'concluida' ? '#dcfce7' : displaySubStatus === 'atrasado' ? '#fee2e2' : displaySubStatus === 'em_tratativa' ? '#fef3c7' : '#eff6ff',
                                                                                            color: displaySubStatus === 'concluida' ? '#166534' : displaySubStatus === 'atrasado' ? '#991b1b' : displaySubStatus === 'em_tratativa' ? '#b45309' : '#1d4ed8'
                                                                                        }}>
                                                                                            {displaySubStatus === 'em_tratativa' ? 'Em Tratativa' : displaySubStatus === 'replica' ? 'Réplica' : displaySubStatus === 'concluida' ? 'Concluída' : displaySubStatus === 'atrasado' ? 'Atrasado' : displaySubStatus}
                                                                                        </span>
                                                                                    </div>
                                                                                    {(sub.deadline_days || sub.due_date) && (
                                                                                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
                                                                                            {sub.deadline_days && (
                                                                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                                                                                    <Clock size={11} />
                                                                                                    {sub.deadline_days}d
                                                                                                </span>
                                                                                            )}
                                                                                            {sub.due_date && (
                                                                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                                                                                    <Calendar size={11} />
                                                                                                    {formatDateBR(sub.due_date)}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                    )}
                                                                                    {sub.description && (
                                                                                        <div style={{ fontSize: '0.75rem', color: '#64748b', opacity: 0.9, fontStyle: 'italic', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                                                            {sub.description}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}

                                                            {/* Render a draft card for the new sub-protocol if we are creating it */}
                                                            {!currentProtocol?.id && (
                                                                <div 
                                                                    style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        position: 'relative',
                                                                        width: '100%',
                                                                        paddingLeft: 'calc(50% + 2rem)',
                                                                        minHeight: '3.5rem'
                                                                    }}
                                                                >
                                                                    {/* Top-half stem line */}
                                                                    <div style={{
                                                                        position: 'absolute',
                                                                        left: '50%',
                                                                        top: 0,
                                                                        bottom: '50%',
                                                                        width: '2px',
                                                                        backgroundColor: '#94a3b8'
                                                                    }} />

                                                                    {/* Horizontal branch line */}
                                                                    <div style={{
                                                                        position: 'absolute',
                                                                        left: '50%',
                                                                        width: '2rem',
                                                                        height: '1.5rem',
                                                                        top: 'calc(50% - 1.5rem)',
                                                                        borderBottom: '2px solid #94a3b8',
                                                                        borderLeft: '2px solid #94a3b8',
                                                                        borderBottomLeftRadius: '8px',
                                                                        pointerEvents: 'none'
                                                                    }} />

                                                                    {/* Sub-protocol Card (Active / Editing) */}
                                                                    <div 
                                                                        style={{
                                                                            background: primaryColor,
                                                                            color: 'white',
                                                                            border: `2px solid ${primaryColor}`,
                                                                            borderRadius: '8px',
                                                                            padding: '0.85rem 1rem',
                                                                            minWidth: '280px',
                                                                            maxWidth: '320px',
                                                                            cursor: 'default',
                                                                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                                                                            zIndex: 1
                                                                        }}
                                                                    >
                                                                        <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.8)', fontWeight: 800, textTransform: 'uppercase' }}>
                                                                            Novo Sub Protocolo (Rascunho)
                                                                        </div>
                                                                        <div style={{ fontSize: '0.8rem', fontWeight: 700, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {title || 'Título provisório'}
                                                                        </div>

                                                                        {/* Fields inside active New Sub-protocol Card */}
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
                                                                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '0.5rem' }}>
                                                                                <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                                    Nº do Protocolo
                                                                                </label>
                                                                                <input
                                                                                    type="text"
                                                                                    value={protocolNumber}
                                                                                    onChange={e => setProtocolNumber(e.target.value)}
                                                                                    placeholder="Ex: 8058025076"
                                                                                    style={{
                                                                                        width: '100%',
                                                                                        padding: '0.3rem 0.5rem',
                                                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                                                        borderRadius: '6px',
                                                                                        fontSize: '0.75rem',
                                                                                        fontWeight: 600,
                                                                                        color: 'white',
                                                                                        background: 'rgba(255,255,255,0.1)',
                                                                                        outline: 'none'
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                                                                <div>
                                                                                    <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                                        Prazo (Dias)
                                                                                    </label>
                                                                                    <input
                                                                                        type="number"
                                                                                        min="0"
                                                                                        value={deadlineDays}
                                                                                        onChange={e => setDeadlineDays(e.target.value)}
                                                                                        placeholder="Dias"
                                                                                        style={{
                                                                                            width: '100%',
                                                                                            padding: '0.3rem 0.5rem',
                                                                                            border: '1px solid rgba(255,255,255,0.2)',
                                                                                            borderRadius: '6px',
                                                                                            fontSize: '0.75rem',
                                                                                            fontWeight: 600,
                                                                                            color: 'white',
                                                                                            background: 'rgba(255,255,255,0.1)',
                                                                                            outline: 'none'
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                                <div>
                                                                                    <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                                        Vencimento
                                                                                    </label>
                                                                                    <div style={{
                                                                                        padding: '0.3rem 0.5rem',
                                                                                        background: 'rgba(255,255,255,0.05)',
                                                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                                                        borderRadius: '6px',
                                                                                        fontSize: '0.72rem',
                                                                                        fontWeight: 700,
                                                                                        color: '#fca5a5',
                                                                                        height: '25px',
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        gap: '0.25rem'
                                                                                    }}>
                                                                                        <Calendar size={11} />
                                                                                        {dueDate ? formatDateBR(dueDate) : 'Inativo'}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                            <div>
                                                                                <label style={{ display: 'block', fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                                                                    Descrição da Tratativa
                                                                                </label>
                                                                                <textarea
                                                                                    value={description}
                                                                                    onChange={e => setDescription(e.target.value)}
                                                                                    placeholder="Insira detalhes da tratativa..."
                                                                                    style={{
                                                                                        width: '100%',
                                                                                        padding: '0.35rem 0.5rem',
                                                                                        border: '1px solid rgba(255,255,255,0.2)',
                                                                                        borderRadius: '6px',
                                                                                        fontSize: '0.75rem',
                                                                                        color: 'white',
                                                                                        background: 'rgba(255,255,255,0.1)',
                                                                                        outline: 'none',
                                                                                        minHeight: '60px',
                                                                                        resize: 'vertical'
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </>
                                                )}

                                                {/* Button to add sub-protocol directly inside the organogram */}
                                                <button
                                                    type="button"
                                                    onClick={() => setShowSubModal(true)}
                                                    style={{
                                                        marginTop: '1.5rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.3rem',
                                                        background: 'white',
                                                        color: primaryColor,
                                                        border: `1px dashed ${primaryColor}`,
                                                        borderRadius: '8px',
                                                        padding: '0.4rem 0.8rem',
                                                        fontSize: '0.78rem',
                                                        fontWeight: 700,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s',
                                                        zIndex: 2
                                                    }}
                                                    onMouseEnter={e => {
                                                        e.currentTarget.style.backgroundColor = primaryColor + '10';
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.backgroundColor = 'white';
                                                    }}
                                                >
                                                    <Plus size={14} /> Novo Sub-protocolo
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Vincular Entidade Section */}
                                    <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <LinkIcon size={14} /> Vincular Entidade
                                        </h4>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Tipo de Entidade</label>
                                            <select
                                                value={linkedEntityType}
                                                onChange={e => setLinkedEntityType(e.target.value)}
                                                style={{
                                                    width: '100%', padding: '0.65rem 0.85rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                                    outline: 'none', fontSize: '0.9rem', fontWeight: 600, background: 'white'
                                                }}
                                            >
                                                <option value="">Nenhuma</option>
                                                <option value="assinante">Assinante</option>
                                                <option value="unidade_consumidora">Unidade Consumidora</option>
                                                <option value="conta_energia">Conta de Energia (Concessionária)</option>
                                                <option value="fatura">Fatura (Assinante)</option>
                                                <option value="rateio_list">Lista de Rateio</option>
                                                <option value="usina">Usina</option>
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

                                        {linkedEntityType && linkedEntityId && linkedEntityId !== 'undefined' && linkedEntityId !== 'null' && (
                                            <div style={{ marginTop: '0.5rem' }}>
                                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                                    Visualizar Entidade Vinculada
                                                </label>
                                                <div
                                                    onClick={handleOpenEntityModal}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        padding: '0.85rem 1.1rem',
                                                        backgroundColor: 'white',
                                                        border: '1px solid #cbd5e1',
                                                        borderRadius: '10px',
                                                        cursor: loadingEntityDetail ? 'wait' : 'pointer',
                                                        transition: 'all 0.2s',
                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                                                    }}
                                                    onMouseEnter={e => {
                                                        e.currentTarget.style.borderColor = primaryColor;
                                                        e.currentTarget.style.backgroundColor = '#f8fafc';
                                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                                        e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.05)';
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.borderColor = '#cbd5e1';
                                                        e.currentTarget.style.backgroundColor = 'white';
                                                        e.currentTarget.style.transform = 'none';
                                                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)';
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                                                        <div style={{
                                                            padding: '0.5rem',
                                                            background: primaryColor + '10',
                                                            borderRadius: '8px',
                                                            color: primaryColor,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            flexShrink: 0
                                                        }}>
                                                            {linkedEntityType === 'assinante' && <User size={18} />}
                                                            {linkedEntityType === 'unidade_consumidora' && <Zap size={18} />}
                                                            {(linkedEntityType === 'conta_energia' || linkedEntityType === 'fatura') && <FileText size={18} />}
                                                            {linkedEntityType === 'rateio_list' && <Layers size={18} />}
                                                            {linkedEntityType === 'usina' && <Zap size={18} />}
                                                        </div>
                                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b' }}>
                                                                {entityOptions.find(opt => opt.id === linkedEntityId)?.label || 'Carregando...'}
                                                                {linkedEntityId && linkedEntityType === 'usina' && entityOptions.length === 0 && 'Carregando usina...'}
                                                            </div>
                                                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>
                                                                {linkedEntityType === 'assinante' && 'Assinante'}
                                                                {linkedEntityType === 'unidade_consumidora' && 'Unidade Consumidora'}
                                                                {linkedEntityType === 'conta_energia' && 'Conta de Energia (Concessionária)'}
                                                                {linkedEntityType === 'fatura' && 'Fatura (Assinante)'}
                                                                {linkedEntityType === 'rateio_list' && 'Lista de Rateio'}
                                                                {linkedEntityType === 'usina' && 'Usina'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: '10px' }}>
                                                        {loadingEntityDetail ? (
                                                            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                                        ) : (
                                                            <ExternalLink size={16} />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'historico' && currentProtocol?.id && (() => {
                                const allProtocolIds = [];
                                if (parentProtocol?.id) {
                                    allProtocolIds.push(parentProtocol.id);
                                } else if (currentProtocol?.id && !currentProtocol.parent_protocol_id) {
                                    allProtocolIds.push(currentProtocol.id);
                                }
                                treeSubProtocols.forEach(p => {
                                    if (p.id) allProtocolIds.push(p.id);
                                });
                                if (currentProtocol?.id && !allProtocolIds.includes(currentProtocol.id)) {
                                    allProtocolIds.push(currentProtocol.id);
                                }
                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', animation: 'fadeIn 0.2s ease-in-out' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                            Linha do Tempo / Histórico da Tratativa (Unificado)
                                        </h4>
                                        <div style={{ minHeight: '400px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.5rem' }}>
                                            <HistoryTimeline
                                                entityType="protocol"
                                                entityId={currentProtocol.id}
                                                entityIds={allProtocolIds}
                                                entityName={title}
                                                isInline={true}
                                                hideHeader={true}
                                                compact={false}
                                                refreshTrigger={historyRefresh}
                                            />
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1.25rem 2rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderBottomLeftRadius: '18px', borderBottomRightRadius: '18px' }}>
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    padding: '0.6rem 1.25rem', border: '1px solid #cbd5e1', borderRadius: '8px',
                                    background: 'white', color: '#475569', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                style={{
                                    padding: '0.6rem 1.5rem', border: 'none', borderRadius: '8px',
                                    background: primaryColor, color: 'white', fontWeight: 600, fontSize: '0.85rem',
                                    cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
                                    transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                                onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                            >
                                <Save size={16} />
                                {saving ? 'Salvando...' : (currentProtocol?.parent_protocol_id ? 'Salvar Sub-protocolo' : 'Salvar Protocolo')}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Sub protocol creation modal overlay */}
            {showSubModal && (
                <ProtocolModal
                    parentProtocolId={parentProtocol?.id || currentProtocol?.id}
                    protocol={{
                        linked_entity_type: linkedEntityType,
                        linked_entity_id: linkedEntityId,
                        title: `Subtarefa de: ${parentProtocol?.title || currentProtocol?.title}`
                    }}
                    onClose={() => setShowSubModal(false)}
                    onUpdated={() => {
                        loadTreeData();
                        setShowSubModal(false);
                        if (onUpdated) onUpdated();
                    }}
                />
            )}

            {/* Linked Entity Modals */}
            {activeSubscriber && (
                <SubscriberModal
                    subscriber={activeSubscriber}
                    onClose={() => setActiveSubscriber(null)}
                    onSave={() => {}}
                />
            )}

            {activeConsumerUnit && (
                <ConsumerUnitModal
                    consumerUnit={activeConsumerUnit}
                    onClose={() => setActiveConsumerUnit(null)}
                    onSave={() => {}}
                />
            )}

            {activeInvoice && (
                <InvoiceSummaryModal
                    invoice={activeInvoice}
                    consumerUnit={activeInvoiceCU}
                    onClose={() => {
                        setActiveInvoice(null);
                        setActiveInvoiceCU(null);
                    }}
                />
            )}

            {activeRateio && (
                <RateioListModal
                    rateio={activeRateio}
                    onClose={() => setActiveRateio(null)}
                />
            )}

            {activeUsina && (
                <PowerPlantModal
                    usina={activeUsina}
                    onClose={() => setActiveUsina(null)}
                    onSave={() => {}}
                />
            )}

            {/* Justification dialog for replica status */}
            {showReplicaJustification && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
                    justifyContent: 'center', alignItems: 'center', zIndex: 2000,
                    backdropFilter: 'blur(4px)'
                }}>
                    <div style={{
                        background: 'white',
                        borderRadius: '12px',
                        width: '90%',
                        maxWidth: '500px',
                        padding: '1.5rem',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1e293b' }}>
                                Justificativa da Réplica
                            </h4>
                            <button 
                                type="button" 
                                onClick={() => setShowReplicaJustification(false)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', lineHeight: 1.4 }}>
                            Por favor, informe a justificativa ou o motivo para abrir a Réplica. Isso será registrado no histórico da tratativa.
                        </p>
                        <textarea
                            value={replicaJustification}
                            onChange={(e) => setReplicaJustification(e.target.value)}
                            placeholder="Descreva o motivo da discordância com a tratativa..."
                            style={{
                                width: '100%',
                                height: '120px',
                                padding: '0.75rem',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                fontSize: '0.875rem',
                                outline: 'none',
                                resize: 'none',
                                transition: 'border-color 0.2s'
                            }}
                            onFocus={(e) => e.target.style.borderColor = primaryColor}
                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowReplicaJustification(false);
                                }}
                                style={{
                                    padding: '0.5rem 1rem', border: '1px solid #cbd5e1', borderRadius: '6px',
                                    background: 'white', color: '#475569', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                                                type="button"
                                                                onClick={async () => {
                                                                    if (!replicaJustification.trim()) {
                                                                        showAlert('Por favor, informe uma justificativa.', 'warning');
                                                                        return;
                                                                    }
                                                                    setStatus('replica');
                                                                    setShowReplicaJustification(false);
                                
                                                                    if (currentProtocol?.id) {
                                                                        try {
                                                                            const { data: { user } } = await supabase.auth.getUser();
                                                                            
                                                                            // Grava a justificativa no histórico imediatamente
                                                                            const { error: histError } = await supabase
                                                                                .from('crm_history')
                                                                                .insert({
                                                                                    entity_type: 'protocol',
                                                                                    entity_id: currentProtocol.id,
                                                                                    content: `Motivo da Réplica:\n${replicaJustification.trim()}`,
                                                                                    created_by: user?.id,
                                                                                    metadata: {
                                                                                        protocol_id: currentProtocol.id,
                                                                                        message: `Motivo da Réplica: ${replicaJustification.trim()}`
                                                                                    }
                                                                                });
                                                                                
                                                                            if (histError) throw histError;
                                
                                                                            // Atualiza também o status do protocolo no banco imediatamente
                                                                            const { error: statusError } = await supabase
                                                                                .from('protocols')
                                                                                .update({
                                                                                    status: 'replica',
                                                                                    updated_at: new Date().toISOString()
                                                                                })
                                                                                .eq('id', currentProtocol.id);
                                                                            
                                                                            if (statusError) throw statusError;
                                
                                                                            // Limpa a justificativa do state para evitar duplicidade no handleSave
                                                                            setReplicaJustification('');
                                                                            
                                                                            // Atualiza a timeline
                                                                            setHistoryRefresh(prev => prev + 1);
                                
                                                                            // Notifica o componente pai para atualizar a listagem/kanban
                                                                            if (onUpdated) onUpdated();
                                                                            showAlert('Réplica registrada com sucesso!', 'success');
                                                                        } catch (err) {
                                                                            console.error('Erro ao registrar réplica imediatamente:', err);
                                                                            showAlert('Erro ao registrar réplica no histórico.', 'error');
                                                                        }
                                                                    }
                                                                }}
                                                                style={{
                                                                    padding: '0.5rem 1rem', border: 'none', borderRadius: '6px',
                                                                    background: primaryColor, color: 'white', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer'
                                                                }}
                                                            >
                                                                Confirmar Réplica
                                                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
