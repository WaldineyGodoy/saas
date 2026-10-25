import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import {
    hashTexto, lerFaq, montarUsinasAVenda, montarCoberturaAssinatura, montarUsinasCotas, montarEntradas, montarGestoraPlanos,
    type UsinaAVenda, type CoberturaAssinatura, type UsinaCotas, type AnuncioEntrada, type PlanoGestora,
} from './montar.ts'
import { FAQ_INVESTIDOR } from './bases/investidor-faq.ts'
import { FAQ_ASSINATURA } from './bases/assinatura-faq.ts'
import { FAQ_COTAS } from './bases/cotas-faq.ts'
import { FAQ_RECEPCAO } from './bases/recepcao-faq.ts'
import { FAQ_GESTORA } from './bases/gestora-faq.ts'

/**
 * Bases de conhecimento dos agentes Investidor, Assinatura e Cotas no DeskcommCRM
 * (specs docs/superpowers/specs/2026-10-19-base-agente-investidor-design.md §5.3,
 * 2026-10-20-base-agente-assinatura-design.md §6 e 2026-10-20-base-agente-cotas-design.md §5.2).
 *
 * Mantem dez fontes do Deskcomm, cada uma ligada ao agente da sua categoria:
 *   - "Investidor — Perguntas e respostas" (faq): texto de bases/investidor-faq.ts.
 *   - "Usinas à venda" (documento): gerado das usinas com a_venda = true.
 *   - "Assinatura — Perguntas e respostas" (faq): texto de bases/assinatura-faq.ts.
 *   - "Assinatura: cobertura, desconto e indicação" (documento): gerado por
 *     ponte_deskcomm_assinatura_cobertura (desconto do plano vigente, tarifa,
 *     credito de indicacao).
 *   - "Cotas — Perguntas e respostas" (faq): texto de bases/cotas-faq.ts.
 *   - "Usinas com cotas" (documento): gerado por ponte_deskcomm_usinas_cotas
 *     (usinas a venda em cotas com cota livre; preco da cota e cotas livres).
 *   - "Recepção — Perguntas e respostas" (faq): texto de bases/recepcao-faq.ts (Bel).
 *   - "Recepção: entradas" (documento): gerado de ponte_deskcomm.anuncios por
 *     ponte_deskcomm_anuncios_entradas (spec 2026-10-24-base-bel-recepcao-design.md §5).
 *   - "Gestora — Perguntas e respostas" (faq): texto de bases/gestora-faq.ts (Helena).
 *   - "Gestora: planos vigentes" (documento): gerado de planos_usina ativos por
 *     ponte_deskcomm_gestora_planos (spec 2026-10-25-base-helena-gestora-design.md §5).
 * Mudar um FAQ = editar o arquivo e publicar esta funcao de novo.
 *
 * Por que grava direto nas tabelas do Deskcomm: cadastrar material la exige
 * sessao de gerente na tela (nao ha token como o do MCP). Esta funcao repete o
 * que fazem app/api/v1/ai/knowledge/sources/route.ts e .../[id]/reindex/route.ts
 * do Deskcomm 1.86.0: arquivo .md no bucket ai-policy, source_metadata.blob_path
 * e o evento knowledge_source.updated, que o workers/rag-indexer.ts escuta.
 *
 * Duas regras do indexador que moldam o codigo:
 *   - NAO gravar content_hash na fonte: quem grava e o indexador, e ele pula a
 *     fonte quando o hash bate.
 *   - Dois eventos da mesma fonte dentro do debounce viram um so. Por isso, com
 *     hash igual, o evento e reenviado se a ultima indexacao for anterior ao
 *     ultimo envio (o cron de hora em hora garante a repeticao).
 *
 * Antes de gravar, ponte_deskcomm_contrato_base confere colunas, bucket e
 * emit_event. Se uma atualizacao do Deskcomm mudou algo, nada e gravado e a
 * base anterior continua valendo.
 *
 * Quem chama e o banco (gatilhos em usinas, planos e tarifa, e cron), com o token do Vault em
 * x-ponte-token, conferido pelo banco, como na deskcomm-ponte.
 * Corpo {"ensaio": true} devolve os textos sem gravar.
 */

const BUCKET = 'ai-policy'

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Supa = ReturnType<typeof createClient>

