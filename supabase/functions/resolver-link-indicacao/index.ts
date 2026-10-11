import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'

/**
 * Resolve o link CURTO de indicação (o que vai no QR do assinante) para o id
 * de quem indicou. O app não consegue fazer isso sozinho: o destino só aparece
 * seguindo o redirecionamento do encurtador, e no webapp o navegador bloqueia
 * essa leitura (CORS).
 *
 * POST { url }   (sessão do app)
 *   200 { id } | 404 { error } link sem indicação | 400 entrada | 401 sessão
 *
 * Só segue links do encurtador da B2W: não vira proxy para buscar qualquer
 * endereço da internet a pedido de quem chama.
 */

const HOSTS = new Set(['link.b2wenergia.com.br'])
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
})

export function indicadorDaUrl(destino: string): string | null {
    try {
        const u = new URL(destino)
        const p = u.searchParams.get('indicador')
        if (p && new RegExp(`^${UUID.source}$`, 'i').test(p)) return p.toLowerCase()
        const rota = u.pathname.match(new RegExp(`/i/(${UUID.source})`, 'i'))
        return rota ? rota[1].toLowerCase() : null
    } catch {
        return null
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const auth = await requireUser(req, admin)
    if (!auth.ok) return json({ error: auth.error }, auth.status)

    let url: URL
    try {
        const { url: bruto } = await req.json()
        url = new URL(String(bruto))
    } catch {
        return json({ error: 'Link inválido.' }, 400)
    }
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname.toLowerCase())) {
        return json({ error: 'Este não é um link de indicação da B2W.' }, 400)
    }

    // Segue até 5 redirecionamentos, sempre olhando o destino antes de ir.
    let atual = url.toString()
    for (let i = 0; i < 5; i++) {
        const achado = indicadorDaUrl(atual)
        if (achado) return json({ id: achado })
        const r = await fetch(atual, { method: 'GET', redirect: 'manual' })
        const proximo = r.headers.get('location')
        await r.body?.cancel()
        if (!proximo || r.status < 300 || r.status >= 400) break
        atual = new URL(proximo, atual).toString()
    }
    const final = indicadorDaUrl(atual)
    return final ? json({ id: final }) : json({ error: 'Este link não é de indicação.' }, 404)
})
