// Boleto da licenca anual do originador no Asaas (dono, 14/11/2026).
//
// POST { acao: 'gerar', originator_id, vencimento? }  -> cria (ou devolve o aberto)
// POST { acao: 'cancelar', cobranca_id }               -> cancela no Asaas e aqui
//
// Regras (migracao 20261114a):
//  - so gera com licenca COBRADA: preco do cargo no plano > 0 e valor (com o
//    desconto do voucher) > 0; isencao total nao gera boleto;
//  - adesao (nunca pagou ou vencida): vence em 3 dias (ou a data pedida);
//  - renovacao (licenca em dia): liberada nos 30 dias antes do fim e vence na
//    data da renovacao;
//  - um boleto em aberto por originador.
// A baixa vem pelo asaas-webhook -> fn_licenca_registrar_pagamento.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import { corsHeaders } from "../_shared/cors.ts"
import { requireInternoOuServidor } from "../_shared/auth.ts"

const JANELA_RENOVACAO_DIAS = 30
const PRAZO_ADESAO_DIAS = 3

const ROTULO_CARGO: Record<string, string> = {
  lider: 'Líder', ppe: 'Parceiro Power Embaixador', ppp: 'Parceiro Power Pro', ppf: 'Parceiro Power Free'
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const hojeSP = () => {
  // Data de hoje no fuso de Brasilia (o servidor roda em UTC).
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return p // YYYY-MM-DD
}

const somaDias = (iso: string, dias: number) => {
  const [a, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d + dias))
  return dt.toISOString().slice(0, 10)
}

const diasEntre = (de: string, ate: string) => {
  const [a1, m1, d1] = de.split('-').map(Number)
  const [a2, m2, d2] = ate.split('-').map(Number)
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000)
}