interface Conteudo {
    chave: 'investidor_faq' | 'usinas_a_venda' | 'assinatura_faq' | 'assinatura_cobertura' | 'cotas_faq' | 'usinas_cotas'
        | 'recepcao_faq' | 'recepcao_entradas' | 'gestora_faq' | 'gestora_planos'
    categoria: 'usina_investimento' | 'energia_assinatura' | 'cotas' | 'triagem' | 'comercializadora'
    tipo: 'faq' | 'documento'
    nome: string
    texto: string
    pares?: { question: string; answer: string }[]
}

interface Registro {
    chave: string
    knowledge_source_id: string | null
    ultimo_hash: string | null
    sincronizado_em: string | null
}

interface Fonte {
    id: string
    is_active: boolean
    source_metadata: Record<string, unknown> | null
    last_indexed_at: string | null
    last_index_status: string | null
}

const COLUNAS_FONTE = 'id, is_active, source_metadata, last_indexed_at, last_index_status'

async function montarConteudos(supabase: Supa): Promise<Conteudo[]> {
    const paresInv = lerFaq(FAQ_INVESTIDOR)
    const paresAss = lerFaq(FAQ_ASSINATURA)
    const paresCot = lerFaq(FAQ_COTAS)
    const paresRec = lerFaq(FAQ_RECEPCAO)
    const paresGes = lerFaq(FAQ_GESTORA)
    if (paresInv.length === 0 || paresAss.length === 0 || paresCot.length === 0 || paresRec.length === 0 || paresGes.length === 0) throw new Error('faq_vazio')

    const { data: usinas, error } = await supabase.rpc('ponte_deskcomm_usinas_a_venda')
    if (error) throw new Error(`usinas_ilegiveis: ${error.message}`)
    const { data: cobertura, error: cobErr } = await supabase.rpc('ponte_deskcomm_assinatura_cobertura')
    if (cobErr) throw new Error(`cobertura_ilegivel: ${cobErr.message}`)
    const { data: cotas, error: cotErr } = await supabase.rpc('ponte_deskcomm_usinas_cotas')
    if (cotErr) throw new Error(`cotas_ilegiveis: ${cotErr.message}`)
    const { data: entradas, error: entErr } = await supabase.rpc('ponte_deskcomm_anuncios_entradas')
    if (entErr) throw new Error(`entradas_ilegiveis: ${entErr.message}`)
    const { data: planosGes, error: gesErr } = await supabase.rpc('ponte_deskcomm_gestora_planos')
    if (gesErr) throw new Error(`planos_gestora_ilegiveis: ${gesErr.message}`)

    return [
        { chave: 'investidor_faq', categoria: 'usina_investimento', tipo: 'faq', nome: 'Investidor — Perguntas e respostas', texto: JSON.stringify(paresInv), pares: paresInv },
        { chave: 'usinas_a_venda', categoria: 'usina_investimento', tipo: 'documento', nome: 'Usinas à venda', texto: montarUsinasAVenda((usinas ?? []) as UsinaAVenda[]) },
        { chave: 'assinatura_faq', categoria: 'energia_assinatura', tipo: 'faq', nome: 'Assinatura — Perguntas e respostas', texto: JSON.stringify(paresAss), pares: paresAss },
        { chave: 'assinatura_cobertura', categoria: 'energia_assinatura', tipo: 'documento', nome: 'Assinatura: cobertura, desconto e indicação', texto: montarCoberturaAssinatura((cobertura ?? []) as CoberturaAssinatura[]) },
        { chave: 'cotas_faq', categoria: 'cotas', tipo: 'faq', nome: 'Cotas — Perguntas e respostas', texto: JSON.stringify(paresCot), pares: paresCot },
        { chave: 'usinas_cotas', categoria: 'cotas', tipo: 'documento', nome: 'Usinas com cotas', texto: montarUsinasCotas((cotas ?? []) as UsinaCotas[]) },
        { chave: 'recepcao_faq', categoria: 'triagem', tipo: 'faq', nome: 'Recepção — Perguntas e respostas', texto: JSON.stringify(paresRec), pares: paresRec },
        { chave: 'recepcao_entradas', categoria: 'triagem', tipo: 'documento', nome: 'Recepção: entradas', texto: montarEntradas((entradas ?? []) as AnuncioEntrada[]) },
        { chave: 'gestora_faq', categoria: 'comercializadora', tipo: 'faq', nome: 'Gestora — Perguntas e respostas', texto: JSON.stringify(paresGes), pares: paresGes },
        { chave: 'gestora_planos', categoria: 'comercializadora', tipo: 'documento', nome: 'Gestora: planos vigentes', texto: montarGestoraPlanos((planosGes ?? []) as PlanoGestora[]) },
    ]
}

