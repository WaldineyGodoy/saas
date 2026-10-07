import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'

/**
 * Excluir conta pelo app (exigencia da Apple para app com login).
 *
 * POST {}   (sessao do proprio usuario)
 *   200 { ok: true }   login apagado; pedido de cancelamento aberto para a equipe
 *   401 sessao | 403 conta que nao se exclui pelo app | 500 falha
 *
 * Decisao do dono (05/10/2026): apaga o LOGIN e abre pedido de cancelamento
 * da assinatura (Protocolos). Contrato, UCs, faturas e historico ficam:
 * o cancelamento segue o contrato, pela equipe. Ver fn_excluir_conta_app.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
})

const MOTIVOS: Record<string, string> = {
    papel_interno: 'Contas da equipe B2W não podem ser excluídas pelo app.',
    originador_legado: 'Para excluir esta conta, fale com o suporte B2W.',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const auth = await requireUser(req, admin)
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status)

    const { data: res, error: rpcErr } = await admin.rpc('fn_excluir_conta_app', { p_uid: auth.userId })
    if (rpcErr) {
        console.error('excluir-conta-app: fn_excluir_conta_app', rpcErr)
        return json({ ok: false, error: 'Não foi possível excluir a conta agora. Tente de novo.' }, 500)
    }
    if (!res?.ok) {
        return json({ ok: false, error: MOTIVOS[res?.motivo] ?? 'Não foi possível excluir a conta.' }, 403)
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(auth.userId)
    if (delErr) {
        // O pedido para a equipe ja foi aberto e os vinculos desfeitos; o login
        // que sobrou nao enxerga mais nada (sem assinante/fornecedor ligado).
        console.error('excluir-conta-app: deleteUser', auth.userId, delErr)
        return json({ ok: false, error: 'Recebemos seu pedido, mas o login não foi apagado. A equipe B2W vai concluir.' }, 500)
    }

    return json({ ok: true })
})
