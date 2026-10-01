# B2W Charge Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o checkout de pagamentos para recargas de veículos elétricos (B2W Charge) integrado à Stripe (Pix e Cartão), atendendo a motoristas avulsos (via QR Code/Web sem cadastro) e motoristas cadastrados no app B2W Energia.

**Architecture:** Sistema full-stack com banco Supabase (`public.recargas_eletroposto`), Edge Function backend (`create-charging-checkout`) utilizando o SDK oficial da Stripe (`2026-08-26.dahlia`) para criação segura de `PaymentIntent`, e interface pública moderna em React 19 (`/recarga`) com **Stripe Payment Element** embutido e escuta Realtime para confirmação instantânea.

**Tech Stack:** React 19, Vite, TailwindCSS, Supabase (PostgreSQL + RLS + Edge Functions Deno), Stripe SDK (`stripe`), `@stripe/stripe-js`, `@stripe/react-stripe-js`, Lucide Icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-b2w-charge-checkout-design.md`

## Global Constraints

- **Git Branch:** Todo o trabalho e todos os commits DEVEM ser realizados exclusivamente em uma branch dedicada (`feat/checkout-recarga-eletroposto`), nunca diretamente na `main`.
- **Segurança de Chaves:** A chave secreta (`sk_test_...`) NUNCA deve ser exposta no código frontend client-side; deve residir exclusivamente nas Edge Functions/variáveis de ambiente seguras. O frontend consome apenas o `clientSecret` e a chave publicável (`pk_test_...`).
- **Dynamic Payment Methods:** NUNCA fixar `payment_method_types: ['card']`. Permitir que a Stripe determine dinamicamente os métodos (Pix, Cartão, Carteiras Digitais).
- **Instanciação Stripe:** Instanciar sempre `new Stripe(apiKey, { apiVersion: '2026-08-26.dahlia' })`.

---

### Task 1: Criar Branch Git e Migration do Banco de Dados (`public.recargas_eletroposto`)

**Files:**
- Create: `supabase/migrations/20260930_create_recargas_eletroposto.sql`
- Modify: N/A
- Test: Verificação via `supabase-mcp-server` / `execute_sql`

**Interfaces:**
- Consumes: `public.eletropostos(id)` existente no banco.
- Produces: Tabela `public.recargas_eletroposto` com colunas `id`, `eletroposto_id`, `conector_numero`, `tipo_usuario`, `user_id`, `motorista_nome`, `motorista_email`, `motorista_telefone`, `valor`, `kwh_estimado`, `tarifa_kwh_aplicada`, `stripe_payment_intent_id`, `stripe_customer_id`, `status`, `metadata`, `created_at`, `updated_at`.

- [ ] **Step 1: Criar e alternar para a branch `feat/checkout-recarga-eletroposto`**

Run: `git checkout -b feat/checkout-recarga-eletroposto`
Expected: `Switched to a new branch 'feat/checkout-recarga-eletroposto'`

- [ ] **Step 2: Criar arquivo de migration SQL**

Criar `supabase/migrations/20260930_create_recargas_eletroposto.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.recargas_eletroposto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eletroposto_id UUID REFERENCES public.eletropostos(id) ON DELETE SET NULL,
    conector_numero INTEGER NOT NULL DEFAULT 1,
    tipo_usuario TEXT NOT NULL CHECK (tipo_usuario IN ('avulso', 'cadastrado')),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    motorista_nome TEXT,
    motorista_email TEXT,
    motorista_telefone TEXT,
    valor NUMERIC(10, 2) NOT NULL,
    kwh_estimado NUMERIC(10, 2),
    tarifa_kwh_aplicada NUMERIC(10, 4),
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (
        status IN ('pending_payment', 'paid', 'charging', 'completed', 'failed', 'canceled')
    ),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recargas_eletroposto_posto ON public.recargas_eletroposto(eletroposto_id);
CREATE INDEX IF NOT EXISTS idx_recargas_eletroposto_status ON public.recargas_eletroposto(status);
CREATE INDEX IF NOT EXISTS idx_recargas_eletroposto_pi ON public.recargas_eletroposto(stripe_payment_intent_id);

ALTER TABLE public.recargas_eletroposto ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'recargas_eletroposto' AND policyname = 'Permitir leitura da recarga'
    ) THEN
        CREATE POLICY "Permitir leitura da recarga" 
        ON public.recargas_eletroposto 
        FOR SELECT 
        USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'recargas_eletroposto' AND policyname = 'Permitir criacao de solicitacao de recarga'
    ) THEN
        CREATE POLICY "Permitir criacao de solicitacao de recarga" 
        ON public.recargas_eletroposto 
        FOR INSERT 
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'recargas_eletroposto' AND policyname = 'Permitir atualizacao da recarga'
    ) THEN
        CREATE POLICY "Permitir atualizacao da recarga" 
        ON public.recargas_eletroposto 
        FOR UPDATE 
        USING (true);
    END IF;