/** A fonte registrada; se sumiu ou foi arquivada, a ativa com o mesmo nome; senao, null. */
async function acharFonte(supabase: Supa, org: string, reg: Registro, nome: string): Promise<Fonte | null> {
    if (reg.knowledge_source_id) {
        const { data } = await supabase.from('ai_knowledge_sources').select(COLUNAS_FONTE)
            .eq('organization_id', org).eq('id', reg.knowledge_source_id).maybeSingle()
        if (data?.is_active) return data as Fonte
    }
    const { data } = await supabase.from('ai_knowledge_sources').select(COLUNAS_FONTE)
        .eq('organization_id', org).eq('is_active', true).eq('name', nome).maybeSingle()
    return (data as Fonte) ?? null
}

async function gravarDocumento(supabase: Supa, org: string, c: Conteudo, hash: string, metaAtual: Record<string, unknown>) {
    const caminho = `${org}/base-${c.chave.replace(/_/g, '-')}-${hash.slice(0, 16)}.md`
    const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(caminho, new Blob([c.texto], { type: 'text/markdown' }), { contentType: 'text/markdown', upsert: true })
    if (upErr) throw new Error(`upload: ${upErr.message}`)
    return {
        caminho,
        anterior: typeof metaAtual.blob_path === 'string' ? metaAtual.blob_path : null,
        metadata: { ...metaAtual, blob_path: caminho, ext: 'md', filename: `${c.chave.replace(/_/g, '-')}.md`, origem: 'ponte_deskcomm' },
    }
}

async function sincronizar(supabase: Supa, org: string, agente: string, c: Conteudo, reg: Registro) {
    const hash = await hashTexto(c.texto)
    let fonte = await acharFonte(supabase, org, reg, c.nome)
    const nova = !fonte

    if (!fonte) {
        // Documento nasce ja apontando para o arquivo, como na rota do Deskcomm.
        const doc = c.tipo === 'documento' ? await gravarDocumento(supabase, org, c, hash, {}) : null
        const { data, error } = await supabase.from('ai_knowledge_sources').insert({
            organization_id: org,
            agent_id: agente,
            source_type: c.tipo,
            name: c.nome,
            status: 'ready',
            is_active: true,
            source_metadata: doc?.metadata ?? { origem: 'ponte_deskcomm' },
            ingested_at: new Date().toISOString(),
        }).select(COLUNAS_FONTE).single()
        if (error || !data) throw new Error(`criar_fonte: ${error?.message}`)
        fonte = data as Fonte
    }

    const mudou = nova || hash !== reg.ultimo_hash || fonte.id !== reg.knowledge_source_id
    if (mudou) {
        if (c.tipo === 'faq') {
            const { error } = await supabase.rpc('ponte_deskcomm_faq_trocar', { p_org: org, p_source_id: fonte.id, p_itens: c.pares })
            if (error) throw new Error(`faq_trocar: ${error.message}`)
        } else if (!nova) {
            const doc = await gravarDocumento(supabase, org, c, hash, fonte.source_metadata ?? {})
            const { error } = await supabase.from('ai_knowledge_sources')
                .update({ source_metadata: doc.metadata, ingested_at: new Date().toISOString(), last_index_error: null })
                .eq('organization_id', org).eq('id', fonte.id)
            if (error) throw new Error(`trocar_arquivo: ${error.message}`)
            // So apaga o anterior depois da troca, e so arquivo que esta funcao criou.
            if (doc.anterior && doc.anterior !== doc.caminho && doc.anterior.startsWith(`${org}/base-`)) {
                await supabase.storage.from(BUCKET).remove([doc.anterior])
            }
        }
    }

    const indexouDepois = fonte.last_index_status === 'success' && fonte.last_indexed_at && reg.sincronizado_em
        && new Date(fonte.last_indexed_at) >= new Date(reg.sincronizado_em)
    const emitir = mudou || !indexouDepois
    if (emitir) {
        const { error } = await supabase.rpc('ponte_deskcomm_emitir_fonte', {
            p_org: org, p_source_id: fonte.id, p_agent_id: agente, p_tipo: c.tipo,
        })
        if (error) throw new Error(`emitir: ${error.message}`)
    }
    if (mudou) {
        const { error } = await supabase.rpc('ponte_deskcomm_fonte_base_marcar', { p_chave: c.chave, p_source_id: fonte.id, p_hash: hash })
        if (error) throw new Error(`marcar: ${error.message}`)
    }

    // Fonte recriada fica fora da versao publicada do agente ate uma nova versao
    // (scripts/deskcomm/base_*.sql leem os ids de fontes_base).
    if (reg.knowledge_source_id && fonte.id !== reg.knowledge_source_id) {
        const script = c.categoria === 'energia_assinatura' ? 'base_assinatura.sql'
            : c.categoria === 'cotas' ? 'base_cotas.sql'
            : c.categoria === 'triagem' ? 'base_bel.sql'
            : c.categoria === 'comercializadora' ? 'base_helena.sql' : 'base_investidor.sql'
        await supabase.rpc('ponte_deskcomm_erro_base', {
            p_onde: 'deskcomm-base', p_mensagem: `fonte ${c.chave} recriada (${fonte.id}): rode scripts/deskcomm/${script}`,
        })
    }
    return { chave: c.chave, fonte: fonte.id, criada: nova, gravou: mudou, emitiu: emitir }
}

