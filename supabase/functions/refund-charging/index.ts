import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import Stripe from "npm:stripe@^17.7.0"
import { corsHeaders } from "../_shared/cors.ts"
import { igualConstante, validarPedidoEstorno } from "../_shared/recarga.ts"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-12-18.acacia" as any,
  httpClient: Stripe.createFetchHttpClient(),
})

const resposta = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  })

// Estorno de recarga, chamado so pelo CSMS (service role). verify_jwt nao basta:
// a chave anon e um JWT valido e publico. Aqui o Bearer tem de ser IGUAL a
// SUPABASE_SERVICE_ROLE_KEY. Qualquer resposta nao-2xx significa "nao feito":
// o CSMS tenta de novo.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!serviceKey || !igualConstante(bearer, serviceKey)) {
    return resposta(403, { error: "Somente o CSMS (service role) pode estornar." })
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey)

    const { recarga_id, valor_centavos, motivo } = await req.json()
    if (typeof recarga_id !== "string" || !recarga_id) {
      return resposta(400, { error: "recarga_id obrigatorio." })
    }

    const { data: recarga, error } = await supabase
      .from("recargas_eletroposto")
      .select("id, valor, status, stripe_payment_intent_id, stripe_refund_id, valor_estornado")
      .eq("id", recarga_id)
      .maybeSingle()
    if (error) throw error
    if (!recarga) return resposta(404, { error: "Recarga inexistente." })

    // Idempotente: ja estornada, nao chama a Stripe de novo.
    if (recarga.stripe_refund_id) {
      return resposta(200, { ok: true, ja_estornada: true, stripe_refund_id: recarga.stripe_refund_id })
    }

    const recusa = validarPedidoEstorno(recarga, valor_centavos)
    if (recusa) return resposta(400, { error: recusa })

    // A chave de idempotencia da Stripe cobre a corrida entre duas chamadas
    // simultaneas: ambas recebem o mesmo refund.
    const refund = await stripe.refunds.create(
      {
        payment_intent: recarga.stripe_payment_intent_id,
        amount: valor_centavos,
        metadata: { recarga_id: recarga.id, motivo: String(motivo ?? "").slice(0, 200) },
      },
      { idempotencyKey: `refund:${recarga.id}` },
    )

    const { error: upErr } = await supabase
      .from("recargas_eletroposto")
      .update({ stripe_refund_id: refund.id, valor_estornado: valor_centavos / 100 })
      .eq("id", recarga.id)
    if (upErr) throw upErr

    return resposta(200, { ok: true, stripe_refund_id: refund.id })
  } catch (err: any) {
    console.error("[refund-charging] Erro:", err)
    return resposta(502, { error: err.message || "Erro ao estornar" })
  }
})
