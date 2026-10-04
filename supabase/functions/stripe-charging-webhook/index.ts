import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import Stripe from "npm:stripe@^17.7.0"
import { corsHeaders } from "../_shared/cors.ts"
import { comandoInicio, exigirAssinatura, gerarIdTag } from "../_shared/recarga.ts"

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

// Garante idTag + comando de inicio da recarga. Idempotente e reentrante: se a
// primeira entrega caiu no meio (recarga ja 'paid', Stripe reenvia e o RPC
// devolve nulo), a nova tentativa reaproveita o idTag existente e o unique
// de chave_idempotencia ('start:<id>') impede o 2o comando (RC-10).
async function garantirComandoInicio(supabase: any, recargaId: string) {
  const { data: recarga, error: rErr } = await supabase
    .from("recargas_eletroposto")
    .select("id, carregador_id, ocpp_connector_id, ocpp_id_tag")
    .eq("id", recargaId)
    .single()
  if (rErr) throw rErr
  if (!recarga.carregador_id) throw new Error(`Recarga ${recargaId} sem carregador resolvido no checkout.`)

  let idTag: string | null = recarga.ocpp_id_tag
  if (!idTag) {
    const { data: tags, error: tErr } = await supabase
      .from("ocpp_id_tags").select("id_tag").eq("recarga_id", recargaId).limit(1)
    if (tErr) throw tErr
    idTag = tags?.[0]?.id_tag ?? null
  }
  if (!idTag) {
    idTag = gerarIdTag()
    const { error } = await supabase.from("ocpp_id_tags").insert({ id_tag: idTag, recarga_id: recargaId })
    if (error) throw error
  }
  if (!recarga.ocpp_id_tag) {
    const { error } = await supabase.from("recargas_eletroposto").update({ ocpp_id_tag: idTag }).eq("id", recargaId)
    if (error) throw error
  }

  const cmd = comandoInicio(recarga, idTag)
  const { error: cErr } = await supabase.from("ocpp_comandos").upsert(
    {
      carregador_id: recarga.carregador_id,
      acao: cmd.acao,
      payload: cmd.payload,
      chave_idempotencia: cmd.chave_idempotencia,
      expira_em: cmd.expira_em,
      recarga_id: recargaId,
    },
    { onConflict: "chave_idempotencia", ignoreDuplicates: true },
  )
  if (cErr) throw cErr
}

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
        await garantirComandoInicio(supabase, recargaId)
      } else {
        // Reenvio. Se a 1a entrega morreu depois de marcar 'paid' e antes de
        // criar o comando, a recarga ainda esta 'paid' sem start: completa agora.
        // Em qualquer outro status (starting/charging/...) o comando ja existiu.
        const { data: paga, error: pErr } = await supabase
          .from("recargas_eletroposto")
          .select("id")
          .eq("stripe_payment_intent_id", pi.id)
          .eq("status", "paid")
          .maybeSingle()
        if (pErr) throw pErr
        if (paga) {
          console.log(`[stripe-charging-webhook] Recarga ${paga.id} 'paid' sem comando: recuperando.`)
          await garantirComandoInicio(supabase, paga.id)
        } else {
          console.log(`[stripe-charging-webhook] PI ${pi.id}: recarga ja processada ou inexistente; nada a fazer.`)
        }
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
