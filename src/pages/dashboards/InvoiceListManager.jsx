import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { createAsaasCharge } from '../../lib/api';
import InvoiceFormModal from '../../components/InvoiceFormModal';
import InvoiceHistoryModal from '../../components/InvoiceHistoryModal';
import { Search, Filter, Plus, FileText, CheckCircle, AlertCircle, Clock, CreditCard, Trash2, Ban, History, Layout, List, Info, Calendar as CalendarIcon, TicketCheck, TicketMinus, Download, CheckCircle2, X, Zap } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';
import InvoiceSummaryModal from '../../components/InvoiceSummaryModal';
import { useAuth } from '../../contexts/AuthContext';
import AuditGraphView from './AuditGraphView';


export default function InvoiceListManager() {
    const { showAlert, showConfirm } = useUI();
    const { profile } = useAuth();
    const showAuditorTab = ['admin', 'super_admin', 'manager'].includes(profile?.role);
    const [invoices, setInvoices] = useState([]);
    const [ucs, setUcs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('kanban');
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [monthFilter, setMonthFilter] = useState(new Date().toISOString().substring(0, 7));
    const [statusFilter, setStatusFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [generatingId, setGeneratingId] = useState(null);
    const [showMonthPicker, setShowMonthPicker] = useState(false);
    const [showTooltip, setShowTooltip] = useState(false);
    const [payingId, setPayingId] = useState(null);

    // Estado da Aba Ativa: 'faturas' ou 'contas_energia'
    const [activeTab, setActiveTab] = useState('faturas');
    // Estado de Ordenação
    const [sortBy, setSortBy] = useState('ref_desc');
    // Estado de exibição do detalhe informativo da aba (! Info)
    const [activeInfoTab, setActiveInfoTab] = useState(null);

    // Estados para o Resumo Financeiro
    const [selectedInvoiceForSummary, setSelectedInvoiceForSummary] = useState(null);
    const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        setStatusFilter('');
        if (tab === 'faturas') {
            if (viewMode === 'energy_list') setViewMode('list');
            else if (viewMode === 'energy_kanban') setViewMode('kanban');
            else if (viewMode === 'energy_calendar') setViewMode('calendar');
            else if (viewMode === 'graph_node') setViewMode('graph_node');
            else setViewMode('kanban');
        } else if (tab === 'contas_energia') {
            if (viewMode === 'list') setViewMode('energy_list');
            else if (viewMode === 'kanban') setViewMode('energy_kanban');
            else if (viewMode === 'calendar') setViewMode('energy_calendar');
            else if (viewMode === 'graph_node') setViewMode('graph_node');
            else setViewMode('energy_kanban');
        }
    };

    const getAnteriorLeitura = (currentInvoice) => {
        if (!currentInvoice.uc_id || !currentInvoice.mes_referencia) return '-';
        
        const [year, month] = currentInvoice.mes_referencia.split('-').map(Number);
        let prevYear = year;
        let prevMonth = month - 1;
        if (prevMonth === 0) {
            prevMonth = 12;
            prevYear = year - 1;
        }
        const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
        
        const prevInv = invoices.find(inv => 
            inv.uc_id === currentInvoice.uc_id && 
            inv.mes_referencia === prevMonthStr
        );
        
        if (prevInv && prevInv.data_leitura) {
            return prevInv.data_leitura.split('-').reverse().join('/');
        }
        
        return '-';
    };

    const filteredInvoices = invoices.filter(inv => {
        if (inv.status === 'cancelado') return false;
        
        if (activeTab === 'faturas') {
            if (inv.status === 'sem_faturamento') return false;
            
            // Se ambos os valores forem zero ou nulos, não exibir no dashboard financeiro
            const valPagar = Number(inv.valor_a_pagar) || 0;
            const valConcessionaria = Number(inv.valor_concessionaria) || 0;
            if (valPagar <= 0 && valConcessionaria <= 0) return false;

            if (statusFilter && inv.status !== statusFilter) return false;
        } else {
            // Contas de energia (Concessionária)
            if (inv.consumer_units?.modalidade !== 'auto_consumo_remoto') return false;
            if (inv.status === 'sem_faturamento') return false;

            if (statusFilter) {
                const ebStatus = inv.energy_bill_status || 'pendente';
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dueDate = inv.vencimento ? new Date(inv.vencimento) : null;
                const isPastDue = dueDate && dueDate < today;

                if (statusFilter === 'atrasada') {
                    if (ebStatus !== 'pendente' || !isPastDue) return false;
                } else if (statusFilter === 'a_vencer') {
                    if (ebStatus !== 'pendente' || isPastDue) return false;
                } else {
                    if (ebStatus !== statusFilter) return false;
                }
            }
        }

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            const titular = inv.consumer_units?.titular_conta?.toLowerCase() || '';
            const assinante = inv.consumer_units?.subscribers?.name?.toLowerCase() || '';
            const uc = inv.consumer_units?.numero_uc?.toLowerCase() || '';
            const invoiceId = inv.id?.toLowerCase() || '';
            if (!titular.includes(lower) && !assinante.includes(lower) && !uc.includes(lower) && !invoiceId.includes(lower)) {
                return false;
            }
        }
        return true;
    });

    const sortedInvoices = [...filteredInvoices].sort((a, b) => {
        if (sortBy === 'ref_desc') {
            const dateA = a.mes_referencia ? new Date(a.mes_referencia) : new Date(0);
            const dateB = b.mes_referencia ? new Date(b.mes_referencia) : new Date(0);
            return dateB - dateA;
        }
        if (sortBy === 'ref_asc') {
            const dateA = a.mes_referencia ? new Date(a.mes_referencia) : new Date(0);
            const dateB = b.mes_referencia ? new Date(b.mes_referencia) : new Date(0);
            return dateA - dateB;
        }
        if (sortBy === 'venc_desc') {
            const dateA = a.vencimento ? new Date(a.vencimento) : new Date(0);
            const dateB = b.vencimento ? new Date(b.vencimento) : new Date(0);
            return dateB - dateA;
        }
        if (sortBy === 'venc_asc') {
            const dateA = a.vencimento ? new Date(a.vencimento) : new Date(0);
            const dateB = b.vencimento ? new Date(b.vencimento) : new Date(0);
            return dateA - dateB;
        }
        if (sortBy === 'uc_asc') {
            const ucA = a.consumer_units?.numero_uc || '';
            const ucB = b.consumer_units?.numero_uc || '';
            return ucA.localeCompare(ucB);
        }
        if (sortBy === 'uc_desc') {
            const ucA = a.consumer_units?.numero_uc || '';
            const ucB = b.consumer_units?.numero_uc || '';
            return ucB.localeCompare(ucA);
        }
        if (sortBy === 'valor_desc') {
            const valA = Number(a.valor_concessionaria) || ((Number(a.tarifa_minima) || 0) + (Number(a.iluminacao_publica) || 0) + (Number(a.outros_lancamentos) || 0));
            const valB = Number(b.valor_concessionaria) || ((Number(b.tarifa_minima) || 0) + (Number(b.iluminacao_publica) || 0) + (Number(b.outros_lancamentos) || 0));
            return valB - valA;
        }
        if (sortBy === 'valor_asc') {
            const valA = Number(a.valor_concessionaria) || ((Number(a.tarifa_minima) || 0) + (Number(a.iluminacao_publica) || 0) + (Number(a.outros_lancamentos) || 0));
            const valB = Number(b.valor_concessionaria) || ((Number(b.tarifa_minima) || 0) + (Number(b.iluminacao_publica) || 0) + (Number(b.outros_lancamentos) || 0));
            return valA - valB;
        }
        if (sortBy === 'assinante_asc') {
            const nameA = a.consumer_units?.subscribers?.name || '';
            const nameB = b.consumer_units?.subscribers?.name || '';
            return nameA.localeCompare(nameB);
        }
        if (sortBy === 'assinante_desc') {
            const nameA = a.consumer_units?.subscribers?.name || '';
            const nameB = b.consumer_units?.subscribers?.name || '';
            return nameB.localeCompare(nameA);
        }
        return 0;
    });

    useEffect(() => {
        fetchInvoices();
        fetchUcs();
    }, [monthFilter]);

    const fetchInvoices = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('invoices')
                .select(`
                    *,
                    consumer_units (
                        id,
                        numero_uc,
                        titular_conta,
                        concessionaria,
                        modalidade,
                        status,
                        dia_vencimento,
                        subscribers!consumer_units_subscriber_id_fkey(name),
                        titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name)
                    )
                `);

            if (monthFilter !== 'all') {
                const [year, month] = monthFilter.split('-');
                const startDate = `${year}-${month}-01`;
                const lastDay = new Date(year, month, 0).getDate();
                const endDate = `${year}-${month}-${lastDay}`;
                query = query.gte('vencimento', startDate).lte('vencimento', endDate);
            }

            const { data, error } = await query.order('vencimento', { ascending: true });
            if (error) throw error;
            const processedData = (data || []).map(inv => {
                if (inv.status === 'a_vencer') {
                    if (inv.vencimento) {
                        const [y, m, d] = inv.vencimento.split('-');
                        const dueDate = new Date(Number(y), Number(m) - 1, Number(d));
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        
                        if (dueDate < today) {
                            inv.status = 'atrasado';
                        }
                    }
                }
                return inv;
            });
            
            setInvoices(processedData);
        } catch (error) {
            console.error('Error fetching invoices:', error);
            showAlert('Erro ao carregar faturas.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const fetchUcs = async () => {
        const { data, error } = await supabase
            .from('consumer_units')
            .select(`
                id, numero_uc, concessionaria, titular_conta, 
                tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento,
                subscribers!consumer_units_subscriber_id_fkey(name),
                titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name)
            `)
            .eq('status', 'ativo')
            .order('titular_conta');
        if (!error) setUcs(data || []);
    };

    const handleCreate = () => {
        setSelectedInvoice(null);
        setIsModalOpen(true);
    };

    const handleEdit = (inv) => {
        setSelectedInvoice(inv);
        setIsModalOpen(true);
    };

    const handleSave = () => {
        fetchInvoices();
        setIsModalOpen(false);
    };

    const handleEmission = async (inv) => {
        const confirm = await showConfirm(`Gerar boleto Asaas para a fatura de ${inv.consumer_units?.titular_conta}?`);
        if (!confirm) return;
        setGeneratingId(inv.id);
        try {
            const result = await createAsaasCharge(inv.id);
            if (result.url) {
                showAlert('Boleto gerado com sucesso!', 'success');
                window.open(result.url, '_blank');
                fetchInvoices();
            }
        } catch (error) {
            console.error(error);
            showAlert('Erro ao gerar boleto: ' + error.message, 'error');
        } finally {
            setGeneratingId(null);
        }
    };

    const handlePayBill = async (inv) => {
        const utilityValue = (Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0);
        
        const confirm = await showConfirm(`Deseja pagar a conta de energia da concessionária no valor de ${formatCurrency(utilityValue)}?`);
        if (!confirm) return;

        setPayingId(inv.id);
        try {
            const { data, error } = await supabase.functions.invoke('pay-asaas-bill', {
                body: {
                    identification: inv.linha_digitavel,
                    value: utilityValue,
                    description: `Pagamendo Conta Energia - ${inv.consumer_units?.titular_conta || 'UC'}`,
                    scheduleDate: null
                }
            });

            if (error) throw error;

            if (data?.data?.id || data?.success) {
                // Marcar como pago no CRM
                const { error: updateError } = await supabase
                    .from('invoices')
                    .update({ energy_bill_status: 'pago' })
                    .eq('id', inv.id);
                
                if (updateError) throw updateError;

                // Registrar liquidação no Ledger (Livro Razão)
                const { error: ledgerError } = await supabase.rpc('liquidate_concessionaria_payment', {
                    p_invoice_id: inv.id,
                    p_amount: utilityValue
                });

                if (ledgerError) {
                    console.error('Erro ao registrar no ledger:', ledgerError);
                    // Não travamos o fluxo aqui pois o pagamento já foi feito, mas avisamos o admin
                    showAlert('Pagamento concluído, mas houve um erro ao registrar no Livro Razão.', 'warning');
                } else {
                    showAlert('Pagamento agendado e liquidado no Livro Razão!', 'success');
                }
                
                fetchInvoices();
            } else {
                throw new Error(data?.message || 'Falha ao processar pagamento');
            }
        } catch (error) {
            console.error('Erro ao pagar conta:', error);
            showAlert('Erro ao processar pagamento: ' + error.message, 'error');
        } finally {
            setPayingId(null);
        }
    };

    const handleDelete = async (id) => {
        const confirm = await showConfirm('Tem certeza que deseja excluir esta fatura?');
        if (!confirm) return;
        try {
            const { error } = await supabase.from('invoices').delete().eq('id', id);
            if (error) throw error;
            fetchInvoices();
        } catch (error) {
            console.error('Erro ao excluir fatura:', error);
            showAlert('Erro ao excluir fatura: ' + error.message, 'error');
        }
    };

    const handleDrop = async (e, newStatus) => {
        e.preventDefault();
        const invoiceId = e.dataTransfer.getData('invoiceId');
        if (!invoiceId) return;

        const inv = invoices.find(i => i.id === invoiceId);
        if (!inv || inv.status === newStatus) return;

        const previousStatus = inv.status;
        setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, status: newStatus } : i));

        try {
            const { error } = await supabase.from('invoices').update({ status: newStatus }).eq('id', invoiceId);
            if (error) throw error;
            showAlert('Status atualizado com sucesso!', 'success');
        } catch (error) {
            console.error('Error updating status:', error);
            showAlert('Erro ao atualizar status: ' + error.message, 'error');
            setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, status: previousStatus } : i));
        }
    };

    const handleEnergyDrop = async (e, newStatus) => {
        e.preventDefault();
        const invoiceId = e.dataTransfer.getData('invoiceId');
        if (!invoiceId) return;

        const inv = invoices.find(i => i.id === invoiceId);
        if (!inv) return;

        let dbStatus = newStatus;
        if (newStatus === 'a_vencer' || newStatus === 'atrasada') {
            dbStatus = 'pendente';
        }

        const previousStatus = inv.energy_bill_status || 'pendente';
        setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, energy_bill_status: dbStatus } : i));

        try {
            const { error } = await supabase
                .from('invoices')
                .update({ energy_bill_status: dbStatus })
                .eq('id', invoiceId);
            if (error) throw error;
            showAlert('Status da conta concessionária atualizado!', 'success');
            fetchInvoices();
        } catch (error) {
            console.error('Error updating energy bill status:', error);
            showAlert('Erro ao atualizar status: ' + error.message, 'error');
            setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, energy_bill_status: previousStatus } : i));
        }
    };

    const getEnergyStatusBadge = (status, isPastDue) => {
        const statusMap = {
            'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago', icon: CheckCircle },
            'pendente': isPastDue 
                ? { color: '#dc2626', bg: '#fee2e2', label: 'Atrasado', icon: AlertCircle }
                : { color: '#2563eb', bg: '#eff6ff', label: 'A Vencer', icon: Clock },
            'erro': { color: '#991b1b', bg: '#fef2f2', label: 'Erro', icon: AlertCircle },
            'parcelada': { color: '#ca8a04', bg: '#fef9c3', label: 'Parcelado', icon: Info },
            'contestada': { color: '#7c3aed', bg: '#f3e8ff', label: 'Contestado', icon: Ban }
        };
        const s = statusMap[status] || statusMap['pendente'];
        const Icon = s.icon;
        return (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', background: s.bg, color: s.color, borderRadius: '99px', fontSize: '0.8rem', width: 'fit-content', fontWeight: 'bold' }}>
                <Icon size={12} /> {s.label}
            </span>
        );
    };

    const formatCurrency = (val) => Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const abbreviateName = (name, max = 24) => {
        if (!name) return '-';
        if (name.length <= max) return name;
        
        const prepositions = ['de', 'da', 'do', 'das', 'dos', 'e'];
        const parts = name.split(' ').filter(part => part.length > 0);
        if (parts.length <= 2) return name;
        
        const first = parts[0];
        const last = parts[parts.length - 1];
        
        const initials = parts.slice(1, -1)
            .filter(part => !prepositions.includes(part.toLowerCase()))
            .map(part => part[0].toUpperCase() + '.')
            .join(' ');
            
        const abbreviated = `${first} ${initials} ${last}`;
        if (abbreviated.length <= max) return abbreviated;
        
        return `${first} ${last}`;
    };

    const getStatusBadge = (status) => {
        const map = {
            'sem_faturamento': { color: '#475569', bg: '#f1f5f9', label: 'Sem Faturamento', icon: FileText },
            'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago', icon: CheckCircle },
            'confirmado': { color: '#0891b2', bg: '#ecfeff', label: 'Pagamento Confirmado', icon: CheckCircle2 },
            'ag_emissao_boleto': { color: '#2563eb', bg: '#eff6ff', label: 'Sem Faturamento', icon: FileText },
            'a_vencer': { color: '#854d0e', bg: '#fef9c3', label: 'A Vencer', icon: Clock },
            'atrasado': { color: '#dc2626', bg: '#fee2e2', label: 'Atrasado', icon: AlertCircle },
            'cancelado': { color: '#475569', bg: '#f1f5f9', label: 'Cancelada', icon: Ban },
        };
        const s = map[status] || map['a_vencer'];
        const Icon = s.icon;
        return (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', background: s.bg, color: s.color, borderRadius: '99px', fontSize: '0.8rem', width: 'fit-content' }}>
                <Icon size={12} /> {s.label}
            </span>
        );
    };

    const InvoiceCalendarView = ({ invoices, onEdit }) => {
        const [year, month] = monthFilter === 'all' 
            ? [new Date().getFullYear(), new Date().getMonth() + 1] 
            : monthFilter.split('-').map(Number);
        const firstDay = new Date(year, month - 1, 1).getDay();
        const startOffset = (firstDay + 6) % 7; // Segunda = 0
        const daysInMonth = new Date(year, month, 0).getDate();
        const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

        const groupedInvoices = invoices.reduce((acc, inv) => {
            if (inv.vencimento && inv.status !== 'cancelado') {
                const date = new Date(inv.vencimento);
                const day = date.getUTCDate();
                if (!acc[day]) acc[day] = [];
                acc[day].push(inv);
            }
            return acc;
        }, {});

        return (
            <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', 
                gap: '1rem', 
                padding: '1rem' 
            }}>
                <div style={{
                    gridColumn: '1 / -1',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '1rem',
                    position: 'sticky',
                    top: 'calc(var(--sticky-header-height, 120px) + 2rem)',
                    zIndex: 10,
                    background: '#f8fafc',
                    padding: '0.5rem 0',
                    margin: '-0.5rem 0 0.5rem 0'
                }}>
                    {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map(d => (
                        <div key={d} style={{ 
                            fontWeight: '800', 
                            textAlign: 'center', 
                            padding: '0.5rem', 
                            color: '#64748b', 
                            fontSize: '0.75rem', 
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                        }}>
                            {d}
                        </div>
                    ))}
                </div>
                {Array.from({ length: startOffset }).map((_, i) => (
                    <div key={`pad-${i}`} style={{ background: '#f8fafc50', borderRadius: '14px', border: '1px dashed #e2e8f0', minHeight: '260px' }} />
                ))}
                {calendarDays.map(day => {
                    const dayInvoices = groupedInvoices[day] || [];
                    const totalAmount = dayInvoices.reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0);

                    const counts = dayInvoices.reduce((acc, inv) => {
                        acc[inv.status] = (acc[inv.status] || 0) + 1;
                        return acc;
                    }, {});

                    return (
                        <div key={day} style={{ background: 'white', borderRadius: '14px', border: '1px solid #e2e8f0', minHeight: '260px', height: '260px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-sm)', transition: 'all 0.2s', overflow: 'hidden' }}>
                            <div style={{ padding: '0.75rem 0.75rem', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <span style={{ fontWeight: '800', color: 'var(--color-blue)', fontSize: '0.85rem', marginRight: '0.4rem' }}>D{day}</span>
                                    {counts.pago > 0 && <span title={`Pagos: ${counts.pago}`} style={{ background: '#10b981', color: 'white', width: '18px', height: '18px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 'bold' }}>{counts.pago}</span>}
                                    {counts.a_vencer > 0 && <span title={`A Vencer: ${counts.a_vencer}`} style={{ background: '#f59e0b', color: 'white', width: '18px', height: '18px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 'bold' }}>{counts.a_vencer}</span>}
                                    {counts.atrasado > 0 && <span title={`Vencidos: ${counts.atrasado}`} style={{ background: '#ef4444', color: 'white', width: '18px', height: '18px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 'bold' }}>{counts.atrasado}</span>}
                                </div>
                                {totalAmount > 0 && (
                                    <span style={{ fontSize: '0.7rem', color: '#166534', background: '#dcfce7', padding: '0.15rem 0.5rem', borderRadius: '99px', fontWeight: '800' }}>
                                        {formatCurrency(totalAmount)}
                                    </span>
                                )}
                            </div>
                            <div style={{ padding: '0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', scrollbarWidth: 'thin' }}>
                                {dayInvoices.length === 0 ? (
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginTop: '3.5rem', fontStyle: 'italic', opacity: 0.6 }}>Sem faturas</div>
                                ) : (
                                    dayInvoices.map(inv => {
                                        const statusData = {
                                            'sem_faturamento': { color: '#475569', label: 'Sem Faturamento', bg: '#f1f5f9' },
                                            'pago': { color: '#166534', label: 'Pago', bg: '#dcfce7' },
                                            'atrasado': { color: '#dc2626', label: 'Atrasado', bg: '#fee2e2' },
                                            'a_vencer': { color: '#854d0e', label: 'A Vencer', bg: '#fef9c3' }
                                        };
                                        const s = statusData[inv.status] || statusData['a_vencer'];
                                        const isBoletoEmitido = !!inv.asaas_boleto_url;

                                        return (
                                            <div
                                                key={inv.id}
                                                onClick={() => onEdit(inv)}
                                                style={{
                                                    padding: '0.75rem',
                                                    borderRadius: '10px',
                                                    background: 'white',
                                                    border: '1px solid #e2e8f0',
                                                    borderLeft: `5px solid ${s.color}`,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s',
                                                    position: 'relative',
                                                    flexShrink: 0,
                                                    height: 'fit-content'
                                                }}
                                                onMouseOver={e => {
                                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
                                                    e.currentTarget.style.borderColor = 'var(--color-blue)';
                                                }}
                                                onMouseOut={e => {
                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                    e.currentTarget.style.boxShadow = 'none';
                                                    e.currentTarget.style.borderColor = '#e2e8f0';
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                                                    <div style={{ fontWeight: '800', color: '#1e293b', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                                                        {inv.consumer_units?.subscribers?.name || 'S/ Assinante'}
                                                    </div>
                                                </div>

                                                <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.5rem' }}>
                                                    UC: {inv.consumer_units?.numero_uc}
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                        <span style={{ fontSize: '0.6rem', fontWeight: '800', color: s.color, background: s.bg, padding: '0.1rem 0.4rem', borderRadius: '4px', textTransform: 'uppercase' }}>
                                                            {s.label}
                                                        </span>
                                                        <span style={{
                                                            fontSize: '0.6rem',
                                                            fontWeight: '800',
                                                            color: isBoletoEmitido ? '#0369a1' : '#c2410c',
                                                            background: isBoletoEmitido ? '#e0f2fe' : '#fff7ed',
                                                            padding: '0.1rem 0.4rem',
                                                            borderRadius: '4px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '0.2rem'
                                                        }}>
                                                            {isBoletoEmitido ? <TicketCheck size={10} /> : <TicketMinus size={10} />}
                                                            {isBoletoEmitido ? 'Emitido' : 'Gerar'}
                                                        </span>
                                                    </div>
                                                    <span style={{ fontWeight: '900', fontSize: '0.8rem', color: 'var(--color-blue)' }}>
                                                        {formatCurrency(inv.valor_a_pagar)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const EnergyCalendarView = ({ invoices, onInvoiceClick }) => {
        const [year, month] = monthFilter === 'all' 
            ? [new Date().getFullYear(), new Date().getMonth() + 1] 
            : monthFilter.split('-').map(Number);
        const firstDay = new Date(year, month - 1, 1).getDay();
        const startOffset = (firstDay + 6) % 7; // Segunda = 0
        const daysInMonth = new Date(year, month, 0).getDate();
        const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        
        // Filtra faturas: apenas modalidade Auto Consumo Remoto
        const filteredEnergyInvoices = invoices.filter(inv => 
            inv.consumer_units?.modalidade === 'auto_consumo_remoto' &&
            inv.status !== 'sem_faturamento' &&
            (Number(inv.valor_a_pagar) > 0 || Number(inv.valor_concessionaria) > 0)
        );
        const groupedInvoices = filteredEnergyInvoices.reduce((acc, inv) => {
            if (inv.vencimento && inv.status !== 'cancelado') {
                // Prioriza a data de vencimento real da fatura para o calendário
                const date = new Date(inv.vencimento);
                const day = date.getUTCDate();
                
                if (!acc[day]) acc[day] = [];
                acc[day].push(inv);
            }
            return acc;
        }, {});
        
        const stats = filteredEnergyInvoices.reduce((acc, inv) => {
            if (inv.status === 'pago') acc.pago++;
            else if (inv.status === 'atrasado') acc.atrasado++;
            else if (inv.status === 'a_vencer') acc.a_vencer++;
            return acc;
        }, { pago: 0, atrasado: 0, a_vencer: 0 });


        return (
            <div style={{ padding: '1rem' }}>
                {/* Legenda de Status */}


                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', 
                    gap: '1rem' 
                }}>
                    <div style={{
                        gridColumn: '1 / -1',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, 1fr)',
                        gap: '1rem',
                        position: 'sticky',
                        top: 'calc(var(--sticky-header-height, 120px) + 2rem)',
                        zIndex: 10,
                        background: '#f8fafc',
                        padding: '0.5rem 0',
                        margin: '-0.5rem 0 0.5rem 0'
                    }}>
                        {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map(d => (
                            <div key={d} style={{ 
                                fontWeight: '800', 
                                textAlign: 'center', 
                                padding: '0.5rem', 
                                color: '#64748b', 
                                fontSize: '0.75rem', 
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                            }}>
                                {d}
                            </div>
                        ))}
                    </div>
                    {Array.from({ length: startOffset }).map((_, i) => (
                        <div key={`pad-${i}`} style={{ background: '#f8fafc50', borderRadius: '14px', border: '1px dashed #e2e8f0', minHeight: '280px' }} />
                    ))}
                    {calendarDays.map(day => {
                    const dayInvoices = groupedInvoices[day] || [];
                    
                    const hasAtrasado = dayInvoices.some(inv => inv.status === 'atrasado');
                    const allPago = dayInvoices.length > 0 && dayInvoices.every(inv => inv.status === 'pago');
                    const hasAVencer = dayInvoices.some(inv => inv.status === 'a_vencer');

                    const headerBg = dayInvoices.length === 0 ? '#f8fafc' : 
                                    hasAtrasado ? '#fef2f2' : 
                                    allPago ? '#f0fdf4' : 
                                    hasAVencer ? '#fffbeb' : '#f8fafc';
                    
                    const headerBorder = dayInvoices.length === 0 ? '#e2e8f0' : 
                                       hasAtrasado ? '#fecaca' : 
                                       allPago ? '#bbf7d0' : 
                                       hasAVencer ? '#fef08a' : '#e2e8f0';

                    const headerTextColor = dayInvoices.length === 0 ? '#64748b' : 
                                          hasAtrasado ? '#991b1b' : 
                                          allPago ? '#166534' : 
                                          hasAVencer ? '#92400e' : '#1e293b';

                    return (
                        <div key={day} style={{ background: 'white', borderRadius: '14px', border: '1px solid #e2e8f0', minHeight: '280px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-sm)', transition: 'all 0.2s', overflow: 'hidden' }}>
                            <div style={{ 
                                padding: '0.75rem 0.75rem', 
                                borderBottom: `1px solid ${headerBorder}`, 
                                background: headerBg, 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center' 
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', minWidth: 0 }}>
                                    <span style={{ 
                                        fontWeight: '800', 
                                        color: headerTextColor, 
                                        fontSize: '0.75rem',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        Venc. {day}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                                    {[
                                        { key: 'pago', bg: '#dcfce7', color: '#166534' },
                                        { key: 'a_vencer', bg: '#fef9c3', color: '#92400e' },
                                        { key: 'atrasado', bg: '#fee2e2', color: '#991b1b' }
                                    ].map(s => {
                                        const count = dayInvoices.filter(inv => inv.status === s.key).length;
                                        if (count === 0) return null;
                                        return (
                                            <span key={s.key} style={{ 
                                                fontSize: '0.7rem', color: s.color, background: s.bg, 
                                                padding: '0.15rem 0.4rem', borderRadius: '6px', fontWeight: '800',
                                                border: `1px solid ${s.color}20`
                                            }}>
                                                {count}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                            <div style={{ padding: '0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', scrollbarWidth: 'thin' }}>
                                {dayInvoices.length === 0 ? (
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginTop: '3.5rem', fontStyle: 'italic', opacity: 0.6 }}>Sem vencimentos</div>
                                ) : (
                                    dayInvoices.map(inv => {
                                        const today = new Date();
                                        const dueDate = new Date(inv.vencimento);
                                        const isPastDue = dueDate < today;
                                        
                                        const ebStatus = inv.energy_bill_status || 'pendente';
                                        
                                        const statusData = {
                                            'pago': { color: '#166534', label: 'PAGA', bg: '#dcfce7' },
                                            'pendente': isPastDue 
                                                ? { color: '#dc2626', label: 'ATRASADA', bg: '#fee2e2' }
                                                : { color: '#2563eb', label: 'A VENCER', bg: '#eff6ff' },
                                            'erro': { color: '#991b1b', label: 'ERRO PAGAMENTO', bg: '#fef2f2' },
                                            'parcelada': { color: '#ca8a04', label: 'PARCELADA', bg: '#fef9c3' },
                                            'contestada': { color: '#7c3aed', label: 'CONTESTADA', bg: '#f3e8ff' }
                                        };
                                        
                                        const s = statusData[ebStatus] || { color: '#64748b', label: ebStatus.toUpperCase(), bg: '#f1f5f9' };
                                        const formatCurrencyValue = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

                                        // Valores da Concessionária
                                        const ip = Number(inv.iluminacao_publica) || 0;
                                        const outros = (Number(inv.tarifa_minima) || 0) + (Number(inv.outros_lancamentos) || 0);
                                        const valorConcessionaria = Number(inv.valor_concessionaria) || (ip + outros + (Number(inv.consumo_reais) || 0));

                                        return (
                                            <div
                                                key={inv.id}
                                                onClick={() => onInvoiceClick(inv)}
                                                style={{
                                                    padding: '0.6rem',
                                                    borderRadius: '10px',
                                                    background: 'white',
                                                    border: '1px solid #e2e8f0',
                                                    cursor: 'pointer', 
                                                    transition: 'all 0.2s',
                                                    display: 'flex', 
                                                    flexDirection: 'column', 
                                                    gap: '0.35rem', 
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                                                    position: 'relative',
                                                    borderLeft: `5px solid ${s.color}`
                                                }}
                                                onMouseOver={e => {
                                                    e.currentTarget.style.borderColor = '#3b82f6';
                                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                                }}
                                                onMouseOut={e => {
                                                    e.currentTarget.style.borderColor = '#e2e8f0';
                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                    <div style={{ fontWeight: '800', color: '#1e293b', fontSize: '0.8rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {inv.consumer_units?.subscribers?.name || 'Assinante'}
                                                    </div>
                                                    <span style={{ padding: '0.1rem 0.3rem', borderRadius: '4px', fontSize: '0.55rem', fontWeight: 900, background: s.bg, color: s.color }}>
                                                        {s.label}
                                                    </span>
                                                </div>

                                                <div style={{ fontSize: '0.65rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>UC: {inv.consumer_units?.numero_uc}</span>
                                                    <span style={{ fontWeight: 'bold' }}>{inv.consumo_kwh} kWh</span>
                                                </div>

                                                <div style={{ height: '1px', background: '#f1f5f9', margin: '1px 0' }}></div>

                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: '#94a3b8' }}>
                                                        <span>IP + Taxas + Outros:</span>
                                                        <span style={{ fontWeight: 600 }}>{formatCurrencyValue(ip + outros)}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                                                        <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#475569' }}>Vr. A Pagar:</span>
                                                        <span style={{ fontWeight: 900, color: '#0f172a', fontSize: '0.9rem' }}>
                                                            {formatCurrencyValue(valorConcessionaria)}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Botão de Pagamento Concessionária */}
                                                {ebStatus !== 'pago' && inv.linha_digitavel && (
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handlePayBill(inv);
                                                        }}
                                                        disabled={payingId === inv.id}
                                                        style={{
                                                            marginTop: '0.3rem',
                                                            padding: '0.4rem',
                                                            background: '#10b981',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '6px',
                                                            fontSize: '0.7rem',
                                                            fontWeight: 'bold',
                                                            cursor: payingId === inv.id ? 'default' : 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            gap: '0.3rem',
                                                            boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)'
                                                        }}
                                                    >
                                                        <CreditCard size={12} /> {payingId === inv.id ? 'PROCESSANDO...' : 'PAGAR CONTA'}
                                                    </button>
                                                )}
                                                
                                                {ebStatus === 'pago' && (
                                                    <div style={{ 
                                                        marginTop: '0.5rem', 
                                                        padding: '0.4rem', 
                                                        textAlign: 'center', 
                                                        background: '#f0fdf4', 
                                                        color: '#166534', 
                                                        borderRadius: '6px', 
                                                        fontSize: '0.7rem', 
                                                        fontWeight: 'bold',
                                                        border: '1px solid #bbf7d0'
                                                    }}>
                                                        CONTA PAGA
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
        );
    };



    return (
        <div style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto', width: '100%' }}>
            {activeInfoTab && (
                <div style={{ 
                    background: 'rgba(15, 23, 42, 0.95)', 
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '1.5rem', 
                    borderRadius: '16px', 
                    width: '100%', 
                    marginBottom: '1.5rem', 
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 15px rgba(37, 99, 235, 0.15)',
                    animation: 'fadeIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    position: 'relative',
                    color: '#f8fafc'
                }}>
                    <button
                        onClick={() => setActiveInfoTab(null)}
                        style={{
                            position: 'absolute',
                            top: '1rem',
                            right: '1rem',
                            background: 'none',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '4px',
                            transition: 'color 0.2s'
                        }}
                        onMouseOver={e => e.currentTarget.style.color = '#f8fafc'}
                        onMouseOut={e => e.currentTarget.style.color = '#94a3b8'}
                        title="Fechar informações"
                    >
                        <X size={18} />
                    </button>

                    {activeInfoTab === 'faturas' && (
                        <>
                            <h2 style={{ color: '#3b82f6', fontSize: '1.5rem', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FileText size={22} /> Painel de Faturamento de Assinantes
                            </h2>
                            <p style={{ color: '#cbd5e1', margin: 0, fontSize: '0.9rem', marginTop: '0.5rem', lineHeight: '1.5' }}>
                                Este painel exibe a relação completa das faturas emitidas pelo sistema aos clientes finais/assinantes. 
                                Permite acompanhar em tempo real o status de pagamento (Pago, A Vencer, Atrasado, Sem Faturamento), 
                                o valor a faturar e o saldo final após aplicação do desconto da usina. Você também tem acesso aos links 
                                diretos dos boletos bancários da plataforma Asaas para verificação de liquidações comerciais.
                            </p>
                        </>
                    )}

                    {activeInfoTab === 'contas_energia' && (
                        <>
                            <h2 style={{ color: '#eab308', fontSize: '1.5rem', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <CreditCard size={22} /> Controle de Contas de Concessionária
                            </h2>
                            <p style={{ color: '#cbd5e1', margin: 0, fontSize: '0.9rem', marginTop: '0.5rem', lineHeight: '1.5' }}>
                                Centraliza todas as faturas físicas coletadas das distribuidoras de energia (ex: Neoenergia Cosern). 
                                Permite monitorar os valores faturados pela concessionária (incluindo iluminação pública, taxas de rede 
                                e impostos), o histórico de leituras de consumo em kWh e datas de vencimento. Também possibilita 
                                a liquidação ou contestação de faturas de concessionária integradas à modalidade de autoconsumo.
                            </p>
                        </>
                    )}


                </div>
            )}

            {/* Cabeçalho Fixo (Filtros + Modos + Ações) */}
            <div style={{
                position: 'sticky',
                top: 0,
                zIndex: 100,
                background: 'rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: '1rem 0',
                margin: '0 -2rem 2rem -2rem',
                paddingLeft: '2rem',
                paddingRight: '2rem',
                borderBottom: '1px solid rgba(226, 232, 240, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
            }}>
                {/* Menu Superior Horizontal Principal */}
                <div style={{ display: 'flex', gap: '2rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.2rem', marginBottom: '0.2rem', alignItems: 'center' }}>
                    
                    {/* Aba Faturas */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <button
                            onClick={() => handleTabChange('faturas')}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: '0.5rem 0.2rem',
                                fontSize: '1rem',
                                fontWeight: '800',
                                color: activeTab === 'faturas' ? 'var(--color-blue)' : '#64748b',
                                borderBottom: activeTab === 'faturas' ? '3px solid var(--color-blue)' : '3px solid transparent',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                marginBottom: '-4px',
                                outline: 'none',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                            }}
                        >
                            Faturas
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveInfoTab(activeInfoTab === 'faturas' ? null : 'faturas');
                            }}
                            style={{
                                background: activeInfoTab === 'faturas' ? 'var(--color-blue)' : 'rgba(37, 99, 235, 0.08)',
                                color: activeInfoTab === 'faturas' ? 'white' : 'var(--color-blue)',
                                border: '1px solid rgba(37, 99, 235, 0.25)',
                                borderRadius: '50%',
                                width: '18px',
                                height: '18px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: '900',
                                fontSize: '0.7rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                outline: 'none',
                                boxShadow: activeInfoTab === 'faturas' ? '0 0 8px rgba(37, 99, 235, 0.4)' : 'none',
                                transform: 'translateY(-2px)'
                            }}
                            title="Exibir informações da página de Faturas"
                        >
                            !
                        </button>
                    </div>

                    {/* Aba Contas de Energia */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <button
                            onClick={() => handleTabChange('contas_energia')}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: '0.5rem 0.2rem',
                                fontSize: '1rem',
                                fontWeight: '800',
                                color: activeTab === 'contas_energia' ? 'var(--color-blue)' : '#64748b',
                                borderBottom: activeTab === 'contas_energia' ? '3px solid var(--color-blue)' : '3px solid transparent',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                marginBottom: '-4px',
                                outline: 'none',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                            }}
                        >
                            Contas de Energia
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveInfoTab(activeInfoTab === 'contas_energia' ? null : 'contas_energia');
                            }}
                            style={{
                                background: activeInfoTab === 'contas_energia' ? 'var(--color-blue)' : 'rgba(37, 99, 235, 0.08)',
                                color: activeInfoTab === 'contas_energia' ? 'white' : 'var(--color-blue)',
                                border: '1px solid rgba(37, 99, 235, 0.25)',
                                borderRadius: '50%',
                                width: '18px',
                                height: '18px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: '900',
                                fontSize: '0.7rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                outline: 'none',
                                boxShadow: activeInfoTab === 'contas_energia' ? '0 0 8px rgba(37, 99, 235, 0.4)' : 'none',
                                transform: 'translateY(-2px)'
                            }}
                            title="Exibir informações da página de Contas de Energia"
                        >
                            !
                        </button>
                    </div>


                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div style={{ background: 'white', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748b' }}>
                            <CalendarIcon size={16} />
                            <span style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>Mês:</span>
                        </div>
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => setShowMonthPicker(!showMonthPicker)} style={{ padding: '0.4rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer', background: 'white', display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: '130px', fontSize: '0.85rem' }}>
                                <span>{monthFilter === 'all' ? 'Qualquer Data' : new Date(`${monthFilter}-01T00:00:00`).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                            </button>
                            {showMonthPicker && (
                                <div style={{ position: 'absolute', top: '110%', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 100, padding: '1rem', width: '280px' }}>
                                    <div style={{ marginBottom: '1rem' }}>
                                        <button onClick={() => { setMonthFilter('all'); setShowMonthPicker(false); }} style={{ width: '100%', padding: '0.6rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: monthFilter === 'all' ? 'var(--color-blue)' : 'white', color: monthFilter === 'all' ? 'white' : '#475569', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>Qualquer Data</button>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
                                        <button onClick={() => { const parts = monthFilter === 'all' ? [new Date().getFullYear(), '01'] : monthFilter.split('-'); setMonthFilter(`${Number(parts[0]) - 1}-${parts[1]}`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 'bold' }}>&lt;</button>
                                        <span style={{ fontWeight: 'bold' }}>{monthFilter === 'all' ? new Date().getFullYear() : monthFilter.split('-')[0]}</span>
                                        <button onClick={() => { const parts = monthFilter === 'all' ? [new Date().getFullYear(), '01'] : monthFilter.split('-'); setMonthFilter(`${Number(parts[0]) + 1}-${parts[1]}`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 'bold' }}>&gt;</button>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                                        {['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'].map((m, idx) => {
                                            const mVal = String(idx + 1).padStart(2, '0');
                                            const currentYear = monthFilter === 'all' ? new Date().getFullYear() : monthFilter.split('-')[0];
                                            const isSelected = monthFilter === `${currentYear}-${mVal}`;
                                            return <button key={m} onClick={() => { setMonthFilter(`${currentYear}-${mVal}`); setShowMonthPicker(false); }} style={{ padding: '0.5rem', border: 'none', borderRadius: '6px', background: isSelected ? 'var(--color-blue)' : '#f8fafc', color: isSelected ? 'white' : '#475569', cursor: 'pointer', fontSize: '0.85rem' }}>{m}</button>;
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div style={{ width: '1px', height: '16px', background: '#e2e8f0' }}></div>
                        {activeTab === 'faturas' ? (
                            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '0.4rem', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.85rem' }}>
                                <option value="">Todos os Status</option>
                                <option value="ag_emissao_boleto">Sem Faturamento</option>
                                <option value="a_vencer">A Vencer</option>
                                <option value="atrasado">Atrasado</option>
                                <option value="confirmado">Confirmado</option>
                                <option value="pago">Pago</option>
                            </select>
                        ) : (
                            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '0.4rem', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.85rem' }}>
                                <option value="">Todos os Status</option>
                                <option value="a_vencer">A Vencer</option>
                                <option value="atrasada">Atrasada</option>
                                <option value="pago">Paga</option>
                                <option value="contestada">Contestada</option>
                                <option value="parcelada">Parcelada</option>
                                <option value="erro">Erro</option>
                            </select>
                        )}
                        <div style={{ width: '1px', height: '16px', background: '#e2e8f0' }}></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#64748b' }}>Ordenar por:</span>
                            <select 
                                value={sortBy} 
                                onChange={e => setSortBy(e.target.value)} 
                                style={{ padding: '0.4rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.85rem', color: '#0f172a', background: 'white', fontWeight: '600', outline: 'none', cursor: 'pointer', transition: 'border-color 0.2s' }}
                            >
                                <option value="ref_desc">Ref. Mês/Ano: Mais Novo primeiro</option>
                                <option value="ref_asc">Ref. Mês/Ano: Mais Antigo primeiro</option>
                                <option value="venc_desc">Vencimento: Mais Novo primeiro</option>
                                <option value="venc_asc">Vencimento: Mais Antigo primeiro</option>
                                <option value="uc_asc">Código do Cliente (A-Z)</option>
                                <option value="uc_desc">Código do Cliente (Z-A)</option>
                                <option value="valor_desc">Valor a Pagar: Maior primeiro</option>
                                <option value="valor_asc">Valor a Pagar: Menor primeiro</option>
                                <option value="assinante_asc">Assinante: Ordem alfabética (A-Z)</option>
                                <option value="assinante_desc">Assinante: Ordem alfabética (Z-A)</option>
                            </select>
                        </div>
                        <div style={{ width: '1px', height: '16px', background: '#e2e8f0' }}></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Search size={16} color="#64748b" />
                            <input placeholder="Buscar UC..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ padding: '0.4rem', border: 'none', outline: 'none', fontSize: '0.85rem', width: '120px' }} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <div className="btn-group" style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            {activeTab === 'faturas' ? (
                                <>
                                    <button onClick={() => setViewMode('list')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'list' ? 'white' : 'transparent', color: viewMode === 'list' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'list' ? '700' : '500', fontSize: '0.85rem' }}>
                                        <List size={16} /> Lista
                                    </button>
                                    <button onClick={() => setViewMode('kanban')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'kanban' ? 'white' : 'transparent', color: viewMode === 'kanban' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'kanban' ? '700' : '500', fontSize: '0.85rem' }}>
                                        <Layout size={16} /> Kanban
                                    </button>
                                    <button onClick={() => setViewMode('calendar')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'calendar' ? 'white' : 'transparent', color: viewMode === 'calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'calendar' ? '700' : '500', fontSize: '0.85rem' }}>
                                        <CalendarIcon size={16} /> Venc. Faturas
                                    </button>
                                    {showAuditorTab && (
                                        <button onClick={() => setViewMode('graph_node')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'graph_node' ? 'white' : 'transparent', color: viewMode === 'graph_node' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'graph_node' ? '700' : '500', fontSize: '0.85rem' }}>
                                            <Zap size={16} /> Graph Node View
                                        </button>
                                    )}
                                </>
                            ) : (
                                <>
                                    <button onClick={() => setViewMode('energy_list')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'energy_list' ? 'white' : 'transparent', color: viewMode === 'energy_list' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'energy_list' ? '700' : '500', fontSize: '0.85rem' }}>
                                        <List size={16} /> Lista
                                    </button>
                                    <button onClick={() => setViewMode('energy_kanban')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'energy_kanban' ? 'white' : 'transparent', color: viewMode === 'energy_kanban' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'energy_kanban' ? '700' : '500', fontSize: '0.85rem' }}>
                                        <Layout size={16} /> Kanban
                                    </button>
                                    <button onClick={() => setViewMode('energy_calendar')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'energy_calendar' ? 'white' : 'transparent', color: viewMode === 'energy_calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'energy_calendar' ? '700' : '500', fontSize: '0.85rem' }}>
                                        <CalendarIcon size={16} /> Venc. Conta de Energia
                                    </button>
                                    {showAuditorTab && (
                                        <button onClick={() => setViewMode('graph_node')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'graph_node' ? 'white' : 'transparent', color: viewMode === 'graph_node' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'graph_node' ? '700' : '500', fontSize: '0.85rem' }}>
                                            <Zap size={16} /> Graph Node View
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button onClick={() => setIsHistoryModalOpen(true)} style={{ background: 'white', color: '#475569', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <History size={16} /> Histórico
                            </button>
                            <button onClick={handleCreate} style={{ background: 'var(--color-orange)', color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <Plus size={16} /> Nova Fatura
                            </button>
                        </div>
                    </div>
                </div>

                {/* Legenda de Status (Energia) integrada se necessário */}
                {viewMode === 'energy_calendar' && (() => {
                    const energyStats = filteredInvoices.filter(inv => 
                        inv.consumer_units?.modalidade === 'auto_consumo_remoto'
                    ).reduce((acc, inv) => {
                        const today = new Date();
                        today.setHours(0,0,0,0);
                        const dueDate = new Date(inv.vencimento);
                        const isPastDue = dueDate < today;
                        const ebStatus = inv.energy_bill_status || 'pendente';
                        
                        if (ebStatus === 'pago') acc.pago++;
                        else if (ebStatus === 'pendente' && isPastDue) acc.atrasado++;
                        else if (ebStatus === 'parcelada') acc.parcelada++;
                        else if (ebStatus === 'contestada') acc.contestada++;
                        else acc.a_vencer++;
                        
                        return acc;
                    }, { pago: 0, atrasado: 0, a_vencer: 0, parcelada: 0, contestada: 0 });

                    return (
                        <div style={{
                            padding: '0.75rem 1rem',
                            background: 'rgba(255, 255, 255, 0.4)',
                            borderRadius: '12px',
                            border: '1px solid rgba(226, 232, 240, 0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '2.5rem',
                            flexWrap: 'wrap'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#22c55e' }}></div>
                                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Pagos: {energyStats.pago}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ef4444' }}></div>
                                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Atrasadas: {energyStats.atrasado}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#3b82f6' }}></div>
                                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>A Vencer: {energyStats.a_vencer}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ca8a04' }}></div>
                                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Parceladas: {energyStats.parcelada}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#7c3aed' }}></div>
                                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Contestadas: {energyStats.contestada}</span>
                            </div>
                        </div>
                    );
                })()}
            </div>

            {viewMode === 'graph_node' ? (
                <AuditGraphView onInspectInvoice={(invoiceId) => {
                    const inv = invoices.find(i => i.id === invoiceId);
                    if (inv) {
                        setSelectedInvoiceForSummary(inv);
                        setIsSummaryModalOpen(true);
                    }
                }} />
            ) : loading ? <p>Carregando...</p> : filteredInvoices.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', background: 'white', borderRadius: '12px', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '1rem' }}><FileText size={48} /></div>
                    <h3 style={{ color: '#475569', fontWeight: 'bold' }}>{monthFilter === 'all' ? 'Nenhuma Fatura encontrada' : 'Nenhuma Fatura emitida para o Mês selecionado'}</h3>
                </div>
            ) : (
                <>
                    {viewMode === 'list' ? (
                        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ background: '#f8fafc' }}>
                                    <tr>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Status</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Vr. da Fatura</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Vencimento</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Unidade Consumidora</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Vr. Conta de Energia</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Saldo</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                        {sortedInvoices.map(inv => {
                                            const factValue = Number(inv.valor_a_pagar) || 0;
                                            const energyBillValue = Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0) + (Number(inv.consumo_reais) || 0));
                                            const balance = factValue - energyBillValue;

                                            return (
                                                <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>{getStatusBadge(inv.status)}</td>
                                                    
                                                    {/* Vr. da Fatura + Boleto */}
                                                    <td style={{ padding: '1rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                                                            <div style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '1rem' }}>{formatCurrency(factValue)}</div>
                                                            {inv.asaas_boleto_url && inv.status !== 'pago' && (
                                                                <a 
                                                                    href={inv.asaas_boleto_url} 
                                                                    target="_blank" 
                                                                    rel="noopener noreferrer" 
                                                                    style={{ 
                                                                        padding: '0.3rem 0.6rem',
                                                                        background: '#dcfce7', 
                                                                        color: '#166534', 
                                                                        border: '1px solid #bbf7d0', 
                                                                        borderRadius: '4px', 
                                                                        textDecoration: 'none', 
                                                                        fontSize: '0.7rem',
                                                                        fontWeight: 'bold'
                                                                    }}
                                                                >
                                                                    BOLETO
                                                                </a>
                                                            )}
                                                        </div>
                                                    </td>

                                                    <td style={{ padding: '1rem', color: '#334155', whiteSpace: 'nowrap' }}>{inv.vencimento ? inv.vencimento.split('-').reverse().join('/') : '-'}</td>
                                                    
                                                    {/* Unidade Consumidora clicável azul com borda */}
                                                    <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>
                                                        <span 
                                                            onClick={() => {
                                                                setSelectedInvoiceForSummary(inv);
                                                                setIsSummaryModalOpen(true);
                                                            }}
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                padding: '0.2rem 0.6rem',
                                                                background: '#eff6ff', 
                                                                color: '#2563eb', 
                                                                border: '1px solid #bfdbfe',
                                                                borderRadius: '99px',
                                                                fontSize: '0.8rem',
                                                                fontWeight: 'bold',
                                                                cursor: 'pointer',
                                                                transition: 'all 0.2s',
                                                                boxShadow: '0 1px 2px rgba(37, 99, 235, 0.05)'
                                                            }}
                                                            onMouseOver={(e) => {
                                                                e.currentTarget.style.background = '#dbeafe';
                                                                e.currentTarget.style.borderColor = '#93c5fd';
                                                            }}
                                                            onMouseOut={(e) => {
                                                                e.currentTarget.style.background = '#eff6ff';
                                                                e.currentTarget.style.borderColor = '#bfdbfe';
                                                            }}
                                                        >
                                                            {inv.consumer_units?.numero_uc || '-'}
                                                        </span>
                                                    </td>
                                                    
                                                    {/* Vr. Conta de Energia + Pagar */}
                                                     <td style={{ padding: '1rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                                                             <div style={{ fontWeight: '800', color: '#ef4444', fontSize: '1.1rem' }}>{formatCurrency(energyBillValue)}</div>
                                                             <div style={{ minWidth: '85px' }}>
                                                                 {inv.energy_bill_status === 'pago' ? (
                                                                     <span style={{ 
                                                                         display: 'block',
                                                                         textAlign: 'center',
                                                                         color: '#166534', 
                                                                         background: '#dcfce7', 
                                                                         padding: '0.4rem 0.2rem', 
                                                                         borderRadius: '4px', 
                                                                         fontSize: '0.7rem', 
                                                                         fontWeight: '800',
                                                                         border: '1px solid #bbf7d0'
                                                                     }}>PAGA</span>
                                                                 ) : inv.energy_bill_status === 'parcelada' ? (
                                                                     <span style={{ 
                                                                         display: 'block',
                                                                         textAlign: 'center',
                                                                         color: '#ca8a04', 
                                                                         background: '#fef9c3', 
                                                                         padding: '0.4rem 0.2rem', 
                                                                         borderRadius: '4px', 
                                                                         fontSize: '0.7rem', 
                                                                         fontWeight: '800',
                                                                         border: '1px solid #fef08a'
                                                                     }}>PARCELADA</span>
                                                                 ) : inv.energy_bill_status === 'contestada' ? (
                                                                     <span style={{ 
                                                                         display: 'block',
                                                                         textAlign: 'center',
                                                                         color: '#7c3aed', 
                                                                         background: '#f3e8ff', 
                                                                         padding: '0.4rem 0.2rem', 
                                                                         borderRadius: '4px', 
                                                                         fontSize: '0.7rem', 
                                                                         fontWeight: '800',
                                                                         border: '1px solid #e9d5ff'
                                                                     }}>CONTESTADA</span>
                                                                 ) : (inv.linha_digitavel && inv.consumer_units?.modalidade === 'auto_consumo_remoto') ? (
                                                                     <button 
                                                                         onClick={() => handlePayBill(inv)}
                                                                         disabled={payingId === inv.id}
                                                                         style={{ 
                                                                             width: '100%',
                                                                             background: '#ef4444', 
                                                                             color: 'white', 
                                                                             border: 'none', 
                                                                             padding: '0.4rem 0.2rem', 
                                                                             borderRadius: '4px', 
                                                                             fontSize: '0.7rem', 
                                                                             fontWeight: 'bold', 
                                                                             cursor: 'pointer',
                                                                             boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)'
                                                                         }}
                                                                     >
                                                                         {payingId === inv.id ? '...' : 'PAGAR'}
                                                                     </button>
                                                                 ) : null}
                                                             </div>
                                                         </div>
                                                     </td>

                                                    {/* Saldo */}
                                                    <td style={{ padding: '1rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                        <div style={{ 
                                                            fontWeight: 'bold', 
                                                            fontSize: '1rem',
                                                            color: balance >= -0.01 ? '#166534' : '#dc2626'
                                                        }}>
                                                            {formatCurrency(balance)}
                                                        </div>
                                                    </td>

                                                    {/* Ação Editar */}
                                                    <td style={{ padding: '1rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                        <button 
                                                            onClick={() => handleEdit(inv)} 
                                                            style={{ 
                                                                background: 'white', 
                                                                border: '1px solid #e2e8f0', 
                                                                padding: '0.4rem 0.8rem', 
                                                                borderRadius: '4px', 
                                                                cursor: 'pointer', 
                                                                fontSize: '0.75rem', 
                                                                color: '#475569', 
                                                                fontWeight: 'bold' 
                                                            }}
                                                        >
                                                            EDITAR
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                        </div>
                    ) : viewMode === 'energy_list' ? (
                        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ background: '#f8fafc' }}>
                                    <tr>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Código do Cliente</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Ref. Mês/Ano</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Valor a Pagar</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Vencimento</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Leitura Anterior</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Leitura Atual</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Consumo</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Compensado</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Status</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Assinante</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedInvoices.map(inv => {
                                        const cost = Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0));
                                        const today = new Date();
                                        today.setHours(0,0,0,0);
                                        const dueDate = inv.vencimento ? new Date(inv.vencimento) : null;
                                        const isPastDue = dueDate && dueDate < today;

                                        return (
                                            <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                {/* Código do Cliente clicável azul */}
                                                <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>
                                                    <span 
                                                        onClick={() => {
                                                            setSelectedInvoiceForSummary(inv);
                                                            setIsSummaryModalOpen(true);
                                                        }}
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            padding: '0.2rem 0.6rem',
                                                            background: '#eff6ff', 
                                                            color: '#2563eb', 
                                                            border: '1px solid #bfdbfe',
                                                            borderRadius: '99px',
                                                            fontSize: '0.8rem',
                                                            fontWeight: 'bold',
                                                            cursor: 'pointer',
                                                            transition: 'all 0.2s',
                                                            boxShadow: '0 1px 2px rgba(37, 99, 235, 0.05)'
                                                        }}
                                                        onMouseOver={(e) => {
                                                            e.currentTarget.style.background = '#dbeafe';
                                                            e.currentTarget.style.borderColor = '#93c5fd';
                                                        }}
                                                        onMouseOut={(e) => {
                                                            e.currentTarget.style.background = '#eff6ff';
                                                            e.currentTarget.style.borderColor = '#bfdbfe';
                                                        }}
                                                    >
                                                        {inv.consumer_units?.numero_uc || '-'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'center', color: '#475569', whiteSpace: 'nowrap' }}>
                                                    {inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('/') : '-'}
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'center', fontWeight: '800', color: '#ef4444', whiteSpace: 'nowrap' }}>
                                                    {formatCurrency(cost)}
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'center', color: '#475569', whiteSpace: 'nowrap' }}>
                                                    {inv.vencimento ? inv.vencimento.split('-').reverse().join('/') : '-'}
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'center', color: '#64748b', whiteSpace: 'nowrap' }}>
                                                    {getAnteriorLeitura(inv)}
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'center', color: '#475569', whiteSpace: 'nowrap' }}>
                                                    {inv.data_leitura ? inv.data_leitura.split('-').reverse().join('/') : '-'}
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'center', color: '#475569', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                                    {inv.consumo_kwh ? `${inv.consumo_kwh} kWh` : '-'}
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'center', color: '#16a34a', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                                    {inv.consumo_compensado ? `${inv.consumo_compensado} kWh` : '-'}
                                                </td>
                                                <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>
                                                    {getEnergyStatusBadge(inv.energy_bill_status || 'pendente', isPastDue)}
                                                </td>
                                                {/* Assinante com abreviação inteligente */}
                                                <td style={{ padding: '1rem', color: '#475569', fontWeight: '500', whiteSpace: 'nowrap' }}>
                                                    {abbreviateName(inv.consumer_units?.subscribers?.name)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : viewMode === 'kanban' ? (
                        <div className="kanban-box">
                            <div className="kanban-board">
                                {['ag_emissao_boleto', 'a_vencer', 'atrasado', 'confirmado', 'pago']
                                    .filter(status => !statusFilter || status === statusFilter)
                                    .map(status => {
                                        const invoicesInStatus = filteredInvoices.filter(inv => inv.status === status);
                                        const statusMap = { 
                                            'ag_emissao_boleto': { color: '#2563eb', bg: '#eff6ff', label: 'Sem Faturamento' },
                                            'confirmado': { color: '#0891b2', bg: '#ecfeff', label: 'Confirmado' },
                                            'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago' }, 
                                            'a_vencer': { color: '#854d0e', bg: '#fef9c3', label: 'A Vencer' }, 
                                            'atrasado': { color: '#dc2626', bg: '#fee2e2', label: 'Atrasado' } 
                                        };
                                    const s = statusMap[status] || { color: '#475569', bg: '#f1f5f9', label: status };
                                    return (
                                        <div 
                                            key={status} 
                                            className="kanban-column" 
                                            style={{ borderTop: `4px solid ${s.color}` }}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => handleDrop(e, status)}
                                        >
                                            <div className="kanban-column-header" style={{ color: s.color }}>
                                                <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>{s.label}</span>
                                                <span style={{ fontSize: '0.8rem', background: s.color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>{formatCurrency(invoicesInStatus.reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0))}</span>
                                            </div>
                                            <div className="kanban-column-content">
                                                {invoicesInStatus.map(inv => (
                                                    <div 
                                                        key={inv.id} 
                                                        onClick={() => handleEdit(inv)} 
                                                        className="kanban-card"
                                                        draggable
                                                        onDragStart={(e) => e.dataTransfer.setData('invoiceId', inv.id)}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                            <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)' }}>{inv.consumer_units?.numero_uc}</span>
                                                            <span style={{ fontSize: '1rem', color: '#1e293b', fontWeight: '800' }}>{inv.vencimento ? inv.vencimento.split('-').reverse().join('/') : '-'}</span>
                                                        </div>
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-dark)', fontWeight: '500' }}>{inv.consumer_units?.subscribers?.name}</div>
                                                        {inv.consumer_units?.titular_fatura?.name && (
                                                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', marginTop: '0.2rem' }}>
                                                                {inv.consumer_units.titular_fatura.name}
                                                            </div>
                                                        )}
                                                        <div style={{ fontWeight: 'bold', color: 'var(--color-blue)', marginTop: '0.5rem' }}>{formatCurrency(inv.valor_a_pagar)}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : viewMode === 'energy_kanban' ? (
                        <div className="kanban-box">
                            <div className="kanban-board">
                                {['a_vencer', 'atrasada', 'pago', 'contestada', 'parcelada', 'erro']
                                    .filter(col => !statusFilter || col === statusFilter)
                                    .map(col => {
                                    const invoicesInCol = filteredInvoices.filter(inv => {
                                        const ebStatus = inv.energy_bill_status || 'pendente';
                                        const today = new Date();
                                        today.setHours(0,0,0,0);
                                        const dueDate = inv.vencimento ? new Date(inv.vencimento) : null;
                                        const isPastDue = dueDate && dueDate < today;

                                        if (col === 'a_vencer') {
                                            return ebStatus === 'pendente' && !isPastDue;
                                        } else if (col === 'atrasada') {
                                            return ebStatus === 'pendente' && isPastDue;
                                        } else {
                                            return ebStatus === col;
                                        }
                                    });

                                    const colMap = { 
                                        'a_vencer': { color: '#2563eb', bg: '#eff6ff', label: 'A Vencer' }, 
                                        'atrasada': { color: '#dc2626', bg: '#fee2e2', label: 'Atrasada' },
                                        'pago': { color: '#166534', bg: '#dcfce7', label: 'Paga' }, 
                                        'contestada': { color: '#7c3aed', bg: '#f3e8ff', label: 'Contestada' },
                                        'parcelada': { color: '#ca8a04', bg: '#fef9c3', label: 'Parcelada' }, 
                                        'erro': { color: '#991b1b', bg: '#fef2f2', label: 'Erro' } 
                                    };
                                    const s = colMap[col];
                                    
                                    const totalAmount = invoicesInCol.reduce((acc, curr) => {
                                        const cost = Number(curr.valor_concessionaria) || ((Number(curr.tarifa_minima) || 0) + (Number(curr.iluminacao_publica) || 0) + (Number(curr.outros_lancamentos) || 0));
                                        return acc + cost;
                                    }, 0);

                                    return (
                                        <div 
                                            key={col} 
                                            className="kanban-column" 
                                            style={{ borderTop: `4px solid ${s.color}` }}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => handleEnergyDrop(e, col)}
                                        >
                                            <div className="kanban-column-header" style={{ color: s.color }}>
                                                <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>{s.label}</span>
                                                <span style={{ fontSize: '0.8rem', background: s.color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                                                    {formatCurrency(totalAmount)}
                                                </span>
                                            </div>
                                            <div className="kanban-column-content">
                                                {invoicesInCol.map(inv => {
                                                    const cost = Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0));
                                                    return (
                                                        <div 
                                                            key={inv.id} 
                                                            onClick={() => {
                                                                setSelectedInvoiceForSummary(inv);
                                                                setIsSummaryModalOpen(true);
                                                            }} 
                                                            className="kanban-card"
                                                            draggable
                                                            onDragStart={(e) => e.dataTransfer.setData('invoiceId', inv.id)}
                                                            style={{ cursor: 'pointer' }}
                                                        >
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                                <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)' }}>
                                                                    {inv.consumer_units?.numero_uc}
                                                                </span>
                                                                <span style={{ fontSize: '1rem', color: '#1e293b', fontWeight: '800' }}>
                                                                    {inv.vencimento ? inv.vencimento.split('-').reverse().join('/') : '-'}
                                                                </span>
                                                            </div>
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-dark)', fontWeight: '500' }}>
                                                                {inv.consumer_units?.subscribers?.name}
                                                            </div>
                                                            {inv.consumer_units?.concessionaria && (
                                                                <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', marginTop: '0.2rem' }}>
                                                                    {inv.consumer_units.concessionaria}
                                                                </div>
                                                            )}
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                                                                <span style={{ fontWeight: 'bold', color: '#ef4444' }}>
                                                                    {formatCurrency(cost)}
                                                                </span>
                                                                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                                                    {inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('/') : '-'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : viewMode === 'calendar' ? (
                        <div style={{ background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                            <InvoiceCalendarView invoices={filteredInvoices} onEdit={handleEdit} />
                        </div>
                    ) : (
                        <div style={{ background: '#fff1f2', borderRadius: '16px', border: '1px solid #fecaca' }}>
                            <EnergyCalendarView 
                                invoices={filteredInvoices} 
                                onInvoiceClick={(inv) => {
                                    setSelectedInvoiceForSummary(inv);
                                    setIsSummaryModalOpen(true);
                                }} 
                            />
                        </div>
                    )}
                </>
            )}

            {isModalOpen && <InvoiceFormModal invoice={selectedInvoice} ucs={ucs} onClose={() => setIsModalOpen(false)} onSave={handleSave} />}
            {isHistoryModalOpen && <InvoiceHistoryModal onClose={() => setIsHistoryModalOpen(false)} />}
            {isSummaryModalOpen && (
                <InvoiceSummaryModal 
                    invoice={selectedInvoiceForSummary} 
                    consumerUnit={selectedInvoiceForSummary?.consumer_units} 
                    onClose={() => setIsSummaryModalOpen(false)} 
                    onPaymentSuccess={fetchInvoices}
                />
            )}

        </div>
    );
}
