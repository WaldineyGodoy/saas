import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const WEBHOOK_TOKEN = 'autentique_v2_secret_9283fbc2';

serve(async (req) => {
    // Basic Security: Check Token in Query String
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (token !== WEBHOOK_TOKEN) {
        console.error('Invalid Webhook Token');
        return new Response('Unauthorized', { status: 401 });
    }

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const payload = await req.json();
        console.log('Autentique Webhook Payload:', JSON.stringify(payload, null, 2));

        const action = payload.action; // ex: "document.signed"
        const docId = payload.document?.id;

        if (!docId || !action) {
            return new Response(JSON.stringify({ error: 'Payload incompleto' }), { status: 400 });
        }

        // Mapeamento de Status
        let newStatus = 'pending';
        if (action.includes('signed')) newStatus = 'signed';
        else if (action.includes('rejected')) newStatus = 'rejected';
        else if (action.includes('canceled')) newStatus = 'canceled';
        else {
             // Outros eventos (ex: viewer, created) não mudam necessariamente o status principal
             return new Response(JSON.stringify({ success: true, message: 'Evento ignorado' }), { status: 200 });
        }

        // Atualizar o banco de dados
        const { error: dbError } = await supabaseAdmin
            .from('signatures')
            .update({ 
                status: newStatus,
                updated_at: new Date().toISOString(),
                metadata: payload // Logar o payload completo para auditoria
            })
            .eq('autentique_doc_id', docId);

        if (dbError) throw dbError;

        console.log(`Documento ${docId} atualizado para status: ${newStatus}`);

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('Webhook Error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 // Sempre retornar 200 para a Autentique não tentar reenviar em caso de erro de lógica
        });
    }
})
