import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { valorDoCodigoDeBarras } from '../../lib/codigoBarras';
import { createAsaasCharge } from '../../lib/api';
import InvoiceFormModal from '../../components/InvoiceFormModal';
import InvoiceHistoryModal from '../../components/InvoiceHistoryModal';
import StandaloneAnalysisModal from '../../components/StandaloneAnalysisModal';
import ReadingCalendarModal from '../../components/ReadingCalendarModal';
import ConsumerUnitModal from '../../components/ConsumerUnitModal';
import ScraperQueueModal from '../../components/ScraperQueueModal';
import { Search, Filter, Plus, FileText, CheckCircle, AlertCircle, Clock, CreditCard, Trash2, Ban, History, Layout, List, Info, Calendar as CalendarIcon, TicketCheck, TicketMinus, Download, CheckCircle2, X, Zap, BarChart2, Printer, Link as LinkIcon } from 'lucide-react';
import { useUI } from '../../contexts/UIContext';
import InvoiceSummaryModal from '../../components/InvoiceSummaryModal';
import { useAuth } from '../../contexts/AuthContext';
import AuditGraphViewInvoiceSummary from './AuditGraphViewInvoiceSummary';
import { ENERGY_PAID_DIVERGENT, energyStatusMatchesFilter, isEnergyBillPaid } from '../../lib/energyBillStatus';
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
        readingStatusFilter: '',
        readingDateFrom: '',
        readingDateTo: ''
    },
    activeTab: null
};

// Formata entrada para D/M/A (DD/MM/AAAA)
const formatDmaInput = (raw) => {
    const trimmed = String(raw || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const [y, m, d] = trimmed.split('-');
        return `${d}/${m}/${y}`;
    }
    const digits = trimmed.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
};

