
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { name, cpfCnpj, email, phone, address, addressNumber, province, postalCode } = await req.json()

        const asaasUrl = Deno.env.get('ASAAS_API_URL') || 'https://sandbox.asaas.com/api/v3';
        const asaasKey = Deno.env.get('ASAAS_API_KEY');

        if (!asaasKey) throw new Error('ASAAS_API_KEY não configurada.');

        const cleanCpfCnpj = cpfCnpj?.replace(/\D/g, '');
        const cleanPhone = phone?.replace(/\D/g, '');
        const cleanPostalCode = postalCode?.replace(/\D/g, '');

        if (!cleanCpfCnpj) throw new Error('CPF/CNPJ é obrigatório.');

        // 1. Check if exists in Asaas
        const searchRes = await fetch(`${asaasUrl}/customers?cpfCnpj=${cleanCpfCnpj}`, {
            headers: { access_token: asaasKey }
        });
        const searchData = await searchRes.json();

        let customerId = null;
        let isNew = false;

        const customerPayload = {
            name,
            cpfCnpj: cleanCpfCnpj,
            email,
            phone: cleanPhone,
            mobilePhone: cleanPhone,
            address,
            addressNumber,
            province, // Bairro
            postalCode: cleanPostalCode,
            notificationDisabled: false
        };

        if (searchData.data && searchData.data.length > 0) {
            // Update existing
            customerId = searchData.data[0].id;
            console.log(`Cliente encontrado no Asaas: ${customerId}. Atualizando...`);

            await fetch(`${asaasUrl}/customers/${customerId}`, {
                method: 'POST', // PUT or POST depending on API, Asaas usually accepts POST for updates too or PUT
                headers: {
                    'Content-Type': 'application/json',
                    access_token: asaasKey
                },
                body: JSON.stringify(customerPayload)
            });
        } else {
            // Create new
            console.log(`Cliente não encontrado. Criando...`);
            isNew = true;
            const createRes = await fetch(`${asaasUrl}/customers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    access_token: asaasKey
                },
                body: JSON.stringify(customerPayload)
            });
            const createData = await createRes.json();

            if (createData.errors) throw new Error(`Erro Asaas: ${createData.errors[0].description}`);
            customerId = createData.id;
        }

        return new Response(
            JSON.stringify({ success: true, asaas_id: customerId, is_new: isNew }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
