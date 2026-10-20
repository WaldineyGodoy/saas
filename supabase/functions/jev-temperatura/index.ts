import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

/**
 * Temperatura e probabilidade de fechamento dos leads, pelo Jev (TypeSafe System One).
 *
 * O Jev nao escreve texto: recebe um ESTADO e perguntas tipadas e devolve valores
 * com probabilidade calibrada, todas as perguntas numa passada. Aqui ele responde,
 * sobre a conversa do WhatsApp no Deskcomm:
 *
 *   temperatura  (score, 5 niveis)  Gelado .. Fechando
 *   fecha_30d    (noul)             probabilidade de fechar em 30 dias
 *   categoria    (choice)           linha de negocio — confere o roteador
 *   proximo_passo(choice)           o que o atendente deve fazer agora
 *
 * Grava em leads.qualificacao.jev (CRM B2W) e uma tag `temp:<faixa>` no card do
 * Deskcomm, para filtrar o kanban de la. NAO escreve crm_lead_scores: aquela
 * tabela e do worker de score do Deskcomm (formula), e ele sobrescreveria.
 *
 * Origem do Jev — Secrets das Edge Functions (preferido):
 *   JEV_API_KEY  = chave OpenRouter (a mesma que o Deskcomm usa)
 *   JEV_BASE_URL = opcional; padrao https://openrouter.ai/api
 *   JEV_MODEL    = opcional; padrao typesafe/jev-1.13
 * ou integrations_config (service_name = 'jev'):
 *   endpoint_url = https://openrouter.ai/api   (usa a conta OpenRouter que ja existe)
 *               ou https://api.typesafe.ai      (conta propria na TypeSafe)
 *   api_key      = chave da origem escolhida
 *   variables    = { "model": "typesafe/jev-1.13" }  (OpenRouter) | { "model": "jev-1.13.0" } (TypeSafe)
 * Versao FIXADA de proposito (mesma decisao do Deskcomm): o apelido `jev-latest`
 * mudaria a regua sem deploy.
 *
 * LGPD: as mensagens saem para o fornecedor. Antes de enviar, CPF/CNPJ, e-mail,
 * telefone e numeros longos sao mascarados. A conversa ja vai a um modelo pela
 * OpenRouter no atendimento do agente; o Jev e mais um suboperador — registrar na
 * politica de privacidade antes de ligar.
 *
 * Chamada: cron `ponte-deskcomm-jev` (10 em 10 min) com `x-ponte-token`.
 * Corpo opcional: { limite?: number, ensaio?: boolean }  (ensaio = nao grava)
 */

const JANELA_MENSAGENS = 16
const TETO_MS = 8000

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const FAIXAS = ['gelado', 'frio', 'morno', 'quente', 'fechando'] as const
type Faixa = typeof FAIXAS[number]

const PERGUNTA_TEMPERATURA = {
    type: 'score',
    instructions:
        'Quao perto o cliente esta de fechar negocio com a B2W Energia, pelo que ELE escreveu na conversa? ' +
        'Considere interesse declarado, pedido de proposta/simulacao, envio de conta de luz ou documentos, ' +
        'perguntas sobre contrato e prazo, objecoes nao resolvidas e silencio.',
    criteria: [
        'Gelado: sem interesse, recusou, ou a conversa nao e sobre negocio',
        'Frio: curiosidade generica, sem dado concreto nem pedido',
        'Morno: interesse claro, ainda colhendo informacao ou com objecao aberta',
        'Quente: pediu proposta/simulacao, mandou dados ou conta, discute condicoes',
        'Fechando: aceitou a proposta, pediu contrato, ou combinou assinatura/pagamento',
    ],
}

const PERGUNTA_FECHA_30D = {
    type: 'noul',
    instructions: 'Este cliente vai fechar negocio com a B2W Energia nos proximos 30 dias?',
    criteria: { true: 'Fecha em ate 30 dias', false: 'Nao fecha em 30 dias' },
}

