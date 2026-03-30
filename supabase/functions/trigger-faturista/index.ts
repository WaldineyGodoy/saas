import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { type, value } = await req.json()

    // Validação básica
    if (!type || !value) {
      console.error('Trigger Error: Missing fields', { type, value })
      throw new Error('Tipo (type) e Valor (value) são obrigatórios.')
    }

    // Configurações do GitHub (espera-se que estejam nos Secrets do Supabase)
    const GH_TOKEN = Deno.env.get('GH_TOKEN')
    const GH_OWNER = Deno.env.get('GH_REPO_OWNER') || 'WaldineyGodoy'
    const GH_REPO = Deno.env.get('GH_REPO_NAME') || 'faturista'

    if (!GH_TOKEN) {
      console.error('Trigger Error: GH_TOKEN NOT SET')
      throw new Error('Script error: GH_TOKEN não configurado nos Secrets do Supabase. Use: npx supabase secrets set GH_TOKEN=seu_token')
    }

    // Traduzimos o período para uma lista de dias ou um range que o scraper entenda
    // O Scraper Trigge Modal envia: 'day', 'week', 'month' com o valor formatado
    let targetDays = value;
    if (type === 'month') {
        // Ex: '2024-03'
        targetDays = `Todos de ${value}`;
    } else if (type === 'week') {
        targetDays = `Semana de ${value}`;
    }

    // Disparamos o GitHub Repository Dispatch
    const response = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Supabase-Edge-Function'
        },
        body: JSON.stringify({
          event_type: 'trigger-scraper',
          client_payload: {
            type,
            value,
            triggered_by: 'CRM-B2W'
          }
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`GitHub API Error: ${response.status} - ${errorText}`)
    }

    return new Response(
      JSON.stringify({ 
        message: 'GitHub Action acionada com sucesso!', 
        targetDays,
        status: response.status 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (err) {
    console.error('Trigger Error:', err.message)
    return new Response(
      JSON.stringify({ error: err.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    )
  }
})
