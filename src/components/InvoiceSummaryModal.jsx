import React, { useState, useEffect } from 'react';
import { X, FileText, CreditCard, ExternalLink, Info, CheckCircle2, AlertCircle, Pencil, Trash2, Save, RotateCcw, Clock, Loader2, Search, Link as LinkIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createAsaasCharge, cancelAsaasCharge, mergePdf, sendCombinedNotification } from '../lib/api';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import './InvoicesModal.css';

import { useBranding } from '../contexts/BrandingContext';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';

const energyStatusColors = { 
    'a_vencer': { color: '#2563eb', bg: '#eff6ff', label: 'A Vencer' }, 
    'inconsistente': { color: '#ea580c', bg: '#ffedd5', label: 'Inconsistente' },
    'contestada': { color: '#7c3aed', bg: '#f3e8ff', label: 'Contestada' },
    'parcelada': { color: '#ca8a04', bg: '#fef9c3', label: 'Parcelada' }, 
    'atrasada': { color: '#dc2626', bg: '#fee2e2', label: 'Atrasada' },
    'pago': { color: '#166534', bg: '#dcfce7', label: 'Paga' }
};

const getEnergyStatus = (inv) => {
    const ebStatus = inv.energy_bill_status || 'pendente';
    const today = new Date();
    today.setHours(0,0,0,0);
    const dueDate = (inv.vencimento_concessionaria || inv.vencimento) ? new Date(inv.vencimento_concessionaria || inv.vencimento) : null;
    const isPastDue = dueDate && dueDate < today;

    if (ebStatus === 'pendente') {
        return isPastDue ? 'atrasada' : 'a_vencer';
    }
    return ebStatus;
};

