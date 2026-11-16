import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import {
  soDigitos, cpfValido, interpretarResposta, respostaParaCliente, origemDoPapel,
  lerLimites, ipDoRequest, hashearIp, urlDaConsulta, mensagemDoMotivo,
} from '../_shared/consulta-cpf.ts'

// Consulta de CPF na CPFHub: devolve nome e data de nascimento.
//
// Chamada pelo navegador (CRM e adesao publica), entao a chave da CPFHub vive
// SO aqui, em integrations_config (legivel apenas por admin). Cada consulta
// paga custa 1 credito, e a funcao e alcancavel com a chave anon do projeto:
// por isso a ordem abaixo e a regra, nao detalhe.
//
//   1. CPF invalido nunca chega a API (nem a reserva de limite).
//   2. Cache primeiro: o mesmo CPF nao e pago duas vezes.
//   3. Reserva do limite ANTES de chamar a API (atomica, no banco).
//   4. Uma unica chamada. Timeout nao se repete: a CPFHub pode ter cobrado.
//   5. Quem nao e da equipe nunca recebe a data de nascimento.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const BASE_PADRAO = 'https://api.cpfhub.io'
const TIMEOUT_MS = 10_000
const ESPERAS_5XX_MS = [1000, 2000]   // so 5xx repete (nao cobra); no maximo 3 tentativas

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, motivo: 'indisponivel', mensagem: mensagemDoMotivo('indisponivel') }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  try {
    const corpo = await req.json().catch(() => ({}))
    const cpf = soDigitos(corpo?.cpf)

    // 1. Validacao interna: CPF errado nao consome nada.
    if (!cpfValido(cpf)) {
      return json(respostaParaCliente({ tipo: 'cpf_invalido' }, 'publico', false))
    }

    // Quem e: equipe (papel interno) ou publico. A chave anon e um JWT valido
    // mas nao tem usuario -- getUser falha e cai em "publico".
    let papel: string | null = null
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (token) {
      const { data: { user } } = await db.auth.getUser(token)
      if (user) {
        const { data: perfil } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
        papel = perfil?.role ?? null
      }
    }
    const origem = origemDoPapel(papel)

    const { data: cfg } = await db.from('integrations_config')
      .select('api_key, endpoint_url, variables').eq('service_name', 'cpfhub').maybeSingle()
    const limites = lerLimites(cfg?.variables as Record<string, unknown> | null)

    if (origem === 'publico' && !limites.publicoAtivo) {
      return json(respostaParaCliente({ tipo: 'limite_publico' }, origem, false))
    }

    // 2. Cache.
    const desde = new Date(Date.now() - limites.validadeCacheDias * 86_400_000).toISOString()
    const { data: emCache } = await db.from('cpf_consultas')
      .select('nome, data_nascimento').eq('cpf', cpf).gt('consultado_em', desde).maybeSingle()

    const chave = (cfg?.api_key as string | undefined)?.trim()
    if (!emCache && !chave) {
      // Sem chave configurada e sem cache: nada a fazer, e nada foi gasto.
      console.error('consulta-cpf: chave da CPFHub nao configurada (Configuracoes > Consulta de CPF)')
      return json(respostaParaCliente({ tipo: 'nao_configurado' }, origem, false))
    }

    // 3. Reserva do limite (atomica no banco). IP so em hash.
    const sal = Deno.env.get('CPF_IP_SALT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'b2w'
    const ipHash = await hashearIp(ipDoRequest(req.headers), sal)
    const { data: reserva, error: erroReserva } = await db.rpc('fn_cpf_reservar', {
      p_origem: origem, p_ip_hash: ipHash, p_usa_api: !emCache,
      p_limite_ip_hora: limites.limiteIpHora, p_limite_dia: limites.limitePublicoDia,
    })
    if (erroReserva) throw erroReserva
    if (!reserva?.ok) return json(respostaParaCliente({ tipo: 'limite_publico' }, origem, false))
    const idUso = reserva.id as number | null

    if (emCache) {
      await db.rpc('fn_cpf_registrar', { p_id: idUso, p_resultado: 'cache', p_creditos: 0 })
      return json(respostaParaCliente(
        { tipo: 'encontrado', cpf, nome: emCache.nome, nascimento: emCache.data_nascimento, creditos: 1 }, origem, true))
    }

    // 4. Uma chamada. Repete apenas em 5xx; timeout NAO repete.
    const base = ((cfg?.endpoint_url as string | undefined) || BASE_PADRAO)
    let status = 0
    let corpoApi: unknown = null
    let retryAfter: string | null = null
    for (let tentativa = 0; tentativa <= ESPERAS_5XX_MS.length; tentativa++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
      try {
        const r = await fetch(urlDaConsulta(base, cpf), { headers: { 'x-api-key': chave! }, signal: ctl.signal })
        status = r.status
        retryAfter = r.headers.get('Retry-After')
        corpoApi = await r.json().catch(() => null)
      } catch (e) {
        // Timeout ou queda de rede: a consulta pode ter sido concluida e
        // cobrada la. Nao repete e deixa a reserva como 'reservado', que
        // continua contando no teto diario (gasto presumido, nao zero).
        console.error('consulta-cpf: sem resposta da CPFHub:', (e as Error).name)
        return json(respostaParaCliente({ tipo: 'indisponivel' }, origem, false))
      } finally {
        clearTimeout(timer)
      }
      const parcial = interpretarResposta(status, corpoApi, retryAfter)
      if (parcial.tipo === 'indisponivel' && parcial.retentavel && tentativa < ESPERAS_5XX_MS.length) {
        await new Promise((ok) => setTimeout(ok, ESPERAS_5XX_MS[tentativa]))
        continue
      }
      break
    }

    const resultado = interpretarResposta(status, corpoApi, retryAfter)
    await db.rpc('fn_cpf_registrar', { p_id: idUso, p_resultado: resultado.tipo, p_creditos: resultado.creditos })

    if (resultado.tipo === 'encontrado') {
      await db.from('cpf_consultas').upsert({
        cpf, nome: resultado.nome, data_nascimento: resultado.nascimento, consultado_em: new Date().toISOString(),
      })
    } else if (['sem_credito', 'chave_invalida', 'conta_bloqueada'].includes(resultado.tipo)) {
      // Problema da conta, nao do usuario: fica no log para o dono agir.
      console.error(`consulta-cpf: CPFHub recusou por ${resultado.tipo} (status ${status})`)
    }

    return json(respostaParaCliente(resultado, origem, false))
  } catch (e) {
    console.error('consulta-cpf:', (e as Error).message)
    return json({ ok: false, motivo: 'indisponivel', mensagem: mensagemDoMotivo('indisponivel') })
  }
})
