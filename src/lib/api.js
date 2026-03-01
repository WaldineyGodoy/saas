import { supabase } from './supabase';

/**
 * Busca endereço pelo CEP usando VIACEP
 * @param {string} cep 
 * @returns {Promise<{ rua: string, bairro: string, cidade: string, uf: string, cep: string, ibge: string, erro?: boolean }>}
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
 * @param {string} doc CPF ou CNPJ (apenas números)
 * @returns {Promise<{ nome: string, doc: string, data_nascimento?: string }>}
 */
export const fetchCpfCnpjData = async (doc) => {
    const cleanDoc = doc.replace(/\D/g, '');
    const isCnpj = cleanDoc.length > 11;

    // Placeholder implementation since we need the user to provide the API Key in .env securely 
    // currently we are just mocking or using what we have. 
    // The user provided a token in the prompt, but it's best to handle this gracefully.
    // For now, let's assume we might not want to burn tokens validation in dev unless verified.

    // Implementation for CPF (API Gratis)
    if (!isCnpj) {
        // Feature disabled by user request until plan is active
        console.warn('Busca de CPF desabilitada temporariamente (Plano API não ativo).');
        return { nome: '', doc: cleanDoc };

        /* 
        // Token provided by user
        const token = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL2FwcC5hcGlicmFzaWwuaW8vYXV0aC9jYWxsYmFjayIsImlhdCI6MTc0MTIyODkyNiwiZXhwIjoxNzcyNzY0OTI2LCJuYmYiOjE3NDEyMjg5MjYsImp0aSI6IndXcE83dnZibkJBRm1zSkciLCJzdWIiOiI3NjY4IiwicHJ2IjoiMjNiZDVjODk0OWY2MDBhZGIzOWU3MDFjNDAwODcyZGI3YTU5NzZmNyJ9.evrXUmKIKfsDBUvDmW-0Tq22IrqUSOcL3E5glNUabt0";

        const response = await fetch('https://gateway.apibrasil.io/api/v2/consulta/cpf/credits', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                cpf: cleanDoc,
                tipo: 'cpf-search',
                homolog: true
            })
        });

        const data = await response.json();

        // Debugging logs to help identify issues if usage persists
        console.log('API Gratis Response:', data);

        if (data.error) throw new Error(data.message || 'Erro ao buscar CPF');

        // Robust checking for name location in response
        const nomeEncontrado = data.nome || data.razao_social || data?.response?.nome || '';
        const nascimentoEncontrado = data.data_nascimento || data?.response?.data_nascimento;

        return {
            nome: nomeEncontrado,
            doc: data.cpf || cleanDoc,
            data_nascimento: nascimentoEncontrado
        };
        */
    } else {
        // Implementation for CNPJ (publica.cnpj.ws)
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
                    logradouro: est.tipo_logradouro ? `${est.tipo_logradouro} ${est.logradouro}` : est.logradouro,
                    numero: est.numero,
                    complemento: est.complemento,
                    bairro: est.bairro,
                    cep: est.cep,
                    uf: est.estado?.sigla,
                    municipio: est.cidade?.nome,
                    cidade: est.cidade?.nome // Fallback alias
                },
                legal_partner: socio ? {
                    nome: socio.nome,
                    cpf: socio.cpf_cnpj_socio // Note: Often masked in public data
                } : { nome: '', cpf: '' },
                raw: data
            };
        } catch (error) {
            console.error('Erro CNPJ (publica.cnpj.ws)', error);
            // Fallback or rethrow
            throw error;
        }
    }
}

export const manageAsaasCustomer = async (data) => {
    try {
        const { data: result, error } = await supabase.functions.invoke('manage-asaas-customer', {
            body: data
        });

        if (error) {
            let message = error.message;
            try {
                // Try to get detailed error from response body
                const body = await error.context?.json();
                if (body?.error) message = body.error;
            } catch (e) {
                console.warn('Could not parse error body:', e);
            }
            throw new Error(message);
        }
        return result;
    } catch (error) {
        console.error('Erro Asaas Customer:', error);
        throw error;
    }
};;

/**
 * Busca dados de oferta (Concessionária) no Supabase baseado no IBGE
 */
export const fetchOfferData = async (ibge) => {
    const { data, error } = await supabase
        .from('Concessionaria')
        .select('*')
        .eq('"Cod. Ibge"', ibge)
        .single();

    if (error) return null;
    return data;
};

/**
 * Chama Edge Function para gerar boleto no Asaas
 * @param {string} invoiceId 
 */
/**
 * Chama Edge Function para gerar boleto no Asaas
 * @param {string} id Invoice ID OR Subscriber ID (for consolidated)
 * @param {'invoice'|'subscriber'} type Type of the ID
 */
export const createAsaasCharge = async (id, type = 'invoice', extra = {}) => {
    const payload = type === 'invoice'
        ? { invoice_id: id, ...extra }
        : { subscriber_id: id, ...extra };

    const { data, error } = await supabase.functions.invoke('create-asaas-charge', {
        body: payload
    });

    if (error) {
        let message = error.message;
        try {
            // Tentar extrair erro do body se for FunctionsHttpError
            if (error.context?.context?.status === 400) {
                const body = await error.context.response.json();
                message = body.error || message;
            } else {
                const body = await error.context?.json();
                if (body?.error) message = body.error;
            }
        } catch (e) { }
        throw new Error(message);
    }
    return data;
};

// Função auxiliar para cancelar fatura e cobrança no Asaas
export async function cancelAsaasCharge(invoiceId) {
    try {
        const { data, error } = await supabase.functions.invoke('cancel-asaas-charge', {
            body: { invoice_id: invoiceId }
        });

        if (error) {
            let message = error.message;
            try {
                if (error.context?.context?.status === 400) {
                    const body = await error.context.response.json();
                    message = body.error || message;
                }
            } catch (e) { }
            throw new Error(message);
        }

        return data;
    } catch (error) {
        console.error('Error in cancelAsaasCharge:', error);
        throw error;
    }
}

// Função auxiliar para atualizar cobrança no Asaas
export async function updateAsaasCharge(invoiceId, value, dueDate) {
    try {
        const { data, error } = await supabase.functions.invoke('update-asaas-charge', {
            body: {
                invoice_id: invoiceId,
                value,
                dueDate
            }
        });

        if (error) {
            let message = error.message;
            try {
                if (error.context?.context?.status === 400) {
                    const body = await error.context.response.json();
                    message = body.error || message;
                }
            } catch (e) { }
            throw new Error(message);
        }

        return data;
    } catch (error) {
        console.error('Error in updateAsaasCharge:', error);
        throw error;
    }
}

export const sendWhatsapp = async (phone, text, mediaUrl, instanceName) => {
    try {
        const { data, error } = await supabase.functions.invoke('send-whatsapp', {
            body: {
                phone: phone ? phone.replace(/\D/g, '') : '',
                text,
                mediaUrl,
                instanceName
            }
        });

        if (error) {
            let message = error.message;
            try {
                const body = await error.context?.json();
                if (body?.error) message = body.error;
            } catch (e) { }
            throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);

        return data;
    } catch (error) {
        console.error('Erro ao enviar WhatsApp:', error);
        throw error;
    }
};
