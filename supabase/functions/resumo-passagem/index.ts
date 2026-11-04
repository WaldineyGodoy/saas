import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

/**
 * Resumo curto da passagem IA -> humano (04/11/2026, pedido do dono).
 *
 * O cartão "Por que a IA passou para você" do Deskcomm vinha com o resumo
 * acumulado, as tentativas, a fala do cliente e o texto de quem passou, tudo
 * repetido. Aqui ele vira:
 *
 *   Nome: ...
 *   Cidade: ...
 *   Interesse: <produto> · <o que pediu>
 *   Principais dúvidas: ...
 *   Dúvidas não respondidas: ...
 *   Objeções: ...
 *   Temperatura: ...            (só se o Jev já mediu)
 *
 * As dúvidas e as objeções vêm do Jev (TypeSafe System One): ele não escreve
 * texto, então cada tema é uma pergunta tipada — `choice` para dúvida
 * (não perguntou / respondida / sem resposta) e `noul` para objeção. Todas numa
 * passada só.
 *
 * Grava pela RPC ponte_deskcomm_gravar_resumo_passagem: reescreve o cartão
 * (o original fica em ponte_deskcomm.resumo_passagem.original) e põe o resumo
 * no histórico do lead no CRM B2W. A retomada pela IA lê esse resumo pelos
 * gatilhos da migration 20261104a.
 *
 * Chamada: gatilho trg_ponte_resumir_passagem (na hora) e cron
 * ponte-deskcomm-resumo-passagem (rede de segurança), com `x-ponte-token`.
 * Corpo: { passagem_id?: uuid, limite?: number, ensaio?: boolean }
 *   ensaio = monta e devolve o texto sem gravar.
 */

const JANELA_MENSAGENS = 30
const TETO_MS = 25000
const LIMIAR_OBJECAO = 0.6

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Dúvidas: rótulo curto (vai para o cartão) + descrição (vai para o Jev). */
const DUVIDAS: Record<string, { rotulo: string; descricao: string }> = {
    confiabilidade: { rotulo: 'Se a B2W é confiável', descricao: 'se a B2W é real e confiável, quem é a empresa, se não é golpe' },
    como_funciona: { rotulo: 'Como funciona', descricao: 'como o produto ou serviço funciona na prática' },
    valor: { rotulo: 'Valor', descricao: 'quanto custa: valor do investimento, da usina, da cota ou da mensalidade' },
    retorno: { rotulo: 'Retorno / economia', descricao: 'quanto rende, rentabilidade, retorno, desconto ou economia na conta de luz' },
    pagamento: { rotulo: 'Forma de pagamento', descricao: 'forma de pagamento, parcelamento, financiamento, entrada' },
    prazo: { rotulo: 'Prazos', descricao: 'prazos: quando começa, duração, obra, primeiro repasse, início do desconto, vida útil' },
    contrato: { rotulo: 'Contrato e fidelidade', descricao: 'contrato, fidelidade, multa, cancelamento, garantias, propriedade' },
    localizacao: { rotulo: 'Localização / cobertura', descricao: 'onde fica a usina ou o projeto, se atende a cidade ou a distribuidora dele' },
    documentos: { rotulo: 'Documentos e adesão', descricao: 'que dados ou documentos precisa enviar e como fazer a adesão ou a compra' },
    impostos: { rotulo: 'Impostos', descricao: 'impostos, tributação, nota fiscal' },
    manutencao: { rotulo: 'Manutenção e riscos', descricao: 'manutenção, seguro, riscos, o que acontece se der problema' },
}

/** Objeções: rótulo curto + descrição para o Jev. */
const OBJECOES: Record<string, { rotulo: string; descricao: string }> = {
    preco: { rotulo: 'Achou caro', descricao: 'achou caro, o valor alto demais' },
    sem_recurso: { rotulo: 'Sem recurso agora', descricao: 'não tem o dinheiro agora, depende de vender algo ou de crédito' },
    desconfianca: { rotulo: 'Desconfiança', descricao: 'desconfia da empresa ou do retorno prometido' },
    pensar: { rotulo: 'Quer pensar / consultar alguém', descricao: 'quer pensar ou consultar alguém (cônjuge, sócio, contador) antes de decidir' },
    momento: { rotulo: 'Não é o momento', descricao: 'não é o momento, quer deixar para depois' },
    concorrente: { rotulo: 'Já tem solar / outra proposta', descricao: 'já tem energia solar, outra proposta ou outro fornecedor' },
    prazo_longo: { rotulo: 'Prazo longo', descricao: 'acha longo o prazo de retorno, da obra ou do contrato' },
    contrato: { rotulo: 'Não quer fidelidade', descricao: 'não quer fidelidade, multa ou contrato longo' },
    distancia: { rotulo: 'Usina longe', descricao: 'acha a usina longe ou queria algo na cidade dele' },
}

