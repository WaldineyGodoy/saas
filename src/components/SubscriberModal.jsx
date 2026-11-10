import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import ConvidarAppButton from './ConvidarAppButton';
import { useBranding } from '../contexts/BrandingContext';
import { fetchAddressByCep, fetchCpfCnpjData, createAsaasCharge, manageAsaasCustomer, mergePdf, sendCombinedNotification, sendWhatsapp, createAutentiqueDocument, cancelAutentiqueDocument, shortenLink, cancelAsaasCharge, salvarSenhaPortal, semSenha } from '../lib/api';
import { getSecurePdfUrl } from '../lib/pdfHelper';
import { maskCpfCnpj, maskPhone, validateDocument, validatePhone } from '../lib/validators';
import { ehDiaUtil, proximoDiaUtil, proximaOcorrenciaDoDia } from '../lib/diasUteis';
import { ehPapelInterno, ehPapelAdmin } from '../lib/papeis';
import { CreditCard, Plus, Trash2, History, User, Home, Zap, X, Eye, EyeOff, Key, DollarSign, Calendar, FileText, CheckCircle, Clock, AlertCircle, Ban, TicketCheck, TicketMinus, Download, Loader2, ArrowLeft, Info, RefreshCw, Send, MessageSquare, Paperclip, MessageCircle, Copy, Pencil, Printer, Share2 } from 'lucide-react';
import ConsumerUnitModal from './ConsumerUnitModal';
import ContratoAdesao from './ContratoAdesao';
import DocumentosAssinante from './subscriber/DocumentosAssinante';
import AssinanteConnect from './subscriber/AssinanteConnect';
import { montarTextoContrato, gerarPdfContratoBase64, paginasTermoAdesao } from '../lib/contrato';
import HistoryTimeline, { CollapsibleSection } from './HistoryTimeline';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import './InvoicesModal.css';

