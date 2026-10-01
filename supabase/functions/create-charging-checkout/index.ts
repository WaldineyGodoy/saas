import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import Stripe from "npm:stripe@^17.7.0"
import { corsHeaders } from "../_shared/cors.ts"

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || ""

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-12-18.acacia" as any,
  httpClient: Stripe.createFetchHttpClient(),
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

    const { eletroposto_id, conector_numero, valor, motorista, tipo_usuario, user_id } = await req.json()

    const numValor = Number(valor)
    if (isNaN(numValor) || numValor < 5) {
      throw new Error("O valor mínimo para recarga é de R$ 5,00.")
    }

    let tarifaKwh = 2.15
    let nomePosto = "Eletroposto B2W Charge"

    if (eletroposto_id && typeof eletroposto_id === "string" && eletroposto_id.trim() !== "") {
      const { data: posto, error: postoError } = await supabase
        .from("eletropostos")
        .select("nome, tarifa_investidor_kwh")
        .eq("id", eletroposto_id.trim())
        .maybeSingle()

      if (!postoError && posto) {
        if (posto.nome) nomePosto = posto.nome
        if (posto.tarifa_investidor_kwh && Number(posto.tarifa_investidor_kwh) > 0) {
          tarifaKwh = Number(posto.tarifa_investidor_kwh)
        }
      }
    }

    const kwhEstimado = Number((numValor / tarifaKwh).toFixed(2))

    // 1. Inserir registro inicial da recarga no banco de dados
    const { data: recarga, error: recargaErr } = await supabase
      .from("recargas_eletroposto")
      .insert({
        eletroposto_id: (eletroposto_id && typeof eletroposto_id === "string" && eletroposto_id.trim() !== "") ? eletroposto_id.trim() : null,
        conector_numero: Number(conector_numero) || 1,
        tipo_usuario: tipo_usuario === "cadastrado" ? "cadastrado" : "avulso",
        user_id: user_id || null,
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
      description: `Recarga VE - ${nomePosto} (Conector ${conector_numero || 1}) - ~${kwhEstimado} kWh`,
      automatic_payment_methods: { enabled: true },
      metadata: {
        recarga_id: recarga.id,
        eletroposto_id: eletroposto_id || "",
        conector_numero: String(conector_numero || 1),
        kwh_estimado: String(kwhEstimado),
        motorista_email: motorista?.email || ""
      }
    })

    // 3. Atualizar recarga com o ID do PaymentIntent
    await supabase
      .from("recargas_eletroposto")
      .update({
        stripe_payment_intent_id: paymentIntent.id
      })
      .eq("id", recarga.id)

    return new Response(
      JSON.stringify({
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        recargaId: recarga.id,
        kwh_estimado: kwhEstimado,
        tarifa_kwh: tarifaKwh,
        nome_posto: nomePosto
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    )
  } catch (err: any) {
    console.error("Erro ao criar checkout de recarga:", err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Erro interno" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400
      }
    )
  }
})
