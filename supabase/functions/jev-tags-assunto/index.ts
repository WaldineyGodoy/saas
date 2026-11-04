import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

/**
 * Tags de ASSUNTO nos contatos do Deskcomm, pelo Jev (04/11/2026, pedido do dono).
 *
 * Lê a conversa do contato e pergunta ao Jev, uma pergunta `noul` por tag, se o
 * CLIENTE tratou daquele assunto. Pode haver mais de uma tag. Só acrescenta
 * (nunca tira, nem a posta à mão) — gravação pela RPC
 * ponte_deskcomm_gravar_tags_assunto, que guarda o que acrescentou em
 * ponte_deskcomm.tags_assunto.
 *
 * Chamada com `x-ponte-token` (cron ponte-deskcomm-tags-assunto, 10 min).
 * Corpo: { limite?: number, contato_id?: uuid, ensaio?: boolean }
 *   ensaio = devolve as tags e as probabilidades sem gravar.
 */

const JANELA_MENSAGENS = 40
const TETO_MS = 25000
const LIMIAR = 0.6

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Tag como o Deskcomm guarda (minúscula) + o que o Jev precisa saber dela. */
const TAGS: Record<string, { tag: string; descricao: string }> = {
    investimento: {
        tag: 'usinas de investimento',
        descricao: 'quer INVESTIR em usina solar para ter renda: comprar uma usina inteira, participar de uma UFV ou construir uma usina como investimento',
    },
    cotas: {
        tag: 'cotas de usina',
        descricao: 'quer comprar uma COTA (uma fração, uma parte) de uma usina solar, e não a usina inteira',
    },
    assinatura: {
        tag: 'energia por assinatura',
        descricao: 'quer DESCONTO NA CONTA DE LUZ dele ou da empresa sem instalar nada (energia solar por assinatura)',
    },
    arrendamento: {
        tag: 'arrendamento de areas',
        descricao: 'tem um TERRENO ou área e quer arrendar ou alugar para a instalação de usina solar',
    },
    gestao: {
        tag: 'gestão de energia',
        descricao: 'já é DONO de usina ou de projeto de geração e quer que a B2W gerencie, comercialize ou compre a energia dela',
    },
    parceiro: {
        tag: 'parceiro power',
        descricao: 'quer ser PARCEIRO da B2W: indicar clientes, revender, ser consultor ou representante e ganhar comissão',
    },
}

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

function perguntas(): Record<string, unknown> {
    const q: Record<string, unknown> = {}
    for (const [k, d] of Object.entries(TAGS)) {
        q[k] = {
            type: 'noul',
            instructions:
                `Pelo que o CLIENTE escreveu, ele ${d.descricao}? ` +
                'Julgue só pelas mensagens do cliente; o que a B2W ofereceu e o anúncio que ele clicou não contam.',
            criteria: { true: 'Sim, é assunto do cliente', false: 'Não é' },
        }
    }
    return q
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
    const contatoId = typeof corpo?.contato_id === 'string' ? corpo.contato_id : null
    const limite = Math.max(1, Math.min(Number(corpo?.limite) || 20, 50))

    const cfg = await lerConfigJev(supabase)
    if (!cfg) return json(200, { ok: false, motivo: 'jev_nao_configurado' })

    const { data: fila, error } = await supabase.rpc('ponte_deskcomm_contatos_para_tag_assunto', {
        p_limite: limite, p_contato: contatoId,
    })
    if (error) return json(500, { error: 'fila_ilegivel', detalhe: error.message })

    const itens: unknown[] = []
    for (const c of (fila ?? []) as any[]) {
        const { data: msgs } = await supabase
            .from('messages')
            .select('direction, body, media_derived_text, created_at')
            .eq('organization_id', c.organization_id)
            .eq('contact_id', c.contact_id)
            .is('revoked_at', null)
            .order('created_at', { ascending: false })
            .limit(JANELA_MENSAGENS)

        const linhas = (msgs ?? []).reverse()
            .map((m: any) => {
                const texto = (m.body || m.media_derived_text || '').trim()
                if (!texto) return null
                return `${m.direction === 'inbound' ? 'Cliente' : 'B2W'}: ${mascarar(texto).slice(0, 600)}`
            })
            .filter(Boolean)
        if (!linhas.some((l) => (l as string).startsWith('Cliente:'))) {
            if (!ensaio) await supabase.rpc('ponte_deskcomm_gravar_tags_assunto', {
                p_contato: c.contact_id, p_conversa: c.conversation_id, p_tags: [], p_probs: {}, p_lido_ate: c.ultima_inbound,
            })
            itens.push({ contato_id: c.contact_id, tags: [], motivo: 'cliente_sem_texto' })
            continue
        }

        const estado = `Conversa de WhatsApp entre o cliente e a B2W Energia (mais antiga primeiro):\n${linhas.join('\n')}`
        const r = await perguntarAoJev(cfg, estado, perguntas())
        if (!r.ok) {
            if (!ensaio) await supabase.rpc('ponte_deskcomm_falha_tags_assunto', { p_contato: c.contact_id, p_erro: r.erro })
            itens.push({ contato_id: c.contact_id, erro: r.erro })
            if (/jev_http_(401|402|403)/.test(r.erro)) break
            continue
        }

        const probs: Record<string, number> = {}
        const tags: string[] = []
        for (const [k, d] of Object.entries(TAGS)) {
            const p = Number(r.answers[k]?.noul)
            if (Number.isFinite(p)) probs[d.tag] = Math.round(p * 100) / 100
            if (Number.isFinite(p) && p >= LIMIAR) tags.push(d.tag)
        }

        if (ensaio) {
            itens.push({ contato_id: c.contact_id, tags, probs, tags_atuais: c.tags })
            continue
        }

        const { data: novas, error: errGravar } = await supabase.rpc('ponte_deskcomm_gravar_tags_assunto', {
            p_contato: c.contact_id, p_conversa: c.conversation_id, p_tags: tags, p_probs: probs, p_lido_ate: c.ultima_inbound,
        })
        if (errGravar) {
            await supabase.rpc('ponte_deskcomm_falha_tags_assunto', { p_contato: c.contact_id, p_erro: errGravar.message })
            itens.push({ contato_id: c.contact_id, erro: errGravar.message })
            continue
        }
        itens.push({ contato_id: c.contact_id, tags, adicionadas: novas })
    }

    return json(200, { ok: true, ensaio, processados: itens.length, itens })
})
