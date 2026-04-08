import { supabase } from './supabase';

/**
 * Busca endereço pelo CEP usando VIACEP
 */
export const fetchAddressByCep = async (cep) => {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8) throw new Error('CEP inválido');
    const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
    const data = await response.json();
    if (data.erro) throw new Error('CEP não encontrado');
    return {
        rua: data.logradouro,
        bairro: data.bairro,
        cidade: data.localidade,
        uf: data.uf,
        cep: data.cep,
        ibge: data.ibge
    };
};

/**
 * Busca dados do CPF/CNPJ usando API Gratis
 */
export const fetchCpfCnpjData = async (doc) => {
    const cleanDoc = doc.replace(/\D/g, '');
    const isCnpj = cleanDoc.length > 11;

    if (!isCnpj) {
        console.warn('Busca de CPF desabilitada temporariamente.');
        return { nome: '', doc: cleanDoc };
    } else {
        try {
            const response = await fetch(`https://publica.cnpj.ws/cnpj/${cleanDoc}`);
            if (!response.ok) throw new Error('Erro ao buscar CNPJ');
            const data = await response.json();
            const est = data.estabelecimento || {};
            const socio = data.socios && data.socios.length > 0 ? data.socios[0] : null;

            return {
                nome: data.razao_social,
                fantasia: est.nome_fantasia,
                doc: cleanDoc,
                email: est.email,
                telefone: est.ddd1 && est.telefone1 ? `(${est.ddd1}) ${est.telefone1}` : '',
                address: {
                    logradouro: est.logradouro,
                    numero: est.numero,
                    bairro: est.bairro,
                    cep: est.cep,
                    uf: est.estado?.sigla,
                    municipio: est.cidade?.nome,
                    cidade: est.cidade?.nome
                },
                legal_partner: socio ? { nome: socio.nome, cpf: socio.cpf_cnpj_socio } : { nome: '', cpf: '' },
                raw: data
            };
        } catch (error) {
            console.error('Erro CNPJ', error);
            throw error;
        }
    }
}

/**
 * Helper unificado para chamadas de Edge Functions com tratamento de erro detalhado
 */
const callFunction = async (name, payload) => {
    const { data, error } = await supabase.functions.invoke(name, { body: payload });
    
    if (error) {
        let msg = error.message;
        try {
            // Tenta extrair a mensagem de erro detalhada do corpo da resposta
            const body = await error.context?.json();
            if (body && (body.error || body.message)) {
                msg = body.error || body.message;
            }
        } catch (e) {
            // Se não for JSON, mantém a mensagem original do Supabase
        }
        throw new Error(msg);
    }
    
    if (data?.error) throw new Error(data.error);
    return data;
};

export const manageAsaasCustomer = async (data) => {
    return callFunction('manage-asaas-customer', data);
};

export const fetchOfferData = async (ibge) => {
    const { data, error } = await supabase
        .from('Concessionaria')
        .select('*')
        .eq('"Cod. Ibge"', ibge)
        .single();
    if (error) return null;
    return data;
};

export const createAsaasCharge = async (id, type = 'invoice', extra = {}) => {
    const payload = type === 'invoice' ? { invoice_id: id, ...extra } : { subscriber_id: id, ...extra };
    return callFunction('create-asaas-charge', payload);
};

export async function cancelAsaasCharge(invoiceId) {
    return callFunction('cancel-asaas-charge', { invoice_id: invoiceId });
}

export async function updateAsaasCharge(invoiceId, value, dueDate) {
    return callFunction('update-asaas-charge', { invoice_id: invoiceId, value, dueDate });
}

export const sendWhatsapp = async (phone, text, mediaUrl = null, mediaBase64 = null, fileName = null, instanceName = null) => {
    return callFunction('send-whatsapp', {
        phone: phone ? phone.replace(/\D/g, '') : '',
        text,
        mediaUrl,
        mediaBase64,
        fileName,
        instanceName
    });
};

export const mergePdf = async (summaryBase64, asaasUrl, fileName = 'fatura.pdf', energyBillUrl = null, asaasPdfStorageUrl = null) => {
    const body = { 
        summaryBase64, 
        asaasUrl, 
        asaasPdfStorageUrl 
    };

    // Suporta tanto uma única URL (string) quanto várias (array)
    if (Array.isArray(energyBillUrl)) {
        body.energyBillUrls = energyBillUrl;
    } else if (energyBillUrl) {
        body.energyBillUrl = energyBillUrl;
    }

    const { data, error } = await supabase.functions.invoke('merge-pdf', { body });
    if (error) {
        let msg = error.message;
        try {
            const bodyErr = await error.context?.json();
            if (bodyErr && (bodyErr.error || bodyErr.message)) msg = bodyErr.error || bodyErr.message;
        } catch (e) {}
        const customError = new Error(msg);
        customError.status = error.status || error.context?.status;
        throw customError;
    }
    const blob = new Blob([data], { type: 'application/pdf' });
    return blob;
};