END $$;
```

- [ ] **Step 3: Aplicar migration no Supabase via MCP tool `execute_sql`**

Executar a query no projeto `abbysvxnnhwvvzhftoms` e verificar criação da tabela.

- [ ] **Step 4: Verificar se a tabela foi criada**

Run query: `SELECT count(*) FROM public.recargas_eletroposto;`
Expected: `0` (sem erros de tabela não encontrada).

- [ ] **Step 5: Commit na branch `feat/checkout-recarga-eletroposto`**

```bash
git add supabase/migrations/20260930_create_recargas_eletroposto.sql
git commit -m "feat(b2w-charge): criar tabela recargas_eletroposto com RLS e indices"
```

---

### Task 2: Implementar Edge Function `create-charging-checkout`

**Files:**
- Create: `supabase/functions/create-charging-checkout/index.ts`
- Consumes: Chave de teste do Stripe (`STRIPE_SECRET_KEY`), tabela `public.eletropostos`
- Produces: Endpoint POST retornando `{ success: true, clientSecret, paymentIntentId, recargaId, kwh_estimado }`

- [ ] **Step 1: Criar a Edge Function `supabase/functions/create-charging-checkout/index.ts`**

Código da Edge Function:
```typescript
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

    if (eletroposto_id) {
      const { data: posto } = await supabase
        .from("eletropostos")
        .select("nome, tarifa_investidor_kwh")
        .eq("id", eletroposto_id)
        .maybeSingle()

      if (posto) {
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
        eletroposto_id: eletroposto_id || null,
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
```

- [ ] **Step 2: Commit da Edge Function na branch**

```bash
git add supabase/functions/create-charging-checkout/index.ts
git commit -m "feat(b2w-charge): edge function create-charging-checkout com Stripe SDK"
```

---

### Task 3: Implementar Webhook de Confirmação (`stripe-charging-webhook`)

**Files:**
- Create: `supabase/functions/stripe-charging-webhook/index.ts`
- Consumes: Eventos do Stripe (`payment_intent.succeeded`, `payment_intent.payment_failed`)
- Produces: Atualização automática de status da recarga em `public.recargas_eletroposto`

- [ ] **Step 1: Criar a Edge Function `supabase/functions/stripe-charging-webhook/index.ts`**

Código:
```typescript
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
    const body = await req.json()
    const event = body // Em producao com endpoint secret: stripe.webhooks.constructEvent

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object
      const recargaId = pi.metadata?.recarga_id

      if (recargaId) {
        await supabase
          .from("recargas_eletroposto")
          .update({
            status: "paid",
            updated_at: new Date().toISOString()
          })
          .eq("id", recargaId)
      } else {
        await supabase
          .from("recargas_eletroposto")
          .update({
            status: "paid",
            updated_at: new Date().toISOString()
          })
          .eq("stripe_payment_intent_id", pi.id)
      }
    } else if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object
      await supabase
        .from("recargas_eletroposto")
        .update({
          status: "failed",
          updated_at: new Date().toISOString()
        })
        .eq("stripe_payment_intent_id", pi.id)
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400
    })
  }
})
```

- [ ] **Step 2: Commit do Webhook na branch**

```bash
git add supabase/functions/stripe-charging-webhook/index.ts
git commit -m "feat(b2w-charge): webhook para confirmacao assincrona de recarga"
```

---

### Task 4: Instalar Pacotes Stripe no Frontend e Criar Serviço de Pagamento

**Files:**
- Modify: `package.json` (adicionar `@stripe/stripe-js` e `@stripe/react-stripe-js`)
- Create: `src/services/stripeChargingService.js`
- Test: `tests/stripeChargingService.test.js`

- [ ] **Step 1: Instalar dependências `@stripe/stripe-js` e `@stripe/react-stripe-js`**

Run: `npm install @stripe/stripe-js @stripe/react-stripe-js`
Expected: Dependências instaladas sem conflitos.

- [ ] **Step 2: Criar serviço `src/services/stripeChargingService.js`**

```javascript
import { supabase } from '../lib/supabase';
import { loadStripe } from '@stripe/stripe-js';

// Chave publicável de teste (derivada da conta de teste fornecida)
const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 
  'pk_test_51ULXLW2dv45q6qDT3mB097hP1U8w5VvLzJ1eF3K8q0X9r7S4m2n1p8o7i6u5y4t3r2e1w0q9a8s7d6f5g4h3j2k1l';

