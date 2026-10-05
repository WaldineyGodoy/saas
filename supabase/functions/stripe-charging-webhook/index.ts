import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import Stripe from "npm:stripe@^17.7.0"
import { corsHeaders } from "../_shared/cors.ts"
import { exigirAssinatura } from "../_shared/recarga.ts"
// Efeitos na recarga (testados no Vitest): succeeded -> paid + RemoteStart, conflito/sem destino e
// pagamento tardio -> estorno total pendente; payment_failed so registra (o motorista tenta de novo).
import { tratarEventoRecarga } from "../_shared/webhook-recarga.ts"

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || ""

// Criado na primeira chamada: sem STRIPE_SECRET_KEY o SDK lanca no construtor e derrubava a
// funcao inteira no boot (500), ate nos caminhos que nao usam a Stripe.
let stripeCliente: Stripe | null = null
const stripe = (): Stripe =>
  (stripeCliente ??= new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-12-18.acacia" as any,
    httpClient: Stripe.createFetchHttpClient(),
  }))

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
    event = await stripe().webhooks.constructEventAsync(rawBody, assinatura, secret)
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

    const resultado = await tratarEventoRecarga(supabase, {
      type: event.type,
      data: { object: { id: (event.data.object as { id: string }).id } },
    })
    console.log(`[stripe-charging-webhook] ${event.id}: ${resultado}`)

    return json({ received: true })
  } catch (err: any) {
    // 500 para a Stripe reenviar: a falha foi nossa, nao do evento.
    console.error("[stripe-charging-webhook] Erro ao processar evento:", err)
    return json({ error: err.message || "Erro desconhecido" }, 500)
  }
})
