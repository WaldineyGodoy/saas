import { useState, useEffect, useRef } from 'react';
import { deriveReadingStatus } from '../lib/readingStatus';
import { supabase } from '../lib/supabase';
import { CreditCard, FileText, Calculator, DollarSign, Lightbulb, Zap, AlertCircle, Ban, CheckCircle, Send, Plus, CheckCircle2 } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { createAsaasCharge, cancelAsaasCharge, updateAsaasCharge, parseInvoice, mergePdf, sendCombinedNotification, recalcularFatura } from '../lib/api';
import { useBranding } from '../contexts/BrandingContext';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import './InvoicesModal.css';
import { Download, Loader2, Info, Clock, RefreshCw, X, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import HistoryTimeline from './HistoryTimeline';
import * as pdfjsLib from 'pdfjs-dist';
// Explicitly load the worker for pdfjs
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getSecurePdfUrl } from '../lib/pdfHelper';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Tarifa usada no cálculo da fatura — mesma regra da fn_calcular_fatura:
 * a tarifa impressa na conta (TE + TUSD unitários, com tributos) e, só na
 * falta dela, a do cadastro da UC. Usar o cadastro aqui fazia a tela mostrar
 * outro valor que o boleto: UC 160382603202 10/2026 aparecia R$ 460,87
 * (cadastro 1,0347) com R$ 458,95 gravados (conta 1,02979).
 */
const tarifaDaFatura = (dados, uc) => {
    const te = Number(dados?.te_apurado);
    const tusd = Number(dados?.tusd_apurado);
    if (te > 0 && tusd > 0) return { tarifa: te + tusd, origem: 'conta' };
    return { tarifa: Number(uc?.tarifa_concessionaria) || 0, origem: 'cadastro' };
};

