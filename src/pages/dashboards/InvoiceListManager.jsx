import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { createAsaasCharge } from '../../lib/api';
import InvoiceFormModal from '../../components/InvoiceFormModal';
import InvoiceHistoryModal from '../../components/InvoiceHistoryModal';
import StandaloneAnalysisModal from '../../components/StandaloneAnalysisModal';
import ConsumerUnitModal from '../../components/ConsumerUnitModal';
import { Search, Filter, Plus, FileText, CheckCircle, AlertCircle, Clock, CreditCard, Trash2, Ban, History, Layout, List, Info, Calendar as CalendarIcon, TicketCheck, TicketMinus, Download, CheckCircle2, X, Zap, BarChart2, Printer, Link as LinkIcon } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';
import InvoiceSummaryModal from '../../components/InvoiceSummaryModal';
import { useAuth } from '../../contexts/AuthContext';
import AuditGraphViewInvoiceSummary from './AuditGraphViewInvoiceSummary';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

let pageSessionState = {
    // Configurações salvas para a aba de Faturas
    faturas: {
        viewMode: 'kanban',
        monthFilter: new Date().toISOString().substring(0, 7),
        statusFilter: '',
        statusFaturaFilter: '',
        sortBy: 'ref_desc',
        filterCriterion: 'vencimento',
        readingStatusFilter: ''
    },
    // Configurações salvas para a aba de Contas de Energia
    contas_energia: {
        viewMode: 'energy_kanban',
        monthFilter: new Date().toISOString().substring(0, 7),
        statusFilter: '',
        statusFaturaFilter: '',
        sortBy: 'ref_desc',
        filterCriterion: 'vencimento',
        readingStatusFilter: ''
    },
    activeTab: null
};

