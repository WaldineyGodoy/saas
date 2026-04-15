import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        let { text, mediaUrl, mediaBase64, fileName, phone, instanceName } = await req.json()

        if (!text || !phone) {
            throw new Error('Missing required fields: text or phone')
        }

        let cleanPhone = phone.replace(/\D/g, '');
        
        // Normalização de DDI (Brasil)
        // Se o número tiver 10 ou 11 dígitos e não começar com 55, adiciona o 55
        if ((cleanPhone.length === 10 || cleanPhone.length === 11) && !cleanPhone.startsWith('55')) {
            console.log(`Normalizando telefone ${cleanPhone} para 55${cleanPhone}`);
            cleanPhone = `55${cleanPhone}`;
        }
        
        // 1. Fetch Configuration
        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'evolution_api')
            .single();

        if (configError || !config) {
            throw new Error('Evolution API configuration not found.');
        }

        const endpoint = config.endpoint_url;
        const apiKey = config.api_key;
        const vars = config.variables || {};
        const effectiveInstance = instanceName || vars['instance_name'] || vars['INSTANCE_NAME'] || 'default';

        if (!endpoint || !apiKey || !effectiveInstance) {
            throw new Error('Incomplete Configuration: Endpoint, API Key or Instance Name missing.');
        }

        // 2. INTERNAL UPLOAD (MOST STABLE FOR V2)
        // If we have base64, we upload it to our own storage first.
        // This avoids Evolution API's recursion bugs and 400 Bad Request on raw base64.
        if (mediaBase64 && typeof mediaBase64 === 'string') {
            try {
                console.log('Media Base64 detected. Proceeding with internal storage upload...');
                
                // Sanitizing filename
                const isPdf = mediaBase64.includes('application/pdf') || (fileName && fileName.toLowerCase().endsWith('.pdf'));
                const extension = isPdf ? 'pdf' : 'png';
                const shortName = fileName ? fileName.substring(0, 30).replace(/[^a-zA-Z0-9.-]/g, '_') : `file_${Date.now()}.${extension}`;
                const storagePath = `automated/${Date.now()}_${shortName}`;

                // Extracting raw base64
                const base64Data = mediaBase64.includes(';base64,') ? mediaBase64.split(';base64,').pop() : mediaBase64;
                
                // Decoding base64 using standard Deno/Web API
                const binaryString = atob(base64Data || '');
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                // Uploading to private bucket using Service Role
                const { error: uploadError } = await supabaseAdmin.storage
                    .from('invoices_pdfs')
                    .upload(storagePath, bytes, {
                        contentType: isPdf ? 'application/pdf' : 'image/png',
                        upsert: true
                    });

                if (uploadError) throw uploadError;

                // Generating a signed URL (1 hour)
                const { data: signedData, error: signedError } = await supabaseAdmin.storage
                    .from('invoices_pdfs')
                    .createSignedUrl(storagePath, 3600);

                if (signedError) throw signedError;

                // Overwriting mediaUrl with the new stable signed URL
                mediaUrl = signedData.signedUrl;
                mediaBase64 = null; // Don't send the heavy base64 to Evolution
                console.log('Internal upload successful. Signed URL generated.');
            } catch (storageErr) {
                console.error('Failed to perform internal upload, falling back to original payload:', storageErr);
            }
        }

        // 3. Construct Evolution Request
        const baseUrl = endpoint.replace(/\/+$/, '');
        const encodedInstance = encodeURIComponent(effectiveInstance);
        let targetUrl = '';
        let body = {};

        if (mediaUrl || mediaBase64) {
            targetUrl = `${baseUrl}/message/sendMedia/${encodedInstance}`;
            const isPdfPayload = (fileName && fileName.toLowerCase().endsWith('.pdf')) || 
                               (mediaUrl && mediaUrl.toLowerCase().endsWith('.pdf')) ||
                               (mediaBase64 && mediaBase64.includes('application/pdf'));

            body = {
                number: cleanPhone,
                mediatype: isPdfPayload ? "document" : "image",
                mimetype: isPdfPayload ? "application/pdf" : "image/png",
                caption: text,
                media: mediaUrl || mediaBase64,
                fileName: fileName || (isPdfPayload ? 'fatura.pdf' : 'imagem.png'),
                filename: fileName || (isPdfPayload ? 'fatura.pdf' : 'imagem.png'),
                delay: 1200
            };
        } else {
            targetUrl = `${baseUrl}/message/sendText/${encodedInstance}`;
            body = {
                number: cleanPhone,
                text: text,
                delay: 1200,
                linkPreview: false
            };
        }

        // 4. Send to Evolution API
        console.log('Target URL:', targetUrl);
        // Do not log the full body as it might contain base64, but log length and instance
        console.log('Sending message to number:', body.number, 'Instance:', effectiveInstance);
        if (body.media) console.log('Media detected. Type:', body.mediatype, 'Filename:', body.fileName);

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': apiKey
            },
            body: JSON.stringify(body)
        })

        if (!response.ok) {
            const errorRaw = await response.text();
            let errorDetail = errorRaw;
            try {
                const errorData = JSON.parse(errorRaw);
                errorDetail = errorData.message || JSON.stringify(errorData);
            } catch (e) {
                // Not JSON
            }
            console.error(`Evolution API Error [${response.status}]:`, errorDetail);
            throw new Error(`Evolution API Error [${response.status}]: ${errorDetail}`);
        }

        const resData = await response.json();
        console.log('Evolution API Success Response:', JSON.stringify(resData));
        return new Response(JSON.stringify({ success: true, apiResponse: resData }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        })

    } catch (error) {
        console.error('Edge Function Error:', error);
        return new Response(JSON.stringify({ 
            error: (error as Error).message,
            stack: (error as Error).stack 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
        })
    }
})
