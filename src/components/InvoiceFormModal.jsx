import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CreditCard, FileText, Calculator, DollarSign, Lightbulb, Zap, AlertCircle, Ban, CheckCircle } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { createAsaasCharge, cancelAsaasCharge, updateAsaasCharge, parseInvoice, mergePdf } from '../lib/api';
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
    const [invoiceToDownload, setInvoiceToDownload] = useState(null);
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
                status: invoice.status || 'a_vencer'
            });
            // Find UC to set tariff info
            if (ucs) {
                const uc = ucs.find(u => u.id === invoice.uc_id);
                setSelectedUc(uc);
            }
        } else if (ucs && ucs.length > 0) {
            setFormData(prev => ({ ...prev, uc_id: ucs[0].id }));
            setSelectedUc(ucs[0]);
        }
    }, [invoice, ucs]);

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

    const handleDownloadCombined = async (invToUse) => {
        const inv = invToUse || invoice;
        if (!inv || (!inv.asaas_payment_id && !inv.asaas_boleto_url)) {
            showAlert('Boleto não disponível para esta fatura.', 'warning');
            return;
        }

        setIsGeneratingPdf(true);
        setInvoiceToDownload(inv);

        try {
            await new Promise(resolve => setTimeout(resolve, 600));

            const element = hiddenRef.current;
            if (!element) throw new Error("Elemento de captura não encontrado");

            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: "#f8fafc"
            });

            const imgData = canvas.toDataURL('image/png');
            const pdfSummary = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdfSummary.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdfSummary.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

            const summaryBase64 = pdfSummary.output('datauristring');
            const asaasUrl = inv.asaas_boleto_url;
            if (!asaasUrl) throw new Error("URL do boleto não encontrada");

            const fileName = `Fatura_${inv.mes_referencia}_Detalhamento.pdf`;

            await mergePdf(summaryBase64, asaasUrl, fileName);
            showAlert('PDF gerado com sucesso!', 'success');

        } catch (error) {
            console.error("Error generating combined PDF:", error);
            showAlert('Erro ao gerar PDF combinado.', 'error');
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
                        if (data.iluminacao_publica) newFormData.iluminacao_publica = formatCurrency(data.iluminacao_publica);
                        if (data.outros_lancamentos) newFormData.outros_lancamentos = formatCurrency(data.outros_lancamentos);
                        
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

        const confirmed = await showConfirm(
            'Deseja gerar o boleto Asaas agora para esta fatura?',
            'Emitir Boleto',
            'Gerar Boleto',
            'Cancelar'
        );

        if (!confirmed) return;

        setGenerating(true);
        try {
            const targetId = localInvoiceId || invoice?.id;
            const result = await createAsaasCharge(targetId);
            if (result.url) {
                setShowSuccess(true);
                setTimeout(() => setShowSuccess(false), 3000);
                window.open(result.url, '_blank');
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
                economia_reais: economiaReais,
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
                        await updateAsaasCharge(targetId, payload.valor_a_pagar, payload.vencimento);
                    } catch (syncError) {
                        console.error('Erro ao sincronizar com Asaas:', syncError);
                        // Opcional: Avisar o usuário que salvou local mas falhou no Asaas
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
                        <h3 style={{ fontSize: '1.25rem', color: '#1e293b', fontWeight: 'bold' }}>{(invoice || localInvoiceId) ? 'Editar Fatura' : 'Gerar Fatura'}</h3>
                        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Após processamento da Conta de Energia Concessionária</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>

                    {/* UC Selection & PDF Import */}
                    <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-end', gap: '1rem' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Unidade Consumidora</label>
                            <select
                                required
                                value={formData.uc_id}
                                onChange={e => setFormData({ ...formData, uc_id: e.target.value })}
                                disabled={!!(invoice || localInvoiceId)}
                                style={{ width: '100%', padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.95rem', background: 'white' }}
                            >
                                <option value="">Selecione a UC...</option>
                                {ucs && ucs.map(uc => (
                                    <option key={uc.id} value={uc.id}>{uc.numero_uc} - {uc.titular_conta}</option>
                                ))}
                            </select>
                        </div>

                        {!invoice && !localInvoiceId && (
                            <div>
                                <label htmlFor="pdf-upload" style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.7rem 1.2rem',
                                    background: isParsing ? '#f1f5f9' : '#ebf5ff',
                                    color: isParsing ? '#94a3b8' : '#2563eb',
                                    borderRadius: '6px',
                                    cursor: isParsing ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: 'bold',
                                    border: '1px dashed #2563eb',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {isParsing ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                                    {isParsing ? 'Processando...' : 'Lançamento via PDF'}
                                </label>
                                <input 
                                    id="pdf-upload"
                                    type="file" 
                                    accept="application/pdf"
                                    onChange={handlePdfUpload}
                                    disabled={isParsing}
                                    style={{ display: 'none' }} 
                                />
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                        {/* Month/Year */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Mês Referência</label>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <select value={formData.mes_referencia.split('-')[1]} onChange={e => handleMonthChange('month', e.target.value)} style={{ flex: 1, padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                                    {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => <option key={m} value={m}>{['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i]}</option>)}
                                </select>
                                <select value={formData.mes_referencia.split('-')[0]} onChange={e => handleMonthChange('year', e.target.value)} style={{ width: '80px', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                        </div>
                        {/* Reading Date */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Data da Leitura</label>
                            <input type="date" value={formData.data_leitura} onChange={e => setFormData({ ...formData, data_leitura: e.target.value })} style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        {/* Due Date */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Vencimento</label>
                            <input type="date" required value={formData.vencimento} onChange={e => setFormData({ ...formData, vencimento: e.target.value })} style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        {/* Status */}
                        {canManageStatus && (
                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.4rem', color: '#475569', fontWeight: 600 }}>Status</label>
                                <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                                    <option value="a_vencer">A Vencer</option>
                                    <option value="pago">Pago</option>
                                    <option value="atrasado">Atrasado</option>
                                </select>
                            </div>
                        )}
                    </div>

                    <div style={{ height: '1px', background: '#e2e8f0', margin: '1rem 0' }}></div>

                    {/* Data Entry Section */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>

                        {/* Left Column: Inputs */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <h4 style={{ color: '#334155', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Zap size={18} /> Dados de Consumo</h4>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Consumo (kWh)</label>
                                <input type="number" step="any" required value={formData.consumo_kwh} onChange={e => setFormData({ ...formData, consumo_kwh: e.target.value })} placeholder="0" style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Consumo Compensado (kWh)</label>
                                <input type="number" step="any" value={formData.consumo_compensado} onChange={e => setFormData({ ...formData, consumo_compensado: e.target.value })} style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                            </div>

                            <h4 style={{ color: '#334155', fontWeight: 'bold', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><DollarSign size={18} /> Valores de energia e Adicionais</h4>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Energia Compensada (R$)</label>
                                <input type="text" readOnly value={formData.energia_compensada_reais} style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', color: '#0f172a', fontWeight: 600 }} />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Iluminação Pública (R$)</label>
                                <input type="text" value={formData.iluminacao_publica} onChange={e => handleCurrencyChange('iluminacao_publica', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Tarifa Mínima e Excedentes (R$)</label>
                                <input type="text" readOnly value={formData.tarifa_minima_excedentes} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc' }} />
                                <p style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.2rem' }}>Calculado: (Consumo - Compensado) * Tarifa</p>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#64748b' }}>Outros Lançamentos (R$)</label>
                                <input type="text" value={formData.outros_lancamentos} onChange={e => handleCurrencyChange('outros_lancamentos', e.target.value)} placeholder="R$ 0,00" style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                            </div>

                            {(invoice?.id || localInvoiceId) && !invoice?.asaas_boleto_url && subscriberBillingMode === 'individualizada' && (
                                <div style={{ marginTop: '0.5rem' }}>
                                    <button
                                        type="button"
                                        onClick={() => handleEmission()}
                                        disabled={generating}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.5rem',
                                            background: '#FF6600',
                                            color: 'white',
                                            border: 'none',
                                            padding: '0.8rem 1rem',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontWeight: 'bold',
                                            fontSize: '0.9rem',
                                            width: '100%',
                                            transition: 'all 0.2s',
                                            boxShadow: '0 4px 6px -1px rgba(255, 102, 0, 0.2)'
                                        }}
                                        onMouseOver={e => { e.currentTarget.style.background = '#e65c00'; }}
                                        onMouseOut={e => { e.currentTarget.style.background = '#FF6600'; }}
                                    >
                                        {generating ? 'Gerando...' : <><CreditCard size={18} /> Emitir Boleto Agora</>}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Right Column: Calculated Results */}
                        <div style={{ background: '#f1f5f9', padding: '1.5rem', borderRadius: '8px', border: '1px solid #e2e8f0', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                            <h4 style={{ color: '#334155', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Calculator size={18} /> Detalhamento da Fatura</h4>

                            {selectedUc && (
                                <div style={{ background: '#003366', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', border: '1px solid #002244' }}>
                                    <div style={{ gridColumn: '1 / -1', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', marginBottom: '0.2rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>Assinante</label>
                                        <span style={{ fontWeight: 'bold', color: '#ffffff', fontSize: '0.95rem' }}>{selectedUc.subscribers?.name || selectedUc.titular_fatura?.name || 'Não Inf.'}</span>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>Número da UC</label>
                                        <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.85rem' }}>{selectedUc.numero_uc}</span>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>Identificação</label>
                                        <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.85rem' }}>{selectedUc.titular_conta}</span>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>Mês Referência</label>
                                        <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.85rem' }}>
                                            {(() => {
                                                const [y, m] = formData.mes_referencia.split('-');
                                                const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                                                return `${months[parseInt(m) - 1]}/${y}`;
                                            })()}
                                        </span>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>Vencimento</label>
                                        <span style={{ fontWeight: 'bold', color: '#ff8a8a', fontSize: '0.85rem' }}>
                                            {formData.vencimento ? new Date(formData.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}
                                        </span>
                                    </div>
                                    <div style={{ gridColumn: '1 / -1', marginTop: '0.2rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>Tipo de Ligação</span>
                                            <span style={{ background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', color: '#ffffff', textTransform: 'capitalize' }}>{selectedUc.tipo_ligacao}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: '#64748b' }}>Consumo Compensado ({formData.consumo_compensado || 0} kWh):</span>
                                    <span style={{ fontWeight: 600 }}>R$ {(Number(formData.consumo_compensado || 0) * (Number(selectedUc?.tarifa_concessionaria) || 0)).toFixed(2).replace('.', ',')}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginTop: '-0.4rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem' }}>
                                    <span>Valor da Tarifa:</span>
                                    <span>R$ {Number(selectedUc?.tarifa_concessionaria || 0).toFixed(4).replace('.', ',')}</span>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                                    <span style={{ color: '#64748b', fontWeight: 600 }}>Custo da Energia Compensada (Líquida):</span>
                                    <span style={{ fontWeight: 'bold', color: '#0f172a' }}>
                                        {(() => {
                                            const rawConsumoCompensado = Number(formData.consumo_compensado) || 0;
                                            const rawTarifa = Number(selectedUc?.tarifa_concessionaria) || 0;
                                            const descontoPercent = Number(selectedUc?.desconto_assinante) || 0;
                                            const multiplier = descontoPercent > 1 ? descontoPercent / 100 : descontoPercent;
                                            const energiaCompensadaReais = rawConsumoCompensado * rawTarifa * (1 - multiplier);
                                            return formatCurrency(energiaCompensadaReais);
                                        })()}
                                    </span>
                                </div>

                                <div style={{ height: '1px', background: '#cbd5e1', margin: '0.5rem 0' }}></div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: '#64748b' }}>+ Iluminação Pública:</span>
                                    <span>{formData.iluminacao_publica || 'R$ 0,00'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: '#64748b' }}>+ Tarifa Mínima e Excedentes:</span>
                                    <span>{formData.tarifa_minima_excedentes || 'R$ 0,00'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                    <span style={{ color: '#64748b' }}>+ Outros Lançamentos:</span>
                                    <span>{formData.outros_lancamentos || 'R$ 0,00'}</span>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', background: '#dcfce7', padding: '0.6rem', borderRadius: '6px', border: '1px solid #bbf7d0', margin: '0.5rem 0' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#166534' }}>
                                        <span style={{ fontWeight: 600 }}>Economia Gerada:</span>
                                        <span style={{ fontWeight: 'bold' }}>
                                            - {(() => {
                                                const rawConsumoCompensado = Number(formData.consumo_compensado) || 0;
                                                const rawTarifa = Number(selectedUc?.tarifa_concessionaria) || 0;
                                                const descontoPercent = Number(selectedUc?.desconto_assinante) || 0;
                                                const multiplier = descontoPercent > 1 ? descontoPercent / 100 : descontoPercent;
                                                const economiaReais = rawConsumoCompensado * rawTarifa * multiplier;
                                                return formatCurrency(economiaReais);
                                            })()}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#15803d' }}>
                                        <span>Desconto Aplicado:</span>
                                        <span>{selectedUc?.desconto_assinante || 0}%</span>
                                    </div>
                                </div>

                                <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
                                    <div style={{
                                        marginLeft: 'auto',
                                        width: 'fit-content',
                                        padding: '1rem',
                                        background: '#f0fdf4',
                                        border: '2px solid #22c55e',
                                        borderRadius: '12px',
                                        textAlign: 'right'
                                    }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', color: '#166534', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Valor Total da Fatura CRM</label>
                                        <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#14532d' }}>
                                            {(() => {
                                                const rawConsumo = Number(formData.consumo_kwh) || 0;
                                                const rawCompensado = Number(formData.consumo_compensado) || 0;
                                                const rawTarifa = Number(selectedUc?.tarifa_concessionaria) || 0;
                                                const descontoPercent = Number(selectedUc?.desconto_assinante) || 0;
                                                const multiplier = descontoPercent > 1 ? descontoPercent / 100 : descontoPercent;
                                                
                                                const compensadaLiquida = rawCompensado * rawTarifa * (1 - multiplier);
                                                const tarifaMinimaExcedentes = Math.max(0, (rawConsumo - rawCompensado) * rawTarifa);
                                                const ip = parseCurrency(formData.iluminacao_publica);
                                                const outros = parseCurrency(formData.outros_lancamentos);
                                                
                                                const totalCalculado = compensadaLiquida + tarifaMinimaExcedentes + ip + outros;
                                                return formatCurrency(totalCalculado);
                                            })()}
                                        </div>
                                    </div>
                                </div>

                                {(invoice?.asaas_boleto_url || invoice?.concessionaria_pdf_url) && (
                                    <div style={{ 
                                        marginTop: '1.5rem', 
                                        padding: '1rem', 
                                        background: 'white', 
                                        borderRadius: '12px', 
                                        border: '1px solid #e2e8f0', 
                                        display: 'flex', 
                                        justifyContent: 'center', 
                                        gap: '1.5rem', 
                                        flexWrap: 'wrap',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                                    }}>
                                        {invoice?.asaas_boleto_url && (
                                            <a href={invoice.asaas_boleto_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#1e40af', fontWeight: 'bold', textDecoration: 'none', fontSize: '0.9rem', transition: 'opacity 0.2s' }}>
                                                <CreditCard size={18} /> Ver Boleto
                                            </a>
                                        )}

                                        {invoice?.concessionaria_pdf_url && (
                                            <a href={invoice.concessionaria_pdf_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: branding?.primary_color || '#003366', fontWeight: 'bold', textDecoration: 'none', fontSize: '0.9rem', transition: 'opacity 0.2s' }}>
                                                <FileText size={18} /> Fatura Concessionária
                                            </a>
                                        )}
                                        
                                        {invoice?.asaas_boleto_url && (
                                            <button
                                                type="button"
                                                onClick={() => handleDownloadCombined()}
                                                disabled={isGeneratingPdf}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.6rem',
                                                    color: '#ff6600',
                                                    fontWeight: 'bold',
                                                    border: 'none',
                                                    background: 'none',
                                                    cursor: isGeneratingPdf ? 'not-allowed' : 'pointer',
                                                    fontSize: '0.9rem',
                                                    transition: 'opacity 0.2s'
                                                }}
                                            >
                                                {isGeneratingPdf ? <Loader2 size={18} className="spin-animation" /> : <Download size={18} />}
                                                Download PDF Combinado
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
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
                                        fontWeight: 'bold', fontSize: '0.9rem', marginLeft: invoice.asaas_boleto_url ? '1rem' : 0,
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
