import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { lerConta, type ContaCompleta } from '../_shared/leitura-conta.ts'
import { caminhoDocumento, validarArquivo } from '../_shared/onboarding-regras.ts'
import {
    errosDaConta, errosDeValidacao, parametrosAssinante, statusDaAdesao, cpfValido, emailValido, soDigitos, simNao,
} from './regras.ts'

/**
 * Adesão à Energia por Assinatura pelo WhatsApp
 * (spec docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md §5.2).
 *
 * Chamada pelos gatilhos da ponte (fn_adesao_midia, fn_adesao_card) com o
 * token do Vault em x-ponte-token. Estado em ponte_deskcomm.adesoes; a Bia lê
 * por b2w_status_adesao. Nada aqui fala com o cliente.
 *
 *   conta     lê a foto/PDF da conta (bucket whatsapp-media do Deskcomm)
 *   documento confere tipo e tamanho do documento
 *   validar   CPF, e-mail, titular
 *   criar     cria o assinante, copia os documentos e gera o contrato (sem WhatsApp)
 */

const MIDIA = 'whatsapp-media'
const DOCUMENTOS = 'documentos-assinante'
const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function base64(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
}

serve(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: confere } = await db.rpc('ponte_deskcomm_token_confere', { p_token: req.headers.get('x-ponte-token') ?? '' })
    if (confere !== true) return json(401, { error: 'token_invalido' })

    const corpo = await req.json().catch(() => ({}))
    const acao = String(corpo?.acao ?? '')
    const card = String(corpo?.card_id ?? '')
    const salvar = async (patch: Record<string, unknown>) => {
        const { error } = await db.rpc('ponte_deskcomm_adesao_salvar', { p_card: card, p_patch: patch })
        if (error) throw new Error(`salvar: ${error.message}`)
    }
    const erroPonte = (msg: string) =>
        db.rpc('ponte_deskcomm_erro_base', { p_onde: 'adesao-whatsapp', p_mensagem: `${acao} ${card}: ${msg}` })

    try {
        const { data: d, error } = await db.rpc('ponte_deskcomm_adesao_dados', { p_card: card })
        if (error || !d) return json(404, { error: 'card_nao_encontrado' })
        const campos = d.campos ?? {}
        const adesao = d.adesao ?? {}
        const erros = (adesao.erros ?? {}) as Record<string, string[]>
        const todos = () => Object.values(erros).flat()

        if (acao === 'conta') {
            const m = d.conta_midia
            if (!m?.path) return json(400, { error: 'sem_midia' })
            const { data: arq, error: dlErr } = await db.storage.from(MIDIA).download(m.path)
            if (dlErr || !arq) throw new Error(`download: ${dlErr?.message}`)
            const r = await lerConta(base64(new Uint8Array(await arq.arrayBuffer())), m.mime,
                { apiKey: Deno.env.get('OPENROUTER_API_KEY')!, modelo: Deno.env.get('OPENROUTER_MODEL')! })
            if (!r.ok) {
                erros.conta = ['conta_ilegivel']
                await salvar({ erros_conta: erros.conta, status: statusDaAdesao(todos(), false) })
                return json(200, { ok: true, status: 'coletando', erros: erros.conta })
            }
            const c = r.dados
            const { data: sim } = await db.rpc('b2w_mcp_simular_assinatura', {
                p_cidade: c.endereco?.cidade ?? '', p_uf: c.endereco?.uf ?? '', p_consumo_kwh: c.mediaKwh || null,
                p_valor_reais: null, p_telefone: null,
            })
            erros.conta = errosDaConta(c, sim ? { atende: !!sim.atende, atinge_minimo: sim.atinge_minimo ?? null } : null)
            const status = statusDaAdesao(todos(), false)
            await salvar({ conta_lida: c, erros_conta: erros.conta, status })
            return json(200, { ok: true, status, erros: erros.conta })
        }

        if (acao === 'documento') {
            const m = d.documento_midia
            const erro = m?.path ? validarArquivo({ mime: m.mime, tamanho: Number(m.tamanho) }) : 'sem arquivo'
            erros.documento = erro ? ['documento_invalido'] : []
            await salvar({ erros_documento: erros.documento })
            return json(200, { ok: true, erros: erros.documento })
        }

        // Valida CPF, e-mail e titular a partir do card como está agora.
        const revalidar = async () => {
            const cpf = soDigitos(campos.adesao_cpf)
            let existe = false
            if (cpfValido(cpf)) {
                const { data } = await db.rpc('ponte_deskcomm_cpf_existe', { p_cpf: cpf })
                existe = data === true
            }
            erros.validacao = errosDeValidacao({ ...campos, adesao_titular_ok: simNao(campos.adesao_titular_ok) }, adesao.conta_lida as ContaCompleta | null, existe)
            const status = statusDaAdesao(todos(), !!adesao.signature_link)
            await salvar({ erros_validacao: erros.validacao, status })
            return status
        }

        if (acao === 'validar') {
            const status = await revalidar()
            return json(200, { ok: true, status, erros: erros.validacao })
        }

        if (acao === 'criar') {
            const conta = adesao.conta_lida as ContaCompleta | null
            // Revalida aqui: a validação disparada pela mesma gravação pode não ter
            // terminado, e o card pode ter mudado o CPF e a etapa de uma vez só.
            await revalidar()
            const faltam = [
                !conta && 'conta', !d.documento_midia?.path && 'documento',
                !cpfValido(campos.adesao_cpf ?? '') && 'cpf', !emailValido(campos.adesao_email ?? '') && 'email',
            ].filter(Boolean)
            if (faltam.length || todos().length) {
                return json(409, { ok: false, faltam, erros: todos() })
            }
            if (corpo?.ensaio === true) {
                return json(200, { ok: true, ensaio: true, parametros: parametrosAssinante({
                    conta: conta!, cpf: campos.adesao_cpf, email: campos.adesao_email,
                    telefone: campos.adesao_telefone || d.telefone, ibge: null,
                    leadId: d.b2w_lead_id, originatorId: d.originator_id, indicadorId: d.indicador_id }) })
            }
            await salvar({ status: 'criando' })
            let sub = adesao.subscriber_id as string | null
            let token = adesao.onboarding_token as string | null
            if (!sub) {
                const { data: ibge } = await db.rpc('ponte_deskcomm_ibge', { p_cidade: conta!.endereco?.cidade ?? '', p_uf: conta!.endereco?.uf ?? '' })
                const params = parametrosAssinante({
                    conta: conta!, cpf: campos.adesao_cpf, email: campos.adesao_email,
                    telefone: campos.adesao_telefone || d.telefone, ibge: ibge ?? null,
                    leadId: d.b2w_lead_id, originatorId: d.originator_id, indicadorId: d.indicador_id,
                })
                const { data: criado, error: cErr } = await db.rpc('fn_criar_assinante_publico', params)
                if (cErr || !criado?.subscriber_id) throw new Error(`criar_assinante: ${cErr?.message ?? 'sem id'}`)
                sub = criado.subscriber_id
                token = criado.onboarding_token
                await salvar({ subscriber_id: sub, onboarding_token: token })
            }
            if (!adesao.documentos_copiados) {
                const { data: uc } = await db.from('consumer_units').select('id').eq('subscriber_id', sub).limit(1).maybeSingle()
                for (const [tipo, m, ucId] of [
                    ['conta_energia', d.conta_midia, uc?.id ?? null],
                    ['identidade', d.documento_midia, null],
                ] as const) {
                    const { data: arq, error: dlErr } = await db.storage.from(MIDIA).download(m.path)
                    if (dlErr || !arq) throw new Error(`download ${tipo}: ${dlErr?.message}`)
                    const path = caminhoDocumento(sub!, tipo, crypto.randomUUID(), m.mime)
                    const { error: upErr } = await db.storage.from(DOCUMENTOS).upload(path, arq, { contentType: m.mime })
                    if (upErr) throw new Error(`upload ${tipo}: ${upErr.message}`)
                    const { error: insErr } = await db.from('subscriber_documents').insert({
                        subscriber_id: sub, consumer_unit_id: ucId, tipo, storage_path: path, mime: m.mime, tamanho: Number(m.tamanho),
                    })
                    if (insErr) throw new Error(`registrar ${tipo}: ${insErr.message}`)
                }
                await salvar({ documentos_copiados: true })
            }
            const { data: fin, error: fErr } = await db.functions.invoke('onboarding-finalizar', {
                body: { token, gerar_no_servidor: true, sem_whatsapp: true },
            })
            if (fErr || !fin?.signature_link) throw new Error(`contrato: ${fErr?.message ?? JSON.stringify(fin)}`)
            await salvar({ signature_link: fin.signature_link, status: 'contrato_pronto', erros_criacao: [] })
            return json(200, { ok: true, status: 'contrato_pronto' })
        }

        return json(400, { error: 'acao_invalida' })
    } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        await erroPonte(msg)
        if (acao === 'criar') await salvar({ status: 'pendencia', erros_criacao: ['falha_criacao'] }).catch(() => {})
        return json(500, { ok: false, erro: 'falha' })
    }
})