/** Descrições das categorias (mesmas chaves da ponte) para quando o card é da Recepção. */
const DESCRICAO_CATEGORIA: Record<string, string> = {
    energia_assinatura: 'Quer desconto na conta de luz sem instalar nada (energia solar por assinatura), pessoa física ou empresa',
    usina_investimento: 'Quer investir em usina solar para ter renda (comprar usina, participar de UFV, construir)',
    eletropostos: 'Quer carregar carro elétrico, ter um eletroposto, ou ser parceiro de recarga',
    cotas: 'Quer comprar cotas de uma usina',
    arrendamento: 'Tem terreno ou área e quer arrendar para usina solar',
    comercializadora: 'Dono de usina ou de projeto de geração que quer fornecer energia para a B2W',
    vagas: 'Quer ceder vagas de estacionamento para eletroposto',
    nenhuma: 'Não é sobre nenhum produto da B2W',
}
const NOME_CATEGORIA: Record<string, string> = {
    energia_assinatura: 'Energia por Assinatura',
    usina_investimento: 'Usinas de Investimento',
    eletropostos: 'Eletropostos',
    cotas: 'Cotas',
    arrendamento: 'Áreas de Arrendamento',
    comercializadora: 'Gestora ou Comercializadora',
    vagas: 'Locação de Vagas',
}
const FAIXA_LEGIVEL: Record<string, string> = {
    gelado: 'Gelado', frio: 'Frio', morno: 'Morno', quente: 'Quente', fechando: 'Fechando',
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

/** Primeira letra maiúscula, o resto como veio; sem ponto final. */
function frase(t: string): string {
    const s = t.trim().replace(/[.\s]+$/, '')
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** "Fulano de Tal" a partir de nome do lead ou do contato; ignora telefone usado como nome. */
function nomeLegivel(...cands: (string | null | undefined)[]): string {
    for (const c of cands) {
        const t = (c ?? '').trim()
        if (t && !/^\+?\d[\d\s()-]{6,}$/.test(t)) return t
    }
    return 'não informado'
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
        return { ok: true as const, answers: corpo.answers, usage: corpo.usage ?? null, model: corpo.model ?? cfg.model }
    } catch {
        return { ok: false as const, erro: 'jev_indisponivel' }
    } finally {
        clearTimeout(relogio)
    }
}

function perguntas(entrada: boolean): Record<string, unknown> {
    const q: Record<string, unknown> = {}
    for (const [k, d] of Object.entries(DUVIDAS)) {
        q[`duvida_${k}`] = {
            type: 'choice',
            instructions: `O CLIENTE perguntou ou demonstrou dúvida sobre: ${d.descricao}? Se perguntou, a B2W respondeu de forma clara?`,
            criteria: {
                nao: 'O cliente não perguntou sobre isso',
                respondida: 'Perguntou e a B2W respondeu de forma clara e completa',
                sem_resposta: 'Perguntou e ficou sem resposta clara, ou a B2W disse que a equipe ou um consultor ia responder',
            },
        }
    }
    for (const [k, d] of Object.entries(OBJECOES)) {
        q[`objecao_${k}`] = {
            type: 'noul',
            instructions: `O CLIENTE levantou esta objeção ou resistência: ${d.descricao}?`,
            criteria: { true: 'Sim, ele disse isso', false: 'Não disse' },
        }
    }
    if (entrada) {
        q.categoria = {
            type: 'choice',
            instructions: 'Sobre qual linha de negócio da B2W o cliente está falando?',
            criteria: DESCRICAO_CATEGORIA,
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
    const passagemId = typeof corpo?.passagem_id === 'string' ? corpo.passagem_id : null
    const limite = Math.max(1, Math.min(Number(corpo?.limite) || 10, 50))

    const cfg = await lerConfigJev(supabase)
    if (!cfg) return json(200, { ok: false, motivo: 'jev_nao_configurado' })

    const { data: fila, error } = await supabase.rpc('ponte_deskcomm_passagens_para_resumir', {
        p_limite: limite, p_passagem: passagemId,
    })
    if (error) return json(500, { error: 'fila_ilegivel', detalhe: error.message })

    const itens: unknown[] = []
    for (const p of (fila ?? []) as any[]) {
        // A conversa até a hora da passagem (com folga de 2 min para a última fala).
        const ate = new Date(new Date(p.criado_em).getTime() + 120000).toISOString()
        const { data: msgs } = await supabase
            .from('messages')
            .select('direction, body, media_derived_text, created_at')
            .eq('organization_id', p.organization_id)
            .eq('contact_id', p.contact_id)
            .is('revoked_at', null)
            .lte('created_at', ate)
            .order('created_at', { ascending: false })
            .limit(JANELA_MENSAGENS)

        const linhas = (msgs ?? []).reverse()
            .map((m: any) => {
                const texto = (m.body || m.media_derived_text || '').trim()
                if (!texto) return null
                return `${m.direction === 'inbound' ? 'Cliente' : 'B2W'}: ${mascarar(texto).slice(0, 600)}`
            })
            .filter(Boolean)

        let duvidas: string[] = []
        let semResposta: string[] = []
        let objecoes: string[] = []
        let categoriaJev: string | null = null
        let jevInfo: Record<string, unknown> = {}

        if (linhas.length > 0) {
            const estado =
                `Produto do funil: ${p.categoria_nome ?? 'não definido'}.\n` +
                `Conversa de WhatsApp entre o cliente e a B2W Energia (mais antiga primeiro):\n${linhas.join('\n')}`
            const r = await perguntarAoJev(cfg, estado, perguntas(p.entrada === true))
            if (!r.ok) {
                if (!ensaio) await supabase.rpc('ponte_deskcomm_falha_resumo_passagem', { p_passagem: p.passagem_id, p_erro: r.erro })
                itens.push({ passagem_id: p.passagem_id, erro: r.erro })
                if (/jev_http_(401|402|403)/.test(r.erro)) break
                continue
            }
            for (const k of Object.keys(DUVIDAS)) {
                const escolha = r.answers[`duvida_${k}`]?.choice
                if (escolha === 'respondida' || escolha === 'sem_resposta') duvidas.push(DUVIDAS[k].rotulo)
                if (escolha === 'sem_resposta') semResposta.push(DUVIDAS[k].rotulo)
            }
            for (const k of Object.keys(OBJECOES)) {
                const prob = Number(r.answers[`objecao_${k}`]?.noul)
                if (Number.isFinite(prob) && prob >= LIMIAR_OBJECAO) objecoes.push(OBJECOES[k].rotulo)
            }
            categoriaJev = r.answers.categoria?.choice ?? null
            jevInfo = { modelo: r.model, tokens_entrada: r.usage?.input_tokens ?? null }
        }

        const produto = p.entrada
            ? (categoriaJev && NOME_CATEGORIA[categoriaJev]) || 'Ainda não definido'
            : (p.categoria_nome ?? 'Ainda não definido')
        const pedido = (p.title ?? '').trim().replace(/^"[^"]*"\s*[—-]\s*/, '')
        const interesse = pedido ? `${produto} · ${frase(pedido).slice(0, 180)}` : produto
        const nome = nomeLegivel(p.lead_nome, p.contato_nome)
        const cidade = p.cidade ? `${p.cidade}${p.uf ? '/' + p.uf : ''}` : 'não informada'
        const nada = (l: string[]) => (l.length ? l.join(', ') : 'nenhuma')

        const linhasResumo = [
            `Nome: ${nome}`,
            `Cidade: ${cidade}`,
            `Interesse: ${interesse}`,
            `Principais dúvidas: ${nada(duvidas)}`,
            `Dúvidas não respondidas: ${nada(semResposta)}`,
            `Objeções: ${nada(objecoes)}`,
        ]
        if (p.temperatura && FAIXA_LEGIVEL[p.temperatura]) linhasResumo.push(`Temperatura: ${FAIXA_LEGIVEL[p.temperatura]}`)
        const resumo = linhasResumo.join('\n')
        const titulo = `${nome} · ${produto}`

        if (ensaio) {
            itens.push({ passagem_id: p.passagem_id, resumo, titulo })
            continue
        }

        const { data: gravou, error: errGravar } = await supabase.rpc('ponte_deskcomm_gravar_resumo_passagem', {
            p_passagem: p.passagem_id,
            p_resumo: resumo,
            p_titulo: titulo,
            p_dados: {
                b2w_lead_id: p.b2w_lead_id, produto, duvidas, duvidas_sem_resposta: semResposta,
                objecoes, categoria_jev: categoriaJev, mensagens_lidas: linhas.length, ...jevInfo,
            },
        })
        if (errGravar) {
            await supabase.rpc('ponte_deskcomm_falha_resumo_passagem', { p_passagem: p.passagem_id, p_erro: errGravar.message })
            itens.push({ passagem_id: p.passagem_id, erro: errGravar.message })
            continue
        }
        itens.push({ passagem_id: p.passagem_id, ...(gravou as object) })
    }

    return json(200, { ok: true, ensaio, processadas: itens.length, itens })
})