export default function SubscriberModal({ subscriber: subscriberProp, onClose, onSave, onDelete }) {
    // Assinante criado dentro deste modal. Quem abre o modal para criar passa
    // `subscriber` nulo (ou sem `id`, na conversao de lead); sem este estado, o
    // modal nao saberia que agora existe um assinante e teria de fechar para o
    // pai reabrir -- e e depois de salvar que o time anexa os documentos.
    // Tem prioridade sobre a prop porque ela nao muda: o pai nao e avisado de
    // qual e o assinante aberto.
    const [recemCriado, setRecemCriado] = useState(null);
    const subscriber = recemCriado || subscriberProp;
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
    
    // Vencimento sugerido do consolidado.
    //
    // Antes nascia sempre em hoje + 2 dias corridos, ignorando o
    // `consolidated_due_day` do assinante — que e o campo que a pessoa edita
    // logo acima, na propria tela, e que a Edge Function usa quando o boleto sai
    // pela lista de assinantes. Dois controles para a mesma decisao, um deles
    // salvo e ignorado: em 03/09/2026 o dia estava configurado em 8 e o seletor
    // sugeriu 07/09, que ainda por cima e feriado.
    //
    // Agora o dia configurado manda. So o piso de 2 dias e o desvio de dia nao
    // util o deslocam — e nesse caso o pulo respeita feriado bancario, nao so
    // fim de semana.
    const [specificDueDate, setSpecificDueDate] = useState(() => {
        const minimo = new Date();
        minimo.setDate(minimo.getDate() + 2);

        const diaConfigurado = subscriber?.consolidated_due_day;
        const alvo = diaConfigurado
            ? proximaOcorrenciaDoDia(diaConfigurado, minimo)
            : minimo;

        return proximoDiaUtil(alvo);
    });
    const [showDueDatePicker, setShowDueDatePicker] = useState(false);
    const [calendarViewDate, setCalendarViewDate] = useState(() => new Date());
    
    // Manual Communication States
    const [manualMessage, setManualMessage] = useState('');
    const [manualFile, setManualFile] = useState(null);
    const [isSendingManualWA, setIsSendingManualWA] = useState(false);
    const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
    const hiddenRef = useRef(null);
    const hiddenConsolidatedRef = useRef(null);
    const contractPage1Ref = useRef(null);
    const contractPage2Ref = useRef(null);
    const contractFullRef = useRef(null);

    // Contratos States
    const [signatures, setSignatures] = useState([]);
    const [loadingSignatures, setLoadingSignatures] = useState(false);
    const [isCreatingContract, setIsCreatingContract] = useState(false);
    const [contractFile, setContractFile] = useState(null);
    const [signatureLink, setSignatureLink] = useState('');
    const [contractDraft, setContractDraft] = useState('');
    const [cancelingSignature, setCancelingSignature] = useState(null);


    const addHistory = async (type, id, action, details = {}, customContent = null) => {
        if (!id) {
            console.error('addHistory: Missing entity ID');
            return;
        }
        try {
            console.log(`Adding history: ${type} ${id} - ${action}`, details);
            const { error } = await supabase.from('crm_history').insert({
                entity_type: type,
                entity_id: id,
                content: customContent || `${action === 'email_sent' ? 'E-mail enviado' : action}: ${details.type || ''}`,
                metadata: details,
                created_by: profile?.id
            });
            if (error) {
                console.error('Supabase Error adding history:', error);
                throw error;
            }
            setHistoryRefreshKey(prev => prev + 1);
        } catch (error) {
            console.error('Error adding history:', error);
            // Optionally show alert if it's a critical failure, but usually history is silent
        }
    };


    // Espelha o enum subscriber_status do banco, na mesma ordem.
    // 'contrato_assinado' é carimbado pelo webhook da Autentique.
    const statusOptions = [
        { value: 'ativacao', label: 'Em Ativação' },
        { value: 'contrato_assinado', label: 'Contrato Assinado' },
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
        portal_credentials: { url: '', login: '' }
    });

    // A senha do portal vive fora do formData de proposito: o formData é
    // carregado do banco e regravado inteiro, e a senha não pode fazer esse
    // caminho de volta. Vazia significa "manter a que já está no Vault".
    const [senhaPortal, setSenhaPortal] = useState('');
    const [temSenhaGuardada, setTemSenhaGuardada] = useState(false);

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
            .select('*, planos_assinatura_energia(id, nome, desconto_assinante)')
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

    const fetchSignatures = useCallback(async (subscriberId) => {
        if (!subscriberId) return;
        setLoadingSignatures(true);
        try {
            const { data, error } = await supabase
                .from('signatures')
                .select('*')
                .eq('signer_id', subscriberId)
                .eq('signer_type', 'subscriber')
                .order('created_at', { ascending: false });
            if (error) throw error;
            setSignatures(data || []);
        } catch (error) {
            console.error('Error fetching signatures:', error);
        } finally {
            setLoadingSignatures(false);
        }
    }, []);

    const handleSendContract = async () => {
        if (!subscriber?.id) return;
        setIsCreatingContract(true);
        console.log('Iniciando geração de contrato para:', formData.name);
        
        try {
            // Mesma rotina que a adesão pública usa (ContratoAdesao.jsx).
            const pdfBase64 = await gerarPdfContratoBase64();

            const fileName = `Contrato_${formData.name.replace(/\s+/g, '_')}_${new Date().getTime()}.pdf`;

            // Quantas folhas o texto ocupa — o ContratoAdesao pagina o mesmo
            // conteúdo, então a conta bate com o que foi para o PDF.
            // Mesmos argumentos passados ao <ContratoAdesao> abaixo (formData +
            // minuta), e mesma paginação — inclusive sem o título repetido,
            // que a conta antiga não tirava.
            const paginasDoTermo = paginasTermoAdesao(formData, consumerUnits, { texto: contractDraft });

            // 4. Send to Autentique
            const result = await createAutentiqueDocument({
                documentName: fileName,
                fileBase64: pdfBase64,
                signers: [
                    {
                        name: formData.name,
                        action: 'SIGN',
                        // As páginas eram fixas em 3 e 4, de quando o termo
                        // tinha quatro folhas. O termo consolidado tem o dobro,
                        // e número fixo carimba a assinatura no meio de uma
                        // cláusula. O bloco de assinatura fica no fim do texto
                        // e a procuração é sempre a folha seguinte.
                        positions: [
                            { x: 50, y: 82, z: paginasDoTermo },      // fim do termo (Associado)
                            { x: 50, y: 82, z: paginasDoTermo + 1 }   // procuração
                        ]
                    }
                ],
                signerId: subscriber.id,
                signerType: 'subscriber'
            });

            if (result.error) throw new Error(result.error);
            if (!result || !result.documentId) throw new Error('Falha ao criar documento na Autentique: ID não retornado');

            // 5.1 Save link to subscribers table for quick access
            // Try to shorten the link before saving/sending
            let finalLink = result.url;
            try {
                const shortRes = await shortenLink(result.url, `assinatura-${subscriber.id.substring(0, 5)}-${new Date().getTime().toString().slice(-4)}`, `Contrato - ${formData.name}`);
                if (shortRes.success && shortRes.shortUrl) {
                    finalLink = shortRes.shortUrl;
                }
            } catch (shortErr) {
                console.warn('Falha ao encurtar link do contrato:', shortErr);
            }

            await supabase
                .from('subscribers')
                .update({ signature_link: finalLink })
                .eq('id', subscriber.id);

            // O link curto também vai para a própria assinatura. Sem isto o
            // short_url só era preenchido no reenvio, e nada ligava o registro
            // ao link que o cliente recebeu.
            await supabase
                .from('signatures')
                .update({ short_url: finalLink })
                .eq('autentique_doc_id', result.documentId);

            setSignatureLink(finalLink);

            // 6. Send Notifications
            const messageWithLink = `Olá ${formData.name}, bem vindo a B2W Energia. ⚡\n\nA partir de agora vc começa a economizar na sua conta de energia 💰\n\nPor favor, assine digitalmente para darmos prosseguimento à ativação da sua conta ✍️\n\nsegue link para assinatura do seu contrato de energia: 📄\n\n${finalLink}\n\num resumo do contrato e como funciona a energia por assinatura, vc pode acessar em: 🔗\n\nhttps://b2wenergia.com.br/contrato`;
            
            const envio = await enviarLinkAssinatura(messageWithLink);

            showAlert(
                algumCanalFalhou(envio)
                    ? `Contrato criado, mas houve falha no envio. ${resumoEnvio(envio)}`
                    : `Contrato gerado e enviado. ${resumoEnvio(envio)}`,
                algumCanalFalhou(envio) ? 'warning' : 'success'
            );
            fetchSignatures(subscriber.id);
            addHistory('subscriber', subscriber.id, 'envio_contrato',
                { document_name: fileName, autentique_doc_id: result.documentId, envio },
                `Contrato enviado para assinatura. ${resumoEnvio(envio)}`);

        } catch (error) {
            console.error('Error sending contract:', error);
            showAlert('Erro ao enviar contrato: ' + error.message, 'error');
        } finally {
            setIsCreatingContract(false);
        }
    };

    /**
     * Dispara o link por WhatsApp e e-mail e devolve o resultado de cada canal.
     *
     * Os dois falham por conta própria — um canal recusado não pode derrubar
     * o outro nem invalidar o contrato que já subiu para a Autentique. Só que
     * falhar em silêncio virou problema: se o WhatsApp não saísse, nada
     * aparecia em lugar nenhum e a única forma de descobrir era perguntar ao
     * cliente. Agora o resultado sobe para o histórico.
     */
    const enviarLinkAssinatura = async (texto) => {
        const resultado = { whatsapp: null, email: null };

        if (!formData.phone) {
            resultado.whatsapp = 'não enviado (sem telefone cadastrado)';
        } else {
            try {
                let instanceName = 'default';
                const { data: config } = await supabase
                    .from('integrations_config')
                    .select('variables')
                    .eq('service_name', 'evolution_api')
                    .single();
                if (config?.variables?.instance_name) instanceName = config.variables.instance_name;

                await sendWhatsapp(formData.phone.replace(/\D/g, ''), texto, null, null, null, instanceName);
                resultado.whatsapp = 'enviado';
            } catch (waErr) {
                console.error('Erro ao enviar WhatsApp:', waErr);
                resultado.whatsapp = `falhou: ${waErr.message}`;
            }
        }

        if (!formData.email) {
            resultado.email = 'não enviado (sem e-mail cadastrado)';
        } else {
            try {
                // `functions.invoke` devolve o erro em `error`, não lança. Sem
                // checar isto, e-mail recusado passava como enviado.
                const { error } = await supabase.functions.invoke('send-email', {
                    body: {
                        to: formData.email,
                        subject: 'Contrato de Adesão - B2W Energia',
                        text: texto
                    }
                });
                if (error) throw error;
                resultado.email = 'enviado';
            } catch (emailErr) {
                console.error('Erro ao enviar E-mail:', emailErr);
                resultado.email = `falhou: ${emailErr.message}`;
            }
        }

        return resultado;
    };

    const resumoEnvio = (envio) => `WhatsApp: ${envio.whatsapp} · E-mail: ${envio.email}`;

    const algumCanalFalhou = (envio) =>
        String(envio.whatsapp).startsWith('falhou') || String(envio.email).startsWith('falhou');

    /**
     * Cancela o contrato na Autentique e marca a assinatura como cancelada.
     *
     * Mesmo motivo do lado do fornecedor: contrato pendente que ninguém vai
     * assinar ficava "aguardando assinatura" para sempre no histórico do
     * cliente, com o documento ainda assinável na Autentique.
     */
    const handleCancelContract = async (sig) => {
        const ok = await showConfirm(
            'Cancelar este contrato na Autentique? O link de assinatura deixa de valer e o documento é removido de lá. Não dá para desfazer.',
            'Cancelar contrato'
        );
        if (!ok) return;

        setCancelingSignature(sig.id);
        try {
            const res = await cancelAutentiqueDocument(sig.id);
            if (res?.error) throw new Error(res.error);

            showAlert(res?.jaCancelado ? 'Este contrato já estava cancelado.' : 'Contrato cancelado.', 'success');
            if (sig.short_url === signatureLink || sig.autentique_url === signatureLink) setSignatureLink('');
            fetchSignatures(subscriber.id);
        } catch (error) {
            showAlert('Erro ao cancelar contrato: ' + error.message, 'error');
        } finally {
            setCancelingSignature(null);
        }
    };

    /**
     * Texto que os dados do assinante produzem agora, para comparar com o
     * rascunho na tela.
     *
     * Mesma armadilha do modal do fornecedor: o rascunho editado à mão vence
     * o gerado, e sem aviso isso se parece com "o cadastro não atualizou".
     */
    const textoGeradoAssinante = useMemo(() => {
        const uc = consumerUnits[0];
        const desconto = uc?.desconto_assinante ?? uc?.planos_assinatura_energia?.desconto_assinante;
        return montarTextoContrato(
            subscriber || formData,
            uc?.concessionaria,
            {
                desconto,
                diaVencimento: uc?.dia_vencimento ?? subscriber?.consolidated_due_day ?? consolidatedDueDay
            }
        );
    }, [subscriber, formData, consumerUnits, consolidatedDueDay]);

    const minutaEditada = contractDraft !== '' && contractDraft !== textoGeradoAssinante;

    const handleResendContractLink = async (sig) => {
        const confirm = await showConfirm('Deseja reenviar os links de assinatura para o cliente?', 'Reenviar Links');
        if (!confirm) return;

        try {
            // Check if we already have a short URL or if we should try to shorten now
            let finalLink = sig.short_url || sig.autentique_url;
            
            if (!sig.short_url) {
                try {
                    const shortRes = await shortenLink(sig.autentique_url, `reenvio-${sig.id.substring(0, 5)}`, `Reenvio Contrato - ${formData.name}`);
                    if (shortRes.success && shortRes.shortUrl) {
                        finalLink = shortRes.shortUrl;
                        // Save it so we don't shorten again
                        await supabase.from('signatures').update({ short_url: finalLink }).eq('id', sig.id);
                    }
                } catch (e) {
                    console.warn('Falha no encurtamento durante reenvio:', e);
                }
            }

            const messageWithLink = `Olá ${formData.name}, bem vindo a B2W Energia. ⚡\n\nA partir de agora vc começa a economizar na sua conta de energia 💰\n\nPor favor, assine digitalmente para darmos prosseguimento à ativação da sua conta ✍️\n\nsegue link para assinatura do seu contrato de energia: 📄\n\n${finalLink}\n\num resumo do contrato e como funciona a energia por assinatura, vc pode acessar em: 🔗\n\nhttps://b2wenergia.com.br/contrato`;
            
            const envio = await enviarLinkAssinatura(messageWithLink);

            showAlert(
                algumCanalFalhou(envio) ? `Falha no reenvio. ${resumoEnvio(envio)}` : `Link reenviado. ${resumoEnvio(envio)}`,
                algumCanalFalhou(envio) ? 'warning' : 'success'
            );
            addHistory('subscriber', subscriber.id, 'reenvio_contrato',
                { document_name: sig.document_name, envio },
                `Link de assinatura reenviado. ${resumoEnvio(envio)}`);
        } catch (error) {
            showAlert('Erro ao reenviar: ' + error.message, 'error');
        }
    };

    const handleUpdateSignatureStatus = async (sigId, newStatus) => {
        try {
            const { error } = await supabase
                .from('signatures')
                .update({ status: newStatus })
                .eq('id', sigId);

            if (error) throw error;

            // Espelha o autentique-webhook: contrato assinado promove o
            // assinante. Este dropdown existe porque nem toda assinatura passa
            // pela Autentique (gov.br, papel) — e, sem isto, o contrato ficava
            // como assinado enquanto o assinante seguia parado em Ativação.
            //
            // Só avança quem está em 'ativacao': um assinante já 'ativo' não
            // pode regredir. Recusa e cancelamento não mexem no status do
            // assinante — o que fazer com um contrato recusado é decisão de
            // gente, igual à regra do webhook.
            let promovido = false;
            if (newStatus === 'signed' && subscriber?.id) {
                const { data: promovidos, error: promErr } = await supabase
                    .from('subscribers')
                    .update({ status: 'contrato_assinado' })
                    .eq('id', subscriber.id)
                    .eq('status', 'ativacao')
                    .select('id');

                if (promErr) throw promErr;

                promovido = (promovidos?.length || 0) > 0;
                if (promovido) setFormData(prev => ({ ...prev, status: 'contrato_assinado' }));
            }

            showAlert(
                promovido
                    ? 'Contrato marcado como assinado. Assinante promovido para "Contrato Assinado".'
                    : 'Status do contrato atualizado!',
                'success'
            );
            fetchSignatures(subscriber.id);
            addHistory('subscriber', subscriber.id, 'status_contrato_manual', { signature_id: sigId, status: newStatus, assinante_promovido: promovido });
        } catch (error) {
            console.error('Error updating signature status:', error);
            showAlert('Erro ao atualizar status: ' + error.message, 'error');
        }
    };

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

    const totalToConsolidate = invoices
        .filter(inv => {
            const status = inv.status?.trim().toLowerCase();
            return status !== 'pago' && 
                   status !== 'cancelado' && 
                   (!inv.consolidated_invoice_id || inv.consolidated_invoice_id === null);
        })
        .reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0);


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
                portal_credentials: semSenha(subscriber.portal_credentials) || { url: '', login: '' }
            });
            setSenhaPortal('');
            setTemSenhaGuardada(!!subscriber.portal_password_secret_id);
            setSignatureLink(subscriber.signature_link || '');
            fetchConsumerUnits(subscriber.id);
            fetchConsolidatedInvoices(subscriber.id);
        }
    }, [subscriber, fetchConsumerUnits, fetchConsolidatedInvoices]);

    useEffect(() => {
        if (subscriber?.id && activeTab === 'faturas') {
            fetchInvoices(subscriber.id);
        }
    }, [subscriber?.id, activeTab, fetchInvoices]);

    useEffect(() => {
        if (activeTab === 'contratos') {
            if (subscriber?.id) {
                fetchSignatures(subscriber.id);
            }
            const ucContrato = consumerUnits[0];
            const ucDesconto = ucContrato?.desconto_assinante ?? ucContrato?.planos_assinatura_energia?.desconto_assinante;
            setContractDraft(montarTextoContrato(subscriber || formData, ucContrato?.concessionaria, {
                desconto: ucDesconto,
                diaVencimento: ucContrato?.dia_vencimento ?? subscriber?.consolidated_due_day ?? consolidatedDueDay
            }));
        }
    }, [subscriber?.id, activeTab, fetchSignatures, subscriber, consumerUnits, formData, consolidatedDueDay]);



    const calculateConsolidatedDueDate = (day) => {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth(); // 0-indexed

        let targetDate = new Date(currentYear, currentMonth, day);

        // Regra: Se o dia já passou ou faltar menos de 1 dia
        const diffDays = (targetDate - today) / (1000 * 60 * 60 * 24);

        if (diffDays < 1) {
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
            const monthYear = consolidated.mes_referencia ? consolidated.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
            const cleanName = (subscriber?.name || 'Cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
            const fileName = `Fatura_Consolidada_${cleanName}_${monthYear}.pdf`;

            // OTIMIZAÇÃO: Tentar baixar direto do Storage se já existir (Mas ignorar se for apenas o boleto bruto do Asaas)
            const isRawAsaas = consolidated.asaas_pdf_storage_url?.includes('bankSlipUrl') || 
                              consolidated.asaas_pdf_storage_url?.includes('invoiceUrl') ||
                              consolidated.asaas_pdf_storage_url?.includes('asaas.com');

            /* 
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
            */

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

            // 3. Wait for React to render the component and attach the ref - with retry
            let element = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                element = hiddenConsolidatedRef.current;
                if (element && element.querySelector && element.innerHTML.length > 100) break;
                console.log(`Aguardando hiddenConsolidatedRef render (tentativa ${attempt + 1}/10)...`);
            }
            if (!element || element.innerHTML.length < 100) {
                console.error("Ref hiddenConsolidatedRef ainda é null após tentativas.");
                throw new Error("Elemento de captura consolidado não encontrado no DOM.");
            }

            const pages = element.querySelectorAll('.consolidated-pdf-page');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = 210;
            const pageHeight = 297;

            for (let i = 0; i < pages.length; i++) {
                if (i > 0) pdf.addPage();
                const pageEl = pages[i];
                const canvas = await html2canvas(pageEl, {
                    scale: 1.5,
                    useCORS: true,
                    allowTaint: true,
                    logging: false,
                    backgroundColor: "#ffffff"
                });
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
            }

            const summaryBase64 = pdf.output('datauristring').split(',')[1];
            const asaasUrl = consolidated.asaas_boleto_url;

            // Coletar todas as URLs de faturas de energia das faturas individuais (Removendo duplicatas)
            const energyBillUrls = [...new Set(invs
                .map(i => i.concessionaria_pdf_url)
                .filter(url => !!url))];
            
            const secureEnergyBillUrls = await Promise.all(energyBillUrls.map(url => getSecurePdfUrl(supabase, url)));

            const mergedBlob = await mergePdf(summaryBase64, asaasUrl, fileName, secureEnergyBillUrls.filter(u => !!u), null);
            
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
            const monthYear = inv.mes_referencia ? inv.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
            const cleanName = (subscriber?.name || 'Cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
            const ucNumber = inv.consumer_units?.numero_uc || '';
            const fileName = `Fatura_${cleanName}_${ucNumber}_${monthYear}.pdf`;

            // OTIMIZAÇÃO: Tentar baixar direto do Storage se já existir
            // OTIMIZAÇÃO: Tentar recuperar do Storage (Ignorar se for apenas o boleto bruto do Asaas)
            const isRawAsaas = inv.asaas_pdf_storage_url?.includes('bankSlipUrl') || 
                              inv.asaas_pdf_storage_url?.includes('invoiceUrl') ||
                              inv.asaas_pdf_storage_url?.includes('asaas.com');
            
            /*
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
            */

            // Fallback: Gerar novo - Wait for DOM with retry
            let element = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                element = hiddenRef.current;
                if (element && element.querySelector && element.innerHTML.length > 100) break;
                console.log(`Aguardando hiddenRef render (tentativa ${attempt + 1}/10)...`);
            }
            if (!element || element.innerHTML.length < 100) {
                console.error("Ref hiddenRef ainda é null após tentativas em handleDownloadCombined.");
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

            let secureEnergyBillUrl = inv.concessionaria_pdf_url;
            if (secureEnergyBillUrl) {
                secureEnergyBillUrl = await getSecurePdfUrl(supabase, secureEnergyBillUrl);
            }
            
            const mergedBlob = await mergePdf(summaryBase64, asaasUrl, fileName, secureEnergyBillUrl, null);
            
            // Browser Download
            const blobUrl = window.URL.createObjectURL(mergedBlob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);

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
                        
                    console.log("Storage e Banco de Dados atualizados para PDF Individual.");
                } else {
                    console.warn("Falha ao subir PDF para o Storage:", uploadError);
                }
            } catch (storageErr) {
                console.warn("Erro ao processar persistência no Storage:", storageErr);
            }
            */

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

        // Usar dados da prop subscriber para garantir que não haja "stale state"
        const targetPhone = subscriber.phone || formData.phone;
        const targetId = subscriber.id;
        const targetName = subscriber.name || formData.name;

        if (!targetPhone) {
            showAlert('Telefone do assinante não encontrado.', 'error');
            return;
        }

        const confirmed = await showConfirm(
            `Deseja enviar esta mensagem para ${targetName}?`,
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

            // Normalização extra de DDI (Garantir 55 para números brasileiros)
            let phoneToQuery = targetPhone.replace(/\D/g, '');
            if (phoneToQuery.length >= 10 && phoneToQuery.length <= 11 && !phoneToQuery.startsWith('55')) {
                phoneToQuery = `55${phoneToQuery}`;
            }

            const response = await sendWhatsapp(
                phoneToQuery,
                manualMessage,
                null, // mediaUrl
                mediaBase64,
                fileName
            );

            if (response.error) throw new Error(response.error);

            showAlert('Mensagem enviada com sucesso!', 'success');
            
            // Log to history - Usando IDs diretos da prop
            await addHistory('subscriber', targetId, 'whatsapp_manual', {
                message: manualMessage,
                file: fileName,
                phone: phoneToQuery,
                status: 'sent'
            }, `Comunicado WhatsApp: ${manualMessage.substring(0, 50)}${manualMessage.length > 50 ? '...' : ''}`);

            // Clear fields
            setManualMessage('');
            setManualFile(null);
            
            // Refetch history if it's open
            if (showHistory) {
                // If the history component is visible, it usually re-fetches on change or we can force it
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
                recipientEmail: subscriber.email || formData.email,
                recipientPhone: subscriber.phone || formData.phone,
                subscriberName: subscriber.name || formData.name,
                dueDate: new Date((invoice.due_date || invoice.vencimento) + (!String(invoice.due_date || invoice.vencimento).includes('T') ? 'T12:00:00' : '')).toLocaleDateString('pt-BR'),
                value: (invoice.total_value || invoice.valor_a_pagar).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                pdfBlob: pdfBlob,
                fileName: fileName,
                subscriberId: subscriber.id,
                ucId: !isConsolidated ? invoice.uc_id : null, // Novo: Registro na UC
                profileId: profile?.id,
                isConsolidated: isConsolidated,
                invoiceId: invoice.id
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
        
        // Helper to get discount/economy dynamically
        // Uma UC pode entrar no consolidado sem conta no ciclo: a concessionária
        // não publicou a fatura a tempo, ou o mês foi de conta mínima (sem PDF e
        // sem boleto). Ela continua aparecendo no detalhamento — some da fatura
        // seria pior, o assinante procuraria a UC e não acharia — mas no lugar do
        // valor vai o motivo, e a conta entra no ciclo do mês seguinte.
        const semFaturamentoNoPeriodo = (inv) =>
            String(inv.status || '').toLowerCase() === 'sem_faturamento' ||
            inv.valor_a_pagar === null ||
            inv.valor_a_pagar === undefined;

        const getEconomiaValue = (inv) => {
            if (Number(inv.economia_reais) > 0) {
                return Number(inv.economia_reais);
            }
            const consumoKwh = Number(inv.consumo_kwh) || 0;
            const consumoCompensado = Number(inv.consumo_compensado) || 0;
            const consumoReais = Number(inv.consumo_reais) || 0;
            const desconto = Number(inv.desconto_aplicado) || Number(inv.desconto_assinante) || 0;
            
            if (consumoKwh > 0 && consumoReais > 0 && consumoCompensado > 0 && desconto > 0) {
                const custoKwh = consumoReais / consumoKwh;
                const valorCompensado = custoKwh * consumoCompensado;
                return valorCompensado * (desconto / 100);
            }
            return 0;
        };

        // Obter mês de referência do primeiro item
        const refMonthRaw = data.items?.[0]?.mes_referencia || '';
        let formattedRefMonth = 'N/A';
        if (refMonthRaw) {
            const [year, month] = refMonthRaw.split('-');
            formattedRefMonth = `${month}/${year}`;
        }

        // Chunk items: 6 for page 1, 9 for page 2+
        const page1Limit = 6;
        const subsequentLimit = 9;
        const totalConsumoReais = (data.items || []).reduce((sum, inv) => sum + (Number(inv.consumo_reais) || 0), 0);
        const totalEconomiaReais = (data.items || []).reduce((sum, inv) => sum + getEconomiaValue(inv), 0);

        const items = data.items || [];
        const pagesChunks = [];
        if (items.length <= page1Limit) {
            pagesChunks.push(items);
        } else {
            pagesChunks.push(items.slice(0, page1Limit));
            let remaining = items.slice(page1Limit);
            while (remaining.length > 0) {
                pagesChunks.push(remaining.slice(0, subsequentLimit));
                remaining = remaining.slice(subsequentLimit);
            }
        }

        return (
            <div className="pdf-capture-wrapper consolidated" style={{ width: '210mm', backgroundColor: 'white', position: 'relative' }}>
                {pagesChunks.map((chunk, pageIndex) => {
                    const isFirstPage = pageIndex === 0;
                    return (
                        <div 
                            key={pageIndex} 
                            className="consolidated-pdf-page" 
                            style={{ 
                                width: '210mm', 
                                height: '297mm', 
                                backgroundColor: 'white', 
                                display: 'flex', 
                                flexDirection: 'column', 
                                boxSizing: 'border-box',
                                overflow: 'hidden',
                                pageBreakAfter: 'always',
                                position: 'relative'
                            }}
                        >
                            {/* Page Header */}
                            {isFirstPage ? (
                                <header className="bg-white">
                                    <div className="px-8 py-4 flex justify-between items-center border-b border-gray-100">
                                        <div className="flex items-center gap-2">
                                            {branding?.logo_url ? (
                                                <img 
                                                    src={branding.logo_url} 
                                                    alt={branding.company_name} 
                                                    className="w-10 h-10 object-contain" 
                                                />
                                            ) : (
                                                <FileText size={24} color="#003366" />
                                            )}
                                            <span className="text-xl font-extrabold text-[#003366] uppercase tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                                {branding?.company_name || 'B2W Energia por assinatura'}
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
                                            <h1 className="text-[18px] font-extrabold text-[#003366] mb-4 uppercase" style={{ fontFamily: 'Manrope, sans-serif', lineHeight: '1.3', paddingBottom: '4px' }} title={subscriber?.name}>
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
                                        <div className="col-span-5 bg-[#5ead5c]/5 border-2 border-[#fd9000] rounded-xl p-5 flex flex-col justify-between shadow-sm overflow-hidden" style={{ minHeight: '130px' }}>
                                            <div className="space-y-1.5 w-full">
                                                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500">
                                                    <span>Consumo Total</span>
                                                    <span className="text-[#003366] text-[12px] font-extrabold">{formatCurrency(totalConsumoReais)}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-[10px] font-bold text-[#5ead5c]">
                                                    <span>Economia Total</span>
                                                    <span className="text-[#5ead5c] text-[12px] font-extrabold">{formatCurrency(totalEconomiaReais)}</span>
                                                </div>
                                            </div>
                                            <div className="border-t border-dashed border-[#fd9000]/40 mt-3 pt-2 w-full text-right">
                                                <p className="text-[9px] font-black text-[#5ead5c] uppercase tracking-widest mb-0.5">Total a Pagar</p>
                                                <p className="text-3xl font-black text-[#003366] tracking-tighter leading-none" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                                    {formatCurrency(data.total_value)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </header>
                            ) : (
                                <header className="bg-white">
                                    <div className="px-8 py-4 flex justify-between items-center border-b border-gray-100">
                                        <div className="flex items-center gap-2">
                                            {branding?.logo_url ? (
                                                <img src={branding.logo_url} alt={branding.company_name} className="w-8 h-8 object-contain" />
                                            ) : (
                                                <FileText size={20} color="#003366" />
                                            )}
                                            <span className="text-md font-extrabold text-[#003366] uppercase tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                                {branding?.company_name || 'B2W Energia por assinatura'}
                                            </span>
                                        </div>
                                        <div className="bg-[#003366] text-white px-4 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider">
                                            Detalhamento da Fatura - Página {pageIndex + 1}
                                        </div>
                                    </div>
                                </header>
                            )}

                            {/* Content Section */}
                            <div className="flex-1 px-8 py-4 bg-white">
                                <div className="grid grid-cols-3 gap-3">
                                    {chunk.map(inv => {
                                        const economiaReais = getEconomiaValue(inv);
                                        return (
                                            <div key={inv.id} className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col shadow-sm" style={{ width: '100%' }}>
                                                <div className="flex-1 flex flex-col justify-between">
                                                    <div>
                                                        <div className="flex justify-between items-start mb-2">
                                                            <div className="flex-1 flex flex-col justify-center h-full">
                                                                <p className="text-[10px] font-extrabold text-[#003366] uppercase tracking-wider mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                                                    UC: {inv.consumer_units?.numero_uc || '-'}
                                                                </p>
                                                                <p className="text-[7px] font-bold text-slate-400 uppercase leading-none mb-1">Endereço da Unidade:</p>
                                                                {inv.consumer_units?.address ? (
                                                                    <div className="text-[9px] font-bold text-[#003366] leading-snug" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                                                        <div>
                                                                            {inv.consumer_units.address.rua || '-'}{inv.consumer_units.address.numero ? `, ${inv.consumer_units.address.numero}` : ''}{inv.consumer_units.address.complemento ? ` - ${inv.consumer_units.address.complemento}` : ''}
                                                                        </div>
                                                                        <div className="text-slate-500 font-medium">
                                                                            {inv.consumer_units.address.bairro || '-'}
                                                                        </div>
                                                                        <div className="text-slate-500 font-medium">
                                                                            {inv.consumer_units.address.cidade || '-'}{inv.consumer_units.address.uf ? ` - ${inv.consumer_units.address.uf}` : ''}
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-[9px] font-bold text-[#003366] leading-tight mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                                                        {inv.consumer_units?.identification || '-'}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="space-y-1.5 border-t border-dashed border-slate-100 pt-2">
                                                            <div className="flex justify-between text-[8px] font-medium text-slate-600">
                                                                <span>Consumo Total (kWh)</span>
                                                                <span className="font-bold text-[#003366]">
                                                                    {inv.consumo_kwh} kWh ({formatCurrency(inv.consumo_reais)})
                                                                </span>
                                                            </div>
                                                            {inv.energia_injetada > 0 && (
                                                                <div className="flex justify-between text-[8px] font-medium text-[#0284c7]">
                                                                    <span>Energia Injetada</span>
                                                                    <span className="font-bold">{inv.energia_injetada} kWh</span>
                                                                </div>
                                                            )}
                                                            <div className="flex justify-between text-[8px] font-medium text-[#5ead5c]">
                                                                <span>Energia Compensada</span>
                                                                <span className="font-bold">
                                                                    - {inv.consumo_compensado || 0} kWh ({formatCurrency(economiaReais)})
                                                                </span>
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

                                                    <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-dashed border-slate-100">
                                                        <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                                                            <p className="text-[7px] font-bold text-slate-400 uppercase">Valor a Pagar</p>
                                                            {semFaturamentoNoPeriodo(inv) ? (
                                                                <p className="text-[8px] font-bold text-slate-500 leading-tight">Sem faturamento no período</p>
                                                            ) : (
                                                                <p className="text-[11px] font-black text-[#003366]">{formatCurrency(inv.valor_a_pagar)}</p>
                                                            )}
                                                        </div>
                                                        <div className="bg-[#5ead5c]/5 p-1.5 rounded border border-[#5ead5c]/10 text-right">
                                                            <p className="text-[7px] font-bold text-[#5ead5c] uppercase">Economia</p>
                                                            <p className="font-extrabold text-[#5ead5c] leading-none" style={{ fontSize: '9px' }}>{formatCurrency(economiaReais)}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Footer Support Area */}
                            <footer className="mt-auto px-8 py-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <div className="w-8 h-8 rounded-full bg-[#003366]/5 flex items-center justify-center">
                                        <Zap size={16} className="text-[#003366]" />
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-bold text-[#003366] uppercase tracking-wider">Suporte Especializado B2W Energia</p>
                                        <p className="text-[8px] text-slate-500">atendimento@b2wenergia.com.br • www.b2wenergia.com.br</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-[7px] font-bold text-slate-400 uppercase tracking-[0.2em]">Eficiência Energética Nível A+</p>
                                </div>
                            </footer>
                            
                            {/* Decorative Edge */}
                            <div className="w-full h-1 bg-gradient-to-r from-[#003366] via-[#fd9000] to-[#5ead5c]"></div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderHiddenInvoiceDetail = (invoice) => {
        if (!invoice) return null;

        // Get matching UC for this invoice to get technical data
        const uc = consumerUnits.find(u => u.id === (invoice.uc_id || invoice.consumer_unit_id));

        const statusColorsPdf = {
            pago: { color: '#27ae60', label: 'PAGO' },
            a_vencer: { color: '#2563eb', label: 'A VENCER' },
            sem_faturamento: { color: '#64748b', label: 'SEM FATURAMENTO' },
            ag_emissao_boleto: { color: '#64748b', label: 'SEM FATURAMENTO' },
            aguardando: { color: '#64748b', label: 'SEM FATURAMENTO' },
            atrasado: { color: '#dc2626', label: 'ATRASADO' },
            cancelado: { color: '#64748b', label: 'CANCELADO' }
        };
        const currentPdfStatus = statusColorsPdf[invoice.status] || statusColorsPdf.a_vencer;
        const statusLabel = currentPdfStatus.label;
        const statusColor = currentPdfStatus.color;

        // Data Sync Math
        const rawTarifa = parseFloat(invoice.tarifa_concessionaria || uc?.tarifa_concessionaria || 0.986);
        const rawConsumo = parseFloat(invoice.consumo_kwh || 0);
        const rawCompensado = parseFloat(invoice.consumo_compensado || 0);
        const discountSnapshot = invoice.desconto_aplicado !== undefined ? parseFloat(invoice.desconto_aplicado) : (parseFloat(uc?.desconto_assinante) || 0);
        const multiplier = discountSnapshot > 1 ? discountSnapshot / 100 : discountSnapshot;

        // Calculations
        const consumoTotalReais = rawConsumo * rawTarifa;
        const economiaReais = rawCompensado * rawTarifa * multiplier;
        const energiaCompensadaReais = rawCompensado * rawTarifa * (1 - multiplier);
        const ip = parseFloat(invoice.iluminacao_publica) || 0;
        const tarifaMinimaExcedentes = Math.max(0, (rawConsumo - rawCompensado) * rawTarifa);
        const outros = parseFloat(invoice.outros_lancamentos) || 0;
        const parcelamento = parseFloat(invoice.parcelamento) || 0;
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
                                    <span style={{ fontWeight: 700 }}>{invoice.mes_referencia ? `${invoice.mes_referencia.split('-')[1]}/${invoice.mes_referencia.split('-')[0]}` : 'N/A'}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Vencimento:</span>
                                    <span style={{ fontWeight: 800, color: '#dc2626' }}>{invoice.vencimento ? new Date(invoice.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}</span>
                                </div>
                            </div>
                            {/* Linha 3: Assinante */}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <span style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', minWidth: '130px' }}>Assinante:</span>
                                <span style={{ fontWeight: 800, color: '#0f172a', textTransform: 'uppercase' }}>
                                    {subscriber?.name || uc?.titular_conta || 'Assinante'}
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
            const { data: emUso, error: dupErr } = await supabase.rpc('fn_documento_em_uso', { p_doc: formData.cpf_cnpj, p_ignorar: subscriber?.id ?? null });
            if (dupErr) throw dupErr;
            if (emUso) { showAlert('Já existe um assinante com este CPF/CNPJ.', 'warning'); setLoading(false); return; }

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
                portal_credentials: semSenha(formData.portal_credentials)
            };
            if (asaasId) dataToSave.asaas_customer_id = asaasId;
            if (dataToSave.originator_id === '') dataToSave.originator_id = null;

            const eraCriacao = !subscriber?.id;
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

            // A senha vai por fora, cifrada. Campo em branco não mexe na atual.
            if (senhaPortal) {
                try {
                    await salvarSenhaPortal('subscribers', result.data.id, senhaPortal);
                    setSenhaPortal('');
                    setTemSenhaGuardada(true);
                } catch (senhaErr) {
                    showAlert('Cliente salvo, mas a senha do portal não foi guardada: ' + senhaErr.message, 'warning');
                }
            }

            if (asaasSyncSuccess) {
                showAlert('Cliente salvo e sincronizado com Asaas!', 'success');
            } else {
                showAlert('Cliente salvo APENAS LOCALMENTE (Erro Asaas ignorado).', 'warning');
            }

            // O status do lead não é gravado daqui: ele é derivado do
            // assinante pelo gatilho `trg_sync_lead_status`, só para o lead
            // ligado por `lead_id`. A antiga busca pelo e-mail gravava
            // 'ativacao' sem contrato assinado e alcançava lead de outra
            // pessoa com o mesmo e-mail.

            onSave(result.data);

            if (eraCriacao) {
                // Criacao nao fecha o modal: o proximo passo e anexar os
                // documentos, que so fazem sentido com o assinante gravado.
                // A linha devolvida pelo INSERT e anterior a gravacao da senha
                // do portal, entao o marcador de "senha guardada" vai a mao --
                // senao a tela diria que nao ha senha logo apos salva-la.
                setRecemCriado({
                    ...result.data,
                    portal_password_secret_id: result.data.portal_password_secret_id || (senhaPortal ? 'guardada' : null),
                });
                setActiveTab('documentos');
            } else {
                onClose();
            }
        } catch (error) {
            showAlert('Erro ao salvar assinante: ' + error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSendManualWA = async () => {
        if (!formData.phone) {
            showAlert('Assinante sem telefone cadastrado!', 'warning');
            return;
        }
        if (!manualMessage.trim()) {
            showAlert('Digite uma mensagem!', 'warning');
            return;
        }

        setIsSendingManualWA(true);
        try {
            let fileBase64 = null;
            if (manualFile) {
                const reader = new FileReader();
                fileBase64 = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(manualFile);
                });
            }

            const result = await sendWhatsapp(
                formData.phone,
                manualMessage,
                null, 
                fileBase64,
                manualFile ? manualFile.name : null
            );

            if (result.success) {
                showAlert('Comunicado enviado com sucesso!', 'success');
                await addHistory('subscriber', subscriber.id, 'whatsapp_manual', { 
                    message: manualMessage,
                    attached_file: manualFile ? manualFile.name : null
                });
                setManualMessage('');
                setManualFile(null);
            } else {
                throw new Error(result.error || 'Falha ao enviar');
            }
        } catch (error) {
            console.error('Error sending manual WA:', error);
            showAlert('Erro ao enviar WhatsApp: ' + error.message, 'error');
        } finally {
            setIsSendingManualWA(false);
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
        .filter(inv => {
            const status = inv.status?.trim().toLowerCase();
            return status !== 'pago' && status !== 'cancelado';
        })
        .reduce((acc, curr) => acc + (Number(curr.valor_a_pagar) || 0), 0);


    const [refreshingSub, setRefreshingSub] = useState(false);

    const handleRefreshSubscriberModal = async () => {
        if (!subscriber?.id || refreshingSub) return;
        setRefreshingSub(true);
        try {
            const tasks = [
                fetchConsumerUnits(subscriber.id),
                fetchConsolidatedInvoices(subscriber.id),
                fetchSignatures(subscriber.id)
            ];
            if (ehPapelInterno(profile?.role)) {
                tasks.push(fetchInvoices(subscriber.id));
            }
            await Promise.all(tasks);
            setHistoryRefreshKey(prev => prev + 1);
        } catch (err) {
            console.error('Erro ao atualizar dados do assinante:', err);
        } finally {
            setRefreshingSub(false);
        }
    };

    const subInputStyle = {
        width: '100%',
        padding: '0.68rem 0.9rem',
        border: '1px solid #cbd5e1',
        borderRadius: '10px',
        fontSize: '0.9rem',
        color: '#0f172a',
        fontWeight: 500,
        backgroundColor: '#f8fafc',
        outline: 'none',
        transition: 'all 0.15s'
    };

    const subLabelStyle = {
        display: 'block',
        fontSize: '0.75rem',
        fontWeight: 700,
        color: '#475569',
        marginBottom: '0.4rem',
        textTransform: 'uppercase',
        letterSpacing: '0.03em'
    };

    const subCardStyle = {
        background: '#ffffff',
        padding: '1.35rem 1.5rem',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
    };

    const statusBadgeMap = {
        ativacao: { bg: '#fef9c3', color: '#854d0e', label: 'Em Ativação' },
        contrato_assinado: { bg: '#dbeafe', color: '#1e40af', label: 'Contrato Assinado' },
        ativo: { bg: '#dcfce7', color: '#166534', label: 'Ativo' },
        ativo_inadimplente: { bg: '#ffedd5', color: '#c2410c', label: 'Ativo (Inadimplente)' },
        transferido: { bg: '#f1f5f9', color: '#475569', label: 'Transferido' },
        cancelado: { bg: '#fee2e2', color: '#991b1b', label: 'Cancelado' },
        cancelado_inadimplente: { bg: '#fecaca', color: '#7f1d1d', label: 'Cancelado (Inadimplente)' }
    };
    const currentStatusMeta = statusBadgeMap[formData.status] || { bg: '#f1f5f9', color: '#475569', label: formData.status };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.68)', backdropFilter: 'blur(6px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
            padding: '1rem'
        }}>
            <style>{`
                @keyframes subFadeIn {
                    from { opacity: 0; transform: translateY(6px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes subSpin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .sub-spin {
                    animation: subSpin 0.8s linear infinite;
                }
                .sub-modal-input:focus {
                    border-color: #2563eb !important;
                    background-color: #ffffff !important;
                    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
                }
                .sub-modal-grid-2 {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(430px, 1fr));
                    gap: 1.25rem;
                    align-items: start;
                }
                .sub-uc-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
                    gap: 1rem;
                }
                @media (max-width: 960px) {
                    .sub-modal-grid-2, .sub-uc-grid {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>

            <div style={{
                background: '#f8fafc',
                padding: 0,
                borderRadius: '16px',
                width: '96vw',
                maxWidth: '1380px',
                height: '92vh',
                maxHeight: '92vh',
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.38)',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative'
            }}>
                {/* Pinned Authority Header */}
                <div style={{
                    padding: '1.15rem 1.75rem',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    color: '#ffffff',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
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
                            <User size={22} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
                                    {subscriber ? (formData.name || 'Assinante') : 'Novo Assinante'}
                                </h3>
                                <span style={{
                                    padding: '0.2rem 0.7rem',
                                    borderRadius: '999px',
                                    fontSize: '0.73rem',
                                    fontWeight: 700,
                                    background: currentStatusMeta.bg,
                                    color: currentStatusMeta.color
                                }}>
                                    {currentStatusMeta.label}
                                </span>
                                {subscriber && (
                                    <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.3rem',
                                        padding: '0.2rem 0.65rem',
                                        borderRadius: '999px',
                                        background: 'rgba(16, 185, 129, 0.18)',
                                        border: '1px solid rgba(52, 211, 153, 0.3)',
                                        color: '#6ee7b7',
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                        fontVariantNumeric: 'tabular-nums'
                                    }}>
                                        <Zap size={12} /> {consumerUnits.length} {consumerUnits.length === 1 ? 'UC' : 'UCs'}
                                    </span>
                                )}
                                {subscriber && (
                                    <span style={{
                                        padding: '0.2rem 0.65rem',
                                        borderRadius: '999px',
                                        background: 'rgba(255, 255, 255, 0.08)',
                                        border: '1px solid rgba(255, 255, 255, 0.14)',
                                        color: '#cbd5e1',
                                        fontSize: '0.72rem',
                                        fontWeight: 600
                                    }}>
                                        Cobrança {billingMode === 'consolidada' ? 'Consolidada' : 'Individualizada'}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginTop: '0.25rem', fontSize: '0.8rem', color: '#94a3b8', flexWrap: 'wrap' }}>
                                {formData.cpf_cnpj ? (
                                    <span style={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', color: '#cbd5e1', fontWeight: 600 }}>
                                        Doc: {formData.cpf_cnpj}
                                    </span>
                                ) : (
                                    <span>Gestão completa do titular, endereço, unidades consumidoras, faturas e contratos</span>
                                )}
                                {formData.email && (
                                    <>
                                        <span style={{ opacity: 0.4 }}>•</span>
                                        <span>{formData.email}</span>
                                    </>
                                )}
                                {formData.phone && (
                                    <>
                                        <span style={{ opacity: 0.4 }}>•</span>
                                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formData.phone}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
                        {subscriber?.id && ehPapelInterno(profile?.role) && (
                            <button
                                type="button"
                                onClick={() => setActiveTab('faturas')}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'flex-end',
                                    background: totalUnpaidGlobal > 0 ? 'rgba(239, 68, 68, 0.14)' : 'rgba(255, 255, 255, 0.06)',
                                    border: `1px solid ${totalUnpaidGlobal > 0 ? 'rgba(248, 113, 113, 0.35)' : 'rgba(255, 255, 255, 0.12)'}`,
                                    borderRadius: '10px',
                                    padding: '0.38rem 0.85rem',
                                    cursor: 'pointer',
                                    color: 'white'
                                }}
                                title="Ver faturas do assinante"
                            >
                                <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: totalUnpaidGlobal > 0 ? '#fca5a5' : '#94a3b8', fontWeight: 700 }}>
                                    Total em Aberto
                                </span>
                                <span style={{ fontSize: '0.95rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: totalUnpaidGlobal > 0 ? '#f87171' : '#4ade80' }}>
                                    {totalUnpaidGlobal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </span>
                            </button>
                        )}

                        {subscriber?.id && (
                            <button
                                type="button"
                                onClick={handleRefreshSubscriberModal}
                                disabled={refreshingSub || loadingInvoices}
                                title="Atualizar UCs, faturas e contratos sem fechar o modal"
                                style={{
                                    background: 'rgba(59, 130, 246, 0.16)',
                                    border: '1px solid rgba(96, 165, 250, 0.35)',
                                    color: '#e0f2fe',
                                    height: '38px',
                                    padding: '0 0.85rem',
                                    borderRadius: '10px',
                                    cursor: (refreshingSub || loadingInvoices) ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.45rem',
                                    fontSize: '0.8rem',
                                    fontWeight: 700,
                                    opacity: (refreshingSub || loadingInvoices) ? 0.7 : 1,
                                    transition: 'all 0.15s'
                                }}
                            >
                                <RefreshCw size={15} className={(refreshingSub || loadingInvoices) ? 'sub-spin' : ''} />
                                <span>{(refreshingSub || loadingInvoices) ? 'Atualizando...' : 'Atualizar'}</span>
                            </button>
                        )}

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

                {/* Unified Tabs Menu (Dados Cadastrais + Endereço unificados na primeira aba) */}
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '0.4rem',
                    background: '#ffffff',
                    padding: '0.6rem 1.75rem',
                    borderBottom: '1px solid #e2e8f0',
                    flexShrink: 0
                }}>
                    {[
                        { id: 'dados', label: 'Dados Cadastrais & Endereço', icon: User, color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', badge: formData.uf || null },
                        { id: 'ucs', label: 'Unidades Consumidoras', icon: Zap, color: '#047857', bg: '#ecfdf5', border: '#a7f3d0', badge: consumerUnits.length > 0 ? `${consumerUnits.length}` : null },
                        { id: 'faturas', label: 'Faturas', icon: CreditCard, color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe', badge: invoices.length > 0 ? `${invoices.length}` : null },
                        { id: 'comunicacao', label: 'Comunicados', icon: MessageCircle, color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', badge: null },
                        { id: 'contratos', label: 'Contratos', icon: FileText, color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe', badge: signatures.length > 0 ? `${signatures.length}` : null },
                        { id: 'documentos', label: 'Documentos', icon: Paperclip, color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe', badge: null },
                        { id: 'conect', label: 'Assinante Connect', icon: Share2, color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4', badge: null }
                    ]
                        .filter(tab => tab.id !== 'faturas' || ehPapelInterno(profile?.role))
                        .map(tab => {
                        const isActive = activeTab === tab.id || (tab.id === 'dados' && activeTab === 'endereco');
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.52rem 0.95rem',
                                    borderRadius: '10px',
                                    border: `1px solid ${isActive ? tab.border : 'transparent'}`,
                                    background: isActive ? tab.bg : 'transparent',
                                    cursor: 'pointer',
                                    color: isActive ? tab.color : '#475569',
                                    transition: 'all 0.15s',
                                    fontSize: '0.85rem',
                                    fontWeight: isActive ? 700 : 600,
                                    flexShrink: 0,
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                <Icon size={16} strokeWidth={isActive ? 2.3 : 2} />
                                <span>{tab.label}</span>
                                {tab.badge && (
                                    <span style={{
                                        padding: '0.08rem 0.45rem',
                                        borderRadius: '999px',
                                        fontSize: '0.68rem',
                                        fontWeight: 700,
                                        fontVariantNumeric: 'tabular-nums',
                                        background: isActive ? '#ffffff' : '#f1f5f9',
                                        color: isActive ? tab.color : '#64748b'
                                    }}>
                                        {tab.badge}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Form wrapping Scrollable Content + Pinned Footer */}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem' }}>

                        {/* ==================== ABA 1 UNIFICADA: DADOS CADASTRAIS & ENDEREÇO ==================== */}
                        {(activeTab === 'dados' || activeTab === 'endereco') && (
                            <div style={{ animation: 'subFadeIn 0.2s ease-out' }} className="sub-modal-grid-2">
                                {/* Coluna Esquerda: Identificação, Status, Originador e Contato */}
                                <div style={subCardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.15rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                            <User size={18} color="#2563eb" /> Dados Cadastrais e Contato
                                        </h4>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            {searchingDoc && (
                                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2563eb', background: '#eff6ff', padding: '0.2rem 0.55rem', borderRadius: '999px' }}>
                                                    Consultando CPF/CNPJ...
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setShowCredentialsModal(true)}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.4rem',
                                                    padding: '0.38rem 0.75rem',
                                                    background: (temSenhaGuardada || formData.portal_credentials?.login) ? '#f0fdf4' : '#fff7ed',
                                                    color: (temSenhaGuardada || formData.portal_credentials?.login) ? '#15803d' : '#c2410c',
                                                    borderRadius: '8px',
                                                    border: `1px solid ${(temSenhaGuardada || formData.portal_credentials?.login) ? '#bbf7d0' : '#fed7aa'}`,
                                                    fontSize: '0.76rem',
                                                    fontWeight: 700,
                                                    cursor: 'pointer'
                                                }}
                                                title="Configurar login e senha do portal da concessionária"
                                            >
                                                <Key size={14} />
                                                {(temSenhaGuardada || formData.portal_credentials?.login) ? 'Credenciais Configuradas' : 'Credenciais do Portal'}
                                            </button>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={subLabelStyle}>CPF / CNPJ (Busca Automática) *</label>
                                            <input
                                                className="sub-modal-input"
                                                value={formData.cpf_cnpj}
                                                onChange={e => setFormData({ ...formData, cpf_cnpj: maskCpfCnpj(e.target.value) })}
                                                onBlur={handleDocBlur}
                                                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                                                style={{ ...subInputStyle, fontVariantNumeric: 'tabular-nums', background: searchingDoc ? '#eff6ff' : '#f8fafc' }}
                                                required
                                            />
                                        </div>

                                        <div>
                                            <label style={subLabelStyle}>Status Operacional</label>
                                            <select
                                                className="sub-modal-input"
                                                value={formData.status}
                                                onChange={e => setFormData({ ...formData, status: e.target.value })}
                                                style={subInputStyle}
                                            >
                                                {statusOptions.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={subLabelStyle}>Nome Completo / Razão Social *</label>
                                            <input
                                                className="sub-modal-input"
                                                required
                                                placeholder="Nome do titular ou razão social da empresa"
                                                value={formData.name}
                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                                style={subInputStyle}
                                            />
                                        </div>

                                        <div>
                                            <label style={subLabelStyle}>E-mail Principal *</label>
                                            <input
                                                className="sub-modal-input"
                                                type="email"
                                                placeholder="cliente@email.com"
                                                value={formData.email}
                                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                                style={subInputStyle}
                                                required
                                            />
                                        </div>

                                        <div>
                                            <label style={subLabelStyle}>Telefone / WhatsApp</label>
                                            <input
                                                className="sub-modal-input"
                                                value={formData.phone}
                                                onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                                                placeholder="(00) 00000-0000"
                                                style={{ ...subInputStyle, fontVariantNumeric: 'tabular-nums' }}
                                            />
                                        </div>

                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={subLabelStyle}>Originador Comercial</label>
                                            <select
                                                className="sub-modal-input"
                                                value={formData.originator_id}
                                                onChange={e => setFormData({ ...formData, originator_id: e.target.value })}
                                                style={subInputStyle}
                                            >
                                                <option value="">Sem originador vinculado...</option>
                                                {originators.map(o => (
                                                    <option key={o.id} value={o.id}>{o.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {/* Coluna Direita: Endereço e Localização (Unificado) */}
                                <div style={subCardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.15rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                            <Home size={18} color="#d97706" /> Endereço e Localização
                                        </h4>
                                        {searchingCep && (
                                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2563eb', background: '#eff6ff', padding: '0.2rem 0.55rem', borderRadius: '999px' }}>
                                                Buscando CEP...
                                            </span>
                                        )}
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1rem' }}>
                                        <div style={{ gridColumn: 'span 4' }}>
                                            <label style={subLabelStyle}>CEP (Busca Automática)</label>
                                            <input
                                                className="sub-modal-input"
                                                placeholder="00000-000"
                                                value={formData.cep}
                                                onChange={e => setFormData({ ...formData, cep: e.target.value })}
                                                onBlur={handleCepBlur}
                                                style={{ ...subInputStyle, fontVariantNumeric: 'tabular-nums', background: searchingCep ? '#eff6ff' : '#f8fafc' }}
                                            />
                                        </div>

                                        <div style={{ gridColumn: 'span 8' }}>
                                            <label style={subLabelStyle}>Cidade / UF</label>
                                            <input
                                                value={formData.cidade || formData.uf ? `${formData.cidade || ''}${formData.uf ? ` - ${formData.uf}` : ''}` : ''}
                                                placeholder="Preenchido automaticamente pelo CEP"
                                                disabled
                                                style={{ ...subInputStyle, background: '#f1f5f9', color: '#475569', borderColor: '#e2e8f0' }}
                                            />
                                        </div>

                                        <div style={{ gridColumn: 'span 8' }}>
                                            <label style={subLabelStyle}>Logradouro / Rua / Avenida</label>
                                            <input
                                                className="sub-modal-input"
                                                placeholder="Rua, Avenida, Travessa..."
                                                value={formData.rua}
                                                onChange={e => setFormData({ ...formData, rua: e.target.value })}
                                                style={subInputStyle}
                                            />
                                        </div>

                                        <div style={{ gridColumn: 'span 4' }}>
                                            <label style={subLabelStyle}>Número</label>
                                            <input
                                                className="sub-modal-input"
                                                placeholder="Nº ou S/N"
                                                value={formData.numero}
                                                onChange={e => setFormData({ ...formData, numero: e.target.value })}
                                                style={{ ...subInputStyle, fontVariantNumeric: 'tabular-nums' }}
                                            />
                                        </div>

                                        <div style={{ gridColumn: 'span 6' }}>
                                            <label style={subLabelStyle}>Bairro</label>
                                            <input
                                                className="sub-modal-input"
                                                placeholder="Bairro"
                                                value={formData.bairro}
                                                onChange={e => setFormData({ ...formData, bairro: e.target.value })}
                                                style={subInputStyle}
                                            />
                                        </div>

                                        <div style={{ gridColumn: 'span 6' }}>
                                            <label style={subLabelStyle}>Complemento</label>
                                            <input
                                                className="sub-modal-input"
                                                placeholder="Apto, Bloco, Sala, Condomínio..."
                                                value={formData.complemento}
                                                onChange={e => setFormData({ ...formData, complemento: e.target.value })}
                                                style={subInputStyle}
                                            />
                                        </div>
                                    </div>

                                    <div style={{
                                        marginTop: '1.15rem',
                                        padding: '0.75rem 0.95rem',
                                        borderRadius: '10px',
                                        background: '#f8fafc',
                                        border: '1px solid #e2e8f0',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '0.75rem',
                                        flexWrap: 'wrap',
                                        fontSize: '0.76rem',
                                        color: '#64748b'
                                    }}>
                                        <span>Os dados cadastrais e de endereço são sincronizados automaticamente com o <strong>Asaas</strong> e com a minuta do contrato de adesão.</span>
                                        {subscriber?.asaas_customer_id && (
                                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '0.15rem 0.5rem', borderRadius: '6px' }}>
                                                Asaas: {subscriber.asaas_customer_id}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ==================== ABA: ASSINANTE CONNECT ==================== */}
                        {activeTab === 'conect' && (
                            <div style={{ animation: 'subFadeIn 0.2s ease-out', paddingBottom: '0.5rem' }}>
                                <AssinanteConnect subscriber={subscriber} profile={profile} />
                            </div>
                        )}

                        {/* ==================== ABA: UNIDADES CONSUMIDORAS ==================== */}
                        {activeTab === 'ucs' && (
                            <div style={{ animation: 'subFadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
                                <div style={{
                                    ...subCardStyle,
                                    padding: '1rem 1.35rem',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: '1rem'
                                }}>
                                    <div>
                                        <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Zap size={18} color="#059669" /> Unidades Consumidoras Vinculadas
                                        </h4>
                                        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                                            Gerencie as UCs deste assinante, acompanhe o status de leitura da concessionária e configure parâmetros técnicos.
                                        </p>
                                    </div>
                                    {subscriber?.id && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEditingUC({ subscriber_id: subscriber.id });
                                                setUcModalMode('all');
                                                setShowUcModal(true);
                                            }}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                                                background: '#059669', color: '#ffffff', border: 'none',
                                                padding: '0.6rem 1.15rem', borderRadius: '10px', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 700,
                                                boxShadow: '0 4px 10px rgba(5, 150, 105, 0.2)'
                                            }}
                                        >
                                            <Plus size={16} /> Cadastrar Nova UC
                                        </button>
                                    )}
                                </div>

                                {consumerUnits.length > 0 ? (
                                    <div className="sub-uc-grid">
                                        {consumerUnits.map(uc => {
                                            const getUCStatusColor = (status) => {
                                                const colors = {
                                                    'ativo': '#15803d',
                                                    'aguardando_conexao': '#1d4ed8',
                                                    'em_atraso': '#b91c1c',
                                                    'ativacao': '#b45309',
                                                    'em_ativacao': '#b45309',
                                                    'vinculado': '#4338ca',
                                                    'cancelado': '#475569',
                                                    'cancelado_inadimplente': '#7f1d1d'
                                                };
                                                return colors[status] || '#475569';
                                            };

                                            const currentMonthStr = new Date().toISOString().substring(0, 7);
                                            const hasInvoiceThisMonth = invoices.some(inv => 
                                                inv.uc_id === uc.id && 
                                                inv.mes_referencia?.startsWith(currentMonthStr) &&
                                                inv.status !== 'cancelado'
                                            );

                                            const getReadingStatus = () => {
                                                if (hasInvoiceThisMonth) return { icon: <CheckCircle size={14} />, color: '#15803d', bg: '#dcfce7', label: 'Leitura Realizada' };
                                                
                                                switch (uc.last_scraping_status) {
                                                    case 'success': return { icon: <CheckCircle size={14} />, color: '#15803d', bg: '#dcfce7', label: 'Sucesso' };
                                                    case 'error': return { icon: <AlertCircle size={14} />, color: '#b91c1c', bg: '#fee2e2', label: 'Indisponível' };
                                                    case 'processing': return { icon: <RefreshCw size={14} className="sub-spin" />, color: '#1d4ed8', bg: '#dbeafe', label: 'Lendo...' };
                                                    default: return { icon: <Clock size={14} />, color: '#475569', bg: '#f1f5f9', label: 'Pendente' };
                                                }
                                            };

                                            const rStatus = getReadingStatus();
                                            const stColor = getUCStatusColor(uc.status);

                                            return (
                                                <div key={uc.id} style={{ 
                                                    background: '#ffffff', 
                                                    padding: '1.15rem 1.25rem', 
                                                    borderRadius: '14px', 
                                                    border: '1px solid #e2e8f0', 
                                                    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                                                    display: 'flex', 
                                                    flexDirection: 'column',
                                                    gap: '0.85rem',
                                                    position: 'relative'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                                                                <span style={{
                                                                    fontWeight: 800,
                                                                    color: '#0f172a',
                                                                    fontSize: '0.96rem',
                                                                    fontVariantNumeric: 'tabular-nums'
                                                                }}>
                                                                    UC {uc.numero_uc}
                                                                </span>
                                                                {uc.concessionaria && (
                                                                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '0.1rem 0.45rem', borderRadius: '6px' }}>
                                                                        {uc.concessionaria}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {uc.titular_conta || 'Titular não informado'}
                                                            </div>
                                                        </div>
                                                        <div style={{ 
                                                            fontSize: '0.68rem', 
                                                            fontWeight: 800, 
                                                            color: stColor,
                                                            background: `${stColor}14`,
                                                            padding: '0.22rem 0.6rem',
                                                            borderRadius: '999px',
                                                            textTransform: 'uppercase',
                                                            border: `1px solid ${stColor}30`,
                                                            whiteSpace: 'nowrap'
                                                        }}>
                                                            {uc.status?.replace(/_/g, ' ')}
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #f1f5f9' }}>
                                                        <div style={{ 
                                                            display: 'inline-flex', 
                                                            alignItems: 'center', 
                                                            gap: '0.35rem', 
                                                            color: rStatus.color,
                                                            fontSize: '0.75rem',
                                                            fontWeight: 700,
                                                            background: rStatus.bg,
                                                            padding: '0.2rem 0.55rem',
                                                            borderRadius: '6px'
                                                        }}>
                                                            {rStatus.icon}
                                                            <span>{rStatus.label}</span>
                                                        </div>
                                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                                                            Dia de Leitura: <strong style={{ color: '#0f172a' }}>{uc.dia_leitura || '--'}</strong>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', gap: '0.45rem', justifyContent: 'flex-end', paddingTop: '0.25rem' }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setEditingUC(uc);
                                                                setUcModalMode('all');
                                                                setShowUcModal(true);
                                                            }}
                                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.42rem 0.7rem', color: '#1d4ed8', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700 }}
                                                            title="Editar Dados da UC"
                                                        >
                                                            <Pencil size={14} /> Editar
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setPreviewUC(uc);
                                                                setShowPreviewModal(true);
                                                            }}
                                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.42rem 0.7rem', color: '#475569', background: '#f8fafc', borderRadius: '8px', border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700 }}
                                                            title="Ver Detalhes"
                                                        >
                                                            <Eye size={14} /> Detalhes
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setEditingUC(uc);
                                                                setUcModalMode('technical');
                                                                setShowUcModal(true);
                                                            }}
                                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.42rem 0.7rem', color: '#b45309', background: '#fffbeb', borderRadius: '8px', border: '1px solid #fde68a', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700 }}
                                                            title="Dados Técnicos e Comerciais"
                                                        >
                                                            <DollarSign size={14} /> Comercial
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUnlinkUC(uc.id)}
                                                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0.42rem 0.55rem', color: '#dc2626', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca', cursor: 'pointer' }}
                                                            title="Desvincular UC do assinante"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', color: '#64748b', padding: '2.5rem', border: '1px dashed #cbd5e1', borderRadius: '14px', background: '#ffffff' }}>
                                        <Zap size={32} color="#94a3b8" style={{ marginBottom: '0.5rem' }} />
                                        <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600, color: '#334155' }}>Nenhuma Unidade Consumidora vinculada</p>
                                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>Clique em "Cadastrar Nova UC" acima para adicionar a primeira unidade deste assinante.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ==================== ABA: FATURAS ==================== */}
                        {activeTab === 'faturas' && (
                            <div style={{ animation: 'subFadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                {/* Barra Executiva de Faturamento e Saldos */}
                                <div style={{
                                    ...subCardStyle,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1.15rem'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Modalidade:</span>
                                                <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.22rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleBillingModeChange('consolidada')}
                                                        style={{
                                                            padding: '0.42rem 0.85rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, transition: 'all 0.15s',
                                                            background: billingMode === 'consolidada' ? '#ffffff' : 'transparent',
                                                            color: billingMode === 'consolidada' ? '#1d4ed8' : '#64748b',
                                                            boxShadow: billingMode === 'consolidada' ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none',
                                                            border: 'none', cursor: 'pointer'
                                                        }}
                                                    >Consolidada</button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleBillingModeChange('individualizada')}
                                                        style={{
                                                            padding: '0.42rem 0.85rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, transition: 'all 0.15s',
                                                            background: billingMode === 'individualizada' ? '#ffffff' : 'transparent',
                                                            color: billingMode === 'individualizada' ? '#1d4ed8' : '#64748b',
                                                            boxShadow: billingMode === 'individualizada' ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none',
                                                            border: 'none', cursor: 'pointer'
                                                        }}
                                                    >Individualizada</button>
                                                </div>
                                            </div>

                                            {billingMode === 'consolidada' && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
                                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Vencimento:</span>
                                                    <button 
                                                        type="button"
                                                        onClick={() => setShowDueDatePicker(!showDueDatePicker)}
                                                        style={{ padding: '0.42rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0f172a', background: '#f8fafc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                                                    >
                                                        <Calendar size={14} color="#2563eb" />
                                                        {specificDueDate.toLocaleDateString('pt-BR')}
                                                    </button>
                                                    
                                                    {showDueDatePicker && (
                                                        <div style={{
                                                            position: 'absolute', top: '110%', left: 0, background: 'white', 
                                                            border: '1px solid #e2e8f0', borderRadius: '12px', 
                                                            boxShadow: '0 10px 25px rgba(0,0,0,0.12)', zIndex: 100, 
                                                            padding: '1rem', width: '280px'
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                                                <button 
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const newD = new Date(calendarViewDate);
                                                                        newD.setMonth(newD.getMonth() - 1);
                                                                        setCalendarViewDate(newD);
                                                                    }} 
                                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 'bold' }}
                                                                >&lt;</button>
                                                                <span style={{ fontWeight: 'bold', fontSize: '0.9rem', textTransform: 'capitalize' }}>
                                                                    {calendarViewDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
                                                                </span>
                                                                <button 
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const newD = new Date(calendarViewDate);
                                                                        newD.setMonth(newD.getMonth() + 1);
                                                                        setCalendarViewDate(newD);
                                                                    }} 
                                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-blue)', fontWeight: 'bold' }}
                                                                >&gt;</button>
                                                            </div>
                                                            
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '0.5rem' }}>
                                                                {['D','S','T','Q','Q','S','S'].map((d, i) => (
                                                                    <div key={i} style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#94a3b8' }}>{d}</div>
                                                                ))}
                                                            </div>
                                                            
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                                                                {(() => {
                                                                    const today = new Date();
                                                                    today.setHours(0,0,0,0);
                                                                    const minValid = new Date(today);
                                                                    minValid.setDate(minValid.getDate() + 2);
                                                                    
                                                                    const y = calendarViewDate.getFullYear();
                                                                    const m = calendarViewDate.getMonth();
                                                                    const firstDay = new Date(y, m, 1).getDay();
                                                                    const daysInMonth = new Date(y, m + 1, 0).getDate();
                                                                    
                                                                    const cells = [];
                                                                    for(let i=0; i<firstDay; i++) cells.push(<div key={`empty-${i}`} />);
                                                                    
                                                                    for(let d=1; d<=daysInMonth; d++) {
                                                                        const date = new Date(y, m, d);
                                                                        const isValid = ehDiaUtil(date) && date >= minValid;
                                                                        const isSelected = specificDueDate.getDate() === d && specificDueDate.getMonth() === m && specificDueDate.getFullYear() === y;
                                                                        
                                                                        cells.push(
                                                                            <button
                                                                                key={d}
                                                                                type="button"
                                                                                disabled={!isValid}
                                                                                onClick={() => {
                                                                                    setSpecificDueDate(date);
                                                                                    setConsolidatedDueDay(d);
                                                                                    setShowDueDatePicker(false);
                                                                                }}
                                                                                style={{
                                                                                    padding: '0.4rem 0',
                                                                                    border: 'none',
                                                                                    borderRadius: '4px',
                                                                                    background: isSelected ? 'var(--color-blue)' : (isValid ? '#f8fafc' : 'transparent'),
                                                                                    color: isSelected ? 'white' : (isValid ? '#1e293b' : '#cbd5e1'),
                                                                                    cursor: isValid ? 'pointer' : 'not-allowed',
                                                                                    fontWeight: isSelected ? 'bold' : 'normal',
                                                                                    fontSize: '0.8rem',
                                                                                    fontVariantNumeric: 'tabular-nums'
                                                                                }}
                                                                            >
                                                                                {d}
                                                                            </button>
                                                                        );
                                                                    }
                                                                    return cells;
                                                                })()}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* KPIs de Faturamento */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                                            <div style={{
                                                border: '1px solid #bbf7d0',
                                                background: '#f0fdf4',
                                                padding: '0.5rem 1rem',
                                                borderRadius: '10px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'flex-end',
                                                minWidth: '155px'
                                            }}>
                                                <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                                    Total a Pagar (Filtro)
                                                </span>
                                                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#14532d', fontVariantNumeric: 'tabular-nums' }}>
                                                    {totalVisibleInvoicesValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                </span>
                                            </div>

                                            <div style={{
                                                border: '1px solid #fecaca',
                                                background: '#fef2f2',
                                                padding: '0.5rem 1rem',
                                                borderRadius: '10px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'flex-end',
                                                minWidth: '155px'
                                            }}>
                                                <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                                    Total Geral em Aberto
                                                </span>
                                                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#7f1d1d', fontVariantNumeric: 'tabular-nums' }}>
                                                    {totalUnpaidGlobal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Ações de Emissão e Filtro de Competência */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem' }}>
                                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
                                                                const dueDate = specificDueDate.toISOString().split('T')[0];
                                                                const result = await createAsaasCharge(subscriber.id, 'subscriber', {
                                                                    dueDate,
                                                                    invoice_ids: invoices
                                                                        .filter(inv => {
                                                                            const s = inv.status?.trim().toLowerCase();
                                                                            return s !== 'pago' && 
                                                                                   s !== 'cancelado' && 
                                                                                   (!inv.consolidated_invoice_id || inv.consolidated_invoice_id === null);
                                                                        })
                                                                        .map(i => i.id)
                                                                });

                                                                if (result.semBoleto) {
                                                                    showAlert(result.mensagem, 'info');
                                                                    await fetchInvoices(subscriber.id);
                                                                } else if (result.success) {
                                                                    showAlert('Fatura consolidada gerada com sucesso!', 'success');
                                                                    await Promise.all([
                                                                        fetchInvoices(subscriber.id),
                                                                        fetchConsolidatedInvoices(subscriber.id)
                                                                    ]);

                                                                    if (result.consolidatedId) {
                                                                        await new Promise(resolve => setTimeout(resolve, 1500));
                                                                        const { data: newCons } = await supabase
                                                                            .from('consolidated_invoices')
                                                                            .select('*')
                                                                            .eq('id', result.consolidatedId)
                                                                            .single();
                                                                        if (newCons) {
                                                                            const pdfBlob = await handleDownloadConsolidated(newCons);
                                                                            if (pdfBlob) {
                                                                                showAlert('Enviando notificações da consolidada...', 'info');
                                                                                const monthYearStr = newCons.mes_referencia ? newCons.mes_referencia.substring(0, 7).split('-').reverse().join('_') : '';
                                                                                const cleanSubName = (subscriber?.name || 'Cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_').replace(/[^\w]/g, '');
                                                                                const fileName = `Fatura_Consolidada_${cleanSubName}_${monthYearStr}.pdf`;
                                                                                
                                                                                await sendCombinedNotification({
                                                                                    recipientEmail: formData.email,
                                                                                    recipientPhone: formData.phone,
                                                                                    subscriberName: formData.name,
                                                                                    dueDate: new Date(newCons.due_date + 'T12:00:00').toLocaleDateString('pt-BR'),
                                                                                    value: Number(newCons.total_value || totalToConsolidate).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                                                                                    pdfBlob: pdfBlob,
                                                                                    fileName: fileName,
                                                                                    subscriberId: subscriber.id,
                                                                                    profileId: profile?.id,
                                                                                    isConsolidated: true,
                                                                                    invoiceId: newCons.id
                                                                                });
                                                                                showAlert('Notificações consolidadas enviadas com sucesso!', 'success');
                                                                            }
                                                                        }
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
                                                            background: '#ea580c', color: 'white', border: 'none',
                                                            padding: '0.58rem 1.15rem', borderRadius: '10px', cursor: (generating || totalToConsolidate === 0) ? 'not-allowed' : 'pointer',
                                                            fontWeight: 700, fontSize: '0.84rem',
                                                            opacity: (generating || totalToConsolidate === 0) ? 0.55 : 1
                                                        }}
                                                    >
                                                        <CreditCard size={16} /> {generating ? 'Gerando...' : 'Emitir Fatura Consolidada'}
                                                    </button>

                                                    {showConsolidationHelp && totalToConsolidate === 0 && (
                                                        <div style={{
                                                            position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '10px',
                                                            width: '250px', background: '#0f172a', color: 'white', padding: '0.9rem', borderRadius: '10px',
                                                            fontSize: '0.78rem', zIndex: 100, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)', pointerEvents: 'none'
                                                        }}>
                                                            <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: '#fb923c' }}>Consolidação Indisponível</div>
                                                            Todas as faturas visíveis já possuem boletos emitidos individualmente. Para consolidar, cancele os boletos existentes.
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <div style={{ position: 'relative' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowMonthPicker(!showMonthPicker)}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                        background: '#f8fafc', color: '#0f172a', border: '1px solid #cbd5e1',
                                                        padding: '0.55rem 1rem', borderRadius: '10px', cursor: 'pointer',
                                                        fontWeight: 700, fontSize: '0.84rem', fontVariantNumeric: 'tabular-nums'
                                                    }}
                                                >
                                                    <Calendar size={16} color="#2563eb" />
                                                    {invoiceMonthFilter === 'all' ? 'Todas as Competências' : (() => {
                                                        const [y, m] = invoiceMonthFilter.split('-');
                                                        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                                                        return `${months[parseInt(m) - 1]} / ${y}`;
                                                    })()}
                                                </button>
                                                {showMonthPicker && (
                                                    <div style={{
                                                        position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem',
                                                        background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px',
                                                        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                                                        padding: '1rem', zIndex: 100, width: '270px'
                                                    }}>
                                                        <div style={{ marginBottom: '0.85rem', display: 'flex', gap: '0.5rem' }}>
                                                            <select
                                                                value={invoiceMonthFilter === 'all' ? new Date().getMonth() + 1 : parseInt(invoiceMonthFilter.split('-')[1])}
                                                                onChange={(e) => {
                                                                    const currentYear = invoiceMonthFilter === 'all' ? new Date().getFullYear() : invoiceMonthFilter.split('-')[0];
                                                                    setInvoiceMonthFilter(`${currentYear}-${String(e.target.value).padStart(2, '0')}`);
                                                                }}
                                                                style={{ flex: 1, padding: '0.45rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }}
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
                                                                style={{ flex: 1, padding: '0.45rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }}
                                                            >
                                                                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + 2 - i).map(year => (
                                                                    <option key={year} value={year}>{year}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setInvoiceMonthFilter('all');
                                                                    setShowMonthPicker(false);
                                                                }}
                                                                style={{ flex: 1, padding: '0.5rem', background: '#f1f5f9', border: 'none', borderRadius: '8px', fontSize: '0.8rem', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
                                                            >Todas as Datas</button>
                                                            <button type="button" onClick={() => setShowMonthPicker(false)} style={{ padding: '0.5rem 0.9rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>OK</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Consolidated Invoices Section */}
                                {billingMode === 'consolidada' && consolidatedInvoices.length > 0 && (
                                    <div style={subCardStyle}>
                                        <h4 style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 700, margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <FileText size={17} color="#2563eb" /> Faturas Consolidadas Emitidas
                                        </h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.85rem' }}>
                                            {consolidatedInvoices
                                                .filter(ci => {
                                                    const status = ci.status?.toLowerCase();
                                                    return status !== 'canceled' && status !== 'cancelado';
                                                })
                                                .map(ci => (
                                                <div key={ci.id} style={{
                                                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1rem',
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    position: 'relative'
                                                }}>
                                                    <div>
                                                        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                                                            {ci.total_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                        </div>
                                                        <div style={{ fontSize: '0.76rem', color: '#64748b', fontVariantNumeric: 'tabular-nums', marginTop: '0.15rem' }}>
                                                            Vencimento: <strong>{new Date(ci.due_date + (ci.due_date.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('pt-BR')}</strong>
                                                        </div>
                                                        <div style={{ marginTop: '0.4rem' }}>
                                                            <span style={{
                                                                fontSize: '0.66rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: '999px',
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
                                                                    style={{ padding: '0.4rem', borderRadius: '8px', border: '1px solid #bae6fd', background: '#f0f9ff', color: '#0369a1', cursor: 'pointer' }}
                                                                >
                                                                    <Eye size={16} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDownloadConsolidated(ci)}
                                                                    title="Download PDF Consolidado"
                                                                    disabled={isGeneratingPdf}
                                                                    style={{ padding: '0.4rem', borderRadius: '8px', border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c', cursor: 'pointer' }}
                                                                >
                                                                    {isGeneratingPdf && consolidatedToDownload?.id === ci.id ? <Loader2 size={16} className="spin-animation" /> : <Download size={16} />}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleResendNotification(ci, true)}
                                                                    title="Reenviar Fatura (Email/WhatsApp)"
                                                                    disabled={isGeneratingPdf}
                                                                    style={{ padding: '0.4rem', borderRadius: '8px', border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', cursor: 'pointer' }}
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
                                                                        await cancelAsaasCharge(ci.id, 'consolidated_invoice');
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
                                                                        
                                                                        fetchConsolidatedInvoices(subscriber.id);
                                                                        fetchInvoices(subscriber.id);
                                                                        
                                                                        showAlert('Fatura consolidada cancelada e itens liberados para nova emissão.', 'info');
                                                                    } catch (e) {
                                                                        showAlert('Erro ao cancelar: ' + e.message, 'error');
                                                                    }
                                                                }}
                                                                title="Cancelar Fatura"
                                                                style={{ padding: '0.4rem', borderRadius: '8px', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
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

                                {/* Faturas Individuais Section */}
                                {billingMode === 'individualizada' && invoices.length > 0 && (
                                    <div style={subCardStyle}>
                                        <h4 style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 700, margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <FileText size={17} color="#2563eb" /> Faturas Individuais Emitidas
                                        </h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.85rem' }}>
                                            {invoices
                                                .filter(inv => {
                                                    const status = inv.status?.toLowerCase();
                                                    return status !== 'canceled' && status !== 'cancelado';
                                                })
                                                .map(inv => {
                                                    const ucNum = consumerUnits.find(u => u.id === inv.uc_id)?.numero_uc || 'N/A';
                                                    return (
                                                        <div key={inv.id} style={{
                                                            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1rem',
                                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                            position: 'relative'
                                                        }}>
                                                            <div>
                                                                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                                                                    {Number(inv.valor_a_pagar).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                                </div>
                                                                <div style={{ fontSize: '0.76rem', color: '#475569', fontVariantNumeric: 'tabular-nums', marginTop: '0.1rem' }}>
                                                                    UC: <strong>{ucNum}</strong>
                                                                </div>
                                                                <div style={{ fontSize: '0.75rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                                                                    Vencimento: {inv.vencimento ? new Date(inv.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : 'N/A'}
                                                                </div>
                                                                <div style={{ marginTop: '0.4rem' }}>
                                                                    <span style={{
                                                                        fontSize: '0.66rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: '999px',
                                                                        background: inv.status === 'pago' ? '#dcfce7' : inv.status === 'atrasado' ? '#fee2e2' : '#fef9c3',
                                                                        color: inv.status === 'pago' ? '#166534' : inv.status === 'atrasado' ? '#991b1b' : '#854d0e',
                                                                        textTransform: 'uppercase'
                                                                    }}>{inv.status}</span>
                                                                </div>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                                {inv.asaas_boleto_url && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => window.open(inv.asaas_boleto_url, '_blank')}
                                                                        title="Visualizar Boleto"
                                                                        style={{ padding: '0.4rem', borderRadius: '8px', border: '1px solid #bae6fd', background: '#f0f9ff', color: '#0369a1', cursor: 'pointer' }}
                                                                    >
                                                                        <Eye size={16} />
                                                                    </button>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDownloadCombined(inv)}
                                                                    title="Imprimir Fatura"
                                                                    disabled={isGeneratingPdf}
                                                                    style={{ padding: '0.4rem', borderRadius: '8px', border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c', cursor: 'pointer' }}
                                                                >
                                                                    {isGeneratingPdf && invoiceToDownload?.id === inv.id ? <Loader2 size={16} className="spin-animation" /> : <Printer size={16} />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ==================== ABA: COMUNICADOS ==================== */}
                        {activeTab === 'comunicacao' && (
                            <div style={{ animation: 'subFadeIn 0.2s ease-out' }} className="sub-modal-grid-2">
                                {/* Composer */}
                                <div style={subCardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                            <MessageSquare size={18} color="#16a34a" /> Enviar Novo Comunicado (WhatsApp)
                                        </h4>
                                        {formData.phone && (
                                            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '0.18rem 0.55rem', borderRadius: '999px', fontVariantNumeric: 'tabular-nums' }}>
                                                Destino: {formData.phone}
                                            </span>
                                        )}
                                    </div>

                                    <textarea
                                        className="sub-modal-input"
                                        value={manualMessage}
                                        onChange={(e) => setManualMessage(e.target.value)}
                                        placeholder="Digite a mensagem personalizada para enviar ao WhatsApp do assinante..."
                                        style={{
                                            ...subInputStyle,
                                            height: '140px',
                                            resize: 'vertical',
                                            marginBottom: '1rem',
                                            fontFamily: 'inherit',
                                            lineHeight: 1.5
                                        }}
                                    />

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <label style={{ 
                                                display: 'inline-flex', alignItems: 'center', gap: '0.45rem', 
                                                padding: '0.52rem 0.95rem', background: '#f8fafc', 
                                                borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem',
                                                color: '#334155', fontWeight: 700, border: '1px solid #cbd5e1'
                                            }}>
                                                <Paperclip size={15} />
                                                {manualFile ? 'Trocar Anexo' : 'Anexar Arquivo'}
                                                <input 
                                                    type="file" 
                                                    style={{ display: 'none' }} 
                                                    onChange={(e) => setManualFile(e.target.files[0])}
                                                />
                                            </label>
                                            {manualFile && (
                                                <span style={{ fontSize: '0.78rem', color: '#0f172a', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#f1f5f9', padding: '0.3rem 0.65rem', borderRadius: '8px' }}>
                                                    {manualFile.name} ({(manualFile.size / 1024).toFixed(0)} KB)
                                                    <button 
                                                        type="button"
                                                        onClick={() => setManualFile(null)}
                                                        style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', display: 'inline-flex', padding: 0 }}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </span>
                                            )}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={handleSendManualWA}
                                            disabled={isSendingManualWA || !manualMessage.trim()}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                                background: '#16a34a', color: 'white', border: 'none',
                                                padding: '0.6rem 1.35rem', borderRadius: '10px',
                                                fontWeight: 700, fontSize: '0.85rem',
                                                cursor: (isSendingManualWA || !manualMessage.trim()) ? 'not-allowed' : 'pointer',
                                                opacity: (isSendingManualWA || !manualMessage.trim()) ? 0.6 : 1
                                            }}
                                        >
                                            {isSendingManualWA ? <Loader2 size={16} className="spin-animation" /> : <Send size={16} />}
                                            {isSendingManualWA ? 'Enviando...' : 'Enviar WhatsApp'}
                                        </button>
                                    </div>
                                </div>

                                {/* History Section */}
                                <div style={subCardStyle}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <History size={18} color="#2563eb" />
                                        <h4 style={{ margin: 0, fontSize: '0.98rem', color: '#0f172a', fontWeight: 700 }}>
                                            Histórico de Interações e Eventos
                                        </h4>
                                    </div>
                                    <HistoryTimeline
                                        entityType="subscriber"
                                        entityId={subscriber?.id}
                                        entityName={formData.name}
                                        onClose={() => setActiveTab('dados')}
                                        isInline={true}
                                        refreshTrigger={historyRefreshKey}
                                    />
                                </div>
                            </div>
                        )}

                        {/* ==================== ABA: CONTRATOS ==================== */}
                        {activeTab === 'contratos' && (
                            <div style={{ animation: 'subFadeIn 0.2s ease-out' }} className="sub-modal-grid-2">
                                <div style={subCardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                            <FileText size={18} color="#1d4ed8" /> Minuta e Emissão de Contrato (Autentique)
                                        </h4>
                                    </div>

                                    <div style={{ marginBottom: '1.15rem', padding: '0.8rem 1rem', background: '#f0f9ff', borderRadius: '10px', border: '1px solid #bae6fd' }}>
                                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#0369a1', lineHeight: 1.45 }}>
                                            <Info size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
                                            O contrato é <strong>gerado automaticamente</strong> com os dados cadastrais, endereço e UCs vinculadas.
                                        </p>
                                    </div>

                                    <div style={{ marginBottom: '1.15rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                                            <label style={{ ...subLabelStyle, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                Minuta do Contrato (Conferência)
                                                {minutaEditada && (
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                                        padding: '0.15rem 0.55rem', borderRadius: '999px',
                                                        background: '#fffbeb', border: '1px solid #fde68a',
                                                        color: '#92400e', fontSize: '0.68rem', fontWeight: 700, textTransform: 'none'
                                                    }}>
                                                        <AlertCircle size={12} /> Editada manualmente
                                                    </span>
                                                )}
                                            </label>
                                            {minutaEditada && (
                                                <button
                                                    type="button"
                                                    onClick={() => setContractDraft(textoGeradoAssinante)}
                                                    style={{ padding: '0.32rem 0.7rem', background: '#ffffff', color: '#92400e', border: '1px solid #fde68a', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.74rem' }}
                                                >
                                                    Restaurar padrão
                                                </button>
                                            )}
                                        </div>
                                        <textarea
                                            className="sub-modal-input"
                                            value={contractDraft}
                                            onChange={(e) => setContractDraft(e.target.value)}
                                            placeholder="A minuta será gerada automaticamente..."
                                            style={{
                                                ...subInputStyle,
                                                height: '240px',
                                                fontSize: '0.84rem',
                                                lineHeight: 1.5,
                                                resize: 'vertical',
                                                fontFamily: 'monospace'
                                            }}
                                        />
                                    </div>

                                    <div style={{ marginBottom: '1.25rem' }}>
                                        <label style={subLabelStyle}>Link de Assinatura Digital (Autentique)</label>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <input
                                                className="sub-modal-input"
                                                type="text"
                                                value={signatureLink}
                                                onChange={(e) => setSignatureLink(e.target.value)}
                                                placeholder="Link será exibido aqui após geração..."
                                                style={{ ...subInputStyle, flex: 1, background: '#ffffff' }}
                                            />
                                            {signatureLink && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(signatureLink);
                                                        showAlert('Link copiado!', 'success');
                                                    }}
                                                    style={{
                                                        padding: '0 0.85rem',
                                                        background: '#f8fafc',
                                                        border: '1px solid #cbd5e1',
                                                        borderRadius: '10px',
                                                        cursor: 'pointer',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '0.35rem',
                                                        fontWeight: 700,
                                                        fontSize: '0.78rem',
                                                        color: '#334155'
                                                    }}
                                                    title="Copiar Link"
                                                >
                                                    <Copy size={15} /> Copiar
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleSendContract}
                                        disabled={isCreatingContract || !subscriber?.id}
                                        style={{
                                            width: '100%',
                                            padding: '0.75rem 1rem',
                                            background: isCreatingContract ? '#f1f5f9' : '#0f172a',
                                            color: isCreatingContract ? '#94a3b8' : '#ffffff',
                                            border: 'none',
                                            borderRadius: '10px',
                                            fontWeight: 700,
                                            fontSize: '0.86rem',
                                            cursor: (isCreatingContract || !subscriber?.id) ? 'not-allowed' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.6rem',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        {isCreatingContract ? <Loader2 size={18} className="spin-animation" /> : <Send size={18} />}
                                        {isCreatingContract ? 'Gerando e Enviando...' : 'Gerar e Enviar para Assinatura Eletrônica'}
                                    </button>
                                </div>

                                {/* Histórico de Contratos */}
                                <div style={subCardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.98rem', color: '#0f172a', fontWeight: 700 }}>
                                            Histórico de Assinaturas Eletrônicas
                                        </h4>
                                        <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#475569', background: '#f1f5f9', padding: '0.15rem 0.55rem', borderRadius: '999px', fontVariantNumeric: 'tabular-nums' }}>
                                            {signatures.length} {signatures.length === 1 ? 'documento' : 'documentos'}
                                        </span>
                                    </div>
                                    
                                    {loadingSignatures ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2.5rem', gap: '0.5rem' }}>
                                            <Loader2 size={28} className="spin-animation" color="#2563eb" />
                                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Carregando histórico...</span>
                                        </div>
                                    ) : signatures.length > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                                            {signatures.map(sig => (
                                                <div key={sig.id} style={{
                                                    padding: '1rem 1.15rem',
                                                    border: '1px solid #e2e8f0',
                                                    borderRadius: '12px',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    gap: '0.75rem',
                                                    background: '#f8fafc'
                                                }}>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f172a', marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {sig.document_name}
                                                        </div>
                                                        <div style={{ fontSize: '0.76rem', color: '#64748b', display: 'flex', gap: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>
                                                            <span>Data: {new Date(sig.created_at).toLocaleDateString('pt-BR')}</span>
                                                            <span>Hora: {new Date(sig.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                                                        </div>
                                                        <div style={{ marginTop: '0.6rem' }}>
                                                            <select
                                                                value={sig.status}
                                                                onChange={(e) => handleUpdateSignatureStatus(sig.id, e.target.value)}
                                                                style={{
                                                                    fontSize: '0.68rem',
                                                                    fontWeight: 800,
                                                                    padding: '0.22rem 0.65rem',
                                                                    borderRadius: '999px',
                                                                    background: (sig.status === 'signed' || sig.status === 'CLOSED') ? '#dcfce7' : sig.status === 'rejected' ? '#fee2e2' : sig.status === 'created' ? '#dbeafe' : '#fef9c3',
                                                                    color: (sig.status === 'signed' || sig.status === 'CLOSED') ? '#166534' : sig.status === 'rejected' ? '#991b1b' : sig.status === 'created' ? '#1e40af' : '#854d0e',
                                                                    border: `1px solid ${(sig.status === 'signed' || sig.status === 'CLOSED') ? '#bbf7d0' : sig.status === 'rejected' ? '#fecaca' : sig.status === 'created' ? '#bfdbfe' : '#fef08a'}`,
                                                                    textTransform: 'uppercase',
                                                                    letterSpacing: '0.04em',
                                                                    cursor: 'pointer',
                                                                    outline: 'none'
                                                                }}
                                                            >
                                                                <option value="pending">Pendente</option>
                                                                <option value="signed">Assinado</option>
                                                                <option value="rejected">Rejeitado</option>
                                                                <option value="canceled">Cancelado</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.45rem' }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => window.open(sig.autentique_url, '_blank')}
                                                            title="Ver no Autentique"
                                                            style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', cursor: 'pointer' }}
                                                        >
                                                            <Eye size={16} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleResendContractLink(sig)}
                                                            title="Reenviar Links (WhatsApp/Email)"
                                                            style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', cursor: 'pointer' }}
                                                        >
                                                            <RefreshCw size={16} />
                                                        </button>
                                                        {sig.status === 'pending' && (
                                                            <button
                                                                type="button"
                                                                disabled={cancelingSignature === sig.id}
                                                                onClick={() => handleCancelContract(sig)}
                                                                title="Cancelar na Autentique e invalidar o link"
                                                                style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', cursor: cancelingSignature === sig.id ? 'not-allowed' : 'pointer' }}
                                                            >
                                                                {cancelingSignature === sig.id ? <Loader2 size={16} className="spin-animation" /> : <Ban size={16} />}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div style={{ 
                                            textAlign: 'center', 
                                            color: '#64748b', 
                                            padding: '2.5rem 1.5rem', 
                                            border: '1px dashed #cbd5e1', 
                                            borderRadius: '12px',
                                            background: '#f8fafc'
                                        }}>
                                            <FileText size={36} color="#94a3b8" style={{ marginBottom: '0.5rem' }} />
                                            <p style={{ margin: 0, fontWeight: 700, color: '#334155', fontSize: '0.9rem' }}>Nenhum contrato enviado ainda</p>
                                            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem' }}>Os documentos enviados via Autentique aparecerão listados aqui.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ==================== ABA: DOCUMENTOS ==================== */}
                        {activeTab === 'documentos' && (
                            <div style={{ animation: 'subFadeIn 0.2s ease-out' }}>
                                <div style={subCardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.15rem', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                                        <div>
                                            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0f172a', fontSize: '0.98rem', fontWeight: 700 }}>
                                                <Paperclip size={18} color="#7c3aed" /> Dossiê e Documentos do Assinante
                                            </h4>
                                            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                                                Documentos pessoais, societários, procurações e contas de energia anexadas.
                                            </p>
                                        </div>
                                    </div>
                                    {subscriber?.id ? (
                                        <DocumentosAssinante
                                            subscriberId={subscriber.id}
                                            cpfCnpj={formData.cpf_cnpj}
                                            ucs={consumerUnits}
                                            podeEnviar={ehPapelAdmin(profile?.role)}
                                        />
                                    ) : (
                                        <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
                                            Salve os dados cadastrais do assinante primeiro para visualizar ou anexar documentos.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Pinned Modal Footer */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '1rem 1.75rem',
                        background: '#ffffff',
                        borderTop: '1px solid #e2e8f0',
                        flexShrink: 0,
                        gap: '1rem',
                        flexWrap: 'wrap'
                    }}>
                        <div>
                            {subscriber && onDelete && (
                                <button
                                    type="button"
                                    onClick={handleDelete}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        padding: '0.62rem 1.15rem',
                                        background: '#fef2f2',
                                        color: '#dc2626',
                                        borderRadius: '10px',
                                        border: '1px solid #fecaca',
                                        fontWeight: 700,
                                        fontSize: '0.84rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <Trash2 size={15} /> Excluir Assinante
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            {subscriber?.id && (
                                <ConvidarAppButton tipo="subscriber" id={subscriber.id} nome={subscriber.name} style={{ borderRadius: '10px', padding: '0.62rem 1.1rem', fontSize: '0.84rem' }} />
                            )}
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    padding: '0.62rem 1.25rem',
                                    background: '#ffffff',
                                    color: '#475569',
                                    borderRadius: '10px',
                                    border: '1px solid #cbd5e1',
                                    fontWeight: 700,
                                    fontSize: '0.84rem',
                                    cursor: 'pointer'
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
                                    color: 'white',
                                    borderRadius: '10px',
                                    fontWeight: 700,
                                    fontSize: '0.86rem',
                                    border: 'none',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)'
                                }}
                            >
                                {loading ? 'Salvando...' : 'Salvar Assinante'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            {showHistory && subscriber && (
                <HistoryTimeline
                    entityType="subscriber"
                    entityId={subscriber.id}
                    entityName={formData.name}
                    onClose={() => setShowHistory(false)}
                    isInline={true}
                    refreshTrigger={historyRefreshKey}
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
                <div ref={contractFullRef}>
                    <ContratoAdesao
                        subscriber={formData}
                        consumerUnits={consumerUnits}
                        branding={branding}
                        texto={contractDraft}
                    />
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
                            {/* A URL do portal não é cadastrada: ela vive no driver da
                                concessionária (scraper/drivers/), junto com os seletores
                                que dependem dela. Aqui só entra o que varia por titular. */}
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>CPF / CNPJ do titular</label>
                                <input
                                    type="text"
                                    value={formData.portal_credentials?.login || ''}
                                    onChange={e => setFormData({
                                        ...formData,
                                        portal_credentials: { ...formData.portal_credentials, login: e.target.value }
                                    })}
                                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                                    style={{ width: '100%', padding: '0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>Senha</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={senhaPortal}
                                        onChange={e => setSenhaPortal(e.target.value)}
                                        placeholder={temSenhaGuardada ? 'Senha guardada — preencha só para trocar' : 'Senha do portal da concessionária'}
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