export default function InvoiceListManager({ initialTab = 'faturas', hideTabs = false }) {
    const { showAlert, showConfirm } = useUI();
    const { profile } = useAuth();
    const showAuditorTab = ['admin', 'super_admin', 'manager'].includes(profile?.role);
    const [invoices, setInvoices] = useState([]);
    const [ucs, setUcs] = useState([]);
    const [loading, setLoading] = useState(true);

    // Determinar a aba ativa inicial
    const resolvedActiveTab = hideTabs ? initialTab : (pageSessionState.activeTab || initialTab);
    const [activeTab, setActiveTab] = useState(resolvedActiveTab);

    // Obter as configurações salvas na sessão para a aba atual
    const savedState = pageSessionState[resolvedActiveTab] || {};

    const [viewMode, setViewMode] = useState(() => savedState.viewMode || (resolvedActiveTab === 'contas_energia' ? 'energy_kanban' : 'kanban'));
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [monthFilter, setMonthFilter] = useState(() => savedState.monthFilter || new Date().toISOString().substring(0, 7));
    const [statusFilter, setStatusFilter] = useState(() => savedState.statusFilter || '');
    const [statusFaturaFilter, setStatusFaturaFilter] = useState(() => savedState.statusFaturaFilter || '');
    const [searchTerm, setSearchTerm] = useState('');
    const [generatingId, setGeneratingId] = useState(null);
    const [showMonthPicker, setShowMonthPicker] = useState(false);
    const [showTooltip, setShowTooltip] = useState(false);
    const [payingId, setPayingId] = useState(null);
    const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

    // Estado de Ordenação
    const [sortBy, setSortBy] = useState(() => savedState.sortBy || 'ref_desc');
    // Estado de exibição do detalhe informativo da aba (! Info)
    const [activeInfoTab, setActiveInfoTab] = useState(null);

    // Estados para o Resumo Financeiro
    const [selectedInvoiceForSummary, setSelectedInvoiceForSummary] = useState(null);
    const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);

    // Estado do Calendário de Leituras das UCs
    const [readingStatusFilter, setReadingStatusFilter] = useState(() => savedState.readingStatusFilter || '');
    const [selectedUcForModal, setSelectedUcForModal] = useState(null);
    const [isUcModalOpen, setIsUcModalOpen] = useState(false);
    const [ucModalSection, setUcModalSection] = useState('geral');
    const [filterCriterion, setFilterCriterion] = useState(() => savedState.filterCriterion || 'vencimento'); // 'mes_referencia' | 'vencimento'
    const [dropTarget, setDropTarget] = useState(null);
    const [draggedInvoice, setDraggedInvoice] = useState(null);

    const handleCalendarCardClick = (uc) => {
        if (uc.matchingInvoice) {
            setSelectedInvoiceForSummary(uc.matchingInvoice);
            setIsSummaryModalOpen(true);
        } else {
            setSelectedUcForModal(uc);
            setUcModalSection('geral');
            setIsUcModalOpen(true);
        }
    };

    // Efeito para sincronizar os estados salvos quando o usuário clica no menu do CRM (initialTab muda)
    useEffect(() => {
        if (initialTab) {
            setActiveTab(initialTab);
            const saved = pageSessionState[initialTab] || {};
            
            // Restaura o modo de visualização salvo desta aba específica
            if (saved.viewMode) {
                setViewMode(saved.viewMode);
            } else {
                setViewMode(initialTab === 'contas_energia' ? 'energy_kanban' : 'kanban');
            }
            
            // Restaura os filtros salvos desta aba específica
            if (saved.monthFilter) setMonthFilter(saved.monthFilter);
            if (saved.statusFilter !== undefined) setStatusFilter(saved.statusFilter);
            if (saved.statusFaturaFilter !== undefined) setStatusFaturaFilter(saved.statusFaturaFilter);
            if (saved.sortBy) setSortBy(saved.sortBy);
            if (saved.filterCriterion) setFilterCriterion(saved.filterCriterion);
            if (saved.readingStatusFilter !== undefined) setReadingStatusFilter(saved.readingStatusFilter);
        }
    }, [initialTab]);

    // Efeito para salvar qualquer alteração de estado da aba ativa na sessão global
    useEffect(() => {
        if (!pageSessionState[activeTab]) {
            pageSessionState[activeTab] = {};
        }
        pageSessionState[activeTab].viewMode = viewMode;
        pageSessionState[activeTab].monthFilter = monthFilter;
        pageSessionState[activeTab].statusFilter = statusFilter;
        pageSessionState[activeTab].statusFaturaFilter = statusFaturaFilter;
        pageSessionState[activeTab].sortBy = sortBy;
        pageSessionState[activeTab].filterCriterion = filterCriterion;
        pageSessionState[activeTab].readingStatusFilter = readingStatusFilter;
        pageSessionState.activeTab = activeTab;
    }, [viewMode, monthFilter, statusFilter, statusFaturaFilter, sortBy, filterCriterion, readingStatusFilter, activeTab]);

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        const saved = pageSessionState[tab] || {};
        
        if (saved.viewMode) {
            setViewMode(saved.viewMode);
        } else {
            if (tab === 'faturas') {
                if (viewMode === 'energy_list') setViewMode('list');
                else if (viewMode === 'energy_kanban') setViewMode('kanban');
                else if (viewMode === 'energy_calendar') setViewMode('calendar');
                else if (viewMode === 'energy_reading_calendar') setViewMode('calendar');
                else if (viewMode === 'graph_node') setViewMode('graph_node');
                else setViewMode('kanban');
            } else if (tab === 'contas_energia') {
                if (viewMode === 'list') setViewMode('energy_list');
                else if (viewMode === 'kanban') setViewMode('energy_kanban');
                else if (viewMode === 'calendar') setViewMode('energy_calendar');
                else if (viewMode === 'graph_node') setViewMode('graph_node');
                else setViewMode('energy_kanban');
            }
        }
        
        if (saved.monthFilter) setMonthFilter(saved.monthFilter);
        if (saved.statusFilter !== undefined) setStatusFilter(saved.statusFilter);
        if (saved.statusFaturaFilter !== undefined) setStatusFaturaFilter(saved.statusFaturaFilter);
        if (saved.sortBy) setSortBy(saved.sortBy);
        if (saved.filterCriterion) setFilterCriterion(saved.filterCriterion);
        if (saved.readingStatusFilter !== undefined) setReadingStatusFilter(saved.readingStatusFilter);
    };

    const getAnteriorLeitura = (currentInvoice) => {
        if (currentInvoice.data_leitura_anterior) {
            return currentInvoice.data_leitura_anterior.split('T')[0].split('-').reverse().join('/');
        }
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
        if (inv.parent_invoice_id) return false;
        
        if (activeTab === 'faturas') {
            // Permitir 'sem_faturamento' na aba de faturas para auditoria e conferência antes do envio
            // if (inv.status === 'sem_faturamento') return false;
            
            // Se ambos os valores forem zero ou nulos, não exibir no dashboard financeiro
            const valPagar = Number(inv.valor_a_pagar) || 0;
            const valConcessionaria = Number(inv.valor_concessionaria) || 0;
            if (valPagar <= 0 && valConcessionaria <= 0) return false;

            if (statusFilter) {
                const filterVal = statusFilter === 'ag_emissao_boleto' ? 'sem_faturamento' : statusFilter;
                const recordVal = inv.status === 'ag_emissao_boleto' ? 'sem_faturamento' : inv.status;
                if (recordVal !== filterVal) return false;
            }
        } else {
            // Contas de energia (Concessionária)
            if (!['auto_consumo_remoto', 'geracao_compartilhada'].includes(inv.consumer_units?.modalidade)) return false;
            // Contas 'sem_faturamento' (apenas operacionais) devem aparecer aqui, pois são contas da concessionária.
            // if (inv.status === 'sem_faturamento') return false;

            if (statusFilter) {
                const ebStatus = inv.energy_bill_status || 'pendente';
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dueDate = (inv.vencimento_concessionaria || inv.vencimento) ? new Date(inv.vencimento_concessionaria || inv.vencimento) : null;
                const isPastDue = dueDate && dueDate < today;

                if (statusFilter === 'atrasada') {
                    if (ebStatus !== 'pendente' || !isPastDue) return false;
                } else if (statusFilter === 'a_vencer') {
                    if (ebStatus !== 'pendente' || isPastDue) return false;
                } else {
                    if (ebStatus !== statusFilter) return false;
                }
            }
            if (statusFaturaFilter) {
                if (inv.status !== statusFaturaFilter) return false;
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
        let primaryResult = 0;
        if (sortBy === 'ref_desc') {
            const dateA = a.mes_referencia ? new Date(a.mes_referencia) : new Date(0);
            const dateB = b.mes_referencia ? new Date(b.mes_referencia) : new Date(0);
            primaryResult = dateB - dateA;
        } else if (sortBy === 'ref_asc') {
            const dateA = a.mes_referencia ? new Date(a.mes_referencia) : new Date(0);
            const dateB = b.mes_referencia ? new Date(b.mes_referencia) : new Date(0);
            primaryResult = dateA - dateB;
        } else if (sortBy === 'venc_desc') {
            const dateA = a.vencimento ? new Date(a.vencimento) : new Date(0);
            const dateB = b.vencimento ? new Date(b.vencimento) : new Date(0);
            primaryResult = dateB - dateA;
        } else if (sortBy === 'venc_asc') {
            const dateA = a.vencimento ? new Date(a.vencimento) : new Date(0);
            const dateB = b.vencimento ? new Date(b.vencimento) : new Date(0);
            primaryResult = dateA - dateB;
        } else if (sortBy === 'uc_asc') {
            const ucA = a.consumer_units?.numero_uc || '';
            const ucB = b.consumer_units?.numero_uc || '';
            primaryResult = ucA.localeCompare(ucB);
        } else if (sortBy === 'uc_desc') {
            const ucA = a.consumer_units?.numero_uc || '';
            const ucB = b.consumer_units?.numero_uc || '';
            primaryResult = ucB.localeCompare(ucA);
        } else if (sortBy === 'valor_desc') {
            const valA = Number(a.valor_concessionaria) || ((Number(a.tarifa_minima) || 0) + (Number(a.iluminacao_publica) || 0) + (Number(a.outros_lancamentos) || 0));
            const valB = Number(b.valor_concessionaria) || ((Number(b.tarifa_minima) || 0) + (Number(b.iluminacao_publica) || 0) + (Number(b.outros_lancamentos) || 0));
            primaryResult = valB - valA;
        } else if (sortBy === 'valor_asc') {
            const valA = Number(a.valor_concessionaria) || ((Number(a.tarifa_minima) || 0) + (Number(a.iluminacao_publica) || 0) + (Number(a.outros_lancamentos) || 0));
            const valB = Number(b.valor_concessionaria) || ((Number(b.tarifa_minima) || 0) + (Number(b.iluminacao_publica) || 0) + (Number(b.outros_lancamentos) || 0));
            primaryResult = valA - valB;
        } else if (sortBy === 'assinante_asc') {
            const nameA = a.consumer_units?.subscribers?.name || '';
            const nameB = b.consumer_units?.subscribers?.name || '';
            primaryResult = nameA.localeCompare(nameB);
        } else if (sortBy === 'assinante_desc') {
            const nameA = a.consumer_units?.subscribers?.name || '';
            const nameB = b.consumer_units?.subscribers?.name || '';
            primaryResult = nameB.localeCompare(nameA);
        }

        // Se o critério principal empatar e não for ordenação primária pelo próprio mês de referência,
        // aplica a ordenação secundária: Mês de Ref. com o Mais Novo Primeiro (decrescente)
        if (primaryResult === 0 && sortBy !== 'ref_desc' && sortBy !== 'ref_asc') {
            const dateA = a.mes_referencia ? new Date(a.mes_referencia) : new Date(0);
            const dateB = b.mes_referencia ? new Date(b.mes_referencia) : new Date(0);
            return dateB - dateA; // Mais novo primeiro
        }

        return primaryResult;
    });

    const getInvoiceDueDate = (inv) => {
        if (!inv) return 'Não Faturado';
        if (inv.status === 'sem_faturamento' || inv.status === 'ag_emissao_boleto') {
            return 'Não Faturado';
        }
        const refMonth = inv.mes_referencia;
        const dueDay = inv.consumer_units?.dia_vencimento;
        if (!refMonth || !dueDay) return 'Não Faturado';

        const parts = refMonth.split('-');
        if (parts.length < 2) return 'Não Faturado';
        
        let year = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10);

        let nextMonth = month + 1;
        let nextYear = year;
        if (nextMonth > 12) {
            nextMonth = 1;
            nextYear = year + 1;
        }

        const formattedDay = String(dueDay).padStart(2, '0');
        const formattedMonth = String(nextMonth).padStart(2, '0');
        return `${formattedDay}/${formattedMonth}/${nextYear}`;
    };

    const handleGenerateExtrato = () => {
        if (sortedInvoices.length === 0) {
            showAlert('Nenhum registro para exportar.', 'warning');
            return;
        }

        const doc = new jsPDF('l', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();

        // Título e Header
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 51, 102); // Navy Blue
        doc.text('EXTRATO DE FATURAS E EVENTOS', 14, 18);
        
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139); // Slate Grey
        const generationDate = new Date().toLocaleString('pt-BR');
        doc.text(`Gerado em: ${generationDate}`, pageWidth - 14, 18, { align: 'right' });

        // Linha divisória
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(14, 22, pageWidth - 14, 22);

        // Resumo financeiro / Filtros aplicados
        const totalFact = sortedInvoices.reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0);
        
        const totalAtrasado = sortedInvoices
            .filter(inv => inv.status === 'atrasado')
            .reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0);
        const totalSemFaturamento = sortedInvoices
            .filter(inv => inv.status === 'sem_faturamento')
            .reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0);
        const totalPago = sortedInvoices
            .filter(inv => inv.status === 'pago' || inv.status === 'confirmado')
            .reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0);
        const totalAVencer = sortedInvoices
            .filter(inv => inv.status === 'a_vencer')
            .reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0);

        let statusSummaryText = `Atrasado: ${formatCurrency(totalAtrasado)}    |    Sem Faturamento: ${formatCurrency(totalSemFaturamento)}    |    Pago: ${formatCurrency(totalPago)}`;
        if (totalAVencer > 0) {
            statusSummaryText += `    |    A Vencer: ${formatCurrency(totalAVencer)}`;
        }

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42); // Charcoal
        doc.text(`Total Faturas: ${formatCurrency(totalFact)}`, 14, 29);
        doc.text(`Total Registros: ${sortedInvoices.length}`, pageWidth - 14, 29, { align: 'right' });

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105); // Slate 600
        doc.text(statusSummaryText, 14, 35);

        // Mapear dados para a tabela
        const tableBody = sortedInvoices.map(inv => {
            const factValue = Number(inv.valor_a_pagar) || 0;
            const energyBillValue = Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0) + (Number(inv.consumo_reais) || 0));
            const statusLabel = 
                inv.status === 'sem_faturamento' ? 'Sem Faturamento' : 
                inv.status === 'pago' ? 'Pago' : 
                inv.status === 'a_vencer' ? 'A Vencer' : 
                inv.status === 'atrasado' ? 'Atrasado' : 
                inv.status === 'em_transf_titularidade' ? 'Em Transf. Titularidade' : 
                inv.status === 'desconectado' ? 'Desconectado' : 
                inv.status === 'ag_emissao_boleto' ? 'Aguardando Emissão' : 
                inv.status === 'cancelado' ? 'Cancelado' : inv.status || '-';

            return [
                inv.consumer_units?.numero_uc || '-',
                abbreviateName(inv.consumer_units?.subscribers?.name || inv.consumer_units?.titular_conta, 20),
                inv.mes_referencia ? (() => {
                    const [year, month] = inv.mes_referencia.split('-');
                    return `${month}/${year}`;
                })() : '-',
                inv.consumo_compensado ? `${inv.consumo_compensado} kWh` : '-',
                formatCurrency(energyBillValue),
                getInvoiceDueDate(inv),
                getAnteriorLeitura(inv),
                inv.data_leitura ? inv.data_leitura.split('T')[0].split('-').reverse().join('/') : '-',
                formatCurrency(factValue),
                statusLabel
            ];
        });

        // Tabela autoTable
        autoTable(doc, {
            startY: 40,
            head: [[
                'Unidade Consumidora', 
                'Assinante / Titular', 
                'Mês Ref.', 
                'Energia Compensada', 
                'Conta Energia', 
                'Vencimento', 
                'Leitura Ant.', 
                'Leitura Atual', 
                'Vr. Fatura', 
                'Status'
            ]],
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [0, 51, 102], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
            bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            margin: { left: 14, right: 14 },
            columnStyles: {
                0: { cellWidth: 32 },
                1: { cellWidth: 45 },
                2: { cellWidth: 16, halign: 'center' },
                3: { cellWidth: 28, halign: 'center' },
                4: { cellWidth: 26, halign: 'right' },
                5: { cellWidth: 24, halign: 'center' },
                6: { cellWidth: 22, halign: 'center' },
                7: { cellWidth: 22, halign: 'center' },
                8: { cellWidth: 26, halign: 'right' },
                9: { cellWidth: 28, halign: 'center' }
            },
            didDrawPage: (data) => {
                const str = `Página ${data.pageNumber}`;
                doc.setFontSize(8);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(148, 163, 184);
                doc.text(str, pageWidth - 14, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
            }
        });

        doc.save(`Extrato_Faturas_${new Date().toISOString().substring(0, 10)}.pdf`);
        showAlert('Extrato gerado com sucesso!', 'success');
    };

    const resolveEnergyStatus = (inv) => {
        const ebStatus = inv.energy_bill_status || 'pendente';
        if (ebStatus === 'pago') return 'pago';
        if (ebStatus === 'erro') return 'erro';
        if (ebStatus === 'parcelada') return 'parcelada';
        if (ebStatus === 'contestada') return 'contestada';
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueDate = (inv.vencimento_concessionaria || inv.vencimento) ? new Date(inv.vencimento_concessionaria || inv.vencimento) : null;
        if (dueDate && dueDate < today) {
            return 'atrasada';
        }
        return 'a_vencer';
    };

    const faturasStatuses = [
        { key: 'sem_faturamento', label: 'Sem Faturamento', color: '#2563eb', bg: '#eff6ff' },
        { key: 'a_vencer', label: 'A Vencer', color: '#ca8a04', bg: '#fef9c3' },
        { key: 'atrasado', label: 'Atrasado', color: '#dc2626', bg: '#fee2e2' },
        { key: 'confirmado', label: 'Confirmado', color: '#0891b2', bg: '#ecfeff' },
        { key: 'pago', label: 'Pago', color: '#166534', bg: '#dcfce7' }
    ];

    const contasStatuses = [
        { key: 'a_vencer', label: 'A Vencer', color: '#2563eb', bg: '#eff6ff' },
        { key: 'inconsistente', label: 'Inconsistente', color: '#ea580c', bg: '#ffedd5' },
        { key: 'contestada', label: 'Contestada', color: '#7c3aed', bg: '#f3e8ff' },
        { key: 'parcelada', label: 'Parcelada', color: '#ca8a04', bg: '#fef9c3' },
        { key: 'atrasada', label: 'Atrasada', color: '#dc2626', bg: '#fee2e2' },
        { key: 'pago', label: 'Paga', color: '#166534', bg: '#dcfce7' }
    ];

    // Faturas/Contas list that ignores status filter for calculating totals dynamically
    const invoicesForTotals = invoices.filter(inv => {
        if (inv.status === 'cancelado') return false;

        if (activeTab === 'faturas') {
            // Permitir 'sem_faturamento' no cálculo de totais
            // if (inv.status === 'sem_faturamento') return false;
            const valPagar = Number(inv.valor_a_pagar) || 0;
            const valConcessionaria = Number(inv.valor_concessionaria) || 0;
            if (valPagar <= 0 && valConcessionaria <= 0) return false;
        } else {
            if (!['auto_consumo_remoto', 'geracao_compartilhada'].includes(inv.consumer_units?.modalidade)) return false;
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

    const faturasCounts = invoicesForTotals.reduce((acc, inv) => {
        const status = inv.status === 'ag_emissao_boleto' ? 'sem_faturamento' : inv.status;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    const contasCounts = invoicesForTotals.reduce((acc, inv) => {
        const status = resolveEnergyStatus(inv);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    useEffect(() => {
        fetchInvoices();
        fetchUcs();
    }, [monthFilter, filterCriterion]);

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
                        tarifa_concessionaria,
                        desconto_assinante,
                        address,
                        subscribers!consumer_units_subscriber_id_fkey(id, name, email, phone),
                        titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(id, name, email, phone)
                    )
                `);

            if (monthFilter !== 'all') {
                const [year, month] = monthFilter.split('-');
                const startDate = `${year}-${month}-01`;
                const lastDay = new Date(year, month, 0).getDate();
                const endDate = `${year}-${month}-${lastDay}`;
                if (filterCriterion === 'mes_referencia') {
                    query = query.gte('mes_referencia', startDate).lte('mes_referencia', endDate);
                } else {
                    query = query.gte('vencimento', startDate).lte('vencimento', endDate);
                }
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
                status, dia_leitura, created_at, last_scraping_status,
                subscribers!consumer_units_subscriber_id_fkey(name, cpf_cnpj, portal_credentials),
                titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name, portal_credentials)
            `)
            .in('status', ['ativo', 'desconectado'])
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
            const dbStatus = newStatus === 'ag_emissao_boleto' ? 'sem_faturamento' : newStatus;
            const { error } = await supabase.from('invoices').update({ status: dbStatus }).eq('id', invoiceId);
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
        }
    };

    const handleInvoiceJoinDrop = async (e, targetInvoiceId) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(null);
        setDraggedInvoice(null);
        
        const draggedInvoiceId = e.dataTransfer.getData('invoiceId');
        if (!draggedInvoiceId || draggedInvoiceId === targetInvoiceId) return;

        const draggedInv = invoices.find(i => i.id === draggedInvoiceId);
        const targetInv = invoices.find(i => i.id === targetInvoiceId);
        
        if (!draggedInv || !targetInv) return;
        
        if (draggedInv.uc_id !== targetInv.uc_id) {
            showAlert('Apenas faturas da mesma Unidade Consumidora podem ser vinculadas.', 'warning');
            return;
        }

        try {
            const { error } = await supabase
                .from('invoices')
                .update({ parent_invoice_id: targetInvoiceId })
                .eq('id', draggedInvoiceId);
            if (error) throw error;
            
            showAlert('Conta incorporada com sucesso como parcelamento!', 'success');
            fetchInvoices();
        } catch (err) {
            console.error('Erro ao vincular conta:', err);
            showAlert('Erro ao vincular conta.', 'error');
        }
    };

    const getEnergyStatusBadge = (status, isPastDue) => {
        const statusMap = {
            'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago', icon: CheckCircle },
            'pendente': isPastDue 
                ? { color: '#dc2626', bg: '#fee2e2', label: 'Atrasado', icon: AlertCircle }
                : { color: '#2563eb', bg: '#eff6ff', label: 'A Vencer', icon: Clock },
            'inconsistente': { color: '#ea580c', bg: '#ffedd5', label: 'Inconsistente', icon: AlertCircle },
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
            'sem_faturamento': { color: '#2563eb', bg: '#eff6ff', label: 'Sem Faturamento', icon: FileText },
            'ag_emissao_boleto': { color: '#2563eb', bg: '#eff6ff', label: 'Sem Faturamento', icon: FileText },
            'a_vencer': { color: '#854d0e', bg: '#fef9c3', label: 'A Vencer', icon: Clock },
            'atrasado': { color: '#dc2626', bg: '#fee2e2', label: 'Atrasado', icon: AlertCircle },
            'confirmado': { color: '#0891b2', bg: '#ecfeff', label: 'Pagamento Confirmado', icon: CheckCircle2 },
            'pago': { color: '#166534', bg: '#dcfce7', label: 'Pago', icon: CheckCircle },
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
                                            'sem_faturamento': { color: '#2563eb', label: 'Sem Faturamento', bg: '#eff6ff' },
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
        
        // Filtra faturas: apenas modalidade Auto Consumo Remoto ou Geração Compartilhada
        const filteredEnergyInvoices = invoices.filter(inv => 
            ['auto_consumo_remoto', 'geracao_compartilhada'].includes(inv.consumer_units?.modalidade) &&
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
        <div style={{ padding: '0 2rem 2rem 2rem', maxWidth: '1600px', margin: '0 auto', width: '100%' }}>
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
                top: '-2rem',
                zIndex: 100,
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: '0.75rem 0',
                margin: '-2rem -2rem 1rem -2rem',
                paddingLeft: '2rem',
                paddingRight: '2rem',
                borderBottom: '1px solid rgba(226, 232, 240, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
            }}>
                {!hideTabs ? (
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
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.4rem' }}>
                        <h2 style={{ color: '#1e293b', fontSize: '1.25rem', fontWeight: '800', letterSpacing: '-0.02em', margin: 0, textTransform: 'uppercase' }}>
                            {activeTab === 'faturas' ? 'Gestão de Faturas' : 'Contas de Energia Concessionária'}
                        </h2>
                    </div>
                )}

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
                        <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginLeft: '0.25rem' }}>
                            <button
                                onClick={() => setFilterCriterion('mes_referencia')}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.6rem',
                                    fontSize: '0.75rem',
                                    fontWeight: '800',
                                    cursor: 'pointer',
                                    background: filterCriterion === 'mes_referencia' ? 'var(--color-blue)' : 'transparent',
                                    color: filterCriterion === 'mes_referencia' ? 'white' : '#64748b',
                                    transition: 'all 0.2s',
                                    outline: 'none',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Mês Ref.
                            </button>
                            <button
                                onClick={() => setFilterCriterion('vencimento')}
                                style={{
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.6rem',
                                    fontSize: '0.75rem',
                                    fontWeight: '800',
                                    cursor: 'pointer',
                                    background: filterCriterion === 'vencimento' ? 'var(--color-blue)' : 'transparent',
                                    color: filterCriterion === 'vencimento' ? 'white' : '#64748b',
                                    transition: 'all 0.2s',
                                    outline: 'none',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Vencimento
                            </button>
                        </div>
                        <div style={{ width: '1px', height: '16px', background: '#e2e8f0' }}></div>
                        {viewMode === 'energy_reading_calendar' ? (
                            <select 
                                value={readingStatusFilter} 
                                onChange={e => setReadingStatusFilter(e.target.value)} 
                                style={{ padding: '0.4rem', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.85rem', fontWeight: '600', color: '#334155', background: 'white', cursor: 'pointer' }}
                            >
                                <option value="">Status Leit.</option>
                                <option value="success">Sucesso</option>
                                <option value="pending">Pendente</option>
                                <option value="error">Erro</option>
                                <option value="processing">Processando</option>
                            </select>
                        ) : activeTab === 'faturas' ? (
                            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '0.4rem', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.85rem' }}>
                                <option value="">Todos os Status</option>
                                <option value="sem_faturamento">Sem Faturamento</option>
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
                                <option value="inconsistente">Inconsistente</option>
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
                                    <button onClick={() => setViewMode('energy_reading_calendar')} style={{ borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: viewMode === 'energy_reading_calendar' ? 'white' : 'transparent', color: viewMode === 'energy_reading_calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'energy_reading_calendar' ? '700' : '500', fontSize: '0.85rem' }}>
                                        Calendario de Leituras
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
                            <button onClick={handleGenerateExtrato} style={{ background: 'white', color: '#003366', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #bfdbfe', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <Printer size={16} /> Extrato
                            </button>
                            <button onClick={() => setIsHistoryModalOpen(true)} style={{ background: 'white', color: '#475569', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <History size={16} /> Histórico
                            </button>
                            {activeTab === 'faturas' ? (
                                <button onClick={handleCreate} style={{ background: 'var(--color-orange)', color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Plus size={16} /> Nova Fatura
                                </button>
                            ) : (
                                <button onClick={() => setIsAnalysisModalOpen(true)} style={{ background: 'var(--color-orange)', color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <Plus size={16} /> Nova Conta
                                </button>
                            )}
                        </div>
                    </div>

                </div>

                {/* Legenda de Status e Quantitativo (Totais) Abaixo do submenu de forma totalmente horizontal */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', width: '100%' }}>
                    {/* Linha única de Legendas */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.6rem 1rem',
                        background: 'white',
                        borderRadius: '10px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
                        flexWrap: 'nowrap',
                        overflowX: 'auto',
                        whiteSpace: 'nowrap',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none'
                    }}>
                        {activeTab === 'faturas' ? (
                            <>
                                {/* Botão Todos/Total */}
                                <button
                                    onClick={() => setStatusFilter('')}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        padding: '0.25rem 0.6rem',
                                        borderRadius: '6px',
                                        border: statusFilter === '' ? '1px solid #64748b' : '1px solid transparent',
                                        background: statusFilter === '' ? '#f1f5f9' : 'transparent',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        outline: 'none',
                                        flexShrink: 0
                                    }}
                                    onMouseOver={e => {
                                        e.currentTarget.style.background = '#f1f5f9';
                                        e.currentTarget.style.borderColor = '#64748b';
                                    }}
                                    onMouseOut={e => {
                                        if (statusFilter !== '') {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.borderColor = 'transparent';
                                        }
                                    }}
                                    title="Mostrar todos os registros"
                                >
                                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#64748b', flexShrink: 0 }}></span>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
                                        <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 'bold' }}>Todos</span>
                                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold' }}>{invoicesForTotals.length}</span>
                                    </div>
                                </button>

                                {faturasStatuses.map(status => {
                                    const count = faturasCounts[status.key] || 0;
                                    const isActive = statusFilter === status.key;
                                    return (
                                        <button
                                            key={status.key}
                                            onClick={() => setStatusFilter(isActive ? '' : status.key)}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '0.4rem',
                                                padding: '0.25rem 0.6rem',
                                                borderRadius: '6px',
                                                border: isActive ? `1px solid ${status.color}` : '1px solid transparent',
                                                background: isActive ? status.bg : 'transparent',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                outline: 'none',
                                                flexShrink: 0
                                            }}
                                            onMouseOver={e => {
                                                e.currentTarget.style.background = status.bg;
                                                e.currentTarget.style.borderColor = status.color;
                                            }}
                                            onMouseOut={e => {
                                                if (!isActive) {
                                                    e.currentTarget.style.background = 'transparent';
                                                    e.currentTarget.style.borderColor = 'transparent';
                                                }
                                            }}
                                            title={`Filtrar por ${status.label}`}
                                        >
                                            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: status.color, flexShrink: 0 }}></span>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
                                                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '600' }}>{status.label}</span>
                                                <span style={{ fontSize: '0.7rem', color: status.color, fontWeight: 'bold' }}>{count}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </>
                        ) : (
                            <>
                                {/* Botão Todos/Total */}
                                <button
                                    onClick={() => setStatusFilter('')}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        padding: '0.25rem 0.6rem',
                                        borderRadius: '6px',
                                        border: statusFilter === '' ? '1px solid #64748b' : '1px solid transparent',
                                        background: statusFilter === '' ? '#f1f5f9' : 'transparent',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        outline: 'none',
                                        flexShrink: 0
                                    }}
                                    onMouseOver={e => {
                                        e.currentTarget.style.background = '#f1f5f9';
                                        e.currentTarget.style.borderColor = '#64748b';
                                    }}
                                    onMouseOut={e => {
                                        if (statusFilter !== '') {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.borderColor = 'transparent';
                                        }
                                    }}
                                    title="Mostrar todas as contas"
                                >
                                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#64748b', flexShrink: 0 }}></span>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
                                        <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 'bold' }}>Todos</span>
                                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold' }}>{invoicesForTotals.length}</span>
                                    </div>
                                </button>

                                {contasStatuses.map(status => {
                                    const count = contasCounts[status.key] || 0;
                                    const isActive = statusFilter === status.key || (status.key === 'atrasada' && statusFilter === 'atrasada') || (status.key === 'a_vencer' && statusFilter === 'a_vencer');
                                    return (
                                        <button
                                            key={status.key}
                                            onClick={() => setStatusFilter(isActive ? '' : status.key)}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '0.4rem',
                                                padding: '0.25rem 0.6rem',
                                                borderRadius: '6px',
                                                border: isActive ? `1px solid ${status.color}` : '1px solid transparent',
                                                background: isActive ? status.bg : 'transparent',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                outline: 'none',
                                                flexShrink: 0
                                            }}
                                            onMouseOver={e => {
                                                e.currentTarget.style.background = status.bg;
                                                e.currentTarget.style.borderColor = status.color;
                                            }}
                                            onMouseOut={e => {
                                                if (!isActive) {
                                                    e.currentTarget.style.background = 'transparent';
                                                    e.currentTarget.style.borderColor = 'transparent';
                                                }
                                            }}
                                            title={`Filtrar por ${status.label}`}
                                        >
                                            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: status.color, flexShrink: 0 }}></span>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
                                                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '600' }}>{status.label}</span>
                                                <span style={{ fontSize: '0.7rem', color: status.color, fontWeight: 'bold' }}>{count}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                                
                                <div style={{ width: '1px', height: '24px', background: '#cbd5e1', margin: '0 0.5rem', flexShrink: 0 }}></div>
                                
                                <span style={{ fontSize: '0.75rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '0.25rem', flexShrink: 0 }}>Status Fatura:</span>
                                
                                <button
                                    onClick={() => setStatusFaturaFilter('')}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        padding: '0.25rem 0.6rem',
                                        borderRadius: '6px',
                                        border: statusFaturaFilter === '' ? '1px solid #64748b' : '1px solid transparent',
                                        background: statusFaturaFilter === '' ? '#f1f5f9' : 'transparent',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        outline: 'none',
                                        flexShrink: 0
                                    }}
                                    onMouseOver={e => {
                                        e.currentTarget.style.background = '#f1f5f9';
                                        e.currentTarget.style.borderColor = '#64748b';
                                    }}
                                    onMouseOut={e => {
                                        if (statusFaturaFilter !== '') {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.borderColor = 'transparent';
                                        }
                                    }}
                                    title="Mostrar todas as faturas"
                                >
                                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#64748b', flexShrink: 0 }}></span>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
                                        <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 'bold' }}>Todas</span>
                                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold' }}>{invoicesForTotals.length}</span>
                                    </div>
                                </button>

                                {faturasStatuses.map(status => {
                                    const count = faturasCounts[status.key] || 0;
                                    const isActive = statusFaturaFilter === status.key;
                                    return (
                                        <button
                                            key={`fatura-${status.key}`}
                                            onClick={() => setStatusFaturaFilter(isActive ? '' : status.key)}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '0.4rem',
                                                padding: '0.25rem 0.6rem',
                                                borderRadius: '6px',
                                                border: isActive ? `1px solid ${status.color}` : '1px solid transparent',
                                                background: isActive ? status.bg : 'transparent',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                outline: 'none',
                                                flexShrink: 0
                                            }}
                                            onMouseOver={e => {
                                                e.currentTarget.style.background = status.bg;
                                                e.currentTarget.style.borderColor = status.color;
                                            }}
                                            onMouseOut={e => {
                                                if (!isActive) {
                                                    e.currentTarget.style.background = 'transparent';
                                                    e.currentTarget.style.borderColor = 'transparent';
                                                }
                                            }}
                                            title={`Filtrar Fatura por ${status.label}`}
                                        >
                                            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: status.color, flexShrink: 0 }}></span>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
                                                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: '600' }}>{status.label}</span>
                                                <span style={{ fontSize: '0.7rem', color: status.color, fontWeight: 'bold' }}>{count}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </>
                        )}
                    </div>

                    {/* Bloco Totais abaixo das legendas, alinhado à direita da tela */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        alignItems: 'center',
                        width: '100%',
                        marginTop: '0.25rem'
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0.5rem 1.25rem',
                            background: 'white',
                            borderRadius: '10px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
                        }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '0.5rem' }}>Totais:</span>
                            <span style={{ fontSize: '1rem', fontWeight: '950', color: '#0f172a' }}>
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(activeTab === 'faturas' ? sortedInvoices.reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0) : sortedInvoices.reduce((sum, inv) => sum + (Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0))), 0))}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Legenda de Status (Energia) integrada se necessário */}
                {viewMode === 'energy_calendar' && (() => {
                    const energyStats = filteredInvoices.filter(inv => 
                        ['auto_consumo_remoto', 'geracao_compartilhada'].includes(inv.consumer_units?.modalidade)
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
                <AuditGraphViewInvoiceSummary onInspectInvoice={(invoiceId) => {
                    const inv = invoices.find(i => i.id === invoiceId);
                    if (inv) {
                        setSelectedInvoiceForSummary(inv);
                        setIsSummaryModalOpen(true);
                    }
                }} />
            ) : loading ? <p>Carregando...</p> : (filteredInvoices.length === 0 && viewMode !== 'energy_reading_calendar') ? (
                <div style={{ padding: '3rem', textAlign: 'center', background: 'white', borderRadius: '12px', boxShadow: 'var(--shadow-sm)' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '1rem' }}><FileText size={48} /></div>
                    <h3 style={{ color: '#475569', fontWeight: 'bold' }}>
                        {activeTab === 'contas_energia'
                            ? (monthFilter === 'all' ? 'Nenhuma conta de energia encontrada' : 'Nenhuma conta de energia para o Mês selecionado')
                            : (monthFilter === 'all' ? 'Nenhuma Fatura encontrada' : 'Nenhuma Fatura emitida para o Mês selecionado')
                        }
                    </h3>
                </div>
            ) : (
                <>
                    {viewMode === 'list' ? (
                        (() => {
                            const totalFactValue = sortedInvoices.reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0);
                            const totalEnergyBillValue = sortedInvoices.reduce((sum, inv) => sum + (Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0) + (Number(inv.consumo_reais) || 0))), 0);
                                            const totalBalance = totalFactValue - totalEnergyBillValue;

                            return (
                                <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead style={{ background: '#f8fafc' }}>
                                            <tr>
                                                <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: '120px' }}>Unidade Consumidora</th>
                                                <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: '80px' }}>Mês de ref.</th>
                                                <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: '100px' }}>Energia Compensada</th>
                                                <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: '120px' }}>Conta de Energia</th>
                                                <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: '100px' }}>Vencimento</th>
                                                <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: '100px' }}>Leitura Ant.</th>
                                                <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: '100px' }}>Leitura Atual</th>
                                                <th style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: '100px' }}>Vr. da Fatura</th>
                                                <th style={{ padding: '1rem', textAlign: 'left', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: '80px' }}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedInvoices.map(inv => {
                                                const factValue = Number(inv.valor_a_pagar) || 0;
                                                const energyBillValue = Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0) + (Number(inv.consumo_reais) || 0));

                                                return (
                                                    <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                        {/* 1. Unidade Consumidora clicável azul com borda + Assinante como sublinha */}
                                                        <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                                <span 
                                                                    onClick={() => {
                                                                        handleEdit(inv);
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
                                                                        boxShadow: '0 1px 2px rgba(37, 99, 235, 0.05)',
                                                                        width: 'fit-content',
                                                                        maxWidth: '150px',
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap'
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
                                                                <span style={{ color: '#334155', fontSize: '0.8rem', fontWeight: '700', paddingLeft: '0.2rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                                                                        {abbreviateName(inv.consumer_units?.subscribers?.name, 20) || '-'}
                                                                    </span>
                                                                {inv.consumer_units?.titular_conta && (
                                                                    <div style={{ color: '#64748b', fontSize: '0.7rem', paddingLeft: '0.2rem' }}>
                                                                        {inv.consumer_units?.titular_conta}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>

                                                        {/* 2. Mês de ref. */}
                                                        <td 
                                                            onClick={() => {
                                                                setSelectedInvoiceForSummary(inv);
                                                                setIsSummaryModalOpen(true);
                                                            }}
                                                            style={{ 
                                                                padding: '1rem', 
                                                                color: '#475569', 
                                                                fontSize: '0.85rem', 
                                                                whiteSpace: 'nowrap', 
                                                                fontWeight: '600', 
                                                                minWidth: '80px',
                                                                cursor: 'pointer',
                                                                transition: 'color 0.2s'
                                                            }}
                                                            onMouseEnter={(e) => { e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.textDecoration = 'underline'; }}
                                                            onMouseLeave={(e) => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.textDecoration = 'none'; }}
                                                        >
                                                            {inv.mes_referencia ? (() => {
                                                                const [year, month] = inv.mes_referencia.split('-');
                                                                return `${month}/${year}`;
                                                            })() : '-'}
                                                        </td>

                                                        {/* 3. Energia Compensada */}
                                                        <td style={{ padding: '1rem', textAlign: 'center', color: '#16a34a', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                                            {inv.consumo_compensado ? `${inv.consumo_compensado} kWh` : '-'}
                                                        </td>

                                                        {/* 4. Conta de Energia + Pagar */}
                                                        <td style={{ padding: '1rem', textAlign: 'center', whiteSpace: 'nowrap', minWidth: '120px' }}>
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
                                                                    ) : (inv.linha_digitavel && ['auto_consumo_remoto', 'geracao_compartilhada'].includes(inv.consumer_units?.modalidade)) ? (
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

                                                        {/* 5. Vencimento Corrigido */}
                                                        <td style={{ padding: '1rem', color: '#334155', whiteSpace: 'nowrap', minWidth: '100px' }}>{getInvoiceDueDate(inv)}</td>
                                                        
                                                        {/* 6. Leitura Ant. */}
                                                        <td style={{ padding: '1rem', textAlign: 'center', color: '#64748b', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                                            {getAnteriorLeitura(inv)}
                                                        </td>

                                                        {/* 7. Leitura Atual */}
                                                        <td style={{ padding: '1rem', textAlign: 'center', color: '#475569', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                                            {inv.data_leitura ? inv.data_leitura.split('T')[0].split('-').reverse().join('/') : '-'}
                                                        </td>

                                                        {/* 8. Vr. da Fatura + Boleto */}
                                                        <td style={{ padding: '1rem', textAlign: 'center', whiteSpace: 'nowrap', minWidth: '100px' }}>
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

                                                        {/* 9. Status */}
                                                        <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>{getStatusBadge(inv.status)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0', fontWeight: 'bold' }}>
                                            <tr>
                                                <td colSpan="2" style={{ padding: '1rem', color: '#475569', fontSize: '0.85rem' }}>
                                                    <span>Total de Registros: </span>
                                                    <span style={{ fontWeight: '800', color: 'var(--color-blue)' }}>{sortedInvoices.length} {sortedInvoices.length === 1 ? 'fatura' : 'faturas'}</span>
                                                </td>
                                                <td style={{ padding: '1rem' }}></td>
                                                <td style={{ padding: '1rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                    <div style={{ color: '#ef4444', fontSize: '0.95rem', fontWeight: '900' }}>
                                                        {formatCurrency(totalEnergyBillValue)}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '1rem' }}></td>
                                                <td style={{ padding: '1rem' }}></td>
                                                <td style={{ padding: '1rem' }}></td>
                                                <td style={{ padding: '1rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                    <div style={{ color: '#0f172a', fontSize: '0.95rem', fontWeight: '900' }}>
                                                        {formatCurrency(totalFactValue)}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '1rem' }}></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            );
                        })()
                    ) : viewMode === 'energy_list' ? (
                        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ background: '#f8fafc' }}>
                                    <tr>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Código do Cliente</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Ref.</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Vl. Pagar</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Vencimento</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Lt. Anterior</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Lt. Atual</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Consumo</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Compens.</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Injetada</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>St. Fatura</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>St. Conta</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedInvoices.map(inv => {
                                        const cost = Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0));
                                        const today = new Date();
                                        today.setHours(0,0,0,0);
                                        const dueDate = (inv.vencimento_concessionaria || inv.vencimento) ? new Date(inv.vencimento_concessionaria || inv.vencimento) : null;
                                        const isPastDue = dueDate && dueDate < today;

                                        return (
                                            <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                {/* Código do Cliente clicável azul + Assinante como sublinha */}
                                                <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                                        <span 
                                                            onClick={() => {
                                                                setSelectedInvoiceForSummary(inv);
                                                                setIsSummaryModalOpen(true);
                                                            }}
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                padding: '0.15rem 0.5rem',
                                                                background: '#eff6ff', 
                                                                color: '#2563eb', 
                                                                border: '1px solid #bfdbfe',
                                                                borderRadius: '99px',
                                                                fontSize: '0.75rem',
                                                                fontWeight: 'bold',
                                                                cursor: 'pointer',
                                                                transition: 'all 0.2s',
                                                                boxShadow: '0 1px 2px rgba(37, 99, 235, 0.05)',
                                                                width: 'fit-content'
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
                                                        <span style={{ color: '#334155', fontSize: '0.72rem', fontWeight: '700', paddingLeft: '0.2rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                                                            {abbreviateName(inv.consumer_units?.subscribers?.name, 18) || '-'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#475569', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                                                    {inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('/') : '-'}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: '800', color: '#ef4444', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                                    {formatCurrency(cost)}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#475569', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                                                    {inv.vencimento_concessionaria ? inv.vencimento_concessionaria.split('-').reverse().join('/') : (inv.vencimento ? inv.vencimento.split('-').reverse().join('/') : '-')}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748b', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                                                    {getAnteriorLeitura(inv)}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#475569', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                                                    {inv.data_leitura ? inv.data_leitura.split('-').reverse().join('/') : '-'}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#475569', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                                                    {inv.consumo_kwh ? `${inv.consumo_kwh} kWh` : '-'}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#16a34a', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                                                    {inv.consumo_compensado ? `${inv.consumo_compensado} kWh` : '-'}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#0284c7', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                                                    {inv.energia_injetada ? `${inv.energia_injetada} kWh` : '-'}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>
                                                    {getStatusBadge(inv.status)}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>
                                                    {getEnergyStatusBadge(inv.energy_bill_status || 'pendente', isPastDue)}
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
                                {['sem_faturamento', 'a_vencer', 'atrasado', 'confirmado', 'pago']
                                    .filter(status => !statusFilter || status === statusFilter)
                                    .map(status => {
                                        const invoicesInStatus = filteredInvoices.filter(inv => inv.status === status);
                                        const statusMap = { 
                                            'sem_faturamento': { color: '#2563eb', bg: '#eff6ff', label: 'Sem Faturamento' },
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
                                {['a_vencer', 'inconsistente', 'contestada', 'parcelada', 'atrasada', 'pago']
                                    .filter(col => !statusFilter || col === statusFilter)
                                    .map(col => {
                                    const invoicesInCol = filteredInvoices.filter(inv => {
                                        const ebStatus = inv.energy_bill_status || 'pendente';
                                        const today = new Date();
                                        today.setHours(0,0,0,0);
                                        const dueDate = (inv.vencimento_concessionaria || inv.vencimento) ? new Date(inv.vencimento_concessionaria || inv.vencimento) : null;
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
                                        'inconsistente': { color: '#ea580c', bg: '#ffedd5', label: 'Inconsistente' },
                                        'contestada': { color: '#7c3aed', bg: '#f3e8ff', label: 'Contestada' },
                                        'parcelada': { color: '#ca8a04', bg: '#fef9c3', label: 'Parcelada' }, 
                                        'atrasada': { color: '#dc2626', bg: '#fee2e2', label: 'Atrasada' },
                                        'pago': { color: '#166534', bg: '#dcfce7', label: 'Paga' }
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
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                setDropTarget({ type: 'status', label: s.label });
                                            }}
                                            onDragLeave={() => setDropTarget(null)}
                                            onDrop={(e) => {
                                                setDropTarget(null);
                                                handleEnergyDrop(e, col);
                                            }}
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
                                                            onDragStart={(e) => {
                                                                e.dataTransfer.setData('invoiceId', inv.id);
                                                                setDraggedInvoice(inv);
                                                            }}
                                                            onDragEnd={() => {
                                                                setDropTarget(null);
                                                                setDraggedInvoice(null);
                                                            }}
                                                            onDragOver={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                if (draggedInvoice && draggedInvoice.uc_id === inv.uc_id && draggedInvoice.id !== inv.id) {
                                                                    setDropTarget({ type: 'join', targetId: inv.id, label: inv.consumer_units?.numero_uc });
                                                                }
                                                            }}
                                                            onDragLeave={(e) => {
                                                                e.stopPropagation();
                                                                setDropTarget(null);
                                                            }}
                                                            onDrop={(e) => {
                                                                e.stopPropagation();
                                                                setDropTarget(null);
                                                                handleInvoiceJoinDrop(e, inv.id);
                                                            }}
                                                            style={{ 
                                                                cursor: 'pointer', 
                                                                border: dropTarget?.targetId === inv.id ? '2px dashed #3b82f6' : undefined,
                                                                transform: dropTarget?.targetId === inv.id ? 'scale(1.02)' : 'none',
                                                                transition: 'all 0.2s'
                                                            }}
                                                        >
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                                <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)' }}>
                                                                    {inv.consumer_units?.numero_uc}
                                                                </span>
                                                                <span style={{ fontSize: '1rem', color: '#1e293b', fontWeight: '800' }}>
                                                                    {inv.vencimento_concessionaria ? inv.vencimento_concessionaria.split('-').reverse().join('/') : (inv.vencimento ? inv.vencimento.split('-').reverse().join('/') : '-')}
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
                    ) : viewMode === 'energy_reading_calendar' ? (
                        <div style={{ background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', minHeight: '600px' }}>
                            <CalendarView
                                units={ucs}
                                invoices={invoices}
                                monthFilter={monthFilter}
                                searchTerm={searchTerm}
                                readingStatusFilter={readingStatusFilter}
                                onCardClick={handleCalendarCardClick}
                            />
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

            {isModalOpen && (
  <InvoiceFormModal
    invoice={selectedInvoice}
    ucs={ucs.filter(u => u.status === 'ativo')}
    extraActions={(inv) => {
      if (!inv) return null;
      return (
        <button
          onClick={() => handlePayBill(inv)}
          disabled={payingId === inv.id}
          style={{
            background: '#10b981',
            color: 'white',
            padding: '0.4rem 0.8rem',
            borderRadius: '6px',
            border: 'none',
            cursor: payingId === inv.id ? 'not-allowed' : 'pointer',
            opacity: payingId === inv.id ? 0.6 : 1,
            transition: 'background 0.2s, transform 0.1s',
          }}
          onMouseOver={e => (e.currentTarget.style.background = '#059669')}
          onMouseOut={e => (e.currentTarget.style.background = '#10b981')}
          onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
          onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          Pagar conta energia
        </button>
      );
    }}
    onClose={() => setIsModalOpen(false)}
    onSave={handleSave}
  />
)}
            {isHistoryModalOpen && <InvoiceHistoryModal onClose={() => setIsHistoryModalOpen(false)} />}
            {isSummaryModalOpen && (
                <InvoiceSummaryModal 
                    invoice={selectedInvoiceForSummary} 
                    consumerUnit={selectedInvoiceForSummary?.consumer_units} 
                    onClose={() => setIsSummaryModalOpen(false)} 
                    onPaymentSuccess={fetchInvoices}
                />
            )}
            {isAnalysisModalOpen && (
                <StandaloneAnalysisModal 
                    isOpen={isAnalysisModalOpen} 
                    ucs={ucs} 
                    onClose={() => setIsAnalysisModalOpen(false)} 
                    onSave={fetchInvoices} 
                />
            )}
            {isUcModalOpen && (
                <ConsumerUnitModal
                    consumerUnit={selectedUcForModal}
                    defaultSection={ucModalSection}
                    onClose={() => setIsUcModalOpen(false)}
                    onSave={() => {
                        fetchInvoices();
                        fetchUcs();
                    }}
                    onDelete={() => {
                        fetchInvoices();
                        fetchUcs();
                    }}
                />
            )}

            {dropTarget && (
                <div style={{
                    position: 'fixed', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
                    background: dropTarget.type === 'join' ? '#eff6ff' : '#f8fafc',
                    border: `1.5px solid ${dropTarget.type === 'join' ? '#3b82f6' : '#cbd5e1'}`,
                    padding: '12px 24px', borderRadius: '12px', zIndex: 9999,
                    boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                    display: 'flex', alignItems: 'center', gap: '12px',
                    pointerEvents: 'none'
                }}>
                    {dropTarget.type === 'join' ? (
                        <>
                            <LinkIcon size={20} color="#3b82f6" />
                            <span style={{ fontWeight: 600, color: '#1e3a8a', fontSize: '0.95rem' }}>
                                Vincular como conta filha da UC: {dropTarget.label}
                            </span>
                        </>
                    ) : (
                        <>
                            <Info size={20} color="#64748b" />
                            <span style={{ fontWeight: 600, color: '#475569', fontSize: '0.95rem' }}>
                                Alterar status da conta para: {dropTarget.label}
                            </span>
                        </>
                    )}
                </div>
            )}

        </div>
    );
}

function CalendarView({ units, invoices, monthFilter, searchTerm, readingStatusFilter, onCardClick }) {
    const today = new Date();
    const currentYearNum = today.getFullYear();
    const currentMonthNum = today.getMonth() + 1;
    const currentDayNum = today.getDate();

    const [filterYear, filterMonth] = (monthFilter === 'all' ? [today.getFullYear(), today.getMonth() + 1] : (monthFilter || '').split('-').map(Number));
    const isCurrentMonth = filterYear === currentYearNum && filterMonth === currentMonthNum;

    const firstDay = new Date(filterYear, filterMonth - 1, 1).getDay();
    const startOffset = (firstDay + 6) % 7; // Segunda = 0
    const daysInMonth = new Date(filterYear, filterMonth, 0).getDate();
    const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // 1. Filtrar Ativas e Desconectadas (que ainda podem ter leituras/faturas) para o Calendário
    const calendarUnits = units.filter(u => u.status === 'ativo' || u.status === 'desconectado');

    // 2. Agrupar e Calcular Status
    const groupedUnits = calendarUnits.reduce((acc, unit) => {
        const unitDate = new Date(unit.created_at);
        const unitYear = unitDate.getFullYear();
        const unitMonth = unitDate.getMonth() + 1;
        
        if (unitYear > filterYear || (unitYear === filterYear && unitMonth > filterMonth)) {
            return acc;
        }

        const day = unit.dia_leitura || 0;
        const matchingInvoice = invoices.find(inv => 
            inv.uc_id === unit.id && 
            (inv.mes_referencia?.startsWith(monthFilter === 'all' ? `${filterYear}-${String(filterMonth).padStart(2, '0')}` : monthFilter) || inv.vencimento?.startsWith(monthFilter === 'all' ? `${filterYear}-${String(filterMonth).padStart(2, '0')}` : monthFilter)) && 
            inv.status?.trim().toLowerCase() !== 'cancelado'
        );
        const hasInvoice = !!matchingInvoice;

        let status = 'pending';
        if (hasInvoice) {
            if (matchingInvoice.status === 'erro' || matchingInvoice.energy_bill_status === 'erro') {
                status = 'error';
            } else {
                status = 'success';
            }
        } else if (unit.last_scraping_status === 'processing') {
            status = 'processing';
        } else {
            const isFuture = (filterYear > currentYearNum) || 
                           (filterYear === currentYearNum && filterMonth > currentMonthNum) || 
                           (isCurrentMonth && day > currentDayNum);

            if (isFuture) {
                status = 'not_available';
            } else if (unit.last_scraping_status === 'error') {
                status = 'error';
            } else {
                status = 'pending';
            }
        }

        if (readingStatusFilter && status !== readingStatusFilter) return acc;

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            const matchesSearch = 
                unit.numero_uc?.toLowerCase().includes(lower) ||
                unit.subscribers?.name?.toLowerCase().includes(lower) ||
                unit.titular_fatura?.name?.toLowerCase().includes(lower) ||
                unit.concessionaria?.toLowerCase().includes(lower);
            if (!matchesSearch) return acc;
        }

        if (!acc[day]) acc[day] = [];
        acc[day].push({ ...unit, displayStatus: status, matchingInvoice: matchingInvoice });
        return acc;
    }, {});

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: '1rem',
            padding: '1rem',
            maxWidth: '1600px',
            margin: '0 auto'
        }}>
            <div style={{
                gridColumn: '1 / -1',
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '1rem',
                position: 'sticky',
                top: 'calc(var(--sticky-header-height, 120px) + 1.5rem)',
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
                <div key={`pad-${i}`} style={{ background: '#f8fafc50', borderRadius: 'var(--radius-md)', border: '1px dashed #e2e8f0', minHeight: '180px' }} />
            ))}
            {calendarDays.map(day => {
                const dayUnits = groupedUnits[day] || [];
                return (
                    <div key={day} style={{
                        background: 'white',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        minHeight: '180px',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: 'var(--shadow-sm)',
                        transition: 'transform 0.2s',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            padding: '0.6rem 1rem',
                            borderBottom: '1px solid var(--color-border)',
                            background: '#f8fafc',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            borderTopLeftRadius: 'var(--radius-md)',
                            borderTopRightRadius: 'var(--radius-md)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontWeight: 800, color: 'var(--color-blue)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Leit. {day}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                                {[
                                    { key: 'success', bg: '#dcfce7', color: '#166534' },
                                    { key: 'pending', bg: '#fff7ed', color: '#c2410c' },
                                    { key: 'error', bg: '#fee2e2', color: '#991b1b' },
                                    { key: 'processing', bg: '#eff6ff', color: '#1d4ed8' },
                                    { key: 'not_available', bg: '#f1f5f9', color: '#475569' }
                                ].map(status => {
                                    const count = dayUnits.filter(u => u.displayStatus === status.key).length;
                                    if (count === 0) return null;
                                    return (
                                        <span key={status.key} style={{ 
                                            fontSize: '0.7rem', color: status.color, background: status.bg, 
                                            padding: '0.15rem 0.4rem', borderRadius: '6px', fontWeight: '800',
                                            minWidth: '1.2rem', textAlign: 'center', border: `1px solid ${status.color}20`
                                        }}>
                                            {count}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                        <div style={{ padding: '0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto', maxHeight: '250px' }}>
                            {dayUnits.length === 0 ? (
                                <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginTop: '2rem', fontStyle: 'italic', opacity: 0.6 }}>Sem leituras</div>
                            ) : (
                                dayUnits.map(uc => (
                                    <div key={uc.id} onClick={() => onCardClick(uc)} style={{
                                        padding: '0.6rem', borderRadius: '8px',
                                        background: uc.status === 'desconectado' ? '#f5f3ff' :
                                                    uc.displayStatus === 'success' ? '#f0fdf4' : 
                                                    uc.displayStatus === 'processing' ? '#eff6ff' :
                                                    uc.displayStatus === 'pending' ? '#fff7ed' :
                                                    uc.displayStatus === 'error' ? '#fef2f2' : '#f8fafc',
                                        borderLeft: `5px solid ${
                                            uc.status === 'desconectado' ? '#8b5cf6' :
                                            uc.displayStatus === 'success' ? '#22c55e' : 
                                            uc.displayStatus === 'processing' ? '#3b82f6' :
                                            uc.displayStatus === 'pending' ? '#f97316' :
                                            uc.displayStatus === 'error' ? '#ef4444' : '#cbd5e1'
                                        }`,
                                        opacity: uc.status === 'desconectado' ? 0.7 : 1,
                                        cursor: 'pointer', fontSize: '0.8rem', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                    }}>
                                        <div style={{ 
                                            fontWeight: 'bold', 
                                            color: '#0f172a', 
                                            whiteSpace: 'nowrap', 
                                            overflow: 'hidden', 
                                            textOverflow: 'ellipsis' 
                                        }}>
                                            {uc.subscribers?.name || 'S/ Assinante'}
                                        </div>
                                        <div style={{ 
                                            fontSize: '0.7rem', 
                                            color: '#64748b', 
                                            marginTop: '0.2rem',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis'
                                        }}>
                                            UC: {uc.numero_uc}
                                            {uc.titular_fatura?.name && (
                                                <div style={{ marginTop: '0.1rem', fontStyle: 'italic', opacity: 0.9 }}>
                                                    {uc.titular_fatura.name}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
