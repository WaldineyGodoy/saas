import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import { corsHeaders } from "../_shared/cors.ts"
import { requireAdmin } from "../_shared/auth.ts"

/**
 * Disparo manual do faturista, pela tela.
 *
 * ------------------------------------------------------------------- o portão
 *
 * Esta função não tinha portão NENHUM: `verify_jwt = false` e nenhuma
 * verificação no corpo. Quem soubesse a URL acionava o robô — que consome CI e
 * entra no portal da concessionária com as credenciais dos clientes.
 *
 * `requireAdmin`, e não `requireUser`: os papéis do sistema incluem `lead`,
 * `supplier`, `originator` e `subscriber`, que são pessoas de fora. Exigir
 * apenas "sessão válida" deixaria um assinante disparar a varredura do portal.
 *
 * --------------------------------------------------------------- o repositório
 *
 * O default apontava para `WaldineyGodoy/faturista`, mas o workflow vive em
 * `saas`. Disparo manual que não fazia nada tinha essa cara.
 *
 * Agora não há repositório nem token aqui: quem dispara é
 * `fn_disparar_faturista`, no banco, que lê o PAT do Vault. Uma implementação
 * só do disparo, um token só, e o acionamento fica registrado em
 * `robo_execucoes` do mesmo jeito que o do pg_cron — antes, disparo pela tela
 * não deixava rastro nenhum.
 */
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const auth = await requireAdmin(req, supabase)
    if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.error }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: auth.status })
    }

    try {
        const { value } = await req.json()

        if (!value) {
            throw new Error('Informe o alvo: AAAA-MM-DD (um dia), AAAA-MM (mês inteiro) ou "5,12" (dias do mês corrente).')
        }

        const { data: requestId, error } = await supabase.rpc('fn_disparar_faturista', {
            p_target_days: String(value),
        })
        if (error) throw new Error(error.message)

        return new Response(
            JSON.stringify({
                message: 'Faturista acionado.',
                target: `alvo: ${value}`,
                request_id: requestId,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    } catch (err) {
        return new Response(
            JSON.stringify({ error: (err as Error).message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})
