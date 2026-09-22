import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import {
    decidirEnvioLead,
    montarLinkIndicacao,
    montarMensagemLead,
    MODELOS_LEAD,
    TIPO_HISTORICO,
} from '../_shared/mensagem-lead.ts'

/**
 * Mensagem do embaixador (papel `originator`) ao PROPRIO lead, por modelo.
 *
 * Task 14 (22/09/2026): qualquer pessoa vira `originator` pelo cadastro
 * publico de embaixador, entao o papel saiu do portao de send-whatsapp /
 * send-email. Aqui o embaixador so escolhe o modelo: o texto e montado no
 * servidor, o telefone vem de `leads.phone` (nunca do corpo) e o lead precisa
 * ter `originator_id = auth.uid()`. Limite de 3 envios por lead por dia.
 *
 * POST { lead_id, modelo }  com o JWT do usuario.
 *   interno (super_admin/admin/manager/coordinator) -> 403 (use send-whatsapp)
 *   lead de outro embaixador -> 403; modelo invalido -> 400; limite -> 429
 *   sem sessao / outro papel -> 401
 *
 * `verify_jwt = true` e so a camada externa: a chave anon e um JWT valido e
 * publico. O portao de verdade e o auth.getUser + perfil abaixo.
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

/** Inicio do dia corrente em Brasilia (UTC-3, sem horario de verao desde 2019), em ISO UTC. */
const inicioDoDiaBrasilia = (agora = new Date()) => {
    const local = new Date(agora.getTime() - 3 * 3600 * 1000)
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3, 0, 0)).toISOString()
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return json(405, { error: 'Use POST.' })

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    try {
        // 1. Quem esta chamando. A chave anon cai aqui: JWT assinado, sem usuario.
        const authorization = req.headers.get('Authorization')
        if (!authorization) return json(401, { error: 'Autenticacao obrigatoria.' })
        const token = authorization.replace(/^Bearer\s+/i, '').trim()
        const { data: { user }, error: erroUser } = await supabaseAdmin.auth.getUser(token)
        if (erroUser || !user) return json(401, { error: 'Sessao invalida ou expirada.' })

        const { data: perfil } = await supabaseAdmin.from('profiles').select('role, name').eq('id', user.id).maybeSingle()
        const papel: string | null = perfil?.role ?? null

        const { lead_id, modelo } = await req.json().catch(() => ({} as Record<string, unknown>))
        const chave = typeof modelo === 'string' ? modelo : ''

        // 2. Papel antes de tudo: quem nao e embaixador nao chega a consultar lead.
        const previa = decidirEnvioLead({
            papel, userId: user.id, leadOriginatorId: user.id, modelo: chave, enviosHoje: 0, temTelefone: true,
        })
        if (previa.status !== 200) return json(previa.status, { error: previa.erro })

        if (typeof lead_id !== 'string' || !UUID_RE.test(lead_id)) return json(400, { error: 'lead_id invalido.' })

        // 3. Lead, embaixador e contagem do dia -- tudo lido no servidor.
        const { data: lead } = await supabaseAdmin
            .from('leads').select('id, name, phone, originator_id').eq('id', lead_id).maybeSingle()

        const { count } = await supabaseAdmin
            .from('crm_history')
            .select('id', { count: 'exact', head: true })
            .eq('entity_type', 'lead')
            .eq('entity_id', lead_id)
            .eq('metadata->>tipo', TIPO_HISTORICO)
            .gte('created_at', inicioDoDiaBrasilia())

        const telefone = String(lead?.phone || '').replace(/\D/g, '')
        const decisao = decidirEnvioLead({
            papel,
            userId: user.id,
            leadOriginatorId: lead?.originator_id ?? null,
            modelo: chave,
            enviosHoje: count ?? 0,
            temTelefone: telefone.length >= 10,
        })
        if (decisao.status !== 200) return json(decisao.status, { error: decisao.erro })

        const { data: originador } = await supabaseAdmin
            .from('originators_v2').select('id, name, short_url').eq('id', user.id).maybeSingle()

        const link = montarLinkIndicacao({
            id: user.id,
            name: originador?.name ?? perfil?.name ?? null,
            short_url: originador?.short_url ?? null,
        })
        const texto = montarMensagemLead(chave, {
            nomeLead: lead!.name,
            nomeOriginador: originador?.name ?? perfil?.name ?? null,
            link,
        })!

        // 4. Envio pelo portao normal, com service role.
        const { data: envio, error: erroEnvio } = await supabaseAdmin.functions.invoke('send-whatsapp', {
            body: { phone: telefone, text: texto },
        })
        if (erroEnvio || envio?.error) {
            let detalhe = envio?.error || erroEnvio?.message
            try { const b = await (erroEnvio as any)?.context?.json(); if (b?.error) detalhe = b.error } catch { /* sem corpo */ }
            console.error('lead-mensagem: falha no send-whatsapp', detalhe)
            return json(502, { error: 'Falha ao enviar o WhatsApp. Tente novamente mais tarde.' })
        }

        // 5. Historico: e dele que sai a contagem do limite diario.
        const { error: erroHist } = await supabaseAdmin.from('crm_history').insert({
            entity_type: 'lead',
            entity_id: lead_id,
            content: `WhatsApp enviado pelo embaixador (modelo: ${MODELOS_LEAD[chave].rotulo})`,
            metadata: { tipo: TIPO_HISTORICO, modelo: chave, message: texto, phone: telefone, status: 'sent' },
            created_by: user.id,
        })
        if (erroHist) console.error('lead-mensagem: falha ao gravar crm_history', erroHist)

        return json(200, { ok: true })
    } catch (e) {
        console.error('lead-mensagem:', e)
        return json(500, { error: 'Erro interno.' })
    }
})