export default function InvoiceFormModal({ invoice, ucs, onClose, onSave, extraActions }) {
    const { profile } = useAuth();
    const { branding } = useBranding();
    const canManageStatus = ['super_admin', 'admin', 'manager'].includes(profile?.role);

    // Initial State
    const [formData, setFormData] = useState({
        uc_id: '',
        mes_referencia: new Date().toISOString().substring(0, 7), // YYYY-MM
        consumo_kwh: '',
        energia_injetada: '',
        consumo_compensado: 0,
        iluminacao_publica: '',
        tarifa_minima_excedentes: '',
        outros_lancamentos: '',
        parcelamento: '',
        data_leitura: '',
        linha_digitavel: '',
        pix_string: '',
        valor_concessionaria: 0,
        status: 'ag_emissao_boleto',

        // Calculated/Display fields
        valor_a_pagar: '',
        economia_reais: '',
        consumo_reais: '', // energy cost before taxes/extras
        energia_compensada_reais: '' // R$
    });

    const [selectedUc, setSelectedUc] = useState(null);
    // Memória de cálculo da fatura: cada parcela que compõe o valor_a_pagar,
    // mais a conta projetada sem compensação nem desconto (comparativo).
    const [demonstrativo, setDemonstrativo] = useState(null);
    const [pdfFile, setPdfFile] = useState(null);
    const [stampCoords, setStampCoords] = useState(null);
    const [applyStamp] = useState(true);
    const [localInvoiceId, setLocalInvoiceId] = useState(invoice?.id || null);
    const [loading, setLoading] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [duplicateInfo, setDuplicateInfo] = useState(null); // { existing, type: 'block' | 'ask' }
    const [showDuplicateModal, setShowDuplicateModal] = useState(false);
    const { showAlert, showConfirm } = useUI();
    const [showSuccess, setShowSuccess] = useState(false);
    const [subscriberBillingMode, setSubscriberBillingMode] = useState('consolidada');
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const [localBoletoUrl, setLocalBoletoUrl] = useState(invoice?.asaas_boleto_url || null);
    const [invoiceToDownload, setInvoiceToDownload] = useState(null);
    const [subscriber, setSubscriber] = useState(null);
    const [activeTab, setActiveTab] = useState('geral');
    const [ucSearch, setUcSearch] = useState('');
    const [ucDropdownOpen, setUcDropdownOpen] = useState(false);
    const [pendingBills, setPendingBills] = useState([]);
    const [showPendingDropdown, setShowPendingDropdown] = useState(false);
    const hiddenRef = useRef(null);
    const isSubmitting = useRef(false);

    // Helpers
    const formatCurrency = (val) => {
        if (!val && val !== 0) return 'R$ 0,00';
        return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    const parseCurrency = (str) => {
        if (!str) return 0;
        if (typeof str === 'number') return str;
        const isNegative = str.includes('-');
        const digits = str.replace(/\D/g, '');
        const value = Number(digits) / 100;
        return isNegative ? -value : value;
    };

    const handleOpenOriginalPdf = async () => {
        if (!invoice?.concessionaria_pdf_url) return;
        try {
            const secureUrl = await getSecurePdfUrl(supabase, invoice.concessionaria_pdf_url);
            window.open(secureUrl, '_blank');
        } catch (error) {
            console.error('Error opening original PDF:', error);
            showAlert('Erro ao abrir PDF original.', 'error');
        }
    };

    // Load Invoice Data
    useEffect(() => {
        setPdfFile(null);
        setStampCoords(null);
        if (invoice) {
            setFormData({
                uc_id: invoice.uc_id,
                mes_referencia: invoice.mes_referencia ? invoice.mes_referencia.substring(0, 7) : '',
                vencimento: invoice.vencimento ? invoice.vencimento.split('T')[0] : '',
                vencimento_concessionaria: invoice.vencimento_concessionaria ? invoice.vencimento_concessionaria.split('T')[0] : (invoice.vencimento ? invoice.vencimento.split('T')[0] : ''),
                consumo_kwh: invoice.consumo_kwh,
                energia_injetada: invoice.energia_injetada !== undefined && invoice.energia_injetada !== null ? invoice.energia_injetada : '',
                consumo_compensado: invoice.consumo_compensado || 0,
                iluminacao_publica: invoice.iluminacao_publica ? formatCurrency(invoice.iluminacao_publica) : '',
                tarifa_minima_excedentes: invoice.tarifa_minima ? formatCurrency(invoice.tarifa_minima) : '',
                outros_lancamentos: invoice.outros_lancamentos ? formatCurrency(invoice.outros_lancamentos) : '',
                parcelamento: invoice.parcelamento ? formatCurrency(invoice.parcelamento) : '',
                valor_a_pagar: formatCurrency(invoice.valor_a_pagar || 0),
                economia_reais: formatCurrency(invoice.economia_reais || 0),
                consumo_reais: invoice.consumo_reais ? formatCurrency(invoice.consumo_reais) : '',
                data_leitura: invoice.data_leitura ? invoice.data_leitura.split('T')[0] : '',
                linha_digitavel: invoice.linha_digitavel || '',
                pix_string: invoice.pix_string || '',
                valor_concessionaria: invoice.valor_concessionaria || invoice.valor_a_pagar || 0,
                status: invoice.status || 'ag_emissao_boleto',
                desconto_aplicado: invoice.desconto_aplicado !== undefined ? invoice.desconto_aplicado : (selectedUc?.desconto_assinante || 0),
                energy_bill_status: invoice.energy_bill_status || 'pendente',
                te_apurado: invoice.te_apurado ?? null,
                tusd_apurado: invoice.tusd_apurado ?? null,
                parcelamento_repassado: invoice.parcelamento_repassado !== false
            });
            // Find UC to set tariff info
            if (ucs) {
                const uc = ucs.find(u => u.id === invoice.uc_id);
                setSelectedUc(uc);
            }
            // Sync local boleto URL ONLY when a new invoice is loaded
            if (invoice?.id !== localInvoiceId) {
                setLocalBoletoUrl(invoice.asaas_boleto_url);
                setLocalInvoiceId(invoice.id);
            }
        } else if (ucs && ucs.length > 0) {
            setFormData(prev => ({ ...prev, uc_id: ucs[0].id }));
            setSelectedUc(ucs[0]);
            setLocalInvoiceId(null);
            setLocalBoletoUrl(null);
        }
    }, [invoice?.id, ucs]);

    // Update Selected UC when changed
    useEffect(() => {
        const fetchUcDataAndAddress = async () => {
            if (formData.uc_id && ucs) {
                let uc = ucs.find(u => u.id === formData.uc_id);
                
                // Fetch full UC details with address on-demand to guarantee we have it
                try {
                    const { data: fullUc } = await supabase
                        .from('consumer_units')
                        .select('*, subscribers:subscribers!consumer_units_subscriber_id_fkey(name)')
                        .eq('id', formData.uc_id)
                        .single();
                    if (fullUc) {
                        uc = fullUc;
                    }
                } catch (e) {
                    console.warn("Could not fetch full UC on-demand, falling back to props:", e);
                }

                setSelectedUc(uc);

                // Buscar o billing_mode do assinante
                if (uc?.subscriber_id) {
                    fetchSubscriberBillingMode(uc.subscriber_id);
                }
            }
        };
        fetchUcDataAndAddress();
    }, [formData.uc_id, ucs]);

    // Fetch contas de energia sem faturamento para a UC selecionada
    useEffect(() => {
        const fetchPendingBills = async () => {
            if (!formData.uc_id || invoice || localInvoiceId) {
                setPendingBills([]);
                return;
            }
            try {
                const { data: bills, error } = await supabase
                    .from('invoices')
                    .select('id, mes_referencia, vencimento, consumo_kwh, consumo_compensado, energia_injetada, iluminacao_publica, outros_lancamentos, parcelamento, tarifa_minima_excedentes, valor_concessionaria, data_leitura, linha_digitavel, pix_string, desconto_aplicado, te_apurado, tusd_apurado')
                    .eq('uc_id', formData.uc_id)
                    .in('status', ['sem_faturamento', 'ag_emissao_boleto'])
                    .order('mes_referencia', { ascending: false });
                if (!error) setPendingBills(bills || []);
            } catch (err) {
                console.error('Erro ao buscar contas pendentes:', err);
            }
        };
        fetchPendingBills();
    }, [formData.uc_id, invoice, localInvoiceId]);

    // Aplica os dados de uma conta de energia processada ao formulário
    const applyPendingBill = (bill) => {
        setFormData(prev => ({
            ...prev,
            mes_referencia: bill.mes_referencia || prev.mes_referencia,
            vencimento: bill.vencimento || prev.vencimento,
            vencimento_concessionaria: bill.vencimento_concessionaria || bill.vencimento || prev.vencimento_concessionaria || '',
            consumo_kwh: bill.consumo_kwh ?? prev.consumo_kwh,
            consumo_compensado: bill.consumo_compensado ?? prev.consumo_compensado,
            energia_injetada: bill.energia_injetada ?? prev.energia_injetada,
            iluminacao_publica: bill.iluminacao_publica ? formatCurrency(bill.iluminacao_publica) : prev.iluminacao_publica,
            outros_lancamentos: bill.outros_lancamentos ? formatCurrency(bill.outros_lancamentos) : prev.outros_lancamentos,
            parcelamento: bill.parcelamento ? formatCurrency(bill.parcelamento) : prev.parcelamento,
            tarifa_minima_excedentes: bill.tarifa_minima_excedentes ? formatCurrency(bill.tarifa_minima_excedentes) : prev.tarifa_minima_excedentes,
            valor_concessionaria: bill.valor_concessionaria ?? prev.valor_concessionaria,
            data_leitura: bill.data_leitura || prev.data_leitura,
            linha_digitavel: bill.linha_digitavel || prev.linha_digitavel,
            pix_string: bill.pix_string || prev.pix_string,
            desconto_aplicado: bill.desconto_aplicado ?? prev.desconto_aplicado,
            te_apurado: bill.te_apurado ?? null,
            tusd_apurado: bill.tusd_apurado ?? null,
        }));
        setShowPendingDropdown(false);
        showAlert('Dados da conta de energia carregados com sucesso!', 'success');
    };

    const fetchSubscriberBillingMode = async (subscriberId) => {
        try {
            const { data, error } = await supabase
                .from('subscribers')
                .select('billing_mode')
                .eq('id', subscriberId)
                .single();
            if (error) throw error;
            setSubscriberBillingMode(data?.billing_mode || 'consolidada');
        } catch (error) {
            console.error('Error fetching subscriber billing mode:', error);
        }
    };

    useEffect(() => {
        // Just check if we have a selected UC since we can calculate even with zeroed values
        if (selectedUc) {
            const consumo = Number(formData.consumo_kwh) || 0;
            const rawConsumoCompensado = Number(formData.consumo_compensado) || 0;
            const { tarifa: rawTarifa, origem: tarifaOrigem } = tarifaDaFatura(
                { te_apurado: formData.te_apurado, tusd_apurado: formData.tusd_apurado },
                selectedUc
            );
            
            // Prioritize persisted discount from invoice, otherwise use UC current discount
            const discountSnapshot = formData.desconto_aplicado !== undefined 
                ? Number(formData.desconto_aplicado) 
                : Number(selectedUc.desconto_assinante);
                
            const multiplier = discountSnapshot > 1 ? discountSnapshot / 100 : discountSnapshot;

            // Nova Fórmula conforme solicitação:
            // Tarifa Mínima e Excedentes R$ = (Consumo Kwh - Consumo Compensado kwh) * Valor da Tarifa
            const tarifaMinimaExcedentesReais = Math.max(0, (consumo - rawConsumoCompensado) * rawTarifa);

            // Energia Compensada R$ = Consumo Compensado kwh * Valor da Tarifa * (1 - Desconto Assinante)
            const energiaCompensadaReais = rawConsumoCompensado * rawTarifa * (1 - multiplier);

            // Economia Gerada R$ = Consumo Compensado kwh * Valor da Tarifa * Desconto Assinante
            const economiaReais = rawConsumoCompensado * rawTarifa * multiplier;

            const ip = parseCurrency(formData.iluminacao_publica);
            const outros = parseCurrency(formData.outros_lancamentos);
            // Parcela não repassada fica na conta, mas fora do boleto (20261103d).
            const parcelamento = formData.parcelamento_repassado === false ? 0 : parseCurrency(formData.parcelamento || '0');

            // Total = Energia Compensada + Tarifa Mínima e Excedentes + IP + Outros + Parcelamento
            const total = energiaCompensadaReais + tarifaMinimaExcedentesReais + ip + outros + parcelamento;

            // Conta projetada: o que a concessionária cobraria pelo consumo
            // inteiro à tarifa cheia, sem crédito de geração e sem desconto,
            // com os mesmos encargos (CIP, outros, parcelamento) que a conta
            // real traz. A diferença para o total é a economia do assinante.
            const contaProjetada = consumo * rawTarifa + ip + outros + parcelamento;

            setDemonstrativo({
                tarifa: rawTarifa,
                tarifaOrigem,
                percentualDesconto: multiplier * 100,
                consumoKwh: consumo,
                compensadoKwh: rawConsumoCompensado,
                naoCompensadoKwh: Math.max(0, consumo - rawConsumoCompensado),
                compensadaBruta: rawConsumoCompensado * rawTarifa,
                desconto: economiaReais,
                compensadaLiquida: energiaCompensadaReais,
                naoCompensadaReais: tarifaMinimaExcedentesReais,
                ip,
                outros,
                parcelamento,
                total,
                contaProjetada,
                economia: contaProjetada - total,
            });

            setFormData(prev => ({
                ...prev,
                tarifa_minima_excedentes: formatCurrency(tarifaMinimaExcedentesReais),
                energia_compensada_reais: formatCurrency(energiaCompensadaReais),
                economia_reais: formatCurrency(economiaReais),
                consumo_reais: formatCurrency(energiaCompensadaReais + tarifaMinimaExcedentesReais),
                valor_a_pagar: formatCurrency(total)
            }));
        }
    }, [
        formData.consumo_kwh,
        formData.consumo_compensado,
        formData.iluminacao_publica,
        formData.outros_lancamentos,
        formData.parcelamento,
        formData.desconto_aplicado,
        formData.te_apurado,
        formData.parcelamento_repassado,
        formData.tusd_apurado,
        selectedUc
    ]);
    
    // Fetch Subscriber details when UC is selected
    useEffect(() => {
        const fetchSubscriber = async () => {
            if (!selectedUc?.subscriber_id) return;
            try {
                const { data, error } = await supabase
                    .from('subscribers')
                    .select('*')
                    .eq('id', selectedUc.subscriber_id)
                    .single();
                if (error) throw error;
                console.log('Subscriber fetched for notifications:', data.name, data.email);
                setSubscriber(data);
            } catch (err) {
                console.error('Error fetching subscriber for notifications:', err);
            }
        };
        fetchSubscriber();
    }, [selectedUc]);

    // Automatic Due Date Calculation
    useEffect(() => {
        // Only automate for NEW invoices
        if (!invoice && selectedUc && formData.mes_referencia) {
            const [year, month] = formData.mes_referencia.split('-').map(Number);
            const dueDay = selectedUc.dia_vencimento;

            if (dueDay) {
                // Calculate next month
                let nextMonth = month + 1;
                let nextYear = year;
                if (nextMonth > 12) {
                    nextMonth = 1;
                    nextYear++;
                }

                // Ensure valid date
                const dateObj = new Date(nextYear, nextMonth - 1, dueDay);
                const formattedDate = dateObj.toISOString().split('T')[0];

                setFormData(prev => ({ ...prev, vencimento: formattedDate }));
            }
        }
    }, [formData.mes_referencia, selectedUc, invoice]);


    const handleCurrencyChange = (field, value) => {
        const isNegative = value.includes('-');
        const digits = value.replace(/\D/g, '');
        let number = Number(digits) / 100;
        if (isNegative) number = -number;
        
        const formatted = number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        setFormData(prev => ({ ...prev, [field]: formatted }));
    };

    const handleMonthChange = (part, value) => {
        const currentParts = formData.mes_referencia.split('-');
        let year = currentParts[0] || new Date().getFullYear();
        let month = currentParts[1] || '01';
        if (part === 'month') month = value;
        if (part === 'year') year = value;
        setFormData(prev => ({ ...prev, mes_referencia: `${year}-${month}` }));
    };

    const handleCancel = async () => {
        const targetId = localInvoiceId || invoice?.id;
        if (!targetId) return;

        if (isSubmitting.current) return;

        const confirmed = await showConfirm(
            'Você realmente deseja cancelar essa fatura? Se houver um boleto emitido no Asaas, ele também será cancelado.',
            'Confirmar Cancelamento',
            'Sim, Continuar',
            'Cancelar'
        );

        if (!confirmed) return;

        // A conta de energia NUNCA é excluída aqui. Fatura e conta de energia são
        // obrigações distintas na mesma linha: cancelar a cobrança do assinante
        // não extingue o que se deve à concessionária. A opção "Excluir Tudo"
        // que existia neste ponto apagava a linha inteira e levava junto valor,
        // vencimento e PDF -- sem deixar rastro, porque DELETE não era logado.
        // Perdeu a conta de 07/2026 da UC 7029875701 em 31/08/2026.
        //
        // Restam os dois desfechos legítimos, e ambos preservam a linha:
        //   Cancelar   -> status 'cancelado', conta segue visível e devida
        //   Refaturar  -> status 'sem_faturamento', pronta para nova cobrança
        const apenasRefaturar = await showConfirm(
            'A conta de energia da concessionária será preservada nos dois casos.\n\nCancelar a cobrança do assinante, ou devolver a fatura para refaturamento?',
            'Cancelar ou Refaturar?',
            'Devolver para Refaturamento',
            'Cancelar a Fatura'
        );

        isSubmitting.current = true;
        setLoading(true);
        try {
            // Cancel in Asaas if payment exists
            if (invoice?.asaas_payment_id) {
                console.log('Cancelando cobrança no Asaas:', invoice.asaas_payment_id);
                await cancelAsaasCharge(invoice.id);
            }

            // Os campos do Asaas são limpos nos dois casos: o boleto acabou de
            // ser cancelado lá, manter linha digitável e PIX seria oferecer
            // pagamento de uma cobrança que não existe mais.
            const limpaAsaas = {
                asaas_status: null,
                asaas_payment_id: null,
                asaas_boleto_url: null,
                asaas_pdf_storage_url: null,
                linha_digitavel: null,
                pix_string: null
            };

            if (apenasRefaturar) {
                const { error } = await supabase
                    .from('invoices')
                    .update({ status: 'sem_faturamento', ...limpaAsaas })
                    .eq('id', invoice.id);
                if (error) throw error;
                showAlert('Fatura devolvida para refaturamento. A conta de energia foi preservada!', 'success');
            } else {
                const { error } = await supabase
                    .from('invoices')
                    .update({ status: 'cancelado', ...limpaAsaas })
                    .eq('id', invoice.id);
                if (error) throw error;
                showAlert('Fatura cancelada. A conta de energia continua devida e visível em Contas de Energia.', 'success');
            }

            if (onSave) onSave();
            onClose();
        } catch (error) {
            console.error('Error canceling invoice:', error);
            showAlert('Erro ao cancelar fatura: ' + error.message, 'error');
        } finally {
            setLoading(false);
            isSubmitting.current = false;
        }
    };

    const handleResendNotification = async (inv) => {
        if (!inv || !inv.id) return;
        setIsGeneratingPdf(true);
        setInvoiceToDownload(inv);

        try {
            let pdfBlob = null;
            const fileName = `Fatura_${inv.id}.pdf`;

            // 1. Obter PDF do Storage
            if (inv.asaas_pdf_storage_url) {
                const { data, error } = await supabase.storage
                    .from('invoices_pdfs')
                    .download(`${inv.id}.pdf`);
                if (!error && data) pdfBlob = data;
            }

            if (!pdfBlob) {
                console.log("PDF não encontrado no storage (Modal Fatura), iniciando geração automática para reenvio...");
                pdfBlob = await handleDownloadCombined(inv);
            }

            if (!pdfBlob) {
                showAlert('Não foi possível gerar o PDF para reenvio.', 'error');
                return;
            }

            // 2. Notificar
            await sendCombinedNotification({
                recipientEmail: subscriber?.email,
                recipientPhone: subscriber?.phone,
                subscriberName: subscriber?.name,
                dueDate: new Date(inv.vencimento + 'T12:00:00').toLocaleDateString('pt-BR'),
                value: Number(inv.valor_a_pagar).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                pdfBlob: pdfBlob,
                fileName: fileName,
                subscriberId: subscriber?.id,
                ucId: inv.uc_id, // Registro na UC para histórico
                profileId: profile?.id,
                invoiceId: inv.id
            });

            showAlert('Notificações reenviadas com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao reenviar notificações:', error);
            showAlert('Erro ao reenviar notificações.', 'error');
        } finally {
            setIsGeneratingPdf(false);
            setInvoiceToDownload(null);
        }
    };

    const handleDownloadCombined = async (invToUse, forcedBoletoUrl = null) => {
        const inv = invToUse || invoice;
        const currentBoletoUrl = forcedBoletoUrl || localBoletoUrl; // Prioritize forced URL (important for automatic notification)
        
        if (!inv || !currentBoletoUrl) {
            showAlert('Boleto não disponível para esta fatura.', 'warning');
            return;
        }

        setIsGeneratingPdf(true);
        setInvoiceToDownload(inv);
        console.log('Generating Combined PDF for invoice:', inv.id, 'Energy Bill URL:', inv.concessionaria_pdf_url);

        try {
            let secureEnergyBillUrl = inv.concessionaria_pdf_url;
            if (secureEnergyBillUrl) {
                secureEnergyBillUrl = await getSecurePdfUrl(supabase, secureEnergyBillUrl);
            }
            const monthYear = inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
            const cleanName = (selectedUc?.titular_conta || 'Fatura').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
            const ucNumber = selectedUc?.numero_uc || '';
            const fileName = `Fatura_${cleanName}_${ucNumber}_${monthYear}.pdf`;

            // Fallback: Gerar novo - Wait for DOM with retry
            let element = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                element = hiddenRef.current;
                if (element && element.querySelector && element.innerHTML.length > 100) break;
                console.log(`Aguardando hiddenRef render (tentativa ${attempt + 1}/10)...`);
            }
            if (!element || element.innerHTML.length < 100) {
                console.error("Ref hiddenRef ainda é null após tentativas no Modal de Fatura.");
                throw new Error("Elemento de captura não encontrado no DOM.");
            }

            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                backgroundColor: "#f8fafc"
            });

            const imgData = canvas.toDataURL('image/png');
            const pdfSummary = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdfSummary.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdfSummary.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

            const summaryBase64 = pdfSummary.output('datauristring');
            const asaasUrl = currentBoletoUrl; 
            const mergedBlob = await mergePdf(summaryBase64, asaasUrl, fileName, secureEnergyBillUrl, null);
            
            // Download the file
            const url = window.URL.createObjectURL(mergedBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            /*
            // OTIMIZAÇÃO: Fazer upload para o Storage para os próximos downloads serem instantâneos
            try {
                const storagePath = `${inv.id}.pdf`;
                console.log(`Subindo PDF individual para o Storage: ${storagePath}`);
                
                const { error: uploadError } = await supabase.storage
                    .from('invoices_pdfs')
                    .upload(storagePath, mergedBlob, {
                        upsert: true,
                        contentType: 'application/pdf'
                    });

                if (!uploadError) {
                    const { data: { publicUrl } } = supabase.storage
                        .from('invoices_pdfs')
                        .getPublicUrl(storagePath);
                    
                    // Ajustar para URL autenticada que o merge-pdf espera
                    const authenticatedUrl = publicUrl.replace('/public/', '/authenticated/');

                    await supabase
                        .from('invoices')
                        .update({ asaas_pdf_storage_url: authenticatedUrl })
                        .eq('id', inv.id);
                        
                    console.log("Storage e Banco de Dados atualizados para PDF Individual (Modal Fatura).");
                } else {
                    console.warn("Falha ao subir PDF para o Storage:", uploadError);
                }
            } catch (storageErr) {
                console.warn("Erro ao processar persistência no Storage:", storageErr);
            }
            */

            console.log('PDF Merged successfully. Blob size:', mergedBlob.size);
            showAlert('PDF Combinado gerado com sucesso!', 'success');
            return mergedBlob;
        } catch (error) {
            console.error('Erro ao gerar PDF combinado:', error);
            showAlert('Erro ao gerar PDF combinado.', 'error');
            return null;
        } finally {
            setIsGeneratingPdf(false);
            setInvoiceToDownload(null);
        }
    };

    const renderHiddenInvoiceDetail = (inv) => {
        if (!inv) return null;
        const uc = selectedUc;
        const statusColorsPdf = {
            pago: { color: '#27ae60', label: 'PAGO' },
            a_vencer: { color: '#2563eb', label: 'A VENCER' },
            sem_faturamento: { color: '#64748b', label: 'SEM FATURAMENTO' },
            ag_emissao_boleto: { color: '#64748b', label: 'SEM FATURAMENTO' },
            aguardando: { color: '#64748b', label: 'SEM FATURAMENTO' },
            atrasado: { color: '#dc2626', label: 'ATRASADO' },
            cancelado: { color: '#64748b', label: 'CANCELADO' }
        };
        const currentPdfStatus = statusColorsPdf[inv.status] || statusColorsPdf.a_vencer;
        const statusLabel = currentPdfStatus.label;
        const statusColor = currentPdfStatus.color;

        const rawConsumo = Number(inv.consumo_kwh) || 0;
        const rawCompensado = Number(inv.consumo_compensado) || 0;
        const rawTarifa = Number(uc?.tarifa_concessionaria) || 0;
        const discountSnapshot = inv.desconto_aplicado !== undefined ? Number(inv.desconto_aplicado) : (Number(uc?.desconto_assinante) || 0);
        const multiplier = discountSnapshot > 1 ? discountSnapshot / 100 : discountSnapshot;
        
        // Calculations
        const consumoTotalReais = rawConsumo * rawTarifa;
        const economiaReais = rawCompensado * rawTarifa * multiplier;
        const energiaCompensadaReais = rawCompensado * rawTarifa * (1 - multiplier);
        const ip = Number(inv.iluminacao_publica) || 0;
        const tarifaMinimaExcedentes = Math.max(0, (rawConsumo - rawCompensado) * rawTarifa);
        const outros = Number(inv.outros_lancamentos) || 0;
        // Parcela nao repassada fica com a B2W: fora do PDF do assinante.
        const parcelamento = inv.parcelamento_repassado === false ? 0 : (Number(inv.parcelamento) || 0);
        const outrosTotal = tarifaMinimaExcedentes + outros + parcelamento;
        const totalCalculado = energiaCompensadaReais + ip + outrosTotal;

        const formatCurrency = (val) => {
            return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);
        };

        return (
            <div style={{
                width: '800px',
                minWidth: '800px',
                padding: '40px',
                background: '#f8fafc',
                boxSizing: 'border-box',
                fontFamily: "'Inter', 'Montserrat', 'Helvetica', 'Arial', sans-serif"
            }}>
                <div style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    overflow: 'hidden',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    width: '100%'
                }}>
                    <div style={{
                        padding: '16px 24px',
                        borderBottom: '1px solid #f1f5f9',
                        display: 'flex',
                        justifyContent: 'flex-start',
                        alignItems: 'center',
                        background: '#ffffff'
                    }}>
                        {branding?.logo_url ? (
                            <img src={branding.logo_url} alt={branding.company_name} style={{ maxHeight: '48px', maxWidth: '180px', objectFit: 'contain' }} />
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontWeight: '700', color: '#003366', fontSize: '1.1rem' }}>
                                <FileText size={24} color="#FF6600" />
                                <span>{branding?.company_name || 'B2W Energia'}</span>
                            </div>
                        )}
                    </div>
                    <div style={{
                        backgroundColor: branding?.primary_color || '#003366',
                        padding: '20px 24px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Info size={20} color="#ffffff" />
                            <h3 style={{ margin: 0, color: '#ffffff', fontSize: '1.1rem', fontWeight: 600 }}>Detalhamento da Fatura</h3>
                        </div>
                        <div style={{
                            height: '28px',
                            lineHeight: '28px',
                            padding: '0 16px',
                            borderRadius: '30px',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            backgroundColor: statusColor,
                            textAlign: 'center',
                            boxSizing: 'border-box',
                            display: 'block'
                        }}>
                            {statusLabel}
                        </div>
                    </div>
 
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '24px',
                        gap: '24px',
                        boxSizing: 'border-box',
                        width: '100%',
                        background: '#ffffff'
                    }}>
                        {/* Subscriber Block (full width) */}
                        <div style={{
                            backgroundColor: '#f1f5f9',
                            padding: '20px 24px',
                            borderRadius: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            boxSizing: 'border-box',
                            width: '100%',
                            fontSize: '0.85rem',
                            color: '#1e293b'
                        }}>
                            {/* Linha 1: UC */}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', minWidth: '130px' }}>Número da UC:</span>
                                <span style={{ fontWeight: 800, color: '#0f172a' }}>{uc?.numero_uc || 'N/A'}</span>
                            </div>
                            {/* Linha 2: Mês de Ref e Vencimento */}
                            <div style={{ display: 'flex', gap: '24px' }}>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', minWidth: '130px' }}>Mês Referência:</span>
                                    <span style={{ fontWeight: 700 }}>{inv.mes_referencia ? `${inv.mes_referencia.split('-')[1]}/${inv.mes_referencia.split('-')[0]}` : 'N/A'}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Vencimento:</span>
                                    <span style={{ fontWeight: 800, color: '#dc2626' }}>{inv.vencimento ? new Date(inv.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}</span>
                                </div>
                            </div>
                            {/* Linha 3: Assinante */}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', minWidth: '130px' }}>Assinante:</span>
                                <span style={{ fontWeight: 800, color: '#0f172a', textTransform: 'uppercase' }}>
                                    {subscriber?.name || uc?.subscribers?.name || uc?.titular_conta || 'Assinante'}
                                </span>
                            </div>
                            {/* Linha 4: Endereço da UC Rua ou Avenida e numero */}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', minWidth: '130px' }}>Endereço:</span>
                                <span style={{ fontWeight: 600 }}>
                                    {uc?.address?.rua ? `${uc.address.rua}${uc.address.numero ? `, Nº ${uc.address.numero}` : ''}${uc.address.complemento ? ` - ${uc.address.complemento}` : ''}` : 'N/A'}
                                </span>
                            </div>
                            {/* Linha 5: Bairro */}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', minWidth: '130px' }}>Bairro:</span>
                                <span style={{ fontWeight: 600 }}>{uc?.address?.bairro || 'N/A'}</span>
                            </div>
                            {/* Linha 6: Cidade e UF */}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', minWidth: '130px' }}>Cidade/UF:</span>
                                <span style={{ fontWeight: 600 }}>{uc?.address?.cidade ? `${uc.address.cidade} - ${uc.address.uf || ''}` : 'N/A'}</span>
                            </div>
                            {/* Linha 7: Identificação */}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', minWidth: '130px' }}>Identificação:</span>
                                <span style={{ fontWeight: 600 }}>
                                    {(() => {
                                        const ident = uc?.identification || uc?.titular_conta || 'Unidade Consumidora';
                                        const parts = ident.split(/\s+/).filter(Boolean);
                                        return parts.length <= 2 ? ident : `${parts[0]} ${parts[1]}`;
                                    })()}
                                </span>
                            </div>
                        </div>

                        {/* Composição da Fatura (extending full width) */}
                        <div style={{ width: '100%' }}>
                            <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', marginTop: 0, marginBottom: '8px', borderBottom: '2px solid #cbd5e1', paddingBottom: '4px' }}>
                                Composição da Fatura
                            </h4>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid #cbd5e1', textAlign: 'left', color: '#64748b', fontWeight: 700 }}>
                                        <th style={{ padding: '6px 0', fontSize: '0.72rem', textTransform: 'uppercase' }}>Descrição do Lançamento</th>
                                        <th style={{ padding: '6px 0', textAlign: 'center', fontSize: '0.72rem', textTransform: 'uppercase' }}>Quantitativo</th>
                                        <th style={{ padding: '6px 0', textAlign: 'right', fontSize: '0.72rem', textTransform: 'uppercase' }}>Valores</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '8px 0' }}>
                                            <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Consumo total</div>
                                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>({rawConsumo} x R$ {rawTarifa.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })})</div>
                                        </td>
                                        <td style={{ padding: '8px 0', textAlign: 'center', color: '#1e293b', fontWeight: '600' }}>{rawConsumo} kwh</td>
                                        <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(consumoTotalReais)}*</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '8px 0' }}>
                                            <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Energia Compensada</div>
                                        </td>
                                        <td style={{ padding: '8px 0', textAlign: 'center', color: '#166534', fontWeight: '600' }}>- {rawCompensado} kwh</td>
                                        <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#166534' }}>{formatCurrency(energiaCompensadaReais)}</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '8px 0' }}>
                                            <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Iluminação Pública</div>
                                        </td>
                                        <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                        <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(ip)}</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '8px 0' }}>
                                            <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Tarifa Mínima / Excedentes</div>
                                        </td>
                                        <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                        <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(tarifaMinimaExcedentes)}</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '8px 0' }}>
                                            <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Multas / Juros / Bandeiras / Outros</div>
                                        </td>
                                        <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                        <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(outros)}</td>
                                    </tr>
                                    {parcelamento > 0 && (
                                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '8px 0' }}>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Parcelamento</div>
                                            </td>
                                            <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(parcelamento)}</td>
                                        </tr>
                                    )}
                                    {/* Summary Rows Inside Table */}
                                    <tr style={{ borderBottom: '1px solid #cbd5e1', fontWeight: 'bold', background: '#f8fafc' }}>
                                        <td style={{ padding: '8px 8px' }}>Consumo R$</td>
                                        <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{formatCurrency(totalCalculado + economiaReais)}</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid #cbd5e1', fontWeight: 'bold', color: '#166534', background: '#f8fafc' }}>
                                        <td style={{ padding: '8px 8px' }}>Desconto R$</td>
                                        <td style={{ padding: '8px 0', textAlign: 'center' }}>—</td>
                                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>-{formatCurrency(economiaReais)}</td>
                                    </tr>
                                    <tr style={{ fontWeight: '900', color: '#1e3a8a', background: '#eff6ff' }}>
                                        <td style={{ padding: '8px 8px', borderRadius: '4px 0 0 4px' }}>Valor a Pagar R$</td>
                                        <td style={{ padding: '8px 0', textAlign: 'center' }}>—</td>
                                        <td style={{ padding: '8px 8px', textAlign: 'right', borderRadius: '0 4px 4px 0' }}>{formatCurrency(totalCalculado)}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <div style={{ fontSize: '0.65rem', color: '#64748b', fontStyle: 'italic', marginTop: '6px', borderBottom: '1px solid #cbd5e1', paddingBottom: '6px' }}>
                                * Valor calculado com base na tarifa cheia da concessionária.
                            </div>
                        </div>

                        {/* Valor a Pagar Box (extending full width) */}
                        <div style={{
                            marginTop: '8px',
                            padding: '16px 20px',
                            borderRadius: '12px',
                            background: '#eff6ff',
                            border: '1.5px solid #bfdbfe',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            boxSizing: 'border-box',
                            width: '100%'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 'bold', color: '#1e3a8a' }}>
                                <span>Consumo R$</span>
                                <span>{formatCurrency(totalCalculado + economiaReais)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 'bold', color: '#166534' }}>
                                <span>Desconto {discountSnapshot}% R$</span>
                                <span>-{formatCurrency(economiaReais)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: '900', color: '#1e3a8a', borderTop: '1px dashed #bfdbfe', paddingTop: '8px', marginTop: '4px' }}>
                                <span>Valor a Pagar R$</span>
                                <span>{formatCurrency(totalCalculado)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const handlePdfUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setPdfFile(file);
        setStampCoords(null);
        setIsParsing(true);
        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = reader.result;
                try {
                    const data = await parseInvoice(base64);
                    
                    let extractedConsumoCompensado = data.consumo_compensado;

                    // Parse PDF client-side to detect stamp coordinates and local fallbacks
                    try {
                        const base64Data = base64.split(',')[1] || base64;
                        const pdf = await pdfjsLib.getDocument({ data: atob(base64Data) }).promise;
                        let fullText = "";
                        let localStampCoords = null;
                        for (let i = 1; i <= Math.min(pdf.numPages, 2); i++) {
                            const page = await pdf.getPage(i);
                            const textContent = await page.getTextContent();
                            if (i === 1) {
                                const targetItem = textContent.items.find(item => 
                                    item.str.toUpperCase().includes('INFORMAÇÕES IMPORTANTES') || 
                                    item.str.toUpperCase().includes('AVISOS')
                                );
                                if (targetItem) {
                                    localStampCoords = { x: targetItem.transform[4], y: targetItem.transform[5] };
                                }
                            }
                            fullText += textContent.items.map(s => s.str).join(" ") + "\n";
                        }
                        if (localStampCoords) {
                            setStampCoords(localStampCoords);
                            console.log('Coordinates detected for stamp:', localStampCoords);
                        }

                        const cleanText = fullText.replace(/\s+/g, ' ');
                        const parseValue = (v) => v ? parseFloat(v.replace('.', '').replace(',', '.')) : 0;
                        
                        // FALLBACK: Client-side extraction for Consumo Compensado if not found by Edge Function
                        if (extractedConsumoCompensado === undefined || extractedConsumoCompensado === null || extractedConsumoCompensado === 0) {
                            // Consumo Compensado - Regra: Somar lançamentos -TE (comercial)
                            const compensadoMatches = cleanText.match(/G\dComp\..*?\-TE\s+kWh\s+([\d,.]+)-/gi);
                            let totalCompensado = 0;
                            if (compensadoMatches) {
                                compensadoMatches.forEach(match => {
                                    const valMatch = match.match(/([\d,.]+)-/);
                                    if (valMatch) totalCompensado += parseValue(valMatch[1]);
                                });
                            } else {
                                const compensadoMatch = cleanText.match(/(?:Energia\sCompensada|GX\sCOMP|GXCOMP|Consumo\sCompensado).*?([\d,.]+)\s*kWh/i);
                                if (compensadoMatch) totalCompensado = parseValue(compensadoMatch[1]);
                            }

                            if (totalCompensado > 0) {
                                extractedConsumoCompensado = totalCompensado;
                                console.log('Extração local de Consumo Compensado:', totalCompensado);
                            }
                        }
                    } catch (error) {
                        console.warn('Erro na extração local de backup/coordenadas:', error);
                    }

                    // Now update state with all data
                    setFormData(prev => {
                        const newFormData = { ...prev };
                        if (data.consumo_kwh !== undefined) newFormData.consumo_kwh = data.consumo_kwh;
                        if (data.energia_injetada !== undefined && data.energia_injetada !== null) newFormData.energia_injetada = data.energia_injetada;
                        if (extractedConsumoCompensado !== undefined) newFormData.consumo_compensado = extractedConsumoCompensado;
                        if (data.mes_referencia) newFormData.mes_referencia = data.mes_referencia;
                        if (data.vencimento) newFormData.vencimento = data.vencimento;
                        if (data.data_leitura) newFormData.data_leitura = data.data_leitura;
                        if (data.valorTotal) newFormData.valor_concessionaria = data.valorTotal;
                        if (data.iluminacao_publica) newFormData.iluminacao_publica = formatCurrency(data.iluminacao_publica);
                        if (data.outros_lancamentos) newFormData.outros_lancamentos = formatCurrency(data.outros_lancamentos);
                        if (data.parcelamento) newFormData.parcelamento = formatCurrency(data.parcelamento);
                        if (data.linha_digitavel) newFormData.linha_digitavel = data.linha_digitavel;
                        if (data.pix_string) newFormData.pix_string = data.pix_string;
                        
                        return newFormData;
                    });

                    showAlert('Dados extraídos com sucesso!', 'success');
                } catch (err) {
                    console.error('OCR Error:', err);
                    showAlert('Falha na leitura automática: ' + err.message, 'error');
                } finally {
                    setIsParsing(false);
                }
            };
            reader.readAsDataURL(file);
        } catch (error) {
            console.error(error);
            setIsParsing(false);
            showAlert('Erro ao carregar arquivo.', 'error');
        }
    };

    const handleEmission = async () => {
        const targetId = localInvoiceId || invoice?.id;
        if (!targetId) {
            showAlert('Salve a fatura antes de emitir o boleto.', 'warning');
            return;
        }

        const isRegeneration = !!localBoletoUrl || !!invoice?.asaas_id;
        const message = isRegeneration 
            ? 'Já existe uma fatura emitida. Deseja atualizar a cobrança no Asaas com os novos dados?'
            : 'Deseja gerar o boleto Asaas agora para esta fatura?';

        const confirmed = await showConfirm(
            message,
            isRegeneration ? 'Nova Cobrança' : 'Emitir Boleto',
            isRegeneration ? 'Sim, Emitir Nova' : 'Gerar Boleto',
            'Cancelar'
        );

        if (!confirmed) return;

        setGenerating(true);
        try {
            const targetId = localInvoiceId || invoice?.id;
            // Pass the current vencimento from form to ensure Asaas uses the new date
            const result = await createAsaasCharge(targetId, 'invoice', { dueDate: formData.vencimento });
            if (result.semBoleto) {
                showAlert(result.mensagem, 'info');
                return;
            }
            const finalBoletoUrl = result.url || localBoletoUrl || invoice?.asaas_boleto_url;

            if (finalBoletoUrl) {
                setLocalBoletoUrl(finalBoletoUrl);
                setShowSuccess(true);
                setTimeout(() => setShowSuccess(false), 3000);
                window.open(finalBoletoUrl, '_blank');
                
                // Automatic Notification logic
                console.log('Triggering automatic notification step...');
                try {
                    // Fetch subscriber data ON-DEMAND to ensure we have the most up-to-date values
                    const { data: currentInv, error: invFetchErr } = await supabase
                        .from('invoices')
                        .select('*')
                        .eq('id', targetId)
                        .single();
                    
                    if (invFetchErr) throw invFetchErr;

                    let currentUc = selectedUc;
                    if (currentInv?.uc_id) {
                        const { data: ucData } = await supabase
                            .from('consumer_units')
                            .select(`
                                id, numero_uc, concessionaria, titular_conta, status,
                                tarifa_concessionaria, desconto_assinante, tipo_ligacao, dia_vencimento, subscriber_id
                            `)
                            .eq('id', currentInv.uc_id)
                            .single();
                        if (ucData) {
                            currentUc = ucData;
                            setSelectedUc(ucData);
                        }
                    }

                    const subId = currentUc?.subscriber_id;
                    
                    if (subId) {
                        const { data: subData, error: subFetchErr } = await supabase
                            .from('subscribers')
                            .select('*')
                            .eq('id', subId)
                            .single();
                        
                        if (subFetchErr) throw subFetchErr;

                        if (subData) {
                            showAlert('Gerando PDF para notificações...', 'info');
                            // handleDownloadCombined returns the blob and handles browser download
                            // IMPORTANT: Pass the finalBoletoUrl directly because state update is async
                            const pdfBlob = await handleDownloadCombined(currentInv, finalBoletoUrl);
                            
                            if (pdfBlob) {
                                showAlert('Enviando notificações (E-mail/WhatsApp)...', 'info');
                                const monthYearStr = currentInv.mes_referencia ? currentInv.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
                                const cleanSubName = (subData.name || 'Cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
                                const ucNum = currentUc?.numero_uc || '';
                                const descriptiveFileName = `Fatura_${cleanSubName}_${ucNum}_${monthYearStr}.pdf`;

                                await sendCombinedNotification({
                                    recipientEmail: subData.email,
                                    recipientPhone: subData.phone,
                                    subscriberName: subData.name,
                                    dueDate: new Date(currentInv.vencimento + 'T12:00:00').toLocaleDateString('pt-BR'),
                                    value: Number(currentInv.valor_a_pagar).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                                    pdfBlob: pdfBlob,
                                    fileName: descriptiveFileName,
                                    subscriberId: subData.id,
                                    ucId: currentInv.uc_id,
                                    profileId: profile?.id,
                                    invoiceId: currentInv.id
                                });
                                showAlert('Notificações enviadas com sucesso!', 'success');
                                console.log('Notification sent successfully');
                            }
                        }
                    } else {
                        console.warn('Subscriber ID not found for notification');
                    }
                } catch (notifErr) {
                    console.error('Notification error:', notifErr);
                    showAlert('Boleto gerado, mas houve erro ao processar notificações automáticas.', 'warning');
                }

                if (onSave) onSave();
            }
        } catch (error) {
            console.error(error);
            showAlert('Erro ao gerar boleto: ' + error.message, 'error');
        } finally {
            setGenerating(false);
        }
    };

    const handleSubmit = async (e, action = null) => {
        if (e) e.preventDefault();
        
        if (isSubmitting.current) return;
        isSubmitting.current = true;
        
        setLoading(true);

        try {
            let publicUrl = null;
            if (pdfFile && selectedUc) {
                try {
                    let fileToUpload = pdfFile;

                    if (applyStamp) {
                        try {
                            const arrayBuffer = await pdfFile.arrayBuffer();
                            const pdfDoc = await PDFDocument.load(arrayBuffer);
                            const pages = pdfDoc.getPages();
                            
                            // Discard secondary pages
                            const initialCount = pages.length;
                            if (initialCount > 1) {
                                for (let i = initialCount - 1; i > 0; i--) {
                                    pdfDoc.removePage(i);
                                }
                            }

                            const firstPage = pdfDoc.getPages()[0];
                            const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
                            
                            const stampText = "NÃO PAGUE ESSA CONTA - VIA DE CONFERÊNCIA";
                            const fontSize = 11;
                            const textWidth = font.widthOfTextAtSize(stampText, fontSize);

                            let stampX = 40;
                            let stampY = 50;

                            if (stampCoords) {
                                stampX = stampCoords.x;
                                stampY = Math.max(20, stampCoords.y - 15); // Just below the title
                            } else {
                                // Safe fallback area
                                stampY = 80; 
                            }

                            // Draw a highlight background
                            firstPage.drawRectangle({
                                x: stampX - 2,
                                y: stampY - 3,
                                width: textWidth + 10,
                                height: fontSize + 6,
                                color: rgb(1, 0.9, 0.9),
                                opacity: 0.9
                            });

                            // Draw the text
                            firstPage.drawText(stampText, {
                                x: stampX + 3,
                                y: stampY,
                                size: fontSize,
                                font: font,
                                color: rgb(0.8, 0, 0),
                            });

                            const pdfBytes = await pdfDoc.save();
                            fileToUpload = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
                            console.log("PDF trimmed and stamped successfully in InvoiceFormModal.");
                        } catch (pdfErr) {
                            console.warn("Failed to apply stamp/trim in InvoiceFormModal, using original file:", pdfErr);
                        }
                    }

                    const fileName = `manual_${Date.now()}.pdf`;
                    const storagePath = `invoices/${selectedUc.numero_uc}/${fileName}`;
                    
                    // Upload to Supabase Storage
                    const { error: uploadError } = await supabase.storage
                        .from('energy-bills')
                        .upload(storagePath, fileToUpload, {
                            contentType: 'application/pdf',
                            upsert: true
                        });

                    if (uploadError) throw uploadError;

                    publicUrl = storagePath;
                } catch (uploadErr) {
                    console.error("Erro ao fazer upload do PDF:", uploadErr);
                    showAlert("Erro ao salvar arquivo PDF na nuvem, mas tentando salvar dados: " + uploadErr.message, "warning");
                }
            }

            // Recalculate values for payload to be safe
            const rawConsumo = Number(formData.consumo_kwh) || 0;
            const rawCompensado = Number(formData.consumo_compensado) || 0;
            const { tarifa: rawTarifa } = tarifaDaFatura(formData, selectedUc);
            
            // Snapshot the discount for persistence
            const discountToApply = formData.desconto_aplicado !== undefined 
                ? Number(formData.desconto_aplicado) 
                : Number(selectedUc?.desconto_assinante || 0);
                
            const multiplier = discountToApply > 1 ? discountToApply / 100 : discountToApply;
            
            const compensadaLiquida = rawCompensado * rawTarifa * (1 - multiplier);
            const tarifaMinimaExcedentes = Math.max(0, (rawConsumo - rawCompensado) * rawTarifa);
            const economiaReais = rawCompensado * rawTarifa * multiplier;
            const ip = parseCurrency(formData.iluminacao_publica);
            const outros = parseCurrency(formData.outros_lancamentos);
            const parcelamento = parseCurrency(formData.parcelamento || '0');
            // Parcela não repassada fica gravada na conta, mas fora do boleto (20261103d).
            const parcelamentoBoleto = formData.parcelamento_repassado === false ? 0 : parcelamento;
            const totalToSave = Math.max(0, compensadaLiquida + tarifaMinimaExcedentes + ip + outros + parcelamentoBoleto);

            const payload = {
                uc_id: formData.uc_id,
                mes_referencia: `${formData.mes_referencia}-01`,
                vencimento: formData.vencimento,
                vencimento_concessionaria: formData.vencimento_concessionaria || formData.vencimento || null,
                consumo_kwh: Number(formData.consumo_kwh),
                energia_injetada: formData.energia_injetada !== '' && formData.energia_injetada !== null ? Number(formData.energia_injetada) : 0,
                consumo_reais: compensadaLiquida + tarifaMinimaExcedentes,
                iluminacao_publica: ip,
                tarifa_minima: tarifaMinimaExcedentes,
                outros_lancamentos: outros,
                parcelamento: parcelamento,
                consumo_compensado: Number(formData.consumo_compensado),

                data_leitura: formData.data_leitura || null,
                valor_a_pagar: totalToSave,
                valor_concessionaria: typeof formData.valor_concessionaria === 'string' ? parseCurrency(formData.valor_concessionaria) : (Number(formData.valor_concessionaria) || 0),
                economia_reais: economiaReais,
                linha_digitavel: formData.linha_digitavel || null,
                pix_string: formData.pix_string || null,
                status: formData.status,
                desconto_aplicado: discountToApply,
                energy_bill_status: formData.energy_bill_status || 'pendente',
                concessionaria_pdf_url: publicUrl || invoice?.concessionaria_pdf_url || null,
                reading_status: deriveReadingStatus(
                    formData.status || 'a_vencer',
                    formData.energy_bill_status || 'pendente',
                    {
                        valorConcessionaria: formData.valor_concessionaria,
                        concessionariaPdfUrl: publicUrl || invoice?.concessionaria_pdf_url || null,
                        isPlaceholder: formData.is_placeholder || false
                    }
                ),
                reading_checked_at: new Date().toISOString()
            };

            if (!payload.uc_id) throw new Error('Selecione uma Unidade Consumidora.');

            // Duplicate Check (Only for new invoices and if no action has been decided)
            if (!invoice?.id && !localInvoiceId && !action) {
                const { data: existing } = await supabase
                    .from('invoices')
                    .select('id, vencimento')
                    .eq('uc_id', payload.uc_id)
                    .eq('mes_referencia', payload.mes_referencia)
                    .neq('status', 'cancelado');

                if (existing && existing.length > 0) {
                    const exactMatch = existing.find(ex => ex.vencimento === payload.vencimento);
                    if (exactMatch) {
                        setDuplicateInfo({ existing: exactMatch, type: 'block' });
                        setShowDuplicateModal(true);
                        setLoading(false);
                        return;
                    } else {
                        setDuplicateInfo({ existing: existing[0], type: 'ask' });
                        setShowDuplicateModal(true);
                        setLoading(false);
                        return;
                    }
                }
            }

            let result;
            const targetId = localInvoiceId || invoice?.id || duplicateInfo?.existing?.id;

            if (targetId || action === 'update') {
                result = await supabase.from('invoices').update(payload).eq('id', targetId).select().single();

                // Sincronizar com Asaas se já houver cobrança emitida
                if (!result.error && result.data?.asaas_payment_id) {
                    try {
                        const sync = await updateAsaasCharge(targetId, payload.valor_a_pagar, payload.vencimento);
                        if (sync?.cleared) {
                            showAlert(sync.warning, 'warning');
                            setLocalBoletoUrl(null);
                            if (invoice) invoice.asaas_boleto_url = null;
                        }
                    } catch (syncError) {
                        console.error('Erro ao sincronizar com Asaas:', syncError);
                        // Se o erro não for "removida", mostramos o alerta e paramos o fluxo de sucesso
                        showAlert('Aviso: Fatura salva localmente, mas erro ao sincronizar com Asaas: ' + syncError.message, 'warning');
                        setShowSuccess(true);
                        setTimeout(() => setShowSuccess(false), 3000);
                        if (onSave) onSave();
                        return;
                    }
                }
            } else {
                result = await supabase.from('invoices').insert(payload).select().single();
            }

            if (result.error) throw result.error;

            if (result.data?.id) {
                setLocalInvoiceId(result.data.id);
            }

            // O valor que FICA gravado vem do servidor, não desta tela.
            // O cálculo aqui em cima continua existindo para o preview enquanto
            // se digita, mas quem manda no número persistido é a
            // fn_calcular_fatura -- uma fórmula só, usada também pelo robô.
            //
            // Fatura já cobrada a função recusa de propósito: recalcular mudaria
            // em silêncio um valor que o assinante já recebeu como boleto.
            if (result.data?.id && !result.data?.asaas_payment_id) {
                try {
                    const recalculado = await recalcularFatura(result.data.id);
                    if (recalculado && Math.abs(Number(recalculado.valor_a_pagar) - Number(payload.valor_a_pagar)) > 0.01) {
                        showAlert(
                            `Valor ajustado pelo servidor para ${Number(recalculado.valor_a_pagar).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
                            'info'
                        );
                    }
                } catch (recalcErro) {
                    console.error('Falha ao recalcular a fatura no servidor:', recalcErro);
                    showAlert('Fatura salva, mas o recálculo no servidor falhou: ' + recalcErro.message, 'warning');
                }
            }

            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
            if (onSave) onSave();

            // Se for nova fatura, precisamos do ID no estado local para permitir edição sem reabrir
            if (!invoice?.id && result.data) {
                // Aqui seria ideal disparar um setInvoice se o componente pai permitir, 
                // mas por simplicidade mantemos o fluxo de edição local
            }

        } catch (error) {
            showAlert('Erro ao salvar fatura: ' + error.message, 'error');
        } finally {
            setLoading(false);
            isSubmitting.current = false;
        }
    };

    const invInputStyle = {
        width: '100%',
        padding: '0.68rem 0.9rem',
        border: '1px solid #cbd5e1',
        borderRadius: '10px',
        fontSize: '0.9rem',
        color: '#0f172a',
        fontWeight: 600,
        backgroundColor: '#f8fafc',
        outline: 'none',
        boxSizing: 'border-box',
        fontVariantNumeric: 'tabular-nums',
        transition: 'all 0.15s ease'
    };

    const invLabelStyle = {
        display: 'block',
        fontSize: '0.74rem',
        fontWeight: 700,
        color: '#475569',
        marginBottom: '0.4rem',
        textTransform: 'uppercase',
        letterSpacing: '0.03em'
    };

    const invCardStyle = {
        background: '#ffffff',
        padding: '1.25rem 1.4rem',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
    };

    const formattedMesRef = (() => {
        if (!formData.mes_referencia || !formData.mes_referencia.includes('-')) return formData.mes_referencia || '—';
        const [y, m] = formData.mes_referencia.split('-');
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        return `${months[parseInt(m, 10) - 1] || m}/${y}`;
    })();

    const compRatioPct = (() => {
        const tot = Number(formData.consumo_kwh) || 0;
        const comp = Number(formData.consumo_compensado) || 0;
        if (tot <= 0) return null;
        return Math.min(100, Math.round((comp / tot) * 100));
    })();

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.68)',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 1000, backdropFilter: 'blur(6px)', padding: '1rem'
        }}>
            <style>{`
                @keyframes invFadeIn {
                    from { opacity: 0; transform: translateY(6px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .inv-input:focus {
                    border-color: #2563eb !important;
                    background-color: #ffffff !important;
                    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
                }
                .inv-grid-2 {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
                    gap: 1.25rem;
                    align-items: start;
                }
                .inv-grid-3 {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 1rem;
                }
                .custom-tabs-scroll::-webkit-scrollbar { height: 5px; }
                .custom-tabs-scroll::-webkit-scrollbar-track { background: #f1f5f9; }
                .custom-tabs-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 99px; }
                @media (max-width: 900px) {
                    .inv-grid-2, .inv-grid-3 {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>

            <div style={{
                background: '#f8fafc',
                borderRadius: '16px',
                width: '96vw',
                maxWidth: '1180px',
                height: '90vh',
                maxHeight: '90vh',
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.38)',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative'
            }}>
                {showSuccess && (
                    <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        background: '#ffffff',
                        color: '#0f172a',
                        padding: '1.5rem 2.25rem',
                        borderRadius: '16px',
                        border: '1px solid #bbf7d0',
                        fontWeight: 800,
                        zIndex: 150,
                        boxShadow: '0 20px 40px -10px rgba(15, 23, 42, 0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.75rem',
                        animation: 'invFadeIn 0.2s ease-out'
                    }}>
                        <div style={{ background: '#16a34a', color: 'white', borderRadius: '50%', padding: '10px', display: 'flex' }}>
                            <CheckCircle2 size={28} />
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.1rem', marginBottom: '0.15rem' }}>Sucesso!</div>
                            <div style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}>Fatura salva com sucesso.</div>
                        </div>
                    </div>
                )}

                {/* Pinned Authority Header */}
                <div style={{
                    padding: '1.1rem 1.75rem',
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    color: '#ffffff',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.95rem', minWidth: 0 }}>
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            background: 'rgba(59, 130, 246, 0.18)',
                            border: '1px solid rgba(96, 165, 250, 0.35)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#60a5fa',
                            flexShrink: 0
                        }}>
                            <FileText size={22} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#ffffff', fontWeight: 800, letterSpacing: '-0.02em' }}>
                                    {invoice ? 'Fatura de Energia' : 'Nova Fatura'}
                                </h3>
                                <span style={{
                                    padding: '0.18rem 0.65rem',
                                    borderRadius: '999px',
                                    background: 'rgba(56, 189, 248, 0.18)',
                                    border: '1px solid rgba(56, 189, 248, 0.35)',
                                    color: '#7dd3fc',
                                    fontSize: '0.73rem',
                                    fontWeight: 700,
                                    fontVariantNumeric: 'tabular-nums'
                                }}>
                                    Ref. {formattedMesRef}
                                </span>
                                {selectedUc?.numero_uc && (
                                    <span style={{
                                        padding: '0.18rem 0.65rem',
                                        borderRadius: '999px',
                                        background: 'rgba(255, 255, 255, 0.08)',
                                        border: '1px solid rgba(255, 255, 255, 0.16)',
                                        color: '#e2e8f0',
                                        fontSize: '0.73rem',
                                        fontWeight: 700,
                                        fontVariantNumeric: 'tabular-nums'
                                    }}>
                                        UC {selectedUc.numero_uc}
                                    </span>
                                )}
                            </div>
                            <p style={{ margin: '0.2rem 0 0 0', color: '#94a3b8', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {selectedUc
                                    ? (selectedUc.subscribers?.name || selectedUc.titular_conta || 'Unidade Consumidora selecionada')
                                    : 'Apuração após processamento da conta da concessionária'}
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.85rem',
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: '10px',
                            padding: '0.38rem 0.85rem',
                            fontVariantNumeric: 'tabular-nums'
                        }}>
                            <div>
                                <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700 }}>Fatura Assinante</div>
                                <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#4ade80' }}>{formData.valor_a_pagar || 'R$ 0,00'}</div>
                            </div>
                            <div style={{ width: '1px', height: '24px', background: 'rgba(255, 255, 255, 0.12)' }} />
                            <div>
                                <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700 }}>Economia</div>
                                <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#38bdf8' }}>{formData.economia_reais || 'R$ 0,00'}</div>
                            </div>
                        </div>

                        {extraActions && extraActions(invoice)}

                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Fechar modal"
                            style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                width: '38px',
                                height: '38px',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                color: '#e2e8f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Status Pipeline Strip */}
                {canManageStatus && (
                    <div style={{
                        padding: '0.7rem 1.75rem',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.85rem',
                        flexWrap: 'wrap',
                        flexShrink: 0
                    }}>
                        <span style={{
                            fontSize: '0.72rem',
                            color: '#475569',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            whiteSpace: 'nowrap'
                        }}>
                            Status da Fatura:
                        </span>

                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-start' }}>
                            {[
                                { id: 'ag_emissao_boleto', label: 'Sem Faturamento', icon: FileText, color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
                                { id: 'a_vencer', label: 'A Vencer', icon: Calculator, color: '#0369a1', bg: '#f0f9ff', border: '#7dd3fc' },
                                { id: 'confirmado', label: 'Confirmado', icon: CheckCircle2, color: '#0e7490', bg: '#ecfeff', border: '#67e8f9' },
                                { id: 'pago', label: 'Pago', icon: CheckCircle, color: '#15803d', bg: '#f0fdf4', border: '#86efac' },
                                { id: 'atrasado', label: 'Atrasado', icon: AlertCircle, color: '#b91c1c', bg: '#fef2f2', border: '#fca5a5' }
                            ].map((s) => {
                                const isActive = formData.status === s.id;
                                return (
                                    <button
                                        key={s.id}
                                        type="button"
                                        onClick={() => setFormData({ ...formData, status: s.id })}
                                        style={{
                                            padding: '0.4rem 0.78rem',
                                            borderRadius: '8px',
                                            border: `1px solid ${isActive ? s.border : '#e2e8f0'}`,
                                            background: isActive ? s.bg : '#ffffff',
                                            color: isActive ? s.color : '#64748b',
                                            fontWeight: isActive ? 700 : 600,
                                            fontSize: '0.78rem',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.4rem',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        <s.icon size={14} strokeWidth={isActive ? 2.4 : 2} />
                                        {s.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Pinned Tabs Navigation */}
                <div
                    className="custom-tabs-scroll"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        borderBottom: '1px solid #e2e8f0',
                        background: '#ffffff',
                        padding: '0.55rem 1.75rem',
                        flexWrap: 'nowrap',
                        overflowX: 'auto',
                        width: '100%',
                        gap: '0.35rem',
                        scrollbarWidth: 'thin',
                        flexShrink: 0,
                        boxSizing: 'border-box'
                    }}
                >
                    {[
                        { id: 'geral', label: 'Identificação', icon: Info, badge: null },
                        { id: 'consumo', label: 'Consumo', icon: Zap, badge: formData.consumo_kwh ? `${formData.consumo_kwh} kWh` : null },
                        { id: 'financeiro', label: 'Financeiro', icon: DollarSign, badge: null },
                        { id: 'resumo', label: 'Conta de Energia', icon: FileText, badge: null },
                        { id: 'resumo_fatura', label: 'Resumo da Fatura', icon: Calculator, badge: null },
                        ...((invoice || localInvoiceId) ? [{ id: 'historico', label: 'Histórico', icon: Clock, badge: null }] : [])
                    ].map(tab => {
                        const isActive = activeTab === tab.id;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.48rem',
                                    padding: '0.5rem 0.9rem',
                                    borderRadius: '10px',
                                    border: `1px solid ${isActive ? '#bfdbfe' : 'transparent'}`,
                                    background: isActive ? '#eff6ff' : 'transparent',
                                    cursor: 'pointer',
                                    fontSize: '0.84rem',
                                    fontWeight: isActive ? 700 : 600,
                                    color: isActive ? '#1d4ed8' : '#475569',
                                    transition: 'all 0.15s ease',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                    outline: 'none'
                                }}
                            >
                                <Icon size={16} color={isActive ? '#2563eb' : '#64748b'} />
                                <span>{tab.label}</span>
                                {tab.badge && (
                                    <span style={{
                                        padding: '0.08rem 0.45rem',
                                        borderRadius: '999px',
                                        fontSize: '0.68rem',
                                        fontWeight: 700,
                                        fontVariantNumeric: 'tabular-nums',
                                        background: isActive ? '#dbeafe' : '#f1f5f9',
                                        color: isActive ? '#1e40af' : '#64748b'
                                    }}>
                                        {tab.badge}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Form wrapping Scrollable Body + Pinned Footer */}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.35rem 1.75rem' }}>

                        {/* ==================== SEÇÃO 1: IDENTIFICAÇÃO ==================== */}
                        {activeTab === 'geral' && (
                            <div style={{ animation: 'invFadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                {/* Unidade Consumidora */}
                                <div style={{ ...invCardStyle, position: 'relative' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                            <Zap size={17} color="#2563eb" /> Unidade Consumidora (UC)
                                        </h4>
                                        {selectedUc && (
                                            <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '0.18rem 0.6rem', borderRadius: '999px', background: '#f1f5f9', color: '#475569' }}>
                                                Modalidade: {subscriberBillingMode === 'consolidada' ? 'Consolidada' : 'Individualizada'}
                                            </span>
                                        )}
                                    </div>

                                    {(invoice || localInvoiceId) ? (
                                        <div style={{
                                            width: '100%',
                                            padding: '0.9rem 1.1rem',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '10px',
                                            background: '#f8fafc',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            flexWrap: 'wrap',
                                            gap: '0.75rem',
                                            boxSizing: 'border-box'
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.96rem', fontVariantNumeric: 'tabular-nums' }}>
                                                    UC {selectedUc?.numero_uc} &mdash; {selectedUc?.titular_conta || selectedUc?.identification}
                                                </div>
                                                {selectedUc?.subscribers?.name && (
                                                    <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.15rem' }}>
                                                        Assinante: <strong style={{ color: '#334155' }}>{selectedUc.subscribers.name}</strong>
                                                    </div>
                                                )}
                                            </div>
                                            {selectedUc?.concessionaria && (
                                                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#1e40af', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '0.2rem 0.6rem', borderRadius: '8px' }}>
                                                    {selectedUc.concessionaria}
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <div style={{ position: 'relative' }}>
                                            <label style={invLabelStyle}>Pesquisar e Selecionar UC *</label>
                                            <div style={{ position: 'relative' }}>
                                                <input
                                                    type="text"
                                                    className="inv-input"
                                                    placeholder="Pesquisar por número da UC, assinante ou identificação da fatura..."
                                                    value={ucSearch || (selectedUc ? `${selectedUc.numero_uc} — ${selectedUc.titular_conta || selectedUc.identification || ''}` : '')}
                                                    onChange={e => {
                                                        setUcSearch(e.target.value);
                                                        setUcDropdownOpen(true);
                                                        if (!e.target.value) {
                                                            setSelectedUc(null);
                                                            setFormData(prev => ({ ...prev, uc_id: '' }));
                                                        }
                                                    }}
                                                    onFocus={() => { setUcSearch(''); setUcDropdownOpen(true); }}
                                                    onBlur={() => setTimeout(() => setUcDropdownOpen(false), 180)}
                                                    style={{ ...invInputStyle, paddingRight: '2.5rem', background: '#ffffff' }}
                                                />
                                                <span style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: ucDropdownOpen ? '#2563eb' : '#94a3b8', pointerEvents: 'none', display: 'flex' }}>
                                                    {ucDropdownOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                                                </span>
                                            </div>
                                            {ucDropdownOpen && (
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '100%',
                                                    left: 0,
                                                    right: 0,
                                                    background: '#ffffff',
                                                    border: '1px solid #cbd5e1',
                                                    borderRadius: '10px',
                                                    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.14)',
                                                    zIndex: 200,
                                                    maxHeight: '260px',
                                                    overflowY: 'auto',
                                                    marginTop: '4px'
                                                }}>
                                                    {(ucs || []).filter(uc => {
                                                        const term = ucSearch.toLowerCase();
                                                        if (!term) return true;
                                                        return (
                                                            uc.numero_uc?.toLowerCase().includes(term) ||
                                                            uc.titular_conta?.toLowerCase().includes(term) ||
                                                            uc.identification?.toLowerCase().includes(term) ||
                                                            uc.subscribers?.name?.toLowerCase().includes(term) ||
                                                            uc.titular_fatura?.name?.toLowerCase().includes(term)
                                                        );
                                                    }).length === 0 ? (
                                                        <div style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>Nenhuma UC encontrada</div>
                                                    ) : (
                                                        (ucs || []).filter(uc => {
                                                            const term = ucSearch.toLowerCase();
                                                            if (!term) return true;
                                                            return (
                                                                uc.numero_uc?.toLowerCase().includes(term) ||
                                                                uc.titular_conta?.toLowerCase().includes(term) ||
                                                                uc.identification?.toLowerCase().includes(term) ||
                                                                uc.subscribers?.name?.toLowerCase().includes(term) ||
                                                                uc.titular_fatura?.name?.toLowerCase().includes(term)
                                                            );
                                                        }).map(uc => (
                                                            <div
                                                                key={uc.id}
                                                                onMouseDown={() => {
                                                                    setSelectedUc(uc);
                                                                    setFormData(prev => ({ ...prev, uc_id: uc.id }));
                                                                    setUcSearch('');
                                                                    setUcDropdownOpen(false);
                                                                }}
                                                                style={{
                                                                    padding: '0.7rem 1rem',
                                                                    cursor: 'pointer',
                                                                    borderBottom: '1px solid #f1f5f9',
                                                                    background: formData.uc_id === uc.id ? '#eff6ff' : '#ffffff'
                                                                }}
                                                            >
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                                                                    <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: '6px', padding: '0.18rem 0.5rem', fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                                                        {uc.numero_uc}
                                                                    </span>
                                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {uc.titular_conta || uc.identification || '—'}
                                                                        </div>
                                                                        {uc.subscribers?.name && (
                                                                            <div style={{ fontSize: '0.74rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                                {uc.subscribers.name}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    {formData.uc_id === uc.id && <CheckCircle size={16} color="#2563eb" />}
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            )}
                                            {selectedUc && (
                                                <div style={{ marginTop: '0.6rem', padding: '0.55rem 0.85rem', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    <span style={{ background: '#2563eb', color: 'white', borderRadius: '6px', padding: '0.12rem 0.45rem', fontSize: '0.74rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{selectedUc.numero_uc}</span>
                                                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>{selectedUc.titular_conta || selectedUc.identification}</span>
                                                    {selectedUc.subscribers?.name && <span style={{ fontSize: '0.8rem', color: '#475569' }}>&mdash; {selectedUc.subscribers.name}</span>}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Competência e Datas */}
                                <div style={invCardStyle}>
                                    <div style={{ marginBottom: '1rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                            <Clock size={17} color="#2563eb" /> Competência, Leitura e Vencimento
                                        </h4>
                                    </div>
                                    <div className="inv-grid-3">
                                        <div>
                                            <label style={invLabelStyle}>Mês de Referência (Ciclo)</label>
                                            <div style={{ display: 'flex', gap: '0.55rem' }}>
                                                <select
                                                    className="inv-input"
                                                    value={formData.mes_referencia.split('-')[1]}
                                                    onChange={e => handleMonthChange('month', e.target.value)}
                                                    style={{ ...invInputStyle, flex: 1, cursor: 'pointer' }}
                                                >
                                                    {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => (
                                                        <option key={m} value={m}>{['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i]}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    className="inv-input"
                                                    value={formData.mes_referencia.split('-')[0]}
                                                    onChange={e => handleMonthChange('year', e.target.value)}
                                                    style={{ ...invInputStyle, width: '96px', cursor: 'pointer' }}
                                                >
                                                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map(y => (
                                                        <option key={y} value={y}>{y}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        <div>
                                            <label style={invLabelStyle}>Data da Leitura (Concessionária)</label>
                                            <input
                                                type="date"
                                                className="inv-input"
                                                value={formData.data_leitura}
                                                onChange={e => setFormData({ ...formData, data_leitura: e.target.value })}
                                                style={invInputStyle}
                                            />
                                        </div>

                                        <div>
                                            <label style={invLabelStyle}>Data de Vencimento *</label>
                                            <input
                                                type="date"
                                                required
                                                className="inv-input"
                                                value={formData.vencimento}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setFormData(prev => ({
                                                        ...prev,
                                                        vencimento: val,
                                                        vencimento_concessionaria: ['sem_faturamento', 'ag_emissao_boleto'].includes(prev.status) ? val : prev.vencimento_concessionaria
                                                    }));
                                                }}
                                                style={{ ...invInputStyle, color: '#b91c1c', fontWeight: 700 }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ==================== SEÇÃO 2: CONSUMO ==================== */}
                        {activeTab === 'consumo' && (
                            <div style={{ animation: 'invFadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                {/* Lançamento Automático via PDF ou Conta Processada */}
                                <div style={{
                                    background: '#eff6ff',
                                    padding: '1.15rem 1.4rem',
                                    borderRadius: '14px',
                                    border: '1px solid #bfdbfe',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: '1rem'
                                }}>
                                    <div>
                                        <h4 style={{ margin: 0, color: '#1e3a8a', fontWeight: 800, fontSize: '0.96rem' }}>Lançamento Automático por PDF</h4>
                                        <p style={{ margin: '0.2rem 0 0 0', color: '#1d4ed8', fontSize: '0.82rem' }}>
                                            Importe a fatura em PDF da concessionária ou recupere uma conta já raspada pelo robô.
                                        </p>
                                    </div>
                                    {!invoice && !localInvoiceId && (
                                        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                            {pendingBills.length > 0 && (
                                                <div style={{ position: 'relative' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowPendingDropdown(v => !v)}
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '0.45rem',
                                                            padding: '0.6rem 1rem',
                                                            background: '#f0fdf4',
                                                            color: '#166534',
                                                            border: '1px solid #86efac',
                                                            borderRadius: '10px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.84rem',
                                                            fontWeight: 700
                                                        }}
                                                    >
                                                        <FileText size={15} />
                                                        Recuperar Conta Processada
                                                        <span style={{ background: '#166534', color: 'white', borderRadius: '999px', padding: '0.08rem 0.45rem', fontSize: '0.72rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                                                            {pendingBills.length}
                                                        </span>
                                                        {showPendingDropdown ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                                    </button>
                                                    {showPendingDropdown && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: '110%',
                                                            right: 0,
                                                            background: '#ffffff',
                                                            border: '1px solid #cbd5e1',
                                                            borderRadius: '12px',
                                                            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.14)',
                                                            zIndex: 300,
                                                            minWidth: '300px',
                                                            maxHeight: '260px',
                                                            overflowY: 'auto'
                                                        }}>
                                                            <div style={{ padding: '0.65rem 1rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
                                                                Contas sem faturamento para esta UC
                                                            </div>
                                                            {pendingBills.map(bill => (
                                                                <div
                                                                    key={bill.id}
                                                                    onClick={() => applyPendingBill(bill)}
                                                                    style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid #f8fafc' }}
                                                                >
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                                                        <div>
                                                                            <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.86rem' }}>
                                                                                Ref. {bill.mes_referencia ? new Date(`${bill.mes_referencia}-01T00:00:00`).toLocaleString('pt-BR', { month: 'long', year: 'numeric' }) : '—'}
                                                                            </div>
                                                                            {bill.vencimento && (
                                                                                <div style={{ fontSize: '0.74rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                                                                                    Venc. {new Date(bill.vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                                                            {bill.consumo_kwh != null && (
                                                                                <div style={{ fontSize: '0.78rem', color: '#1d4ed8', fontWeight: 700 }}>{bill.consumo_kwh} kWh</div>
                                                                            )}
                                                                            {bill.valor_concessionaria > 0 && (
                                                                                <div style={{ fontSize: '0.78rem', color: '#15803d', fontWeight: 700 }}>
                                                                                    {Number(bill.valor_concessionaria).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                                                <label htmlFor="pdf-upload" style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.45rem',
                                                    padding: '0.6rem 1.15rem',
                                                    background: isParsing ? '#94a3b8' : '#2563eb',
                                                    color: '#ffffff',
                                                    borderRadius: '10px',
                                                    cursor: isParsing ? 'not-allowed' : 'pointer',
                                                    fontSize: '0.84rem',
                                                    fontWeight: 700
                                                }}>
                                                    {isParsing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                                    {isParsing ? 'Processando PDF...' : 'Fazer Upload do PDF'}
                                                </label>
                                                <input id="pdf-upload" type="file" accept="application/pdf" onChange={handlePdfUpload} disabled={isParsing} style={{ display: 'none' }} />
                                                {pdfFile && (
                                                    <div style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.42rem 0.75rem', borderRadius: '8px', color: '#15803d', fontWeight: 700 }}>
                                                        <FileText size={14} /> {pdfFile.name}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Medições de Energia */}
                                <div style={invCardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                            <Zap size={17} color="#2563eb" /> Medições de Energia no Ciclo (kWh)
                                        </h4>
                                        {compRatioPct !== null && (
                                            <span style={{
                                                fontSize: '0.74rem',
                                                fontWeight: 700,
                                                fontVariantNumeric: 'tabular-nums',
                                                padding: '0.2rem 0.6rem',
                                                borderRadius: '999px',
                                                background: compRatioPct > 0 ? '#dcfce7' : '#f1f5f9',
                                                color: compRatioPct > 0 ? '#166534' : '#475569'
                                            }}>
                                                Compensação: {compRatioPct}% do consumo
                                            </span>
                                        )}
                                    </div>

                                    <div className="inv-grid-3">
                                        <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                            <label style={{ ...invLabelStyle, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <Zap size={14} color="#2563eb" /> Consumo Total (kWh) *
                                            </label>
                                            <input
                                                type="number"
                                                step="any"
                                                required
                                                className="inv-input"
                                                value={formData.consumo_kwh || ''}
                                                onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })}
                                                placeholder="Ex.: 450"
                                                style={{ ...invInputStyle, background: '#ffffff', fontSize: '1.05rem', fontWeight: 800 }}
                                            />
                                        </div>

                                        <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                                            <label style={{ ...invLabelStyle, color: '#166534', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <Calculator size={14} color="#16a34a" /> Consumo Compensado (kWh)
                                            </label>
                                            <input
                                                type="number"
                                                step="any"
                                                className="inv-input"
                                                value={formData.consumo_compensado || ''}
                                                onChange={e => setFormData({ ...formData, consumo_compensado: e.target.value })}
                                                placeholder="Ex.: 400"
                                                style={{ ...invInputStyle, background: '#ffffff', borderColor: '#86efac', fontSize: '1.05rem', fontWeight: 800, color: '#15803d' }}
                                            />
                                        </div>

                                        <div style={{ background: '#f0f9ff', padding: '1rem', borderRadius: '12px', border: '1px solid #bae6fd' }}>
                                            <label style={{ ...invLabelStyle, color: '#0369a1', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <Lightbulb size={14} color="#0284c7" /> Energia Injetada (kWh)
                                            </label>
                                            <input
                                                type="number"
                                                step="any"
                                                className="inv-input"
                                                value={formData.energia_injetada || ''}
                                                onChange={e => setFormData({ ...formData, energia_injetada: e.target.value })}
                                                placeholder="Ex.: 14760"
                                                style={{ ...invInputStyle, background: '#ffffff', borderColor: '#7dd3fc', fontSize: '1.05rem', fontWeight: 800, color: '#0369a1' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ==================== SEÇÃO 3: FINANCEIRO ==================== */}
                        {activeTab === 'financeiro' && (
                            <div style={{ animation: 'invFadeIn 0.2s ease-out' }} className="inv-grid-2">
                                {/* Coluna Esquerda: Encargos e Desconto */}
                                <div style={invCardStyle}>
                                    <div style={{ marginBottom: '1rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                            <DollarSign size={17} color="#2563eb" /> Encargos da Concessionária e Desconto
                                        </h4>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={invLabelStyle}>Iluminação Pública (R$)</label>
                                            <div style={{ position: 'relative' }}>
                                                <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#64748b', fontSize: '0.85rem' }}>R$</span>
                                                <input
                                                    type="text"
                                                    className="inv-input"
                                                    value={formData.iluminacao_publica.replace('R$', '').trim()}
                                                    onChange={e => handleCurrencyChange('iluminacao_publica', e.target.value)}
                                                    placeholder="0,00"
                                                    style={{ ...invInputStyle, paddingLeft: '2.35rem', fontWeight: 700 }}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label style={invLabelStyle}>Outros Lançamentos (R$)</label>
                                            <div style={{ position: 'relative' }}>
                                                <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#64748b', fontSize: '0.85rem' }}>R$</span>
                                                <input
                                                    type="text"
                                                    className="inv-input"
                                                    value={formData.outros_lancamentos.replace('R$', '').trim()}
                                                    onChange={e => handleCurrencyChange('outros_lancamentos', e.target.value)}
                                                    placeholder="0,00"
                                                    style={{ ...invInputStyle, paddingLeft: '2.35rem', fontWeight: 700 }}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label style={invLabelStyle}>Parcelamento (R$)</label>
                                            <div style={{ position: 'relative' }}>
                                                <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#64748b', fontSize: '0.85rem' }}>R$</span>
                                                <input
                                                    type="text"
                                                    className="inv-input"
                                                    value={(formData.parcelamento || '').replace('R$', '').trim()}
                                                    onChange={e => handleCurrencyChange('parcelamento', e.target.value)}
                                                    placeholder="0,00"
                                                    style={{ ...invInputStyle, paddingLeft: '2.35rem', fontWeight: 700 }}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label style={invLabelStyle}>Desconto Aplicado (%)</label>
                                            <div style={{ position: 'relative' }}>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    className="inv-input"
                                                    value={formData.desconto_aplicado !== undefined ? formData.desconto_aplicado : (selectedUc?.desconto_assinante || 0)}
                                                    onChange={e => setFormData({ ...formData, desconto_aplicado: parseFloat(e.target.value) })}
                                                    style={{ ...invInputStyle, paddingRight: '2.2rem', fontWeight: 800, color: '#1d4ed8' }}
                                                />
                                                <span style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#64748b', fontSize: '0.85rem' }}>%</span>
                                            </div>
                                            <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0.35rem 0 0 0' }}>
                                                Padrão da UC: <strong style={{ color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{selectedUc?.desconto_assinante || 0}%</strong>
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Coluna Direita: Resultados Calculados e Emissão */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div style={invCardStyle}>
                                        <div style={{ marginBottom: '1rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9' }}>
                                            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                <Calculator size={17} color="#16a34a" /> Resultados Apurados
                                            </h4>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>
                                            <div style={{ background: '#f8fafc', padding: '0.9rem 1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>T. Mínima e Excedentes</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginTop: '0.2rem' }}>{formData.tarifa_minima_excedentes || 'R$ 0,00'}</div>
                                            </div>
                                            <div style={{ background: '#f0fdf4', padding: '0.9rem 1rem', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Energia Compensada (Líq.)</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#15803d', marginTop: '0.2rem' }}>{formData.energia_compensada_reais || 'R$ 0,00'}</div>
                                            </div>
                                            <div style={{ background: '#eff6ff', padding: '0.9rem 1rem', borderRadius: '10px', border: '1px solid #bfdbfe' }}>
                                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>Economia Gerada</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1d4ed8', marginTop: '0.2rem' }}>{formData.economia_reais || 'R$ 0,00'}</div>
                                            </div>
                                            <div style={{ background: '#0f172a', padding: '0.9rem 1rem', borderRadius: '10px', border: '1px solid #1e293b' }}>
                                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Total a Pagar (Assinante)</div>
                                                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#4ade80', marginTop: '0.2rem' }}>{formData.valor_a_pagar || 'R$ 0,00'}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {(invoice?.id || localInvoiceId) && !invoice?.asaas_boleto_url && subscriberBillingMode === 'individualizada' && (
                                        <button
                                            type="button"
                                            onClick={() => handleEmission()}
                                            disabled={generating}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '0.6rem',
                                                background: '#ea580c',
                                                color: '#ffffff',
                                                border: 'none',
                                                padding: '0.85rem 1.25rem',
                                                borderRadius: '12px',
                                                cursor: generating ? 'not-allowed' : 'pointer',
                                                fontWeight: 700,
                                                fontSize: '0.92rem',
                                                width: '100%'
                                            }}
                                        >
                                            {generating ? <Loader2 className="animate-spin" size={18} /> : <><CreditCard size={18} /> Emitir Boleto Individual via Asaas</>}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ==================== SEÇÃO 4: CONTA DE ENERGIA (CONCESSIONÁRIA) ==================== */}
                        {activeTab === 'resumo' && (
                            <div style={{ animation: 'invFadeIn 0.2s ease-out' }} className="inv-grid-2">
                                {/* Coluna Esquerda: Status de Pagamento da Concessionária + Identificação */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div style={invCardStyle}>
                                        <div style={{ marginBottom: '0.85rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9' }}>
                                            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                <FileText size={17} color="#2563eb" /> Status da Conta na Concessionária
                                            </h4>
                                            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.76rem', color: '#64748b' }}>
                                                Obrigação da B2W perante a distribuidora (independente do boleto do assinante).
                                            </p>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.45rem' }}>
                                            {[
                                                { id: 'pendente', label: 'Pendente', color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
                                                { id: 'inconsistente', label: 'Inconsistente', color: '#c2410c', bg: '#ffedd5', border: '#fdba74' },
                                                { id: 'contestada', label: 'Contestada', color: '#6d28d9', bg: '#f3e8ff', border: '#d8b4fe' },
                                                { id: 'inconsistente_pago', label: 'Inconsist. Pago', color: '#9a3412', bg: '#fed7aa', border: '#fb923c' },
                                                { id: 'contestada_pago', label: 'Contestado Pago', color: '#5b21b6', bg: '#ddd6fe', border: '#a78bfa' },
                                                { id: 'parcelada', label: 'Parcelada', color: '#a16207', bg: '#fef9c3', border: '#fde047' },
                                                { id: 'pago', label: 'Pago', color: '#15803d', bg: '#f0fdf4', border: '#86efac' }
                                            ].map(s => {
                                                const active = formData.energy_bill_status === s.id;
                                                return (
                                                    <button
                                                        key={s.id}
                                                        type="button"
                                                        onClick={() => setFormData({ ...formData, energy_bill_status: s.id })}
                                                        style={{
                                                            padding: '0.52rem 0.5rem',
                                                            borderRadius: '8px',
                                                            border: `1.5px solid ${active ? s.border : '#e2e8f0'}`,
                                                            background: active ? s.bg : '#ffffff',
                                                            color: active ? s.color : '#64748b',
                                                            fontSize: '0.74rem',
                                                            fontWeight: active ? 800 : 600,
                                                            cursor: 'pointer',
                                                            textAlign: 'center',
                                                            transition: 'all 0.15s'
                                                        }}
                                                    >
                                                        {s.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {selectedUc && (
                                        <div style={invCardStyle}>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                                                <div style={{ gridColumn: '1 / -1' }}>
                                                    <div style={invLabelStyle}>Beneficiário / Unidade Consumidora</div>
                                                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.94rem' }}>{selectedUc.subscribers?.name || selectedUc.titular_conta}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>UC: {selectedUc.numero_uc}</div>
                                                </div>
                                                <div>
                                                    <div style={invLabelStyle}>Período</div>
                                                    <div style={{ fontWeight: 700, color: '#334155', fontVariantNumeric: 'tabular-nums' }}>{formattedMesRef}</div>
                                                </div>
                                                <div>
                                                    <div style={invLabelStyle}>Vencimento</div>
                                                    <div style={{ fontWeight: 700, color: '#1d4ed8', fontVariantNumeric: 'tabular-nums' }}>
                                                        {formData.vencimento ? new Date(formData.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                                                    </div>
                                                </div>
                                            </div>

                                            {invoice?.concessionaria_pdf_url && (
                                                <button
                                                    type="button"
                                                    onClick={handleOpenOriginalPdf}
                                                    style={{
                                                        marginTop: '1rem',
                                                        width: '100%',
                                                        padding: '0.62rem 1rem',
                                                        borderRadius: '10px',
                                                        border: '1px solid #bfdbfe',
                                                        background: '#eff6ff',
                                                        color: '#1d4ed8',
                                                        fontWeight: 700,
                                                        fontSize: '0.82rem',
                                                        cursor: 'pointer',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '0.45rem'
                                                    }}
                                                >
                                                    <ExternalLink size={15} /> Abrir PDF Original da Concessionária
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Coluna Direita: Demonstrativo da Conta de Energia */}
                                <div style={invCardStyle}>
                                    <div style={{ marginBottom: '1rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
                                            Demonstrativo da Conta Concessionária
                                        </h4>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#475569' }}>
                                            <span>Consumo Total</span>
                                            <strong style={{ color: '#0f172a' }}>{formData.consumo_kwh || 0} kWh</strong>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#475569' }}>
                                            <span>Energia Injetada</span>
                                            <strong style={{ color: '#0369a1' }}>{formData.energia_injetada || 0} kWh</strong>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#475569' }}>
                                            <span>Energia Compensada</span>
                                            <strong style={{ color: '#1d4ed8' }}>{formData.consumo_compensado || 0} kWh</strong>
                                        </div>

                                        <div style={{ height: '1px', background: '#e2e8f0', margin: '0.25rem 0' }} />

                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#475569' }}>
                                            <span>Custo da Energia</span>
                                            <strong style={{ color: '#0f172a' }}>{formData.consumo_reais || 'R$ 0,00'}</strong>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#15803d', fontWeight: 700 }}>
                                            <span>Economia Gerada</span>
                                            <span>- {formData.economia_reais || 'R$ 0,00'}</span>
                                        </div>

                                        <div style={{
                                            marginTop: '0.5rem',
                                            padding: '1.1rem 1.25rem',
                                            borderRadius: '12px',
                                            background: '#f0fdf4',
                                            border: '1px solid #86efac',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            gap: '1rem'
                                        }}>
                                            <div>
                                                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#166534', textTransform: 'uppercase' }}>Valor da Conta Concessionária</div>
                                                <div style={{ fontSize: '0.72rem', color: '#15803d' }}>Incluindo taxas, CIP e impostos</div>
                                            </div>
                                            <span style={{ fontSize: '1.45rem', fontWeight: 900, color: '#14532d' }}>
                                                {formData.valor_concessionaria
                                                    ? (typeof formData.valor_concessionaria === 'number'
                                                        ? formData.valor_concessionaria.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                                        : formData.valor_concessionaria)
                                                    : formData.valor_a_pagar}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ==================== SEÇÃO 5: RESUMO DA FATURA (ASSINANTE + MEMÓRIA DE CÁLCULO PR #149) ==================== */}
                        {activeTab === 'resumo_fatura' && (() => {
                            const d = demonstrativo;
                            const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                            const tar = (v) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 5 })}`;
                            const kwh = (v) => `${(Number(v) || 0).toLocaleString('pt-BR')} kWh`;
                            const pct = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

                            const LinhaMemoria = ({ rotulo, detalhe, valor, cor = '#0f172a', forte = false, destaqueBg = null }) => (
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-start',
                                    gap: '1rem',
                                    fontSize: '0.86rem',
                                    padding: destaqueBg ? '0.55rem 0.75rem' : '0.2rem 0',
                                    borderRadius: destaqueBg ? '8px' : 0,
                                    background: destaqueBg || 'transparent'
                                }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                        <span style={{ fontWeight: forte ? 700 : 500, color: forte ? '#0f172a' : '#334155' }}>{rotulo}</span>
                                        {detalhe && (
                                            <span style={{ fontSize: '0.73rem', color: '#64748b', fontVariantNumeric: 'tabular-nums', marginTop: '0.1rem' }}>
                                                {detalhe}
                                            </span>
                                        )}
                                    </div>
                                    <span style={{ fontWeight: forte ? 800 : 700, color: cor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                        {valor}
                                    </span>
                                </div>
                            );

                            return (
                                <div style={{ animation: 'invFadeIn 0.2s ease-out' }} className="inv-grid-2">
                                    {/* Coluna Esquerda: Identificação + Comparativo sem B2W + Ações */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {selectedUc && (
                                            <div style={invCardStyle}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                                        <Calculator size={17} color="#ea580c" /> Identificação e Medições
                                                    </h4>
                                                    <span style={{ fontSize: '0.74rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', padding: '0.18rem 0.55rem', borderRadius: '999px', background: '#f1f5f9', color: '#334155' }}>
                                                        Ciclo {formattedMesRef}
                                                    </span>
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '0.95rem' }}>
                                                    <div style={{ gridColumn: '1 / -1' }}>
                                                        <div style={invLabelStyle}>Beneficiário / UC</div>
                                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>{selectedUc.subscribers?.name || selectedUc.titular_conta}</div>
                                                        <div style={{ fontSize: '0.8rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>UC: {selectedUc.numero_uc}</div>
                                                    </div>
                                                    <div>
                                                        <div style={invLabelStyle}>Vencimento do Boleto</div>
                                                        <div style={{ fontWeight: 700, color: '#1d4ed8', fontVariantNumeric: 'tabular-nums' }}>
                                                            {formData.vencimento ? new Date(formData.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={invLabelStyle}>Modalidade</div>
                                                        <div style={{ fontWeight: 700, color: '#334155' }}>
                                                            {subscriberBillingMode === 'consolidada' ? 'Consolidada' : 'Individualizada'}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Strip de medições kWh */}
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.55rem', fontVariantNumeric: 'tabular-nums' }}>
                                                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.6rem 0.75rem' }}>
                                                        <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Consumo</div>
                                                        <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a', marginTop: '0.15rem' }}>{kwh(formData.consumo_kwh)}</div>
                                                    </div>
                                                    <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', padding: '0.6rem 0.75rem' }}>
                                                        <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase' }}>Injetada</div>
                                                        <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0369a1', marginTop: '0.15rem' }}>{kwh(formData.energia_injetada)}</div>
                                                    </div>
                                                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '0.6rem 0.75rem' }}>
                                                        <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Compensada</div>
                                                        <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#15803d', marginTop: '0.15rem' }}>{kwh(formData.consumo_compensado)}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Comparativo — Sem a B2W (PR #149) */}
                                        {d && (
                                            <div style={{
                                                ...invCardStyle,
                                                background: '#f8fafc',
                                                border: '1px solid #cbd5e1'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', paddingBottom: '0.6rem', borderBottom: '1px solid #e2e8f0' }}>
                                                    <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' }}>
                                                        Comparativo — Sem a B2W
                                                    </h4>
                                                    {d.contaProjetada > 0 && (
                                                        <span style={{
                                                            fontSize: '0.72rem',
                                                            fontWeight: 800,
                                                            fontVariantNumeric: 'tabular-nums',
                                                            padding: '0.18rem 0.6rem',
                                                            borderRadius: '999px',
                                                            background: '#dcfce7',
                                                            color: '#166534'
                                                        }}>
                                                            {pct((d.economia / d.contaProjetada) * 100)} de economia real
                                                        </span>
                                                    )}
                                                </div>

                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                                                    <LinhaMemoria
                                                        rotulo="Conta projetada na concessionária"
                                                        detalhe={`sem compensação e sem desconto: ${kwh(d.consumoKwh)} × ${tar(d.tarifa)} + CIP + outros${d.parcelamento !== 0 ? ' + parcelamento' : ''}`}
                                                        valor={brl(d.contaProjetada)}
                                                    />
                                                    <LinhaMemoria
                                                        rotulo="Fatura com a B2W"
                                                        valor={brl(d.total)}
                                                    />
                                                    <div style={{ height: '1px', background: '#cbd5e1', margin: '0.15rem 0' }} />
                                                    <LinhaMemoria
                                                        rotulo="Economia gerada"
                                                        detalhe={d.contaProjetada > 0 ? `${pct((d.economia / d.contaProjetada) * 100)} da conta projetada` : undefined}
                                                        valor={brl(d.economia)}
                                                        cor="#15803d"
                                                        forte
                                                        destaqueBg="#dcfce7"
                                                    />
                                                    {!d.tarifa && (
                                                        <div style={{ fontSize: '0.75rem', color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', padding: '0.5rem 0.75rem', borderRadius: '8px', fontWeight: 600 }}>
                                                            Tarifa da UC zerada no cadastro — projeção e energia aparecem zeradas.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Ações de Emissão e Impressão */}
                                        <div style={invCardStyle}>
                                            <div style={{ marginBottom: '0.85rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9' }}>
                                                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
                                                    Emissão e Documentos da Fatura
                                                </h4>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDownloadCombined()}
                                                    disabled={isGeneratingPdf}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                                        padding: '0.7rem 1rem', background: '#ffffff', color: '#334155', fontWeight: 700,
                                                        border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.86rem',
                                                        cursor: isGeneratingPdf ? 'not-allowed' : 'pointer'
                                                    }}
                                                >
                                                    {isGeneratingPdf ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                                    {isGeneratingPdf ? 'Gerando PDF Combinado...' : 'Imprimir / Baixar PDF Combinado'}
                                                </button>

                                                {(invoice?.id || localInvoiceId) && (
                                                    localBoletoUrl ? (
                                                        <>
                                                            <a
                                                                href={localBoletoUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                                                    padding: '0.72rem 1rem', background: '#2563eb', color: '#ffffff', fontWeight: 700,
                                                                    borderRadius: '10px', textDecoration: 'none', fontSize: '0.88rem'
                                                                }}
                                                            >
                                                                <CreditCard size={17} /> Abrir Boleto Asaas
                                                            </a>
                                                            <button
                                                                type="button"
                                                                onClick={handleEmission}
                                                                disabled={generating}
                                                                style={{
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem',
                                                                    padding: '0.52rem 1rem', background: '#f8fafc', color: '#475569', fontWeight: 700,
                                                                    border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.78rem',
                                                                    cursor: generating ? 'not-allowed' : 'pointer'
                                                                }}
                                                            >
                                                                {generating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                                                Reemitir Boleto (Produção)
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={handleEmission}
                                                            disabled={generating}
                                                            style={{
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                                                padding: '0.72rem 1rem', background: '#ea580c', color: '#ffffff', fontWeight: 700,
                                                                border: 'none', borderRadius: '10px', fontSize: '0.88rem',
                                                                cursor: generating ? 'not-allowed' : 'pointer'
                                                            }}
                                                        >
                                                            {generating ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />}
                                                            Emitir Boleto via Asaas
                                                        </button>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Coluna Direita: Memória de Cálculo — Como chegamos ao valor (PR #149) */}
                                    <div style={invCardStyle}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#0f172a' }}>
                                                    Memória de Cálculo
                                                </h4>
                                                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.76rem', color: '#64748b' }}>
                                                    Como chegamos ao valor final da fatura do assinante
                                                </p>
                                            </div>
                                            {d && (
                                                <span style={{
                                                    fontSize: '0.72rem',
                                                    fontWeight: 700,
                                                    fontVariantNumeric: 'tabular-nums',
                                                    padding: '0.2rem 0.6rem',
                                                    borderRadius: '8px',
                                                    background: d.tarifaOrigem === 'conta' ? '#eff6ff' : '#fffbeb',
                                                    color: d.tarifaOrigem === 'conta' ? '#1d4ed8' : '#92400e',
                                                    border: `1px solid ${d.tarifaOrigem === 'conta' ? '#bfdbfe' : '#fde68a'}`
                                                }}>
                                                    Tarifa {d.tarifaOrigem === 'conta' ? 'da conta (TE + TUSD)' : 'do cadastro da UC'}: {tar(d.tarifa)}/kWh
                                                </span>
                                            )}
                                        </div>

                                        {d ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                <LinhaMemoria
                                                    rotulo="Energia compensada (tarifa cheia)"
                                                    detalhe={`${kwh(d.compensadoKwh)} × ${tar(d.tarifa)}/kWh`}
                                                    valor={brl(d.compensadaBruta)}
                                                />
                                                <LinhaMemoria
                                                    rotulo={`(−) Desconto B2W de ${pct(d.percentualDesconto)}`}
                                                    detalhe={`${brl(d.compensadaBruta)} × ${pct(d.percentualDesconto)}`}
                                                    valor={`− ${brl(d.desconto)}`}
                                                    cor="#15803d"
                                                />
                                                <LinhaMemoria
                                                    rotulo="= Energia compensada com desconto"
                                                    valor={brl(d.compensadaLiquida)}
                                                    forte
                                                    destaqueBg="#f8fafc"
                                                />

                                                <div style={{ height: '1px', background: '#e2e8f0', margin: '0.2rem 0' }} />

                                                <LinhaMemoria
                                                    rotulo="(+) Consumo não compensado"
                                                    detalhe={`${kwh(d.naoCompensadoKwh)} × ${tar(d.tarifa)}/kWh (mínimo e excedentes)`}
                                                    valor={brl(d.naoCompensadaReais)}
                                                />
                                                <LinhaMemoria
                                                    rotulo="(+) Iluminação pública (CIP)"
                                                    detalhe="repassada da conta da concessionária"
                                                    valor={brl(d.ip)}
                                                />
                                                <LinhaMemoria
                                                    rotulo="(+) Outros lançamentos da conta"
                                                    detalhe="encargos, multas, juros e ajustes da concessionária"
                                                    valor={brl(d.outros)}
                                                />
                                                {d.parcelamento !== 0 && (
                                                    <LinhaMemoria
                                                        rotulo="(+) Parcelamento"
                                                        detalhe="parcela de débito negociado na concessionária"
                                                        valor={brl(d.parcelamento)}
                                                    />
                                                )}

                                                <div style={{ height: '1px', background: '#cbd5e1', margin: '0.25rem 0' }} />

                                                <LinhaMemoria
                                                    rotulo="= Valor da fatura"
                                                    valor={brl(d.total)}
                                                    forte
                                                />
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontVariantNumeric: 'tabular-nums' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#475569' }}>
                                                    <span>Custo da Energia (Líquido)</span>
                                                    <strong style={{ color: '#0f172a' }}>{formData.consumo_reais || 'R$ 0,00'}</strong>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#15803d', fontWeight: 700 }}>
                                                    <span>Economia Gerada no Mês</span>
                                                    <span>- {formData.economia_reais || 'R$ 0,00'}</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Bloco Destaque Valor Total da Fatura */}
                                        <div style={{
                                            marginTop: '1rem',
                                            padding: '1.15rem 1.25rem',
                                            borderRadius: '12px',
                                            background: '#0f172a',
                                            border: '1px solid #1e293b',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            gap: '1rem',
                                            fontVariantNumeric: 'tabular-nums'
                                        }}>
                                            <div>
                                                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Valor Total da Fatura</div>
                                                <div style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>Incluindo taxas, CIP e impostos</div>
                                            </div>
                                            <span style={{ fontSize: '1.5rem', fontWeight: 900, color: '#4ade80' }}>
                                                {formData.valor_a_pagar || 'R$ 0,00'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ==================== SEÇÃO 6: HISTÓRICO ==================== */}
                        {activeTab === 'historico' && (invoice?.id || localInvoiceId) && (
                            <div style={{ animation: 'invFadeIn 0.2s ease-out' }}>
                                <div style={invCardStyle}>
                                    <div style={{ marginBottom: '1rem', paddingBottom: '0.65rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                            <Clock size={17} color="#2563eb" /> Histórico de Eventos e Auditoria da Fatura
                                        </h4>
                                    </div>
                                    <HistoryTimeline
                                        entityType="invoice"
                                        entityId={invoice?.id || localInvoiceId}
                                        entityName={`Fatura ${formData.mes_referencia} - UC ${selectedUc?.numero_uc || ''}`}
                                        isInline={true}
                                        hideHeader={true}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Pinned Footer Actions */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '1rem 1.75rem',
                        background: '#ffffff',
                        borderTop: '1px solid #e2e8f0',
                        flexShrink: 0,
                        gap: '0.85rem',
                        flexWrap: 'wrap'
                    }}>
                        <div>
                            {invoice?.id && invoice.status !== 'cancelado' && !['confirmado', 'pago'].includes(invoice.status) && canManageStatus && (
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    disabled={loading}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.45rem',
                                        background: '#fef2f2',
                                        color: '#dc2626',
                                        border: '1px solid #fecaca',
                                        padding: '0.62rem 1.1rem',
                                        borderRadius: '10px',
                                        cursor: 'pointer',
                                        fontWeight: 700,
                                        fontSize: '0.84rem'
                                    }}
                                >
                                    <Ban size={16} /> Cancelar Fatura
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    padding: '0.62rem 1.25rem',
                                    background: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '10px',
                                    cursor: 'pointer',
                                    color: '#475569',
                                    fontWeight: 700,
                                    fontSize: '0.84rem'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                style={{
                                    padding: '0.62rem 1.5rem',
                                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                                    color: '#ffffff',
                                    borderRadius: '10px',
                                    border: 'none',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    fontWeight: 700,
                                    fontSize: '0.86rem',
                                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)'
                                }}
                            >
                                {loading ? 'Salvando...' : 'Salvar Fatura'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>


            {/* Duplicate Safety Modal */}
            {showDuplicateModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, backdropFilter: 'blur(8px)' }}>
                    <div style={{ background: 'white', borderRadius: '28px', padding: '2.5rem', width: '90%', maxWidth: '480px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', textAlign: 'center', animation: 'fadeIn 0.3s ease-out' }}>
                        <div style={{ background: (branding?.secondary_color || '#FF6600') + '15', width: '80px', height: '80px', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: branding?.secondary_color || '#FF6600' }}>
                            <AlertCircle size={40} />
                        </div>

                        <h3 style={{ fontSize: '1.5rem', color: '#1e293b', fontWeight: 800, marginBottom: '0.75rem', letterSpacing: '-0.025em' }}>
                            {duplicateInfo?.type === 'block' ? 'Fatura Já Existente' : 'Fatura Detectada'}
                        </h3>

                        <p style={{ color: '#64748b', marginBottom: '2.5rem', lineHeight: '1.6', fontSize: '1rem' }}>
                            {duplicateInfo?.type === 'block'
                                ? `Já existe uma fatura emitida para esta UC com mês de referência ${formData.mes_referencia} e vencimento em ${new Date(duplicateInfo.existing.vencimento + (duplicateInfo.existing.vencimento.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('pt-BR')}.`
                                : `Já existe uma fatura para o mês de referência ${formData.mes_referencia}, porém com uma data de vencimento diferente. O que deseja fazer?`
                            }
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {duplicateInfo?.type === 'block' ? (
                                <button
                                    onClick={() => setShowDuplicateModal(false)}
                                    style={{ padding: '1.25rem', background: '#f1f5f9', color: '#475569', borderRadius: '16px', border: 'none', cursor: 'pointer', fontWeight: 700, transition: '0.2s' }}
                                    onMouseOver={e => e.currentTarget.style.background = '#e2e8f0'}
                                    onMouseOut={e => e.currentTarget.style.background = '#f1f5f9'}
                                >
                                    Entendido
                                </button>
                            ) : (
                                <>
                                    <button
                                        onClick={() => { setShowDuplicateModal(false); handleSubmit(null, 'new'); }}
                                        style={{ padding: '1.25rem', background: branding?.primary_color || 'var(--color-blue)', color: 'white', borderRadius: '16px', border: 'none', cursor: 'pointer', fontWeight: 800, transition: '0.2s', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                        onMouseOver={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                                        onMouseOut={e => e.currentTarget.style.filter = 'none'}
                                    >
                                        Emitir Nova Fatura
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowDuplicateModal(false);
                                            handleSubmit(null, 'update');
                                        }}
                                        style={{ padding: '1.25rem', background: (branding?.secondary_color || '#FF6600') + '10', color: branding?.secondary_color || '#FF6600', borderRadius: '16px', border: `1px solid ${(branding?.secondary_color || '#FF6600')}30`, cursor: 'pointer', fontWeight: 700, transition: '0.2s' }}
                                        onMouseOver={e => e.currentTarget.style.background = (branding?.secondary_color || '#FF6600') + '20'}
                                        onMouseOut={e => e.currentTarget.style.background = (branding?.secondary_color || '#FF6600') + '10'}
                                    >
                                        Ajustar Data de Vencimento
                                    </button>
                                    <button
                                        onClick={() => setShowDuplicateModal(false)}
                                        style={{ padding: '1rem', background: 'transparent', color: '#94a3b8', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 600, marginTop: '0.5rem' }}
                                    >
                                        Cancelar
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden wrapper for PDF capture */}
            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', pointerEvents: 'none' }}>
                <div ref={hiddenRef}>
                    {invoiceToDownload && renderHiddenInvoiceDetail(invoiceToDownload)}
                </div>
            </div>

            {isGeneratingPdf && (
                <div className="generation-overlay">
                    <div className="generation-spinner">
                        <Loader2 size={48} className="spin-animation" style={{ color: branding?.secondary_color || '#ff6600' }} />
                        <p style={{ marginTop: '1rem', fontWeight: 600, fontSize: '1.1rem' }}>Gerando PDF combinado...</p>
                        <p style={{ fontSize: '0.875rem', opacity: 0.8 }}>Mesclando Detalhamento com Boleto Asaas.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
