import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

/**
 * Vigia do encerramento esquecido, pelo Jev (07/11/2026, pedido do dono).
 *
 * Quando o cliente recusa ou se despede, o agente deve agradecer E mover o negocio
 * para "Negocio Perdido" — e isso que fecha a conversa. O modelo as vezes so
 * agradece e a conversa fica aberta. Esta funcao le as conversas abertas em que a
 * ultima mensagem e do agente e o cliente esta calado ha mais de 1 hora
 * (RPC ponte_deskcomm_conversas_para_encerrar), pergunta ao Jev se o atendimento
 * terminou sem negocio e, com certeza alta e sem retorno combinado, encerra pela
 * RPC ponte_deskcomm_encerrar_conversa (card no perdido do funil, motivo
 * requested_by_customer, conversa fechada). Migration 20261107d.
 *
 * Chamada com `x-ponte-token` (cron ponte-deskcomm-vigia-encerramento, 30 min).
 * Corpo: { limite?: number, conversa_id?: uuid, ensaio?: boolean }
 *   ensaio = devolve as probabilidades sem encerrar.
 */

const JANELA_MENSAGENS = 30
const TETO_MS = 25000
/** Certeza minima de que o atendimento terminou sem negocio. */
const LIMIAR_ENCERRAR = 0.8
/** Acima disto ha retorno combinado: nao encerra. */
const LIMIAR_RETORNO = 0.4

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Mascara o que identifica a pessoa antes de sair para o fornecedor (mesma regra do jev-temperatura). */
function mascarar(t: string): string {
    return t
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
        .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
        .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
        .replace(/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
        .replace(/\b\d{8,}\b/g, '[numero]')
}

async function lerConfigJev(supabase: any) {
    const chaveEnv = Deno.env.get('JEV_API_KEY')
    if (chaveEnv) {
        const base = (Deno.env.get('JEV_BASE_URL') || 'https://openrouter.ai/api').replace(/\/+$/, '').replace(/\/v1$/, '')
        const model = Deno.env.get('JEV_MODEL') || (base.includes('openrouter') ? 'typesafe/jev-1.13' : 'jev-1.13.0')
        return { base, chave: chaveEnv, model }
    }
    const { data } = await supabase
        .from('integrations_config').select('endpoint_url, api_key, variables, is_active')
        .eq('service_name', 'jev').maybeSingle()
    if (!data?.is_active || !data.api_key) return null
    const base = String(data.endpoint_url || 'https://openrouter.ai/api').replace(/\/+$/, '').replace(/\/v1$/, '')
    const model = data.variables?.model ?? (base.includes('openrouter') ? 'typesafe/jev-1.13' : 'jev-1.13.0')
    return { base, chave: String(data.api_key), model }
}

async function perguntarAoJev(cfg: { base: string; chave: string; model: string }, estado: string, questions: Record<string, unknown>) {
    const ctrl = new AbortController()
    const relogio = setTimeout(() => ctrl.abort(), TETO_MS)
    try {
        const res = await fetch(`${cfg.base}/v1/systemone`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cfg.chave}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: cfg.model, state: estado, questions }),
            signal: ctrl.signal,
        })
        const texto = await res.text()
        if (!res.ok) return { ok: false as const, erro: `jev_http_${res.status}` }
        const corpo = JSON.parse(texto)
        if (!corpo?.answers || typeof corpo.answers !== 'object') return { ok: false as const, erro: 'jev_resposta_ilegivel' }
        return { ok: true as const, answers: corpo.answers }
    } catch {
        return { ok: false as const, erro: 'jev_indisponivel' }
    } finally {
        clearTimeout(relogio)
    }
}

const PERGUNTAS = {
    terminou: {
        type: 'noul',
        instructions:
            'O atendimento TERMINOU SEM NEGOCIO? Sim quando o cliente recusou ("nao, obrigado", "nao tenho interesse", ' +
            '"agora nao", "nao posso no momento"), disse que ja resolveu ou fechou com outra empresa, ou apenas se despediu ' +
            '("ok, um abraco", "boa noite", "obrigado") depois de a B2W dizer que nao ia mais insistir ou de deixar a porta aberta. ' +
            'Nao quando o cliente demonstrou interesse, fez pergunta, mandou dados ou conta, pediu proposta, ou a conversa ' +
            'ainda tem um proximo passo em aberto. Julgue pelo fim da conversa.',
        criteria: { true: 'Terminou sem negocio', false: 'Ainda em andamento ou com interesse' },
    },
    retorno: {
        type: 'noul',
        instructions:
            'Ficou combinado falar de novo numa data ou momento futuro (o cliente pediu para chamar depois, ' +
            '"semana que vem", "depois do salario", "volto a falar" com data)? Uma despedida generica sem data nao conta.',
        criteria: { true: 'Ha retorno combinado', false: 'Nao ha retorno combinado' },
    },
}