const dataBr = (iso: string) => iso.split('-').reverse().join('/')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const auth = await requireInternoOuServidor(req, supabase)
  if (!auth.ok) return json({ success: false, error: auth.error }, auth.status)

  try {
    const body = await req.json()
    const acao = body?.acao

    const { data: cfg, error: cfgErr } = await supabase
      .from('integrations_config')
      .select('api_key, endpoint_url, sandbox_api_key, sandbox_endpoint_url, environment')
      .eq('service_name', 'financial_api')
      .single()
    if (cfgErr || !cfg) throw new Error('Integração Asaas não configurada no painel.')
    const sandbox = cfg.environment === 'sandbox'
    const asaasKey = sandbox ? cfg.sandbox_api_key : cfg.api_key
    const asaasUrl = sandbox ? cfg.sandbox_endpoint_url : cfg.endpoint_url
    if (!asaasKey || !asaasUrl) throw new Error(`Configuração do Asaas (${sandbox ? 'sandbox' : 'produção'}) incompleta.`)

    const asaas = async (caminho: string, init: RequestInit = {}) => {
      const r = await fetch(`${asaasUrl}${caminho}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', access_token: asaasKey, ...(init.headers || {}) }
      })
      const texto = await r.text()
      let dados: any = {}
      try { dados = texto ? JSON.parse(texto) : {} } catch { dados = { bruto: texto } }
      if (!r.ok || dados.errors) {
        throw new Error(`Asaas: ${dados.errors?.[0]?.description || `status ${r.status}`}`)
      }
      return dados
    }

    // ------------------------------------------------------------ cancelar
    if (acao === 'cancelar') {
      const { data: c } = await supabase.from('originador_licenca_cobrancas').select('*').eq('id', body.cobranca_id).maybeSingle()
      if (!c) throw new Error('Boleto não encontrado.')
      if (c.status === 'pago') throw new Error('Boleto já pago não pode ser cancelado.')
      if (c.status === 'cancelado') return json({ success: true, cobranca: c })
      if (c.asaas_payment_id) await asaas(`/payments/${c.asaas_payment_id}`, { method: 'DELETE' })
      const { data: atualizada } = await supabase.from('originador_licenca_cobrancas')
        .update({ status: 'cancelado' }).eq('id', c.id).select().single()
      await supabase.from('crm_history').insert({
        entity_type: 'originator', entity_id: c.originator_id,
        content: `Boleto da licença cancelado (R$ ${Number(c.valor).toFixed(2).replace('.', ',')}).`,
        metadata: { cobranca_id: c.id, asaas_payment_id: c.asaas_payment_id },
        created_by: auth.userId === 'service_role' ? null : auth.userId
      })
      return json({ success: true, cobranca: atualizada })
    }

    if (acao !== 'gerar') throw new Error('Ação inválida (use gerar ou cancelar).')

    // ------------------------------------------------------------ gerar
    const { data: o, error: oErr } = await supabase
      .from('originators_v2')
      .select('id, name, email, phone, cpf_cnpj, address, cargo, plano_originador_id, licenca_preco, licenca_valor, licenca_status, licenca_paga_em, licenca_vencimento, licenca_voucher_id')
      .eq('id', body.originator_id)
      .maybeSingle()
    if (oErr) throw oErr
    if (!o) throw new Error('Originador não encontrado.')

    const preco = Number(o.licenca_preco || 0)
    const valor = Number(o.licenca_valor || 0)
    if (!(preco > 0)) throw new Error('O plano deste originador não cobra licença deste cargo. Defina o preço no Plano do Originador.')
    if (!(valor > 0)) throw new Error('O voucher isenta toda a licença: não há boleto a gerar.')

    // Boleto em aberto: devolve o mesmo (nunca dois).
    const { data: aberto } = await supabase.from('originador_licenca_cobrancas')
      .select('*').eq('originator_id', o.id).in('status', ['pendente', 'vencido']).maybeSingle()
    if (aberto) {
      if (Number(aberto.valor) !== valor || aberto.cargo !== o.cargo) {
        throw new Error('Já existe um boleto em aberto com outro valor ou cargo. Cancele-o antes de gerar outro.')
      }
      return json({ success: true, cobranca: aberto, existente: true })
    }

    const hoje = hojeSP()
    const emDia = !!o.licenca_paga_em && !!o.licenca_vencimento && o.licenca_vencimento >= hoje
    const tipo = emDia ? 'renovacao' : 'adesao'
    let vencimento: string
    if (emDia) {
      const faltam = diasEntre(hoje, o.licenca_vencimento)
      if (faltam > JANELA_RENOVACAO_DIAS) {
        throw new Error(`Licença em dia até ${dataBr(o.licenca_vencimento)}. A renovação é liberada ${JANELA_RENOVACAO_DIAS} dias antes.`)
      }
      vencimento = faltam >= 1 ? o.licenca_vencimento : somaDias(hoje, PRAZO_ADESAO_DIAS)
    } else {
      vencimento = somaDias(hoje, PRAZO_ADESAO_DIAS)
    }
    if (body.vencimento && /^\d{4}-\d{2}-\d{2}$/.test(body.vencimento)) {
      if (body.vencimento < hoje) throw new Error('O vencimento do boleto não pode ser no passado.')
      if (emDia && body.vencimento > o.licenca_vencimento) throw new Error('Na renovação, o boleto vence até a data da renovação.')
      vencimento = body.vencimento
    }

    // Cliente no Asaas (mesmo critério do manage-asaas-customer: CPF/CNPJ).
    const doc = String(o.cpf_cnpj || '').replace(/\D/g, '')
    if (!doc) throw new Error('Informe o CPF/CNPJ do originador antes de gerar o boleto.')
    const end = (o.address || {}) as Record<string, string>
    const fone = String(o.phone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
    const cliente = {
      name: o.name, cpfCnpj: doc, email: o.email || undefined,
      phone: fone || undefined, mobilePhone: fone || undefined,
      address: end.rua || undefined, addressNumber: end.numero || undefined, complement: end.complemento || undefined,
      province: end.bairro || undefined, postalCode: String(end.cep || '').replace(/\D/g, '') || undefined,
      notificationDisabled: true
    }
    const busca = await asaas(`/customers?cpfCnpj=${doc}`)
    let customerId: string
    if (busca.data?.length) {
      customerId = busca.data[0].id
      await asaas(`/customers/${customerId}`, { method: 'POST', body: JSON.stringify(cliente) })
    } else {
      customerId = (await asaas('/customers', { method: 'POST', body: JSON.stringify(cliente) })).id
    }

    // Registro antes do Asaas: o id vai no externalReference.
    const desconto = Math.max(Math.round((preco - valor) * 100) / 100, 0)
    const { data: c, error: cErr } = await supabase.from('originador_licenca_cobrancas').insert({
      originator_id: o.id, tipo, cargo: o.cargo, plano_originador_id: o.plano_originador_id,
      voucher_id: o.licenca_voucher_id, preco, desconto, valor, vencimento,
      asaas_customer_id: customerId, created_by: auth.userId === 'service_role' ? null : auth.userId
    }).select().single()
    if (cErr) throw cErr

    const cargo = ROTULO_CARGO[o.cargo] || o.cargo
    const { data: planoRow } = o.plano_originador_id
      ? await supabase.from('planos_originador').select('nome').eq('id', o.plano_originador_id).maybeSingle()
      : { data: null }
    const plano = planoRow?.nome
    let descricao = `B2W Energia - Licença anual ${cargo}${plano ? ` (${plano})` : ''} - ${tipo === 'renovacao' ? 'renovação' : 'adesão'}`
    if (desconto > 0) descricao += ` | Preço R$ ${preco.toFixed(2).replace('.', ',')}, desconto do voucher R$ ${desconto.toFixed(2).replace('.', ',')}`
    descricao += ` | Validade: 1 ano a partir do pagamento${tipo === 'renovacao' ? ' (renovação conta do fim da licença atual)' : ''}.`

    let pagamento: any
    try {
      pagamento = await asaas('/payments', {
        method: 'POST',
        body: JSON.stringify({
          customer: customerId, billingType: 'BOLETO', value: valor, dueDate: vencimento,
          description: descricao.slice(0, 500), externalReference: `licenca:${c.id}`
        })
      })
    } catch (e) {
      await supabase.from('originador_licenca_cobrancas').delete().eq('id', c.id)
      throw e
    }

    let linha: string | null = null
    try { linha = (await asaas(`/payments/${pagamento.id}/identificationField`)).identificationField || null } catch { /* boleto ainda registrando */ }

    const { data: final } = await supabase.from('originador_licenca_cobrancas').update({
      asaas_payment_id: pagamento.id,
      boleto_url: pagamento.bankSlipUrl || null,
      fatura_url: pagamento.invoiceUrl || null,
      linha_digitavel: linha
    }).eq('id', c.id).select().single()

    await supabase.from('crm_history').insert({
      entity_type: 'originator', entity_id: o.id,
      content: `Boleto da licença gerado (${tipo === 'renovacao' ? 'renovação' : 'adesão'}): R$ ${valor.toFixed(2).replace('.', ',')}, vence ${dataBr(vencimento)}.`,
      metadata: { cobranca_id: c.id, asaas_payment_id: pagamento.id, valor, vencimento, tipo },
      created_by: auth.userId === 'service_role' ? null : auth.userId
    })

    return json({ success: true, cobranca: final })
  } catch (error) {
    console.error('[licenca-originador-cobranca]', (error as Error).message)
    return json({ success: false, error: (error as Error).message }, 400)
  }
})
