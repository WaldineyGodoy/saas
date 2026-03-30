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
      throw new Error('Tipo (type) e Valor (value) são obrigatórios para disparar a extração.')
    }

    // Configurações do GitHub (espera-se que estejam nos Secrets do Supabase)
    const GH_TOKEN = Deno.env.get('GH_TOKEN')
    const GH_OWNER = Deno.env.get('GH_REPO_OWNER') || 'WaldineyGodoy'
    const GH_REPO = Deno.env.get('GH_REPO_NAME') || 'faturista'

    console.log('Triggering GitHub Action...', { owner: GH_OWNER, repo: GH_REPO, type, value })

    if (!GH_TOKEN) {
      console.error('Trigger Error: GH_TOKEN NOT SET')
      throw new Error('GH_TOKEN não configurado no Supabase. Use: npx supabase secrets set GH_TOKEN=sua_chave')
    }

    // Disparamos o GitHub Repository Dispatch
    // NOTA: O event_type 'trigger-scraper' deve existir no seu arquivo .github/workflows/main.yml
    const response = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${GH_TOKEN}`,
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
      const status = response.status
      console.error(`GitHub API Error: ${status}`, errorText)
      
      // Se for 404, pode ser owner/repo errado ou falta de permissão no token
      if (status === 404) {
        throw new Error(`Repositório não encontrado ou Token sem permissão (404). Verifique se ${GH_OWNER}/${GH_REPO} está correto.`)
      }
      
      throw new Error(`Erro no GitHub (${status}): ${errorText}`)
    }

    return new Response(
      JSON.stringify({ 
        message: 'Robô no GitHub acionado com sucesso!', 
        target: `${GH_OWNER}/${GH_REPO}`,
        status: response.status 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (err) {
    console.error('Final Trigger Error:', err.message)
    return new Response(
      JSON.stringify({ 
        error: err.message,
        details: 'Verifique os logs da função no painel do Supabase para mais detalhes.'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 // Usamos 500 para erros fatais, 400 para validação
      }
    )
  }
})
