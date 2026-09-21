
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Destinos que podem ser encurtados. Sem esta lista a função era um
 * encurtador aberto: `verify_jwt` aceita a chave anon (pública, vai no
 * bundle do front), e qualquer um conseguia gerar link com a nossa marca
 * apontando para qualquer site — phishing pronto.
 *
 * Vale o domínio e os subdomínios dele (www., painel., ...).
 * `assina.ae` é o encurtador da própria Autentique: é o `short_link` que
 * a API devolve como link de assinatura.
 */
const DOMINIOS_PERMITIDOS = [
    'b2wenergia.com.br',
    'b2winvest.com.br',
    'b2wedutech.com.br',
    'autentique.com.br',
    'assina.ae',
];

const destinoPermitido = (url: string) => {
    let alvo: URL;
    try {
        alvo = new URL(url);
    } catch (_) {
        return false;
    }
    if (alvo.protocol !== 'https:') return false;

    // `hostname` já descarta truques como `https://b2wenergia.com.br@evil.com`.
    const host = alvo.hostname.toLowerCase();
    return DOMINIOS_PERMITIDOS.some(d => host === d || host.endsWith(`.${d}`));
};

const responder = (corpo: unknown, status: number) =>
    new Response(JSON.stringify(corpo), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status
    });

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Quem pode chamar:
        //  - outras Edge Functions (`originador-short-url`, `onboarding-finalizar`),
        //    que invocam com a service role e não têm usuário;
        //  - usuário logado no CRM.
        // A chave anon é um JWT válido e passa pelo `verify_jwt`, mas não
        // tem usuário — `getUser` recusa.
        const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        const chamadaInterna = !!supabaseServiceKey && token === supabaseServiceKey;

        if (!chamadaInterna) {
            const { data: { user } = { user: null }, error: erroAuth } = token
                ? await supabaseAdmin.auth.getUser(token)
                : { data: { user: null }, error: new Error('sem token') };

            if (erroAuth || !user) {
                return responder({ error: 'Não autorizado: faça login para encurtar links.' }, 401);
            }
        }

        const { url, keyword, title } = await req.json()

        if (!url) {
            throw new Error('Missing required field: url')
        }

        if (!destinoPermitido(url)) {
            return responder({
                error: `Destino não permitido. Só é possível encurtar links https de: ${DOMINIOS_PERMITIDOS.join(', ')}.`
            }, 403);
        }

        // 1. Fetch Configuration
        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('endpoint_url, api_key')
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

        let resData;
        const responseText = await response.text();
        try {
            resData = JSON.parse(responseText);
        } catch (_) {
            throw new Error(`YOURLS API HTTP Error [${response.status}]: ${responseText}`);
        }

        console.log('YOURLS Response:', JSON.stringify(resData));

        if (resData.status !== 'success') {
            if (resData.message?.includes('already exists') && resData.shorturl) {
                return responder({
                    success: true,
                    shortUrl: resData.shorturl,
                    message: 'URL already exists'
                }, 200);
            }
            throw new Error(`YOURLS Error: ${resData.message || 'Unknown error'}`);
        }

        return responder({
            success: true,
            shortUrl: resData.shorturl
        }, 200);

    } catch (error) {
        console.error('Edge Function Error:', error);
        return responder({ error: (error as Error).message }, 400);
    }
})