const PERGUNTA_PROXIMO_PASSO = {
    type: 'choice',
    instructions: 'Qual o melhor proximo passo do atendimento agora?',
    criteria: {
        qualificar: 'Faltam dados basicos do cliente (consumo, local, objetivo)',
        enviar_simulacao: 'Ja ha dados para mandar simulacao ou proposta',
        tirar_duvida: 'Ha uma duvida ou objecao especifica a responder',
        agendar_reuniao: 'O cliente quer conversar com um consultor ou ver apresentacao',
        enviar_contrato: 'O cliente aceitou e falta o contrato',
        passar_para_humano: 'Pedido fora do escopo, reclamacao, ou cliente irritado',
        aguardar: 'A bola esta com o cliente; nao insistir agora',
    },
}

/** Descricoes das categorias para o choice (as chaves sao os slugs da ponte). */
const DESCRICAO_CATEGORIA: Record<string, string> = {
    energia_assinatura: 'Quer desconto na conta de luz sem instalar nada (energia solar por assinatura, geracao compartilhada)',
    usina_investimento: 'Quer investir em usina solar para ter renda (comprar usina, participar de UFV)',
    eletropostos: 'Quer carregar carro eletrico, ter um eletroposto, ou ser parceiro de recarga',
    cotas: 'Quer comprar cotas de uma usina / fracao de geracao',
    arrendamento: 'Tem terreno ou area e quer arrendar para usina solar',
    comercializadora: 'Empresa grande, mercado livre de energia, gestao ou comercializacao de energia',
    vagas: 'Quer alugar ou oferecer vaga de estacionamento (com ou sem recarga)',
}

