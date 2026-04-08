import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { createAsaasCharge } from '../../lib/api';
import InvoiceFormModal from '../../components/InvoiceFormModal';
import InvoiceHistoryModal from '../../components/InvoiceHistoryModal';
import { Search, Filter, Plus, FileText, CheckCircle, AlertCircle, Clock, CreditCard, Trash2, Ban, History, Layout, List, Info, Calendar as CalendarIcon, TicketCheck, TicketMinus, Download } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';
import InvoiceSummaryModal from '../../components/InvoiceSummaryModal';


export default function InvoiceListManager() {
    const { showAlert, showConfirm } = useUI();
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

    // Estados para o Resumo Financeiro
    const [selectedInvoiceForSummary, setSelectedInvoiceForSummary] = useState(null);
    const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);


    const filteredInvoices = invoices.filter(inv => {
        if (statusFilter && inv.status !== statusFilter) return false;
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
                        subscribers!consumer_units_subscriber_id_fkey(name)
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
            setInvoices(data || []);
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
                    .update({ status: 'pago' })
                    .eq('id', inv.id);
                
                if (updateError) throw updateError;

                showAlert('Pagamento agendado e fatura marcada como paga!', 'success');
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

    const formatCurrency = (val) => Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const getStatusBadge = (status) => {
        const map = {
            'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago', icon: CheckCircle },
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
        
        // Filtra faturas: apenas UCs ativas e modalidade Auto Consumo Remoto
        const filteredEnergyInvoices = invoices.filter(inv => 
            inv.consumer_units?.status === 'ativo' && 
            inv.consumer_units?.modalidade === 'auto_consumo_remoto'
        );
        const groupedInvoices = filteredEnergyInvoices.reduce((acc, inv) => {
            if (inv.vencimento && inv.status !== 'cancelado') {
                const date = new Date(inv.vencimento + 'T12:00:00');
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
                                        const statusData = {
                                            'pago': { color: '#166534', label: 'Pago', bg: '#dcfce7' },
                                            'atrasado': { color: '#dc2626', label: 'Atrasado', bg: '#fee2e2' },
                                            'a_vencer': { color: '#92400e', label: 'A Vencer', bg: '#fef9c3' }
                                        };
                                        const s = statusData[inv.status] || { color: '#64748b', label: inv.status, bg: '#f1f5f9' };
                                        const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);


                                        return (
                                            <div
                                                key={inv.id}
                                                onClick={() => onInvoiceClick(inv)}
                                                style={{
                                                    padding: '0.75rem',
                                                    borderRadius: '10px',
                                                    background: 'white',
                                                    border: '1px solid #e2e8f0',
                                                    cursor: 'pointer', 
                                                    transition: 'all 0.2s',
                                                    display: 'flex', 
                                                    flexDirection: 'column', 
                                                    gap: '0.4rem', 
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                }}
                                                onMouseOver={e => e.currentTarget.style.borderColor = '#3b82f6'}
                                                onMouseOut={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                                            >
                                                <div style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '0.85rem' }}>
                                                    {inv.consumer_units?.subscribers?.name || 'S/ Assinante'}
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>UC: {inv.consumer_units?.numero_uc}</span>
                                                    <span style={{ padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 800, background: s.bg, color: s.color }}>
                                                        {s.label}
                                                    </span>
                                                </div>
                                                <div style={{ fontWeight: 900, color: '#1e293b', fontSize: '0.9rem', marginTop: '0.2rem', textAlign: 'right' }}>
                                                    {formatCurrency(inv.valor_a_pagar)}
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
        </div>
        );
    };



    return (
        <div style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                    <h2 style={{ color: 'var(--color-blue)', fontSize: '1.8rem', fontWeight: 'bold', margin: 0 }}>Faturas</h2>
                    <p style={{ color: '#64748b', margin: 0 }}>Gerencie os lançamentos mensais das Unidades Consumidoras</p>
                </div>
            </div>

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
                        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '0.4rem', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.85rem' }}>
                            <option value="">Status</option>
                            <option value="a_vencer">A Vencer</option>
                            <option value="atrasado">Atrasado</option>
                            <option value="pago">Pago</option>
                        </select>
                        <div style={{ width: '1px', height: '16px', background: '#e2e8f0' }}></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Search size={16} color="#64748b" />
                            <input placeholder="Buscar UC..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ padding: '0.4rem', border: 'none', outline: 'none', fontSize: '0.85rem', width: '120px' }} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <div className="btn-group" style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <button onClick={() => setViewMode('list')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'list' ? 'white' : 'transparent', color: viewMode === 'list' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'list' ? '700' : '500', fontSize: '0.85rem' }}>
                                <List size={16} /> Lista
                            </button>
                            <button onClick={() => setViewMode('kanban')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'kanban' ? 'white' : 'transparent', color: viewMode === 'kanban' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'kanban' ? '700' : '500', fontSize: '0.85rem' }}>
                                <Layout size={16} /> Kanban
                            </button>
                            <button onClick={() => setViewMode('calendar')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'calendar' ? 'white' : 'transparent', color: viewMode === 'calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'calendar' ? '700' : '500', fontSize: '0.85rem' }}>
                                <CalendarIcon size={16} /> Venc. Faturas
                            </button>
                            <button onClick={() => setViewMode('energy_calendar')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'energy_calendar' ? 'white' : 'transparent', color: viewMode === 'energy_calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'energy_calendar' ? '700' : '500', fontSize: '0.85rem' }}>
                                <CreditCard size={16} /> Venc. Conta de Energia
                            </button>
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
                {viewMode === 'energy_calendar' && (
                    <div style={{
                        padding: '0.75rem 1rem',
                        background: 'rgba(255, 255, 255, 0.4)',
                        borderRadius: '12px',
                        border: '1px solid rgba(226, 232, 240, 0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2.5rem'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#22c55e' }}></div>
                            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Pagos: {invoices.filter(i => i.status === 'pago').length}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ef4444' }}></div>
                            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>Atrasadas: {invoices.filter(i => i.status === 'atrasado').length}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#3b82f6' }}></div>
                            <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '700' }}>A Vencer: {invoices.filter(i => i.status === 'a_vencer').length}</span>
                        </div>
                    </div>
                )}
            </div>

            {loading ? <p>Carregando...</p> : filteredInvoices.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', background: 'white', borderRadius: '12px', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '1rem' }}><FileText size={48} /></div>
                    <h3 style={{ color: '#475569', fontWeight: 'bold' }}>{monthFilter === 'all' ? 'Nenhuma Fatura encontrada' : 'Nenhuma Fatura emitida para o Mês selecionado'}</h3>
                </div>
            ) : (
                <>
                    {viewMode === 'list' ? (
                        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ background: '#f8fafc' }}>
                                    <tr>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Status</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Vencimento</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Unidade Consumidora</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Valor</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredInvoices.map(inv => (
                                        <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '1rem' }}>{getStatusBadge(inv.status)}</td>
                                            <td style={{ padding: '1rem', color: '#334155' }}>{inv.vencimento ? new Date(inv.vencimento).toLocaleDateString('pt-BR') : '-'}</td>
                                            <td style={{ padding: '1rem' }}>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>{inv.consumer_units?.numero_uc || 'N/A'}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{inv.consumer_units?.subscribers?.name}</div>
                                            </td>
                                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: 'center' }}>
                                                    <div style={{ fontWeight: 'bold', color: '#0f172a' }}>{formatCurrency(inv.valor_a_pagar)}</div>
                                                    <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                                                        <span>v. conta:</span>
                                                        <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
                                                            {formatCurrency((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0))}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', alignItems: 'center' }}>
                                                    {/* Botão PAGAR ou Status PAGA */}
                                                    <div style={{ width: '85px', display: 'flex', justifyContent: 'center' }}>
                                                        {inv.status === 'pago' ? (
                                                            <span style={{ 
                                                                width: '100%',
                                                                textAlign: 'center',
                                                                color: '#166534', 
                                                                background: '#dcfce7', 
                                                                padding: '0.4rem 0.2rem', 
                                                                borderRadius: '4px', 
                                                                fontSize: '0.7rem', 
                                                                fontWeight: '800',
                                                                border: '1px solid #bbf7d0',
                                                                display: 'block'
                                                            }}>PAGA</span>
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

                                                    {/* Botão BOLETO (Asaas) */}
                                                    <div style={{ width: '85px', display: 'flex', justifyContent: 'center' }}>
                                                        {inv.asaas_boleto_url ? (
                                                            <a 
                                                                href={inv.asaas_boleto_url} 
                                                                target="_blank" 
                                                                rel="noopener noreferrer" 
                                                                style={{ 
                                                                    width: '100%',
                                                                    textAlign: 'center',
                                                                    background: '#dcfce7', 
                                                                    color: '#166534', 
                                                                    border: '1px solid #bbf7d0', 
                                                                    padding: '0.4rem 0.2rem', 
                                                                    borderRadius: '4px', 
                                                                    textDecoration: 'none', 
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: 'bold',
                                                                    display: 'block'
                                                                }}
                                                            >
                                                                BOLETO
                                                            </a>
                                                        ) : (
                                                            <div style={{ width: '100%' }}></div>
                                                        )}
                                                    </div>

                                                    {/* Botão EDITAR */}
                                                    <div style={{ width: '85px', display: 'flex', justifyContent: 'center' }}>
                                                        <button 
                                                            onClick={() => handleEdit(inv)} 
                                                            style={{ 
                                                                width: '100%',
                                                                background: 'white', 
                                                                border: '1px solid #e2e8f0', 
                                                                padding: '0.4rem 0.2rem', 
                                                                borderRadius: '4px', 
                                                                cursor: 'pointer', 
                                                                fontSize: '0.7rem', 
                                                                color: '#475569', 
                                                                fontWeight: 'bold' 
                                                            }}
                                                        >
                                                            EDITAR
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : viewMode === 'kanban' ? (
                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '1rem' }}>
                            {['a_vencer', 'atrasado', 'pago'].map(status => {
                                const invoicesInStatus = filteredInvoices.filter(inv => inv.status === status);
                                const statusMap = { 'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago' }, 'a_vencer': { color: '#854d0e', bg: '#fef9c3', label: 'A Vencer' }, 'atrasado': { color: '#dc2626', bg: '#fee2e2', label: 'Atrasado' } };
                                const s = statusMap[status] || statusMap['a_vencer'];
                                return (
                                    <div key={status} style={{ minWidth: '320px', flex: 1, background: 'var(--color-bg-light)', borderRadius: 'var(--radius-md)', padding: '0.5rem', borderTop: `4px solid ${s.color}`, boxShadow: 'var(--shadow-sm)' }}>
                                        <h4 style={{ padding: '0.8rem', borderBottom: '1px solid var(--color-border)', background: 'white', borderRadius: 'var(--radius-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', color: s.color }}>
                                            <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>{s.label}</span>
                                            <span style={{ fontSize: '0.8rem', background: s.color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>{formatCurrency(invoicesInStatus.reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0))}</span>
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {invoicesInStatus.map(inv => (
                                                <div key={inv.id} onClick={() => handleEdit(inv)} style={{ background: 'white', padding: '1rem', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', border: '1px solid transparent', transition: '0.2s' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                        <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)' }}>{inv.consumer_units?.numero_uc}</span>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-medium)' }}>{inv.vencimento ? new Date(inv.vencimento).toLocaleDateString('pt-BR') : '-'}</span>
                                                    </div>
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-dark)', fontWeight: '500' }}>{inv.consumer_units?.subscribers?.name}</div>
                                                    <div style={{ fontWeight: 'bold', color: 'var(--color-blue)', marginTop: '0.5rem' }}>{formatCurrency(inv.valor_a_pagar)}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
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
