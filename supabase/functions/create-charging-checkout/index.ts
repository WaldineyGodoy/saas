import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import Stripe from "npm:stripe@^17.7.0"
import { corsHeaders } from "../_shared/cors.ts"
import {
  conectorDisponivel,
  mensagemConectorIndisponivel,
  tarifaDoMotorista,
} from "../_shared/recarga.ts"

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || ""

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-12-18.acacia" as any,
  httpClient: Stripe.createFetchHttpClient(),
})

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
      .select("nome, plano:planos_assinatura_energia(tarifa_motorista_kwh)")
      .eq("id", postoId)
      .maybeSingle()
    if (postoError) throw postoError
    if (!posto) return resposta(404, { success: false, error: "Eletroposto não encontrado." })

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

    // Pago e ainda nao iniciado deixa o conector 'Available': conta como em uso.
    const { count, error: emUsoError } = await supabase
      .from("recargas_eletroposto")
      .select("id", { count: "exact", head: true })
      .eq("carregador_id", carregador.id)
      .eq("ocpp_connector_id", conector.connector_id)
      .in("status", ["paid", "starting", "charging"])
    if (emUsoError) throw emUsoError
    if ((count ?? 0) > 0) {
      return resposta(409, { success: false, motivo: "ocupado", error: mensagemConectorIndisponivel("ocupado") })
    }

    const kwhEstimado = Number((numValor / tarifaKwh).toFixed(2))

    // 1. Inserir registro inicial da recarga no banco de dados
    const { data: recarga, error: recargaErr } = await supabase
      .from("recargas_eletroposto")
      .insert({
        eletroposto_id: postoId,
        conector_numero: numero,
        carregador_id: carregador.id,
        ocpp_connector_id: conector.connector_id,
        tipo_usuario: userId ? "cadastrado" : "avulso",
        user_id: userId,
        motorista_nome: motorista?.nome || "Motorista Avulso",
        motorista_email: motorista?.email || null,
        motorista_telefone: motorista?.telefone || null,
        valor: numValor,
        kwh_estimado: kwhEstimado,
        tarifa_kwh_aplicada: tarifaKwh,
        status: "pending_payment",
        metadata: {
          nome_posto: nomePosto
        }
      })
      .select()
      .single()

    if (recargaErr) throw recargaErr

    // 2. Criar PaymentIntent na Stripe
    const amountInCents = Math.round(numValor * 100)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "brl",
      description: `Recarga VE - ${nomePosto} (Conector ${numero}) - ~${kwhEstimado} kWh`,
      automatic_payment_methods: { enabled: true },
      metadata: {
        recarga_id: recarga.id,
        eletroposto_id: postoId,
        conector_numero: String(numero),
        kwh_estimado: String(kwhEstimado),
        motorista_email: motorista?.email || ""
      }
    })

    // 3. Atualizar recarga com o ID do PaymentIntent (o webhook localiza a
    // recarga por ele; sem isso o pagamento nunca vira 'paid')
    const { error: piErr } = await supabase
      .from("recargas_eletroposto")
      .update({
        stripe_payment_intent_id: paymentIntent.id
      })
      .eq("id", recarga.id)

    if (piErr) {
      await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {})
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
