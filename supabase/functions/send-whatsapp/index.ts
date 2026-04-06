import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { text, mediaUrl, mediaBase64, fileName, phone, instanceName } = await req.json()

        if (!text || !phone) {
            throw new Error('Missing required fields: text or phone')
        }

        // 0. Sanitize Inputs
        const cleanPhone = phone.replace(/\D/g, '');
        
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

        const baseUrl = endpoint.replace(/\/+$/, '');
        const encodedInstance = encodeURIComponent(effectiveInstance);

        // 2. Prepare Payload
        let targetUrl = '';
        let body = {};

        if (mediaUrl || mediaBase64) {
            targetUrl = `${baseUrl}/message/sendMedia/${encodedInstance}`;
            
            // For v2, keeping the 'data:...' prefix helps the internal parser avoid recursion errors
            const mediaPayload = mediaBase64 || mediaUrl;
            
            const isPdf = (fileName && fileName.toLowerCase().endsWith('.pdf')) || 
                          (mediaBase64 && mediaBase64.includes('application/pdf')) ||
                          (mediaUrl && mediaUrl.toLowerCase().endsWith('.pdf'));

            // Sanitize filename to avoid internal regex issues in sub-v2 versions
            const shortName = fileName ? fileName.substring(0, 40).replace(/[^a-zA-Z0-0._-]/g, '') : (isPdf ? 'fatura.pdf' : 'imagem.png');

            body = {
                number: cleanPhone,
                mediatype: isPdf ? "document" : "image",
                mimetype: isPdf ? "application/pdf" : "image/png",
                caption: text,
                media: mediaPayload,
                fileName: shortName,
                filename: shortName, // v2 compatibility
                delay: 1200
            };
            
            if (mediaBase64) {
                console.log(`Sending Media (Base64). Name: ${shortName}, Length: ${mediaBase64.length}`);
            }
        } else {
            targetUrl = `${baseUrl}/message/sendText/${encodedInstance}`;
            body = {
                number: cleanPhone,
                text: text,
                delay: 1200,
                linkPreview: false
            };
        }

        // 3. Send Request
        console.log('Sending to Evolution API:', targetUrl);

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': apiKey
            },
            body: JSON.stringify(body)
        })

        if (!response.ok) {
            let errorDetail = 'Unknown error';
            const contentType = response.headers.get('content-type');
            try {
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await response.json();
                    errorDetail = JSON.stringify(errorData);
                } else {
                    errorDetail = await response.text();
                }
            } catch (e) {
                errorDetail = 'Failed to parse error response';
            }
            console.error(`Evolution API Error [${response.status}]:`, errorDetail);
            throw new Error(`Failed to send message via Evolution API: ${errorDetail}`)
        }

        const resData = await response.json();
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
