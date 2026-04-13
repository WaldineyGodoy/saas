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
    
    // Autentique enviará a assinatura em minúsculas ou maiúsculas? Normalizamos.
    // O CryptoJS ou SubtleCrypto geralmente precisa dos bytes corretos.
    try {
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
    } catch (e) {
        console.error('Error verifying signature:', e);
        return false;
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    let rawBody = '';
    let payload: any = {};
    let statusCode = 200;
    const headers = Object.fromEntries(req.headers.entries());

    try {
        rawBody = await req.text();
        const signature = req.headers.get('x-autentique-signature');

        // Seguranca: Verificar assinatura HMAC
        if (WEBHOOK_SECRET) {
            const isValid = await verifySignature(rawBody, signature, WEBHOOK_SECRET);
            if (!isValid) {
                console.error('Assinatura Autentique Inválida');
                // Mesmo assim logamos para entender o erro
                await supabaseAdmin.from('webhook_logs').insert({
                    service_name: 'autentique',
                    payload: { raw: rawBody, note: 'HMAC verification failed' },
                    headers: headers,
                    status_code: 401
                });
                return new Response('Unauthorized', { status: 401 });
            }
        }

        payload = JSON.parse(rawBody);
        console.log('Autentique Webhook Payload Received');

        // Autentique V2: O evento pode estar em payload.event.type e os dados em payload.event.data
        const action = payload.action || payload.event?.type || payload.type;
        const docId = payload.document?.id || payload.event?.data?.id || payload.id;

        if (!docId || !action) {
            statusCode = 400;
            console.error('Payload incompleto:', { action, docId });
            await supabaseAdmin.from('webhook_logs').insert({
                service_name: 'autentique',
                payload: payload,
                headers: headers,
                status_code: 400
            });
            return new Response(JSON.stringify({ error: 'Payload incompleto', action, docId }), { status: 400 });
        }

        // Mapeamento de Status
        let newStatus = 'pending';
        // Garantir que action é string para o toLowerCase
        const actionStr = String(action).toLowerCase();
        
        if (actionStr.includes('signed') || actionStr.includes('finished')) newStatus = 'signed';
        else if (actionStr.includes('rejected')) newStatus = 'rejected';
        else if (actionStr.includes('canceled')) newStatus = 'canceled';
        else {
             // Eventos informativos (visto, criado, etc) logamos e retornamos sucesso
             await supabaseAdmin.from('webhook_logs').insert({
                service_name: 'autentique',
                payload: payload,
                headers: headers,
                status_code: 200,
                message: `Evento informativo ignorado: ${actionStr}`
            });
            return new Response(JSON.stringify({ success: true, message: 'Evento ignorado' }), { status: 200 });
        }

        // Atualizar o banco de dados
        const { data: updateData, error: dbError } = await supabaseAdmin
            .from('signatures')
            .update({ 
                status: newStatus,
                updated_at: new Date().toISOString(),
                metadata: payload 
            })
            .eq('autentique_doc_id', docId)
            .select();

        if (dbError) throw dbError;

        // Sucesso
        const rowCount = updateData?.length || 0;
        await supabaseAdmin.from('webhook_logs').insert({
            service_name: 'autentique',
            payload: payload,
            headers: headers,
            status_code: 200,
            message: rowCount > 0 ? `Documento ${docId} atualizado para ${newStatus}` : `Nenhum registro encontrado para docId ${docId}`
        });

        console.log(`Webhook processado: ${docId} -> ${newStatus}. Rows affected: ${rowCount}`);

        return new Response(JSON.stringify({ success: true, rows: rowCount }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('Webhook Error:', error);
        
        // Logar erro no banco
        await supabaseAdmin.from('webhook_logs').insert({
            service_name: 'autentique',
            payload: { error: error.message, stack: error.stack, raw: rawBody },
            headers: headers,
            status_code: 500
        });

        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 // Retornamos 200 para evitar retentativas infinitas se for erro nosso
        });
    }
})
