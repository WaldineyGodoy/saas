import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import Stripe from "npm:stripe@^17.7.0"
import { corsHeaders } from "../_shared/cors.ts"
import {
  conectorDisponivel,
  metodosDePagamento,
  pixIndisponivel,
  mensagemConectorIndisponivel,
  postoAceitaRecarga,
  RESERVA_PAGAMENTO_MIN,
  tarifaDoMotorista,
} from "../_shared/recarga.ts"

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || ""

// Criado na primeira chamada: sem STRIPE_SECRET_KEY o SDK lanca no construtor e derrubava a
// funcao inteira no boot (500), ate nos caminhos que nao usam a Stripe.
let stripeCliente: Stripe | null = null
const stripe = (): Stripe =>
  (stripeCliente ??= new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-12-18.acacia" as any,
    httpClient: Stripe.createFetchHttpClient(),
  }))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const resposta = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  })

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    )

    const { eletroposto_id, conector_numero, valor, motorista } = await req.json()

    // Motorista avulso paga sem login (a chave anon chega aqui como Bearer e
    // nao tem usuario). Quem esta logado tem o dono da recarga derivado do
    // JWT; user_id / tipo_usuario do corpo sao ignorados de proposito.
    let userId: string | null = null
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim()
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token)
      userId = user?.id ?? null
    }

    const numValor = Number(valor)
    if (isNaN(numValor) || numValor < 5) {
      return resposta(400, { success: false, error: "O valor mínimo para recarga é de R$ 5,00." })
    }

    const postoId = typeof eletroposto_id === "string" ? eletroposto_id.trim() : ""
    const numero = Number(conector_numero)
    if (!UUID.test(postoId) || !Number.isInteger(numero) || numero < 1) {
      return resposta(400, { success: false, error: "Informe o eletroposto e o número do conector." })
    }

    // Tarifa ao motorista = a do plano do eletroposto (spec §4.9).
    const { data: posto, error: postoError } = await supabase
      .from("eletropostos")
      .select("nome, status, plano:planos_assinatura_energia(tarifa_motorista_kwh)")
      .eq("id", postoId)
      .maybeSingle()
    if (postoError) throw postoError
    if (!posto) return resposta(404, { success: false, error: "Eletroposto não encontrado." })

    // Mesma regra das RPCs publicas: so posto operando vende recarga.
    if (!postoAceitaRecarga((posto as any).status)) {
      return resposta(409, { success: false, error: "Este eletroposto não está em operação. Recarga indisponível." })
    }

    const tarifa = tarifaDoMotorista((posto as any).plano)
    if (!tarifa.ok) return resposta(422, { success: false, error: tarifa.erro })
    const tarifaKwh = tarifa.tarifa
    const nomePosto = posto.nome || "Eletroposto B2W Charge"

    // Conector pelo numero publico (unico no eletroposto).
    const { data: conector, error: conectorError } = await supabase
      .from("eletroposto_conectores")
      .select("connector_id, status, bloqueado_ate_reset, carregador:eletroposto_carregadores(id, online)")
      .eq("eletroposto_id", postoId)
      .eq("numero", numero)
      .maybeSingle()
    if (conectorError) throw conectorError
    const carregador = (conector as any)?.carregador
    if (!conector || !carregador) {
      return resposta(404, { success: false, error: "Conector não encontrado neste eletroposto." })
    }

    // 409 com motivo legivel antes de criar o PaymentIntent (ST-04 / UI-01).
    const disp = conectorDisponivel({
      online: !!carregador.online,
      status: conector.status,
      bloqueado: !!conector.bloqueado_ate_reset,
    })
    if (!disp.ok) {
      return resposta(409, { success: false, motivo: disp.motivo, error: mensagemConectorIndisponivel(disp.motivo) })
    }

    const kwhEstimado = Number((numValor / tarifaKwh).toFixed(2))

    // 1. Reservar o conector e criar a recarga numa transacao so (advisory lock
    // no banco): paid/starting/charging e pending_payment com menos de
    // RESERVA_PAGAMENTO_MIN minutos ocupam o conector. Nulo = reservado/em uso.
    const { data: recargaId, error: recargaErr } = await supabase.rpc("fn_reservar_recarga", {
      p_carregador_id: carregador.id,
      p_connector_id: conector.connector_id,
      p_reserva_min: RESERVA_PAGAMENTO_MIN,
      p_eletroposto_id: postoId,
      p_conector_numero: numero,
      p_user_id: userId,
      p_motorista_nome: motorista?.nome || "Motorista Avulso",
      p_motorista_email: motorista?.email || null,
      p_motorista_telefone: motorista?.telefone || null,
      p_valor: numValor,
      p_kwh_estimado: kwhEstimado,
      p_tarifa_kwh_aplicada: tarifaKwh,
      p_metadata: { nome_posto: nomePosto },
    })
    if (recargaErr) throw recargaErr
    if (!recargaId) {
      return resposta(409, { success: false, motivo: "reservado", error: mensagemConectorIndisponivel("reservado") })
    }
    const recarga = { id: recargaId as string }

    // Falhou depois de reservar: cancela para nao segurar o conector por 10 min.
    const liberar = () =>
      supabase.from("recargas_eletroposto").update({ status: "canceled" })
        .eq("id", recarga.id).eq("status", "pending_payment").then(() => {}, () => {})

    // 2. Criar PaymentIntent na Stripe
    const amountInCents = Math.round(numValor * 100)
    let paymentIntent: Stripe.PaymentIntent
    const criarPi = (pix: boolean) => stripe().paymentIntents.create({
      amount: amountInCents,
      currency: "brl",
      description: `Recarga VE - ${nomePosto} (Conector ${numero}) - ~${kwhEstimado} kWh`,
      // Pix e cartao explicitos (M3): nada de metodo que liquida em dias
      ...metodosDePagamento({ pix }),
      metadata: {
        recarga_id: recarga.id,
        eletroposto_id: postoId,
        conector_numero: String(numero),
        kwh_estimado: String(kwhEstimado),
        motorista_email: motorista?.email || ""
      }
    })
    try {
      try {
        paymentIntent = await criarPi(true)
      } catch (e) {
        if (!pixIndisponivel(e)) throw e
        // conta sem Pix ativado: vende so com cartao em vez de recusar todas as recargas
        console.warn("[create-charging-checkout] Pix indisponivel na conta Stripe; seguindo so com cartao:", (e as Error).message)
        paymentIntent = await criarPi(false)
      }
    } catch (e) {
      await liberar()
      throw e
    }

    // 3. Atualizar recarga com o ID do PaymentIntent (o webhook localiza a
    // recarga por ele; sem isso o pagamento nunca vira 'paid')
    const { error: piErr } = await supabase
      .from("recargas_eletroposto")
      .update({
        stripe_payment_intent_id: paymentIntent.id
      })
      .eq("id", recarga.id)

    if (piErr) {
      await stripe().paymentIntents.cancel(paymentIntent.id).catch(() => {})
      await liberar()
      throw piErr
    }

    return resposta(200, {
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      recargaId: recarga.id,
      kwh_estimado: kwhEstimado,
      tarifa_kwh: tarifaKwh,
      nome_posto: nomePosto
    })
  } catch (err: any) {
    console.error("Erro ao criar checkout de recarga:", err)
    return resposta(400, { success: false, error: err.message || "Erro interno" })
  }
})
