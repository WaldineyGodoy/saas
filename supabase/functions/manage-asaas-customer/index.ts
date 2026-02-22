
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
        const payload = await req.json()
        const { test, name, cpfCnpj, email, phone, address, addressNumber, province, postalCode } = payload

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { data: configData, error: configError } = await supabase
            .from('integrations_config')
            .select('api_key, endpoint_url')
            .eq('service_name', 'financial_api')
            .single()

        if (configError || !configData?.api_key || !configData?.endpoint_url) {
            throw new Error('Integração Asaas não configurada no painel. Verifique as configurações financeiras.')
        }

        const asaasKey = configData.api_key;
        const asaasUrl = configData.endpoint_url;

        console.log(`Config found: URL=${asaasUrl}, Key=${asaasKey.substring(0, 10)}...`);

        if (test) {
            console.log('Testando conexão Asaas...');
            const testRes = await fetch(`${asaasUrl}/customers?limit=1`, {
                headers: { access_token: asaasKey }
            });
            console.log(`Asaas Test Response Status: ${testRes.status}`);
            const testData = await testRes.json();
            if (testRes.status !== 200 || testData.errors) {
                throw new Error(testData.errors?.[0]?.description || `Erro na conexão Asaas (Status ${testRes.status})`);
            }
            return new Response(
                JSON.stringify({ success: true, message: 'Conexão com Asaas realizada com sucesso!' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

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
            console.log("Update Payload:", JSON.stringify(customerPayload));

            const updateRes = await fetch(`${asaasUrl}/customers/${customerId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    access_token: asaasKey
                },
                body: JSON.stringify(customerPayload)
            });
            const updateData = await updateRes.json();
            if (updateData.errors) {
                console.error("Asaas Update error details:", JSON.stringify(updateData));
                throw new Error(`Erro Asaas (Update): ${updateData.errors[0].description}`);
            }
        } else {
            // Create new
            console.log(`Cliente não encontrado. Criando...`);
            isNew = true;
            console.log("Create Payload:", JSON.stringify(customerPayload));

            const createRes = await fetch(`${asaasUrl}/customers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    access_token: asaasKey
                },
                body: JSON.stringify(customerPayload)
            });
            const createData = await createRes.json();

            if (createData.errors) {
                console.error("Asaas Create error details:", JSON.stringify(createData));
                throw new Error(`Erro Asaas (Create): ${createData.errors[0].description}`);
            }
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