serve(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: confere } = await supabase.rpc('ponte_deskcomm_token_confere', {
        p_token: req.headers.get('x-ponte-token') ?? '',
    })
    if (confere !== true) return json(401, { error: 'token_invalido' })

    let corpo: any = {}
    try { corpo = await req.json() } catch { /* corpo vazio */ }
    const ensaio = corpo?.ensaio === true
    const conversaId = typeof corpo?.conversa_id === 'string' ? corpo.conversa_id : null
    const limite = Math.max(1, Math.min(Number(corpo?.limite) || 20, 50))

    const cfg = await lerConfigJev(supabase)
    if (!cfg) return json(200, { ok: false, motivo: 'jev_nao_configurado' })

    const { data: fila, error } = await supabase.rpc('ponte_deskcomm_conversas_para_encerrar', {
        p_limite: limite, p_conversa: conversaId,
    })
    if (error) return json(500, { error: 'fila_ilegivel', detalhe: error.message })

    const itens: unknown[] = []
    for (const c of (fila ?? []) as any[]) {
        const { data: msgs } = await supabase
            .from('messages')
            .select('direction, body, media_derived_text, created_at')
            .eq('conversation_id', c.conversation_id)
            .is('revoked_at', null)
            .order('created_at', { ascending: false })
            .limit(JANELA_MENSAGENS)

        const linhas = (msgs ?? []).reverse()
            .map((m: any) => {
                const texto = (m.body || m.media_derived_text || '').trim()
                if (!texto) return null
                return `${m.direction === 'inbound' ? 'Cliente' : 'B2W'}: ${mascarar(texto).slice(0, 500)}`
            })
            .filter(Boolean)

        const estado = `Conversa de WhatsApp entre o cliente e a B2W Energia (mais antiga primeiro):\n${linhas.join('\n')}`
        const r = await perguntarAoJev(cfg, estado, PERGUNTAS)
        if (!r.ok) {
            if (!ensaio) await supabase.rpc('ponte_deskcomm_falha_encerramento', { p_conversa: c.conversation_id, p_erro: r.erro })
            itens.push({ conversa_id: c.conversation_id, erro: r.erro })
            if (/jev_http_(401|402|403)/.test(r.erro)) break
            continue
        }

        const pTerminou = Number(r.answers.terminou?.noul)
        const pRetorno = Number(r.answers.retorno?.noul)
        const terminou = Number.isFinite(pTerminou) ? Math.round(pTerminou * 100) / 100 : null
        const retorno = Number.isFinite(pRetorno) ? Math.round(pRetorno * 100) / 100 : null
        const encerrar = terminou !== null && terminou >= LIMIAR_ENCERRAR && (retorno === null || retorno < LIMIAR_RETORNO)

        if (ensaio) {
            itens.push({ conversa_id: c.conversation_id, terminou, retorno, encerraria: encerrar })
            continue
        }

        if (encerrar) {
            const { data: res, error: errEnc } = await supabase.rpc('ponte_deskcomm_encerrar_conversa', {
                p_conversa: c.conversation_id, p_prob: terminou, p_retorno: retorno, p_lido_ate: c.ultima_em,
            })
            if (errEnc) {
                await supabase.rpc('ponte_deskcomm_falha_encerramento', { p_conversa: c.conversation_id, p_erro: errEnc.message })
                itens.push({ conversa_id: c.conversation_id, erro: errEnc.message })
                continue
            }
            itens.push({ conversa_id: c.conversation_id, terminou, retorno, resultado: res })
        } else {
            await supabase.rpc('ponte_deskcomm_manter_conversa', {
                p_conversa: c.conversation_id, p_contato: c.contact_id, p_prob: terminou, p_retorno: retorno, p_lido_ate: c.ultima_em,
            })
            itens.push({ conversa_id: c.conversation_id, terminou, retorno, resultado: 'mantida' })
        }
    }

    return json(200, { ok: true, ensaio, processados: itens.length, itens })
})