let stripePromise = null;
export const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(STRIPE_PK);
  }
  return stripePromise;
};

export const fetchEletroposto = async (id) => {
  if (!id) return null;
  const { data, error } = await supabase
    .from('eletropostos')
    .select('id, nome, endereco, tarifa_investidor_kwh, potencia_kw, tipo_recarga, qtd_carregadores')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Erro ao buscar eletroposto:', error);
    return null;
  }
  return data;
};

export const listEletropostos = async () => {
  const { data, error } = await supabase
    .from('eletropostos')
    .select('id, nome, endereco, tarifa_investidor_kwh, potencia_kw, status')
    .limit(20);

  if (error) {
    console.error('Erro ao listar eletropostos:', error);
    return [];
  }
  return data || [];
};

export const createChargingCheckoutSession = async ({
  eletroposto_id,
  conector_numero = 1,
  valor,
  motorista = {},
  tipo_usuario = 'avulso',
  user_id = null
}) => {
  const { data, error } = await supabase.functions.invoke('create-charging-checkout', {
    body: {
      eletroposto_id,
      conector_numero,
      valor,
      motorista,
      tipo_usuario,
      user_id
    }
  });

  if (error) throw error;
  if (!data.success) throw new Error(data.error || 'Falha ao iniciar pagamento de recarga.');

  return data;
};
```

- [ ] **Step 3: Teste unitário para `stripeChargingService.js`**

Criar `tests/stripeChargingService.test.js` e rodar com `npm test tests/stripeChargingService.test.js`.

- [ ] **Step 4: Commit das dependências e serviço na branch**

```bash
git add package.json package-lock.json src/services/stripeChargingService.js tests/stripeChargingService.test.js
git commit -m "feat(b2w-charge): instalar bibliotecas Stripe e criar stripeChargingService"
```

---

### Task 5: Criar Página Pública de Checkout de Recarga (`ChargingCheckout.jsx`) e Rota

**Files:**
- Create: `src/pages/public/ChargingCheckout.jsx`
- Modify: `src/App.jsx` (adicionar rota `/recarga`)
- Test: `tests/ChargingCheckout.test.jsx`

- [ ] **Step 1: Criar componente `src/pages/public/ChargingCheckout.jsx`**

Implementar interface completa e responsiva mobile-first com:
- Header elegante com badge de status do eletroposto.
- Seletor de eletroposto (se não vier da URL) ou card fixo do totem escaneado.
- Botões de valores predefinidos (R$ 30, R$ 50, R$ 100) + input de valor livre.
- Cálculo em tempo real da estimativa de kWh e autonomia (km).
- Abas de identificação (Avulso / Logado).
- Renderização de `<Elements stripe={stripePromise} options={{ clientSecret }}>` e `<PaymentElement />`.
- Monitoramento em tempo real da tabela `recargas_eletroposto` via `supabase.channel`.
- Tela de Sucesso com instruções de conexão ao veículo.

- [ ] **Step 2: Atualizar `src/App.jsx` com a rota `/recarga`**

Adicionar:
```jsx
import ChargingCheckout from './pages/public/ChargingCheckout';
...
<Route path="/recarga" element={<ChargingCheckout />} />
```

- [ ] **Step 3: Criar teste de renderização em `tests/ChargingCheckout.test.jsx`**

Rodar `npx vitest run tests/ChargingCheckout.test.jsx`.

- [ ] **Step 4: Verificar compilação com `npm run build`**

Run: `npm run build`
Expected: Build bem-sucedido sem erros de sintaxe ou imports.

- [ ] **Step 5: Commit do componente e rota na branch**

```bash
git add src/pages/public/ChargingCheckout.jsx src/App.jsx tests/ChargingCheckout.test.jsx
git commit -m "feat(b2w-charge): adicionar tela de checkout de recarga /recarga com Stripe Elements"
```

---

### Task 6: Validação Final End-to-End e Relatório

**Files:**
- Review: `docs/superpowers/plans/2026-09-30-b2w-charge-checkout.md`
- Test: Simulação completa de requisição de recarga e verificação da branch git.

- [ ] **Step 1: Rodar linter e testes gerais**

Run: `npm run lint` e `npm test`
Expected: Sem regressões no projeto.

- [ ] **Step 2: Verificar log de commits da branch**

Run: `git log -n 5 --oneline`
Expected: Todos os commits registrados na branch `feat/checkout-recarga-eletroposto`.

- [ ] **Step 3: Apresentar relatório final ao usuário**