/** Mascara o que identifica a pessoa antes de sair para o fornecedor. */
function mascarar(t: string): string {
    return t
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
        .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
        .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
        .replace(/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
        .replace(/\b\d{8,}\b/g, '[numero]')
}

function faixaDoScore(resp: any): { faixa: Faixa; score01: number; confianca: number | null } {
    const probs: Record<string, number> = resp?.probabilities ?? {}
    const chaves = Object.keys(probs)
    // As chaves podem vir como indice ("0".."4") ou como o texto do criterio.
    const nivelDe = (k: string) => {
        const n = Number(k)
        if (Number.isInteger(n) && n >= 0 && n < FAIXAS.length) return n
        const i = PERGUNTA_TEMPERATURA.criteria.findIndex((c) => c === k || c.toLowerCase().startsWith(k.toLowerCase()))
        return i
    }
    let esperado = 0, soma = 0, melhor = -1, pMelhor = -1
    for (const k of chaves) {
        const n = nivelDe(k), p = Number(probs[k]) || 0
        if (n < 0) continue
        esperado += n * p; soma += p
        if (p > pMelhor) { pMelhor = p; melhor = n }
    }
    if (soma <= 0) {
        // sem probabilidades legiveis: usa o score continuo; aceita 0..4 ou 1..5
        const s = Number(resp?.score)
        const n = Number.isFinite(s) ? (s > 4 ? s - 1 : s) : 0
        melhor = Math.max(0, Math.min(4, Math.round(n))); esperado = n; soma = 1
    }
    return {
        faixa: FAIXAS[Math.max(0, melhor)],
        score01: Math.round((esperado / soma / (FAIXAS.length - 1)) * 1000) / 1000,
        confianca: typeof resp?.confidence === 'number' ? resp.confidence : null,
    }
}

async function lerConfigJev(supabase: any) {
    // Preferido: Secrets das Edge Functions. JEV_API_KEY = chave OpenRouter
    // (a mesma do .env do Deskcomm) ou da TypeSafe, conforme JEV_BASE_URL.
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
        return { ok: true as const, answers: corpo.answers, usage: corpo.usage ?? null, model: corpo.model ?? cfg.model }
    } catch {
        return { ok: false as const, erro: 'jev_indisponivel' }
    } finally {
        clearTimeout(relogio)
    }
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
    const limite = Math.max(1, Math.min(Number(corpo?.limite) || 25, 100))
    const ensaio = corpo?.ensaio === true

    const cfg = await lerConfigJev(supabase)
    if (!cfg) return json(200, { ok: false, motivo: 'jev_nao_configurado' })

    const [{ data: fila, error }, { data: categorias }] = await Promise.all([
        supabase.rpc('ponte_deskcomm_para_avaliar', { p_limite: limite }),
        supabase.rpc('ponte_deskcomm_categorias'),
    ])
    if (error) return json(500, { error: 'fila_ilegivel' })

    const criteriosCategoria: Record<string, string> = {}
    for (const c of (categorias ?? []) as any[]) {
        if (!c.tag_b2w) continue // a Recepcao (entrada) nao e produto
        criteriosCategoria[c.slug] = DESCRICAO_CATEGORIA[c.slug] ?? c.nome
    }
    criteriosCategoria['nenhuma'] = 'Nao e sobre nenhum produto da B2W (pessoal, fornecedor, spam, vaga de emprego)'

    const resultado = { avaliados: 0, falhas: 0, divergencias_de_categoria: 0, itens: [] as unknown[] }

    for (const item of (fila ?? []) as any[]) {
        const { data: msgs } = await supabase
            .from('messages')
            .select('direction, body, media_derived_text, type, created_at')
            .eq('organization_id', item.organization_id)
            .eq('contact_id', item.contact_id)
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
        if (linhas.length === 0) continue

        const estado =
            `Produto do funil atual: ${item.categoria_nome ?? 'nao definido'}. Etapa atual: ${item.etapa ?? 'nao definida'}.\n` +
            `Conversa de WhatsApp (mais antiga primeiro):\n${linhas.join('\n')}`

        const r = await perguntarAoJev(cfg, estado, {
            temperatura: PERGUNTA_TEMPERATURA,
            fecha_30d: PERGUNTA_FECHA_30D,
            proximo_passo: PERGUNTA_PROXIMO_PASSO,
            categoria: { type: 'choice', instructions: 'Sobre qual linha de negocio da B2W o cliente esta falando?', criteria: criteriosCategoria },
        })
        if (!r.ok) {
            resultado.falhas++
            resultado.itens.push({ b2w_lead_id: item.b2w_lead_id, erro: r.erro })
            // Credencial ou credito: as proximas vao falhar igual — para o lote.
            if (/jev_http_(401|402|403)/.test(r.erro)) break
            continue
        }

        const temp = faixaDoScore(r.answers.temperatura)
        const fecha = Number(r.answers.fecha_30d?.noul)
        const jev = {
            avaliado_em: new Date().toISOString(),
            modelo: r.model,
            temperatura: temp.faixa,
            temperatura_score: temp.score01,
            temperatura_confianca: temp.confianca,
            probabilidade_fechamento_30d: Number.isFinite(fecha) ? Math.round(fecha * 1000) / 1000 : null,
            proximo_passo: r.answers.proximo_passo?.choice ?? null,
            categoria_jev: r.answers.categoria?.choice ?? null,
            categoria_jev_confianca: r.answers.categoria?.confidence ?? null,
            categoria_funil: item.categoria,
            mensagens_lidas: linhas.length,
            tokens_entrada: r.usage?.input_tokens ?? null,
        }
        const diverge = jev.categoria_jev && jev.categoria_jev !== 'nenhuma' && jev.categoria_jev !== item.categoria
        if (diverge) resultado.divergencias_de_categoria++

        if (!ensaio) {
            const { data: lead } = await supabase.from('leads').select('qualificacao').eq('id', item.b2w_lead_id).maybeSingle()
            await supabase.from('leads')
                .update({ qualificacao: { ...(lead?.qualificacao ?? {}), jev } })
                .eq('id', item.b2w_lead_id)

            const { data: card } = await supabase.from('crm_leads').select('tags').eq('id', item.deskcomm_lead_id).maybeSingle()
            const tags = ((card?.tags ?? []) as string[]).filter((t) => !t.startsWith('temp:'))
            tags.push(`temp:${temp.faixa}`)
            await supabase.from('crm_leads').update({ tags }).eq('id', item.deskcomm_lead_id)
        }

        resultado.avaliados++
        resultado.itens.push({ b2w_lead_id: item.b2w_lead_id, temperatura: jev.temperatura, fecha_30d: jev.probabilidade_fechamento_30d, categoria_jev: jev.categoria_jev, diverge })
    }

    return json(200, { ok: true, ensaio, ...resultado })
})
