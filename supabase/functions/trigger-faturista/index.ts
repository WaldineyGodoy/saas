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

        const { type, value } = await req.json()
        console.log(`Trigger invocado: ${type} - ${value}`);

        // 1. Buscar Configuração do GitHub
        const { data: config, error: configError } = await supabaseAdmin
            .from('integrations_config')
            .select('*')
            .eq('service_name', 'github_actions')
            .single();

        if (configError || !config) {
            throw new Error('Configuração do GitHub Actions não encontrada.');
        }

        const endpoint = config.endpoint_url;
        const apiKey = config.api_key;

        if (!endpoint || !apiKey) {
            throw new Error('Configuração incompleta: Endpoint ou API Key ausente.');
        }

        // 2. Calcular os dias baseados no tipo
        let targetDays = "";
        
        if (type === 'day') {
            const date = new Date(value);
            targetDays = String(date.getDate());
        } else if (type === 'week') {
            const date = new Date(value);
            const days = [];
            // Pega os 7 dias ao redor da data
            const first = date.getDate() - date.getDay();
            for (let i = 0; i < 7; i++) {
                const d = new Date(date.setDate(first + i));
                days.push(d.getDate());
            }
            targetDays = [...new Set(days)].join(',');
        } else if (type === 'month') {
            targetDays = Array.from({ length: 31 }, (_, i) => i + 1).join(',');
        }

        console.log(`Dias calculados para o Scraper: ${targetDays}`);

        // 3. Disparar o GitHub Workflow
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ref: 'main',
                inputs: {
                    target_days: targetDays,
                    reason: `Disparo manual via CRM (${type}: ${value})`
                }
            })
        });

        if (!response.ok && response.status !== 204) {
            const error = await response.text();
            console.error('GitHub API Error:', error);
            throw new Error(`Erro ao disparar GitHub: ${response.statusText}`);
        }

        return new Response(
            JSON.stringify({ success: true, targetDays }),
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