serve(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: confere } = await supabase.rpc('ponte_deskcomm_token_confere', {
        p_token: req.headers.get('x-ponte-token') ?? '',
    })
    if (confere !== true) return json(401, { error: 'token_invalido' })

    const corpo = await req.json().catch(() => ({}))
    const erro = async (mensagem: string) => {
        await supabase.rpc('ponte_deskcomm_erro_base', { p_onde: 'deskcomm-base', p_mensagem: mensagem })
    }

    try {
        const conteudos = await montarConteudos(supabase)
        if (corpo?.ensaio === true) {
            return json(200, {
                ok: true, ensaio: true,
                conteudos: await Promise.all(conteudos.map(async (c) => ({
                    chave: c.chave, tipo: c.tipo, nome: c.nome, hash: await hashTexto(c.texto),
                    pares: c.pares?.length, texto: c.tipo === 'documento' ? c.texto : undefined,
                }))),
            })
        }

        const { data: falta, error: contratoErr } = await supabase.rpc('ponte_deskcomm_contrato_base')
        if (contratoErr) throw new Error(`contrato: ${contratoErr.message}`)
        if ((falta as string[] | null)?.length) {
            await erro(`contrato do Deskcomm mudou; nada gravado: ${(falta as string[]).join(', ')}`)
            return json(200, { ok: false, motivo: 'contrato_deskcomm_mudou', falta })
        }

        const alvos = new Map<string, { org: string; agente: string }>()
        for (const cat of new Set(conteudos.map((c) => c.categoria))) {
            const { data: alvo } = await supabase.rpc('ponte_deskcomm_agente_da_categoria', { p_slug: cat })
            const org = (alvo as any[] | null)?.[0]?.organization_id as string | undefined
            const agente = (alvo as any[] | null)?.[0]?.agent_id as string | undefined
            if (org && agente) alvos.set(cat, { org, agente })
            else await erro(`agente da categoria ${cat} não encontrado`)
        }

        const { data: registros, error: regErr } = await supabase.rpc('ponte_deskcomm_fontes_base')
        if (regErr) throw new Error(`fontes_base: ${regErr.message}`)
        const porChave = new Map(((registros ?? []) as Registro[]).map((r) => [r.chave, r]))

        const resultado = []
        for (const c of conteudos) {
            const alvo = alvos.get(c.categoria)
            if (!alvo) {
                resultado.push({ chave: c.chave, erro: 'agente_nao_encontrado' })
                continue
            }
            const reg = porChave.get(c.chave) ?? { chave: c.chave, knowledge_source_id: null, ultimo_hash: null, sincronizado_em: null }
            try {
                resultado.push(await sincronizar(supabase, alvo.org, alvo.agente, c, reg))
            } catch (e) {
                const msg = `${c.chave}: ${String((e as Error)?.message ?? e)}`
                await erro(msg)
                resultado.push({ chave: c.chave, erro: msg })
            }
        }
        return json(200, { ok: resultado.every((r: any) => !r.erro), resultado })
    } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        await erro(msg)
        return json(500, { ok: false, erro: msg })
    }
})
