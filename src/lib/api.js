import { supabase } from './supabase';

/**
 * Senha de portal de concessionária.
 *
 * A senha nunca vai na linha da entidade: quem a guarda é o Vault, e a linha
 * fica só com a referência ao segredo. Antes disso ela morava em texto puro
 * dentro de portal_credentials, e a policy da tabela é "tudo liberado para
 * usuário logado" — ou seja, qualquer pessoa com acesso ao CRM lia a senha
 * de todos os titulares pela API.
 *
 * Só o service_role consegue LER de volta (é o robô que precisa dela). A tela
 * escreve e nunca mais vê o valor. String vazia apaga a senha guardada.
 */
export const salvarSenhaPortal = async (entidade, id, senha) => {
    const { error } = await supabase.rpc('fn_set_portal_password', {
        p_entidade: entidade,
        p_id: id,
        p_senha: senha ?? '',
    });
    if (error) throw error;
};

/** Tira a senha do objeto de credenciais antes de gravar a linha. */
export const semSenha = (credenciais) => {
    const { password, ...resto } = credenciais || {};
    return resto;
};

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

/**
 * Recalcula o valor do assinante no servidor e persiste.
 *
 * A tela continua fazendo a conta enquanto o usuário digita — é o que dá o
 * preview instantâneo — mas o número que FICA gravado vem daqui. Enquanto a
 * fórmula viveu só no React, nenhum processo de servidor sabia calcular o
 * valor, e as duas aritméticas podiam divergir sem ninguém perceber.
 *
 * Recusa faturas que já têm cobrança no Asaas: recalcular mudaria em silêncio
 * um valor que o assinante já recebeu como boleto.
 */
export const recalcularFatura = async (invoiceId) => {
    const { data, error } = await supabase.rpc('fn_calcular_fatura', {
        p_invoice_id: invoiceId,
        p_gravar: true,
    });
    if (error) throw error;
    return data?.[0] || null;
};

/**
 * Tarifa de referência da tabela Concessionária (Configurações -> Conta de
 * Energia -> Tarifas Concessionárias).
 *
 * Resolve por código IBGE quando a linha do município existe e, na falta,
 * por concessionária + UF. O fallback importa: a tabela do RN tem 143 dos
 * 167 municípios, e uma UC em município ausente ficava com tarifa zero para
 * sempre — sem como corrigir, porque o campo na tela é somente leitura.
 *
 * Devolve null quando não há referência cadastrada.
 */
export const buscarTarifaReferencia = async (concessionaria, uf = null, ibge = null) => {
    if (!concessionaria) return null;
    const { data, error } = await supabase.rpc('fn_tarifa_referencia', {
        p_concessionaria: concessionaria,
        p_uf: uf || null,
        p_ibge: ibge || null,
    });
    if (error) throw error;
    return data?.[0] || null;
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

export async function cancelAsaasCharge(invoiceId, type = 'invoice') {
    return callFunction('cancel-asaas-charge', { invoice_id: invoiceId, type });
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
        asaasPdfStorageUrl,
        fileName
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

export const createAutentiqueDocument = async (payload) => {
    return callFunction('create-autentique-document', payload);
};

/**
 * Cancela um contrato pendente na Autentique e marca a assinatura como
 * cancelada. Exige admin — a função recusa a chave anônima.
 */
export const cancelAutentiqueDocument = async (signatureId) => {
    return callFunction('cancel-autentique-document', { signatureId });
};

export const shortenLink = async (url, keyword = null, title = null) => {
    return callFunction('yourls-shorten', { url, keyword, title });
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
    ucId = null, // Novo: ID da UC para registro de histórico
    profileId,
    isConsolidated = false,
    // Id da fatura (ou do consolidado) que este PDF cobre. Sem ele a fatura
    // fica marcada como NAO enviada e o enviador autonomo a manda de novo --
    // ver o comentario em marcarComoEnviada.
    invoiceId = null
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

                // ------------------------------------------------------------
                // Marca a fatura como entregue.
                //
                // Esta tela emite e envia no mesmo clique, e por anos foi o
                // unico caminho de entrega -- entao ninguem precisava anotar
                // que o envio aconteceu. Com o enviador autonomo isso mudou:
                // fatura sem `fatura_enviada_em` continua na fila dele, e o
                // robo manda um segundo PDF ao cliente no dia seguinte.
                //
                // Aconteceu de verdade em 01/09/2026 com as duas faturas da
                // Brigitte Caturano: reemitidas pela tela, enviadas na hora, e
                // ainda assim de pe na fila.
                //
                // So marca se algum canal saiu. Falha total mantem na fila,
                // que e onde a fatura deve estar.
                //
                // Os canais vao SEPARADOS. `fatura_enviada_em` continua
                // significando "algum canal saiu", que e do que a fila do
                // enviador depende -- mas ele nunca respondeu "o WhatsApp foi?".
                // Em 01/09/2026 a tela chegou a dizer "notificacao via WhatsApp
                // enviada" numa entrega em que so o e-mail tinha saido, porque o
                // carimbo unico nao distingue. `enviado_whatsapp_em` e
                // `enviado_email_em` passam a distinguir.
                const emailOk = !emailRes.error;
                const waOk = !waRes.error && !waRes.skipped;
                const algumCanalSaiu = emailOk || waOk;
                if (invoiceId && algumCanalSaiu) {
                    await supabase.rpc('fn_marcar_fatura_enviada', {
                        p_tipo: isConsolidated ? 'consolidada' : 'individual',
                        p_id: invoiceId,
                        p_invoice_ids: null,
                        p_erro: null,
                        p_whatsapp_ok: waOk,
                        p_whatsapp_erro: waOk ? null : (waRes.error || (waRes.skipped ? 'sem telefone' : null)),
                        p_email_ok: emailOk,
                        p_email_erro: emailOk ? null : emailRes.error
                    });
                }

                const historyPromises = [];
                
                // Registro no Assinante
                historyPromises.push(supabase.from('crm_history').insert({
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
                }));

                // Registro na UC (se fornecido)
                if (ucId) {
                    historyPromises.push(supabase.from('crm_history').insert({
                        entity_type: 'uc',
                        entity_id: ucId,
                        content: `Envio de Fatura Individual: Email [${emailRes.error ? 'falhou' : 'enviado'}] | WhatsApp [${waRes.error ? 'falhou' : 'enviado'}]`,
                        metadata: {
                            email_status: emailRes.error ? 'error' : 'sent',
                            wa_status: waRes.error ? 'error' : (waRes.skipped ? 'skipped' : 'sent'),
                            recipient_email: targetEmailForLog,
                            recipient_phone: targetPhone,
                            error_details: { email: emailRes.error, wa: waRes.error }
                        },
                        created_by: profileId
                    }));
                }

                await Promise.all(historyPromises);

                resolve({ emailRes, waRes, isSandbox, targetEmailForLog, targetPhone });
            };
        });
    } catch (error) {
        console.error('Error in sendCombinedNotification:', error);
        throw error;
    }
};
