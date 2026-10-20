import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

/**
 * Ponte B2W -> DeskcommCRM: drena `ponte_deskcomm.fila` e move o card no Deskcomm.
 *
 * Quem enfileira e o gatilho `trg_ponte_lead_para_fila` (migration
 * 20261020a_ponte_deskcomm.sql) quando o status de um lead vinculado muda no CRM.
 *
 * Por que pela API e nao por UPDATE: no Deskcomm `lead.stage_changed` e emitido
 * pelo handler de mover (nao por gatilho). Um UPDATE direto em crm_leads deixaria
 * follow-up, automacoes e linha do tempo sem saber da mudanca. A porta de servidor
 * para servidor dele e o MCP (`/api/mcp`, Bearer de api_tokens, scope mcp:write),
 * ferramenta `crm_move_lead_stage`.
 *
 * Configuracao (Secrets das Edge Functions, no painel do Supabase):
 *   DESKCOMM_MCP_TOKEN = token dsk_... criado no Deskcomm (scope mcp:write)
 *   DESKCOMM_URL       = opcional; padrao https://chat.b2wenergia.com.br
 * Alternativa: integrations_config (service_name = 'deskcomm', endpoint_url + api_key).
 *
 * Quem chama e o banco (`ponte_deskcomm.fn_chamar_funcao`, pelo gatilho e pelo
 * cron), com a anon key no Authorization e o token `cron:ponte_token` do Vault em
 * `x-ponte-token`. Quem confere o token e o banco (RPC), como no emissor.
 */

const LOTE = 20 // tentativas: no maximo 5 por item (ponte_deskcomm_fila_pendente)

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Supa = ReturnType<typeof createClient>

async function lerConfig(supabase: Supa) {
    // Preferido: Secrets das Edge Functions (painel do Supabase), fora do banco.
    const tokenEnv = Deno.env.get('DESKCOMM_MCP_TOKEN')
    if (tokenEnv) {
        const base = (Deno.env.get('DESKCOMM_URL') || 'https://chat.b2wenergia.com.br').replace(/\/+$/, '')
        return { base, token: tokenEnv }
    }
    const { data } = await supabase
        .from('integrations_config')
        .select('endpoint_url, api_key, is_active')
        .eq('service_name', 'deskcomm')
        .maybeSingle()
    if (!data?.is_active || !data.endpoint_url || !data.api_key) return null
    return { base: String(data.endpoint_url).replace(/\/+$/, ''), token: String(data.api_key) }
}

/** tools/call no MCP stateless do Deskcomm. A resposta pode vir em JSON ou SSE. */
async function chamarFerramenta(cfg: { base: string; token: string }, nome: string, args: Record<string, unknown>) {
    const res = await fetch(`${cfg.base}/api/mcp`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${cfg.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method: 'tools/call',
            params: { name: nome, arguments: args },
        }),
    })
    const texto = await res.text()
    if (!res.ok) throw new Error(`mcp_http_${res.status}`)

    // SSE: pega a ultima linha `data:` com JSON
    let corpo: any = null
    const linhas = texto.split('\n').filter((l) => l.startsWith('data:'))
    try {
        corpo = linhas.length ? JSON.parse(linhas[linhas.length - 1].slice(5).trim()) : JSON.parse(texto)
    } catch {
        throw new Error('mcp_resposta_ilegivel')
    }
    if (corpo?.error) throw new Error(`mcp_${corpo.error.code ?? 'erro'}: ${corpo.error.message ?? ''}`.slice(0, 300))
    if (corpo?.result?.isError) {
        const msg = corpo.result.content?.map((c: any) => c.text).join(' ') ?? 'erro da ferramenta'
        throw new Error(`tool: ${msg}`.slice(0, 300))
    }
    return corpo?.result
}

/** Etapa de destino no MESMO funil do card, pelo padrao de nome de status_etapa. */
async function etapaDestino(supabase: Supa, deskcommLeadId: string, status: string, etapaPadrao: string | null) {
    const { data: card } = await supabase
        .from('crm_leads').select('id, pipeline_id, stage_id, status').eq('id', deskcommLeadId).maybeSingle()
    if (!card || card.status !== 'open') return { card, etapa: null }

    const { data: etapas } = await supabase
        .from('crm_stages').select('id, name, position, is_won, is_lost')
        .eq('pipeline_id', card.pipeline_id).eq('is_archived', false).order('position')
    const padrao = etapaPadrao
        ? new RegExp('^' + etapaPadrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
        : null
    const etapa = (padrao ? (etapas ?? []).find((e: any) => padrao.test(String(e.name).toLowerCase())) : null)
        // ganho/perda sem etapa com esse nome: usa a etapa marcada como tal
        ?? (status === 'negocio_perdido' ? (etapas ?? []).find((e: any) => e.is_lost) : null)
        ?? (['ativacao', 'ativo', 'pago'].includes(status) ? (etapas ?? []).find((e: any) => e.is_won) : null)
    return { card, etapa: etapa ?? null }
}

serve(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: confere } = await supabase.rpc('ponte_deskcomm_token_confere', {
        p_token: req.headers.get('x-ponte-token') ?? '',
    })
    if (confere !== true) return json(401, { error: 'token_invalido' })

    const cfg = await lerConfig(supabase)
    if (!cfg) return json(200, { ok: false, motivo: 'deskcomm_nao_configurado' })

    const { data: itens, error } = await supabase.rpc('ponte_deskcomm_fila_pendente', { p_limite: LOTE })
    if (error) return json(500, { error: 'fila_ilegivel' })

    const marcar = (id: number, ok: boolean, erro: string | null = null) =>
        supabase.rpc('ponte_deskcomm_fila_marcar', { p_id: id, p_ok: ok, p_erro: erro })

    const resultado = { movidos: 0, ignorados: 0, falhas: 0 }
    for (const item of (itens ?? []) as any[]) {
        try {
            const { card, etapa } = await etapaDestino(supabase, item.deskcomm_lead_id, item.status_b2w, item.etapa_padrao)
            if (!card || !etapa || etapa.id === card.stage_id) {
                resultado.ignorados++
                await marcar(item.id, true, etapa ? null : 'sem_etapa_correspondente')
                continue
            }
            await chamarFerramenta(cfg, 'crm_move_lead_stage', {
                lead_id: card.id,
                to_stage_id: etapa.id,
                reason: `Status alterado no CRM B2W para "${item.status_b2w}"`,
                ...(etapa.is_lost ? { lost_reason: 'Perdido no CRM B2W' } : {}),
                ...(etapa.is_won ? { won_reason: 'Fechado no CRM B2W' } : {}),
            })
            resultado.movidos++
            await marcar(item.id, true)
        } catch (e) {
            resultado.falhas++
            await marcar(item.id, false, String((e as Error)?.message ?? e))
        }
    }
    return json(200, { ok: true, ...resultado })
})
