import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import Stripe from "npm:stripe@^17.7.0"
import { corsHeaders } from "../_shared/cors.ts"
import { exigirAssinatura } from "../_shared/recarga.ts"

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || ""

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-12-18.acacia" as any,
  httpClient: Stripe.createFetchHttpClient(),
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  // SG-03: so evento com assinatura Stripe valida. A partir do OCPP, 'paid'
  // libera energia; um POST forjado nao pode chegar ate o banco.
  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    const { secret, assinatura } = exigirAssinatura(
      Deno.env.get("STRIPE_WEBHOOK_SECRET"),
      req.headers.get("stripe-signature"),
    )
    event = await stripe.webhooks.constructEventAsync(rawBody, assinatura, secret)
  } catch (err: any) {
    console.error("[stripe-charging-webhook] Evento recusado:", err.message)
    return json({ error: "Assinatura do webhook invalida." }, 400)
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  )

  try {
    console.log(`[stripe-charging-webhook] Evento recebido: ${event.type} (${event.id})`)

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent

      // RC-10: so a primeira entrega surte efeito; reenvio devolve nulo.
      const { data: recargaId, error } = await supabase.rpc("fn_marcar_recarga_paga", {
        p_payment_intent_id: pi.id,
      })
      if (error) throw error

      if (recargaId) {
        console.log(`[stripe-charging-webhook] Recarga ${recargaId} marcada como 'paid'.`)
      } else {
        console.log(`[stripe-charging-webhook] PI ${pi.id}: recarga ja processada ou inexistente; nada a fazer.`)
      }
    } else if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent

      const { data, error } = await supabase
        .from("recargas_eletroposto")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("stripe_payment_intent_id", pi.id)
        .eq("status", "pending_payment")
        .select("id")
      if (error) throw error

      if (data?.length) {
        console.log(`[stripe-charging-webhook] Recarga ${data[0].id} marcada como 'failed'.`)
      }
    }

    return json({ received: true })
  } catch (err: any) {
    // 500 para a Stripe reenviar: a falha foi nossa, nao do evento.
    console.error("[stripe-charging-webhook] Erro ao processar evento:", err)
    return json({ error: err.message || "Erro desconhecido" }, 500)
  }
})
