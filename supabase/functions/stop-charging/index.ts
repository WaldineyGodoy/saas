import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import Stripe from "npm:stripe@^17.7.0"
import { corsHeaders } from "../_shared/cors.ts"
import { podeParar } from "../_shared/recarga.ts"
import { enfileirarParada } from "../_shared/parada-recarga.ts"

// Criado na primeira chamada: sem STRIPE_SECRET_KEY o SDK lanca no construtor e derrubava a
// funcao inteira no boot (500), ate nos caminhos que nao usam a Stripe.
let stripeCliente: Stripe | null = null
const stripe = (): Stripe =>
  (stripeCliente ??= new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2024-12-18.acacia" as any,
    httpClient: Stripe.createFetchHttpClient(),
  }))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const resposta = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  })

// Parar pelo app (spec §5.4, SG-04). Dono = usuario logado da recarga OU quem
// apresenta o client_secret do PaymentIntent dela (motorista avulso). A chave
// anon que chega como Bearer e um JWT valido sem usuario: nao prova nada, por
// isso a prova e checada aqui dentro e nao so por verify_jwt.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    )

    const { recarga_id, client_secret } = await req.json()
    if (typeof recarga_id !== "string" || !UUID.test(recarga_id)) {
      return resposta(400, { success: false, error: "recarga_id invalido." })
    }

    let userId: string | null = null
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim()
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token)
      userId = user?.id ?? null
    }

    const { data: recarga, error } = await supabase
      .from("recargas_eletroposto")
      .select("id, user_id, status, stripe_payment_intent_id, carregador_id, ocpp_transacao_id")
      .eq("id", recarga_id)
      .maybeSingle()
    if (error) throw error

    // Recarga inexistente responde igual a recarga alheia (nao revela ids).
    const negado = () => resposta(403, { success: false, error: "Sem permissao para parar esta recarga." })
    if (!recarga) return negado()

    let segredoDoPi: string | null = null
    if (typeof client_secret === "string" && client_secret && recarga.stripe_payment_intent_id) {
      const pi = await stripe().paymentIntents.retrieve(recarga.stripe_payment_intent_id)
      segredoDoPi = pi.client_secret ?? null
    }
    if (!podeParar({ user_id: recarga.user_id, client_secret: segredoDoPi }, { userId, clientSecret: client_secret })) {
      return negado()
    }

    if (recarga.status !== "charging") {
      return resposta(409, { success: false, error: "Esta recarga nao esta em andamento.", status: recarga.status })
    }

    // Mesma chave do corte pre-pago do CSMS (stop:<recarga>). Parada anterior que terminou sem
    // aceite (expirado/rejeitado/erro) e rearmada, com alerta a operacao (I3).
    const resultado = await enfileirarParada(supabase, recarga)
    console.log(`[stop-charging] Recarga ${recarga.id}: parada ${resultado}.`)

    return resposta(200, { success: true })
  } catch (err: any) {
    console.error("[stop-charging] Erro:", err)
    return resposta(500, { success: false, error: err.message || "Erro interno" })
  }
})
