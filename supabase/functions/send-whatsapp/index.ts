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
        // START: Service Role usage for Cross-App access
        // This allows the App repo (unauthenticated or diff project) to call this function
        // and this function to still read the protected config from the DB.
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )
        // END: Service Role usage

        const { text, mediaUrl, phone, instanceName } = await req.json()

        if (!text || !phone) {
            throw new Error('Missing required fields: text or phone')
        }

        // 1. Fetch Configuration (using Admin client)
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
        // Variables might contain instance_name if not passed, but we prefer passed
        const vars = config.variables || {};
        const effectiveInstance = instanceName || vars['instance_name'] || vars['INSTANCE_NAME'];

        if (!endpoint || !apiKey || !effectiveInstance) {
            throw new Error('Incomplete Configuration: Endpoint, API Key or Instance Name missing.');
        }

        // 2. Construct URL
        // Evolution v2: {{baseUrl}}/message/sendText/{{instance}}
        // Evolution v2 Media: {{baseUrl}}/message/sendMedia/{{instance}}

        // Normalize Endpoint (remove trailing slash)
        const baseUrl = endpoint.replace(/\/+$/, '');

        let url = '';
        let body = {};

        if (mediaUrl) {
            url = `${baseUrl}/message/sendMedia/${effectiveInstance}`;
            body = {
                number: phone,
                options: {
                    delay: 1200,
                    presence: "composing"
                },
                mediaMessage: {
                    mediatype: "image", // simplistic assumption, could contain video
                    caption: text,
                    media: mediaUrl
                }
            };
        } else {
            url = `${baseUrl}/message/sendText/${effectiveInstance}`;
            body = {
                number: phone,
                options: {
                    delay: 1200,
                    presence: "composing",
                    linkPreview: false
                },
                textMessage: {
                    text: text
                }
            };
        }

        // 3. Send Request
        console.log(`Sending to Evolution API: ${url}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': apiKey
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Evolution API Error:', data);
            throw new Error(data?.message || 'Failed to send message via Evolution API');
        }

        return new Response(
            JSON.stringify({ success: true, data }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error) {
        console.error('Edge Function Error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            }
        )
    }
})
