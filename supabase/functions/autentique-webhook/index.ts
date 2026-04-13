import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const WEBHOOK_SECRET = Deno.env.get('AUTENTIQUE_WEBHOOK_SECRET');

// Helper to convert hex string to Uint8Array
function hexToBytes(hex: string) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

async function verifySignature(body: string, signature: string | null, secret: string) {
    if (!signature) return false;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
    );
    
    const signatureBytes = hexToBytes(signature);
    const bodyBytes = encoder.encode(body);
    
    return await crypto.subtle.verify(
        "HMAC",
        key,
        signatureBytes,
        bodyBytes
    );
}

serve(async (req) => {
    // 1. Manter suporte parcial para OPTIONS (CORS)
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const rawBody = await req.text();
        const signature = req.headers.get('x-autentique-signature');

        // Seguranca: Verificar assinatura HMAC (se segredo estiver configurado)
        if (WEBHOOK_SECRET) {
            const isValid = await verifySignature(rawBody, signature, WEBHOOK_SECRET);
            if (!isValid) {
                console.error('Assinatura Autentique Inválida ou Ausente');
                return new Response('Unauthorized', { status: 401 });
            }
        } else {
            // Fallback se o segredo não estiver no ambiente (não recomendado para produção)
            console.warn('AUTENTIQUE_WEBHOOK_SECRET não configurado. Ignorando validação.');
        }

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const payload = JSON.parse(rawBody);
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
            status: 200 // Sempre retornar 200 para a Autentique
        });
    }
})