export default function InvoiceSummaryModal({ invoice, consumerUnit, onClose, onPaymentSuccess, onViewInvoice }) {
    const { branding } = useBranding();
    const { showAlert, showConfirm } = useUI();
    const { profile } = useAuth();
    const [loading, setLoading] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [energyStatus, setEnergyStatus] = useState(invoice?.energy_bill_status || 'pendente');

    const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'error'
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState(null);

    const hiddenRef = React.useRef(null);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const [invoiceToDownload, setInvoiceToDownload] = useState(null);

    const [childInvoices, setChildInvoices] = useState([]);
    const [loadingChildren, setLoadingChildren] = useState(false);
    const [searchChild, setSearchChild] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearchingChild, setIsSearchingChild] = useState(false);
    const [subscriberBillingMode, setSubscriberBillingMode] = useState('individualizada');

    useEffect(() => {
        if (!invoice) return;
        
        const fetchBillingMode = async () => {
            if (consumerUnit?.subscriber_id) {
                const { data } = await supabase
                    .from('subscribers')
                    .select('billing_mode')
                    .eq('id', consumerUnit.subscriber_id)
                    .single();
                if (data?.billing_mode) {
                    setSubscriberBillingMode(data.billing_mode);
                }
            }
        };
        fetchBillingMode();

        const fetchChildren = async () => {
            setLoadingChildren(true);
            try {
                const { data, error } = await supabase
                    .from('invoices')
                    .select('*, consumer_units(*)')
                    .eq('parent_invoice_id', invoice.id);
                if (error) throw error;
                setChildInvoices(data || []);
            } catch (err) {
                console.error('Error fetching children:', err);
            } finally {
                setLoadingChildren(false);
            }
        };
        fetchChildren();
    }, [invoice]);

    const handleSearchChild = async () => {
        if (!searchChild.trim()) return;
        setIsSearchingChild(true);
        try {
            let formattedSearch = searchChild.trim();
            if (formattedSearch.includes('/')) {
                const [month, year] = formattedSearch.split('/');
                if (month && year) formattedSearch = `${year}-${month}`;
            }

            const { data, error } = await supabase
                .from('invoices')
                .select('id, mes_referencia, vencimento, vencimento_concessionaria, valor_concessionaria, status, energy_bill_status, parent_invoice_id')
                .eq('uc_id', invoice.uc_id)
                .is('parent_invoice_id', null)
                .neq('id', invoice.id)
                .like('mes_referencia', `${formattedSearch}%`);
            
            if (error) throw error;
            setSearchResults(data || []);
            if (data?.length === 0) {
                showAlert('Nenhuma conta encontrada ou já vinculada.', 'info');
            }
        } catch (err) {
            console.error(err);
            showAlert('Erro na busca', 'error');
        } finally {
            setIsSearchingChild(false);
        }
    };

    const handleLinkChild = async (childId) => {
        try {
            const { error } = await supabase
                .from('invoices')
                .update({ parent_invoice_id: invoice.id })
                .eq('id', childId);
            if (error) throw error;
            showAlert('Conta vinculada com sucesso.', 'success');
            
            const linkedChild = searchResults.find(c => c.id === childId);
            setChildInvoices([...childInvoices, linkedChild]);
            setSearchResults(searchResults.filter(c => c.id !== childId));
            setSearchChild('');
        } catch (err) {
            console.error(err);
            showAlert('Erro ao vincular', 'error');
        }
    };

    const handleUnlinkChild = async (childId) => {
        if (!await showConfirm('Deseja realmente desvincular esta conta?')) return;
        try {
            const { error } = await supabase
                .from('invoices')
                .update({ parent_invoice_id: null })
                .eq('id', childId);
            if (error) throw error;
            showAlert('Conta desvinculada com sucesso.', 'success');
            setChildInvoices(childInvoices.filter(c => c.id !== childId));
        } catch (err) {
            console.error(err);
            showAlert('Erro ao desvincular', 'error');
        }
    };

    if (!invoice) return null;

    const formatCurrency = (val) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);
    };

    const handleViewPdf = () => {
        if (invoice.concessionaria_pdf_url) {
            window.open(invoice.concessionaria_pdf_url, '_blank');
        } else {
            showAlert('PDF da concessionária não disponível para esta fatura.', 'warning');
        }
    };

    const handlePay = async () => {
        const utilityValue = Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0));

        const confirmed = await showConfirm(`Deseja pagar a conta de energia da concessionária no valor de ${formatCurrency(utilityValue)}?`, 'Confirmar Pagamento');
        if (!confirmed) return;

        setLoading(true);
        setPaymentStatus(null);

        try {
            const { data, error } = await supabase.functions.invoke('pay-asaas-bill', {
                body: {
                    identification: invoice.linha_digitavel,
                    value: utilityValue,
                    description: `Pagamento Conta Energia - ${consumerUnit?.titular_conta || 'UC'}`,
                    scheduleDate: null,
                    dueDate: invoice.vencimento_concessionaria || invoice.vencimento
                }
            });

            if (error) throw error;

            if (data?.data?.id || data?.success) {
                // Update local status - IMPORTANT: Also update energy_bill_status to 'pago'
                const { error: updateError } = await supabase
                    .from('invoices')
                    .update({ 
                        status: 'pago', 
                        asaas_status: 'PAID',
                        energy_bill_status: 'pago' 
                    })
                    .eq('id', invoice.id);

                if (updateError) throw updateError;

                // Registrar liquidação no Ledger (Livro Razão)
                const { error: ledgerError } = await supabase.rpc('liquidate_concessionaria_payment', {
                    p_invoice_id: invoice.id,
                    p_amount: utilityValue
                });

                if (ledgerError) {
                    console.error('Erro ao registrar no ledger:', ledgerError);
                    showAlert('Pagamento concluído, mas houve um erro ao registrar no Livro Razão.', 'warning');
                }

                setEnergyStatus('pago');
                setPaymentStatus('success');
                if (onPaymentSuccess) onPaymentSuccess();
                
                setTimeout(() => {
                    onClose();
                }, 3000);
            } else {
                throw new Error(data?.message || 'Falha ao processar pagamento');
            }

        } catch (error) {
            console.error('Erro no pagamento:', error);
            setPaymentStatus('error');
            showAlert(`Falha no pagamento: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateEnergyStatus = async (newStatus) => {
        if (updatingStatus) return;
        setUpdatingStatus(true);
        try {
            const { error } = await supabase
                .from('invoices')
                .update({ energy_bill_status: newStatus })
                .eq('id', invoice.id);

            if (error) throw error;
            setEnergyStatus(newStatus);
            if (onPaymentSuccess) onPaymentSuccess();
            showAlert('Status da conta atualizado com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao atualizar status da conta:', error);
            showAlert('Erro ao atualizar status: ' + error.message, 'error');
        } finally {
            setUpdatingStatus(false);
        }
    };

    const getBoletoDueDate = () => {
        const refMonth = invoice.mes_referencia; // e.g. "2026-04-01"
        const dueDay = consumerUnit?.dia_vencimento; // e.g. 5
        
        if (!refMonth || !dueDay) {
            return invoice.vencimento || new Date().toISOString().split('T')[0];
        }
        
        const [yStr, mStr] = refMonth.split('-');
        let year = parseInt(yStr, 10);
        let month = parseInt(mStr, 10);
        
        let nextMonth = month + 1;
        let nextYear = year;
        if (nextMonth > 12) {
            nextMonth = 1;
            nextYear = year + 1;
        }
        
        const formattedDay = String(dueDay).padStart(2, '0');
        let formattedMonth = String(nextMonth).padStart(2, '0');
        
        let calculatedDateStr = `${nextYear}-${formattedMonth}-${formattedDay}`; // YYYY-MM-DD
        
        // Evitar retroatividade: Se a data calculada for menor que hoje, avança para o próximo mês
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const calculatedDate = new Date(calculatedDateStr + 'T12:00:00');
        
        if (calculatedDate < today) {
            nextMonth += 1;
            if (nextMonth > 12) {
                nextMonth = 1;
                nextYear += 1;
            }
            formattedMonth = String(nextMonth).padStart(2, '0');
            calculatedDateStr = `${nextYear}-${formattedMonth}-${formattedDay}`;
        }
        
        return calculatedDateStr; // YYYY-MM-DD
    };

    const handleDownloadCombined = async (invToUse, forcedBoletoUrl = null, forceRegenerate = false) => {
        const inv = invToUse || invoice;
        const currentBoletoUrl = forcedBoletoUrl || invoice.asaas_boleto_url; 
        
        if (!inv || !currentBoletoUrl) {
            showAlert('Boleto não disponível para esta fatura.', 'warning');
            return null;
        }

        setIsGeneratingPdf(true);
        setInvoiceToDownload(inv);
        console.log('Generating Combined PDF for invoice:', inv.id);

        try {
            const monthYear = inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
            const cleanName = (consumerUnit?.titular_conta || 'Fatura').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
            const ucNumber = consumerUnit?.numero_uc || '';
            const fileName = `Fatura_${cleanName}_${ucNumber}_${monthYear}.pdf`;

            // OTIMIZAÇÃO: Tentar baixar direto do Storage se já existir
            const isRawAsaas = inv.asaas_pdf_storage_url?.includes('bankSlipUrl') || 
                              inv.asaas_pdf_storage_url?.includes('invoiceUrl') ||
                              inv.asaas_pdf_storage_url?.includes('asaas.com');
            
            if (inv.asaas_pdf_storage_url && !isRawAsaas && !forceRegenerate) {
                console.log("Obtendo URL assinada para PDF individual...");
                const { data: signedData, error: signedError } = await supabase.storage
                    .from('invoices_pdfs')
                    .createSignedUrl(`${inv.id}.pdf`, 60);

                if (!signedError && signedData?.signedUrl) {
                    // Se estivermos gerando para notificação, precisamos do blob
                    const { data: fileBlob } = await supabase.storage.from('invoices_pdfs').download(`${inv.id}.pdf`);
                    return fileBlob;
                }
            }

            // Fallback: Gerar novo - Wait for DOM with retry
            let element = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                element = hiddenRef.current;
                if (element && element.querySelector && element.innerHTML.length > 100) break;
                console.log(`Aguardando hiddenRef render (tentativa ${attempt + 1}/10)...`);
            }
            if (!element || element.innerHTML.length < 100) {
                console.error("Ref hiddenRef ainda é null após tentativas no Modal de Fatura Individual.");
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
            const mergedBlob = await mergePdf(summaryBase64, asaasUrl, fileName, inv.concessionaria_pdf_url, inv.asaas_pdf_storage_url);

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
                    
                    const authenticatedUrl = publicUrl.replace('/public/', '/authenticated/');

                    await supabase
                        .from('invoices')
                        .update({ asaas_pdf_storage_url: authenticatedUrl })
                        .eq('id', inv.id);
                        
                    console.log("Storage e Banco de Dados atualizados para PDF Individual (Modal Fatura).");
                }
            } catch (storageErr) {
                console.warn("Erro ao processar persistência no Storage:", storageErr);
            }

            return mergedBlob;
        } catch (error) {
            console.error('Erro ao gerar PDF combinado:', error);
            return null;
        } finally {
            setIsGeneratingPdf(false);
            setInvoiceToDownload(null);
        }
    };

    const handleGenerateBilling = async () => {
        const boletoDueDate = getBoletoDueDate();
        const formattedBoletoDueDate = new Date(boletoDueDate + 'T12:00:00').toLocaleDateString('pt-BR');

        const confirmed = await showConfirm(
            `Deseja gerar faturamento e emitir cobrança (Asaas) para esta conta no valor de ${formatCurrency(invoice.valor_a_pagar)} com vencimento do boleto em ${formattedBoletoDueDate}?`, 
            'Gerar Faturamento'
        );
        if (!confirmed) return;

        setLoading(true);
        try {
            const result = await createAsaasCharge(invoice.id, 'invoice', { dueDate: boletoDueDate });

            if (!result.success && !result.url) {
                throw new Error('Falha ao gerar cobrança no Asaas.');
            }

            const { error: updateError } = await supabase
                .from('invoices')
                .update({ 
                    status: 'a_vencer',
                    asaas_boleto_url: result.url || null,
                    asaas_status: 'PENDING'
                })
                .eq('id', invoice.id);

            if (updateError) throw updateError;

            // Let's resolve the subscriber phone/email robustly on-demand!
            let subEmail = consumerUnit?.subscribers?.email;
            let subPhone = consumerUnit?.subscribers?.phone;
            let subName = consumerUnit?.subscribers?.name;
            let subId = consumerUnit?.subscribers?.id;

            if (!subEmail || !subPhone || !subId) {
                console.log("Resolvendo dados do Assinante sob demanda no Modal Resumo...");
                try {
                    const { data: ucData } = await supabase
                        .from('consumer_units')
                        .select('id, subscriber_id, subscribers!consumer_units_subscriber_id_fkey(id, name, email, phone)')
                        .eq('id', invoice.uc_id || consumerUnit?.id)
                        .single();
                    
                    if (ucData?.subscribers) {
                        subEmail = ucData.subscribers.email;
                        subPhone = ucData.subscribers.phone;
                        subName = ucData.subscribers.name;
                        subId = ucData.subscribers.id;
                        console.log("Dados resolvidos sob demanda com sucesso:", subName, subEmail, subPhone);
                    }
                } catch (resolveErr) {
                    console.error("Erro ao resolver dados do assinante:", resolveErr);
                }
            }

            // 2. Chamar o merger de PDF e as notificações automáticas
            const monthYear = invoice.mes_referencia ? invoice.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
            const cleanName = (subName || consumerUnit?.titular_conta || 'Fatura').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
            const ucNumber = consumerUnit?.numero_uc || '';
            const fileName = `Fatura_${cleanName}_${ucNumber}_${monthYear}.pdf`;

            // Construct a finalized invoice object copy with updated status and vencimento so the PDF details are rendered correctly!
            const updatedInvoiceForPdf = {
                ...invoice,
                status: 'a_vencer',
                vencimento: boletoDueDate,
                asaas_boleto_url: result.url || null,
                asaas_status: 'PENDING'
            };
            const pdfBlob = await handleDownloadCombined(updatedInvoiceForPdf, result.url, true);
            
            if (pdfBlob) {
                await sendCombinedNotification({
                    recipientEmail: subEmail,
                    recipientPhone: subPhone,
                    subscriberName: subName || consumerUnit?.titular_conta || 'Assinante',
                    dueDate: formattedBoletoDueDate,
                    value: Number(invoice.valor_a_pagar).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                    pdfBlob: pdfBlob,
                    fileName: fileName,
                    subscriberId: subId,
                    ucId: invoice.uc_id,
                    profileId: profile?.id
                });
                showAlert('Faturamento gerado, PDF combinado mesclado e notificações enviadas com sucesso!', 'success');
            } else {
                showAlert('Faturamento gerado com sucesso, mas houve um problema ao gerar o PDF combinado para envio.', 'warning');
            }

            if (result.url) {
                window.open(result.url, '_blank');
            }
            if (onPaymentSuccess) onPaymentSuccess();
            onClose();

        } catch (error) {
            console.error('Erro ao gerar faturamento:', error);
            showAlert(`Falha ao gerar faturamento: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleEdit = () => {
        if (isEditing) {
            setIsEditing(false);
            setEditData(null);
        } else {
            setEditData({
                mes_referencia: invoice.mes_referencia ? invoice.mes_referencia.substring(0, 7) : '',
                vencimento: invoice.vencimento || '',
                vencimento_concessionaria: invoice.vencimento_concessionaria || invoice.vencimento || '',
                data_leitura_anterior: invoice.data_leitura_anterior || '',
                data_leitura: invoice.data_leitura || '',
                consumo_kwh: invoice.consumo_kwh || 0,
                energia_injetada: invoice.energia_injetada || 0,
                consumo_compensado: invoice.consumo_compensado || 0,
                consumo_reais: invoice.consumo_reais || 0,
                iluminacao_publica: invoice.iluminacao_publica || 0,
                tarifa_minima: invoice.tarifa_minima || 0,
                outros_lancamentos: invoice.outros_lancamentos || 0,
                valor_concessionaria: invoice.valor_concessionaria || 0,
                valor_a_pagar: invoice.valor_a_pagar || 0
            });
            setIsEditing(true);
        }
    };

    const handleEditChange = (field, value) => {
        const newData = { ...editData, [field]: value };
        
        if (field === 'vencimento_concessionaria') {
            if (['sem_faturamento', 'ag_emissao_boleto'].includes(invoice.status)) {
                newData.vencimento = value;
            }
        }
        
        // Recalcular Total Concessionária se algum valor financeiro mudar
        if (['consumo_reais', 'iluminacao_publica', 'tarifa_minima', 'outros_lancamentos', 'parcelamento'].includes(field)) {
            newData.valor_concessionaria = 
                (Number(newData.consumo_reais) || 0) + 
                (Number(newData.iluminacao_publica) || 0) + 
                (Number(newData.tarifa_minima) || 0) + 
                (Number(newData.outros_lancamentos) || 0) +
                (Number(newData.parcelamento) || 0);
        }

        // Recalcular Valor do Assinante (Boleto)
        if (['consumo_reais', 'iluminacao_publica', 'tarifa_minima', 'outros_lancamentos', 'parcelamento', 'consumo_compensado', 'valor_concessionaria', 'consumo_kwh'].includes(field)) {
            const discount = invoice.desconto_aplicado !== undefined ? invoice.desconto_aplicado : (consumerUnit?.desconto_assinante || 0);
            const consumoReais = Number(newData.consumo_reais) || 0;
            const consumoKwh = Number(newData.consumo_kwh) || 0;
            const consumoCompensadoKwh = Number(newData.consumo_compensado) || 0;
            const proportionCompensated = consumoKwh > 0 ? Math.min(1, consumoCompensadoKwh / consumoKwh) : (consumoCompensadoKwh > 0 ? 1 : 0);
            const valorDesconto = (consumoReais * proportionCompensated) * (discount / 100);
            
            const grossValue = 
                consumoReais + 
                (Number(newData.iluminacao_publica) || 0) + 
                (Number(newData.tarifa_minima) || 0) + 
                (Number(newData.outros_lancamentos) || 0) + 
                (Number(newData.parcelamento) || 0);
            
            const baseValue = Math.max(grossValue, Number(newData.valor_concessionaria) || 0);
            newData.valor_a_pagar = Math.max(0, baseValue - valorDesconto).toFixed(2);
        }
        
        setEditData(newData);
    };

    const handleSaveEdit = async () => {
        if (!editData.vencimento_concessionaria || !editData.mes_referencia) {
            showAlert('Por favor, preencha o vencimento e o mês de referência.', 'warning');
            return;
        }

        setLoading(true);
        try {
            const numericFields = [
                'consumo_kwh', 'energia_injetada', 'consumo_compensado', 
                'consumo_reais', 'iluminacao_publica', 'tarifa_minima', 
                'outros_lancamentos', 'parcelamento', 'valor_concessionaria', 'valor_a_pagar'
            ];
            
            const sanitizedData = { ...editData };
            for (const field of numericFields) {
                if (sanitizedData[field] === '') {
                    sanitizedData[field] = null;
                } else if (sanitizedData[field] !== null) {
                    sanitizedData[field] = Number(sanitizedData[field]);
                }
            }

            const payload = {
                ...sanitizedData,
                // Garantir que mes_referencia tenha o dia 01 se for apenas YYYY-MM
                mes_referencia: sanitizedData.mes_referencia?.length === 7 ? `${sanitizedData.mes_referencia}-01` : sanitizedData.mes_referencia
            };

            const { error } = await supabase
                .from('invoices')
                .update(payload)
                .eq('id', invoice.id);

            if (error) throw error;
            
            if (onPaymentSuccess) await onPaymentSuccess();
            showAlert('Fatura atualizada com sucesso!', 'success');
            setIsEditing(false);
            onClose(); 
        } catch (error) {
            console.error('Erro ao salvar edição:', error);
            showAlert('Erro ao salvar: ' + (error.message || 'Erro desconhecido'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        const confirmCancel = await showConfirm(
            'Tem certeza que deseja cancelar esta fatura?', 
            'Cancelar Fatura', 
            'Sim, Continuar', 
            'Cancelar'
        );
        if (!confirmCancel) return;
        
        const deleteConcessionaria = await showConfirm(
            'Deseja excluir também a conta de energia da concessionária vinculada? (Se escolher NÃO, a conta será mantida com status "Sem Faturamento" e você poderá refaturá-la).', 
            'Excluir Conta de Energia?', 
            'Sim, Excluir Tudo', 
            'Não, Apenas Refaturar'
        );
        
        setLoading(true);
        try {
            // Cancel in Asaas if payment exists
            if (invoice.asaas_payment_id) {
                console.log('Cancelando cobrança no Asaas:', invoice.asaas_payment_id);
                await cancelAsaasCharge(invoice.id);
            }
            
            if (deleteConcessionaria) {
                // Delete completely from database
                const { error } = await supabase
                    .from('invoices')
                    .delete()
                    .eq('id', invoice.id);
                if (error) throw error;
                showAlert('Fatura e conta de energia excluídas com sucesso!', 'success');
            } else {
                // Reset status to sem_faturamento and clear asaas fields in database
                const { error } = await supabase
                    .from('invoices')
                    .update({
                        status: 'sem_faturamento',
                        asaas_status: null,
                        asaas_payment_id: null,
                        asaas_boleto_url: null,
                        asaas_pdf_storage_url: null,
                        linha_digitavel: null,
                        pix_string: null
                    })
                    .eq('id', invoice.id);
                if (error) throw error;
                showAlert('Cobrança cancelada. A conta de energia foi preservada para refaturamento!', 'success');
            }
            
            if (onPaymentSuccess) onPaymentSuccess();
            onClose();
        } catch (error) {
            console.error('Erro ao processar cancelamento/exclusão da fatura:', error);
            showAlert('Erro ao processar ação: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const renderHiddenInvoiceDetail = (inv) => {
        if (!inv) return null;
        const uc = consumerUnit;
        const statusColorsPdf = {
            pago: { color: '#27ae60', label: 'PAGO' },
            a_vencer: { color: '#2563eb', label: 'A VENCER' },
            sem_faturamento: { color: '#2563eb', label: 'A VENCER' },
            atrasado: { color: '#dc2626', label: 'ATRASADO' },
            cancelado: { color: '#64748b', label: 'CANCELADO' }
        };
        const currentPdfStatus = statusColorsPdf[inv.status] || statusColorsPdf.a_vencer;
        const statusLabel = currentPdfStatus.label;
        const statusColor = currentPdfStatus.color;
        const subscriber = consumerUnit?.subscribers;

        const rawConsumo = Number(inv.consumo_kwh) || 0;
        const rawCompensado = Number(inv.consumo_compensado) || 0;
        const rawTarifa = Number(uc?.tarifa_concessionaria) || 0;
        const discountSnapshot = inv.desconto_aplicado !== undefined ? Number(inv.desconto_aplicado) : (Number(uc?.desconto_assinante) || 0);
        const multiplier = discountSnapshot > 1 ? discountSnapshot / 100 : discountSnapshot;
        
        // Calculations
        const consumoTotalReais = rawConsumo * rawTarifa;
        const energiaCompensadaReais = rawCompensado * rawTarifa * (1 - multiplier);
        const economiaReais = rawCompensado * rawTarifa * multiplier;
        const ip = Number(inv.iluminacao_publica) || 0;
        const tarifaMinimaExcedentes = Math.max(0, (rawConsumo - rawCompensado) * rawTarifa);
        const outros = Number(inv.outros_lancamentos) || 0;
        const outrosTotal = tarifaMinimaExcedentes + outros;
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
                        <span style={{
                            padding: '6px 16px',
                            borderRadius: '30px',
                            color: '#ffffff',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            backgroundColor: statusColor
                        }}>
                            {statusLabel}
                        </span>
                    </div>
 
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1.2fr',
                        padding: '24px',
                        gap: '24px',
                        boxSizing: 'border-box',
                        width: '100%',
                        background: '#ffffff'
                    }}>
                        <div style={{
                            backgroundColor: '#f1f5f9',
                            padding: '24px',
                            borderRadius: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px',
                            boxSizing: 'border-box'
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>ASSINANTE</label>
                                <span style={{ fontSize: '0.95rem', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase' }}>{subscriber?.name || uc?.titular_conta || 'Assinante'}</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>NÚMERO DA UC</label>
                                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>{uc?.numero_uc || 'N/A'}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>IDENTIFICAÇÃO (APELIDO)</label>
                                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>{uc?.identification || uc?.titular_conta || 'Unidade Consumidora'}</span>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>MÊS REFERÊNCIA</label>
                                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a' }}>{inv.mes_referencia ? `${inv.mes_referencia.split('-')[1]}/${inv.mes_referencia.split('-')[0]}` : 'N/A'}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>VENCIMENTO</label>
                                    <span style={{ fontSize: '0.95rem', fontWeight: '800', color: '#dc2626' }}>
                                        {(() => {
                                            const rawVenc = inv.status !== 'sem_faturamento' ? getBoletoDueDate() : inv.vencimento;
                                            return rawVenc ? new Date(rawVenc + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A';
                                        })()}
                                    </span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '4px' }}>ENDEREÇO DA UC</label>
                                <span style={{ fontSize: '0.8rem', color: '#1e293b', wordBreak: 'break-word', fontWeight: '500', lineHeight: '1.25' }}>
                                    {(() => {
                                        const addr = uc?.address;
                                        if (!addr) return 'Endereço não cadastrado';
                                        if (typeof addr === 'string') return addr;
                                        return [
                                            addr.rua,
                                            addr.numero ? `Nº ${addr.numero}` : '',
                                            addr.complemento,
                                            addr.bairro,
                                            addr.cidade ? `${addr.cidade}-${addr.uf}` : ''
                                        ].filter(Boolean).join(', ') || 'Endereço não cadastrado';
                                    })()}
                                </span>
                            </div>
                        </div>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '16px',
                            boxSizing: 'border-box'
                        }}>
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
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Consumo total <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 'normal' }}>({rawConsumo} * R$ {rawTarifa.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 4 })} *)</span></div>
                                            </td>
                                            <td style={{ padding: '8px 0', textAlign: 'center', color: '#1e293b', fontWeight: '600' }}>{rawConsumo} kwh</td>
                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(consumoTotalReais)}</td>
                                        </tr>
                                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '8px 0' }}>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Energia Compensada Desc. {discountSnapshot}% -</div>
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
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>Tarifa Mínima / Multas / Juros / Bandeiras / Outros</div>
                                            </td>
                                            <td style={{ padding: '8px 0', textAlign: 'center', color: '#64748b' }}>—</td>
                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 'bold', color: '#1e293b' }}>{formatCurrency(outrosTotal)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontStyle: 'italic', marginTop: '6px', borderBottom: '1px solid #cbd5e1', paddingBottom: '6px' }}>
                                    * Valor calculado com base na tarifa cheia da concessionária.
                                </div>
                            </div>
 
                            <div style={{
                                marginTop: '8px',
                                padding: '12px 16px',
                                borderRadius: '12px',
                                background: '#eff6ff',
                                border: '1.5px solid #bfdbfe',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                boxSizing: 'border-box'
                            }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: '800', color: '#1e3a8a', letterSpacing: '0.05em' }}>
                                    VALOR DO ASSINANTE (BOLETO)
                                </span>
                                <span style={{ fontSize: '1.3rem', fontWeight: '900', color: '#1e3a8a' }}>
                                    {formatCurrency(totalCalculado)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const statusColors = {
        pago: { bg: '#dcfce7', text: '#166534', label: 'PAGO' },
        a_vencer: { bg: '#eff6ff', text: '#1d4ed8', label: 'A VENCER' },
        atrasado: { bg: '#fee2e2', text: '#991b1b', label: 'ATRASADO' },
        cancelado: { bg: '#f1f5f9', text: '#475569', label: 'CANCELADO' },
        sem_faturamento: { bg: '#f3f4f6', text: '#6b7280', label: 'SEM FATURAMENTO' }
    };

        const getUtilityDueDate = () => {
            const dateStr = invoice.vencimento_concessionaria || invoice.vencimento;
            if (!dateStr) return 'N/A';
            // Mostrar a data exata da fatura, sem forçar o dia do cadastro da UC
            // Isso evita confusão quando o usuário edita a data e a UI continua mostrando a antiga
            return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR');
        };

        const currentStatus = invoice.status === 'cancelado' 
            ? statusColors.cancelado 
            : statusColors[invoice.status] || statusColors.a_vencer;

        return (
            <div className="modal-overlay" style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)'
            }}>
                <div className="modal-content" style={{
                    backgroundColor: 'white', borderRadius: '20px', width: '90%', maxWidth: '900px',
                    maxHeight: '90vh', overflowY: 'auto', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
                }}>
                    <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', display: 'flex', gap: '0.75rem', zIndex: 10 }}>
                        <button 
                            onClick={handleDelete}
                            title="Excluir Fatura"
                            style={{ background: '#fee2e2', border: 'none', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}
                        >
                            <Trash2 size={20} />
                        </button>
                        <button 
                            onClick={handleToggleEdit}
                            title={isEditing ? "Cancelar Edição" : "Editar Fatura"}
                            style={{ background: isEditing ? '#f1f5f9' : '#eff6ff', border: 'none', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer', color: isEditing ? '#64748b' : '#2563eb', display: 'flex', alignItems: 'center' }}
                        >
                            {isEditing ? <RotateCcw size={20} /> : <Pencil size={20} />}
                        </button>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                            <X size={24} />
                        </button>
                    </div>
    
                    <div style={{ padding: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                            <div style={{ padding: '0.5rem', background: (branding?.primary_color || '#003366') + '10', borderRadius: '10px' }}>
                                <FileText size={24} color={branding?.primary_color || '#003366'} />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
                                    {isEditing ? 'Editando Fatura de Energia' : 'Resumo da Conta de Energia'}
                                </h2>
                                <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
                                    {isEditing ? 'Altere os dados técnicos e financeiros abaixo' : 'Detalhamento técnico e financeiro'}
                                </p>
                            </div>
                        </div>

                        {/* Status e Identificação (Assinante / Fatura do Assinante) */}
                        <div style={{ 
                            background: '#f8fafc', padding: '1.25rem', borderRadius: '16px', 
                            marginBottom: '1.5rem', border: '1px solid #e2e8f0',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <div>
                                <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Status da Fatura do Assinante</div>
                                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '1rem' }}>{consumerUnit?.subscribers?.name || 'Assinante'}</div>
                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>UC: {consumerUnit?.numero_uc}</div>
                            </div>
                            <span style={{ 
                                padding: '0.4rem 0.8rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 800,
                                background: currentStatus.bg, color: currentStatus.text, border: `1px solid ${currentStatus.text}20`
                            }}>
                                {currentStatus.label}
                            </span>
                        </div>

                        {/* Energy Bill Status Toggle - Manual Override */}
                        <div style={{ 
                            background: '#f1f5f9', 
                            padding: '1rem', 
                            borderRadius: '16px', 
                            marginBottom: '1.5rem',
                            border: '1px solid #e2e8f0'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Status da Conta de energia</span>
                                {updatingStatus && <span style={{ fontSize: '0.7rem', color: '#3b82f6' }}>Salvando...</span>}
                            </div>
                             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.25rem', background: 'white', padding: '0.25rem', borderRadius: '12px' }}>
                                 {(() => {
                                     const today = new Date();
                                     today.setHours(0, 0, 0, 0);
                                     // Parse as local date to avoid timezone issues with YYYY-MM-DD
                                     const dueDateStr = invoice.vencimento_concessionaria || invoice.vencimento;
                                     const dueDate = dueDateStr ? new Date(dueDateStr + 'T12:00:00') : null;
                                     const isPastDue = dueDate && dueDate < today;
                                     
                                     const pendenteOption = isPastDue 
                                         ? { id: 'pendente', label: 'Atrasada', color: '#dc2626' }
                                         : { id: 'pendente', label: 'A Vencer', color: '#2563eb' };

                                     return [
                                         pendenteOption,
                                         { id: 'inconsistente', label: 'Inconsistente', color: '#ea580c' },
                                         { id: 'contestada', label: 'Contestada', color: '#7c3aed' },
                                         { id: 'parcelada', label: 'Parcelada', color: '#ca8a04' },
                                         { id: 'pago', label: 'Pago', color: '#166534' }
                                     ].map(s => (
                                         <button
                                             key={s.id}
                                         onClick={() => handleUpdateEnergyStatus(s.id)}
                                         disabled={updatingStatus}
                                         style={{
                                             padding: '0.5rem 0.1rem',
                                             borderRadius: '8px',
                                             border: 'none',
                                             fontSize: '0.75rem',
                                             fontWeight: energyStatus === s.id ? '800' : '600',
                                             cursor: 'pointer',
                                             transition: 'all 0.2s',
                                             background: energyStatus === s.id ? s.color : 'transparent',
                                             color: energyStatus === s.id ? 'white' : '#64748b',
                                             boxShadow: energyStatus === s.id ? `0 4px 12px ${s.color}40` : 'none',
                                             whiteSpace: 'nowrap',
                                             textAlign: 'center'
                                         }}
                                     >
                                         {s.label}
                                     </button>
                                 ))})()}
                             </div>
                        </div>
    
                        {/* Grid de Valores */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Vencimento</div>
                                {isEditing ? (
                                    <input 
                                        type="date" 
                                        value={editData.vencimento_concessionaria} 
                                        onChange={e => handleEditChange('vencimento_concessionaria', e.target.value)}
                                        style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.9rem', marginTop: '0.25rem' }}
                                    />
                                ) : (
                                    <div style={{ fontWeight: 800, color: '#ef4444', fontSize: '1.1rem' }}>
                                        {getUtilityDueDate()}
                                    </div>
                                )}
                            </div>
                            <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '12px', border: '1px solid #dcfce7' }}>
                                <div style={{ fontSize: '0.65rem', color: '#166534', fontWeight: 700, textTransform: 'uppercase' }}>Mês Referência</div>
                                {isEditing ? (
                                    <input 
                                        type="month" 
                                        value={editData.mes_referencia} 
                                        onChange={e => handleEditChange('mes_referencia', e.target.value)}
                                        style={{ width: '100%', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.9rem', marginTop: '0.25rem' }}
                                    />
                                ) : (
                                    <div style={{ fontWeight: 800, color: '#166534', fontSize: '1.1rem' }}>
                                        {invoice.mes_referencia ? (() => {
                                            const [year, month] = invoice.mes_referencia.split('-');
                                            return new Date(year, parseInt(month) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                                        })() : 'N/A'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Grid de Leituras */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Leitura Anterior</div>
                                {isEditing ? (
                                    <input 
                                        type="date" 
                                        value={editData.data_leitura_anterior || ''} 
                                        onChange={e => handleEditChange('data_leitura_anterior', e.target.value)}
                                        style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.9rem', marginTop: '0.25rem' }}
                                    />
                                ) : (
                                    <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '1.1rem' }}>
                                        {invoice.data_leitura_anterior ? new Date(invoice.data_leitura_anterior + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}
                                    </div>
                                )}
                            </div>
                            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Leitura Atual</div>
                                {isEditing ? (
                                    <input 
                                        type="date" 
                                        value={editData.data_leitura || ''} 
                                        onChange={e => handleEditChange('data_leitura', e.target.value)}
                                        style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.9rem', marginTop: '0.25rem' }}
                                    />
                                ) : (
                                    <div style={{ fontWeight: 800, color: '#1e293b', fontSize: '1.1rem' }}>
                                        {invoice.data_leitura ? new Date(invoice.data_leitura + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}
                                    </div>
                                )}
                            </div>
                        </div>

                    {/* Detalhamento de Consumo */}
                    <div style={{ 
                        background: 'white', padding: '1.5rem', borderRadius: '16px', 
                        border: '1px solid #e2e8f0', marginBottom: '2rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}>
                        <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: '#475569', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Composição da Fatura
                        </h4>
                        
                        {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                    <span>Consumo Total (kWh):</span>
                                    <input type="number" value={editData.consumo_kwh} onChange={e => handleEditChange('consumo_kwh', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                    <span>Energia Injetada:</span>
                                    <input type="number" value={editData.energia_injetada} onChange={e => handleEditChange('energia_injetada', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                    <span>Energia Compensada:</span>
                                    <input type="number" value={editData.consumo_compensado} onChange={e => handleEditChange('consumo_compensado', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                </div>
                                <hr style={{ border: 'none', borderTop: '1px dashed #e2e8f0', margin: '0.25rem 0' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                    <span>Consumo em Reais:</span>
                                    <input type="number" step="0.01" value={editData.consumo_reais} onChange={e => handleEditChange('consumo_reais', e.target.value)} style={{ width: '100px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                    <span>Iluminação Pública:</span>
                                    <input type="number" step="0.01" value={editData.iluminacao_publica} onChange={e => handleEditChange('iluminacao_publica', e.target.value)} style={{ width: '100px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center' }}>
                                    <span>Tarifa Mínima / Multas / Juros / Bandeiras / Outros:</span>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <input type="number" step="0.01" value={editData.tarifa_minima} onChange={e => handleEditChange('tarifa_minima', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} placeholder="Min" title="Tarifa Mínima" />
                                        <input type="number" step="0.01" value={editData.outros_lancamentos} onChange={e => handleEditChange('outros_lancamentos', e.target.value)} style={{ width: '80px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} placeholder="Outros" title="Outros Lançamentos (Multas, Juros, Bandeiras)" />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', alignItems: 'center', marginTop: '0.5rem' }}>
                                    <span>Parcelamento:</span>
                                    <input type="number" step="0.01" value={editData.parcelamento} onChange={e => handleEditChange('parcelamento', e.target.value)} style={{ width: '100px', border: '1px solid #cbd5e1', borderRadius: '4px', textAlign: 'right', padding: '0.2rem' }} />
                                </div>
                            </div>
                        ) : (() => {
                            const discount = invoice.desconto_aplicado !== undefined ? invoice.desconto_aplicado : (consumerUnit?.desconto_assinante || 0);
                            
                            const consumoKwh = Number(invoice.consumo_kwh) || 0;
                            const consumoReais = Number(invoice.consumo_reais) || 0;
                            const ip = Number(invoice.iluminacao_publica) || 0;
                            const valorConcessionaria = Number(invoice.valor_concessionaria) || 0;
                            const parcelamentoVal = Number(invoice.parcelamento) || 0;
                            
                            // "Outros": se valor_concessionaria for maior que consumo+IP, a diferença é algum encargo extra (ex: Bandeira).
                            // Se for menor, a diferença negativa é a Energia Injetada, então "outros" real vem do banco ou é 0.
                            let outros = valorConcessionaria - consumoReais - ip - parcelamentoVal;
                            if (outros < 0 || isNaN(outros)) outros = (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0);

                            // O assinante deve receber desconto ESTRITAMENTE sobre a energia compensada informada.
                            // Se a concessionária não compensou por erro, a B2W deve editar a fatura manualmente e informar o valor.
                            const consumoCompensadoKwh = Number(invoice.consumo_compensado) || 0;
                            
                            const proportionCompensated = consumoKwh > 0 ? Math.min(1, consumoCompensadoKwh / consumoKwh) : 1;
                            const valorCompensadaReais = consumoReais * proportionCompensated;
                            const valorDesconto = valorCompensadaReais * (discount / 100);

                            // O Boleto Unificado é o Valor Bruto da conta (Consumo + IP + Encargos) MENOS o desconto da energia.
                            const calcConcessionariaSum = (consumoReais - valorDesconto) + ip + outros + parcelamentoVal;

                            return (
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                                                <th style={{ padding: '0.5rem 0', color: '#475569', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', verticalAlign: 'middle' }}>Descrição do lançamento</th>
                                                <th style={{ padding: '0.5rem 0', color: '#475569', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', textAlign: 'center', verticalAlign: 'middle' }}>Quantitativo</th>
                                                <th style={{ padding: '0.5rem 0', color: '#475569', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', textAlign: 'right', verticalAlign: 'middle' }}>Valores</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#64748b', fontWeight: '500', verticalAlign: 'middle' }}>
                                                    <div>
                                                        <span style={{ color: '#1e293b', fontWeight: '600' }}>Consumo total</span>
                                                    </div>
                                                </td>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#1e293b', fontWeight: '700', textAlign: 'center', verticalAlign: 'middle' }}>{consumoKwh} kwh</td>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#1e293b', fontWeight: '700', textAlign: 'right', verticalAlign: 'middle' }}>
                                                    {formatCurrency(consumoReais)}
                                                </td>
                                            </tr>
                                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#64748b', fontWeight: '500', verticalAlign: 'middle' }}>Energia Compensada Desc. {discount}% -</td>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#16a34a', fontWeight: '700', textAlign: 'center', verticalAlign: 'middle' }}>- {consumoCompensadoKwh} kwh</td>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#16a34a', fontWeight: '700', textAlign: 'right', verticalAlign: 'middle' }}>- {formatCurrency(valorDesconto)}</td>
                                            </tr>
                                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#64748b', fontWeight: '500', verticalAlign: 'middle' }}>Iluminação Pública</td>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#64748b', textAlign: 'center', verticalAlign: 'middle' }}>—</td>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#1e293b', fontWeight: '700', textAlign: 'right', verticalAlign: 'middle' }}>{formatCurrency(ip)}</td>
                                            </tr>
                                            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#64748b', fontWeight: '500', verticalAlign: 'middle' }}>Tarifa Mínima / Multas / Juros / Bandeiras / Outros</td>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#64748b', textAlign: 'center', verticalAlign: 'middle' }}>—</td>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#1e293b', fontWeight: '700', textAlign: 'right', verticalAlign: 'middle' }}>{formatCurrency(outros)}</td>
                                            </tr>
                                            {parcelamentoVal > 0 && (
                                                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#64748b', fontWeight: '500', verticalAlign: 'middle' }}>Parcelamento</td>
                                                    <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#64748b', textAlign: 'center', verticalAlign: 'middle' }}>—</td>
                                                    <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#1e293b', fontWeight: '700', textAlign: 'right', verticalAlign: 'middle' }}>{formatCurrency(parcelamentoVal)}</td>
                                                </tr>
                                            )}
                                            <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                                                <td style={{ padding: '0.75rem 0 0.75rem 0.5rem', fontSize: '0.85rem', color: '#0f172a', fontWeight: '800', verticalAlign: 'middle' }}>Total de Lançamentos</td>
                                                <td style={{ padding: '0.75rem 0', fontSize: '0.85rem', color: '#64748b', textAlign: 'center', verticalAlign: 'middle' }}>—</td>
                                                <td style={{ padding: '0.75rem 0.5rem 0.75rem 0', fontSize: '0.9rem', color: '#0f172a', fontWeight: '800', textAlign: 'right', verticalAlign: 'middle' }}>{formatCurrency(calcConcessionariaSum)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                        * A composição reflete o desconto de {discount}% aplicado sobre a energia compensada.
                                    </div>
                                </div>
                            );
                        })()}

                        {/* VALOR DA CONTA DE ENERGIA (ANTIGO TOTAL CONCESSIONÁRIA) */}
                        <div style={{ 
                            padding: '1.25rem', 
                            borderRadius: '16px', 
                            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '0.75rem',
                            marginBottom: '1rem'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                {/* Left Side: Label and View Pdf Button */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: branding?.primary_color || '#003366', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                        VALOR DA CONTA DE ENERGIA (CONCESSIONÁRIA)
                                    </span>
                                    
                                    {!isEditing && (
                                        <button 
                                            type="button"
                                            onClick={handleViewPdf}
                                            style={{
                                                alignSelf: 'flex-start',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '0.35rem',
                                                padding: '0.35rem 0.7rem',
                                                borderRadius: '6px',
                                                border: '1.5px solid #cbd5e1',
                                                background: 'white',
                                                color: '#475569',
                                                fontSize: '0.75rem',
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = branding?.primary_color || '#003366'; e.currentTarget.style.color = branding?.primary_color || '#003366'; }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; }}
                                        >
                                            <ExternalLink size={13} /> Visualizar Conta
                                        </button>
                                    )}
                                </div>

                                {/* Right Side: Value and Pay Button */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '1.4rem', fontWeight: 900, color: branding?.primary_color || '#003366' }}>
                                        {isEditing ? (
                                            <input 
                                                type="number" 
                                                step="0.01"
                                                value={editData.valor_concessionaria} 
                                                onChange={e => handleEditChange('valor_concessionaria', e.target.value)} 
                                                style={{ 
                                                    width: '120px', 
                                                    border: '1px solid #cbd5e1', 
                                                    borderRadius: '6px', 
                                                    textAlign: 'right', 
                                                    padding: '0.4rem',
                                                    fontSize: '1.1rem',
                                                    fontWeight: 'bold',
                                                    color: branding?.primary_color || '#003366'
                                                }} 
                                            />
                                        ) : formatCurrency((() => {
                                            const valDb = Number(invoice.valor_concessionaria) || 0;
                                            const consumoReais = Number(invoice.consumo_reais) || 0;
                                            const ip = Number(invoice.iluminacao_publica) || 0;
                                            const outros = (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0);
                                            const compKwh = Number(invoice.consumo_compensado) || 0;
                                            const grossValue = consumoReais + ip + outros + (Number(invoice.parcelamento) || 0);
                                            // Se não houve compensação (0 kWh) e o valor no BD for estranhamente menor que o consumo bruto,
                                            // corrige a exibição forçando o Valor Bruto (já que a concessionária cobrou o total sem descontos).
                                            if (compKwh === 0 && valDb < consumoReais) {
                                                return grossValue;
                                            }
                                            return valDb;
                                        })())}
                                    </span>

                                    {!isEditing && (
                                        (() => {
                                            if (energyStatus === 'pago') {
                                                return (
                                                    <span style={{ 
                                                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                        padding: '0.3rem 0.6rem', borderRadius: '6px',
                                                        background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0',
                                                        fontSize: '0.72rem', fontWeight: 700
                                                    }}>
                                                        <CheckCircle2 size={13} /> Pago
                                                    </span>
                                                );
                                            }
                                            if (invoice.linha_digitavel) {
                                                return (
                                                    <button 
                                                        type="button"
                                                        onClick={handlePay}
                                                        disabled={loading || paymentStatus === 'success'}
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '0.35rem',
                                                            padding: '0.35rem 0.75rem',
                                                            borderRadius: '6px',
                                                            border: 'none',
                                                            background: paymentStatus === 'success' ? '#22c55e' : '#10b981',
                                                            color: 'white',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 700,
                                                            cursor: loading ? 'not-allowed' : 'pointer',
                                                            transition: 'all 0.2s',
                                                            boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)'
                                                        }}
                                                        onMouseEnter={e => { if(!loading) e.currentTarget.style.background = '#059669'; }}
                                                        onMouseLeave={e => { if(!loading) e.currentTarget.style.background = '#10b981'; }}
                                                    >
                                                        {loading ? 'Carregando...' : <><CreditCard size={13} /> Pagar Conta</>}
                                                    </button>
                                                );
                                            }
                                            return null;
                                        })()
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* VALOR DO ASSINANTE (BOLETO) */}
                        <div style={{ 
                            padding: '1.25rem', 
                            borderRadius: '16px', 
                            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '0.75rem'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                {/* Left Side: Label and descriptor/Open Boleto button */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#475569', letterSpacing: '0.05em' }}>
                                        VALOR DO ASSINANTE (BOLETO)
                                    </span>
                                    
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        {!isEditing && invoice.asaas_boleto_url && invoice.status !== 'pago' && (
                                            <a 
                                                href={invoice.asaas_boleto_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    alignSelf: 'flex-start',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.35rem',
                                                    padding: '0.35rem 0.7rem',
                                                    borderRadius: '6px',
                                                    border: '1.5px solid #bbf7d0',
                                                    background: '#dcfce7',
                                                    color: '#15803d',
                                                    fontSize: '0.75rem',
                                                    fontWeight: 700,
                                                    textDecoration: 'none',
                                                    transition: 'all 0.2s',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.background = '#bbf7d0'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = '#dcfce7'; }}
                                            >
                                                <ExternalLink size={13} /> Abrir Boleto
                                            </a>
                                        )}

                                        {!isEditing && invoice.asaas_boleto_url && invoice.status !== 'sem_faturamento' && (
                                            <button 
                                                type="button"
                                                onClick={async () => {
                                                    const blob = await handleDownloadCombined(invoice, invoice.asaas_boleto_url);
                                                    if (blob) {
                                                        const url = URL.createObjectURL(blob);
                                                        const a = document.createElement('a');
                                                        a.href = url;
                                                        const monthYear = invoice.mes_referencia ? invoice.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
                                                        const cleanName = (consumerUnit?.titular_conta || 'Fatura').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').replace(/[^\w]/g, '');
                                                        a.download = `Fatura_${cleanName}_${consumerUnit?.numero_uc || ''}_${monthYear}.pdf`;
                                                        document.body.appendChild(a);
                                                        a.click();
                                                        document.body.removeChild(a);
                                                        URL.revokeObjectURL(url);
                                                    }
                                                }}
                                                disabled={isGeneratingPdf}
                                                style={{
                                                    alignSelf: 'flex-start',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.35rem',
                                                    padding: '0.35rem 0.7rem',
                                                    borderRadius: '6px',
                                                    border: '1.5px solid #bae6fd',
                                                    background: '#e0f2fe',
                                                    color: '#0369a1',
                                                    fontSize: '0.75rem',
                                                    fontWeight: 700,
                                                    cursor: isGeneratingPdf ? 'not-allowed' : 'pointer',
                                                    transition: 'all 0.2s',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                }}
                                                onMouseEnter={e => { if(!isGeneratingPdf) e.currentTarget.style.background = '#bae6fd'; }}
                                                onMouseLeave={e => { if(!isGeneratingPdf) e.currentTarget.style.background = '#e0f2fe'; }}
                                            >
                                                <FileText size={13} /> {isGeneratingPdf ? 'Gerando...' : 'Visualizar Fatura (PDF)'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Right Side: Value and Gerar Faturamento button */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                                    {isEditing ? (
                                        <input 
                                            type="number" 
                                            step="0.01" 
                                            value={editData.valor_a_pagar} 
                                            onChange={e => handleEditChange('valor_a_pagar', e.target.value)} 
                                            style={{ 
                                                width: '120px', 
                                                border: '2px solid var(--color-blue)', 
                                                borderRadius: '8px', 
                                                textAlign: 'right', 
                                                padding: '0.4rem',
                                                fontSize: '1.1rem',
                                                fontWeight: 'bold'
                                            }} 
                                        />
                                    ) : (
                                        <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--color-blue)' }}>
                                            {formatCurrency(isEditing ? editData.valor_a_pagar : (() => {
                                                if (invoice.status !== 'sem_faturamento' && Number(invoice.valor_a_pagar) !== Number(invoice.valor_concessionaria) && Number(invoice.valor_a_pagar) > 0) {
                                                    return invoice.valor_a_pagar;
                                                }
                                                const discount = invoice.desconto_aplicado !== undefined ? invoice.desconto_aplicado : (consumerUnit?.desconto_assinante || 0);
                                                const consumoKwh = Number(invoice.consumo_kwh) || 0;
                                                const consumoReais = Number(invoice.consumo_reais) || 0;
                                                const ip = Number(invoice.iluminacao_publica) || 0;
                                                const parcelamentoVal = Number(invoice.parcelamento) || 0;
                                                const valorConcessionaria = Number(invoice.valor_concessionaria) || 0;
                                                let outros = valorConcessionaria - consumoReais - ip - parcelamentoVal;
                                                if (outros < 0 || isNaN(outros)) outros = (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0);

                                                const consumoCompensadoKwh = Number(invoice.consumo_compensado) || 0;
                                                const proportionCompensated = consumoKwh > 0 ? Math.min(1, consumoCompensadoKwh / consumoKwh) : 1;
                                                const valorDesconto = (consumoReais * proportionCompensated) * (discount / 100);
                                                
                                                return (consumoReais - valorDesconto) + ip + outros + parcelamentoVal;
                                            })())}
                                        </span>
                                    )}

                                    {!isEditing && (
                                        (() => {
                                            if (invoice.status === 'sem_faturamento' || invoice.status === 'cancelado') {
                                                if (subscriberBillingMode === 'consolidada') {
                                                    return (
                                                        <div style={{ fontSize: '0.75rem', color: '#ea580c', fontWeight: 600, background: '#ffedd5', padding: '0.35rem 0.75rem', borderRadius: '6px', textAlign: 'right' }}>
                                                            Assinante de Fatura Consolidada.<br/>
                                                            <span style={{ fontSize: '0.65rem', fontWeight: 400 }}>Gere o boleto pelo menu do Assinante.</span>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <button 
                                                        type="button"
                                                        onClick={handleGenerateBilling}
                                                        disabled={loading}
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '0.35rem',
                                                            padding: '0.35rem 0.75rem',
                                                            borderRadius: '6px',
                                                            border: 'none',
                                                            background: '#0284c7',
                                                            color: 'white',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 700,
                                                            cursor: loading ? 'not-allowed' : 'pointer',
                                                            transition: 'all 0.2s',
                                                            boxShadow: '0 2px 4px rgba(2, 132, 199, 0.2)'
                                                        }}
                                                        onMouseEnter={e => { if(!loading) e.currentTarget.style.background = '#0369a1'; }}
                                                        onMouseLeave={e => { if(!loading) e.currentTarget.style.background = '#0284c7'; }}
                                                    >
                                                        {loading ? 'Gerando...' : <><FileText size={13} /> Gerar Fatura</>}
                                                    </button>
                                                );
                                            }
                                            if (invoice.status === 'pago') {
                                                return (
                                                    <span style={{ 
                                                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                        padding: '0.3rem 0.6rem', borderRadius: '6px',
                                                        background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0',
                                                        fontSize: '0.72rem', fontWeight: 700
                                                    }}>
                                                        <CheckCircle2 size={13} /> Fatura Paga
                                                    </span>
                                                );
                                            }
                                            return null;
                                        })()
                                    )}
                                </div>
                            </div>
                        </div>

                        <hr style={{ margin: '1.5rem 0', border: 'none', borderTop: '2px solid #f1f5f9' }} />

                        {/* Contas Incorporadas / Parcelamento */}
                        {!isEditing && (
                            <div style={{ marginBottom: '1.5rem' }}>
                                <CollapsibleSection title="Contas Incorporadas / Parcelamento" icon={LinkIcon} defaultOpen={true} noGrid={true}>
                                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {/* Validate Parcelamento */}
                                        {Number(invoice.parcelamento) > 0 && childInvoices.length === 0 && (
                                            <div style={{ padding: '0.8rem 1rem', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                                <AlertCircle size={20} color="#ea580c" style={{ flexShrink: 0 }} />
                                                <span style={{ fontSize: '0.85rem', color: '#9a3412', fontWeight: '500' }}>
                                                    Esta fatura possui um lançamento de <strong>Parcelamento (R$ {formatCurrency(invoice.parcelamento)})</strong>, mas nenhuma conta original (conta filha) foi vinculada. Arraste-a no Kanban ou pesquise abaixo.
                                                </span>
                                            </div>
                                        )}
                                        {Number(invoice.parcelamento) > 0 && childInvoices.length > 0 && (() => {
                                            const sumChildren = childInvoices.reduce((acc, curr) => acc + (Number(curr.valor_concessionaria) || 0), 0);
                                            const diff = Math.abs(sumChildren - Number(invoice.parcelamento));
                                            if (diff > 5.00) { // Tolerância de R$ 5,00 para juros/multas
                                                return (
                                                    <div style={{ padding: '0.8rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                                        <AlertCircle size={20} color="#dc2626" style={{ flexShrink: 0 }} />
                                                        <span style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: '500' }}>
                                                            <strong>Atenção:</strong> A soma das contas filhas (R$ {formatCurrency(sumChildren)}) difere do parcelamento cobrado (R$ {formatCurrency(invoice.parcelamento)}). Confirme se os juros justificam a diferença.
                                                        </span>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })()}

                                        {loadingChildren ? (
                                            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Carregando contas vinculadas...</div>
                                        ) : childInvoices.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                {/* Parent Node */}
                                                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '0.85rem 1.25rem', minWidth: '320px', textAlign: 'center', zIndex: 2, position: 'relative', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem' }}>
                                                        <span style={{ 
                                                            padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '0.65rem', fontWeight: 800,
                                                            background: (energyStatusColors[getEnergyStatus(invoice)] || energyStatusColors.a_vencer).bg, 
                                                            color: (energyStatusColors[getEnergyStatus(invoice)] || energyStatusColors.a_vencer).color, 
                                                            border: `1px solid ${(energyStatusColors[getEnergyStatus(invoice)] || energyStatusColors.a_vencer).color}20`,
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            {(energyStatusColors[getEnergyStatus(invoice)] || energyStatusColors.a_vencer).label}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: '0.7rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#1e3a8a', fontWeight: 700 }}>
                                                        {invoice.parent_invoice_id ? 'CONTA INCORPORADA (Atual)' : 'CONTA PRINCIPAL'}
                                                    </div>
                                                    <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#1e3a8a', fontWeight: 700 }}>UC: {consumerUnit?.numero_uc || '-'}</div>
                                                    <div style={{ fontSize: '0.85rem', color: '#1e3a8a', fontWeight: 700 }}>Ref: {invoice.mes_referencia ? invoice.mes_referencia.substring(0, 7).split('-').reverse().join('/') : '-'}</div>
                                                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#1e3a8a', margin: '0.25rem 0' }}>{formatCurrency(invoice.valor_concessionaria)}</div>
                                                    <div style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', color: '#1e3a8a' }}>
                                                        <Clock size={12} />
                                                        Venc: {invoice.vencimento_concessionaria ? invoice.vencimento_concessionaria.split('-').reverse().join('/') : (invoice.vencimento ? invoice.vencimento.split('-').reverse().join('/') : '-')}
                                                    </div>
                                                </div>

                                                {/* Spacer line */}
                                                <div style={{ position: 'relative', height: '1.5rem', width: '100%' }}>
                                                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '2px', backgroundColor: '#94a3b8' }} />
                                                </div>

                                                {/* Children container */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', position: 'relative' }}>
                                                    {childInvoices.map((child, index) => {
                                                        const isLast = index === childInvoices.length - 1;
                                                        const childStatus = energyStatusColors[getEnergyStatus(child)] || energyStatusColors.a_vencer;
                                                        return (
                                                            <div key={child.id} style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', paddingLeft: '50%' }}>
                                                                {/* Elbow line */}
                                                                <div style={{ position: 'absolute', left: '50%', top: '50%', width: '15px', height: '2px', backgroundColor: '#94a3b8', transform: 'translateY(-50%)' }} />
                                                                {/* Vertical line continuation */}
                                                                {!isLast && <div style={{ position: 'absolute', left: '50%', top: 0, bottom: '-1rem', width: '2px', backgroundColor: '#94a3b8' }} />}
                                                                {/* Top half line */}
                                                                <div style={{ position: 'absolute', left: '50%', top: 0, height: '50%', width: '2px', backgroundColor: '#94a3b8' }} />

                                                                {/* Sub Node Card */}
                                                                <div 
                                                                    onClick={() => onViewInvoice && onViewInvoice(child)}
                                                                    style={{ 
                                                                        width: 'calc(100% - 15px)', background: '#0f172a', borderRadius: '12px', padding: '0.85rem 1.25rem', color: 'white', position: 'relative', boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                                                                        cursor: onViewInvoice ? 'pointer' : 'default', transition: 'transform 0.2s',
                                                                        display: 'flex', flexDirection: 'column'
                                                                    }}
                                                                    onMouseEnter={e => { if(onViewInvoice) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                                                    onMouseLeave={e => { if(onViewInvoice) e.currentTarget.style.transform = 'none'; }}
                                                                >
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                                        <span style={{ 
                                                                            padding: '0.2rem 0.6rem', borderRadius: '99px', fontSize: '0.65rem', fontWeight: 800,
                                                                            background: childStatus.bg, color: childStatus.color, border: `1px solid ${childStatus.color}20`,
                                                                            textTransform: 'uppercase', marginBottom: '0.5rem'
                                                                        }}>
                                                                            {childStatus.label}
                                                                        </span>
                                                                        <button 
                                                                            onClick={(e) => { e.stopPropagation(); handleUnlinkChild(child.id); }}
                                                                            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', padding: '0.25rem', cursor: 'pointer', color: '#fca5a5', display: 'flex' }}
                                                                            title="Desvincular"
                                                                        >
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                    </div>
                                                                    <div style={{ fontSize: '0.65rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CONTA INCORPORADA</div>
                                                                    <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', fontWeight: 600 }}>UC: {consumerUnit?.numero_uc || '-'}</div>
                                                                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Ref: {child.mes_referencia ? child.mes_referencia.substring(0, 7).split('-').reverse().join('/') : '-'}</div>
                                                                    <div style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0.25rem 0' }}>{formatCurrency(child.valor_concessionaria)}</div>
                                                                    <div style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#cbd5e1' }}>
                                                                        <Clock size={12} />
                                                                        Venc: {child.vencimento_concessionaria ? child.vencimento_concessionaria.split('-').reverse().join('/') : (child.vencimento ? child.vencimento.split('-').reverse().join('/') : '-')}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                                Nenhuma conta vinculada.
                                            </div>
                                        )}

                                        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexDirection: 'column' }}>
                                            <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#475569' }}>Pesquisar e vincular manualmente:</div>
                                            <div style={{ display: 'flex', gap: '0.5rem', width: '100%', maxWidth: '400px' }}>
                                                <input 
                                                    type="text" 
                                                    value={searchChild} 
                                                    onChange={e => setSearchChild(e.target.value)} 
                                                    placeholder="Mês de ref. (ex: 03/2026)" 
                                                    style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} 
                                                    onKeyDown={e => e.key === 'Enter' && handleSearchChild()}
                                                />
                                                <button 
                                                    onClick={handleSearchChild}
                                                    disabled={isSearchingChild}
                                                    style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                >
                                                    {isSearchingChild ? <Loader2 size={18} className="animate-spin" color="#64748b" /> : <Search size={18} color="#64748b" />}
                                                </button>
                                            </div>

                                            {searchResults.length > 0 && (
                                                <div style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', marginTop: '0.5rem', overflow: 'hidden' }}>
                                                    {searchResults.map(res => (
                                                        <div key={res.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'white', borderBottom: '1px solid #f1f5f9' }}>
                                                            <div>
                                                                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#334155' }}>Ref: {res.mes_referencia ? res.mes_referencia.substring(0, 7).split('-').reverse().join('/') : '-'}</div>
                                                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Valor: {formatCurrency(res.valor_concessionaria)}</div>
                                                            </div>
                                                            <button 
                                                                onClick={() => handleLinkChild(res.id)}
                                                                style={{ background: '#eff6ff', color: '#2563eb', border: 'none', padding: '0.4rem 0.75rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}
                                                            >
                                                                Vincular
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </CollapsibleSection>
                            </div>
                        )}

                        <hr style={{ margin: '1.5rem 0', border: 'none', borderTop: '2px solid #f1f5f9' }} />

                        {/* Saldo Display */}
                        {!isEditing && (
                            <div style={{ 
                                padding: '1rem', borderRadius: '12px', 
                                background: (invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0)))) >= -0.01 ? '#f0fdf4' : '#fef2f2',
                                border: `1px solid ${(invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0)))) >= -0.01 ? '#bbf7d0' : '#fecaca'}`,
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}>
                                <span style={{ fontSize: '1rem', fontWeight: 800, color: (invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0)))) >= -0.01 ? '#166534' : '#dc2626' }}>SALDO (MARGEM)</span>
                                <span style={{ fontSize: '1.5rem', fontWeight: 900, color: (invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0)))) >= -0.01 ? '#166534' : '#dc2626' }}>
                                    {formatCurrency(invoice.valor_a_pagar - (Number(invoice.valor_concessionaria) || ((Number(invoice.iluminacao_publica) || 0) + (Number(invoice.tarifa_minima) || 0) + (Number(invoice.outros_lancamentos) || 0) + (Number(invoice.consumo_reais) || 0))))}
                                </span>
                            </div>
                        )}
                    </div>

                    {!isEditing && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <CollapsibleSection title="Histórico e Observações" icon={Clock} defaultOpen={false} noGrid={true}>
                                <div style={{ width: '100%' }}>
                                    <HistoryTimeline
                                        entityType="invoice"
                                        entityId={invoice.id}
                                        entityName={`Fatura ${invoice.mes_referencia} - UC ${consumerUnit?.numero_uc}`}
                                        isInline={true}
                                        compact={true}
                                        hideHeader={true}
                                    />
                                </div>
                            </CollapsibleSection>
                        </div>
                    )}

                    {/* Ações */}
                    {isEditing && (
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                            <button 
                                onClick={handleToggleEdit}
                                style={{ flex: 1, padding: '1rem', borderRadius: '12px', border: '2px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={handleSaveEdit}
                                disabled={loading}
                                style={{ flex: 1, padding: '1rem', borderRadius: '12px', border: 'none', background: branding?.primary_color || '#003366', color: 'white', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                            >
                                {loading ? 'Salvando...' : <><Save size={18} /> Salvar Alterações</>}
                            </button>
                        </div>
                    )}

                    {paymentStatus === 'success' && (
                        <div style={{ 
                            marginTop: '1.5rem', 
                            padding: '1.25rem', 
                            background: '#f0fdf4', 
                            border: '1px solid #22c55e', 
                            borderRadius: '16px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.75rem', 
                            color: '#166534', 
                            fontSize: '0.9rem',
                            animation: 'slideUp 0.3s ease-out'
                        }}>
                            <div style={{ background: '#22c55e', color: 'white', borderRadius: '50%', padding: '4px', display: 'flex' }}>
                                <CheckCircle2 size={16} />
                            </div>
                            <span style={{ fontWeight: 600 }}>Pagamento processado e status atualizado com sucesso!</span>
                        </div>
                    )}

                    {/* Hidden wrapper for PDF capture */}
                    <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', pointerEvents: 'none' }}>
                        <div ref={hiddenRef}>
                            {invoiceToDownload && renderHiddenInvoiceDetail(invoiceToDownload)}
                        </div>
                    </div>

                    {isGeneratingPdf && (
                        <div className="generation-overlay" style={{
                            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', zIndex: 1050, color: 'white', flexDirection: 'column'
                        }}>
                            <Loader2 size={48} className="spin-animation" style={{ color: branding?.secondary_color || '#ff6600', animation: 'spin 1s linear infinite' }} />
                            <p style={{ marginTop: '1rem', fontWeight: 600, fontSize: '1.1rem' }}>Gerando PDF combinado...</p>
                            <p style={{ fontSize: '0.875rem', opacity: 0.8 }}>Mesclando Detalhamento com Boleto Asaas.</p>
                        </div>
                    )}

                    <style>{`
                        @keyframes spin { to { transform: rotate(360deg); } }
                    `}</style>
                </div>
            </div>
        </div>
    );
}
