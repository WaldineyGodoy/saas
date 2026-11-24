
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Data de hoje no fuso de Brasilia, em YYYY-MM-DD.
//
// Antes era new Date().toISOString(), que e' UTC: a partir das 21h de Brasilia
// a data ja' virava o dia seguinte, e a Asaas recebia um agendamento para
// amanha. Numa sexta as 21h30, isso virava sabado — dia em que conta vencida
// de concessionaria nao se paga.
function hojeEmBrasilia(agora: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(agora)
}

// Todos os erros que a Asaas devolveu, nao so' o primeiro.
//
// Em 12/09/2026 a Asaas recusou um pagamento com dois erros, e o CRM mostrou
// so' o primeiro ("so' ate as 22 horas", as 17h18) — que era enganoso. O
// motivo real estava no segundo: sabado nao e' dia util.
function descreverErrosAsaas(errors: unknown, status: number): string {
    if (!Array.isArray(errors) || errors.length === 0) return `Erro ${status}`
    return errors
        .map((e) => e?.description ?? e?.code ?? 'erro sem descricao')
        .join(' | ')
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

        if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin' && profile.role !== 'superadmin')) {
            throw new Error(`Unauthorized: Only admin and super_admin can pay bills. Your role is: ${profile?.role}`);
        }

        // 2. Parse Request Body
        const { identification, scheduleDate, description, value, dueDate } = await req.json()

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
        let cleanDescription = description || 'Pagamento de boleto via sistema';
        if (cleanDescription.length > 50) {
            cleanDescription = cleanDescription.substring(0, 47) + '...';
        }

        const billPayload = {
            identificationField: identification,
            scheduleDate: scheduleDate || hojeEmBrasilia(),
            description: cleanDescription,
            value: value ? Number(value) : undefined,
            dueDate: dueDate || undefined
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
            const errorMsg = descreverErrosAsaas(data.errors, response.status);
            throw new Error(`Asaas Bill Payment Failed: ${errorMsg}`);
        }

        return new Response(
            JSON.stringify({ success: true, data: data }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Function Error:', error);
        return new Response(
            JSON.stringify({ success: false, error: error.message, message: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    }
})
