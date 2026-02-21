
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
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // 1. Verify User Role (Must be admin or superadmin)
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Missing Authorization header');

        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error: userError } = await supabase.auth.getUser(token)

        if (userError || !user) throw new Error('Invalid user token');

        // Check profile role
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (!profile || (profile.role !== 'admin' && profile.role !== 'superadmin')) {
            throw new Error('Unauthorized: Only admin and superadmin can send payments.');
        }

        // 2. Parse Request Body
        const { value, pix_key, pix_key_type, description, operationType } = await req.json()

        if (!value || !pix_key || !pix_key_type) {
            throw new Error('Missing required fields: value, pix_key, pix_key_type');
        }

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

        // 3. Map Key Type to Asaas Format
        // Our App: cpf, cnpj, email, telefone, aleatoria
        // Asaas: CPF, CNPJ, EMAIL, PHONE, EVP
        const typeMap = {
            'cpf': 'CPF',
            'cnpj': 'CNPJ',
            'email': 'EMAIL',
            'telefone': 'PHONE',
            'aleatoria': 'EVP'
        };

        const asaasKeyType = typeMap[pix_key_type.toLowerCase()] || 'EVP';

        // 4. Prepare Transfer Payload
        // https://docs.asaas.com/reference/transferencias-pix
        // Endpoint: /transfers
        // Body: { value, operationType: 'PIX', pixAddressKey, pixAddressKeyType, description, scheduleDate... }

        const transferData = {
            value: Number(value),
            operationType: 'PIX',
            pixAddressKey: pix_key,
            pixAddressKeyType: asaasKeyType,
            description: description || 'Transferencia via Sistema',
            scheduleDate: null // Immediate
        };

        console.log('Sending Transfer to Asaas:', transferData);

        const response = await fetch(`${asaasUrl}/transfers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'access_token': asaasKey
            },
            body: JSON.stringify(transferData)
        });

        const data = await response.json();

        if (data.errors) {
            console.error('Asaas Error:', data.errors);
            throw new Error(`Asaas Transfer Failed: ${data.errors[0].description}`);
        }

        return new Response(
            JSON.stringify({ success: true, data: data }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Function Error:', error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
