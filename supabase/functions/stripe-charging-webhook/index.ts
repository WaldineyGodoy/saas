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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  )

  try {
    const rawBody = await req.text()
    const sig = req.headers.get("stripe-signature")
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")

    let event: any

    if (webhookSecret && sig) {
      try {
        event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret)
      } catch (err: any) {
        console.error("Erro na verificação da assinatura Stripe:", err.message)
        return new Response(
          JSON.stringify({ error: `Webhook signature verification failed: ${err.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    } else {
      event = rawBody ? JSON.parse(rawBody) : {}
    }

    console.log(`[stripe-charging-webhook] Evento recebido: ${event.type}`)

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data?.object || {}
      const recargaId = pi.metadata?.recarga_id

      if (recargaId) {
        const { error } = await supabase
          .from("recargas_eletroposto")
          .update({
            status: "paid",
            updated_at: new Date().toISOString()
          })
          .eq("id", recargaId)

        if (error) {
          console.error("Erro ao atualizar recarga por ID:", error)
        } else {
          console.log(`[stripe-charging-webhook] Recarga ${recargaId} marcada como 'paid'.`)
        }
      } else if (pi.id) {
        const { error } = await supabase
          .from("recargas_eletroposto")
          .update({
            status: "paid",
            updated_at: new Date().toISOString()
          })
          .eq("stripe_payment_intent_id", pi.id)

        if (error) {
          console.error("Erro ao atualizar recarga por payment_intent_id:", error)
        } else {
          console.log(`[stripe-charging-webhook] Recarga com PI ${pi.id} marcada como 'paid'.`)
        }
      }
    } else if (event.type === "payment_intent.payment_failed") {
      const pi = event.data?.object || {}
      const recargaId = pi.metadata?.recarga_id

      if (recargaId) {
        const { error } = await supabase
          .from("recargas_eletroposto")
          .update({
            status: "failed",
            updated_at: new Date().toISOString()
          })
          .eq("id", recargaId)

        if (error) {
          console.error("Erro ao atualizar recarga para failed por ID:", error)
        } else {
          console.log(`[stripe-charging-webhook] Recarga ${recargaId} marcada como 'failed'.`)
        }
      } else if (pi.id) {
        const { error } = await supabase
          .from("recargas_eletroposto")
          .update({
            status: "failed",
            updated_at: new Date().toISOString()
          })
          .eq("stripe_payment_intent_id", pi.id)

        if (error) {
          console.error("Erro ao atualizar recarga para failed por payment_intent_id:", error)
        } else {
          console.log(`[stripe-charging-webhook] Recarga com PI ${pi.id} marcada como 'failed'.`)
        }
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    )
  } catch (err: any) {
    console.error("Erro no processamento do webhook Stripe:", err)
    return new Response(
      JSON.stringify({ error: err.message || "Erro desconhecido" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400
      }
    )
  }
})
