import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CreditCard, FileText, Calculator, DollarSign, Lightbulb, Zap, AlertCircle, Ban, CheckCircle, Send } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { createAsaasCharge, cancelAsaasCharge, updateAsaasCharge, parseInvoice, mergePdf, sendCombinedNotification } from '../lib/api';
import { useBranding } from '../contexts/BrandingContext';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useRef } from 'react';
import './InvoicesModal.css';
import { Download, Loader2, Info } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
// Explicitly load the worker for pdfjs
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export default function InvoiceFormModal({ invoice, ucs, onClose, onSave }) {
    const { profile } = useAuth();
    const { branding } = useBranding();
    const canManageStatus = ['super_admin', 'admin', 'manager'].includes(profile?.role);

    // Initial State
    const [formData, setFormData] = useState({
        uc_id: '',
        mes_referencia: new Date().toISOString().substring(0, 7), // YYYY-MM
        consumo_compensado: 0,
        iluminacao_publica: '',
        tarifa_minima_excedentes: '',
        outros_lancamentos: '',
        data_leitura: '',
        linha_digitavel: '',
        pix_string: '',
        valor_concessionaria: 0,
        status: 'a_vencer',

        // Calculated/Display fields
        valor_a_pagar: '',
        economia_reais: '',
        consumo_reais: '', // energy cost before taxes/extras
        energia_compensada_reais: '' // R$
    });

    const [selectedUc, setSelectedUc] = useState(null);
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
    const hiddenRef = useRef(null);

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

    // Load Invoice Data
    useEffect(() => {
        if (invoice) {
            setFormData({
                uc_id: invoice.uc_id,
                mes_referencia: invoice.mes_referencia ? invoice.mes_referencia.substring(0, 7) : '',
                vencimento: invoice.vencimento ? invoice.vencimento.split('T')[0] : '',
                consumo_kwh: invoice.consumo_kwh,
                consumo_compensado: invoice.consumo_compensado || 0,
                iluminacao_publica: invoice.iluminacao_publica ? formatCurrency(invoice.iluminacao_publica) : '',
                tarifa_minima_excedentes: invoice.tarifa_minima ? formatCurrency(invoice.tarifa_minima) : '',
                outros_lancamentos: invoice.outros_lancamentos ? formatCurrency(invoice.outros_lancamentos) : '',
                valor_a_pagar: formatCurrency(invoice.valor_a_pagar || 0),
                economia_reais: formatCurrency(invoice.economia_reais || 0),
                consumo_reais: invoice.consumo_reais ? formatCurrency(invoice.consumo_reais) : '',
                data_leitura: invoice.data_leitura ? invoice.data_leitura.split('T')[0] : '',
                linha_digitavel: invoice.linha_digitavel || '',
                pix_string: invoice.pix_string || '',
                valor_concessionaria: invoice.valor_concessionaria || invoice.valor_a_pagar || 0,
                status: invoice.status || 'a_vencer'
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
    }, [invoice.id, ucs]);

    // Update Selected UC when changed
    useEffect(() => {
        if (formData.uc_id && ucs) {
            const uc = ucs.find(u => u.id === formData.uc_id);
            setSelectedUc(uc);

            // Buscar o billing_mode do assinante
            if (uc?.subscriber_id) {
                fetchSubscriberBillingMode(uc.subscriber_id);
            }
        }
    }, [formData.uc_id, ucs]);

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
            const rawTarifa = Number(selectedUc.tarifa_concessionaria) || 0;
            const descontoPercent = Number(selectedUc.desconto_assinante) || 0;
            const multiplier = descontoPercent > 1 ? descontoPercent / 100 : descontoPercent;

            // Nova Fórmula conforme solicitação:
            // Tarifa Mínima e Excedentes R$ = (Consumo Kwh - Consumo Compensado kwh) * Valor da Tarifa
            const tarifaMinimaExcedentesReais = Math.max(0, (consumo - rawConsumoCompensado) * rawTarifa);

            // Energia Compensada R$ = Consumo Compensado kwh * Valor da Tarifa * (1 - Desconto Assinante)
            const energiaCompensadaReais = rawConsumoCompensado * rawTarifa * (1 - multiplier);

            // Economia Gerada R$ = Consumo Compensado kwh * Valor da Tarifa * Desconto Assinante
            const economiaReais = rawConsumoCompensado * rawTarifa * multiplier;

            const ip = parseCurrency(formData.iluminacao_publica);
            const outros = parseCurrency(formData.outros_lancamentos);

            // Total = Energia Compensada + Tarifa Mínima e Excedentes + IP + Outros
            const total = energiaCompensadaReais + tarifaMinimaExcedentesReais + ip + outros;

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

        const confirmed = await showConfirm(
            'Você realmente deseja cancelar essa fatura? Se houver um boleto emitido no Asaas, ele também será cancelado. Esta ação é irreversível.',
            'Confirmar Cancelamento',
            'Sim, Cancelar',
            'Voltar'
        );

        if (!confirmed) return;

        setLoading(true);
        try {
            await cancelAsaasCharge(invoice.id);
            showAlert('Fatura e cobrança canceladas com sucesso!', 'success');
            onSave();
            onClose();
        } catch (error) {
            console.error('Error canceling invoice:', error);
            showAlert('Erro ao cancelar fatura: ' + error.message, 'error');
        } finally {
            setLoading(false);
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
                profileId: profile?.id
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

    const handleDownloadCombined = async (invToUse) => {
        const inv = invToUse || invoice;
        const currentBoletoUrl = localBoletoUrl; // Use STRICTLY the local state
        
        if (!inv || !currentBoletoUrl) {
            showAlert('Boleto não disponível para esta fatura.', 'warning');
            return;
        }

        setIsGeneratingPdf(true);
        setInvoiceToDownload(inv);
        console.log('Generating Combined PDF for invoice:', inv.id, 'Energy Bill URL:', inv.concessionaria_pdf_url);

        try {
            const fileName = `Fatura_${inv.id}.pdf`;

            // OTIMIZAÇÃO: Tentar baixar direto do Storage se já existir (Ignorar se for apenas o boleto bruto do Asaas)
            const isRawAsaas = inv.asaas_pdf_storage_url?.includes('bankSlipUrl') || 
                              inv.asaas_pdf_storage_url?.includes('invoiceUrl') ||
                              inv.asaas_pdf_storage_url?.includes('asaas.com');
            
            if (inv.asaas_pdf_storage_url && !isRawAsaas) {
                console.log("Obtendo URL assinada para PDF individual...");
                const { data: signedData, error: signedError } = await supabase.storage
                    .from('invoices_pdfs')
                    .createSignedUrl(`${inv.id}.pdf`, 60);

                if (!signedError && signedData?.signedUrl) {
                    const link = document.createElement('a');
                    link.href = signedData.signedUrl;
                    link.download = fileName;
                    link.target = "_blank"; 
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    showAlert('PDF Baixado!', 'success');
                    
                    // Se estivermos gerando para notificação, precisamos do blob
                    const { data: fileBlob } = await supabase.storage.from('invoices_pdfs').download(`${inv.id}.pdf`);
                    return fileBlob;
                }
                console.warn("Falha ao obter URL assinada, gerando novo...", signedError);
            }

            // Fallback: Gerar novo (Aumentado timeout para capturar elementos carregados)
            await new Promise(resolve => setTimeout(resolve, 2000));

            const element = hiddenRef.current;
            if (!element) {
                console.error("Ref hiddenRef ainda é null após 2s no Modal de Fatura Individual.");
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
            const asaasUrl = localBoletoUrl; 
            if (!asaasUrl && !inv.asaas_pdf_storage_url) throw new Error("URL do boleto não encontrada.");
            const mergedBlob = await mergePdf(summaryBase64, asaasUrl, fileName, inv.concessionaria_pdf_url, inv.asaas_pdf_storage_url);
            
            // Download the file
            const url = window.URL.createObjectURL(mergedBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

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
        const statusLabel = inv.status?.toUpperCase() || 'N/A';
        const statusColor = inv.status === 'pago' ? '#27ae60' : (inv.status === 'atrasado' ? '#dc2626' : '#f59e0b');

        // Reuse form math/data
        return (
            <div className="pdf-capture-wrapper">
                <div className="detail-card">
                    <div className="branded-header">
                        {branding?.logo_url ? (
                            <img src={branding.logo_url} alt={branding.company_name} className="company-logo-modal" />
                        ) : (
                            <div className="company-info-fallback">
                                <FileText size={24} color="#FF6600" />
                                <span>{branding?.company_name || 'B2W Energia'}</span>
                            </div>
                        )}
                    </div>
                    <div className="detail-header" style={{ backgroundColor: branding?.primary_color || '#003366' }}>
                        <div className="header-info">
                            <Info size={20} color="#ffffff" />
                            <h3>Detalhamento da Fatura</h3>
                        </div>
                        <span className="detail-status" style={{ backgroundColor: statusColor }}>
                            {statusLabel}
                        </span>
                    </div>

                    <div className="detail-grid">
                        <div className="detail-section dark">
                            <div className="detail-item">
                                <label>ASSINANTE</label>
                                <span style={{ textTransform: 'uppercase' }}>{selectedUc?.subscribers?.name || 'Assinante'}</span>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item">
                                    <label>NÚMERO DA UC</label>
                                    <span>{selectedUc?.numero_uc || 'N/A'}</span>
                                </div>
                                <div className="detail-item">
                                    <label>IDENTIFICAÇÃO (APELIDO)</label>
                                    <span>{selectedUc?.identification || selectedUc?.titular_conta || 'Unidade Consumidora'}</span>
                                </div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item">
                                    <label>MÊS REFERÊNCIA</label>
                                    <span>{inv.mes_referencia ? `${inv.mes_referencia.split('-')[1]}/${inv.mes_referencia.split('-')[0]}` : 'N/A'}</span>
                                </div>
                                <div className="detail-item">
                                    <label>VENCIMENTO</label>
                                    <span style={{ color: '#ff6b6b', fontWeight: 'bold' }}>
                                        {inv.vencimento ? new Date(inv.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}
                                    </span>
                                </div>
                            </div>
                            <div className="detail-item">
                                <label>TIPO DE LIGAÇÃO</label>
                                <span className="connection-type-badge" style={{ backgroundColor: branding?.primary_color || '#003366' }}>
                                    {selectedUc?.tipo_ligacao || 'N/A'}
                                </span>
                            </div>
                        </div>
                        <div className="detail-section metrics">
                            <hr style={{ borderTop: '1px solid #e2e8f0', margin: '10px 0' }} />

                            <div className="metric-line">
                                <span>+ Custo da Energia Compensada (Líquida):</span>
                                <span>
                                    {(() => {
                                        const rawConsumoCompensado = Number(inv.consumo_compensado) || 0;
                                        const rawTarifa = Number(uc?.tarifa_concessionaria) || 0;
                                        const descontoPercent = Number(uc?.desconto_assinante) || 0;
                                        const multiplier = descontoPercent > 1 ? descontoPercent / 100 : descontoPercent;
                                        const energiaCompensadaReais = rawConsumoCompensado * rawTarifa * (1 - multiplier);
                                        return formatCurrency(energiaCompensadaReais);
                                    })()}
                                </span>
                            </div>
                            <div className="metric-line">
                                <span>+ Iluminação Pública:</span>
                                <span>{formatCurrency(inv.iluminacao_publica)}</span>
                            </div>
                            <div className="metric-line">
                                <span>+ Tarifa Mínima e Excedentes:</span>
                                <span>{formatCurrency(inv.tarifa_minima)}</span>
                            </div>
                            <div className="metric-line">
                                <span>+ Outros Lançamentos:</span>
                                <span>{formatCurrency(inv.outros_lancamentos)}</span>
                            </div>

                            <div className="economy-box">
                                <div className="metric-line economy">
                                    <span>Economia Gerada:</span>
                                    <span>
                                        - {(() => {
                                            const rawConsumoCompensado = Number(inv.consumo_compensado) || 0;
                                            const rawTarifa = Number(uc?.tarifa_concessionaria) || 0;
                                            const descontoPercent = Number(uc?.desconto_assinante) || 0;
                                            const multiplier = descontoPercent > 1 ? descontoPercent / 100 : descontoPercent;
                                            const economiaReais = rawConsumoCompensado * rawTarifa * multiplier;
                                            return formatCurrency(economiaReais);
                                        })()}
                                    </span>
                                </div>
                                <div className="metric-line discount">
                                    <span>Desconto Aplicado:</span>
                                    <span>{uc?.desconto_assinante || 0}%</span>
                                </div>
                            </div>

                            <div className="total-box" style={{ borderColor: branding?.secondary_color || '#22c55e', backgroundColor: '#f0fdf4' }}>
                                <div className="total-label" style={{ color: '#166534' }}>TOTAL A PAGAR</div>
                                <div className="total-value">
                                    {(() => {
                                        const rawConsumo = Number(inv.consumo_kwh) || 0;
                                        const rawCompensado = Number(inv.consumo_compensado) || 0;
                                        const rawTarifa = Number(uc?.tarifa_concessionaria) || 0;
                                        const descontoPercent = Number(uc?.desconto_assinante) || 0;
                                        const multiplier = descontoPercent > 1 ? descontoPercent / 100 : descontoPercent;
                                        
                                        const compensadaLiquida = rawCompensado * rawTarifa * (1 - multiplier);
                                        const tarifaMinimaExcedentes = Math.max(0, (rawConsumo - rawCompensado) * rawTarifa);
                                        const ip = Number(inv.iluminacao_publica) || 0;
                                        const outros = Number(inv.outros_lancamentos) || 0;
                                        
                                        const totalCalculado = compensadaLiquida + tarifaMinimaExcedentes + ip + outros;
                                        return formatCurrency(totalCalculado);
                                    })()}
                                </div>
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

        setIsParsing(true);
        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = reader.result;
                try {
                    const data = await parseInvoice(base64);
                    
                    let extractedConsumoCompensado = data.consumo_compensado;

                    // FALLBACK: Client-side extraction for Consumo Compensado if not found by Edge Function
                    if (extractedConsumoCompensado === undefined || extractedConsumoCompensado === null || extractedConsumoCompensado === 0) {
                        try {
                            const pdf = await pdfjsLib.getDocument({ data: atob(base64) }).promise;
                            let fullText = "";
                            for (let i = 1; i <= Math.min(pdf.numPages, 2); i++) {
                                const page = await pdf.getPage(i);
                                const textContent = await page.getTextContent();
                                fullText += textContent.items.map(s => s.str).join(" ") + "\n";
                            }

                            const cleanText = fullText.replace(/\s+/g, ' ');
                            const parseValue = (v) => v ? parseFloat(v.replace('.', '').replace(',', '.')) : 0;
                            
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
                        } catch (error) {
                            console.warn('Erro na extração local de backup:', error);
                        }
                    }

                    // Now update state with all data
                    setFormData(prev => {
                        const newFormData = { ...prev };
                        if (data.consumo_kwh !== undefined) newFormData.consumo_kwh = data.consumo_kwh;
                        if (extractedConsumoCompensado !== undefined) newFormData.consumo_compensado = extractedConsumoCompensado;
                        if (data.mes_referencia) newFormData.mes_referencia = data.mes_referencia;
                        if (data.vencimento) newFormData.vencimento = data.vencimento;
                        if (data.data_leitura) newFormData.data_leitura = data.data_leitura;
                        if (data.valorTotal) newFormData.valor_concessionaria = data.valorTotal;
                        if (data.iluminacao_publica) newFormData.iluminacao_publica = formatCurrency(data.iluminacao_publica);
                        if (data.outros_lancamentos) newFormData.outros_lancamentos = formatCurrency(data.outros_lancamentos);
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
                        .select('*, consumer_units(subscriber_id)')
                        .eq('id', targetId)
                        .single();
                    
                    if (invFetchErr) throw invFetchErr;

                    const subId = currentInv?.consumer_units?.subscriber_id || selectedUc?.subscriber_id;
                    
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
                            const pdfBlob = await handleDownloadCombined(currentInv);
                            
                            if (pdfBlob) {
                                showAlert('Enviando notificações (E-mail/WhatsApp)...', 'info');
                                await sendCombinedNotification({
                                    recipientEmail: subData.email,
                                    recipientPhone: subData.phone,
                                    subscriberName: subData.name,
                                    dueDate: new Date(currentInv.vencimento + 'T12:00:00').toLocaleDateString('pt-BR'),
                                    value: Number(currentInv.valor_a_pagar).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                                    pdfBlob: pdfBlob,
                                    fileName: `Fatura_${currentInv.id}.pdf`,
                                    subscriberId: subData.id,
                                    profileId: profile?.id
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
        setLoading(true);

        try {
            // Recalculate values for payload to be safe
            const rawConsumo = Number(formData.consumo_kwh) || 0;
            const rawCompensado = Number(formData.consumo_compensado) || 0;
            const rawTarifa = Number(selectedUc?.tarifa_concessionaria) || 0;
            const descontoPercent = Number(selectedUc?.desconto_assinante) || 0;
            const multiplier = descontoPercent > 1 ? descontoPercent / 100 : descontoPercent;
            
            const compensadaLiquida = rawCompensado * rawTarifa * (1 - multiplier);
            const tarifaMinimaExcedentes = Math.max(0, (rawConsumo - rawCompensado) * rawTarifa);
            const economiaReais = rawCompensado * rawTarifa * multiplier;
            const ip = parseCurrency(formData.iluminacao_publica);
            const outros = parseCurrency(formData.outros_lancamentos);
            const totalToSave = compensadaLiquida + tarifaMinimaExcedentes + ip + outros;

            const payload = {
                uc_id: formData.uc_id,
                mes_referencia: `${formData.mes_referencia}-01`,
                vencimento: formData.vencimento,
                consumo_kwh: Number(formData.consumo_kwh),
                consumo_reais: compensadaLiquida + tarifaMinimaExcedentes,
                iluminacao_publica: ip,
                tarifa_minima: tarifaMinimaExcedentes,
                outros_lancamentos: outros,
                consumo_compensado: Number(formData.consumo_compensado),

                data_leitura: formData.data_leitura || null,
                valor_a_pagar: totalToSave,
                valor_concessionaria: Number(formData.valor_concessionaria) || 0,
                economia_reais: economiaReais,
                linha_digitavel: formData.linha_digitavel || null,
                pix_string: formData.pix_string || null,
                status: formData.status
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
        }
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
            <div style={{ background: '#f8fafc', borderRadius: '12px', width: '95%', maxWidth: '800px', maxHeight: '95vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>

                {/* Header */}
                <div style={{ padding: '1.5rem', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: '12px', borderTopRightRadius: '12px', position: 'relative' }}>
                    <style>{`
                        @keyframes fadeInOut {
                            0% { opacity: 0; transform: translate(-50%, -60%); }
                            15% { opacity: 1; transform: translate(-50%, -50%); }
                            85% { opacity: 1; transform: translate(-50%, -50%); }
                            100% { opacity: 0; transform: translate(-50%, -40%); }
                        }
                    `}</style>
                    {showSuccess && (
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            background: '#dcfce7',
                            color: '#166534',
                            padding: '0.8rem 1.5rem',
                            borderRadius: '8px',
                            border: '1px solid #bbf7d0',
                            fontWeight: 'bold',
                            zIndex: 10,
                            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            animation: 'fadeInOut 0.3s ease'
                        }}>
                            <CheckCircle size={20} /> Fatura Salva com Sucesso!
                        </div>
                    )}
                    <div>
                        <h3 style={{ fontSize: '1.25rem', color: '#1e293b', fontWeight: 'bold' }}>Fatura</h3>
                        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Após processamento da Conta de Energia Concessionária</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
                </div>

                {/* Tabs Navigation */}
                <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: 'white', padding: '0 1.25rem' }}>
                    {[
                        { id: 'geral', label: 'Identificação', icon: <Info size={18} /> },
                        { id: 'consumo', label: 'Consumo', icon: <Zap size={18} /> },
                        { id: 'financeiro', label: 'Financeiro', icon: <DollarSign size={18} /> },
                        { id: 'resumo', label: 'Resumo', icon: <Calculator size={18} /> }
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
                                color: activeTab === tab.id ? '#2563eb' : '#64748b',
                                borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
                                transition: 'all 0.2s'
                            }}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '2rem' }}>

                    {/* Tab Content */}
                    <div style={{ minHeight: '350px' }}>
                        {activeTab === 'geral' && (
                            <div style={{ animation: 'fadeIn 0.3s ease' }}>
                                <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                                {/* UC Selection */}
                                <div style={{ marginBottom: '2rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.6rem', color: '#475569', fontWeight: 600 }}>Unidade Consumidora</label>
                                    <select
                                        required
                                        value={formData.uc_id}
                                        onChange={e => setFormData({ ...formData, uc_id: e.target.value })}
                                        disabled={!!(invoice || localInvoiceId)}
                                        style={{ width: '100%', padding: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '1rem', background: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                                    >
                                        <option value="">Selecione a UC...</option>
                                        {ucs && ucs.map(uc => (
                                            <option key={uc.id} value={uc.id}>{uc.numero_uc} - {uc.titular_conta}</option>
                                        ))}
                                    </select>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
                                    {/* Month/Year */}
                                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.6rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mês Referência</label>
                                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                                            <select value={formData.mes_referencia.split('-')[1]} onChange={e => handleMonthChange('month', e.target.value)} style={{ flex: 1, padding: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer' }}>
                                                {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => <option key={m} value={m}>{['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i]}</option>)}
                                            </select>
                                            <select value={formData.mes_referencia.split('-')[0]} onChange={e => handleMonthChange('year', e.target.value)} style={{ width: '100px', padding: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer' }}>
                                                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map(y => <option key={y} value={y}>{y}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    {/* Reading Date */}
                                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.6rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data da Leitura</label>
                                        <input type="date" value={formData.data_leitura} onChange={e => setFormData({ ...formData, data_leitura: e.target.value })} style={{ width: '100%', padding: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px' }} />
                                    </div>
                                    {/* Due Date */}
                                    <div className="bg-white p-4 rounded-xl border border-slate-200">
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.6rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vencimento</label>
                                        <input type="date" required value={formData.vencimento} onChange={e => setFormData({ ...formData, vencimento: e.target.value })} style={{ width: '100%', padding: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#dc2626', fontWeight: 'bold' }} />
                                    </div>
                                    {/* Status */}
                                    {canManageStatus && (
                                        <div className="bg-white p-4 rounded-xl border border-slate-200 col-span-full">
                                            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.6rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status da Fatura</label>
                                            <div style={{ display: 'flex', gap: '1rem' }}>
                                                {['a_vencer', 'pago', 'atrasado'].map((status) => (
                                                    <button
                                                        key={status}
                                                        type="button"
                                                        onClick={() => setFormData({ ...formData, status })}
                                                        style={{
                                                            flex: 1,
                                                            padding: '0.75rem',
                                                            borderRadius: '8px',
                                                            border: '1px solid',
                                                            borderColor: formData.status === status ? (status === 'pago' ? '#22c55e' : status === 'atrasado' ? '#dc2626' : '#2563eb') : '#cbd5e1',
                                                            background: formData.status === status ? (status === 'pago' ? '#f0fdf4' : status === 'atrasado' ? '#fef2f2' : '#eff6ff') : 'white',
                                                            color: formData.status === status ? (status === 'pago' ? '#166534' : status === 'atrasado' ? '#991b1b' : '#1e40af') : '#64748b',
                                                            fontWeight: 'bold',
                                                            fontSize: '0.9rem',
                                                            cursor: 'pointer',
                                                            transition: 'all 0.2s',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            gap: '0.5rem'
                                                        }}
                                                    >
                                                        {status === 'pago' && <CheckCircle size={16} />}
                                                        {status === 'atrasado' && <AlertCircle size={16} />}
                                                        {status === 'a_vencer' && <Calculator size={16} />}
                                                        {status === 'a_vencer' ? 'A Vencer' : status === 'pago' ? 'Pago' : 'Atrasado'}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'consumo' && (
                            <div style={{ animation: 'fadeIn 0.3s ease' }}>
                                <div style={{ background: '#eff6ff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #bfdbfe', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <h4 style={{ color: '#1e40af', fontWeight: 'bold', marginBottom: '0.25rem' }}>Lançamento Automático</h4>
                                        <p style={{ color: '#3b82f6', fontSize: '0.85rem' }}>Importe a fatura em PDF para preenchimento instantâneo.</p>
                                    </div>
                                    {!invoice && !localInvoiceId && (
                                        <div>
                                            <label htmlFor="pdf-upload" style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.5rem',
                                                padding: '0.85rem 1.5rem',
                                                background: isParsing ? '#f1f5f9' : '#2563eb',
                                                color: 'white',
                                                borderRadius: '10px',
                                                cursor: isParsing ? 'not-allowed' : 'pointer',
                                                fontSize: '0.95rem',
                                                fontWeight: 'bold',
                                                boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
                                                transition: 'all 0.2s'
                                            }}>
                                                {isParsing ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                                                {isParsing ? 'Processando...' : 'Fazer Upload do PDF'}
                                            </label>
                                            <input id="pdf-upload" type="file" accept="application/pdf" onChange={handlePdfUpload} disabled={isParsing} style={{ display: 'none' }} />
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div className="bg-white p-6 rounded-xl border border-slate-200">
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '0.75rem', color: '#475569', fontWeight: 600 }}>
                                            <Zap size={18} className="text-blue-500" /> Consumo (kWh)
                                        </label>
                                        <input type="number" step="any" required value={formData.consumo_kwh} onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })} placeholder="Ex: 450" style={{ width: '100%', padding: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '1.1rem', fontWeight: 'bold' }} />
                                    </div>
                                    <div className="bg-white p-6 rounded-xl border border-slate-200">
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '0.75rem', color: '#475569', fontWeight: 600 }}>
                                            <Calculator size={18} className="text-green-500" /> Consumo Compensado (kWh)
                                        </label>
                                        <input type="number" step="any" value={formData.consumo_compensado} onChange={e => setFormData({ ...formData, consumo_compensado: e.target.value })} placeholder="Ex: 400" style={{ width: '100%', padding: '0.85rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '1.1rem', fontWeight: 'bold' }} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'financeiro' && (
                            <div style={{ animation: 'fadeIn 0.3s ease' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div className="bg-white p-5 rounded-xl border border-slate-200">
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.6rem', color: '#64748b', fontWeight: 600 }}>Iluminação Pública (R$)</label>
                                        <div style={{ position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 'bold', color: '#94a3b8' }}>R$</span>
                                            <input type="text" value={formData.iluminacao_publica.replace('R$', '').trim()} onChange={e => handleCurrencyChange('iluminacao_publica', e.target.value)} placeholder="0,00" style={{ width: '100%', padding: '0.85rem 0.85rem 0.85rem 2.5rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '1rem', fontWeight: 'bold' }} />
                                        </div>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-slate-200">
                                        <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.6rem', color: '#64748b', fontWeight: 600 }}>Outros Lançamentos (R$)</label>
                                        <div style={{ position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 'bold', color: '#94a3b8' }}>R$</span>
                                            <input type="text" value={formData.outros_lancamentos.replace('R$', '').trim()} onChange={e => handleCurrencyChange('outros_lancamentos', e.target.value)} placeholder="0,00" style={{ width: '100%', padding: '0.85rem 0.85rem 0.85rem 2.5rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '1rem', fontWeight: 'bold' }} />
                                        </div>
                                    </div>
                                    
                                    <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 col-span-full">
                                        <h4 style={{ fontSize: '0.9rem', color: '#475569', fontWeight: 'bold', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Calculator size={18} /> Resultados Calculados
                                        </h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                                <p style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>T. Mínima e Excedentes</p>
                                                <p style={{ fontSize: '1.1rem', fontWeight: '800', color: '#1e293b' }}>{formData.tarifa_minima_excedentes}</p>
                                            </div>
                                            <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                                                <p style={{ fontSize: '0.7rem', color: '#166534', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Energia Compensada (Líquida)</p>
                                                <p style={{ fontSize: '1.1rem', fontWeight: '800', color: '#15803d' }}>{formData.energia_compensada_reais}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {(invoice?.id || localInvoiceId) && !invoice?.asaas_boleto_url && subscriberBillingMode === 'individualizada' && (
                                    <div style={{ marginTop: '2rem' }}>
                                        <button
                                            type="button"
                                            onClick={() => handleEmission()}
                                            disabled={generating}
                                            style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
                                                background: '#FF6600', color: 'white', border: 'none', padding: '1rem',
                                                borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem',
                                                width: '100%', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(255, 102, 0, 0.2)'
                                            }}
                                        >
                                            {generating ? <Loader2 className="animate-spin" size={20} /> : <><CreditCard size={20} /> Emitir Boleto via Asaas</>}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'resumo' && (
                            <div style={{ animation: 'fadeIn 0.3s ease' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 550px)', gap: '2rem', justifyContent: 'center' }}>
                                    <div style={{ background: 'white', padding: '2rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px -5px rgba(0,0,0,0.1)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '2px solid #f1f5f9' }}>
                                            <div style={{ padding: '0.5rem', background: '#fff7ed', borderRadius: '10px' }}>
                                                <Calculator size={24} color="#f97316" />
                                            </div>
                                            <div>
                                                <h4 style={{ color: '#1e293b', fontWeight: 800, margin: 0, fontSize: '1.1rem' }}>RESUMO DA FATURA</h4>
                                                <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>Detalhamento financeiro do assinante</p>
                                            </div>
                                        </div>

                                        {selectedUc && (
                                            <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '12px', marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', border: '1px solid #e2e8f0' }}>
                                                <div style={{ gridColumn: '1 / -1' }}>
                                                    <label style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Beneficiário / Unidade Consumidora</label>
                                                    <span style={{ fontWeight: 'bold', color: '#0f172a', fontSize: '1rem' }}>{selectedUc.subscribers?.name || selectedUc.titular_conta}</span>
                                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>UC: {selectedUc.numero_uc}</div>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Período</label>
                                                    <span style={{ fontWeight: 600, color: '#334155' }}>
                                                        {(() => {
                                                            const [y, m] = formData.mes_referencia.split('-');
                                                            const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                                                            return `${months[parseInt(m) - 1]}/${y}`;
                                                        })()}
                                                    </span>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Vencimento Boleto</label>
                                                    <span style={{ fontWeight: 'bold', color: '#2563eb' }}>{formData.vencimento ? new Date(formData.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</span>
                                                </div>
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#475569' }}>
                                                <span>Consumo Total:</span>
                                                <span style={{ fontWeight: 700, color: '#1e293b' }}>{formData.consumo_kwh} kWh</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#475569' }}>
                                                <span>Energia Compensada:</span>
                                                <span style={{ fontWeight: 700, color: '#2563eb' }}>{formData.consumo_compensado} kWh</span>
                                            </div>
                                            
                                            <div style={{ height: '1px', background: '#e2e8f0', margin: '0.4rem 0' }}></div>

                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#475569' }}>
                                                <span>Custo da Energia:</span>
                                                <span style={{ fontWeight: 700, color: '#1e293b' }}>{formData.consumo_reais}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#16a34a', fontWeight: '600' }}>
                                                <span>Economia Gerada:</span>
                                                <span>- {formData.economia_reais}</span>
                                            </div>
                                            
                                            <div style={{ 
                                                marginTop: '0.5rem', padding: '1.25rem', borderRadius: '12px', 
                                                background: '#f0fdf4', border: '1px solid #bbf7d0',
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                            }}>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#166534' }}>VALOR TOTAL FATURA</span>
                                                    <span style={{ fontSize: '0.7rem', color: '#166534', opacity: 0.8 }}>Incluindo taxas e impostos</span>
                                                </div>
                                                <span style={{ fontSize: '1.6rem', fontWeight: 900, color: '#166534' }}>
                                                    {formData.valor_a_pagar}
                                                </span>
                                            </div>

                                            {/* Action Buttons */}
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.5rem' }}>
                                                <button 
                                                    type="button"
                                                    onClick={() => handleDownloadCombined()}
                                                    disabled={isGeneratingPdf}
                                                    style={{ 
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                                        padding: '0.85rem', background: 'white', color: '#475569', fontWeight: 700,
                                                        border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.9rem',
                                                        cursor: isGeneratingPdf ? 'not-allowed' : 'pointer', transition: 'all 0.2s'
                                                    }}
                                                >
                                                    {isGeneratingPdf ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />} Imprimir
                                                </button>

                                                {(invoice?.id || localInvoiceId) && (
                                                    localBoletoUrl ? (
                                                        <a 
                                                            href={localBoletoUrl} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            style={{ 
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                                                padding: '0.85rem', background: '#2563eb', color: 'white', fontWeight: 700,
                                                                borderRadius: '10px', textDecoration: 'none', fontSize: '0.9rem',
                                                                boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)'
                                                            }}
                                                        >
                                                            <CreditCard size={18} /> Pagar Boleto
                                                        </a>
                                                    ) : (
                                                        <button 
                                                            type="button"
                                                            onClick={handleEmission}
                                                            disabled={generating}
                                                            style={{ 
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                                                padding: '0.85rem', background: '#FF6600', color: 'white', fontWeight: 700,
                                                                border: 'none', borderRadius: '10px', fontSize: '0.9rem',
                                                                cursor: generating ? 'not-allowed' : 'pointer',
                                                                boxShadow: '0 4px 6px -1px rgba(255, 102, 0, 0.2)'
                                                            }}
                                                        >
                                                            {generating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Emitir Boleto
                                                        </button>
                                                    )
                                                )}
                                            </div>

                                            {/* Original Document Link - Move to Footer style icon */}
                                            {invoice?.concessionaria_pdf_url && (
                                                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                                                    <a 
                                                        href={invoice.concessionaria_pdf_url} 
                                                        target="_blank" 
                                                        rel="noreferrer"
                                                        style={{ 
                                                            fontSize: '0.8rem', color: '#64748b', textDecoration: 'none', 
                                                            display: 'inline-flex', alignItems: 'center', gap: '0.4rem'
                                                        }}
                                                    >
                                                        <FileText size={14} /> Ver Conta da Concessionária
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e2e8f0' }}>
                        <div>
                            {invoice?.id && invoice.status !== 'cancelado' && canManageStatus && (
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    disabled={loading}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                        background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca',
                                        padding: '0.6rem 1rem', borderRadius: '6px', cursor: 'pointer',
                                        fontWeight: 'bold', fontSize: '0.9rem', marginLeft: localBoletoUrl ? '1rem' : 0,
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={e => { e.currentTarget.style.background = '#fecaca'; }}
                                    onMouseOut={e => { e.currentTarget.style.background = '#fee2e2'; }}
                                >
                                    <Ban size={18} /> Cancelar Fatura
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={onClose} style={{ padding: '0.8rem 1.5rem', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', color: '#475569', fontWeight: 600 }}>Cancelar</button>
                            <button type="submit" disabled={loading} style={{ padding: '0.8rem 2rem', background: 'var(--color-blue)', color: 'white', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}>
                                {loading ? 'Salvando...' : 'Salvar Fatura'}
                            </button>
                        </div>
                    </div>

                </form>
            </div>

            {/* Duplicate Safety Modal */}
            {showDuplicateModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, backdropFilter: 'blur(8px)' }}>
                    <div style={{ background: 'white', borderRadius: '24px', padding: '2rem', width: '90%', maxWidth: '450px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', textAlign: 'center' }}>
                        <div style={{ background: '#fff7ed', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: '#f97316' }}>
                            <AlertCircle size={32} />
                        </div>

                        <h3 style={{ fontSize: '1.4rem', color: '#1e293b', fontWeight: 'bold', marginBottom: '1rem' }}>
                            {duplicateInfo?.type === 'block' ? 'Fatura Já Existente' : 'Fatura Detectada'}
                        </h3>

                        <p style={{ color: '#64748b', marginBottom: '2rem', lineHeight: '1.5' }}>
                            {duplicateInfo?.type === 'block'
                                ? `Já existe uma fatura emitida para esta UC com mês de referência ${formData.mes_referencia} e vencimento em ${new Date(duplicateInfo.existing.vencimento).toLocaleDateString('pt-BR')}.`
                                : `Já existe uma fatura para o mês de referência ${formData.mes_referencia}, porém com uma data de vencimento diferente. O que deseja fazer?`
                            }
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                            {duplicateInfo?.type === 'block' ? (
                                <button
                                    onClick={() => setShowDuplicateModal(false)}
                                    style={{ padding: '1rem', background: '#f1f5f9', color: '#475569', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                                >
                                    Entendido
                                </button>
                            ) : (
                                <>
                                    <button
                                        onClick={() => { setShowDuplicateModal(false); handleSubmit(null, 'new'); }}
                                        style={{ padding: '1rem', background: 'var(--color-blue)', color: 'white', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        Emitir Nova Fatura
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowDuplicateModal(false);
                                            handleSubmit(null, 'update');
                                        }}
                                        style={{ padding: '1rem', background: '#fff7ed', color: '#c2410c', borderRadius: '12px', border: '1px solid #ffedd5', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        Ajustar Data de Vencimento
                                    </button>
                                    <button
                                        onClick={() => setShowDuplicateModal(false)}
                                        style={{ padding: '1rem', background: 'white', color: '#64748b', borderRadius: '12px', border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: '600' }}
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
