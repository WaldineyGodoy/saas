
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"

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
            throw new Error('Unauthorized: Only admin and superadmin can pay bills.');
        }

        // 2. Parse Request Body
        const { identification, scheduleDate, description, value } = await req.json()

        if (!identification) {
            throw new Error('Missing required field: identification (linha digitável)');
        }

        // 3. Fetch Credentials from DB
        const { data: configData, error: configError } = await supabase
            .from('integrations_config')
            .select('api_key, endpoint_url, sandbox_api_key, sandbox_endpoint_url, environment')
            .eq('service_name', 'financial_api')
            .single()

        if (configError) {
            throw new Error('Integração Asaas não configurada no painel. Verifique as configurações financeiras.')
        }

        const isSandbox = configData.environment === 'sandbox';
        const asaasKey = isSandbox ? configData.sandbox_api_key : configData.api_key;
        const asaasUrl = isSandbox ? configData.sandbox_endpoint_url : configData.endpoint_url;

        if (!asaasKey || !asaasUrl) {
            throw new Error(`Configurações de ${isSandbox ? 'Sandbox' : 'Produção'} incompletas.`);
        }

        // 4. Prepare Bill Payment Payload
        const billPayload = {
            identificationField: identification,
            scheduleDate: scheduleDate || new Date().toISOString().split('T')[0],
            description: description || 'Pagamento de boleto via sistema',
            value: value ? Number(value) : undefined
        };

        console.log('Sending Bill Payment to Asaas:', billPayload);

        const response = await fetch(`${asaasUrl}/bill`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'access_token': asaasKey
            },
            body: JSON.stringify(billPayload)
        });

        const responseText = await response.text();
        let data;
        try {
            data = responseText ? JSON.parse(responseText) : {};
        } catch (e) {
            throw new Error(`Resposta inválida do Asaas (Status ${response.status}): ${responseText || 'Corpo vazio'}`);
        }

        if (!response.ok || data.errors) {
            console.error('Asaas Error:', data.errors);
            const errorMsg = data.errors ? data.errors[0].description : `Erro ${response.status}`;
            throw new Error(`Asaas Bill Payment Failed: ${errorMsg}`);
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
