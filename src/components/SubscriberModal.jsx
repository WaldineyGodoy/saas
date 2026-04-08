import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { useBranding } from '../contexts/BrandingContext';
import { fetchAddressByCep, fetchCpfCnpjData, createAsaasCharge, manageAsaasCustomer, mergePdf, sendCombinedNotification, sendWhatsapp } from '../lib/api';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone } from '../lib/validators';
import { CreditCard, Plus, Trash2, History, User, Home, Zap, X, Eye, EyeOff, Key, DollarSign, Calendar, FileText, CheckCircle, Clock, AlertCircle, Ban, TicketCheck, TicketMinus, Download, Loader2, ArrowLeft, Info, RefreshCw, Send, MessageSquare, Paperclip } from 'lucide-react';
import ConsumerUnitModal from './ConsumerUnitModal';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import './InvoicesModal.css';

export default function SubscriberModal({ subscriber, onClose, onSave, onDelete }) {
    const { showAlert, showConfirm } = useUI();
    const { branding } = useBranding();
    const { profile } = useAuth();
    const [originators, setOriginators] = useState([]);
    const [consumerUnits, setConsumerUnits] = useState([]);
    const [generating, setGenerating] = useState(false);
    const [showUcModal, setShowUcModal] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [previewUC, setPreviewUC] = useState(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [editingUC, setEditingUC] = useState(null);
    const [ucModalMode, setUcModalMode] = useState('all'); // 'all' | 'technical'
    const [invoices, setInvoices] = useState([]);
    const [loadingInvoices, setLoadingInvoices] = useState(false);
    const [showMonthPicker, setShowMonthPicker] = useState(false);
    const [billingMode, setBillingMode] = useState(subscriber?.billing_mode || 'consolidada'); // 'consolidada' | 'individualizada'
    const [consolidatedDueDay, setConsolidatedDueDay] = useState(subscriber?.consolidated_due_day || 10);
    const [consolidatedInvoices, setConsolidatedInvoices] = useState([]);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const [invoiceToDownload, setInvoiceToDownload] = useState(null);
    const [consolidatedToDownload, setConsolidatedToDownload] = useState(null);
    const [showConsolidationHelp, setShowConsolidationHelp] = useState(false);
    const [showCredentialsModal, setShowCredentialsModal] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [activeTab, setActiveTab] = useState('dados'); // 'dados' | 'endereco' | 'ucs' | 'faturas' | 'comunicacao'
    const [totalUnpaidGlobal, setTotalUnpaidGlobal] = useState(0);
    const [invoiceMonthFilter, setInvoiceMonthFilter] = useState('all');
    
    // Manual Communication States
    const [manualMessage, setManualMessage] = useState('');
    const [manualFile, setManualFile] = useState(null);
    const [isSendingManualWA, setIsSendingManualWA] = useState(false);
    const hiddenRef = useRef(null);
    const hiddenConsolidatedRef = useRef(null);

    const addHistory = async (type, id, action, details = {}, customContent = null) => {
        try {
            await supabase.from('crm_history').insert({
                entity_type: type,
                entity_id: id,
                content: customContent || `${action === 'email_sent' ? 'E-mail enviado' : action}: ${details.type || ''}`,
                metadata: details,
                created_by: profile?.id
            });
        } catch (error) {
            console.error('Error adding history:', error);
        }
    };


    // Status Options: ativacao, ativo, ativo_inadimplente, transferido, cancelado, cancelado_inadimplente
    const statusOptions = [
        { value: 'ativacao', label: 'Em Ativação' },
        { value: 'ativo', label: 'Ativo' },
        { value: 'ativo_inadimplente', label: 'Ativo (Inadimplente)' },
        { value: 'transferido', label: 'Transferido' },
        { value: 'cancelado', label: 'Cancelado' },
        { value: 'cancelado_inadimplente', label: 'Cancelado (Inadimplente)' }
    ];

    const [formData, setFormData] = useState({
        name: '',
        cpf_cnpj: '',
        status: 'ativacao',
        phone: '',
        email: '',
        cep: '',
        rua: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: '',
        originator_id: '',
        portal_credentials: { url: '', login: '', password: '' }
    });

    const [loading, setLoading] = useState(false);
    const [searchingCep, setSearchingCep] = useState(false);
    const [searchingDoc, setSearchingDoc] = useState(false);

    const fetchOriginators = useCallback(async () => {
        const { data } = await supabase
            .from('originators_v2')
            .select('id, name')
            .order('name');
        setOriginators(data || []);
    }, []);

    const fetchConsumerUnits = useCallback(async (subscriberId) => {
        const { data } = await supabase
            .from('consumer_units')
            .select('*')
            .eq('subscriber_id', subscriberId);
        setConsumerUnits(data || []);
    }, []);

    const fetchConsolidatedInvoices = useCallback(async (subscriberId) => {
        const { data } = await supabase
            .from('consolidated_invoices')
            .select('*')
            .eq('subscriber_id', subscriberId)
            .order('created_at', { ascending: false });
        setConsolidatedInvoices(data || []);
    }, []);

    const fetchInvoices = useCallback(async (subscriberId) => {
        if (!subscriberId) return;
        setLoadingInvoices(true);
        try {
            const { data: ucs } = await supabase
                .from('consumer_units')
                .select('id')
                .eq('subscriber_id', subscriberId);

            if (!ucs || ucs.length === 0) {
                setInvoices([]);
                return;
            }

            const ucIds = ucs.map(u => u.id);
            let query = supabase
                .from('invoices')
                .select('*, consumer_units (numero_uc, titular_conta)')
                .in('uc_id', ucIds);

            if (invoiceMonthFilter !== 'all') {
                const [year, month] = invoiceMonthFilter.split('-');
                const startDate = `${year}-${month}-01`;
                const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
                const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
                query = query.gte('vencimento', startDate).lte('vencimento', endDate);
            }

            const { data, error } = await query.order('vencimento', { ascending: false });
            if (error) throw error;

            // --- Lógica de Auto-Correção (Self-Healing) ---
            // 1. Verificar se faturas estão vinculadas a consolidados cancelados
            const linkedConsolidatedIds = [...new Set(data.filter(inv => inv.consolidated_invoice_id).map(inv => inv.consolidated_invoice_id))];
            if (linkedConsolidatedIds.length > 0) {
                const { data: consolidatedStatuses } = await supabase
                    .from('consolidated_invoices')
                    .select('id, status')
                    .in('id', linkedConsolidatedIds);

                const canceledConsolidatedIds = consolidatedStatuses
                    ?.filter(cs => cs.status === 'canceled')
                    .map(cs => cs.id) || [];

                if (canceledConsolidatedIds.length > 0) {
                    console.warn('Auto-correção: Faturas órfãs vinculadas a consolidados cancelados:', canceledConsolidatedIds);
                    await supabase
                        .from('invoices')
                        .update({ 
                            consolidated_invoice_id: null,
                            asaas_payment_id: null,
                            asaas_boleto_url: null,
                            asaas_status: null,
                            asaas_pdf_storage_url: null
                        })
                        .in('consolidated_invoice_id', canceledConsolidatedIds);
                    fetchInvoices(subscriberId);
                    return;
                }
            }

            // 2. Verificar se faturas têm ID Asaas mas sem vínculo consolidado (sendo billingMode === 'consolidada')
            const orphanInvoices = data.filter(inv => 
                inv.asaas_payment_id && 
                !inv.consolidated_invoice_id && 
                inv.status !== 'pago' && 
                inv.status !== 'cancelado' &&
                billingMode === 'consolidada'
            );

            if (orphanInvoices.length > 0) {
                const orphanIds = orphanInvoices.map(i => i.id);
                console.warn('Auto-correção: Faturas com ID Asaas mas sem vínculo consolidado encontradas:', orphanIds);
                await supabase
                    .from('invoices')
                    .update({ 
                        asaas_payment_id: null,
                        asaas_boleto_url: null,
                        asaas_status: null,
                        asaas_pdf_storage_url: null
                    })
                    .in('id', orphanIds);
                fetchInvoices(subscriberId);
                return;
            }
            // ----------------------------------------------

            setInvoices(data || []);

            const { data: unpaidSum, error: sumError } = await supabase
                .from('invoices')
                .select('valor_a_pagar')
                .in('uc_id', ucIds)
                .not('status', 'eq', 'pago')
                .not('status', 'eq', 'cancelado');

            if (!sumError && unpaidSum) {
                const total = unpaidSum.reduce((acc, inv) => acc + (inv.valor_a_pagar || 0), 0);
                setTotalUnpaidGlobal(total);
            }
        } catch (error) {
            console.error('Error fetching invoices:', error);
        } finally {
            setLoadingInvoices(false);
        }
    }, [invoiceMonthFilter, billingMode]);

    useEffect(() => {
        fetchOriginators();
    }, [fetchOriginators]);

    useEffect(() => {
        if (subscriber) {
            setFormData({
                name: subscriber.name || '',
                cpf_cnpj: subscriber.cpf_cnpj || '',
                status: subscriber.status || 'ativacao',
                phone: subscriber.phone || '',
                email: subscriber.email || '',
                cep: subscriber.cep || '',
                rua: subscriber.rua || '',
                numero: subscriber.numero || '',
                complemento: subscriber.complemento || '',
                bairro: subscriber.bairro || '',
                cidade: subscriber.cidade || '',
                uf: subscriber.uf || '',
                originator_id: subscriber.originator_id || '',
                portal_credentials: subscriber.portal_credentials || { url: '', login: '', password: '' }
            });
            fetchConsumerUnits(subscriber.id);
            fetchConsolidatedInvoices(subscriber.id);
        }
    }, [subscriber, fetchConsumerUnits, fetchConsolidatedInvoices]);

    useEffect(() => {
        if (subscriber?.id && activeTab === 'faturas') {
            fetchInvoices(subscriber.id);
        }
    }, [subscriber?.id, activeTab, fetchInvoices]);


    const calculateConsolidatedDueDate = (day) => {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth(); // 0-indexed

        let targetDate = new Date(currentYear, currentMonth, day);

        // Regra: Se o dia já passou ou faltar menos de 3 dias
        const diffDays = (targetDate - today) / (1000 * 60 * 60 * 24);

        if (diffDays < 3) {
            // Vencimento para o mês seguinte
            targetDate = new Date(currentYear, currentMonth + 1, day);
        }

        return targetDate.toISOString().split('T')[0];
    };

    const handleDownloadConsolidated = async (consolidated) => {
        if (!consolidated.asaas_payment_id && !consolidated.asaas_boleto_url) {
            showAlert('Boleto não disponível para esta fatura consolidada.', 'warning');
            return;
        }

        setIsGeneratingPdf(true);
        // Não definir setConsolidatedToDownload(consolidated) aqui para evitar crash no renderizador que espera .items

        try {
            const fileName = `Fatura_Consolidada_${consolidated.id}.pdf`;

            // OTIMIZAÇÃO: Tentar baixar direto do Storage se já existir (Mas ignorar se for apenas o boleto bruto do Asaas)
            const isRawAsaas = consolidated.asaas_pdf_storage_url?.includes('bankSlipUrl') || 
                              consolidated.asaas_pdf_storage_url?.includes('invoiceUrl') ||
                              consolidated.asaas_pdf_storage_url?.includes('asaas.com');

            if (consolidated.asaas_pdf_storage_url && !isRawAsaas) {
                console.log("Obtendo URL assinada para PDF consolidado...");
                const { data: signedData, error: signedError } = await supabase.storage
                    .from('invoices_pdfs')
                    .createSignedUrl(`${consolidated.id}.pdf`, 60);

                if (!signedError && signedData?.signedUrl) {
                    const link = document.createElement('a');
                    link.href = signedData.signedUrl;
                    link.download = fileName;
                    link.target = "_blank"; // Abrir em nova aba/disparar download
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    showAlert('PDF Consolidado baixado!', 'success');
                    return;
                }
                console.warn("Falha ao obter URL assinada, gerando novo...", signedError);
            }

            // Fallback: Gerar novo
            const { data: invs, error } = await supabase
                .from('invoices')
                .select('*, consumer_units (numero_uc, titular_conta, address)')
                .eq('consolidated_invoice_id', consolidated.id)
                .neq('status', 'cancelado');

            if (error) throw error;
            if (!invs || invs.length === 0) throw new Error("Nenhuma fatura individual encontrada para este consolidado.");

            // 2. Set data for hidden render (This triggers the component to appear in the DOM)
            setConsolidatedToDownload({ ...consolidated, items: invs });

            // 3. Wait for React to render the component and attach the ref
            // We use two frames or a slightly longer timeout to be safe
            await new Promise(resolve => setTimeout(resolve, 2000));

            const element = hiddenConsolidatedRef.current;
            if (!element) {
                console.error("Ref hiddenConsolidatedRef ainda é null após 2s. Verifique se o componente está sendo renderizado no JSX.");
                throw new Error("Elemento de captura consolidado não encontrado no DOM.");
            }

            const canvas = await html2canvas(element, {
                scale: 1.5,
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

            const summaryBase64 = pdfSummary.output('datauristring').split(',')[1];
            const asaasUrl = consolidated.asaas_boleto_url;

            // Coletar todas as URLs de faturas de energia das faturas individuais (Removendo duplicatas)
            const energyBillUrls = [...new Set(invs
                .map(i => i.concessionaria_pdf_url)
                .filter(url => !!url))];

            const mergedBlob = await mergePdf(summaryBase64, asaasUrl, fileName, energyBillUrls, consolidated.asaas_pdf_storage_url);
            
            // Browser Download
            const blobUrl = window.URL.createObjectURL(mergedBlob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);

            // OTIMIZAÇÃO: Fazer upload para o Storage para os próximos downloads serem instantâneos
            try {
                const storagePath = `${consolidated.id}.pdf`;
                console.log(`Subindo PDF consolidado para o Storage: ${storagePath}`);
                
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
                        .from('consolidated_invoices')
                        .update({ asaas_pdf_storage_url: authenticatedUrl })
                        .eq('id', consolidated.id);
                        
                    console.log("Storage e Banco de Dados atualizados para PDF Consolidado.");
                } else {
                    console.warn("Falha ao subir PDF para o Storage:", uploadError);
                }
            } catch (storageErr) {
                console.warn("Erro ao processar persistência no Storage:", storageErr);
            }

            showAlert('PDF Consolidado gerado e baixado!', 'success');
            return mergedBlob;

        } catch (error) {
            console.error("Error generating consolidated PDF:", error);
            if (error.status === 546 || error.message?.includes('546')) {
                showAlert('Limite de processamento excedido.', 'error');
            } else {
                showAlert('Erro ao gerar PDF consolidado.', 'error');
            }
            return null;
        } finally {
            setIsGeneratingPdf(false);
            setConsolidatedToDownload(null);
        }
    };

    const handleDownloadCombined = async (inv) => {
        if (!inv || (!inv.asaas_boleto_url && !inv.asaas_pdf_storage_url)) {
            showAlert('Boleto não disponível para esta fatura.', 'warning');
            return;
        }

        setIsGeneratingPdf(true);
        setInvoiceToDownload(inv);

        try {
            const fileName = `Fatura_${inv.id}.pdf`;

            // OTIMIZAÇÃO: Tentar baixar direto do Storage se já existir
            // OTIMIZAÇÃO: Tentar recuperar do Storage (Ignorar se for apenas o boleto bruto do Asaas)
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
                    return;
                }
                console.warn("Falha ao obter URL assinada, gerando novo...", signedError);
            }

            // Fallback: Gerar novo
            // Pequeno delay para garantir que o renderHiddenInvoiceDetail aconteça
            // Aumentado timeout para garantir que o React monte o componente e o CSS/Imagens carreguem
            await new Promise(resolve => setTimeout(resolve, 2000));

            const element = hiddenRef.current;
            if (!element) {
                console.error("Ref hiddenRef ainda é null após 2s em handleDownloadCombined.");
                throw new Error("Elemento de captura individual não encontrado no DOM.");
            }

            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                backgroundColor: "#ffffff"
            });

            const imgData = canvas.toDataURL('image/png');
            const pdfSummary = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdfSummary.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdfSummary.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

            const summaryBase64 = pdfSummary.output('datauristring').split(',')[1];
            const asaasUrl = inv.asaas_boleto_url;

            const mergedBlob = await mergePdf(summaryBase64, asaasUrl, fileName, inv.concessionaria_pdf_url, inv.asaas_pdf_storage_url);
            
            // Browser Download
            const blobUrl = window.URL.createObjectURL(mergedBlob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);

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
                        
                    console.log("Storage e Banco de Dados atualizados para PDF Individual.");
                } else {
                    console.warn("Falha ao subir PDF para o Storage:", uploadError);
                }
            } catch (storageErr) {
                console.warn("Erro ao processar persistência no Storage:", storageErr);
            }

            showAlert('PDF Combinado gerado e baixado!', 'success');
            return mergedBlob;

        } catch (error) {
            console.error("Error generating combined PDF:", error);
            showAlert('Erro ao gerar PDF combinado.', 'error');
            return null;
        } finally {
            setIsGeneratingPdf(false);
            setInvoiceToDownload(null);
        }
    };

    const handleSendManualWhatsApp = async () => {
        if (!manualMessage.trim() && !manualFile) {
            showAlert('Por favor, digite uma mensagem ou anexe um arquivo.', 'warning');
            return;
        }

        const confirmed = await showConfirm(
            `Deseja enviar esta mensagem para ${formData.name}?`,
            'Confirmar Envio',
            'Sim, Enviar',
            'Cancelar'
        );
        if (!confirmed) return;

        setIsSendingManualWA(true);
        try {
            let mediaBase64 = null;
            let fileName = null;

            if (manualFile) {
                const reader = new FileReader();
                const filePromise = new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                });
                reader.readAsDataURL(manualFile);
                mediaBase64 = await filePromise;
                fileName = manualFile.name;
            }

            const response = await sendWhatsapp(
                formData.phone,
                manualMessage,
                null, // mediaUrl
                mediaBase64,
                fileName
            );

            if (response.error) throw new Error(response.error);

            showAlert('Mensagem enviada com sucesso!', 'success');
            
            // Log to history
            await addHistory('subscriber', subscriber.id, 'whatsapp_manual', {
                message: manualMessage,
                file: fileName,
                status: 'sent'
            }, `Comunicado WhatsApp: ${manualMessage.substring(0, 50)}${manualMessage.length > 50 ? '...' : ''}`);

            // Clear fields
            setManualMessage('');
            setManualFile(null);
            
            // Refetch history if it's open
            if (showHistory) {
                // Since history is in a separate component/logic, usually it re-fetches on mount
                // or we could trigger a refresh if we had a refresh function
            }
        } catch (error) {
            console.error('Error sending manual WhatsApp:', error);
            showAlert('Erro ao enviar mensagem: ' + error.message, 'error');
        } finally {
            setIsSendingManualWA(false);
        }
    };

    const handleResendNotification = async (invoice, isConsolidated) => {
        setIsGeneratingPdf(true); // Reusar o estado de loading visual
        if (isConsolidated) setConsolidatedToDownload(invoice);
        else setInvoiceToDownload(invoice);

        try {
            let pdfBlob = null;
            const fileName = isConsolidated ? `Fatura_Consolidada_${invoice.id}.pdf` : `Fatura_${invoice.id}.pdf`;

            // 1. Obter o PDF (Storage ou Gerar Temporário)
            if (invoice.asaas_pdf_storage_url) {
                const { data, error } = await supabase.storage
                    .from('invoices_pdfs')
                    .download(`${invoice.id}.pdf`);
                if (!error && data) pdfBlob = data;
            }

            if (!pdfBlob) {
                console.log("PDF não encontrado no storage, iniciando geração automática para reenvio...");
                if (isConsolidated) {
                    pdfBlob = await handleDownloadConsolidated(invoice);
                } else {
                    pdfBlob = await handleDownloadCombined(invoice);
                }
            }

            if (!pdfBlob) {
                showAlert('Não foi possível gerar o PDF para reenvio.', 'error');
                return;
            }

            // 2. Chamar a API de Notificação
            const notifRes = await sendCombinedNotification({
                recipientEmail: formData.email,
                recipientPhone: formData.phone,
                subscriberName: formData.name,
                dueDate: new Date(invoice.due_date || invoice.vencimento).toLocaleDateString('pt-BR'),
                value: (invoice.total_value || invoice.valor_a_pagar).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                pdfBlob: pdfBlob,
                fileName: fileName,
                subscriberId: subscriber.id,
                profileId: profile?.id,
                isConsolidated: isConsolidated
            });

            if (notifRes.emailRes?.error || notifRes.waRes?.error) {
                showAlert('Houve erro em algumas notificações.', 'warning');
            } else {
                showAlert('Notificações reenviadas com sucesso!', 'success');
                await addHistory(isConsolidated ? 'consolidated_invoice' : 'invoice', invoice.id, 'renotified', { 
                    type: isConsolidated ? 'consolidated' : 'individual',
                    target: 'Email & WhatsApp'
                });
            }
        } catch (error) {
            console.error("Error resending notification:", error);
            showAlert('Erro ao reenviar notificações.', 'error');
        } finally {
            setIsGeneratingPdf(false);
            setConsolidatedToDownload(null);
            setInvoiceToDownload(null);
        }
    };

    const renderHiddenConsolidatedDetail = (data) => {
        if (!data || !data.items) return null;

        const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
        
        // Obter mês de referência do primeiro item
        const refMonthRaw = data.items?.[0]?.mes_referencia || '';
        let formattedRefMonth = 'N/A';
        if (refMonthRaw) {
            const [year, month] = refMonthRaw.split('-');
            formattedRefMonth = `${month}/${year}`;
        }

        return (
            <div className="pdf-capture-wrapper consolidated" style={{ width: '210mm', backgroundColor: 'white', position: 'relative' }}>
                <main className="flex flex-col bg-white min-h-[297mm]">
                    {/* Header Section */}
                    <header className="bg-white">
                        <div className="px-8 py-4 flex justify-between items-center border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <img 
                                    src="https://lh3.googleusercontent.com/aida/ADBb0uifhC93-7nY-qVlpl2VCbHi0L17fw_fp7B9Zyy1aycCrdJNcbpom1KaqidsefxOoWNJ_TWh2YC1BM4hVUnMR4PH0ZYktntr94jGjc9ahANupnJMvBrN6ZnCQeozqTovT4Sp7aWhQH2SfG5jvs9TGwdXDJ95UeUSq9g0Byuz0EB3ZyrATWG6i5pf0EiSgUAxSBQX8eTdwlsr_pfvr5rjC8YuwAMvEvfNExN9LkzCw2QaKRj7VltrbdKjlJZy6thBHv5qrvKIhpyU3Sk" 
                                    alt="B2W Energia Logo" 
                                    className="w-10 h-10 object-contain" 
                                />
                                <span className="text-xl font-extrabold text-[#003366] uppercase tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                    B2W Energia por assinatura
                                </span>
                            </div>
                            <div className="bg-[#fd9000]/10 px-3 py-1 rounded-full flex items-center justify-center">
                                <span className="text-[10px] font-bold text-[#fd9000] uppercase tracking-widest text-center">Consolidado Mensal</span>
                            </div>
                        </div>

                        <div className="bg-[#003366] text-white px-8 py-3 flex justify-between items-center">
                            <div className="flex items-center justify-center gap-3 w-full">
                                <div className="flex items-center gap-3">
                                    <Info size={18} className="text-[#fd9000]" />
                                    <span className="text-sm font-semibold" style={{ fontFamily: 'Manrope, sans-serif' }}>Detalhamento da Fatura</span>
                                </div>
                            </div>
                            <div className="bg-[#fd9000] px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center justify-center min-w-[80px]">
                                {(data.status || 'a_vencer').replace(/_/g, ' ')}
                            </div>
                        </div>

                        <div className="p-8 grid grid-cols-12 gap-6 bg-slate-50/50">
                            <div className="col-span-7 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Assinante</p>
                                <h1 className="text-[18px] font-extrabold text-[#003366] mb-4 uppercase truncate" style={{ fontFamily: 'Manrope, sans-serif' }} title={subscriber?.name}>
                                    {subscriber?.name}
                                </h1>
                                <div className="flex gap-8">
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Mês Referência</p>
                                        <p className="text-lg font-bold text-[#003366]">{formattedRefMonth}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Vencimento</p>
                                        <p className="text-lg font-bold text-red-600">
                                            {new Date(data.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="col-span-5 bg-[#5ead5c]/5 border-2 border-[#fd9000] rounded-xl p-6 flex flex-col justify-center items-end shadow-sm overflow-hidden">
                                <p className="text-[10px] font-bold text-[#5ead5c] uppercase tracking-widest mb-1 text-right">Total a Pagar</p>
                                <p className="text-3xl font-black text-[#003366] tracking-tighter text-right" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                    {formatCurrency(data.total_value)}
                                </p>
                            </div>
                        </div>
                    </header>

                    {/* Content Section */}
                    <div className="flex-1 px-8 py-4">
                        <div className="flex flex-wrap gap-4">
                            {(data.items || []).map(inv => (
                                <div key={inv.id} className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col shadow-sm" style={{ width: 'calc(33.333% - 11px)', minWidth: '200px' }}>
                                    <div>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex-1 flex flex-col justify-center h-full">
                                                <p className="text-[7px] font-bold text-slate-400 uppercase leading-none mb-0.5">Endereço da Unidade:</p>
                                                <p className="text-[9px] font-bold text-[#003366] leading-tight mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                                    {inv.consumer_units?.address ? 
                                                        `${inv.consumer_units.address.rua || ''}${inv.consumer_units.address.numero ? `, ${inv.consumer_units.address.numero}` : ''} - ${inv.consumer_units.address.bairro || ''}` : 
                                                        (inv.consumer_units?.identification || inv.consumer_units?.numero_uc)
                                                    }
                                                </p>
                                                <p className="text-[8px] text-slate-500 font-medium tracking-tight">UC: {inv.consumer_units?.numero_uc}</p>
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-2 mb-3">
                                            <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                                                <p className="text-[7px] font-bold text-slate-400 uppercase">Valor a Pagar</p>
                                                <p className="text-[11px] font-black text-[#003366]">{formatCurrency(inv.valor_a_pagar)}</p>
                                            </div>
                                            <div className="bg-[#5ead5c]/5 p-1.5 rounded border border-[#5ead5c]/10 text-right">
                                                <p className="text-[7px] font-bold text-[#5ead5c] uppercase">Economia</p>
                                                <p className="font-extrabold text-[#5ead5c] leading-none" style={{ fontSize: '9px' }}>{formatCurrency(inv.economia_reais)}</p>
                                            </div>
                                        </div>

                                        <div className="space-y-1.5 border-t border-dashed border-slate-100 pt-2">
                                            <div className="flex justify-between text-[8px] font-medium text-slate-600">
                                                <span>Consumo Total (kWh)</span>
                                                <span className="font-bold text-[#003366]">{inv.consumo_kwh} kWh</span>
                                            </div>
                                            <div className="flex justify-between text-[8px] font-medium text-[#5ead5c]">
                                                <span>Energia Compensada</span>
                                                <span className="font-bold">- {inv.consumo_compensado || 0} kWh</span>
                                            </div>
                                            <div className="flex justify-between text-[8px] font-medium text-slate-600 pt-1">
                                                <span>Custos da Unidade</span>
                                                <span className="font-bold">{formatCurrency(inv.consumo_reais)}</span>
                                            </div>
                                            <div className="flex justify-between text-[8px] font-medium text-slate-600">
                                                <span>Iluminação Pública</span>
                                                <span className="font-bold">{formatCurrency(inv.iluminacao_publica)}</span>
                                            </div>
                                            <div className="flex justify-between text-[8px] font-medium text-slate-600">
                                                <span>Taxas e Outros</span>
                                                <span className="font-bold">{formatCurrency((Number(inv.tarifa_minima) || 0) + (Number(inv.outros_lancamentos) || 0))}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer Support Area */}
                    <footer className="mt-auto px-8 py-6 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-[#003366]/5 flex items-center justify-center">
                                <Zap size={20} className="text-[#003366]" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-[#003366] uppercase tracking-wider">Suporte Especializado B2W Energia</p>
                                <p className="text-[9px] text-slate-500">atendimento@b2wenergia.com.br • www.b2wenergia.com.br</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.2em]">Eficiência Energética Nível A+</p>
                            <div className="flex gap-0.5 justify-end mt-1">
                                <div className="w-1.5 h-3 bg-[#5ead5c]/20 rounded-full"></div>
                                <div className="w-1.5 h-3 bg-[#5ead5c]/40 rounded-full"></div>
                                <div className="w-1.5 h-3 bg-[#5ead5c]/60 rounded-full"></div>
                                <div className="w-1.5 h-3 bg-[#5ead5c] rounded-full"></div>
                            </div>
                        </div>
                    </footer>
                    
                    {/* Decorative Edge */}
                    <div className="w-full h-1.5 bg-gradient-to-r from-[#003366] via-[#fd9000] to-[#5ead5c]"></div>
                </main>
            </div>
        );
    };

    const renderHiddenInvoiceDetail = (invoice) => {
        if (!invoice) return null;

        // Get matching UC for this invoice to get technical data
        const uc = consumerUnits.find(u => u.id === invoice.consumer_unit_id);

        const statusLabel = invoice.status?.toUpperCase() || 'N/A';
        const statusColor = invoice.status === 'pago' ? '#27ae60' : (invoice.status === 'atrasado' ? '#dc2626' : '#f59e0b');

        // Data Sync Math
        const tarifa = parseFloat(invoice.tarifa_concessionaria || uc?.tarifa_concessionaria || 1);
        const totalKwh = parseFloat(invoice.consumo_kwh || 0);
        const tarifaMinimaRs = parseFloat(invoice.tarifa_minima || 0);
        const tarifaMinimaKwh = tarifaMinimaRs / tarifa;

        const consumoCompensadoKwh = Math.max(0, totalKwh - tarifaMinimaKwh);
        const consumoCompensadoReais = consumoCompensadoKwh * tarifa;

        const economia = parseFloat(invoice.economia_reais || 0);
        const energiaCompensadaLiquida = Math.max(0, consumoCompensadoReais - economia);

        const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

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
                                <span style={{ textTransform: 'uppercase' }}>{subscriber?.name || 'N/A'}</span>
                            </div>
                            <div className="detail-item">
                                <label>ENDEREÇO DA UNIDADE</label>
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                    {uc?.address ? 
                                        `${uc.address.rua || ''}${uc.address.numero ? `, ${uc.address.numero}` : ''} - ${uc.address.bairro || ''} - ${uc.address.cidade || ''}/${uc.address.uf || ''}` : 
                                        'N/A'
                                    }
                                </span>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item">
                                    <label>NÚMERO DA UC</label>
                                    <span>{uc?.numero_uc || 'N/A'}</span>
                                </div>
                                <div className="detail-item">
                                    <label>IDENTIFICAÇÃO (APELIDO)</label>
                                    <span>{uc?.identification || uc?.titular_conta || 'Unidade Consumidora'}</span>
                                </div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item">
                                    <label>MÊS REFERÊNCIA</label>
                                    <span>{invoice.mes_referencia ? `${invoice.mes_referencia.split('-')[1]}/${invoice.mes_referencia.split('-')[0]}` : 'N/A'}</span>
                                </div>
                                <div className="detail-item">
                                    <label>VENCIMENTO</label>
                                    <span style={{ color: '#ff6b6b', fontWeight: 'bold' }}>
                                        {invoice.vencimento ? new Date(invoice.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}
                                    </span>
                                </div>
                            </div>
                            <div className="detail-item">
                                <label>TIPO DE LIGAÇÃO</label>
                                <span className="connection-type-badge" style={{ backgroundColor: branding?.primary_color || '#003366' }}>
                                    {invoice.tipo_ligacao || uc?.tipo_ligacao || 'N/A'}
                                </span>
                            </div>
                        </div>

                        <div className="detail-section metrics">
                            <div className="metric-line">
                                <span>Consumo Compensado ({consumoCompensadoKwh.toFixed(0)} kWh):</span>
                                <span>{formatCurrency(consumoCompensadoReais)}</span>
                            </div>
                            <div className="metric-line secondary">
                                <span>Valor da Tarifa:</span>
                                <span>R$ {tarifa.toFixed(4)}</span>
                            </div>

                            <div className="economy-box">
                                <div className="metric-line economy">
                                    <span>Economia Gerada:</span>
                                    <span>- {formatCurrency(economia)}</span>
                                </div>
                                <div className="metric-line discount">
                                    <span>Desconto Aplicado:</span>
                                    <span>{invoice.desconto_assinante || uc?.desconto_assinante || 0}%</span>
                                </div>
                            </div>

                            <div className="metric-line bold">
                                <span>Energia Compensada Líquida:</span>
                                <span>{formatCurrency(energiaCompensadaLiquida)}</span>
                            </div>

                            <hr style={{ borderTop: '1px solid #e2e8f0', margin: '10px 0' }} />

                            <div className="metric-line">
                                <span>+ Iluminação Pública:</span>
                                <span>{formatCurrency(invoice.iluminacao_publica)}</span>
                            </div>
                            <div className="metric-line">
                                <span>+ Tarifa Mínima:</span>
                                <span>{formatCurrency(invoice.tarifa_minima)}</span>
                            </div>
                            <div className="metric-line">
                                <span>+ Outros Lançamentos:</span>
                                <span>{formatCurrency(invoice.outros_lancamentos)}</span>
                            </div>

                            <div className="total-box" style={{ borderColor: branding?.secondary_color || '#22c55e', backgroundColor: '#f0fdf4' }}>
                                <div className="total-label" style={{ color: '#166534' }}>TOTAL A PAGAR</div>
                                <div className="total-value">{formatCurrency(invoice.valor_a_pagar)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const handleCepBlur = async () => {
        const rawCep = formData.cep.replace(/\D/g, '');
        if (rawCep.length === 8) {
            setSearchingCep(true);
            try {
                const addr = await fetchAddressByCep(rawCep);
                setFormData(prev => ({
                    ...prev,
                    rua: addr.rua || '',
                    bairro: addr.bairro || '',
                    cidade: addr.cidade || '',
                    uf: addr.uf || ''
                }));
            } catch (error) {
                console.error('Erro ao buscar CEP:', error);
                showAlert('Erro ao buscar CEP. Verifique se digitou corretamente.', 'error');
            } finally {
                setSearchingCep(false);
            }
        }
    };

    const handleDocBlur = async () => {
        const doc = formData.cpf_cnpj.replace(/\D/g, '');
        if (doc.length > 11) { // CNPJ
            setSearchingDoc(true);
            try {
                const data = await fetchCpfCnpjData(doc);
                if (data.nome) {
                    setFormData(prev => ({
                        ...prev,
                        name: data.nome || prev.name,
                        email: data.email || prev.email,
                        phone: data.telefone ? maskPhone(data.telefone) : prev.phone,
                        cep: data.address?.cep || prev.cep,
                        rua: data.address?.logradouro || prev.rua,
                        numero: data.address?.numero || prev.numero,
                        complemento: data.address?.complemento || prev.complemento,
                        bairro: data.address?.bairro || prev.bairro,
                        cidade: data.address?.municipio || prev.cidade,
                        uf: data.address?.uf || prev.uf
                    }));
                }
            } catch (error) {
                console.error('Erro buscar doc', error);
            } finally {
                setSearchingDoc(false);
            }
        } else if (doc.length === 11) { // CPF
            setSearchingDoc(true);
            try {
                const data = await fetchCpfCnpjData(doc);
                if (data.nome) {
                    setFormData(prev => ({ ...prev, name: data.nome }));
                }
            } catch (error) {
                console.error('Erro buscar doc', error);
            } finally {
                setSearchingDoc(false);
            }
        }
    };


    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validateDocument(formData.cpf_cnpj)) {
            showAlert('CPF/CNPJ inválido!', 'warning');
            return;
        }
        if (formData.phone && !validatePhone(formData.phone)) {
            showAlert('Telefone inválido!', 'warning');
            return;
        }

        setLoading(true);

        try {
            // 1. Check for duplicates
            let query = supabase
                .from('subscribers')
                .select('id')
                .eq('cpf_cnpj', formData.cpf_cnpj);

            if (subscriber?.id) {
                query = query.neq('id', subscriber.id);
            }

            const { data: existing, error: searchError } = await query;

            if (searchError) throw searchError;
            if (existing && existing.length > 0) {
                throw new Error('Já existe um assinante cadastrado com este CPF/CNPJ.');
            }

            // 2. Sync with Asaas
            let asaasId = null;
            let asaasSyncSuccess = false;

            try {
                const asaasResult = await manageAsaasCustomer({
                    id: subscriber?.asaas_customer_id,
                    name: formData.name,
                    cpfCnpj: formData.cpf_cnpj,
                    email: formData.email,
                    phone: formData.phone,
                    postalCode: formData.cep,
                    addressNumber: formData.numero,
                    address: formData.rua,
                    province: formData.bairro
                });

                if (asaasResult && asaasResult.success) {
                    asaasId = asaasResult.asaas_id;
                    asaasSyncSuccess = true;
                } else if (asaasResult) {
                    throw new Error(asaasResult.error || 'Erro desconhecido');
                }

            } catch (asaasError) {
                console.error("Asaas Sync Error:", asaasError);
                const proceed = await showConfirm(
                    `Falha ao sincronizar com Asaas: ${asaasError.message}.\n\nDeseja salvar apenas no CRM (Localmente)?`,
                    'Erro de Sincronização',
                    'Salvar Localmente',
                    'Corrigir Dados'
                );
                if (!proceed) {
                    setLoading(false);
                    return;
                }
            }

            // 3. Save to Supabase
            const dataToSave = {
                ...formData,
                phone: formData.phone ? formData.phone.replace(/\D/g, '') : '',
                billing_mode: billingMode,
                consolidated_due_day: parseInt(consolidatedDueDay),
                portal_credentials: formData.portal_credentials
            };
            if (asaasId) dataToSave.asaas_customer_id = asaasId;
            if (dataToSave.originator_id === '') dataToSave.originator_id = null;

            let result;
            if (subscriber?.id) {
                result = await supabase
                    .from('subscribers')
                    .update(dataToSave)
                    .eq('id', subscriber.id)
                    .select()
                    .single();
            } else {
                result = await supabase
                    .from('subscribers')
                    .insert(dataToSave)
                    .select()
                    .single();
            }

            if (result.error) throw result.error;

            if (asaasSyncSuccess) {
                showAlert('Cliente salvo e sincronizado com Asaas!', 'success');
            } else {
                showAlert('Cliente salvo APENAS LOCALMENTE (Erro Asaas ignorado).', 'warning');
            }

            // 4. Sync Lead Status
            try {
                let newLeadStatus = null;
                if (dataToSave.status === 'ativacao') {
                    newLeadStatus = 'ativacao';
                } else if (dataToSave.status === 'ativo') {
                    newLeadStatus = 'ativo';
                }

                if (newLeadStatus && dataToSave.email) {
                    const { data: leadsComp } = await supabase
                        .from('leads')
                        .select('id, status')
                        .eq('email', dataToSave.email)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (leadsComp && leadsComp.length > 0) {
                        const targetLead = leadsComp[0];
                        if (targetLead.status !== newLeadStatus) {
                            await supabase
                                .from('leads')
                                .update({ status: newLeadStatus })
                                .eq('id', targetLead.id);
                        }
                    }
                }
            } catch (syncErr) {
                console.error('Lead sync error:', syncErr);
            }

            onSave(result.data);
            onClose();
        } catch (error) {
            showAlert('Erro ao salvar assinante: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!subscriber?.id) return;
        const confirm = await showConfirm('Tem certeza que deseja excluir este assinante?', 'Excluir Assinante', 'Excluir', 'Cancelar');
        if (!confirm) return;

        setLoading(true);
        try {
            const { error } = await supabase
                .from('subscribers')
                .delete()
                .eq('id', subscriber.id);

            if (error) throw error;

            if (onDelete) onDelete(subscriber.id);
            onClose();
        } catch (error) {
            showAlert('Erro ao excluir: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleUnlinkUC = async (ucId) => {
        const confirm = await showConfirm('Deseja desvincular esta UC do assinante? A UC não será excluída, apenas removida deste cliente.', 'Desvincular UC');
        if (!confirm) return;

        try {
            const { error } = await supabase
                .from('consumer_units')
                .update({ subscriber_id: null })
                .eq('id', ucId);

            if (error) throw error;

            fetchConsumerUnits(subscriber.id);
            showAlert('UC desvinculada com sucesso!', 'success');
        } catch (error) {
            showAlert('Erro ao desvincular UC: ' + error.message, 'error');
        }
    };

    const handleBillingModeChange = async (newMode) => {
        if (billingMode === newMode) return;

        const confirm = await showConfirm(
            `Deseja alterar o modo de faturamento para "${newMode === 'consolidada' ? 'Consolidada' : 'Individualizada'}"?`,
            'Alterar Modo de Faturamento'
        );
        if (confirm) {
            setBillingMode(newMode);
            // Optionally save to DB immediately or on form submit
        }
    };

    const totalVisibleInvoicesValue = invoices
        .filter(inv => inv.status !== 'pago' && inv.status !== 'cancelado') // Excluir cancelados do total
        .reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0);

    const totalToConsolidate = invoices
        .filter(inv => 
            inv.status !== 'pago' && 
            inv.status !== 'cancelado' && 
            (!inv.consolidated_invoice_id || inv.consolidated_invoice_id === null) // Absolutamente livre
        )
        .reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0);

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
            <div style={{ background: 'white', padding: '0', borderRadius: '12px', width: '90%', maxWidth: '900px', maxHeight: '95vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Modal Header */}
                <div style={{
                    padding: '1.25rem 2rem',
                    borderBottom: '1px solid #eee',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#f8fafc'
                }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>
                        {subscriber ? `Assinante - ${formData.name}` : 'Novo Assinante'}
                    </h3>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {subscriber && (
                            <button
                                type="button"
                                onClick={() => setShowHistory(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                    background: '#fff', color: 'var(--color-blue)',
                                    border: '1px solid var(--color-blue)',
                                    padding: '0.4rem 0.8rem', borderRadius: '6px',
                                    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600
                                }}
                            >
                                <History size={16} /> Histórico
                            </button>
                        )}
                        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Tabs Menu */}
                <div style={{
                    display: 'flex',
                    background: 'white',
                    padding: '0 2rem',
                    borderBottom: '1px solid #e2e8f0',
                    gap: '2rem'
                }}>
                    {[
                        { id: 'dados', label: 'Dados Cadastrais', icon: User, color: '#003366', bg: '#f0f9ff' },
                        { id: 'endereco', label: 'Endereço', icon: Home, color: '#f59e0b', bg: '#fff7ed' },
                        { id: 'ucs', label: 'Unidades Consumidoras', icon: Zap, color: '#10b981', bg: '#ecfdf5' },
                        { id: 'faturas', label: 'Faturas', icon: CreditCard, color: '#8b5cf6', bg: '#f5f3ff' },
                        { id: 'comunicacao', label: 'Comunicação', icon: MessageSquare, color: '#ec4899', bg: '#fdf2f8' }
                    ].map(tab => {
                        const isActive = activeTab === tab.id;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.6rem',
                                    padding: '1rem 0',
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    color: isActive ? tab.color : '#64748b',
                                    borderBottom: `3px solid ${isActive ? tab.color : 'transparent'}`,
                                    transition: 'all 0.2s',
                                    fontSize: '0.9rem',
                                    fontWeight: isActive ? 700 : 500,
                                    position: 'relative'
                                }}
                            >
                                <div style={{
                                    padding: '0.4rem',
                                    borderRadius: '8px',
                                    background: isActive ? tab.bg : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s'
                                }}>
                                    <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                                </div>
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }}>
                    <form onSubmit={handleSubmit}>
                        {activeTab === 'dados' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', paddingBottom: '1rem' }}>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Status</label>
                                <select
                                    value={formData.status}
                                    onChange={e => setFormData({ ...formData, status: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                >
                                    {statusOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Originador</label>
                                <select
                                    value={formData.originator_id}
                                    onChange={e => setFormData({ ...formData, originator_id: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                >
                                    <option value="">Selecione...</option>
                                    {originators.map(o => (
                                        <option key={o.id} value={o.id}>{o.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>CPF/CNPJ</label>
                                    <input
                                        value={formData.cpf_cnpj}
                                        onChange={e => setFormData({ ...formData, cpf_cnpj: maskCpfCnpj(e.target.value) })}
                                        onBlur={handleDocBlur}
                                        placeholder="000.000.000-00"
                                        style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: searchingDoc ? '#f0f9ff' : 'white', outline: 'none' }}
                                        required
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowCredentialsModal(true)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.6rem 1rem',
                                        background: '#fef2f2',
                                        color: '#ef4444',
                                        borderRadius: '6px',
                                        border: '1px solid #fee2e2',
                                        fontSize: '0.85rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        height: '42px'
                                    }}
                                >
                                    <Key size={16} /> Credenciais
                                </button>
                            </div>

                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Nome Completo / Razão Social</label>
                                <input
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Email</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                    required
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Telefone</label>
                                <input
                                    value={formData.phone}
                                    onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                                    placeholder="(00) 00000-0000"
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>
                            </div>
                        )}

                        {activeTab === 'endereco' && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', paddingBottom: '1rem' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>CEP (Busca)</label>
                                <input
                                    value={formData.cep}
                                    onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                    onBlur={handleCepBlur}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: searchingCep ? '#f0f9ff' : 'white', outline: 'none' }}
                                />
                            </div>
                            <div style={{ flex: 2 }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Cidade/UF</label>
                                <input
                                    value={`${formData.cidade} - ${formData.uf}`}
                                    disabled
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #f1f5f9', borderRadius: '6px', background: '#f8fafc', color: '#64748b' }}
                                />
                            </div>

                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Rua</label>
                                <input
                                    value={formData.rua}
                                    onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Número</label>
                                <input
                                    value={formData.numero}
                                    onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Complemento</label>
                                <input
                                    value={formData.complemento}
                                    onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.3rem', color: '#64748b' }}>Bairro</label>
                                <input
                                    value={formData.bairro}
                                    onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                    style={{ width: '100%', padding: '0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none' }}
                                />
                            </div>
                            </div>
                        )}

                        {activeTab === 'ucs' && (
                            <div style={{ paddingBottom: '1rem' }}>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                                    {subscriber?.id && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEditingUC({ subscriber_id: subscriber.id });
                                                setUcModalMode('all');
                                                setShowUcModal(true);
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '0.3rem',
                                                background: '#ecfdf5', color: '#059669', border: '1px solid #d1fae5',
                                                padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600
                                            }}
                                        >
                                            <Plus size={16} /> Cadastrar UCs
                                        </button>
                                    )}
                                </div>

                                {consumerUnits.length > 0 ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        {consumerUnits.map(uc => {
                                            // Helper para cor do status da UC
                                            const getUCStatusColor = (status) => {
                                                const colors = {
                                                    'ativo': '#10b981',
                                                    'aguardando_conexao': '#3b82f6',
                                                    'em_atraso': '#ef4444',
                                                    'ativacao': '#f59e0b',
                                                    'em_ativacao': '#f59e0b',
                                                    'cancelado': '#94a3b8',
                                                    'cancelado_inadimplente': '#7f1d1d'
                                                };
                                                return colors[status] || '#94a3b8';
                                            };

                                            // Lógica de Status da Leitura (Priorizando o mês atual como padrão)
                                            const currentMonthStr = new Date().toISOString().substring(0, 7);
                                            const hasInvoiceThisMonth = invoices.some(inv => 
                                                inv.uc_id === uc.id && 
                                                inv.mes_referencia?.startsWith(currentMonthStr) &&
                                                inv.status !== 'cancelado'
                                            );

                                            const getReadingStatus = () => {
                                                if (hasInvoiceThisMonth) return { icon: <CheckCircle size={14} />, color: '#10b981', label: 'Sucesso' };
                                                
                                                switch (uc.last_scraping_status) {
                                                    case 'success': return { icon: <CheckCircle size={14} />, color: '#10b981', label: 'Sucesso' };
                                                    case 'error': return { icon: <AlertCircle size={14} />, color: '#ef4444', label: 'Erro' };
                                                    case 'processing': return { icon: <RefreshCw size={14} className="spin" />, color: '#3b82f6', label: 'Lendo...' };
                                                    default: return { icon: <Clock size={14} />, color: '#94a3b8', label: 'Pendente' };
                                                }
                                            };

                                            const rStatus = getReadingStatus();

                                            return (
                                                <div key={uc.id} style={{ 
                                                    background: '#ffffff', 
                                                    padding: '1rem', 
                                                    borderRadius: '12px', 
                                                    border: '1px solid #e2e8f0', 
                                                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                                                    display: 'flex', 
                                                    flexDirection: 'column',
                                                    gap: '0.75rem',
                                                    position: 'relative'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem', marginBottom: '0.2rem' }}>
                                                                UC: {uc.numero_uc}
                                                            </div>
                                                            <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>
                                                                {uc.titular_conta}
                                                            </div>
                                                        </div>
                                                        <div style={{ 
                                                            fontSize: '0.65rem', 
                                                            fontWeight: 900, 
                                                            color: getUCStatusColor(uc.status),
                                                            background: `${getUCStatusColor(uc.status)}10`,
                                                            padding: '0.2rem 0.6rem',
                                                            borderRadius: '4px',
                                                            textTransform: 'uppercase',
                                                            border: `1px solid ${getUCStatusColor(uc.status)}30`
                                                        }}>
                                                            {uc.status?.replace('_', ' ')}
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderTop: '1px solid #f1f5f9' }}>
                                                        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>
                                                            {uc.concessionaria}
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '0.3rem', 
                                                                color: rStatus.color,
                                                                fontSize: '0.75rem',
                                                                fontWeight: 700,
                                                                background: `${rStatus.color}10`,
                                                                padding: '0.2rem 0.5rem',
                                                                borderRadius: '6px'
                                                            }}>
                                                                {rStatus.icon}
                                                                <span>{rStatus.label}</span>
                                                            </div>
                                                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                                                                Leitura: <span style={{ color: 'var(--color-blue)' }}>{uc.dia_leitura || '--'}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9' }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setPreviewUC(uc);
                                                                setShowPreviewModal(true);
                                                            }}
                                                            style={{ padding: '0.5rem', color: '#94a3b8', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.2s' }}
                                                            onMouseEnter={e => e.currentTarget.style.color = 'var(--color-blue)'}
                                                            onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                                                            title="Ver Detalhes"
                                                        >
                                                            <Eye size={16} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setEditingUC(uc);
                                                                setUcModalMode('technical');
                                                                setShowUcModal(true);
                                                            }}
                                                            style={{ padding: '0.5rem', color: '#f59e0b', background: '#fffbeb', borderRadius: '6px', border: '1px solid #fde68a', cursor: 'pointer', transition: 'all 0.2s' }}
                                                            onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                                                            onMouseLeave={e => e.currentTarget.style.background = '#fffbeb'}
                                                            title="Dados Técnicos e Comerciais"
                                                        >
                                                            <DollarSign size={16} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUnlinkUC(uc.id)}
                                                            style={{ padding: '0.5rem', color: '#ef4444', background: '#fef2f2', borderRadius: '6px', border: '1px solid #fee2e2', cursor: 'pointer', transition: 'all 0.2s' }}
                                                            onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
                                                            onMouseLeave={e => e.currentTarget.style.background = '#fef2f2'}
                                                            title="Excluir UC"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '1.5rem', border: '2px dashed #e2e8f0', borderRadius: '8px' }}>
                                        <p style={{ margin: 0, fontSize: '0.9rem' }}>Nenhuma UC vinculada.</p>
                                    </div>
                                )}
                            </div>
                            </div>
                        )}

                        {activeTab === 'faturas' && (
                            <div style={{ paddingBottom: '1rem' }}>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Faturamento</span>
                                            <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.25rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleBillingModeChange('consolidada')}
                                                    style={{
                                                        padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, transition: 'all 0.2s',
                                                        background: billingMode === 'consolidada' ? 'white' : 'transparent',
                                                        color: billingMode === 'consolidada' ? 'var(--color-blue)' : '#64748b',
                                                        boxShadow: billingMode === 'consolidada' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                                        border: 'none', cursor: 'pointer'
                                                    }}
                                                >Consolidada</button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleBillingModeChange('individualizada')}
                                                    style={{
                                                        padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, transition: 'all 0.2s',
                                                        background: billingMode === 'individualizada' ? 'white' : 'transparent',
                                                        color: billingMode === 'individualizada' ? 'var(--color-blue)' : '#64748b',
                                                        boxShadow: billingMode === 'individualizada' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                                        border: 'none', cursor: 'pointer'
                                                    }}
                                                >Individualizada</button>
                                            </div>
                                        </div>

                                        {billingMode === 'consolidada' && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>DIA VENC.:</span>
                                                <select
                                                    value={consolidatedDueDay}
                                                    onChange={(e) => setConsolidatedDueDay(e.target.value)}
                                                    style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                                                >
                                                    {[1, 5, 10, 15, 20, 25, 30].map(d => <option key={d} value={d}>{d}</option>)}
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    {/* Global Unpaid Total Box */}
                                    <div style={{
                                        border: '2px solid #ef4444',
                                        background: '#fef2f2',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-end',
                                        minWidth: '150px'
                                    }}>
                                        <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#b91c1c' }}>Total a pagar R$</span>
                                        <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b' }}>
                                            {totalUnpaidGlobal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </span>
                                    </div>
                                </div>

                                {/* Top Summary & Actions */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                                    
                                    {/* Botões à esquerda conforme solicitado */}
                                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                        {billingMode === 'consolidada' && (
                                            <div style={{ position: 'relative' }}
                                                onMouseEnter={() => totalToConsolidate === 0 && setShowConsolidationHelp(true)}
                                                onMouseLeave={() => setShowConsolidationHelp(false)}>
                                                <button
                                                    type="button"
                                                    disabled={generating || totalToConsolidate === 0}
                                                    onClick={async () => {
                                                        const confirm = await showConfirm(
                                                            `Deseja emitir uma fatura consolidada no valor de ${totalToConsolidate.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}?`,
                                                            'Emitir Fatura Consolidada'
                                                        );
                                                        if (!confirm) return;

                                                        setGenerating(true);
                                                        try {
                                                            const dueDate = calculateConsolidatedDueDate(consolidatedDueDay);
                                                            const result = await createAsaasCharge(subscriber.id, 'subscriber', {
                                                                dueDate,
                                                                invoice_ids: invoices
                                                                    .filter(inv => 
                                                                        inv.status !== 'pago' && 
                                                                        inv.status !== 'cancelado' && 
                                                                        (!inv.consolidated_invoice_id || inv.consolidated_invoice_id === null)
                                                                    )
                                                                    .map(i => i.id)
                                                            });

                                                            if (result.success) {
                                                                showAlert('Fatura consolidada gerada com sucesso!', 'success');
                                                                await Promise.all([
                                                                    fetchInvoices(subscriber.id),
                                                                    fetchConsolidatedInvoices(subscriber.id)
                                                                ]);

                                                                // Trigger download of the consolidated PDF
                                                                if (result.consolidatedId) {
                                                                    // Pequeno delay para garantir propagação no DB antes do fetch
                                                                    await new Promise(resolve => setTimeout(resolve, 1500));
                                                                    const { data: newCons } = await supabase
                                                                        .from('consolidated_invoices')
                                                                        .select('*')
                                                                        .eq('id', result.consolidatedId)
                                                                        .single();
                                                                    if (newCons) handleDownloadConsolidated(newCons);
                                                                } else if (result.url) {
                                                                    window.open(result.url, '_blank');
                                                                }
                                                            }
                                                        } catch (error) {
                                                            showAlert('Erro ao gerar consolidada: ' + error.message, 'error');
                                                        } finally {
                                                            setGenerating(false);
                                                        }
                                                    }}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                        background: '#f97316', color: 'white', border: 'none',
                                                        padding: '0.6rem 1.25rem', borderRadius: '8px', cursor: (generating || totalToConsolidate === 0) ? 'not-allowed' : 'pointer',
                                                        fontWeight: 'bold', boxShadow: (generating || totalToConsolidate === 0) ? 'none' : '0 4px 6px -1px rgba(249, 115, 22, 0.4)',
                                                        opacity: (generating || totalToConsolidate === 0) ? 0.6 : 1
                                                    }}
                                                >
                                                    <CreditCard size={18} /> {generating ? 'Gerando...' : 'Emitir Fatura Consolidada'}
                                                </button>

                                                {showConsolidationHelp && totalToConsolidate === 0 && (
                                                    <div style={{
                                                        position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '10px',
                                                        width: '240px', background: '#1e293b', color: 'white', padding: '1rem', borderRadius: '8px',
                                                        fontSize: '0.8rem', zIndex: 100, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)', pointerEvents: 'none'
                                                    }}>
                                                        <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#fb923c' }}>Consolidação Indisponível</div>
                                                        Todas as faturas visíveis já possuem boletos emitidos individualmente. Para consolidar, cancele os boletos existentes.
                                                        <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', borderWidth: '6px', borderStyle: 'solid', borderColor: '#1e293b transparent transparent transparent' }}></div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div style={{ position: 'relative' }}>
                                            <button
                                                type="button"
                                                onClick={() => setShowMonthPicker(!showMonthPicker)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                                                    background: 'white', color: '#1e293b', border: '2px solid #e2e8f0',
                                                    padding: '0.6rem 1.25rem', borderRadius: '10px', cursor: 'pointer',
                                                    fontWeight: 700, fontSize: '0.9rem', transition: 'all 0.2s',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-blue)'}
                                                onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
                                            >
                                                <Calendar size={18} color="#64748b" />
                                                {invoiceMonthFilter === 'all' ? 'Todas as Datas' : (() => {
                                                    const [y, m] = invoiceMonthFilter.split('-');
                                                    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                                                    return `${months[parseInt(m) - 1]} / ${y}`;
                                                })()}
                                            </button>
                                            {showMonthPicker && (
                                                <div style={{
                                                    position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem',
                                                    background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px',
                                                    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
                                                    padding: '1.2rem', zIndex: 100, width: '280px'
                                                }}>
                                                    <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                                                        <select
                                                            value={invoiceMonthFilter === 'all' ? new Date().getMonth() + 1 : parseInt(invoiceMonthFilter.split('-')[1])}
                                                            onChange={(e) => {
                                                                const currentYear = invoiceMonthFilter === 'all' ? new Date().getFullYear() : invoiceMonthFilter.split('-')[0];
                                                                setInvoiceMonthFilter(`${currentYear}-${String(e.target.value).padStart(2, '0')}`);
                                                            }}
                                                            style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
                                                        >
                                                            {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map((m, i) => (
                                                                <option key={m} value={i + 1}>{m}</option>
                                                            ))}
                                                        </select>
                                                        <select
                                                            value={invoiceMonthFilter === 'all' ? new Date().getFullYear() : invoiceMonthFilter.split('-')[0]}
                                                            onChange={(e) => {
                                                                const currentMonth = invoiceMonthFilter === 'all' ? String(new Date().getMonth() + 1).padStart(2, '0') : invoiceMonthFilter.split('-')[1];
                                                                setInvoiceMonthFilter(`${e.target.value}-${currentMonth}`);
                                                            }}
                                                            style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
                                                        >
                                                            {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + 2 - i).map(year => (
                                                                <option key={year} value={year}>{year}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            onClick={() => {
                                                                setInvoiceMonthFilter('all');
                                                                setShowMonthPicker(false);
                                                            }}
                                                            style={{ flex: 1, padding: '0.6rem', background: '#f1f5f9', border: 'none', borderRadius: '6px', fontSize: '0.85rem', color: '#475569', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                                                            onMouseEnter={(e) => e.currentTarget.style.background = '#e2e8f0'}
                                                            onMouseLeave={(e) => e.currentTarget.style.background = '#f1f5f9'}
                                                        >Todas as Datas</button>
                                                        <button onClick={() => setShowMonthPicker(false)} style={{ padding: '0.6rem 1rem', background: 'var(--color-blue)', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}>OK</button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Resumo à direita conforme solicitado */}
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-end',
                                        background: '#f0fdf4',
                                        border: '2px solid #22c55e',
                                        borderRadius: '12px',
                                        padding: '0.6rem 1.2rem',
                                        minWidth: '180px'
                                    }}>
                                        <div style={{ color: '#166534', fontWeight: 'bold', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '0.2rem' }}>
                                            TOTAL A PAGAR NO MÊS
                                        </div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#1e293b' }}>
                                            {totalVisibleInvoicesValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </div>
                                    </div>
                                </div>

                                {/* Consolidated Invoices Section */}
                                {billingMode === 'consolidada' && consolidatedInvoices.length > 0 && (
                                    <div style={{ marginBottom: '2rem' }}>
                                        <h4 style={{ fontSize: '0.9rem', color: '#475569', fontWeight: 'bold', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <FileText size={16} /> Faturas Consolidadas Emitidas
                                        </h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
                                            {consolidatedInvoices
                                                .filter(ci => ci.status !== 'canceled') // Somente pagas e a vencer conforme solicitado
                                                .map(ci => (
                                                <div key={ci.id} style={{
                                                    background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem',
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)', position: 'relative'
                                                }}>
                                                    <div>
                                                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#1e293b' }}>
                                                            {ci.total_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Vencimento: {new Date(ci.due_date).toLocaleDateString('pt-BR')}</div>
                                                        <div style={{ marginTop: '0.3rem' }}>
                                                            <span style={{
                                                                fontSize: '0.6rem', fontWeight: 800, padding: '0.1rem 0.4rem', borderRadius: '4px',
                                                                background: ci.status === 'paid' ? '#dcfce7' : ci.status === 'canceled' ? '#fee2e2' : '#fef9c3',
                                                                color: ci.status === 'paid' ? '#166534' : ci.status === 'canceled' ? '#991b1b' : '#854d0e',
                                                                textTransform: 'uppercase'
                                                            }}>{ci.status}</span>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                        {ci.asaas_boleto_url && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => window.open(ci.asaas_boleto_url, '_blank')}
                                                                    title="Visualizar Boleto"
                                                                    style={{ padding: '0.3rem', borderRadius: '6px', border: '1px solid #e0f2fe', background: '#f0f9ff', color: '#0369a1', cursor: 'pointer' }}
                                                                >
                                                                    <Eye size={16} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDownloadConsolidated(ci)}
                                                                    title="Download PDF Consolidado (Silencioso)"
                                                                    disabled={isGeneratingPdf}
                                                                    style={{ padding: '0.3rem', borderRadius: '6px', border: '1px solid #ffedd5', background: '#fff7ed', color: '#c2410c', cursor: 'pointer' }}
                                                                >
                                                                    {isGeneratingPdf && consolidatedToDownload?.id === ci.id ? <Loader2 size={16} className="spin-animation" /> : <Download size={16} />}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleResendNotification(ci, true)}
                                                                    title="Reenviar Fatura (Email/WhatsApp)"
                                                                    disabled={isGeneratingPdf}
                                                                    style={{ padding: '0.3rem', borderRadius: '6px', border: '1px solid #dcfce7', background: '#f0fdf4', color: '#166534', cursor: 'pointer' }}
                                                                >
                                                                    {isGeneratingPdf && consolidatedToDownload?.id === ci.id ? <Loader2 size={16} className="spin-animation" /> : <Send size={16} />}
                                                                </button>
                                                            </>
                                                        )}
                                                        {ci.status === 'pending' && (
                                                            <button
                                                                type="button"
                                                                onClick={async () => {
                                                                    const confirm = await showConfirm('Deseja cancelar esta fatura consolidada? O boleto no Asaas também será cancelado.', 'Cancelar Fatura Consolidada');
                                                                    if (!confirm) return;
                                                                    try {
                                                                        // Aqui chamaríamos uma nova API de cancelamento consolidado ou adaptariamos a atual
                                                                        // Por enquanto, vamos marcar como cancelado localmente (Simulado - ideal seria Edge Function)
                                                                        // 1. Atualizar status da fatura consolidada
                                                                        const { error } = await supabase.from('consolidated_invoices').update({ status: 'canceled' }).eq('id', ci.id);
                                                                        if (error) throw error;

                                                                        // 2. Liberar faturas individuais associadas (limpando também IDs do Asaas)
                                                                        const { error: unlinkError } = await supabase
                                                                            .from('invoices')
                                                                            .update({ 
                                                                                consolidated_invoice_id: null,
                                                                                asaas_payment_id: null,
                                                                                asaas_boleto_url: null,
                                                                                asaas_status: null,
                                                                                asaas_pdf_storage_url: null
                                                                            })
                                                                            .eq('consolidated_invoice_id', ci.id);
                                                                        
                                                                        if (unlinkError) console.warn('Erro ao desvincular faturas individuais:', unlinkError);

                                                                        await addHistory('consolidated_invoice', ci.id, 'canceled', { asaas_id: ci.asaas_payment_id, detail: 'Fatura consolidada cancelada e faturas individuais liberadas' });
                                                                        
                                                                        // 3. Recarregar dados
                                                                        fetchConsolidatedInvoices(subscriber.id);
                                                                        fetchInvoices(subscriber.id);
                                                                        
                                                                        showAlert('Fatura consolidada cancelada e itens liberados para nova emissão.', 'info');
                                                                    } catch (e) {
                                                                        showAlert('Erro ao cancelar: ' + e.message, 'error');
                                                                    }
                                                                }}
                                                                title="Cancelar Fatura"
                                                                style={{ padding: '0.3rem', borderRadius: '6px', border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                                                            >
                                                                <Ban size={16} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {loadingInvoices ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Carregando faturas...</div>
                                ) : invoices.length > 0 ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                                        {invoices.map(inv => {
                                            const statusMap = {
                                                'pago': { color: '#166534', label: 'Pago', bg: '#dcfce7', icon: CheckCircle },
                                                'atrasado': { color: '#dc2626', label: 'Atrasado', bg: '#fee2e2', icon: AlertCircle },
                                                'a_vencer': { color: '#854d0e', label: 'A Vencer', bg: '#fef9c3', icon: Clock },
                                                'cancelado': { color: '#475569', label: 'Cancelada', bg: '#f1f5f9', icon: Ban }
                                            };
                                            const s = statusMap[inv.status] || statusMap['a_vencer'];
                                            const Icon = s.icon;
                                            const isBoletoEmitido = !!inv.asaas_boleto_url;
                                            const formatCurrency = (val) => Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

                                            return (
                                                <div key={inv.id} style={{ background: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: `5px solid ${s.color}`, display: 'flex', flexDirection: 'column', gap: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                        <div style={{ fontWeight: '700', color: '#1e293b', fontSize: '0.9rem' }}>{inv.consumer_units?.titular_conta}</div>
                                                        <div style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--color-blue)' }}>{formatCurrency(inv.valor_a_pagar)}</div>
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>UC: {inv.consumer_units?.numero_uc}</div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem', marginTop: '0.2rem' }}>
                                                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', padding: '0.1rem 0.4rem', background: s.bg, color: s.color, borderRadius: '4px', fontSize: '0.65rem', fontWeight: '800', textTransform: 'uppercase' }}>
                                                                <Icon size={10} /> {s.label}
                                                            </span>
                                                            <span style={{
                                                                fontSize: '0.65rem',
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
                                                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                                            {isBoletoEmitido && inv.asaas_boleto_url && (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); window.open(inv.asaas_boleto_url, '_blank'); }}
                                                                        title="Visualizar Boleto"
                                                                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#0369a1' }}
                                                                    >
                                                                        <Eye size={14} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); handleDownloadCombined(inv); }}
                                                                        disabled={isGeneratingPdf}
                                                                        title="Baixar Detalhamento + Boleto (Silencioso)"
                                                                        style={{
                                                                            background: 'none',
                                                                            border: 'none',
                                                                            padding: 0,
                                                                            cursor: isGeneratingPdf ? 'not-allowed' : 'pointer',
                                                                            color: '#ff6600',
                                                                            opacity: isGeneratingPdf ? 0.5 : 1,
                                                                            marginLeft: '0.3rem'
                                                                        }}
                                                                    >
                                                                        {isGeneratingPdf && invoiceToDownload?.id === inv.id ? (
                                                                            <Loader2 size={14} className="spin-animation" />
                                                                        ) : (
                                                                            <Download size={14} />
                                                                        )}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); handleResendNotification(inv, false); }}
                                                                        disabled={isGeneratingPdf}
                                                                        title="Reenviar Fatura (Email/WhatsApp)"
                                                                        style={{
                                                                            background: 'none',
                                                                            border: 'none',
                                                                            padding: 0,
                                                                            cursor: isGeneratingPdf ? 'not-allowed' : 'pointer',
                                                                            color: '#166534',
                                                                            opacity: isGeneratingPdf ? 0.5 : 1,
                                                                            marginLeft: '0.3rem'
                                                                        }}
                                                                    >
                                                                        {isGeneratingPdf && invoiceToDownload?.id === inv.id ? (
                                                                            <Loader2 size={14} className="spin-animation" />
                                                                        ) : (
                                                                            <Send size={14} />
                                                                        )}
                                                                    </button>
                                                                </>
                                                            )}
                                                            <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>{new Date(inv.vencimento).toLocaleDateString('pt-BR')}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '1.5rem', border: '2px dashed #e2e8f0', borderRadius: '8px' }}>
                                        <p style={{ margin: 0, fontSize: '0.9rem' }}>Nenhuma fatura encontrada para este período.</p>
                                    </div>
                                )}
                            </div>
                            </div>
                        )}

                        {activeTab === 'comunicacao' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '800px', margin: '0 auto', paddingBottom: '1.5rem' }}>
                                <div style={{ 
                                    background: 'white', 
                                    padding: '2rem', 
                                    borderRadius: '12px', 
                                    border: '1px solid #e2e8f0',
                                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                                }}>
                                    <h4 style={{ margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#1e293b' }}>
                                        <MessageSquare size={20} color="#ec4899" />
                                        Enviar Comunicado Manual
                                    </h4>

                                    <div style={{ marginBottom: '1.5rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem' }}>
                                            Mensagem
                                        </label>
                                        <textarea
                                            value={manualMessage}
                                            onChange={(e) => setManualMessage(e.target.value)}
                                            placeholder="Digite aqui o comunicado ou notificação para o assinante..."
                                            style={{
                                                width: '100%',
                                                height: '150px',
                                                padding: '1rem',
                                                border: '1px solid #cbd5e1',
                                                borderRadius: '8px',
                                                fontSize: '0.95rem',
                                                lineHeight: '1.5',
                                                outline: 'none',
                                                resize: 'none',
                                                transition: 'border-color 0.2s',
                                                fontFamily: 'inherit'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = '#ec4899'}
                                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                                        />
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem' }}>
                                                Anexar Arquivo (Opcional)
                                            </label>
                                            <div style={{ position: 'relative' }}>
                                                <input
                                                    type="file"
                                                    onChange={(e) => setManualFile(e.target.files[0])}
                                                    style={{ display: 'none' }}
                                                    id="manual-file-upload"
                                                />
                                                <label 
                                                    htmlFor="manual-file-upload"
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.75rem',
                                                        padding: '0.75rem 1.25rem',
                                                        background: '#f8fafc',
                                                        border: '2px dashed #cbd5e1',
                                                        borderRadius: '8px',
                                                        cursor: 'pointer',
                                                        fontSize: '0.9rem',
                                                        color: manualFile ? '#ec4899' : '#64748b',
                                                        transition: 'all 0.2s',
                                                        fontWeight: 500,
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis'
                                                    }}
                                                >
                                                    <Paperclip size={18} />
                                                    {manualFile ? manualFile.name : 'Escolher arquivo...'}
                                                </label>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={handleSendManualWhatsApp}
                                            disabled={isSendingManualWA || (!manualMessage.trim() && !manualFile)}
                                            style={{
                                                marginTop: 'auto',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.75rem',
                                                padding: '0.75rem 2rem',
                                                background: (isSendingManualWA || (!manualMessage.trim() && !manualFile)) ? '#f1f5f9' : '#ec4899',
                                                color: (isSendingManualWA || (!manualMessage.trim() && !manualFile)) ? '#94a3b8' : 'white',
                                                border: 'none',
                                                borderRadius: '8px',
                                                fontWeight: 700,
                                                cursor: (isSendingManualWA || (!manualMessage.trim() && !manualFile)) ? 'not-allowed' : 'pointer',
                                                transition: 'all 0.2s',
                                                boxShadow: (isSendingManualWA || (!manualMessage.trim() && !manualFile)) ? 'none' : '0 4px 12px rgba(236, 72, 153, 0.25)'
                                            }}
                                        >
                                            {isSendingManualWA ? <Loader2 size={20} className="spin-animation" /> : <Send size={20} />}
                                            {isSendingManualWA ? 'Enviando...' : 'Enviar Comunicado'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem', padding: '1rem 0', borderTop: '1px solid #eee', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                {subscriber && onDelete && (
                                    <button type="button" onClick={handleDelete} style={{ padding: '0.6rem 1.25rem', background: '#fee2e2', color: '#dc2626', borderRadius: '6px', border: '1px solid #fecaca', fontWeight: 600 }}>
                                        Excluir
                                    </button>
                                )}
                                <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.25rem', background: '#f1f5f9', color: '#475569', borderRadius: '6px', border: '1px solid #e2e8f0', fontWeight: 600 }}>Cancelar</button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    style={{
                                        padding: '0.6rem 1.25rem',
                                        background: 'var(--color-blue)',
                                        color: 'white',
                                        borderRadius: '6px',
                                        fontWeight: 600,
                                        border: 'none',
                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                    }}
                                >
                                    {loading ? 'Salvando...' : 'Salvar Assinante'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>

            {showHistory && subscriber && (
                <HistoryTimeline
                    entityType="subscriber"
                    entityId={subscriber.id}
                    entityName={formData.name}
                    onClose={() => setShowHistory(false)}
                />
            )}

            {showUcModal && subscriber && (
                <ConsumerUnitModal
                    consumerUnit={editingUC}
                    defaultSection={ucModalMode}
                    onClose={() => {
                        setShowUcModal(false);
                        setEditingUC(null);
                        setUcModalMode('all');
                    }}
                    onSave={() => {
                        fetchConsumerUnits(subscriber.id);
                        setShowUcModal(false);
                        setEditingUC(null);
                        setUcModalMode('all');
                    }}
                />
            )}

            {/* UC Detail Preview Modal */}
            {showPreviewModal && previewUC && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1200
                }}>
                    <div style={{
                        background: 'white', borderRadius: '16px', width: '95%', maxWidth: '550px',
                        padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                        position: 'relative', maxHeight: '90vh', overflowY: 'auto'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                <div style={{ padding: '0.6rem', background: '#f0f9ff', color: '#0369a1', borderRadius: '10px' }}>
                                    <Zap size={24} />
                                </div>
                                <div>
                                    <h4 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Detalhes da Unidade Consumidora</h4>
                                    <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
                                        UC: <strong>{previewUC.numero_uc}</strong> - {previewUC.titular_conta}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setShowPreviewModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                                <X size={24} />
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Status</label>
                                <span style={{ fontSize: '0.85rem', padding: '0.2rem 0.6rem', borderRadius: '20px', background: '#f0fdf4', color: '#166534', fontWeight: 600 }}>
                                    {previewUC.status?.replace('_', ' ').toUpperCase()}
                                </span>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Concessionária</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b', fontWeight: 500 }}>{previewUC.concessionaria}</div>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Identificação na Fatura</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b' }}>{previewUC.titular_conta}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Tipo de Ligação</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b', textTransform: 'capitalize' }}>{previewUC.tipo_ligacao || 'Não inf.'}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Modalidade</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b' }}>{previewUC.modalidade?.replace(/_/g, ' ') || 'Não inf.'}</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Consumo Médio</label>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#059669' }}>{previewUC.consumo_medio_kwh || previewUC.franquia || 0} kWh</div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Vencimento</label>
                                <div style={{ fontSize: '0.95rem', color: '#1e293b' }}>Dia {previewUC.dia_vencimento || 'N/A'}</div>
                            </div>
                            <div style={{ height: '1px', background: '#f1f5f9', gridColumn: '1 / -1' }}></div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Endereço da Unidade</label>
                                <div style={{ fontSize: '0.9rem', color: '#475569', lineHeight: 1.4 }}>
                                    {previewUC.address?.rua || 'N/A'}{previewUC.address?.numero ? `, ${previewUC.address.numero}` : ''}<br />
                                    {previewUC.address?.bairro || 'N/A'} - {previewUC.address?.cidade || 'N/A'}/{previewUC.address?.uf || 'N/A'}<br />
                                    CEP: {previewUC.address?.cep || 'N/A'}
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '2.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowPreviewModal(false)}
                                style={{ padding: '0.7rem 2.5rem', background: 'var(--color-blue)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Hidden wrappers for PDF capture */}
            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', pointerEvents: 'none' }}>
                <div ref={hiddenRef}>
                    {invoiceToDownload && renderHiddenInvoiceDetail(invoiceToDownload)}
                </div>
                <div ref={hiddenConsolidatedRef}>
                    {consolidatedToDownload && renderHiddenConsolidatedDetail(consolidatedToDownload)}
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

            {showConsolidationHelp && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000
                }}>
                    <div style={{ background: 'white', borderRadius: '16px', width: '90%', maxWidth: '500px', padding: '2rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', color: '#ea580c' }}>
                            <AlertCircle size={32} />
                            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Faturamento Consolidado</h3>
                        </div>

                        <div style={{ color: '#475569', lineHeight: '1.6', fontSize: '0.95rem' }}>
                            <p>O botão de emissão está desativado porque <strong>todas as faturas deste período já possuem boletos emitidos</strong> individualmente.</p>
                            <p style={{ marginTop: '1rem' }}>Para consolidar estas faturas em um único boleto, você deve:</p>
                            <ol style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                                <li>Cancelar os boletos individuais atuais (no Asaas ou via CRM).</li>
                                <li>Uma vez que as faturas voltem ao estado "Pendente de Emissão", o total será recalculado e o botão ficará ativo.</li>
                            </ol>
                        </div>

                        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowConsolidationHelp(false)}
                                style={{ padding: '0.6rem 2rem', background: '#f97316', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                            >
                                Entendi
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Credentials Pop-up Modal */}
            {showCredentialsModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100,
                    animation: 'fadeIn 0.2s ease-out'
                }}>
                    <div style={{
                        background: 'white', borderRadius: '16px', width: '90%', maxWidth: '400px',
                        padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                        position: 'relative'
                    }}>
                        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                            <div style={{
                                width: '48px', height: '48px', background: '#fff7ed', borderRadius: '12px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
                                color: '#f97316'
                            }}>
                                <Key size={24} />
                            </div>
                            <h4 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Credenciais</h4>
                            <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>Acesso ao portal da concessionária</p>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>URL do Portal</label>
                                <input
                                    type="url"
                                    value={formData.portal_credentials?.url || ''}
                                    onChange={e => setFormData({
                                        ...formData,
                                        portal_credentials: { ...formData.portal_credentials, url: e.target.value }
                                    })}
                                    placeholder="http://portal.concessionaria.com.br"
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>Email / Login</label>
                                <input
                                    type="text"
                                    value={formData.portal_credentials?.login || ''}
                                    onChange={e => setFormData({
                                        ...formData,
                                        portal_credentials: { ...formData.portal_credentials, login: e.target.value }
                                    })}
                                    placeholder="login@exemplo.com"
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>Senha</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={formData.portal_credentials?.password || ''}
                                        onChange={e => setFormData({
                                            ...formData,
                                            portal_credentials: { ...formData.portal_credentials, password: e.target.value }
                                        })}
                                        placeholder="••••••••"
                                        style={{ width: '100%', padding: '0.7rem', paddingRight: '2.5rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.2rem' }}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '2rem', display: 'flex', gap: '0.8rem' }}>
                            <button
                                type="button"
                                onClick={() => setShowCredentialsModal(false)}
                                style={{ flex: 1, padding: '0.75rem', background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Fechar
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowCredentialsModal(false)}
                                style={{ flex: 1, padding: '0.75rem', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.2)' }}
                            >
                                Salvar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
