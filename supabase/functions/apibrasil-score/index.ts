import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const responder = (corpo: unknown, status: number) =>
    new Response(JSON.stringify(corpo), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status
    });

/**
 * Consulta Score Boa Vista PF na API Brasil.
 * O token fica em integrations_config (service_name = 'apibrasil'),
 * nunca no front. Cada consulta real custa dinheiro: só admin chama e
 * não há retry automático.
 */
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        const { data: { user } = { user: null } } = token
            ? await supabaseAdmin.auth.getUser(token)
            : { data: { user: null } };
        if (!user) return responder({ error: 'Não autorizado.' }, 401);

        const { data: ehAdmin } = await supabaseAdmin.rpc('check_user_is_admin', { user_id: user.id });
        if (!ehAdmin) return responder({ error: 'Apenas administradores podem consultar crédito.' }, 403);

        const { cpf, homolog } = await req.json();
        const cpfLimpo = String(cpf ?? '').replace(/\D/g, '');
        if (cpfLimpo.length !== 11) {
            return responder({ error: 'A consulta de score exige um CPF válido (11 dígitos).' }, 400);
        }

        const { data: config } = await supabaseAdmin
            .from('integrations_config')
            .select('endpoint_url, api_key, is_active')
            .eq('service_name', 'apibrasil')
            .single();
        if (!config?.api_key || config.is_active === false) {
            return responder({ error: 'Integração API Brasil não configurada.' }, 400);
        }

        const url = config.endpoint_url || 'https://gateway.apibrasil.io/api/v2/consulta/cpf/credits';
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.api_key}`,
            },
            body: JSON.stringify({ tipo: 'score-boa-vista-pf', cpf: cpfLimpo, homolog: !!homolog }),
        });

        const texto = await resp.text();
        let dados: any;
        try { dados = JSON.parse(texto); } catch (_) { dados = null; }

        if (resp.status === 404) return responder({ error: 'Nenhuma informação encontrada para este CPF (sem cobrança).' }, 404);
        if (resp.status === 402) return responder({ error: 'Saldo insuficiente na API Brasil.' }, 402);
        if (!resp.ok || !dados || dados.error === true) {
            return responder({ error: dados?.message || `Falha na API Brasil (HTTP ${resp.status}).` }, 502);
        }

        // Não devolve dados da conta (user/balance) ao navegador.
        return responder({
            success: true,
            homolog: !!dados.homolog,
            valor_consulta: dados.valor_consulta ?? null,
            data: dados.data ?? null,
        }, 200);
    } catch (error) {
        console.error('apibrasil-score error:', error);
        return responder({ error: (error as Error).message }, 400);
    }
})