// Converte string D/M/A (DD/MM/AAAA) para YYYY-MM-DD (somente quando completa e válida)
const parseDmaToIso = (dmaStr) => {
    if (!dmaStr) return '';
    const trimmed = String(dmaStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return '';
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

const isoToDma = (isoStr) => {
    if (!isoStr || !/^\d{4}-\d{2}-\d{2}/.test(isoStr)) return '';
    const [y, m, d] = isoStr.split('T')[0].split('-');
    return `${d}/${m}/${y}`;
};

const normalizeReadingDateToIso = (dateStr) => {
    if (!dateStr) return '';
    const raw = String(dateStr).trim().split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return parseDmaToIso(raw);
};

const normalizarTextoBusca = (str) =>
    String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const usinaCasaComBusca = (nomeUsina, termo) => {
    const uNorm = normalizarTextoBusca(nomeUsina);
    const tNorm = normalizarTextoBusca(termo);
    if (!uNorm || !tNorm) return false;

    const idx = uNorm.indexOf(tNorm);
    if (idx === -1) return false;

    // Quando o termo termina com algarismo romano (ex: "UFV Bom Jesus I", "Santa Maria I")
    // ou número, exige limite de palavra para não confundir "I" com "II" / "III".
    const tokens = tNorm.split(' ');
    const lastToken = tokens[tokens.length - 1];
    if (/^(i|ii|iii|iv|v|vi|vii|viii|ix|x|\d+)$/.test(lastToken)) {
        const afterIdx = idx + tNorm.length;
        const nextChar = uNorm[afterIdx];
        if (nextChar && /[a-z0-9]/.test(nextChar)) {
            return false;
        }
    }
    return true;
};

// O cadastro guarda o numero da UC so com digitos (a Neoenergia passou ao formato
// de 12 digitos em 2026), mas quem pesquisa digita com pontos e traco, como no
// portal. Casa pelos digitos quando o termo tem algum, senao pelo texto.
const ucCasaComBusca = (numeroUc, termo) => {
    const numero = String(numeroUc || '');
    const t = String(termo || '').trim();
    if (!t) return true;
    if (numero.toLowerCase().includes(t.toLowerCase())) return true;
    // So termos que parecem numero de UC (digitos, pontos, tracos): "rua 12" nao
    // pode virar busca por "12" em todas as UCs.
    if (!/^[\d.\-\s]+$/.test(t)) return false;
    const digitosTermo = t.replace(/\D/g, '');
    return digitosTermo.length > 0 && numero.replace(/\D/g, '').includes(digitosTermo);
};

export const resolveEnergyStatus = (inv) => {
    let ebStatus = (inv.energy_bill_status || 'pendente').toLowerCase().trim();
    
    // Auto-correção para contas do legado que ficaram presas como 'pendente' mas já foram extraídas/processadas
    if (['pending', 'pendente', 'aguardando'].includes(ebStatus)) {
        const hasValorPagar = Number(inv.valor_a_pagar) > 0;
        const hasRealBill = Number(inv.valor_concessionaria) > 0 && !!inv.concessionaria_pdf_url;
        
        // Conta real (valor + PDF) e conta a pagar, com ou sem cobranca ao assinante.
        // Antes, sem valor_a_pagar, virava "Baixada" e nunca olhava a data -- e toda
        // conta de UG tem valor_a_pagar = 0 por desenho: as UGs ficavam vencidas
        // exibidas como Baixada (Santa Maria, Bom Jesus II e Sao Jose, 10/2026).
        if (hasValorPagar || hasRealBill) {
            ebStatus = 'a_vencer';
        } else {
            return 'pendente';
        }
    }
    
    if (['erro', 'error', 'indisponivel', 'indisponível'].includes(ebStatus)) return 'indisponivel';
    if (['processing', 'processando', 'baixada'].includes(ebStatus)) return 'baixada';
    if (['success', 'sucesso', 'processada'].includes(ebStatus)) return 'processada';
    
    if (['pago', 'parcelada', 'contestada', 'inconsistente', 'inconsistente_pago', 'contestada_pago'].includes(ebStatus)) {
        return ebStatus;
    }
    
    // 'atrasado' no masculino pertence ao vocabulario de `invoices.status`, mas
    // ja foi gravado em `energy_bill_status` -- e ali nenhum leitor o conhecia.
    // O badge caia no fallback e mostrava PENDENTE, e no kanban o card sumia da
    // tela inteira, porque so existe coluna para as chaves conhecidas. Uma conta
    // vencida ha nove dias exibida como pendente e pior do que nao exibida.
    if (['a_vencer', 'atrasada', 'atrasado'].includes(ebStatus)) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Cai para `vencimento` como o InvoiceSummaryModal faz, e ancora ao meio-dia:
        // 'YYYY-MM-DD' puro e lido como meia-noite UTC, que em BRT cai no dia
        // anterior e marcaria como atrasada uma conta que vence hoje.
        const dueStr = inv.vencimento_concessionaria || inv.vencimento;
        const dueDate = dueStr ? new Date(dueStr + 'T12:00:00') : null;
        if (dueDate && dueDate < today) {
            return 'atrasada';
        }
        return 'a_vencer';
    }
    
    return ebStatus;
};

export const faturasStatuses = [
    { key: 'sem_faturamento', label: 'Sem Faturamento', color: '#2563eb', bg: '#eff6ff' },
    { key: 'a_vencer', label: 'A Vencer', color: '#ca8a04', bg: '#fef9c3' },
    { key: 'atrasado', label: 'Atrasado', color: '#dc2626', bg: '#fee2e2' },
    { key: 'confirmado', label: 'Confirmado', color: '#0891b2', bg: '#ecfeff' },
    { key: 'pago', label: 'Pago', color: '#166534', bg: '#dcfce7' },
    { key: 'cancelada', label: 'Cancelada', color: '#64748b', bg: '#f1f5f9' }
];

export const contasStatuses = [
    { key: 'pendente', label: 'Pendente', color: '#f97316', bg: '#fff7ed' },
    { key: 'indisponivel', label: 'Indisponível', color: '#ef4444', bg: '#fef2f2' },
    { key: 'baixada', label: 'Baixada', color: '#3b82f6', bg: '#eff6ff' },
    { key: 'processada', label: 'Processada', color: '#22c55e', bg: '#f0fdf4' },
    { key: 'a_vencer', label: 'A Vencer', color: '#2563eb', bg: '#eff6ff' },
    { key: 'inconsistente', label: 'Inconsistente', color: '#ea580c', bg: '#ffedd5' },
    { key: 'inconsistente_pago', label: 'Inconsistente Pago', color: ENERGY_PAID_DIVERGENT.inconsistente_pago.color, bg: ENERGY_PAID_DIVERGENT.inconsistente_pago.bg },
    { key: 'contestada', label: 'Contestada', color: '#7c3aed', bg: '#f3e8ff' },
    { key: 'contestada_pago', label: 'Contestado Pago', color: ENERGY_PAID_DIVERGENT.contestada_pago.color, bg: ENERGY_PAID_DIVERGENT.contestada_pago.bg },
    { key: 'parcelada', label: 'Parcelada', color: '#ca8a04', bg: '#fef9c3' },
    { key: 'atrasada', label: 'Atrasada', color: '#dc2626', bg: '#fee2e2' },
    { key: 'pago', label: 'Paga', color: '#166534', bg: '#dcfce7' }
];


// Helper adicionado para lidar com nomes de unidades geradoras
export const getDisplayName = (inv) => {
    const cu = inv?.consumer_units || inv; 
    if (!cu) return '-';
    if (cu.tipo_unidade === 'geradora') {
        return cu.usinas?.name || cu.suppliers?.name || 'USINA/FORNECEDOR';
    }
    return cu.subscribers?.name || '-';
};

export const getEnergyBillValue = (inv) => {
    if (!inv) return 0;
    const tarifa = Number(inv.tarifa_minima || inv.tarifa_minima_excedentes) || 0;
    const ip = Number(inv.iluminacao_publica) || 0;
    const outros = Number(inv.outros_lancamentos) || 0;
    const parc = Number(inv.parcelamento) || 0;
    return Number(inv.valor_concessionaria) || (tarifa + ip + outros + parc);
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
    const [readingDateFrom, setReadingDateFrom] = useState(() => savedState.readingDateFrom || '');
    const [readingDateTo, setReadingDateTo] = useState(() => savedState.readingDateTo || '');
    const [searchTerm, setSearchTerm] = useState('');
    const [showUsinaSuggestions, setShowUsinaSuggestions] = useState(false);
    const readingFromPickerRef = useRef(null);
    const readingToPickerRef = useRef(null);
    const searchContainerRef = useRef(null);
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
    const [isReadingCalendarModalOpen, setIsReadingCalendarModalOpen] = useState(false);
    const [isScraperQueueModalOpen, setIsScraperQueueModalOpen] = useState(false);
    const [selectedUcForReadingModal, setSelectedUcForReadingModal] = useState(null);
    const [ucModalSection, setUcModalSection] = useState('geral');
    const [filterCriterion, setFilterCriterion] = useState(() => savedState.filterCriterion || 'vencimento'); // 'mes_referencia' | 'vencimento'
    const [dropTarget, setDropTarget] = useState(null);
    const [draggedInvoice, setDraggedInvoice] = useState(null);
    
    // Estados para pre-selecionar UC e Mês no Sandbox a partir do Resumo
    const [sandboxPreselectedUcId, setSandboxPreselectedUcId] = useState('');
    const [sandboxPreselectedMesRef, setSandboxPreselectedMesRef] = useState('');

    const handleCalendarCardClick = (uc) => {
        if (viewMode === 'energy_reading_calendar') {
            setSelectedUcForReadingModal(uc);
            setIsReadingCalendarModalOpen(true);
            return;
        }

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
            setReadingDateFrom(saved.readingDateFrom || '');
            setReadingDateTo(saved.readingDateTo || '');
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
        pageSessionState[activeTab].readingDateFrom = readingDateFrom;
        pageSessionState[activeTab].readingDateTo = readingDateTo;
        pageSessionState.activeTab = activeTab;
    }, [viewMode, monthFilter, statusFilter, statusFaturaFilter, sortBy, filterCriterion, readingStatusFilter, readingDateFrom, readingDateTo, activeTab]);

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
        setReadingDateFrom(saved.readingDateFrom || '');
        setReadingDateTo(saved.readingDateTo || '');
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

    // Lista de Usinas disponíveis para busca/filtro
    const availableUsinas = Array.from(
        new Set(
            [
                ...invoices.map(inv => inv.consumer_units?.usinas?.name),
                ...ucs.map(u => u.usinas?.name)
            ].filter(Boolean)
        )
    ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const readingFromIso = parseDmaToIso(readingDateFrom);
    const readingToIso = parseDmaToIso(readingDateTo);

    const matchesReadingDatePeriod = (inv) => {
        if (activeTab !== 'contas_energia') return true;
        if (!readingFromIso && !readingToIso) return true;
        const invLeituraIso = normalizeReadingDateToIso(inv?.data_leitura);
        if (!invLeituraIso) return false;
        if (readingFromIso && invLeituraIso < readingFromIso) return false;
        if (readingToIso && invLeituraIso > readingToIso) return false;
        return true;
    };

    const matchesSearchFilter = (inv) => {
        if (!searchTerm || !searchTerm.trim()) return true;
        const cu = inv?.consumer_units || inv;
        const usinaName = cu?.usinas?.name || '';

        // Quando o termo pesquisado casa com uma Usina cadastrada,
        // exibe somente as contas vinculadas à usina pesquisada.
        const matchingUsinas = availableUsinas.filter(uName => usinaCasaComBusca(uName, searchTerm));
        if (matchingUsinas.length > 0) {
            return Boolean(usinaName && usinaCasaComBusca(usinaName, searchTerm));
        }

        if (usinaName && usinaCasaComBusca(usinaName, searchTerm)) {
            return true;
        }

        const lower = searchTerm.toLowerCase().trim();
        const titular = cu?.titular_conta?.toLowerCase() || '';
        const titularFatura = cu?.titular_fatura?.name?.toLowerCase() || '';
        const assinante = (getDisplayName(inv) || '').toLowerCase();
        const ucNumero = cu?.numero_uc || '';
        const invoiceId = inv?.id?.toLowerCase() || '';

        return (
            titular.includes(lower) ||
            titularFatura.includes(lower) ||
            assinante.includes(lower) ||
            ucCasaComBusca(ucNumero, searchTerm) ||
            invoiceId.includes(lower)
        );
    };

    const filteredInvoices = invoices.filter(inv => {
        // Fatura e conta de energia são obrigações distintas que dividem a mesma
        // linha: `status`/`valor_a_pagar` é a cobrança ao assinante, e
        // `energy_bill_status`/`valor_concessionaria` é o que se deve à
        // concessionária. Cancelar a cobrança não extingue a conta a pagar —
        // por isso o descarte de canceladas vale só na aba Faturas.
        if (activeTab === 'faturas' && ['cancelado', 'cancelada'].includes(inv.status)) return false;
        if (inv.parent_invoice_id) {
            if (!(activeTab === 'contas_energia' && viewMode === 'energy_list')) {
                return false;
            }
        }
        
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

            if (!matchesReadingDatePeriod(inv)) return false;

            if (statusFilter) {
                const resolvedStatus = resolveEnergyStatus(inv);
                if (!energyStatusMatchesFilter(resolvedStatus, statusFilter)) return false;
            }
            if (statusFaturaFilter) {
                const effectiveStatus = inv.status === 'ag_emissao_boleto' ? 'sem_faturamento' : inv.status;
                if (effectiveStatus !== statusFaturaFilter) return false;
            }
        }

        if (!matchesSearchFilter(inv)) return false;
        return true;
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

    const getDueDateForSort = (inv) => {
        if (!inv) return 0;
        if (activeTab === 'contas_energia') {
            const d = inv.vencimento_concessionaria || inv.vencimento;
            return d ? new Date(d.split('T')[0] + 'T12:00:00').getTime() : 0;
        }
        if (inv.vencimento) {
            return new Date(inv.vencimento.split('T')[0] + 'T12:00:00').getTime();
        }
        const calcDate = getInvoiceDueDate(inv);
        if (calcDate && calcDate !== 'Não Faturado') {
            const [d, m, y] = calcDate.split('/');
            return new Date(`${y}-${m}-${d}T12:00:00`).getTime();
        }
        return 0;
    };

    const getInvoiceValueForSort = (inv) => {
        if (!inv) return 0;
        if (activeTab === 'contas_energia') {
            return getEnergyBillValue(inv);
        }
        return Number(inv.valor_a_pagar) || 0;
    };

    const sortedInvoices = [...filteredInvoices].sort((a, b) => {
        let primaryResult = 0;
        if (sortBy === 'ref_desc') {
            const dateA = a.mes_referencia ? new Date(a.mes_referencia.split('T')[0] + 'T12:00:00').getTime() : 0;
            const dateB = b.mes_referencia ? new Date(b.mes_referencia.split('T')[0] + 'T12:00:00').getTime() : 0;
            primaryResult = dateB - dateA;
        } else if (sortBy === 'ref_asc') {
            const dateA = a.mes_referencia ? new Date(a.mes_referencia.split('T')[0] + 'T12:00:00').getTime() : 0;
            const dateB = b.mes_referencia ? new Date(b.mes_referencia.split('T')[0] + 'T12:00:00').getTime() : 0;
            primaryResult = dateA - dateB;
        } else if (sortBy === 'venc_desc') {
            const dateA = getDueDateForSort(a);
            const dateB = getDueDateForSort(b);
            primaryResult = dateB - dateA;
        } else if (sortBy === 'venc_asc') {
            const dateA = getDueDateForSort(a);
            const dateB = getDueDateForSort(b);
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
            const valA = getInvoiceValueForSort(a);
            const valB = getInvoiceValueForSort(b);
            primaryResult = valB - valA;
        } else if (sortBy === 'valor_asc') {
            const valA = getInvoiceValueForSort(a);
            const valB = getInvoiceValueForSort(b);
            primaryResult = valA - valB;
        } else if (sortBy === 'assinante_asc') {
            const nameA = getDisplayName(a) || '';
            const nameB = getDisplayName(b) || '';
            primaryResult = nameA.localeCompare(nameB);
        } else if (sortBy === 'assinante_desc') {
            const nameA = getDisplayName(a) || '';
            const nameB = getDisplayName(b) || '';
            primaryResult = nameB.localeCompare(nameA);
        }

        // Se o critério principal empatar e não for ordenação primária pelo próprio mês de referência,
        // aplica a ordenação secundária: Mês de Ref. com o Mais Novo Primeiro (decrescente)
        if (primaryResult === 0 && sortBy !== 'ref_desc' && sortBy !== 'ref_asc') {
            const dateA = a.mes_referencia ? new Date(a.mes_referencia.split('T')[0] + 'T12:00:00').getTime() : 0;
            const dateB = b.mes_referencia ? new Date(b.mes_referencia.split('T')[0] + 'T12:00:00').getTime() : 0;
            const secondaryResult = dateB - dateA;
            if (secondaryResult !== 0) return secondaryResult;
            const nameA = getDisplayName(a) || '';
            const nameB = getDisplayName(b) || '';
            return nameA.localeCompare(nameB);
        }

        return primaryResult;
    });

    const handleGenerateExtrato = () => {
        if (sortedInvoices.length === 0) {
            showAlert('Nenhum registro para exportar.', 'warning');
            return;
        }

        const doc = new jsPDF('l', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const generationDate = new Date().toLocaleString('pt-BR');

        if (activeTab === 'contas_energia') {
            // ==========================================
            // EXTRATO DE CONTAS DE ENERGIA CONCESSIONÁRIA
            // ==========================================
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 51, 102); // Navy Blue
            doc.text('EXTRATO DE CONTAS DE ENERGIA CONCESSIONÁRIA', 14, 18);
            
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 116, 139); // Slate Grey
            doc.text(`Gerado em: ${generationDate}`, pageWidth - 14, 18, { align: 'right' });

            // Linha divisória
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.5);
            doc.line(14, 22, pageWidth - 14, 22);

            const totalEnergy = sortedInvoices.reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);
            
            const totalAtrasada = sortedInvoices
                .filter(inv => resolveEnergyStatus(inv) === 'atrasada')
                .reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);
            const totalAVencer = sortedInvoices
                .filter(inv => resolveEnergyStatus(inv) === 'a_vencer')
                .reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);
            const totalPaga = sortedInvoices
                .filter(inv => resolveEnergyStatus(inv) === 'pago')
                .reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);
            const totalParcelada = sortedInvoices
                .filter(inv => resolveEnergyStatus(inv) === 'parcelada')
                .reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);
            const totalContestada = sortedInvoices
                .filter(inv => resolveEnergyStatus(inv) === 'contestada')
                .reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);
            const totalInconsistente = sortedInvoices
                .filter(inv => resolveEnergyStatus(inv) === 'inconsistente')
                .reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);
            const totalInconsistentePago = sortedInvoices
                .filter(inv => resolveEnergyStatus(inv) === 'inconsistente_pago')
                .reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);
            const totalContestadaPago = sortedInvoices
                .filter(inv => resolveEnergyStatus(inv) === 'contestada_pago')
                .reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);

            let statusSummaryText = `A Vencer: ${formatCurrency(totalAVencer)}    |    Atrasada: ${formatCurrency(totalAtrasada)}    |    Paga: ${formatCurrency(totalPaga)}`;
            if (totalParcelada > 0) statusSummaryText += `    |    Parcelada: ${formatCurrency(totalParcelada)}`;
            if (totalContestada > 0) statusSummaryText += `    |    Contestada: ${formatCurrency(totalContestada)}`;
            if (totalInconsistente > 0) statusSummaryText += `    |    Inconsistente: ${formatCurrency(totalInconsistente)}`;
            if (totalInconsistentePago > 0) statusSummaryText += `    |    Inconsistente Pago: ${formatCurrency(totalInconsistentePago)}`;
            if (totalContestadaPago > 0) statusSummaryText += `    |    Contestado Pago: ${formatCurrency(totalContestadaPago)}`;

            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(15, 23, 42); // Charcoal
            doc.text(`Total Contas: ${formatCurrency(totalEnergy)}`, 14, 29);
            doc.text(`Total Registros: ${sortedInvoices.length}`, pageWidth - 14, 29, { align: 'right' });

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(71, 85, 105); // Slate 600
            doc.text(statusSummaryText, 14, 35);

            const stContaMap = {
                'pendente': 'Pendente',
                'indisponivel': 'Indisponível',
                'baixada': 'Baixada',
                'processada': 'Processada',
                'a_vencer': 'A Vencer',
                'inconsistente': 'Inconsistente',
                'inconsistente_pago': 'Inconsistente Pago',
                'contestada': 'Contestada',
                'contestada_pago': 'Contestado Pago',
                'parcelada': 'Parcelada',
                'atrasada': 'Atrasada',
                'pago': 'Paga'
            };

            const tableBody = sortedInvoices.map(inv => {
                const billValue = getEnergyBillValue(inv);
                const vencStr = inv.vencimento_concessionaria || inv.vencimento;
                const formattedVenc = vencStr ? vencStr.split('T')[0].split('-').reverse().join('/') : '-';
                const stConta = stContaMap[resolveEnergyStatus(inv)] || resolveEnergyStatus(inv);
                const stFatura = 
                    inv.status === 'sem_faturamento' ? 'Sem Faturamento' : 
                    inv.status === 'pago' ? 'Pago' : 
                    inv.status === 'a_vencer' ? 'A Vencer' : 
                    inv.status === 'atrasado' ? 'Atrasado' : 
                    inv.status === 'ag_emissao_boleto' ? 'Sem Faturamento' : 
                    inv.status === 'cancelado' ? 'Cancelado' : inv.status || '-';

                return [
                    inv.consumer_units?.numero_uc || '-',
                    abbreviateName(getDisplayName(inv) !== '-' ? getDisplayName(inv) : inv.consumer_units?.titular_conta, 20),
                    inv.mes_referencia ? (() => {
                        const [year, month] = inv.mes_referencia.split('-');
                        return `${month}/${year}`;
                    })() : '-',
                    formatCurrency(billValue),
                    formattedVenc,
                    getAnteriorLeitura(inv),
                    inv.data_leitura ? inv.data_leitura.split('T')[0].split('-').reverse().join('/') : '-',
                    inv.consumo_kwh ? `${inv.consumo_kwh} kWh` : '-',
                    inv.consumo_compensado ? `${inv.consumo_compensado} kWh` : '-',
                    inv.energia_injetada ? `${inv.energia_injetada} kWh` : '-',
                    stConta,
                    stFatura
                ];
            });

            autoTable(doc, {
                startY: 40,
                head: [[
                    'Cód. Cliente', 
                    'Assinante / Usina', 
                    'Ref.', 
                    'Vl. Conta', 
                    'Vencimento', 
                    'Lt. Ant.', 
                    'Lt. Atual', 
                    'Consumo', 
                    'Compens.', 
                    'Injetada', 
                    'St. Conta', 
                    'St. Fatura'
                ]],
                body: tableBody,
                theme: 'striped',
                headStyles: { fillColor: [0, 51, 102], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
                bodyStyles: { fontSize: 7.5, textColor: [51, 65, 85] },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                margin: { left: 10, right: 10 },
                columnStyles: {
                    0: { cellWidth: 26 },
                    1: { cellWidth: 40 },
                    2: { cellWidth: 16, halign: 'center' },
                    3: { cellWidth: 24, halign: 'right' },
                    4: { cellWidth: 22, halign: 'center' },
                    5: { cellWidth: 20, halign: 'center' },
                    6: { cellWidth: 20, halign: 'center' },
                    7: { cellWidth: 22, halign: 'center' },
                    8: { cellWidth: 22, halign: 'center' },
                    9: { cellWidth: 22, halign: 'center' },
                    10: { cellWidth: 21, halign: 'center' },
                    11: { cellWidth: 22, halign: 'center' }
                },
                didDrawPage: (data) => {
                    const str = `Página ${data.pageNumber}`;
                    doc.setFontSize(8);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(148, 163, 184);
                    doc.text(str, pageWidth - 10, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
                }
            });

            doc.save(`Extrato_Contas_Energia_${new Date().toISOString().substring(0, 10)}.pdf`);
            showAlert('Extrato de contas de energia gerado com sucesso!', 'success');
        } else {
            // ==========================================
            // EXTRATO DE FATURAS E EVENTOS
            // ==========================================
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 51, 102); // Navy Blue
            doc.text('EXTRATO DE FATURAS E EVENTOS', 14, 18);
            
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 116, 139); // Slate Grey
            doc.text(`Gerado em: ${generationDate}`, pageWidth - 14, 18, { align: 'right' });

            // Linha divisória
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.5);
            doc.line(14, 22, pageWidth - 14, 22);

            // Resumo financeiro / Filtros aplicados
            const totalFact = sortedInvoices.reduce((sum, inv) => sum + (inv.parent_invoice_id ? 0 : (Number(inv.valor_a_pagar) || 0)), 0);
            
            const totalAtrasado = sortedInvoices
                .filter(inv => inv.status === 'atrasado')
                .reduce((sum, inv) => sum + (inv.parent_invoice_id ? 0 : (Number(inv.valor_a_pagar) || 0)), 0);
            const totalSemFaturamento = sortedInvoices
                .filter(inv => inv.status === 'sem_faturamento' || inv.status === 'ag_emissao_boleto')
                .reduce((sum, inv) => sum + (inv.parent_invoice_id ? 0 : (Number(inv.valor_a_pagar) || 0)), 0);
            const totalPago = sortedInvoices
                .filter(inv => inv.status === 'pago' || inv.status === 'confirmado')
                .reduce((sum, inv) => sum + (inv.parent_invoice_id ? 0 : (Number(inv.valor_a_pagar) || 0)), 0);
            const totalAVencer = sortedInvoices
                .filter(inv => inv.status === 'a_vencer')
                .reduce((sum, inv) => sum + (inv.parent_invoice_id ? 0 : (Number(inv.valor_a_pagar) || 0)), 0);

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
                const energyBillValue = getEnergyBillValue(inv);
                const vencStr = inv.vencimento ? inv.vencimento.split('T')[0].split('-').reverse().join('/') : getInvoiceDueDate(inv);
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
                    abbreviateName(getDisplayName(inv) !== '-' ? getDisplayName(inv) : inv.consumer_units?.titular_conta, 20),
                    inv.mes_referencia ? (() => {
                        const [year, month] = inv.mes_referencia.split('-');
                        return `${month}/${year}`;
                    })() : '-',
                    inv.consumo_compensado ? `${inv.consumo_compensado} kWh` : '-',
                    formatCurrency(energyBillValue),
                    vencStr,
                    getAnteriorLeitura(inv),
                    inv.data_leitura ? inv.data_leitura.split('T')[0].split('-').reverse().join('/') : '-',
                    formatCurrency(factValue),
                    statusLabel
                ];
            });

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
        }
    };

    // Faturas/Contas list that ignores status filter for calculating totals dynamically
    const invoicesForTotals = invoices.filter(inv => {
        // Mesmo critério de filteredInvoices: na aba Contas de Energia a fatura
        // cancelada continua contando, porque o valor devido à concessionária
        // permanece devido.
        if (activeTab === 'faturas' && ['cancelado', 'cancelada'].includes(inv.status)) return false;
        if (inv.parent_invoice_id) {
            if (!(activeTab === 'contas_energia' && viewMode === 'energy_list')) {
                return false;
            }
        }

        if (activeTab === 'faturas') {
            // Permitir 'sem_faturamento' no cálculo de totais
            // if (inv.status === 'sem_faturamento') return false;
            const valPagar = Number(inv.valor_a_pagar) || 0;
            const valConcessionaria = Number(inv.valor_concessionaria) || 0;
            if (valPagar <= 0 && valConcessionaria <= 0) return false;
        } else {
            if (!['auto_consumo_remoto', 'geracao_compartilhada'].includes(inv.consumer_units?.modalidade)) return false;
            if (!matchesReadingDatePeriod(inv)) return false;
        }

        if (!matchesSearchFilter(inv)) return false;
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
    // "Pago + divergencia" conta tambem nos chips dos dois pais, igual ao filtro.
    contasCounts.pago = (contasCounts.pago || 0) + (contasCounts.inconsistente_pago || 0) + (contasCounts.contestada_pago || 0);
    contasCounts.inconsistente = (contasCounts.inconsistente || 0) + (contasCounts.inconsistente_pago || 0);
    contasCounts.contestada = (contasCounts.contestada || 0) + (contasCounts.contestada_pago || 0);

    useEffect(() => {
        fetchInvoices();
        fetchUcs();
    }, [monthFilter, filterCriterion, activeTab]);

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
                        tipo_unidade,
                        usina_id,
                        fatura_consumo_terceiro,
                        status,
                        dia_vencimento,
                        tarifa_concessionaria,
                        desconto_assinante,
                        nao_faturavel,
                        address,
                        subscribers!consumer_units_subscriber_id_fkey(id, name, email, phone, cpf_cnpj),
                        titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(id, name, email, phone, cpf_cnpj),
                        usinas!consumer_units_usina_id_fkey(id, name),
                        suppliers!consumer_units_supplier_id_fkey(name)
                    )
                `);

            if (monthFilter !== 'all') {
                const [year, month] = monthFilter.split('-');
                const startDate = `${year}-${month}-01`;
                const lastDay = new Date(year, month, 0).getDate();
                const endDate = `${year}-${month}-${lastDay}`;
                if (filterCriterion === 'mes_referencia') {
                    query = query.gte('mes_referencia', startDate).lte('mes_referencia', endDate);
                } else if (activeTab === 'contas_energia') {
                    // Na aba de contas de energia o vencimento que importa e o da
                    // CONCESSIONARIA -- e o que o card mostra. `vencimento` e o da
                    // fatura ao assinante e fica NULO na UG (nao ha cobranca): filtrando
                    // por ele, a conta da UG nao caia em mes nenhum e sumia da tela
                    // (Santa Maria 09/2026, R$ 113,50, vencida e invisivel).
                    // Sem data da concessionaria, vale a do assinante.
                    query = query.or(
                        `and(vencimento_concessionaria.gte.${startDate},vencimento_concessionaria.lte.${endDate}),` +
                        `and(vencimento_concessionaria.is.null,vencimento.gte.${startDate},vencimento.lte.${endDate})`
                    );
                } else {
                    if (activeTab === 'contas_energia') {
                        query = query.or(`and(vencimento_concessionaria.gte.${startDate},vencimento_concessionaria.lte.${endDate}),and(vencimento_concessionaria.is.null,vencimento.gte.${startDate},vencimento.lte.${endDate})`);
                    } else {
                        query = query.gte('vencimento', startDate).lte('vencimento', endDate);
                    }
                }
            }

            const { data, error } = await query.order('vencimento', { ascending: true });
            if (error) throw error;
            const processedData = (data || []).map(inv => {
                if (inv.status === 'a_vencer' || inv.status === 'pendente' || inv.status === 'ag_emissao_boleto') {
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
                id, numero_uc, concessionaria, titular_conta, tipo_unidade, usina_id,
                tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento,
                status, dia_leitura, created_at, last_scraping_status,
                subscribers!consumer_units_subscriber_id_fkey(name, cpf_cnpj),
                titular_fatura:subscribers!consumer_units_titular_fatura_id_fkey(name, cpf_cnpj),
                usinas!consumer_units_usina_id_fkey(id, name),
                suppliers!consumer_units_supplier_id_fkey(name)
            `)
            .in('status', ['aguardando_conexao', 'ativo', 'sem_geracao', 'em_atraso', 'desconectado', 'desligado_por_tt'])
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
        // Unidade geradora não gera cobrança ao assinante: a conta dela é despesa
        // da usina, abatida no fechamento. Emitir boleto aqui seria cobrança indevida.
        // Exceção: UG de telhado arrendado, onde quem consome é um terceiro e a
        // conta é dele (fatura_consumo_terceiro).
        if (inv.consumer_units?.tipo_unidade === 'geradora'
            && !inv.consumer_units?.fatura_consumo_terceiro) {
            showAlert('Esta é uma Unidade Geradora: a conta dela é despesa da usina, não cobrança ao assinante. Boleto não emitido.', 'warning');
            return;
        }
        const confirm = await showConfirm(`Gerar boleto Asaas para a fatura de ${inv.consumer_units?.titular_conta}?`);
        if (!confirm) return;
        setGeneratingId(inv.id);
        try {
            const result = await createAsaasCharge(inv.id);
            if (result.semBoleto) {
                showAlert(result.mensagem, 'info');
                fetchInvoices();
            } else if (result.url) {
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
        // O que se paga a concessionaria e a CONTA INTEIRA.
        //
        // Isto somava tarifa_minima + iluminacao + outros e deixava a energia
        // de fora. Em 27 das 30 contas em aberto o botao pagaria menos do que
        // a conta -- na UC 1.984.366.032-02 (08/2026) seriam R$ 961,59 numa
        // conta de R$ 6.591,56. As tres que batiam eram coincidencia: faturas
        // parceladas com consumo_reais zerado.
        const utilityValue = Number(inv.valor_concessionaria) || 0;

        if (utilityValue <= 0) {
            showAlert('Conta sem valor apurado. Confira a fatura antes de pagar.', 'warning');
            return;
        }

        // Conferencia gratuita: o valor a debitar esta dentro do proprio codigo
        // de barras. Divergiu, alguma leitura esta errada e nao se paga nenhuma
        // das duas.
        const valorBarras = valorDoCodigoDeBarras(inv.linha_digitavel);
        if (valorBarras !== null && Math.abs(valorBarras - utilityValue) > 0.02) {
            showAlert(
                `O código de barras cobra ${formatCurrency(valorBarras)}, mas a conta registrada é ${formatCurrency(utilityValue)}. `
                + 'Confira a conta antes de pagar — não é seguro pagar por nenhum dos dois valores.',
                'error'
            );
            return;
        }

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

    const getEnergyStatusBadge = (inv) => {
        const resolved = resolveEnergyStatus(inv);
        const map = {
            'pendente': { color: '#c2410c', dot: '#f97316', bg: '#fff7ed', border: '#fed7aa', label: 'Pendente', icon: Clock },
            'indisponivel': { color: '#b91c1c', dot: '#ef4444', bg: '#fef2f2', border: '#fecaca', label: 'Indisponível', icon: AlertCircle },
            'baixada': { color: '#1d4ed8', dot: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', label: 'Baixada', icon: CheckCircle },
            'processada': { color: '#15803d', dot: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0', label: 'Processada', icon: CheckCircle2 },
            'a_vencer': { color: '#1d4ed8', dot: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', label: 'A Vencer', icon: Clock },
            'inconsistente': { color: '#c2410c', dot: '#ea580c', bg: '#ffedd5', border: '#fdba74', label: 'Inconsistente', icon: AlertCircle },
            'contestada': { color: '#6d28d9', dot: '#7c3aed', bg: '#f3e8ff', border: '#ddd6fe', label: 'Contestado', icon: Ban },
            'inconsistente_pago': { ...ENERGY_PAID_DIVERGENT.inconsistente_pago, dot: ENERGY_PAID_DIVERGENT.inconsistente_pago.color, border: `${ENERGY_PAID_DIVERGENT.inconsistente_pago.color}35`, icon: CheckCircle },
            'contestada_pago': { ...ENERGY_PAID_DIVERGENT.contestada_pago, dot: ENERGY_PAID_DIVERGENT.contestada_pago.color, border: `${ENERGY_PAID_DIVERGENT.contestada_pago.color}35`, icon: CheckCircle },
            'parcelada': { color: '#854d0e', dot: '#ca8a04', bg: '#fef9c3', border: '#fde047', label: 'Parcelado', icon: Info },
            'atrasada': { color: '#b91c1c', dot: '#dc2626', bg: '#fee2e2', border: '#fecaca', label: 'Atrasado', icon: AlertCircle },
            'pago': { color: '#166534', dot: '#16a34a', bg: '#dcfce7', border: '#bbf7d0', label: 'Pago', icon: CheckCircle }
        };
        const s = map[resolved] || map['pendente'];
        const Icon = s.icon;
        return (
            <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.22rem 0.65rem',
                background: s.bg,
                color: s.color,
                border: `1px solid ${s.border || `${s.color}30`}`,
                borderRadius: '999px',
                fontSize: '0.73rem',
                width: 'fit-content',
                fontWeight: 700,
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                lineHeight: 1.2
            }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.dot || s.color, flexShrink: 0 }} />
                <Icon size={11} style={{ flexShrink: 0 }} />
                {s.label}
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
            'sem_faturamento': { color: '#1d4ed8', dot: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', label: 'Sem Faturamento', icon: FileText },
            'ag_emissao_boleto': { color: '#1d4ed8', dot: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', label: 'Sem Faturamento', icon: FileText },
            'a_vencer': { color: '#854d0e', dot: '#ca8a04', bg: '#fef9c3', border: '#fde047', label: 'A Vencer', icon: Clock },
            'atrasado': { color: '#b91c1c', dot: '#dc2626', bg: '#fee2e2', border: '#fecaca', label: 'Atrasado', icon: AlertCircle },
            'confirmado': { color: '#0e7490', dot: '#0891b2', bg: '#ecfeff', border: '#a5f3fc', label: 'Confirmado', icon: CheckCircle2 },
            'pago': { color: '#166534', dot: '#16a34a', bg: '#dcfce7', border: '#bbf7d0', label: 'Pago', icon: CheckCircle },
            'cancelado': { color: '#475569', dot: '#64748b', bg: '#f1f5f9', border: '#cbd5e1', label: 'Cancelada', icon: Ban },
        };
        const s = map[status] || map['a_vencer'];
        const Icon = s.icon;
        return (
            <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.22rem 0.65rem',
                background: s.bg,
                color: s.color,
                border: `1px solid ${s.border}`,
                borderRadius: '999px',
                fontSize: '0.73rem',
                fontWeight: 700,
                letterSpacing: '0.01em',
                width: 'fit-content',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                lineHeight: 1.2
            }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
                <Icon size={11} style={{ flexShrink: 0 }} />
                {s.label}
            </span>
        );
    };

    const InvoiceCalendarView = ({ invoices, onEdit }) => {
        const now = new Date();
        const [year, month] = monthFilter === 'all' 
            ? [now.getFullYear(), now.getMonth() + 1] 
            : monthFilter.split('-').map(Number);
        const isCurrentMonthView = year === now.getFullYear() && month === (now.getMonth() + 1);
        const todayNum = now.getDate();

        const firstDay = new Date(year, month - 1, 1).getDay();
        const startOffset = (firstDay + 6) % 7; // Segunda = 0
        const daysInMonth = new Date(year, month, 0).getDate();
        const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

        const validCalendarInvoices = invoices.filter(inv => inv.vencimento && !['cancelado', 'cancelada'].includes(inv.status));

        const groupedInvoices = validCalendarInvoices.reduce((acc, inv) => {
            const date = new Date(inv.vencimento);
            const day = date.getUTCDate();
            if (!acc[day]) acc[day] = [];
            acc[day].push(inv);
            return acc;
        }, {});

        const summary = validCalendarInvoices.reduce((acc, inv) => {
            const val = Number(inv.valor_a_pagar) || 0;
            acc.totalCount++;
            acc.totalVal += val;
            if (inv.status === 'pago') {
                acc.pagoCount++;
                acc.pagoVal += val;
            } else if (inv.status === 'atrasado') {
                acc.atrasadoCount++;
                acc.atrasadoVal += val;
            } else {
                acc.aVencerCount++;
                acc.aVencerVal += val;
            }
            return acc;
        }, { totalCount: 0, totalVal: 0, pagoCount: 0, pagoVal: 0, aVencerCount: 0, aVencerVal: 0, atrasadoCount: 0, atrasadoVal: 0 });

        return (
            <div style={{ padding: '1.15rem', display: 'flex', flexDirection: 'column', gap: '1rem', fontVariantNumeric: 'tabular-nums' }}>
                {/* Resumo Executivo de Vencimentos */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                    gap: '0.85rem'
                }}>
                    <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 2px rgba(15,23,42,0.03)' }}>
                        <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Programado</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: '0.15rem' }}>{formatCurrency(summary.totalVal)}</div>
                        </div>
                        <span style={{ background: '#f1f5f9', color: '#334155', fontWeight: 800, fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '999px', border: '1px solid #e2e8f0' }}>
                            {summary.totalCount} {summary.totalCount === 1 ? 'fatura' : 'faturas'}
                        </span>
                    </div>
                    <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #bbf7d0', borderLeft: '4px solid #16a34a', padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 2px rgba(15,23,42,0.03)' }}>
                        <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Liquidado / Pago</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#166534', marginTop: '0.15rem' }}>{formatCurrency(summary.pagoVal)}</div>
                        </div>
                        <span style={{ background: '#dcfce7', color: '#166534', fontWeight: 800, fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '999px' }}>
                            {summary.pagoCount}
                        </span>
                    </div>
                    <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #fde047', borderLeft: '4px solid #ca8a04', padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 2px rgba(15,23,42,0.03)' }}>
                        <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#854d0e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>A Vencer / Em Aberto</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#854d0e', marginTop: '0.15rem' }}>{formatCurrency(summary.aVencerVal)}</div>
                        </div>
                        <span style={{ background: '#fef9c3', color: '#854d0e', fontWeight: 800, fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '999px' }}>
                            {summary.aVencerCount}
                        </span>
                    </div>
                    <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 2px rgba(15,23,42,0.03)' }}>
                        <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Em Atraso</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#dc2626', marginTop: '0.15rem' }}>{formatCurrency(summary.atrasadoVal)}</div>
                        </div>
                        <span style={{ background: '#fee2e2', color: '#b91c1c', fontWeight: 800, fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '999px' }}>
                            {summary.atrasadoCount}
                        </span>
                    </div>
                </div>

                {/* Grade do Calendário */}
                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', 
                    gap: '0.85rem'
                }}>
                    <div style={{
                        gridColumn: '1 / -1',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, 1fr)',
                        gap: '0.85rem',
                        position: 'sticky',
                        top: 'calc(var(--sticky-header-height, 120px) + 1.5rem)',
                        zIndex: 10,
                        background: 'rgba(248, 250, 252, 0.95)',
                        backdropFilter: 'blur(8px)',
                        padding: '0.4rem 0',
                        borderBottom: '1px solid #e2e8f0'
                    }}>
                        {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((d, idx) => (
                            <div key={d} style={{ 
                                fontWeight: 800, 
                                textAlign: 'center', 
                                padding: '0.4rem', 
                                color: idx >= 5 ? '#94a3b8' : '#475569', 
                                fontSize: '0.72rem', 
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                background: 'white',
                                borderRadius: '8px',
                                border: '1px solid #e2e8f0'
                            }}>
                                {d}
                            </div>
                        ))}
                    </div>
                    {Array.from({ length: startOffset }).map((_, i) => (
                        <div key={`pad-${i}`} style={{ background: 'rgba(241, 245, 249, 0.45)', borderRadius: '14px', border: '1px dashed #cbd5e1', minHeight: '220px' }} />
                    ))}
                    {calendarDays.map(day => {
                        const dayInvoices = groupedInvoices[day] || [];
                        const hasItems = dayInvoices.length > 0;
                        const isToday = isCurrentMonthView && day === todayNum;
                        const totalAmount = dayInvoices.reduce((sum, inv) => sum + (Number(inv.valor_a_pagar) || 0), 0);

                        const counts = dayInvoices.reduce((acc, inv) => {
                            acc[inv.status] = (acc[inv.status] || 0) + 1;
                            return acc;
                        }, {});

                        const hasAtrasado = (counts.atrasado || 0) > 0;
                        const allPago = hasItems && (counts.pago === dayInvoices.length);
                        const headerBg = !hasItems ? '#f8fafc' : hasAtrasado ? '#fef2f2' : allPago ? '#f0fdf4' : '#fffbeb';
                        const headerBorder = !hasItems ? '#f1f5f9' : hasAtrasado ? '#fecaca' : allPago ? '#bbf7d0' : '#fde68a';
                        const amountColor = hasAtrasado ? '#b91c1c' : allPago ? '#166534' : '#0f172a';
                        const amountBg = hasAtrasado ? '#fee2e2' : allPago ? '#dcfce7' : '#f1f5f9';

                        return (
                            <div key={day} style={{
                                background: hasItems ? 'white' : '#f8fafc',
                                borderRadius: '14px',
                                border: isToday ? '2px solid #2563eb' : hasItems ? '1px solid #cbd5e1' : '1px dashed #e2e8f0',
                                minHeight: '250px',
                                height: '265px',
                                display: 'flex',
                                flexDirection: 'column',
                                boxShadow: hasItems ? '0 2px 8px -2px rgba(15, 23, 42, 0.06)' : 'none',
                                transition: 'all 0.2s',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    padding: '0.6rem 0.75rem',
                                    borderBottom: `1px solid ${headerBorder}`,
                                    background: headerBg,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: '0.35rem'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 0 }}>
                                        <span style={{
                                            fontWeight: 800,
                                            color: isToday ? '#1d4ed8' : hasItems ? '#0f172a' : '#94a3b8',
                                            fontSize: '0.8rem',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            Dia {String(day).padStart(2, '0')}
                                        </span>
                                        {isToday && (
                                            <span style={{ fontSize: '0.6rem', fontWeight: 800, background: '#2563eb', color: 'white', padding: '0.08rem 0.35rem', borderRadius: '4px', textTransform: 'uppercase' }}>
                                                Hoje
                                            </span>
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                            {counts.pago > 0 && <span title={`Pagas: ${counts.pago}`} style={{ background: '#dcfce7', color: '#166534', border: '1px solid #86efac', padding: '0.05rem 0.35rem', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 800 }}>{counts.pago}</span>}
                                            {counts.a_vencer > 0 && <span title={`A Vencer: ${counts.a_vencer}`} style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047', padding: '0.05rem 0.35rem', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 800 }}>{counts.a_vencer}</span>}
                                            {counts.atrasado > 0 && <span title={`Vencidas: ${counts.atrasado}`} style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', padding: '0.05rem 0.35rem', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 800 }}>{counts.atrasado}</span>}
                                        </div>
                                    </div>
                                    {totalAmount > 0 && (
                                        <span style={{
                                            fontSize: '0.68rem',
                                            color: amountColor,
                                            background: amountBg,
                                            padding: '0.15rem 0.45rem',
                                            borderRadius: '6px',
                                            fontWeight: 800,
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {formatCurrency(totalAmount)}
                                        </span>
                                    )}
                                </div>
                                <div style={{ padding: '0.65rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.55rem', overflowY: 'auto', scrollbarWidth: 'thin' }}>
                                    {!hasItems ? (
                                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>
                                            Sem vencimentos
                                        </div>
                                    ) : (
                                        dayInvoices.map(inv => {
                                            const statusData = {
                                                'sem_faturamento': { color: '#1d4ed8', dot: '#2563eb', label: 'Sem Fat.', bg: '#eff6ff' },
                                                'confirmado': { color: '#0e7490', dot: '#0891b2', label: 'Confirmado', bg: '#ecfeff' },
                                                'pago': { color: '#166534', dot: '#16a34a', label: 'Pago', bg: '#dcfce7' },
                                                'atrasado': { color: '#b91c1c', dot: '#dc2626', label: 'Atrasado', bg: '#fee2e2' },
                                                'a_vencer': { color: '#854d0e', dot: '#ca8a04', label: 'A Vencer', bg: '#fef9c3' }
                                            };
                                            const s = statusData[inv.status] || statusData['a_vencer'];
                                            const isBoletoEmitido = !!inv.asaas_boleto_url;

                                            return (
                                                <div
                                                    key={inv.id}
                                                    onClick={() => onEdit(inv)}
                                                    style={{
                                                        padding: '0.65rem 0.7rem',
                                                        borderRadius: '10px',
                                                        background: 'white',
                                                        border: '1px solid #e2e8f0',
                                                        borderLeft: `3.5px solid ${s.dot}`,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.18s ease',
                                                        position: 'relative',
                                                        flexShrink: 0,
                                                        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)'
                                                    }}
                                                    onMouseOver={e => {
                                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                                        e.currentTarget.style.boxShadow = '0 6px 12px -2px rgba(15, 23, 42, 0.08)';
                                                        e.currentTarget.style.borderColor = '#93c5fd';
                                                    }}
                                                    onMouseOut={e => {
                                                        e.currentTarget.style.transform = 'translateY(0)';
                                                        e.currentTarget.style.boxShadow = '0 1px 2px rgba(15, 23, 42, 0.03)';
                                                        e.currentTarget.style.borderColor = '#e2e8f0';
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.35rem', marginBottom: '0.25rem' }}>
                                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                                                            {getDisplayName(inv) !== '-' ? getDisplayName(inv) : 'S/ Assinante'}
                                                        </div>
                                                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', padding: '0.08rem 0.38rem', borderRadius: '4px', border: '1px solid #bfdbfe', flexShrink: 0 }}>
                                                            {inv.consumer_units?.numero_uc || '-'}
                                                        </span>
                                                    </div>

                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.45rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.45rem', gap: '0.25rem' }}>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
                                                            <span style={{ fontSize: '0.6rem', fontWeight: 800, color: s.color, background: s.bg, padding: '0.1rem 0.38rem', borderRadius: '4px' }}>
                                                                {s.label}
                                                            </span>
                                                            <span style={{
                                                                fontSize: '0.6rem',
                                                                fontWeight: 700,
                                                                color: isBoletoEmitido ? '#0369a1' : '#c2410c',
                                                                background: isBoletoEmitido ? '#e0f2fe' : '#fff7ed',
                                                                padding: '0.1rem 0.38rem',
                                                                borderRadius: '4px',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '0.18rem'
                                                            }}>
                                                                {isBoletoEmitido ? <TicketCheck size={10} /> : <TicketMinus size={10} />}
                                                                {isBoletoEmitido ? 'Emitido' : 'Gerar'}
                                                            </span>
                                                        </div>
                                                        <span style={{ fontWeight: 800, fontSize: '0.8rem', color: '#0f172a', whiteSpace: 'nowrap' }}>
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
            </div>
        );
    };

    const EnergyCalendarView = ({ invoices, onInvoiceClick }) => {
        const now = new Date();
        const [year, month] = monthFilter === 'all' 
            ? [now.getFullYear(), now.getMonth() + 1] 
            : monthFilter.split('-').map(Number);
        const isCurrentMonthView = year === now.getFullYear() && month === (now.getMonth() + 1);
        const todayNum = now.getDate();

        const firstDay = new Date(year, month - 1, 1).getDay();
        const startOffset = (firstDay + 6) % 7; // Segunda = 0
        const daysInMonth = new Date(year, month, 0).getDate();
        const calendarDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        
        // Filtra faturas: apenas modalidade Auto Consumo Remoto ou Geração Compartilhada
        const filteredEnergyInvoices = invoices.filter(inv => 
            !inv.parent_invoice_id &&
            ['auto_consumo_remoto', 'geracao_compartilhada'].includes(inv.consumer_units?.modalidade) &&
            inv.status !== 'sem_faturamento' &&
            (Number(inv.valor_a_pagar) > 0 || Number(inv.valor_concessionaria) > 0)
        );
        const groupedInvoices = filteredEnergyInvoices.reduce((acc, inv) => {
            const dueStr = inv.vencimento_concessionaria || inv.vencimento;
            if (dueStr) {
                const date = new Date(dueStr.split('T')[0] + 'T12:00:00');
                const day = date.getDate();
                
                if (!acc[day]) acc[day] = [];
                acc[day].push(inv);
            }
            return acc;
        }, {});

        return (
            <div style={{ padding: '1.15rem', fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', 
                    gap: '0.85rem' 
                }}>
                    <div style={{
                        gridColumn: '1 / -1',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, 1fr)',
                        gap: '0.85rem',
                        position: 'sticky',
                        top: 'calc(var(--sticky-header-height, 120px) + 1.5rem)',
                        zIndex: 10,
                        background: 'rgba(248, 250, 252, 0.95)',
                        backdropFilter: 'blur(8px)',
                        padding: '0.4rem 0',
                        borderBottom: '1px solid #e2e8f0'
                    }}>
                        {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((d, idx) => (
                            <div key={d} style={{ 
                                fontWeight: 800, 
                                textAlign: 'center', 
                                padding: '0.4rem', 
                                color: idx >= 5 ? '#94a3b8' : '#475569', 
                                fontSize: '0.72rem', 
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                background: 'white',
                                borderRadius: '8px',
                                border: '1px solid #e2e8f0'
                            }}>
                                {d}
                            </div>
                        ))}
                    </div>
                    {Array.from({ length: startOffset }).map((_, i) => (
                        <div key={`pad-${i}`} style={{ background: 'rgba(241, 245, 249, 0.45)', borderRadius: '14px', border: '1px dashed #cbd5e1', minHeight: '250px' }} />
                    ))}
                    {calendarDays.map(day => {
                        const dayInvoices = groupedInvoices[day] || [];
                        const hasItems = dayInvoices.length > 0;
                        const isToday = isCurrentMonthView && day === todayNum;
                        
                        const hasAtrasado = dayInvoices.some(inv => resolveEnergyStatus(inv) === 'atrasada' || inv.status === 'atrasado');
                        const allPago = hasItems && dayInvoices.every(inv => isEnergyBillPaid(resolveEnergyStatus(inv)) || inv.status === 'pago');
                        const hasAVencer = dayInvoices.some(inv => resolveEnergyStatus(inv) === 'a_vencer' || inv.status === 'a_vencer');

                        const headerBg = !hasItems ? '#f8fafc' : 
                                        hasAtrasado ? '#fef2f2' : 
                                        allPago ? '#f0fdf4' : 
                                        hasAVencer ? '#fffbeb' : '#f8fafc';
                        
                        const headerBorder = !hasItems ? '#f1f5f9' : 
                                           hasAtrasado ? '#fecaca' : 
                                           allPago ? '#bbf7d0' : 
                                           hasAVencer ? '#fef08a' : '#e2e8f0';

                        const headerTextColor = !hasItems ? '#94a3b8' : 
                                              hasAtrasado ? '#991b1b' : 
                                              allPago ? '#166534' : 
                                              hasAVencer ? '#92400e' : '#0f172a';

                        return (
                            <div key={day} style={{
                                background: hasItems ? 'white' : '#f8fafc',
                                borderRadius: '14px',
                                border: isToday ? '2px solid #2563eb' : hasItems ? '1px solid #cbd5e1' : '1px dashed #e2e8f0',
                                minHeight: '280px',
                                display: 'flex',
                                flexDirection: 'column',
                                boxShadow: hasItems ? '0 2px 8px -2px rgba(15, 23, 42, 0.06)' : 'none',
                                transition: 'all 0.2s',
                                overflow: 'hidden'
                            }}>
                                <div style={{ 
                                    padding: '0.6rem 0.75rem', 
                                    borderBottom: `1px solid ${headerBorder}`, 
                                    background: headerBg, 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center' 
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 0 }}>
                                        <span style={{ 
                                            fontWeight: 800, 
                                            color: isToday ? '#1d4ed8' : headerTextColor, 
                                            fontSize: '0.78rem',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            Venc. {String(day).padStart(2, '0')}
                                        </span>
                                        {isToday && (
                                            <span style={{ fontSize: '0.6rem', fontWeight: 800, background: '#2563eb', color: 'white', padding: '0.08rem 0.35rem', borderRadius: '4px', textTransform: 'uppercase' }}>
                                                Hoje
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                                        {[
                                            { key: 'pago', bg: '#dcfce7', color: '#166534' },
                                            { key: 'a_vencer', bg: '#fef9c3', color: '#92400e' },
                                            { key: 'atrasado', bg: '#fee2e2', color: '#991b1b' }
                                        ].map(s => {
                                            const count = dayInvoices.filter(inv => inv.status === s.key).length;
                                            if (count === 0) return null;
                                            return (
                                                <span key={s.key} style={{ 
                                                    fontSize: '0.68rem', color: s.color, background: s.bg, 
                                                    padding: '0.1rem 0.38rem', borderRadius: '999px', fontWeight: 800,
                                                    border: `1px solid ${s.color}25`
                                                }}>
                                                    {count}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div style={{ padding: '0.65rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto', scrollbarWidth: 'thin' }}>
                                    {!hasItems ? (
                                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>
                                            Sem vencimentos
                                        </div>
                                    ) : (
                                        dayInvoices.map(inv => {
                                            const today = new Date();
                                            today.setHours(0, 0, 0, 0);
                                            const dueStr = inv.vencimento_concessionaria || inv.vencimento;
                                            const dueDate = dueStr ? new Date(dueStr.split('T')[0] + 'T12:00:00') : null;
                                            const isPastDue = dueDate && dueDate < today;
                                            
                                            const ebStatus = resolveEnergyStatus(inv);
                                            
                                            const statusData = {
                                                'pago': { color: '#166534', label: 'PAGA', bg: '#dcfce7' },
                                                'pendente': isPastDue 
                                                    ? { color: '#dc2626', label: 'ATRASADA', bg: '#fee2e2' }
                                                    : { color: '#2563eb', label: 'A VENCER', bg: '#eff6ff' },
                                                'a_vencer': { color: '#2563eb', label: 'A VENCER', bg: '#eff6ff' },
                                                'atrasada': { color: '#dc2626', label: 'ATRASADA', bg: '#fee2e2' },
                                                'erro': { color: '#991b1b', label: 'INDISPONÍVEL', bg: '#fef2f2' },
                                                'parcelada': { color: '#ca8a04', label: 'PARCELADA', bg: '#fef9c3' },
                                                'contestada': { color: '#7c3aed', label: 'CONTESTADA', bg: '#f3e8ff' },
                                                'inconsistente_pago': { color: ENERGY_PAID_DIVERGENT.inconsistente_pago.color, label: 'INCONSISTENTE PAGO', bg: ENERGY_PAID_DIVERGENT.inconsistente_pago.bg },
                                                'contestada_pago': { color: ENERGY_PAID_DIVERGENT.contestada_pago.color, label: 'CONTESTADO PAGO', bg: ENERGY_PAID_DIVERGENT.contestada_pago.bg }
                                            };
                                            
                                            const s = statusData[ebStatus] || { color: '#64748b', label: ebStatus.toUpperCase(), bg: '#f1f5f9' };
                                            const formatCurrencyValue = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

                                            // Valores da Concessionária
                                            const ip = Number(inv.iluminacao_publica) || 0;
                                            const outros = (Number(inv.tarifa_minima || inv.tarifa_minima_excedentes) || 0) + (Number(inv.outros_lancamentos) || 0) + (Number(inv.parcelamento) || 0);
                                            const valorConcessionaria = Number(inv.valor_concessionaria) || (ip + outros + (Number(inv.consumo_reais) || 0));

                                            return (
                                                <div
                                                    key={inv.id}
                                                    onClick={() => onInvoiceClick(inv)}
                                                    style={{
                                                        padding: '0.65rem',
                                                        borderRadius: '10px',
                                                        background: 'white',
                                                        border: '1px solid #e2e8f0',
                                                        cursor: 'pointer', 
                                                        transition: 'all 0.18s ease',
                                                        display: 'flex', 
                                                        flexDirection: 'column', 
                                                        gap: '0.35rem', 
                                                        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                                                        position: 'relative',
                                                        borderLeft: `3.5px solid ${s.color}`
                                                    }}
                                                    onMouseOver={e => {
                                                        e.currentTarget.style.borderColor = '#93c5fd';
                                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                                        e.currentTarget.style.boxShadow = '0 6px 12px -2px rgba(15, 23, 42, 0.08)';
                                                    }}
                                                    onMouseOut={e => {
                                                        e.currentTarget.style.borderColor = '#e2e8f0';
                                                        e.currentTarget.style.transform = 'translateY(0)';
                                                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(15, 23, 42, 0.04)';
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.35rem' }}>
                                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.78rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {getDisplayName(inv) !== '-' ? getDisplayName(inv) : 'Assinante'}
                                                        </div>
                                                        <span style={{ padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.55rem', fontWeight: 800, background: s.bg, color: s.color, flexShrink: 0 }}>
                                                            {s.label}
                                                        </span>
                                                    </div>

                                                    <div style={{ fontSize: '0.68rem', color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '0.06rem 0.35rem', borderRadius: '4px', fontWeight: 700, fontSize: '0.65rem' }}>
                                                            UC {inv.consumer_units?.numero_uc}
                                                        </span>
                                                        <span style={{ fontWeight: 700, color: '#475569' }}>{inv.consumo_kwh || 0} kWh</span>
                                                    </div>

                                                    <div style={{ height: '1px', background: '#f1f5f9', margin: '2px 0' }}></div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#64748b' }}>
                                                            <span>IP + Taxas:</span>
                                                            <span style={{ fontWeight: 600 }}>{formatCurrencyValue(ip + outros)}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                                                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569' }}>Vr. Conta:</span>
                                                            <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem' }}>
                                                                {formatCurrencyValue(valorConcessionaria)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Botão de Pagamento Concessionária */}
                                                    {!isEnergyBillPaid(ebStatus) && inv.linha_digitavel && (
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handlePayBill(inv);
                                                            }}
                                                            disabled={payingId === inv.id}
                                                            style={{
                                                                marginTop: '0.25rem',
                                                                padding: '0.38rem',
                                                                background: '#10b981',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '6px',
                                                                fontSize: '0.68rem',
                                                                fontWeight: 700,
                                                                cursor: payingId === inv.id ? 'default' : 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                gap: '0.3rem',
                                                                boxShadow: '0 1px 2px rgba(16, 185, 129, 0.2)'
                                                            }}
                                                        >
                                                            <CreditCard size={12} /> {payingId === inv.id ? 'PROCESSANDO...' : 'PAGAR CONTA'}
                                                        </button>
                                                    )}
                                                    
                                                    {isEnergyBillPaid(ebStatus) && (
                                                        <div style={{ 
                                                            marginTop: '0.25rem', 
                                                            padding: '0.32rem', 
                                                            textAlign: 'center', 
                                                            background: '#f0fdf4', 
                                                            color: '#166534', 
                                                            borderRadius: '6px', 
                                                            fontSize: '0.66rem', 
                                                            fontWeight: 800,
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

    const currentTotalAmount = activeTab === 'faturas'
        ? sortedInvoices.reduce((sum, inv) => sum + (inv.parent_invoice_id ? 0 : (Number(inv.valor_a_pagar) || 0)), 0)
        : sortedInvoices.reduce((sum, inv) => sum + getEnergyBillValue(inv), 0);

    const currentTotalConsumo = sortedInvoices.reduce((sum, inv) => sum + (Number(inv.consumo_kwh) || 0), 0);
    const currentTotalCompensado = sortedInvoices.reduce((sum, inv) => sum + (Number(inv.consumo_compensado) || 0), 0);

    const filteredUsinaSuggestions = availableUsinas.filter(uName =>
        !searchTerm.trim() || usinaCasaComBusca(uName, searchTerm)
    );
    const activeMatchedUsina = searchTerm.trim()
        ? availableUsinas.find(uName => normalizarTextoBusca(uName) === normalizarTextoBusca(searchTerm))
        : null;

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

            {/* Cabeçalho Fixo (Abas + Barra de Controles + Filtro de Status Reorganizado) */}
            <div style={{
                position: 'sticky',
                top: '-2rem',
                zIndex: 100,
                background: 'rgba(255, 255, 255, 0.92)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                padding: '0.75rem 2rem 0.85rem 2rem',
                margin: '-2rem -2rem 1rem -2rem',
                borderBottom: '1px solid #e2e8f0',
                boxShadow: '0 4px 20px -4px rgba(15, 23, 42, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem'
            }}>
                {!hideTabs ? (
                    <div style={{ display: 'flex', gap: '1.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.15rem', alignItems: 'center' }}>
                        {/* Aba Faturas */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <button
                                onClick={() => handleTabChange('faturas')}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: '0.45rem 0.2rem',
                                    fontSize: '0.92rem',
                                    fontWeight: 800,
                                    color: activeTab === 'faturas' ? 'var(--color-blue)' : '#64748b',
                                    borderBottom: activeTab === 'faturas' ? '2.5px solid var(--color-blue)' : '2.5px solid transparent',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    marginBottom: '-3px',
                                    outline: 'none',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.04em'
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
                                    background: activeInfoTab === 'faturas' ? 'var(--color-blue)' : '#eff6ff',
                                    color: activeInfoTab === 'faturas' ? 'white' : 'var(--color-blue)',
                                    border: '1px solid #bfdbfe',
                                    borderRadius: '50%',
                                    width: '18px',
                                    height: '18px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 800,
                                    fontSize: '0.68rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    outline: 'none'
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
                                    padding: '0.45rem 0.2rem',
                                    fontSize: '0.92rem',
                                    fontWeight: 800,
                                    color: activeTab === 'contas_energia' ? 'var(--color-blue)' : '#64748b',
                                    borderBottom: activeTab === 'contas_energia' ? '2.5px solid var(--color-blue)' : '2.5px solid transparent',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    marginBottom: '-3px',
                                    outline: 'none',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.04em'
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
                                    background: activeInfoTab === 'contas_energia' ? 'var(--color-blue)' : '#eff6ff',
                                    color: activeInfoTab === 'contas_energia' ? 'white' : 'var(--color-blue)',
                                    border: '1px solid #bfdbfe',
                                    borderRadius: '50%',
                                    width: '18px',
                                    height: '18px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 800,
                                    fontSize: '0.68rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    outline: 'none'
                                }}
                                title="Exibir informações da página de Contas de Energia"
                            >
                                !
                            </button>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem' }}>
                        <h2 style={{ color: '#0f172a', fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, textTransform: 'uppercase' }}>
                            {activeTab === 'faturas' ? 'Gestão de Faturas' : 'Contas de Energia Concessionária'}
                        </h2>
                    </div>
                )}

                {/* Linha 1: Controles de Período, Ordenação, Busca, Visualização e Ações */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
                    <div style={{
                        background: 'white',
                        padding: '0.3rem 0.65rem',
                        borderRadius: '10px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                        display: 'flex',
                        gap: '0.65rem',
                        alignItems: 'center',
                        flexWrap: 'wrap'
                    }}>
                        {/* Seletor de Mês */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <CalendarIcon size={15} color="#64748b" />
                            <div style={{ position: 'relative' }}>
                                <button
                                    onClick={() => setShowMonthPicker(!showMonthPicker)}
                                    style={{
                                        padding: '0.32rem 0.65rem',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        background: '#f8fafc',
                                        color: '#0f172a',
                                        fontWeight: 700,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.35rem',
                                        minWidth: '128px',
                                        fontSize: '0.8rem',
                                        textTransform: 'capitalize'
                                    }}
                                >
                                    <span>{monthFilter === 'all' ? 'Qualquer Data' : new Date(`${monthFilter}-01T00:00:00`).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                                </button>
                                {showMonthPicker && (
                                    <div style={{ position: 'absolute', top: '112%', left: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 12px 28px rgba(15,23,42,0.12)', zIndex: 120, padding: '1rem', width: '280px' }}>
                                        <div style={{ marginBottom: '0.85rem' }}>
                                            <button onClick={() => { setMonthFilter('all'); setShowMonthPicker(false); }} style={{ width: '100%', padding: '0.55rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: monthFilter === 'all' ? 'var(--color-blue)' : 'white', color: monthFilter === 'all' ? 'white' : '#475569', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }}>Qualquer Data</button>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.85rem' }}>
                                            <button onClick={() => { const parts = monthFilter === 'all' ? [new Date().getFullYear(), '01'] : monthFilter.split('-'); setMonthFilter(`${Number(parts[0]) - 1}-${parts[1]}`); }} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 800 }}>&lt;</button>
                                            <span style={{ fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{monthFilter === 'all' ? new Date().getFullYear() : monthFilter.split('-')[0]}</span>
                                            <button onClick={() => { const parts = monthFilter === 'all' ? [new Date().getFullYear(), '01'] : monthFilter.split('-'); setMonthFilter(`${Number(parts[0]) + 1}-${parts[1]}`); }} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 800 }}>&gt;</button>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.45rem' }}>
                                            {['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'].map((m, idx) => {
                                                const mVal = String(idx + 1).padStart(2, '0');
                                                const currentYear = monthFilter === 'all' ? new Date().getFullYear() : monthFilter.split('-')[0];
                                                const isSelected = monthFilter === `${currentYear}-${mVal}`;
                                                return <button key={m} onClick={() => { setMonthFilter(`${currentYear}-${mVal}`); setShowMonthPicker(false); }} style={{ padding: '0.45rem', border: 'none', borderRadius: '6px', background: isSelected ? 'var(--color-blue)' : '#f8fafc', color: isSelected ? 'white' : '#475569', fontWeight: isSelected ? 700 : 600, cursor: 'pointer', fontSize: '0.8rem' }}>{m}</button>;
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Critério: Mês Ref vs Vencimento */}
                        <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.18rem', borderRadius: '7px', border: '1px solid #e2e8f0' }}>
                            <button
                                onClick={() => setFilterCriterion('mes_referencia')}
                                style={{
                                    border: 'none',
                                    borderRadius: '5px',
                                    padding: '0.28rem 0.55rem',
                                    fontSize: '0.73rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    background: filterCriterion === 'mes_referencia' ? 'var(--color-blue)' : 'transparent',
                                    color: filterCriterion === 'mes_referencia' ? 'white' : '#64748b',
                                    transition: 'all 0.18s',
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
                                    borderRadius: '5px',
                                    padding: '0.28rem 0.55rem',
                                    fontSize: '0.73rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    background: filterCriterion === 'vencimento' ? 'var(--color-blue)' : 'transparent',
                                    color: filterCriterion === 'vencimento' ? 'white' : '#64748b',
                                    transition: 'all 0.18s',
                                    outline: 'none',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Vencimento
                            </button>
                        </div>

                        {viewMode === 'energy_reading_calendar' && (
                            <>
                                <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }}></div>
                                <select 
                                    value={readingStatusFilter} 
                                    onChange={e => setReadingStatusFilter(e.target.value)} 
                                    style={{ padding: '0.32rem 0.55rem', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, color: '#334155', background: '#f8fafc', cursor: 'pointer', outline: 'none' }}
                                >
                                    <option value="">Status Leitura (Todos)</option>
                                    <option value="success">Sucesso</option>
                                    <option value="pending">Pendente</option>
                                    <option value="error">Erro</option>
                                    <option value="processing">Processando</option>
                                </select>
                            </>
                        )}

                        {activeTab === 'contas_energia' && (
                            <>
                                <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }}></div>
                                {/* Filtro Período de Leitura (De / Até em D/M/A) */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontVariantNumeric: 'tabular-nums' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>Leitura:</span>
                                    <div style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.28rem',
                                        background: readingDateFrom ? '#eff6ff' : '#f8fafc',
                                        border: readingDateFrom ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                                        borderRadius: '6px',
                                        padding: '0.2rem 0.45rem',
                                        position: 'relative'
                                    }}>
                                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>De</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            placeholder="dd/mm/aaaa"
                                            maxLength={10}
                                            value={readingDateFrom}
                                            onChange={e => setReadingDateFrom(formatDmaInput(e.target.value))}
                                            style={{
                                                border: 'none',
                                                background: 'transparent',
                                                outline: 'none',
                                                fontSize: '0.76rem',
                                                fontWeight: 600,
                                                color: '#0f172a',
                                                width: '76px',
                                                padding: '0.08rem 0',
                                                fontVariantNumeric: 'tabular-nums'
                                            }}
                                            title="Data inicial da leitura atual (Dia/Mês/Ano)"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (readingFromPickerRef.current?.showPicker) {
                                                    readingFromPickerRef.current.showPicker();
                                                } else {
                                                    readingFromPickerRef.current?.focus();
                                                }
                                            }}
                                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#64748b', display: 'inline-flex', alignItems: 'center' }}
                                            title="Selecionar data inicial no calendário"
                                        >
                                            <CalendarIcon size={12} />
                                        </button>
                                        <input
                                            ref={readingFromPickerRef}
                                            type="date"
                                            value={readingFromIso}
                                            onChange={e => setReadingDateFrom(isoToDma(e.target.value))}
                                            tabIndex={-1}
                                            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                                        />
                                    </div>

                                    <div style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.28rem',
                                        background: readingDateTo ? '#eff6ff' : '#f8fafc',
                                        border: readingDateTo ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                                        borderRadius: '6px',
                                        padding: '0.2rem 0.45rem',
                                        position: 'relative'
                                    }}>
                                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Até</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            placeholder="dd/mm/aaaa"
                                            maxLength={10}
                                            value={readingDateTo}
                                            onChange={e => setReadingDateTo(formatDmaInput(e.target.value))}
                                            style={{
                                                border: 'none',
                                                background: 'transparent',
                                                outline: 'none',
                                                fontSize: '0.76rem',
                                                fontWeight: 600,
                                                color: '#0f172a',
                                                width: '76px',
                                                padding: '0.08rem 0',
                                                fontVariantNumeric: 'tabular-nums'
                                            }}
                                            title="Data final da leitura atual (Dia/Mês/Ano)"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (readingToPickerRef.current?.showPicker) {
                                                    readingToPickerRef.current.showPicker();
                                                } else {
                                                    readingToPickerRef.current?.focus();
                                                }
                                            }}
                                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#64748b', display: 'inline-flex', alignItems: 'center' }}
                                            title="Selecionar data final no calendário"
                                        >
                                            <CalendarIcon size={12} />
                                        </button>
                                        <input
                                            ref={readingToPickerRef}
                                            type="date"
                                            value={readingToIso}
                                            onChange={e => setReadingDateTo(isoToDma(e.target.value))}
                                            tabIndex={-1}
                                            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                                        />
                                    </div>

                                    {(readingDateFrom || readingDateTo) && (
                                        <button
                                            type="button"
                                            onClick={() => { setReadingDateFrom(''); setReadingDateTo(''); }}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: '#94a3b8',
                                                cursor: 'pointer',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                padding: '0.1rem'
                                            }}
                                            title="Limpar período de leitura"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                            </>
                        )}

                        <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }}></div>

                        {/* Ordenação */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>Ordenar:</span>
                            <select 
                                value={sortBy} 
                                onChange={e => setSortBy(e.target.value)} 
                                style={{ padding: '0.32rem 0.55rem', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.78rem', color: '#0f172a', background: '#f8fafc', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                            >
                                <option value="ref_desc">Ref. Mês/Ano (Mais Novo)</option>
                                <option value="ref_asc">Ref. Mês/Ano (Mais Antigo)</option>
                                <option value="venc_desc">Vencimento (Mais Novo)</option>
                                <option value="venc_asc">Vencimento (Mais Antigo)</option>
                                <option value="uc_asc">Código UC (A-Z)</option>
                                <option value="uc_desc">Código UC (Z-A)</option>
                                <option value="valor_desc">Valor (Maior primeiro)</option>
                                <option value="valor_asc">Valor (Menor primeiro)</option>
                                <option value="assinante_asc">Assinante (A-Z)</option>
                                <option value="assinante_desc">Assinante (Z-A)</option>
                            </select>
                        </div>

                        <div style={{ width: '1px', height: '18px', background: '#e2e8f0' }}></div>

                        {/* Busca Rápida (UC, Assinante ou Usina) */}
                        <div
                            ref={searchContainerRef}
                            style={{
                                position: 'relative',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                background: activeMatchedUsina ? '#eff6ff' : '#f8fafc',
                                border: activeMatchedUsina ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                                borderRadius: '6px',
                                padding: '0.22rem 0.5rem'
                            }}
                        >
                            <Search size={14} color={activeMatchedUsina ? '#2563eb' : '#64748b'} />
                            {activeMatchedUsina && (
                                <span style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 800,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.03em',
                                    color: '#1d4ed8',
                                    background: '#dbeafe',
                                    padding: '0.06rem 0.35rem',
                                    borderRadius: '4px',
                                    flexShrink: 0
                                }}>
                                    Usina
                                </span>
                            )}
                            <input
                                placeholder="Buscar UC, assinante ou usina..."
                                value={searchTerm}
                                onFocus={() => setShowUsinaSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowUsinaSuggestions(false), 160)}
                                onChange={e => {
                                    setSearchTerm(e.target.value);
                                    setShowUsinaSuggestions(true);
                                }}
                                style={{ padding: '0.12rem 0', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.8rem', width: activeMatchedUsina ? '160px' : '195px', color: '#0f172a', fontWeight: activeMatchedUsina ? 700 : 500 }}
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => { setSearchTerm(''); setShowUsinaSuggestions(false); }}
                                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                                    title="Limpar busca"
                                >
                                    <X size={13} />
                                </button>
                            )}

                            {showUsinaSuggestions && filteredUsinaSuggestions.length > 0 && (
                                <div style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 6px)',
                                    left: 0,
                                    minWidth: '240px',
                                    maxHeight: '220px',
                                    overflowY: 'auto',
                                    background: 'white',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '10px',
                                    boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.12)',
                                    zIndex: 130,
                                    padding: '0.35rem'
                                }}>
                                    <div style={{
                                        padding: '0.25rem 0.5rem',
                                        fontSize: '0.65rem',
                                        fontWeight: 800,
                                        color: '#64748b',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                        borderBottom: '1px solid #f1f5f9',
                                        marginBottom: '0.2rem'
                                    }}>
                                        Filtrar por Usina ({filteredUsinaSuggestions.length})
                                    </div>
                                    {filteredUsinaSuggestions.map(uName => {
                                        const isSelectedUsina = normalizarTextoBusca(searchTerm) === normalizarTextoBusca(uName);
                                        return (
                                            <button
                                                key={uName}
                                                type="button"
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    setSearchTerm(isSelectedUsina ? '' : uName);
                                                    setShowUsinaSuggestions(false);
                                                }}
                                                style={{
                                                    width: '100%',
                                                    textAlign: 'left',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    gap: '0.5rem',
                                                    padding: '0.38rem 0.55rem',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    background: isSelectedUsina ? '#eff6ff' : 'transparent',
                                                    color: isSelectedUsina ? '#1d4ed8' : '#334155',
                                                    fontSize: '0.76rem',
                                                    fontWeight: isSelectedUsina ? 700 : 600,
                                                    cursor: 'pointer'
                                                }}
                                                onMouseEnter={e => {
                                                    if (!isSelectedUsina) e.currentTarget.style.background = '#f8fafc';
                                                }}
                                                onMouseLeave={e => {
                                                    if (!isSelectedUsina) e.currentTarget.style.background = 'transparent';
                                                }}
                                            >
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    <Zap size={12} color={isSelectedUsina ? '#2563eb' : '#f59e0b'} />
                                                    {uName}
                                                </span>
                                                <span style={{ fontSize: '0.64rem', color: '#64748b', fontWeight: 700 }}>Usina</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Seletores de Visualização e Botões de Ação */}
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div className="btn-group" style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '10px', border: '1px solid #e2e8f0', gap: '0.15rem' }}>
                            {activeTab === 'faturas' ? (
                                <>
                                    <button onClick={() => setViewMode('list')} style={{ borderRadius: '7px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', background: viewMode === 'list' ? 'white' : 'transparent', color: viewMode === 'list' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'list' ? 700 : 600, fontSize: '0.8rem', boxShadow: viewMode === 'list' ? '0 1px 3px rgba(15,23,42,0.08)' : 'none' }}>
                                        <List size={15} /> Lista
                                    </button>
                                    <button onClick={() => setViewMode('kanban')} style={{ borderRadius: '7px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', background: viewMode === 'kanban' ? 'white' : 'transparent', color: viewMode === 'kanban' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'kanban' ? 700 : 600, fontSize: '0.8rem', boxShadow: viewMode === 'kanban' ? '0 1px 3px rgba(15,23,42,0.08)' : 'none' }}>
                                        <Layout size={15} /> Kanban
                                    </button>
                                    <button onClick={() => setViewMode('calendar')} style={{ borderRadius: '7px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', background: viewMode === 'calendar' ? 'white' : 'transparent', color: viewMode === 'calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'calendar' ? 700 : 600, fontSize: '0.8rem', boxShadow: viewMode === 'calendar' ? '0 1px 3px rgba(15,23,42,0.08)' : 'none' }}>
                                        <CalendarIcon size={15} /> Venc. Faturas
                                    </button>
                                    {showAuditorTab && (
                                        <button onClick={() => setViewMode('graph_node')} style={{ borderRadius: '7px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', background: viewMode === 'graph_node' ? 'white' : 'transparent', color: viewMode === 'graph_node' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'graph_node' ? 700 : 600, fontSize: '0.8rem', boxShadow: viewMode === 'graph_node' ? '0 1px 3px rgba(15,23,42,0.08)' : 'none' }}>
                                            <Zap size={15} /> Graph View
                                        </button>
                                    )}
                                </>
                            ) : (
                                <>
                                    <button onClick={() => setViewMode('energy_list')} style={{ borderRadius: '7px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', background: viewMode === 'energy_list' ? 'white' : 'transparent', color: viewMode === 'energy_list' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'energy_list' ? 700 : 600, fontSize: '0.8rem', boxShadow: viewMode === 'energy_list' ? '0 1px 3px rgba(15,23,42,0.08)' : 'none' }}>
                                        <List size={15} /> Lista
                                    </button>
                                    <button onClick={() => setViewMode('energy_kanban')} style={{ borderRadius: '7px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', background: viewMode === 'energy_kanban' ? 'white' : 'transparent', color: viewMode === 'energy_kanban' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'energy_kanban' ? 700 : 600, fontSize: '0.8rem', boxShadow: viewMode === 'energy_kanban' ? '0 1px 3px rgba(15,23,42,0.08)' : 'none' }}>
                                        <Layout size={15} /> Kanban
                                    </button>
                                    <button onClick={() => setViewMode('energy_calendar')} style={{ borderRadius: '7px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', background: viewMode === 'energy_calendar' ? 'white' : 'transparent', color: viewMode === 'energy_calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'energy_calendar' ? 700 : 600, fontSize: '0.8rem', boxShadow: viewMode === 'energy_calendar' ? '0 1px 3px rgba(15,23,42,0.08)' : 'none' }}>
                                        <CalendarIcon size={15} /> Venc. Conta
                                    </button>
                                    <button onClick={() => setViewMode('energy_reading_calendar')} style={{ borderRadius: '7px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', background: viewMode === 'energy_reading_calendar' ? 'white' : 'transparent', color: viewMode === 'energy_reading_calendar' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'energy_reading_calendar' ? 700 : 600, fontSize: '0.8rem', boxShadow: viewMode === 'energy_reading_calendar' ? '0 1px 3px rgba(15,23,42,0.08)' : 'none' }}>
                                        Leituras
                                    </button>
                                    {showAuditorTab && (
                                        <button onClick={() => setViewMode('graph_node')} style={{ borderRadius: '7px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', background: viewMode === 'graph_node' ? 'white' : 'transparent', color: viewMode === 'graph_node' ? 'var(--color-blue)' : '#64748b', fontWeight: viewMode === 'graph_node' ? 700 : 600, fontSize: '0.8rem', boxShadow: viewMode === 'graph_node' ? '0 1px 3px rgba(15,23,42,0.08)' : 'none' }}>
                                            <Zap size={15} /> Graph View
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                            <button onClick={handleGenerateExtrato} style={{ background: 'white', color: '#003366', padding: '0.42rem 0.85rem', borderRadius: '8px', border: '1px solid #bfdbfe', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <Printer size={15} /> Extrato
                            </button>
                            <button onClick={() => setIsHistoryModalOpen(true)} style={{ background: 'white', color: '#475569', padding: '0.42rem 0.85rem', borderRadius: '8px', border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <History size={15} /> Histórico
                            </button>
                            {activeTab === 'faturas' ? (
                                <button onClick={handleCreate} style={{ background: 'var(--color-orange)', color: 'white', padding: '0.42rem 0.95rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', boxShadow: '0 2px 6px rgba(255, 102, 0, 0.25)' }}>
                                    <Plus size={15} /> Nova Fatura
                                </button>
                            ) : (
                                <>
                                    <button onClick={() => setIsScraperQueueModalOpen(true)} style={{ background: '#2563eb', color: 'white', padding: '0.42rem 0.85rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', boxShadow: '0 2px 6px rgba(37, 99, 235, 0.2)' }}>
                                        <Download size={15} /> Fila Automação
                                    </button>
                                    <button onClick={() => setIsAnalysisModalOpen(true)} style={{ background: 'var(--color-orange)', color: 'white', padding: '0.42rem 0.95rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', boxShadow: '0 2px 6px rgba(255, 102, 0, 0.25)' }}>
                                        <Plus size={15} /> Nova Conta
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Linha 2: Barra de Filtro de Status Reorganizada (Pills Horizontais + Totais Integrados) */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                    width: '100%',
                    fontVariantNumeric: 'tabular-nums'
                }}>
                    {activeTab === 'faturas' ? (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            padding: '0.45rem 0.85rem',
                            background: 'white',
                            borderRadius: '10px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
                            flexWrap: 'wrap'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', flex: 1 }}>
                                <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    fontSize: '0.7rem',
                                    fontWeight: 800,
                                    color: '#64748b',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    marginRight: '0.2rem',
                                    flexShrink: 0
                                }}>
                                    <Filter size={12} /> Status:
                                </span>

                                {/* Pill Todos */}
                                <button
                                    onClick={() => setStatusFilter('')}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        height: '30px',
                                        padding: '0 0.65rem',
                                        borderRadius: '999px',
                                        border: statusFilter === '' ? '1.5px solid #0f172a' : '1px solid #e2e8f0',
                                        background: statusFilter === '' ? '#0f172a' : '#f8fafc',
                                        color: statusFilter === '' ? 'white' : '#475569',
                                        cursor: 'pointer',
                                        transition: 'all 0.18s ease',
                                        outline: 'none',
                                        flexShrink: 0,
                                        whiteSpace: 'nowrap'
                                    }}
                                    title="Mostrar todos os registros"
                                >
                                    <span style={{ fontSize: '0.74rem', fontWeight: statusFilter === '' ? 700 : 600 }}>Todos</span>
                                    <span style={{
                                        fontSize: '0.68rem',
                                        fontWeight: 800,
                                        padding: '0.05rem 0.4rem',
                                        borderRadius: '999px',
                                        background: statusFilter === '' ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                                        color: statusFilter === '' ? 'white' : '#334155'
                                    }}>
                                        {invoicesForTotals.length}
                                    </span>
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
                                                height: '30px',
                                                padding: '0 0.65rem',
                                                borderRadius: '999px',
                                                border: isActive ? `1.5px solid ${status.color}` : '1px solid #e2e8f0',
                                                background: isActive ? status.bg : 'white',
                                                cursor: 'pointer',
                                                transition: 'all 0.18s ease',
                                                outline: 'none',
                                                flexShrink: 0,
                                                whiteSpace: 'nowrap',
                                                opacity: (!isActive && count === 0) ? 0.55 : 1,
                                                boxShadow: isActive ? `0 2px 6px ${status.color}20` : 'none'
                                            }}
                                            title={`Filtrar por ${status.label}`}
                                        >
                                            <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', backgroundColor: status.color, flexShrink: 0 }}></span>
                                            <span style={{ fontSize: '0.74rem', color: isActive ? '#0f172a' : '#475569', fontWeight: isActive ? 700 : 600 }}>{status.label}</span>
                                            <span style={{
                                                fontSize: '0.68rem',
                                                color: status.color,
                                                background: isActive ? 'white' : status.bg,
                                                padding: '0.05rem 0.4rem',
                                                borderRadius: '999px',
                                                fontWeight: 800
                                            }}>
                                                {count}
                                            </span>
                                        </button>
                                    );
                                })}

                                {statusFilter !== '' && (
                                    <button
                                        onClick={() => setStatusFilter('')}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.25rem',
                                            height: '28px',
                                            padding: '0 0.55rem',
                                            borderRadius: '999px',
                                            border: '1px dashed #cbd5e1',
                                            background: '#f8fafc',
                                            color: '#64748b',
                                            fontSize: '0.7rem',
                                            fontWeight: 700,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <X size={11} /> Limpar
                                    </button>
                                )}
                            </div>

                            {/* KPI Total Integrado */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.3rem 0.75rem',
                                background: '#f8fafc',
                                borderRadius: '8px',
                                border: '1px solid #e2e8f0',
                                flexShrink: 0
                            }}>
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    Total ({sortedInvoices.length}):
                                </span>
                                <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' }}>
                                    {formatCurrency(currentTotalAmount)}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.4rem',
                            padding: '0.5rem 0.85rem',
                            background: 'white',
                            borderRadius: '10px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)'
                        }}>
                            {/* Sub-linha 1: Status da Conta + KPI Total */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', flex: 1 }}>
                                    <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: '98px', flexShrink: 0 }}>
                                        Status Conta:
                                    </span>
                                    <button
                                        onClick={() => setStatusFilter('')}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.35rem',
                                            height: '28px',
                                            padding: '0 0.6rem',
                                            borderRadius: '999px',
                                            border: statusFilter === '' ? '1.5px solid #0f172a' : '1px solid #e2e8f0',
                                            background: statusFilter === '' ? '#0f172a' : '#f8fafc',
                                            color: statusFilter === '' ? 'white' : '#475569',
                                            cursor: 'pointer',
                                            transition: 'all 0.18s',
                                            outline: 'none',
                                            flexShrink: 0,
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        <span style={{ fontSize: '0.72rem', fontWeight: statusFilter === '' ? 700 : 600 }}>Todas</span>
                                        <span style={{ fontSize: '0.66rem', fontWeight: 800, padding: '0.04rem 0.35rem', borderRadius: '999px', background: statusFilter === '' ? 'rgba(255,255,255,0.2)' : '#e2e8f0', color: statusFilter === '' ? 'white' : '#334155' }}>
                                            {invoicesForTotals.length}
                                        </span>
                                    </button>
                                    {contasStatuses.map(status => {
                                        const count = contasCounts[status.key] || 0;
                                        const isActive = statusFilter === status.key;
                                        return (
                                            <button
                                                key={status.key}
                                                onClick={() => setStatusFilter(isActive ? '' : status.key)}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.35rem',
                                                    height: '28px',
                                                    padding: '0 0.58rem',
                                                    borderRadius: '999px',
                                                    border: isActive ? `1.5px solid ${status.color}` : '1px solid #e2e8f0',
                                                    background: isActive ? status.bg : 'white',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.18s',
                                                    outline: 'none',
                                                    flexShrink: 0,
                                                    whiteSpace: 'nowrap',
                                                    opacity: (!isActive && count === 0) ? 0.5 : 1
                                                }}
                                            >
                                                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: status.color, flexShrink: 0 }}></span>
                                                <span style={{ fontSize: '0.72rem', color: isActive ? '#0f172a' : '#475569', fontWeight: isActive ? 700 : 600 }}>{status.label}</span>
                                                <span style={{ fontSize: '0.66rem', color: status.color, background: isActive ? 'white' : status.bg, padding: '0.04rem 0.35rem', borderRadius: '999px', fontWeight: 800 }}>{count}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.45rem',
                                    padding: '0.25rem 0.7rem',
                                    background: '#f8fafc',
                                    borderRadius: '8px',
                                    border: '1px solid #e2e8f0',
                                    flexShrink: 0
                                }}>
                                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                                        Total ({sortedInvoices.length}):
                                    </span>
                                    <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a' }}>
                                        {formatCurrency(currentTotalAmount)}
                                    </span>
                                </div>
                            </div>

                            {/* Sub-linha 2: Status da Fatura + Consumo e Energia Compensada abaixo do Total */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', borderTop: '1px solid #f1f5f9', paddingTop: '0.38rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', flex: 1 }}>
                                    <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: '98px', flexShrink: 0 }}>
                                        Status Fatura:
                                    </span>
                                    <button
                                        onClick={() => setStatusFaturaFilter('')}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.35rem',
                                            height: '26px',
                                            padding: '0 0.55rem',
                                            borderRadius: '999px',
                                            border: statusFaturaFilter === '' ? '1.5px solid #475569' : '1px solid #e2e8f0',
                                            background: statusFaturaFilter === '' ? '#f1f5f9' : 'white',
                                            color: '#334155',
                                            cursor: 'pointer',
                                            transition: 'all 0.18s',
                                            outline: 'none',
                                            flexShrink: 0,
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        <span style={{ fontSize: '0.7rem', fontWeight: statusFaturaFilter === '' ? 700 : 600 }}>Todas</span>
                                        <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#64748b' }}>{invoicesForTotals.length}</span>
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
                                                    gap: '0.35rem',
                                                    height: '26px',
                                                    padding: '0 0.55rem',
                                                    borderRadius: '999px',
                                                    border: isActive ? `1.5px solid ${status.color}` : '1px solid #e2e8f0',
                                                    background: isActive ? status.bg : 'white',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.18s',
                                                    outline: 'none',
                                                    flexShrink: 0,
                                                    whiteSpace: 'nowrap',
                                                    opacity: (!isActive && count === 0) ? 0.5 : 1
                                                }}
                                            >
                                                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: status.color, flexShrink: 0 }}></span>
                                                <span style={{ fontSize: '0.7rem', color: isActive ? '#0f172a' : '#475569', fontWeight: isActive ? 700 : 600 }}>{status.label}</span>
                                                <span style={{ fontSize: '0.65rem', color: status.color, fontWeight: 800 }}>{count}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.55rem',
                                    padding: '0.24rem 0.7rem',
                                    background: '#f8fafc',
                                    borderRadius: '8px',
                                    border: '1px solid #e2e8f0',
                                    flexShrink: 0,
                                    fontVariantNumeric: 'tabular-nums'
                                }}>
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.32rem' }}>
                                        <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                            Consumo:
                                        </span>
                                        <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                                            {currentTotalConsumo.toLocaleString('pt-BR')} kWh
                                        </span>
                                    </div>
                                    <div style={{ width: '1px', height: '13px', background: '#cbd5e1' }} />
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.32rem' }}>
                                        <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                            Compensada:
                                        </span>
                                        <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#15803d' }}>
                                            {currentTotalCompensado.toLocaleString('pt-BR')} kWh
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {viewMode === 'graph_node' ? (
                <AuditGraphViewInvoiceSummary onInspectInvoice={(invoiceId) => {
                    const inv = invoices.find(i => i.id === invoiceId);
                    if (inv) {
                        setSelectedInvoiceForSummary(inv);
                        setIsSummaryModalOpen(true);
                    }
                }} />
            ) : loading ? (
                <div style={{ padding: '4rem 2rem', textAlign: 'center', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                    <div style={{ color: '#64748b', fontWeight: 600, fontSize: '0.92rem' }}>Carregando registros financeiros...</div>
                </div>
            ) : (filteredInvoices.length === 0 && viewMode !== 'energy_reading_calendar') ? (
                <div style={{ padding: '3.5rem 2rem', textAlign: 'center', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.03)' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '0.75rem', display: 'flex', justifyContent: 'center' }}><FileText size={42} /></div>
                    <h3 style={{ color: '#334155', fontWeight: 700, fontSize: '1rem', margin: 0 }}>
                        {activeTab === 'contas_energia'
                            ? (monthFilter === 'all' ? 'Nenhuma conta de energia encontrada' : 'Nenhuma conta de energia para o período selecionado')
                            : (monthFilter === 'all' ? 'Nenhuma fatura encontrada' : 'Nenhuma fatura emitida para o período selecionado')
                        }
                    </h3>
                    {(statusFilter || statusFaturaFilter || searchTerm || readingDateFrom || readingDateTo) && (
                        <button
                            onClick={() => { setStatusFilter(''); setStatusFaturaFilter(''); setSearchTerm(''); setReadingDateFrom(''); setReadingDateTo(''); }}
                            style={{ marginTop: '0.85rem', padding: '0.45rem 0.9rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
                        >
                            Limpar filtros ativos
                        </button>
                    )}
                </div>
            ) : (
                <>
                    {viewMode === 'list' ? (
                        (() => {
                            const totalFactValue = sortedInvoices.reduce((sum, inv) => sum + (inv.parent_invoice_id ? 0 : (Number(inv.valor_a_pagar) || 0)), 0);
                            const totalEnergyBillValue = sortedInvoices.reduce((sum, inv) => sum + (inv.parent_invoice_id ? 0 : (Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima || inv.tarifa_minima_excedentes) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0) + (Number(inv.parcelamento) || 0) + (Number(inv.consumo_reais) || 0)))), 0);

                            return (
                                <div style={{
                                    background: 'white',
                                    borderRadius: '14px',
                                    border: '1px solid #e2e8f0',
                                    boxShadow: '0 4px 16px -4px rgba(15, 23, 42, 0.05)',
                                    overflowX: 'auto',
                                    fontVariantNumeric: 'tabular-nums'
                                }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                                <th style={{ padding: '0.85rem 1rem', textAlign: 'left', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', minWidth: '190px' }}>Unidade Consumidora</th>
                                                <th style={{ padding: '0.85rem 0.85rem', textAlign: 'center', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', minWidth: '85px' }}>Mês Ref.</th>
                                                <th style={{ padding: '0.85rem 0.85rem', textAlign: 'right', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', minWidth: '110px' }}>Compensada</th>
                                                <th style={{ padding: '0.85rem 1rem', textAlign: 'right', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', minWidth: '165px' }}>Conta Concessionária</th>
                                                <th style={{ padding: '0.85rem 0.85rem', textAlign: 'center', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', minWidth: '100px' }}>Vencimento</th>
                                                <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', minWidth: '95px' }}>Leitura Ant.</th>
                                                <th style={{ padding: '0.85rem 0.75rem', textAlign: 'center', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', minWidth: '95px' }}>Leitura Atual</th>
                                                <th style={{ padding: '0.85rem 1rem', textAlign: 'right', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', minWidth: '150px' }}>Vr. da Fatura</th>
                                                <th style={{ padding: '0.85rem 1rem', textAlign: 'left', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', minWidth: '130px' }}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedInvoices.map(inv => {
                                                const factValue = Number(inv.valor_a_pagar) || 0;
                                                const energyBillValue = Number(inv.valor_concessionaria) || ((Number(inv.tarifa_minima || inv.tarifa_minima_excedentes) || 0) + (Number(inv.iluminacao_publica) || 0) + (Number(inv.outros_lancamentos) || 0) + (Number(inv.parcelamento) || 0) + (Number(inv.consumo_reais) || 0));

                                                return (
                                                    <tr
                                                        key={inv.id}
                                                        style={{ borderBottom: '1px solid #f1f5f9', transition: 'background-color 0.15s ease' }}
                                                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                                    >
                                                        {/* 1. Unidade Consumidora + Assinante */}
                                                        <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                                    <span 
                                                                        onClick={() => handleEdit(inv)}
                                                                        style={{
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                            padding: '0.16rem 0.55rem',
                                                                            background: '#eff6ff', 
                                                                            color: '#1d4ed8', 
                                                                            border: '1px solid #bfdbfe',
                                                                            borderRadius: '6px',
                                                                            fontSize: '0.76rem',
                                                                            fontWeight: 700,
                                                                            cursor: 'pointer',
                                                                            transition: 'all 0.18s',
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
                                                                    <span style={{ color: '#0f172a', fontSize: '0.82rem', fontWeight: 700, maxWidth: '175px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {abbreviateName(getDisplayName(inv), 22) || '-'}
                                                                    </span>
                                                                </div>
                                                                {inv.consumer_units?.titular_conta && (
                                                                    <div style={{ color: '#64748b', fontSize: '0.7rem', paddingLeft: '0.1rem', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                        Titular: {inv.consumer_units?.titular_conta}
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
                                                                padding: '0.75rem 0.85rem', 
                                                                textAlign: 'center',
                                                                whiteSpace: 'nowrap', 
                                                                cursor: 'pointer'
                                                            }}
                                                            title="Ver resumo detalhado da fatura"
                                                        >
                                                            <span style={{
                                                                display: 'inline-block',
                                                                padding: '0.18rem 0.5rem',
                                                                borderRadius: '6px',
                                                                background: '#f1f5f9',
                                                                color: '#334155',
                                                                fontSize: '0.78rem',
                                                                fontWeight: 700,
                                                                border: '1px solid #e2e8f0'
                                                            }}>
                                                                {inv.mes_referencia ? (() => {
                                                                    const [year, month] = inv.mes_referencia.split('-');
                                                                    return `${month}/${year}`;
                                                                })() : '-'}
                                                            </span>
                                                        </td>

                                                        {/* 3. Energia Compensada */}
                                                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: '#15803d', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                                                            {inv.consumo_compensado ? `${Number(inv.consumo_compensado).toLocaleString('pt-BR')} kWh` : '-'}
                                                        </td>

                                                        {/* 4. Conta de Energia + Pagar */}
                                                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.55rem' }}>
                                                                <span style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.9rem' }}>
                                                                    {formatCurrency(energyBillValue)}
                                                                </span>
                                                                <div style={{ minWidth: '82px', textAlign: 'center' }}>
                                                                    {inv.energy_bill_status === 'pago' ? (
                                                                        <span style={{ display: 'inline-block', width: '100%', color: '#166534', background: '#dcfce7', padding: '0.22rem 0.4rem', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 800, border: '1px solid #bbf7d0' }}>PAGA</span>
                                                                    ) : inv.energy_bill_status === 'inconsistente_pago' ? (
                                                                        <span style={{ display: 'inline-block', width: '100%', color: ENERGY_PAID_DIVERGENT.inconsistente_pago.color, background: ENERGY_PAID_DIVERGENT.inconsistente_pago.bg, padding: '0.22rem 0.4rem', borderRadius: '6px', fontSize: '0.6rem', fontWeight: 800, border: `1px solid ${ENERGY_PAID_DIVERGENT.inconsistente_pago.color}40` }}>INC. PAGO</span>
                                                                    ) : inv.energy_bill_status === 'contestada_pago' ? (
                                                                        <span style={{ display: 'inline-block', width: '100%', color: ENERGY_PAID_DIVERGENT.contestada_pago.color, background: ENERGY_PAID_DIVERGENT.contestada_pago.bg, padding: '0.22rem 0.4rem', borderRadius: '6px', fontSize: '0.6rem', fontWeight: 800, border: `1px solid ${ENERGY_PAID_DIVERGENT.contestada_pago.color}40` }}>CONT. PAGO</span>
                                                                    ) : inv.energy_bill_status === 'parcelada' ? (
                                                                        <span style={{ display: 'inline-block', width: '100%', color: '#854d0e', background: '#fef9c3', padding: '0.22rem 0.4rem', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 800, border: '1px solid #fde047' }}>PARCELADA</span>
                                                                    ) : inv.energy_bill_status === 'contestada' ? (
                                                                        <span style={{ display: 'inline-block', width: '100%', color: '#6d28d9', background: '#f3e8ff', padding: '0.22rem 0.4rem', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 800, border: '1px solid #ddd6fe' }}>CONTESTADA</span>
                                                                    ) : (inv.linha_digitavel && ['auto_consumo_remoto', 'geracao_compartilhada'].includes(inv.consumer_units?.modalidade)) ? (
                                                                        <button 
                                                                            onClick={() => handlePayBill(inv)}
                                                                            disabled={payingId === inv.id}
                                                                            style={{ width: '100%', background: '#ef4444', color: 'white', border: 'none', padding: '0.26rem 0.45rem', borderRadius: '6px', fontSize: '0.66rem', fontWeight: 800, cursor: 'pointer', boxShadow: '0 1px 3px rgba(239, 68, 68, 0.25)' }}
                                                                        >
                                                                            {payingId === inv.id ? '...' : 'PAGAR'}
                                                                        </button>
                                                                    ) : ['auto_consumo_remoto', 'geracao_compartilhada'].includes(inv.consumer_units?.modalidade) ? (
                                                                        <span style={{ display: 'inline-block', width: '100%', color: '#64748b', background: '#f1f5f9', padding: '0.22rem 0.4rem', borderRadius: '6px', fontSize: '0.64rem', fontWeight: 700, border: '1px solid #e2e8f0' }}>S/ CÓDIGO</span>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                        </td>

                                                        {/* 5. Vencimento */}
                                                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'center', color: '#334155', fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                                                            {inv.vencimento ? inv.vencimento.split('T')[0].split('-').reverse().join('/') : getInvoiceDueDate(inv)}
                                                        </td>
                                                        
                                                        {/* 6. Leitura Ant. */}
                                                        <td style={{ padding: '0.75rem 0.75rem', textAlign: 'center', color: '#64748b', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                                                            {getAnteriorLeitura(inv)}
                                                        </td>

                                                        {/* 7. Leitura Atual */}
                                                        <td style={{ padding: '0.75rem 0.75rem', textAlign: 'center', color: '#475569', whiteSpace: 'nowrap', fontSize: '0.8rem', fontWeight: 500 }}>
                                                            {inv.data_leitura ? inv.data_leitura.split('T')[0].split('-').reverse().join('/') : '-'}
                                                        </td>

                                                        {/* 8. Vr. da Fatura + Boleto */}
                                                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.55rem' }}>
                                                                {factValue === 0 && inv.consumer_units?.nao_faturavel ? (
                                                                    <div style={{ fontWeight: 700, color: '#7c3aed', fontSize: '0.73rem', lineHeight: 1.15, textAlign: 'right' }}>
                                                                        Não faturável
                                                                        <div style={{ fontWeight: 600, color: '#a78bfa', fontSize: '0.66rem' }}>R$ 0,00</div>
                                                                    </div>
                                                                ) : (
                                                                    <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.94rem' }}>{formatCurrency(factValue)}</span>
                                                                )}
                                                                {inv.asaas_boleto_url && inv.status !== 'pago' && (
                                                                    <a 
                                                                        href={inv.asaas_boleto_url} 
                                                                        target="_blank" 
                                                                        rel="noopener noreferrer" 
                                                                        style={{ 
                                                                            padding: '0.22rem 0.5rem',
                                                                            background: '#ecfdf5', 
                                                                            color: '#047857', 
                                                                            border: '1px solid #a7f3d0', 
                                                                            borderRadius: '6px', 
                                                                            textDecoration: 'none', 
                                                                            fontSize: '0.66rem',
                                                                            fontWeight: 800,
                                                                            letterSpacing: '0.02em'
                                                                        }}
                                                                    >
                                                                        BOLETO
                                                                    </a>
                                                                )}
                                                            </div>
                                                        </td>

                                                        {/* 9. Status */}
                                                        <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>{getStatusBadge(inv.status)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)', borderTop: '2px solid #e2e8f0', fontWeight: 700 }}>
                                            <tr>
                                                <td colSpan="2" style={{ padding: '0.9rem 1rem', color: '#475569', fontSize: '0.82rem' }}>
                                                    <span>Total de Registros: </span>
                                                    <span style={{ fontWeight: 800, color: 'var(--color-blue)' }}>{sortedInvoices.length} {sortedInvoices.length === 1 ? 'fatura' : 'faturas'}</span>
                                                </td>
                                                <td style={{ padding: '0.9rem 0.85rem' }}></td>
                                                <td style={{ padding: '0.9rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    <span style={{ color: '#dc2626', fontSize: '0.92rem', fontWeight: 800 }}>
                                                        {formatCurrency(totalEnergyBillValue)}
                                                    </span>
                                                </td>
                                                <td colSpan="3" style={{ padding: '0.9rem' }}></td>
                                                <td style={{ padding: '0.9rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    <span style={{ color: '#0f172a', fontSize: '0.95rem', fontWeight: 900 }}>
                                                        {formatCurrency(totalFactValue)}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '0.9rem 1rem' }}></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            );
                        })()
                    ) : viewMode === 'energy_list' ? (
                        <div style={{
                            background: 'white',
                            borderRadius: '14px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 4px 16px -4px rgba(15, 23, 42, 0.05)',
                            overflowX: 'auto',
                            fontVariantNumeric: 'tabular-nums'
                        }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                        <th style={{ padding: '0.8rem 1rem', textAlign: 'left', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Unidade Consumidora</th>
                                        <th style={{ padding: '0.8rem 0.75rem', textAlign: 'center', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Ref.</th>
                                        <th style={{ padding: '0.8rem 0.85rem', textAlign: 'right', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Vl. Pagar</th>
                                        <th style={{ padding: '0.8rem 0.75rem', textAlign: 'center', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Vencimento</th>
                                        <th style={{ padding: '0.8rem 0.75rem', textAlign: 'center', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Lt. Anterior</th>
                                        <th style={{ padding: '0.8rem 0.75rem', textAlign: 'center', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Lt. Atual</th>
                                        <th style={{ padding: '0.8rem 0.75rem', textAlign: 'right', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Consumo</th>
                                        <th style={{ padding: '0.8rem 0.75rem', textAlign: 'right', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Compens.</th>
                                        <th style={{ padding: '0.8rem 0.75rem', textAlign: 'right', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Injetada</th>
                                        <th style={{ padding: '0.8rem 0.85rem', textAlign: 'left', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>St. Conta</th>
                                        <th style={{ padding: '0.8rem 0.85rem', textAlign: 'left', color: '#475569', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>St. Fatura</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedInvoices.map(inv => {
                                        const cost = getEnergyBillValue(inv);

                                        return (
                                            <tr
                                                key={inv.id}
                                                style={{ borderBottom: '1px solid #f1f5f9', transition: 'background-color 0.15s ease' }}
                                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                            >
                                                <td style={{ padding: '0.65rem 1rem', whiteSpace: 'nowrap' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
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
                                                                color: '#1d4ed8', 
                                                                border: '1px solid #bfdbfe',
                                                                borderRadius: '6px',
                                                                fontSize: '0.74rem',
                                                                fontWeight: 700,
                                                                cursor: 'pointer',
                                                                transition: 'all 0.18s',
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
                                                        <span style={{ color: '#0f172a', fontSize: '0.78rem', fontWeight: 700, maxWidth: '165px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                                                            {abbreviateName(getDisplayName(inv), 20) || '-'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', color: '#475569', fontWeight: 600, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                                                    {inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('/') : '-'}
                                                </td>
                                                <td style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 800, color: '#dc2626', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                                    {formatCurrency(cost)}
                                                </td>
                                                <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', color: '#334155', fontWeight: 600, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                                                    {inv.vencimento_concessionaria ? inv.vencimento_concessionaria.split('-').reverse().join('/') : (inv.vencimento ? inv.vencimento.split('-').reverse().join('/') : '-')}
                                                </td>
                                                <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', color: '#64748b', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                                                    {getAnteriorLeitura(inv)}
                                                </td>
                                                <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', color: '#475569', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                                                    {inv.data_leitura ? inv.data_leitura.split('-').reverse().join('/') : '-'}
                                                </td>
                                                <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', color: '#334155', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                                                    {inv.consumo_kwh ? `${Number(inv.consumo_kwh).toLocaleString('pt-BR')} kWh` : '-'}
                                                </td>
                                                <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', color: '#15803d', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                                                    {inv.consumo_compensado ? `${Number(inv.consumo_compensado).toLocaleString('pt-BR')} kWh` : '-'}
                                                </td>
                                                <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right', color: '#0284c7', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                                                    {inv.energia_injetada ? `${Number(inv.energia_injetada).toLocaleString('pt-BR')} kWh` : '-'}
                                                </td>
                                                <td style={{ padding: '0.65rem 0.85rem', whiteSpace: 'nowrap' }}>
                                                    {getEnergyStatusBadge(inv)}
                                                </td>
                                                <td style={{ padding: '0.65rem 0.85rem', whiteSpace: 'nowrap' }}>
                                                    {getStatusBadge(inv.status)}
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
                                        const invoicesInStatus = filteredInvoices.filter(inv => {
                                            const effectiveStatus = inv.status === 'ag_emissao_boleto' ? 'sem_faturamento' : inv.status;
                                            return effectiveStatus === status;
                                        });
                                        const statusMap = { 
                                            'sem_faturamento': { color: '#1d4ed8', dot: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', label: 'Sem Faturamento' },
                                            'confirmado': { color: '#0e7490', dot: '#0891b2', bg: '#ecfeff', border: '#a5f3fc', label: 'Confirmado' },
                                            'pago': { color: '#166534', dot: '#16a34a', bg: '#dcfce7', border: '#bbf7d0', label: 'Pago' }, 
                                            'a_vencer': { color: '#854d0e', dot: '#ca8a04', bg: '#fef9c3', border: '#fde047', label: 'A Vencer' }, 
                                            'atrasado': { color: '#b91c1c', dot: '#dc2626', bg: '#fee2e2', border: '#fecaca', label: 'Atrasado' } 
                                        };
                                        const s = statusMap[status] || { color: '#475569', dot: '#64748b', bg: '#f1f5f9', border: '#cbd5e1', label: status };
                                        const colTotal = invoicesInStatus.reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0);

                                        return (
                                            <div 
                                                key={status} 
                                                className="kanban-column" 
                                                style={{ borderTop: `3.5px solid ${s.dot}` }}
                                                onDragOver={(e) => e.preventDefault()}
                                                onDrop={(e) => handleDrop(e, status)}
                                            >
                                                <div
                                                    className="kanban-column-header"
                                                    style={{
                                                        background: `linear-gradient(180deg, ${s.bg}65 0%, #ffffff 100%)`
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                                                        <span style={{
                                                            width: '8px',
                                                            height: '8px',
                                                            borderRadius: '50%',
                                                            background: s.dot,
                                                            boxShadow: `0 0 0 3px ${s.dot}22`,
                                                            flexShrink: 0
                                                        }} />
                                                        <span style={{ textTransform: 'uppercase', fontSize: '0.76rem', fontWeight: 800, color: '#0f172a', letterSpacing: '0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {s.label}
                                                        </span>
                                                        <span style={{
                                                            fontSize: '0.68rem',
                                                            fontWeight: 800,
                                                            color: '#475569',
                                                            background: '#f1f5f9',
                                                            border: '1px solid #e2e8f0',
                                                            padding: '0.05rem 0.42rem',
                                                            borderRadius: '999px',
                                                            fontVariantNumeric: 'tabular-nums',
                                                            flexShrink: 0
                                                        }}>
                                                            {invoicesInStatus.length}
                                                        </span>
                                                    </div>
                                                    <span style={{
                                                        fontSize: '0.74rem',
                                                        background: s.bg,
                                                        color: s.color,
                                                        border: `1px solid ${s.border}`,
                                                        padding: '0.15rem 0.55rem',
                                                        borderRadius: '999px',
                                                        fontWeight: 800,
                                                        fontVariantNumeric: 'tabular-nums',
                                                        whiteSpace: 'nowrap',
                                                        flexShrink: 0
                                                    }}>
                                                        {formatCurrency(colTotal)}
                                                    </span>
                                                </div>
                                                <div className="kanban-column-content">
                                                    {invoicesInStatus.length === 0 ? (
                                                        <div style={{
                                                            padding: '2rem 1rem',
                                                            margin: '0.25rem 0',
                                                            borderRadius: '10px',
                                                            border: '1px dashed #cbd5e1',
                                                            background: 'rgba(255,255,255,0.5)',
                                                            textAlign: 'center',
                                                            color: '#94a3b8',
                                                            fontSize: '0.76rem',
                                                            fontWeight: 600
                                                        }}>
                                                            Nenhuma fatura nesta etapa
                                                        </div>
                                                    ) : (
                                                        invoicesInStatus.map(inv => {
                                                            const dueFormatted = inv.vencimento ? inv.vencimento.split('-').reverse().join('/') : '-';
                                                            const refFormatted = inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('/') : null;
                                                            const hasBoleto = !!inv.asaas_boleto_url;

                                                            return (
                                                                <div 
                                                                    key={inv.id} 
                                                                    onClick={() => handleEdit(inv)} 
                                                                    className="kanban-card"
                                                                    draggable
                                                                    onDragStart={(e) => e.dataTransfer.setData('invoiceId', inv.id)}
                                                                    style={{
                                                                        borderLeft: `3.5px solid ${s.dot}`,
                                                                        cursor: 'pointer'
                                                                    }}
                                                                >
                                                                    {/* Topo do Card: UC + Ref | Vencimento */}
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
                                                                            <span style={{
                                                                                fontWeight: 700,
                                                                                fontSize: '0.75rem',
                                                                                color: '#1d4ed8',
                                                                                background: '#eff6ff',
                                                                                border: '1px solid #bfdbfe',
                                                                                padding: '0.12rem 0.48rem',
                                                                                borderRadius: '6px',
                                                                                whiteSpace: 'nowrap'
                                                                            }}>
                                                                                {inv.consumer_units?.numero_uc || '-'}
                                                                            </span>
                                                                            {refFormatted && (
                                                                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.1rem 0.38rem', borderRadius: '5px' }}>
                                                                                    {refFormatted}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <span style={{
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                            gap: '0.22rem',
                                                                            fontSize: '0.73rem',
                                                                            color: status === 'atrasado' ? '#b91c1c' : '#334155',
                                                                            background: status === 'atrasado' ? '#fef2f2' : '#f8fafc',
                                                                            padding: '0.12rem 0.42rem',
                                                                            borderRadius: '5px',
                                                                            fontWeight: 700,
                                                                            whiteSpace: 'nowrap'
                                                                        }}>
                                                                            <CalendarIcon size={11} />
                                                                            {dueFormatted}
                                                                        </span>
                                                                    </div>

                                                                    {/* Corpo do Card: Nome do Assinante + Titular */}
                                                                    <div style={{ fontSize: '0.86rem', color: '#0f172a', fontWeight: 700, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {getDisplayName(inv) !== '-' ? getDisplayName(inv) : 'Sem Assinante'}
                                                                    </div>
                                                                    {inv.consumer_units?.titular_fatura?.name && (
                                                                        <div style={{ fontSize: '0.73rem', color: '#64748b', marginTop: '0.18rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            Titular: {inv.consumer_units.titular_fatura.name}
                                                                        </div>
                                                                    )}

                                                                    {/* Rodapé do Card: Metadados + Valor */}
                                                                    <div style={{
                                                                        display: 'flex',
                                                                        justifyContent: 'space-between',
                                                                        alignItems: 'center',
                                                                        marginTop: '0.6rem',
                                                                        paddingTop: '0.55rem',
                                                                        borderTop: '1px solid #f1f5f9'
                                                                    }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                                            {hasBoleto ? (
                                                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.65rem', fontWeight: 700, color: '#0369a1', background: '#e0f2fe', padding: '0.12rem 0.42rem', borderRadius: '5px' }}>
                                                                                    <TicketCheck size={11} /> Boleto
                                                                                </span>
                                                                            ) : (
                                                                                <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600 }}>
                                                                                    {inv.consumo_compensado ? `${inv.consumo_compensado} kWh` : 'Fatura'}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div style={{ fontWeight: 800, fontSize: '0.96rem', color: '#0f172a' }}>
                                                                            {Number(inv.valor_a_pagar) === 0 && inv.consumer_units?.nao_faturavel
                                                                                ? <span style={{ color: '#7c3aed', fontSize: '0.75rem', background: '#f3e8ff', padding: '0.15rem 0.45rem', borderRadius: '5px' }}>Não faturável</span>
                                                                                : formatCurrency(inv.valor_a_pagar)}
                                                                        </div>
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
                    ) : viewMode === 'energy_kanban' ? (
                        <div className="kanban-box">
                            <div className="kanban-board">
                                {['pendente', 'indisponivel', 'baixada', 'processada', 'a_vencer', 'inconsistente', 'inconsistente_pago', 'contestada', 'contestada_pago', 'parcelada', 'atrasada', 'pago']
                                    .filter(col => energyStatusMatchesFilter(col, statusFilter))
                                    .map(col => {
                                    const invoicesInCol = filteredInvoices.filter(inv => {
                                        return resolveEnergyStatus(inv) === col;
                                    });

                                    // Filter out columns with no cards
                                    if (invoicesInCol.length === 0) return null;

                                    const colMap = { 
                                        'pendente': { color: '#c2410c', dot: '#f97316', bg: '#fff7ed', label: 'Pendente' },
                                        'indisponivel': { color: '#b91c1c', dot: '#ef4444', bg: '#fef2f2', label: 'Indisponível' },
                                        'baixada': { color: '#1d4ed8', dot: '#3b82f6', bg: '#eff6ff', label: 'Baixada' },
                                        'processada': { color: '#15803d', dot: '#22c55e', bg: '#f0fdf4', label: 'Processada' },
                                        'a_vencer': { color: '#1d4ed8', dot: '#2563eb', bg: '#eff6ff', label: 'A Vencer' }, 
                                        'inconsistente': { color: '#c2410c', dot: '#ea580c', bg: '#ffedd5', label: 'Inconsistente' },
                                        'inconsistente_pago': { color: ENERGY_PAID_DIVERGENT.inconsistente_pago.color, dot: ENERGY_PAID_DIVERGENT.inconsistente_pago.color, bg: ENERGY_PAID_DIVERGENT.inconsistente_pago.bg, label: 'Inconsistente Pago' },
                                        'contestada': { color: '#6d28d9', dot: '#7c3aed', bg: '#f3e8ff', label: 'Contestada' },
                                        'contestada_pago': { color: ENERGY_PAID_DIVERGENT.contestada_pago.color, dot: ENERGY_PAID_DIVERGENT.contestada_pago.color, bg: ENERGY_PAID_DIVERGENT.contestada_pago.bg, label: 'Contestado Pago' },
                                        'parcelada': { color: '#854d0e', dot: '#ca8a04', bg: '#fef9c3', label: 'Parcelada' }, 
                                        'atrasada': { color: '#b91c1c', dot: '#dc2626', bg: '#fee2e2', label: 'Atrasada' },
                                        'pago': { color: '#166534', dot: '#16a34a', bg: '#dcfce7', label: 'Paga' }
                                    };
                                    const s = colMap[col];
                                    
                                    const totalAmount = invoicesInCol.reduce((acc, curr) => {
                                        const cost = Number(curr.valor_concessionaria) || ((Number(curr.tarifa_minima || curr.tarifa_minima_excedentes) || 0) + (Number(curr.iluminacao_publica) || 0) + (Number(curr.outros_lancamentos) || 0) + (Number(curr.parcelamento) || 0));
                                        return acc + cost;
                                    }, 0);

                                    return (
                                        <div 
                                            key={col} 
                                            className="kanban-column" 
                                            style={{ borderTop: `3.5px solid ${s.dot}` }}
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
                                            <div
                                                className="kanban-column-header"
                                                style={{
                                                    background: `linear-gradient(180deg, ${s.bg}65 0%, #ffffff 100%)`
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                                                    <span style={{
                                                        width: '8px',
                                                        height: '8px',
                                                        borderRadius: '50%',
                                                        background: s.dot,
                                                        boxShadow: `0 0 0 3px ${s.dot}22`,
                                                        flexShrink: 0
                                                    }} />
                                                    <span style={{ textTransform: 'uppercase', fontSize: '0.76rem', fontWeight: 800, color: '#0f172a', letterSpacing: '0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {s.label}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '0.68rem',
                                                        fontWeight: 800,
                                                        color: '#475569',
                                                        background: '#f1f5f9',
                                                        border: '1px solid #e2e8f0',
                                                        padding: '0.05rem 0.42rem',
                                                        borderRadius: '999px',
                                                        fontVariantNumeric: 'tabular-nums',
                                                        flexShrink: 0
                                                    }}>
                                                        {invoicesInCol.length}
                                                    </span>
                                                </div>
                                                <span style={{
                                                    fontSize: '0.74rem',
                                                    background: s.bg,
                                                    color: s.color,
                                                    border: `1px solid ${s.color}30`,
                                                    padding: '0.15rem 0.55rem',
                                                    borderRadius: '999px',
                                                    fontWeight: 800,
                                                    fontVariantNumeric: 'tabular-nums',
                                                    whiteSpace: 'nowrap',
                                                    flexShrink: 0
                                                }}>
                                                    {formatCurrency(totalAmount)}
                                                </span>
                                            </div>
                                            <div className="kanban-column-content">
                                                {invoicesInCol.map(inv => {
                                                    const cost = getEnergyBillValue(inv);
                                                    const dueStr = inv.vencimento_concessionaria ? inv.vencimento_concessionaria.split('-').reverse().join('/') : (inv.vencimento ? inv.vencimento.split('-').reverse().join('/') : '-');
                                                    const refStr = inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('/') : '-';

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
                                                                borderLeft: `3.5px solid ${s.dot}`,
                                                                border: dropTarget?.targetId === inv.id ? '2px dashed #3b82f6' : undefined,
                                                                transform: dropTarget?.targetId === inv.id ? 'scale(1.02)' : 'none',
                                                                transition: 'all 0.2s'
                                                            }}
                                                        >
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                                                                <span style={{
                                                                    fontWeight: 700,
                                                                    fontSize: '0.75rem',
                                                                    color: '#1d4ed8',
                                                                    background: '#eff6ff',
                                                                    border: '1px solid #bfdbfe',
                                                                    padding: '0.12rem 0.48rem',
                                                                    borderRadius: '6px',
                                                                    whiteSpace: 'nowrap'
                                                                }}>
                                                                    {inv.consumer_units?.numero_uc || '-'}
                                                                </span>
                                                                <span style={{
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.22rem',
                                                                    fontSize: '0.73rem',
                                                                    color: col === 'atrasada' ? '#b91c1c' : '#334155',
                                                                    background: col === 'atrasada' ? '#fef2f2' : '#f8fafc',
                                                                    padding: '0.12rem 0.42rem',
                                                                    borderRadius: '5px',
                                                                    fontWeight: 700,
                                                                    whiteSpace: 'nowrap'
                                                                }}>
                                                                    <CalendarIcon size={11} />
                                                                    {dueStr}
                                                                </span>
                                                            </div>
                                                            <div style={{ fontSize: '0.86rem', color: '#0f172a', fontWeight: 700, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {getDisplayName(inv) !== '-' ? getDisplayName(inv) : 'Sem Assinante'}
                                                            </div>
                                                            {inv.consumer_units?.titular_fatura?.name && (
                                                                <div style={{ fontSize: '0.73rem', color: '#64748b', marginTop: '0.18rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                    <span style={{ fontWeight: 600 }}>Titular: </span>{inv.consumer_units.titular_fatura.name}
                                                                </div>
                                                            )}
                                                            {inv.consumer_units?.concessionaria && (
                                                                <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.12rem' }}>
                                                                    {inv.consumer_units.concessionaria}
                                                                </div>
                                                            )}
                                                            <div style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                marginTop: '0.6rem',
                                                                paddingTop: '0.55rem',
                                                                borderTop: '1px solid #f1f5f9'
                                                            }}>
                                                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.1rem 0.4rem', borderRadius: '5px' }}>
                                                                    Ref. {refStr}
                                                                </span>
                                                                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#dc2626' }}>
                                                                    {formatCurrency(cost)}
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
                                availableUsinas={availableUsinas}
                                readingFromIso={readingFromIso}
                                readingToIso={readingToIso}
                                readingStatusFilter={readingStatusFilter}
                                onCardClick={handleCalendarCardClick}
                            />
                        </div>
                    ) : (
                        <div style={{ background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
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
                    onViewInvoice={(inv) => setSelectedInvoiceForSummary(inv)}
                    onOpenSandbox={(ucId, mesRef) => {
                        setSandboxPreselectedUcId(ucId);
                        setSandboxPreselectedMesRef(mesRef);
                        setIsSummaryModalOpen(false);
                        setIsAnalysisModalOpen(true);
                    }}
                />
            )}
            {isAnalysisModalOpen && (
                <StandaloneAnalysisModal 
                    isOpen={isAnalysisModalOpen} 
                    ucs={ucs} 
                    onClose={() => {
                        setIsAnalysisModalOpen(false);
                        setSandboxPreselectedUcId('');
                        setSandboxPreselectedMesRef('');
                    }} 
                    onSave={() => {
                        fetchInvoices();
                        setSandboxPreselectedUcId('');
                        setSandboxPreselectedMesRef('');
                    }} 
                    initialUcId={sandboxPreselectedUcId}
                    initialMesReferencia={sandboxPreselectedMesRef}
                />
            )}

            <ScraperQueueModal 
                isOpen={isScraperQueueModalOpen}
                onClose={() => setIsScraperQueueModalOpen(false)}
                onProcessed={() => {
                    fetchData();
                    fetchUcs();
                }}
            />

            <ReadingCalendarModal
                isOpen={isReadingCalendarModalOpen}
                onClose={() => setIsReadingCalendarModalOpen(false)}
                uc={selectedUcForReadingModal}
                monthFilter={monthFilter}
                onOpenAnalysis={(selectedUc) => {
                    setIsAnalysisModalOpen(true);
                }}
                onStatusUpdated={(newStatus) => {
                    fetchInvoices();
                    fetchUcs();
                }}
            />
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

function CalendarView({ units, invoices, monthFilter, searchTerm, availableUsinas = [], readingFromIso = '', readingToIso = '', readingStatusFilter, onCardClick }) {
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

    // 1. Filtrar UCs a partir de Aguardando Conexão, exceto cancelados
    const calendarUnits = units.filter(u => ['aguardando_conexao', 'ativo', 'sem_geracao', 'em_atraso', 'desconectado', 'desligado_por_tt'].includes(u.status));

    const matchedUsinasForCalendar = searchTerm?.trim()
        ? availableUsinas.filter(uName => usinaCasaComBusca(uName, searchTerm))
        : [];
    const isSearchingUsinaInCalendar = matchedUsinasForCalendar.length > 0;

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
            !['cancelado', 'cancelada'].includes(inv.status?.trim().toLowerCase())
        );
        const hasInvoice = !!matchingInvoice;

        if (readingFromIso || readingToIso) {
            const invReadIso = normalizeReadingDateToIso(matchingInvoice?.data_leitura);
            if (!invReadIso) return acc;
            if (readingFromIso && invReadIso < readingFromIso) return acc;
            if (readingToIso && invReadIso > readingToIso) return acc;
        }

        let status = 'pendente';

        const isFuture = (filterYear > currentYearNum) || 
                       (filterYear === currentYearNum && filterMonth > currentMonthNum) || 
                       (isCurrentMonth && day > currentDayNum);

        if (hasInvoice) {
            const rs = matchingInvoice.reading_status;
            if (rs === 'error') status = 'indisponivel';
            else if (rs === 'processing') status = 'baixada';
            else if (rs === 'success') status = 'processada';
            else status = 'pendente';
        } else if (isFuture) {
            status = 'not_available';
        } else {
            status = 'pendente';
        }

        if (readingStatusFilter && status !== readingStatusFilter) return acc;

        if (searchTerm) {
            const unitUsinaName = unit.usinas?.name || '';
            if (isSearchingUsinaInCalendar) {
                if (!unitUsinaName || !usinaCasaComBusca(unitUsinaName, searchTerm)) return acc;
            } else {
                const normQuery = normalizarTextoBusca(searchTerm);
                const displayName = unit.tipo_unidade === 'geradora'
                    ? (unit.usinas?.name || unit.suppliers?.name || '')
                    : (unit.subscribers?.name || '');
                const matchesSearch = 
                    ucCasaComBusca(unit.numero_uc, searchTerm) ||
                    normalizarTextoBusca(displayName).includes(normQuery) ||
                    normalizarTextoBusca(unit.titular_fatura?.name).includes(normQuery) ||
                    normalizarTextoBusca(unit.concessionaria).includes(normQuery) ||
                    normalizarTextoBusca(unitUsinaName).includes(normQuery);
                if (!matchesSearch) return acc;
            }
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
                                {contasStatuses.concat([{ key: 'not_available', label: 'Não Disponível', bg: '#f1f5f9', color: '#475569' }]).map(status => {
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
                                dayUnits.map(uc => {
                                    const stConf = contasStatuses.find(s => s.key === uc.displayStatus) || { bg: '#f1f5f9', color: '#cbd5e1' };
                                    return (
                                    <div key={uc.id} onClick={() => onCardClick(uc)} style={{
                                        padding: '0.6rem', borderRadius: '8px',
                                        background: stConf.bg,
                                        borderLeft: `5px solid ${stConf.color}`,
                                        cursor: 'pointer', fontSize: '0.8rem', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                    }}>
                                        <div style={{ 
                                            fontWeight: 'bold', 
                                            color: '#0f172a', 
                                            whiteSpace: 'nowrap', 
                                            overflow: 'hidden', 
                                            textOverflow: 'ellipsis' 
                                        }}>
                                            {(uc.tipo_unidade === 'geradora' ? (uc.usinas?.name || uc.suppliers?.name) : uc.subscribers?.name) || 'S/ Assinante'}
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
                                    );
                                })
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
