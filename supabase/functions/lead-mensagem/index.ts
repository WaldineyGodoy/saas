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
 * ter `originator_id = auth.uid()`. Limites: 3 por lead e 20 por embaixador
 * por dia, contados em lead_mensagens_envios (reserva antes de enviar).
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
            papel, userId: user.id, leadOriginatorId: user.id, modelo: chave,
            enviosHoje: 0, enviosOriginadorHoje: 0, temTelefone: true,
        })
        if (previa.status !== 200) return json(previa.status, { error: previa.erro })

        if (typeof lead_id !== 'string' || !UUID_RE.test(lead_id)) return json(400, { error: 'lead_id invalido.' })

        // 3. Lead e contagens do dia -- tudo lido no servidor. Os limites contam
        // lead_mensagens_envios (so service_role), nao crm_history (que qualquer
        // logado apaga). Erro de leitura falha FECHADO: 500, nunca "zero envios".
        const { data: lead, error: erroLead } = await supabaseAdmin
            .from('leads').select('id, name, phone, originator_id').eq('id', lead_id).maybeSingle()
        if (erroLead) {
            console.error('lead-mensagem: falha ao ler lead', erroLead)
            return json(500, { error: 'Erro interno.' })
        }

        const desde = inicioDoDiaBrasilia()
        const { count: enviosLead, error: erroContaLead } = await supabaseAdmin
            .from('lead_mensagens_envios')
            .select('id', { count: 'exact', head: true })
            .eq('lead_id', lead_id)
            .gte('criado_em', desde)
        const { count: enviosOriginador, error: erroContaOrig } = await supabaseAdmin
            .from('lead_mensagens_envios')
            .select('id', { count: 'exact', head: true })
            .eq('originator_id', user.id)
            .gte('criado_em', desde)
        if (erroContaLead || erroContaOrig || enviosLead == null || enviosOriginador == null) {
            console.error('lead-mensagem: falha na contagem do limite', erroContaLead || erroContaOrig)
            return json(500, { error: 'Erro interno.' })
        }

        const telefone = String(lead?.phone || '').replace(/\D/g, '')
        const decisao = decidirEnvioLead({
            papel,
            userId: user.id,
            leadOriginatorId: lead?.originator_id ?? null,
            modelo: chave,
            enviosHoje: enviosLead,
            enviosOriginadorHoje: enviosOriginador,
            temTelefone: telefone.length >= 10,
        })
        if (decisao.status !== 200) return json(decisao.status, { error: decisao.erro })

        // Nome e short_url sao editaveis pelo proprio embaixador: montarLinkIndicacao
        // so aceita short_url https em link.b2wenergia.com.br e o id e o da sessao;
        // montarMensagemLead so deixa passar nome feito de letras.
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

        // 4. Reserva ANTES de enviar: a vaga do limite fica ocupada mesmo que o
        // envio demore. Se o envio falhar, a reserva e desfeita.
        const { data: reserva, error: erroReserva } = await supabaseAdmin
            .from('lead_mensagens_envios')
            .insert({ originator_id: user.id, lead_id, modelo: chave })
            .select('id')
            .single()
        if (erroReserva || !reserva) {
            console.error('lead-mensagem: falha ao reservar envio', erroReserva)
            return json(500, { error: 'Erro interno.' })
        }

        // 5. Envio pelo portao normal, com service role.
        const { data: envio, error: erroEnvio } = await supabaseAdmin.functions.invoke('send-whatsapp', {
            body: { phone: telefone, text: texto },
        })
        if (erroEnvio || envio?.error) {
            let detalhe = envio?.error || erroEnvio?.message
            try { const b = await (erroEnvio as any)?.context?.json(); if (b?.error) detalhe = b.error } catch { /* sem corpo */ }
            console.error('lead-mensagem: falha no send-whatsapp', detalhe)
            const { error: erroDesfaz } = await supabaseAdmin.from('lead_mensagens_envios').delete().eq('id', reserva.id)
            if (erroDesfaz) console.error('lead-mensagem: falha ao desfazer reserva', reserva.id, erroDesfaz)
            return json(502, { error: 'Falha ao enviar o WhatsApp. Tente novamente mais tarde.' })
        }

        // 6. Historico para a timeline do lead. Falha aqui nao desfaz o envio.
        const avisos: string[] = []
        const { error: erroHist } = await supabaseAdmin.from('crm_history').insert({
            entity_type: 'lead',
            entity_id: lead_id,
            content: `WhatsApp enviado pelo embaixador (modelo: ${MODELOS_LEAD[chave].rotulo})`,
            metadata: { tipo: TIPO_HISTORICO, modelo: chave, message: texto, phone: telefone, status: 'sent' },
            created_by: user.id,
        })
        if (erroHist) {
            console.error('lead-mensagem: falha ao gravar crm_history', erroHist)
            avisos.push('Mensagem enviada, mas o registro no historico falhou.')
        }

        return json(200, avisos.length ? { ok: true, avisos } : { ok: true })
    } catch (e) {
        console.error('lead-mensagem:', e)
        return json(500, { error: 'Erro interno.' })
    }
})