export const parseInvoice = async (pdfBase64) => {
    return callFunction('parse-invoice', { pdfBase64 });
};

export const sendInvoiceEmail = async (to, subject, html = null, attachments = [], variables = null) => {
    return callFunction('send-email', { to, subject, html, attachments, variables });
};


/**
 * Helper unificado para enviar notificações de fatura (Email + WhatsApp)
 */
export const sendCombinedNotification = async ({
    recipientEmail,
    recipientPhone,
    subscriberName,
    dueDate,
    value,
    pdfBlob,
    fileName,
    subscriberId,
    profileId,
    isConsolidated = false
}) => {
    try {
        const { data: configs } = await supabase
            .from('integrations_config')
            .select('*')
            .in('service_name', ['financial_api', 'evolution_api', 'resend_api']);

        const { data: branding } = await supabase
            .from('branding_settings')
            .select('company_name')
            .single();

        const companyName = branding?.company_name || 'B2W Energia';
        const asaasConfig = configs?.find(c => c.service_name === 'financial_api');
        const evolutionConfig = configs?.find(c => c.service_name === 'evolution_api');
        const resendConfig = configs?.find(c => c.service_name === 'resend_api');

        const isSandbox = asaasConfig?.environment === 'sandbox';
        
        let testPhone = '';
        if (evolutionConfig?.variables) {
            const vars = evolutionConfig.variables;
            testPhone = (typeof vars === 'object' && !Array.isArray(vars)) 
                ? vars.test_phone 
                : (Array.isArray(vars) ? vars.find(v => v.key === 'test_phone')?.value : '');
        }

        const targetPhone = isSandbox ? (testPhone || '5533999991234') : recipientPhone;
        const targetEmailForLog = isSandbox ? (resendConfig?.variables?.test_email || 'waldineygodoy@gmail.com') : recipientEmail;

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(pdfBlob);
            reader.onerror = reject;
            reader.onloadend = async () => {
                const base64Data = reader.result.split(',')[1];
                const fullBase64 = reader.result;

                // E-mail em paralelo com WhatsApp
                const emailPromise = sendInvoiceEmail(
                    recipientEmail, 
                    'Sua fatura B2W Energia chegou!',
                    null,
                    [{ filename: fileName, content: base64Data }],
                    { nome: subscriberName, vencimento: dueDate, valor: value }
                ).catch(e => ({ error: e.message }));

                const waText = `Sua fatura da *${companyName}* chegou! ⚡⚡


Olá, *${subscriberName}*.


Sua fatura com vencimento em *${dueDate}* no valor de *${value}* já está disponível.


Segue em anexo o PDF completo (Demonstrativo + Boleto). 📄


Clique no link abaixo para acessar nosso portal e veja o quanto economizou esse mês.
https://app.b2wenergia.com.br


*${companyName}* ☀️`;
                
                // Agora delegamos o upload para a Edge Function para evitar problemas de RLS no frontend
                const waPromise = targetPhone ? sendWhatsapp(
                    targetPhone,
                    waText,
                    null,       // No mediaUrl at first
                    fullBase64, // Send Base64, Edge Function will upload to Storage
                    fileName
                ).catch(e => ({ error: e.message })) : Promise.resolve({ skipped: true });

                const [emailRes, waRes] = await Promise.all([emailPromise, waPromise]);

                await supabase.from('crm_history').insert({
                    entity_type: 'subscriber',
                    entity_id: subscriberId,
                    content: `Envio de Fatura: Email [${emailRes.error ? 'falhou' : 'enviado'}] | WhatsApp [${waRes.error ? 'falhou' : 'enviado'}]`,
                    metadata: {
                        email_status: emailRes.error ? 'error' : 'sent',
                        wa_status: waRes.error ? 'error' : (waRes.skipped ? 'skipped' : 'sent'),
                        recipient_email: targetEmailForLog,
                        recipient_phone: targetPhone,
                        sandbox: isSandbox,
                        error_details: { email: emailRes.error, wa: waRes.error }
                    },
                    created_by: profileId
                });

                resolve({ emailRes, waRes, isSandbox, targetEmailForLog, targetPhone });
            };
        });
    } catch (error) {
        console.error('Error in sendCombinedNotification:', error);
        throw error;
    }
};
