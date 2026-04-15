
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

        const { url, keyword, title } = await req.json()

        if (!url) {
            throw new Error('Missing required field: url')
        }

        // 1. Fetch Configuration
        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'yourls')
            .single();

        if (configError || !config) {
            throw new Error('YOURLS configuration not found in integrations_config.');
        }

        const apiUrl = config.endpoint_url;
        const signature = config.api_key;

        if (!apiUrl || !signature) {
            throw new Error('Incomplete YOURLS Configuration: API URL or Signature missing.');
        }

        // 2. Call YOURLS API
        const params = new URLSearchParams({
            signature: signature,
            action: 'shorturl',
            url: url,
            format: 'json'
        });

        if (keyword) params.append('keyword', keyword);
        if (title) params.append('title', title);

        const targetUrl = `${apiUrl}?${params.toString()}`;
        console.log('Shortening URL:', url);

        const response = await fetch(targetUrl, {
            method: 'GET',
        });

        if (!response.ok) {
            const errorRaw = await response.text();
            throw new Error(`YOURLS API Error [${response.status}]: ${errorRaw}`);
        }

        const resData = await response.json();
        console.log('YOURLS Response:', JSON.stringify(resData));

        if (resData.status !== 'success' && resData.code !== 'error:nicadb') {
            // "error:nicadb" means the keyword is already taken or DB error, 
            // but sometimes YOURLS returns success if the URL is already shortened.
            // Check for specific success codes.
            if (resData.message?.includes('already exists')) {
                return new Response(JSON.stringify({ 
                    success: true, 
                    shortUrl: resData.shorturl,
                    message: 'URL already exists'
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 200
                });
            }
            throw new Error(`YOURLS Error: ${resData.message || 'Unknown error'}`);
        }

        return new Response(JSON.stringify({ 
            success: true, 
            shortUrl: resData.shorturl 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        })

    } catch (error) {
        console.error('Edge Function Error:', error);
        return new Response(JSON.stringify({ 
            error: (error as Error).message
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
        })
    }
})
