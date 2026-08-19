# Fechar a exposição da chave Asaas e dos endpoints financeiros — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o caminho pelo qual qualquer pessoa na internet pode disparar um PIX da conta Asaas da B2W, e reduzir o alcance da chave de produção para que um novo vazamento não vire dinheiro saindo.

**Architecture:** As Edge Functions financeiras hoje são anônimas: `verify_jwt = false` e nenhuma verificação de identidade dentro do corpo. A correção tem duas camadas, e as duas são necessárias. A primeira é um portão de identidade compartilhado (`_shared/auth.ts`) que exige um JWT de usuário real com papel administrativo — **não basta ligar `verify_jwt = true`, porque a chave `anon` é um JWT válido e passa pelo gateway do Supabase**. A segunda é parar de confiar no corpo da requisição para decidir *para onde* o dinheiro vai: a chave PIX passa a ser lida do cadastro no banco a partir de um id de destino, nunca aceita pronta do cliente.

**Tech Stack:** Deno Edge Functions (Supabase), `@supabase/supabase-js@2.45.0` via `npm:`, Supabase CLI 2.76.12 (já em devDependencies), PostgreSQL 15 (Supabase, projeto `abbysvxnnhwvvzhftoms`).

## Global Constraints

- **Papéis administrativos aceitos:** `admin` e `super_admin`. Confirmado em produção: são os únicos papéis administrativos existentes (`admin`=2, `super_admin`=1). Os demais papéis em uso são `supplier`, `lead`, `originator`, `subscriber` — nenhum deles pode mover dinheiro.
- **`manager` não entra na lista.** A função `check_user_is_admin` do banco aceita `manager`, mas nenhum usuário tem esse papel. Não replicar essa permissão nas funções financeiras.
- **Nunca logar a chave Asaas**, nem truncada. `manage-asaas-customer` hoje faz `console.log(\`Key=${asaasKey.substring(0, 10)}...\`)` — isso vai embora, não vira `substring(0,4)`.
- **Não adicionar dependências novas.** Tudo com o que já existe.
- **Deploy de Edge Function não republica o CRM.** O workflow `.github/workflows/deploy.yml` só publica o front (`dist` → `gh-pages`) em push para `main`. As funções são deployadas separadamente pelo CLI. Isso permite corrigir a segurança **sem** mexer no merge do `impl/fechamento-mensal` que está segurado.
- **Branch de trabalho:** criar `fix/seguranca-asaas` a partir de `main`. Não trabalhar em `main` direto, não tocar em `impl/fechamento-mensal` nem em `spec/fechamento-contabil`.
- **A verificação de cada task é uma sonda HTTP real contra a função deployada**, usando a chave `anon` pública — porque é exatamente essa a credencial que um atacante tem. Um teste que não usa a `anon` key não prova nada.

**Variáveis de ambiente para as sondas** (exportar uma vez por sessão de shell):

```bash
export SB_URL="https://abbysvxnnhwvvzhftoms.supabase.co"
export SB_ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYnlzdnhubmh3dnZ6aGZ0b21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NTcwNzcsImV4cCI6MjA4NDIzMzA3N30.omP9h4ZqFbDX4FMO_lkd5Q3Iv99xgbs5bVz6beIpqfo"
```

Essa chave `anon` é pública por projeto (vai no bundle do front). Ela está aqui porque é o insumo do teste, não porque é segredo.

---

## Pré-requisito do dono (fora do código, faça antes da Task 1)

Estas três ações são do dono da conta e **não** devem ser executadas por um agente:

1. **Revogar a chave de produção Asaas e gerar uma nova** no painel Asaas. Enquanto a chave antiga viver, todo o resto é paliativo.
2. **Puxar o extrato de `/transfers` no painel Asaas** e conciliar contra a tabela `financial_transfers` (que tem apenas 6 linhas, todas para o fornecedor `83dfcbcd-eab4-4a1c-9da4-5360ee96331a`). Qualquer transferência no Asaas que não tenha linha correspondente aqui é movimentação que não passou pelo CRM.
3. **Decidir sobre a visibilidade do repositório `github.com/WaldineyGodoy/saas`**, hoje público. O `supabase/config.toml` público anuncia quais funções dispensam JWT, e cada `index.ts` entrega o formato exato do payload. Tornar privado não substitui as correções deste plano — o endpoint continua alcançável por quem já leu o código — mas para de distribuir o mapa.

Depois de trocar a chave, atualizá-la em **Configurações → Integração Financeira** do CRM. Ela é lida de `integrations_config.api_key`; não existe cópia dela em arquivo nenhum (varredura de `$aact_` no working tree e em todo o histórico do git: zero ocorrências).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/functions/_shared/auth.ts` | **Criar.** Portão único de identidade: valida o JWT do header e exige papel administrativo. Toda função financeira passa por aqui. |
| `supabase/functions/_shared/cors.ts` | **Criar.** Cabeçalhos CORS num lugar só, hoje duplicados em 21 arquivos. |
| `supabase/functions/transfer-asaas-pix/index.ts` | **Modificar.** Portão de identidade + destino vindo do banco + throttle que não se pula. |
| `supabase/functions/manage-asaas-customer/index.ts` | **Modificar.** Portão de identidade; remover o log da chave. |
| `supabase/functions/create-asaas-charge/index.ts` | **Modificar.** Portão de identidade. |
| `supabase/functions/update-asaas-charge/index.ts` | **Modificar.** Portão de identidade. |
| `supabase/functions/cancel-asaas-charge/index.ts` | **Modificar.** Portão de identidade. |
| `supabase/functions/create-asaas-token-charge/index.ts` | **Modificar.** Portão de usuário (não de admin — é tela de usuário comum), e dono e preço da recarga passam a vir do servidor. |
| `supabase/config.toml` | **Modificar.** `verify_jwt = true` nas funções financeiras. |
| `supabase/migrations/20260131_create_integrations_config.sql` | **Modificar.** A policy dessa migration permite qualquer `authenticated` ler a chave. Produção já foi corrigida à mão; o arquivo não. Reaplicar a migration reabre o buraco. |
| `supabase/migrations/20260819_financial_transfers_requested_by.sql` | **Criar.** Coluna `requested_by` para haver trilha de quem pediu cada transferência. |
| `check_asaas_config.js`, `list_all_configs.js` | **Apagar.** Scripts de depuração, na raiz de um repo público, cuja única função é despejar `integrations_config` inteira — incluindo `api_key` — no stdout. |

---

## Task 1: Portão de identidade compartilhado e fechamento do `transfer-asaas-pix`

Esta é a task que fecha o buraco. As outras reduzem alcance; esta para a hemorragia.

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/auth.ts`
- Modify: `supabase/functions/transfer-asaas-pix/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces:
  - `corsHeaders: Record<string, string>` — exportado de `_shared/cors.ts`.
  - `requireAdmin(req: Request, supabase: SupabaseClient): Promise<AuthResult>` — exportado de `_shared/auth.ts`, onde
    `type AuthResult = { ok: true; userId: string; role: string } | { ok: false; status: 401 | 403; error: string }`.
    As Tasks 2 e 4 dependem exatamente dessa assinatura.
  - `requireUser(req: Request, supabase: SupabaseClient): Promise<AuthResult>` — mesma assinatura, mas exige apenas
    usuário autenticado, sem checar papel. Usado pela Task 5, em endpoint que um assinante comum precisa chamar.

- [ ] **Step 1: Criar a branch de trabalho**

```bash
git checkout main && git pull && git checkout -b fix/seguranca-asaas
```

- [ ] **Step 2: Sonda inicial — provar que o buraco existe**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SB_URL/functions/v1/transfer-asaas-pix" -H "Content-Type: application/json" -d '{}'
```

Esperado agora: **`400`** — a função *aceitou* a requisição sem nenhuma credencial e só reclamou de campo faltando (`Missing required fields: amount or pixKey`). Um `400` aqui é a prova de que não há portão: uma requisição sem `Authorization` nenhum chegou até a lógica de negócio.

Anote o resultado. Ao final da task esse mesmo comando deve devolver `401`.

Não envie um payload com `amount` e `pixKey` reais nesta sonda — isso moveria dinheiro de verdade.

- [ ] **Step 3: Criar `_shared/cors.ts`**

```ts
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

- [ ] **Step 4: Criar `_shared/auth.ts`**

```ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.0"

/**
 * Papéis autorizados a mover dinheiro.
 *
 * Deliberadamente mais estrito que `public.check_user_is_admin` do banco, que
 * também aceita 'manager'. Nenhum usuário tem papel 'manager' hoje; conceder a
 * um papel inexistente é abrir porta para um cadastro futuro que ninguém vai
 * revisar.
 */
const ADMIN_ROLES = ['admin', 'super_admin']

export type AuthResult =
    | { ok: true; userId: string; role: string }
    | { ok: false; status: 401 | 403; error: string }

/**
 * Portão de identidade das funções financeiras.
 *
 * Precisa existir DENTRO da função, não só como `verify_jwt = true` no
 * config.toml: a chave `anon` do projeto é um JWT válido e assinado, viaja no
 * bundle público do front, e passa pelo gateway do Supabase sem obstáculo.
 * `verify_jwt` prova que o chamador tem *uma* chave do projeto — que é pública.
 * Só `auth.getUser(token)` prova que existe um usuário logado por trás.
 *
 * O client passado precisa ser o de SERVICE_ROLE, para que a leitura de
 * `profiles` não esbarre no RLS.
 */
export async function requireAdmin(req: Request, supabase: SupabaseClient): Promise<AuthResult> {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
        return { ok: false, status: 401, error: 'Autenticação obrigatória.' }
    }

    const token = authHeader.replace('Bearer ', '').trim()
    const { data: { user }, error } = await supabase.auth.getUser(token)

    // A chave anon cai exatamente aqui: é um JWT assinado, mas não tem usuário.
    if (error || !user) {
        return { ok: false, status: 401, error: 'Sessão inválida ou expirada.' }
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

    if (!profile || !ADMIN_ROLES.includes(profile.role)) {
        return { ok: false, status: 403, error: 'Sem permissão para operações financeiras.' }
    }

    return { ok: true, userId: user.id, role: profile.role }
}

/**
 * Portão para endpoints que um usuário comum precisa chamar (ex.: recarga do
 * próprio saldo). Exige sessão real, não exige papel administrativo.
 *
 * Quem usa isto tem obrigação extra: derivar do `userId` retornado tudo o que
 * identifica o dono da operação. Aceitar um `user_id` do corpo depois de ter
 * autenticado o chamador é pior que não autenticar, porque parece seguro.
 */
export async function requireUser(req: Request, supabase: SupabaseClient): Promise<AuthResult> {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
        return { ok: false, status: 401, error: 'Autenticação obrigatória.' }
    }

    const token = authHeader.replace('Bearer ', '').trim()
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
        return { ok: false, status: 401, error: 'Sessão inválida ou expirada.' }
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

    return { ok: true, userId: user.id, role: profile?.role ?? 'unknown' }
}
```

- [ ] **Step 5: Reescrever o topo de `transfer-asaas-pix/index.ts`**

Substituir da primeira linha até o fim do bloco `// 2. Initialize Supabase Client` (linhas 1–36 do arquivo atual) por:

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import { corsHeaders } from "../_shared/cors.ts"
import { requireAdmin } from "../_shared/auth.ts"

const json = (body: unknown, status: number) => new Response(
    JSON.stringify(body),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
)

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    // Portão de identidade ANTES de ler o corpo da requisição.
    const auth = await requireAdmin(req, supabase)
    if (!auth.ok) {
        return json({ error: auth.error }, auth.status)
    }

    try {
        const body = await req.json()
        const amount = body.amount ?? body.value
        const pixKey = body.pixKey ?? body.pix_key
        const pixKeyType = body.pixKeyType ?? body.pix_key_type
        const description = body.description
        const usinaId = body.usinaId ?? body.usina_id
        const supplierId = body.supplierId ?? body.supplier_id
        const destinationType = body.destinationType ?? (supplierId ? 'supplier' : 'usina')
        const destinationId = supplierId ?? usinaId

        // 1. Validation
        if (!amount || !pixKey) {
            throw new Error('Missing required fields: amount or pixKey')
        }
```

O restante do arquivo (throttle, leitura de config, chamada Asaas, insert) fica intacto nesta task — a Task 2 mexe nele. Remover apenas a antiga declaração `const corsHeaders = {...}` do arquivo, já que agora vem do import.

- [ ] **Step 6: Rodar o lint**

Run: `npm run lint`
Expected: sem erros novos. Se o ESLint não cobrir `supabase/functions` (é código Deno), pule — não force configuração nova nesta task.

- [ ] **Step 7: Ligar `verify_jwt` no `config.toml`**

Trocar o bloco existente:

```toml
[functions.transfer-asaas-pix]
verify_jwt = false
```

por:

```toml
[functions.transfer-asaas-pix]
verify_jwt = true
```

- [ ] **Step 8: Deploy da função**

```bash
npx supabase functions deploy transfer-asaas-pix --project-ref abbysvxnnhwvvzhftoms
```

- [ ] **Step 9: Sonda sem credencial nenhuma — o teste que importa**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SB_URL/functions/v1/transfer-asaas-pix" -H "Content-Type: application/json" -d '{}'
```

Expected: **`401`** (era `400` no Step 2).

- [ ] **Step 10: Sonda com a chave anon — o caminho real do atacante**

```bash
curl -s -X POST "$SB_URL/functions/v1/transfer-asaas-pix" -H "Authorization: Bearer $SB_ANON" -H "apikey: $SB_ANON" -H "Content-Type: application/json" -d '{}'
```

Expected: corpo `{"error":"Sessão inválida ou expirada."}` com status `401`.

Este é o passo que separa a correção real da aparente. Se voltar `400` ("Missing required fields"), o portão **não** está funcionando: a chave anon atravessou. Nesse caso o erro quase certamente é `requireAdmin` sendo chamado depois do `req.json()`, ou o resultado dele não sendo retornado.

- [ ] **Step 11: Confirmar que o CRM real continua funcionando**

Abrir o CRM logado como `admin`, ir em um fornecedor com chave PIX cadastrada e abrir o modal de pagamento **sem confirmar o pagamento**. O que se verifica aqui é que a sessão do navegador chega na função: `supabase.functions.invoke` anexa o JWT da sessão automaticamente, então os três chamadores vivos (`src/components/SupplierModal.jsx:300`, `src/components/SupplierModal.jsx:387`, `src/pages/dashboards/BillingList.jsx:74`) continuam autorizados.

Se quiser prova sem mover dinheiro: no console do navegador, com a sessão aberta,

```js
await supabase.functions.invoke('transfer-asaas-pix', { body: {} })
```

Expected: erro `Missing required fields: amount or pixKey` — ou seja, passou pelo portão e parou na validação. Um `401` aqui significa que você quebrou o CRM.

- [ ] **Step 12: Commit**

```bash
git add supabase/functions/_shared/cors.ts supabase/functions/_shared/auth.ts supabase/functions/transfer-asaas-pix/index.ts supabase/config.toml
git commit -m "fix(seguranca): exigir usuario admin autenticado em transfer-asaas-pix

A funcao aceitava POST anonimo com amount e pixKey arbitrarios e disparava
PIX real da conta Asaas de producao. verify_jwt estava false e nao havia
nenhuma checagem de identidade no corpo.

verify_jwt=true sozinho nao resolveria: a chave anon e um JWT valido e
publica. O portao real e o auth.getUser + papel admin em _shared/auth.ts."
```

---

## Task 2: O destino do PIX passa a vir do cadastro, não do corpo da requisição

Task 1 exige que o chamador seja admin. Esta task garante que nem um admin (nem alguém com a sessão de um admin) consiga mandar dinheiro para uma chave PIX que não está cadastrada no sistema.

**Files:**
- Modify: `supabase/functions/transfer-asaas-pix/index.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `corsHeaders`, `json` da Task 1.
- Produces: contrato novo do corpo da requisição — `{ amount: number, supplierId?: uuid, usinaId?: uuid, description?: string }`. `pixKey` e `pixKeyType` no corpo passam a ser **ignorados**. Nenhuma task posterior depende disso.

**Contexto de dados, verificado em produção:**
- `suppliers` tem `pix_key` e `pix_key_type`.
- `usinas` **não** tem `pix_key` — tem `supplier_id`. Portanto o caminho "usina" resolve via `usinas.supplier_id → suppliers`.
- `src/components/PlantClosingModal.jsx:250` manda `pixKey: usina.pix_key`, um campo que não existe. É código morto (o `handlePayout` tem um `return` cedo, conforme item 9 dos achados de 08/08) e não precisa continuar funcionando.

- [ ] **Step 1: Sonda que estabelece o comportamento atual**

Com uma sessão de admin no console do navegador do CRM:

```js
await supabase.functions.invoke('transfer-asaas-pix', { body: { amount: 0.01, pixKey: 'chave-que-nao-existe@exemplo.com', pixKeyType: 'EMAIL' } })
```

Expected **agora**: a função aceita e tenta transferir para `chave-que-nao-existe@exemplo.com` (o erro que voltar vem da Asaas, não da nossa validação). Ao final desta task, o esperado é `Informe supplierId ou usinaId.` **antes** de qualquer chamada à Asaas.

Use `0.01` e uma chave sintaticamente inválida. Se a Asaas aceitar, é um centavo.

- [ ] **Step 2: Substituir o bloco de validação e destino**

Trocar o bloco `// 1. Validation` (e a leitura de `pixKey`/`pixKeyType` do corpo, do Step 5 da Task 1) por:

```ts
        const body = await req.json()
        const amount = body.amount ?? body.value
        const description = body.description
        const usinaId = body.usinaId ?? body.usina_id
        const supplierId = body.supplierId ?? body.supplier_id

        if (!amount || Number(amount) <= 0) {
            throw new Error('Valor da transferência ausente ou não positivo.')
        }

        // O destino vem do cadastro, nunca do corpo da requisição. pixKey e
        // pixKeyType enviados pelo cliente são ignorados de propósito: aceitar
        // destino arbitrário foi o que transformou esta função num saque.
        let destinationType: string
        let destinationId: string
        let supplierRow: { pix_key: string | null; pix_key_type: string | null } | null = null

        if (supplierId) {
            destinationType = 'supplier'
            destinationId = supplierId
            const { data } = await supabase
                .from('suppliers')
                .select('pix_key, pix_key_type')
                .eq('id', supplierId)
                .single()
            supplierRow = data
        } else if (usinaId) {
            destinationType = 'usina'
            destinationId = usinaId
            const { data: usina } = await supabase
                .from('usinas')
                .select('supplier_id')
                .eq('id', usinaId)
                .single()
            if (!usina?.supplier_id) {
                throw new Error('Usina sem fornecedor vinculado — não há destino cadastrado.')
            }
            const { data } = await supabase
                .from('suppliers')
                .select('pix_key, pix_key_type')
                .eq('id', usina.supplier_id)
                .single()
            supplierRow = data
        } else {
            throw new Error('Informe supplierId ou usinaId. Transferência sem destino cadastrado não é permitida.')
        }

        if (!supplierRow?.pix_key) {
            throw new Error('Destino sem chave PIX cadastrada.')
        }

        const pixKey = supplierRow.pix_key
        const pixKeyType = supplierRow.pix_key_type
```

- [ ] **Step 3: Corrigir o throttle que se pula sozinho**

O throttle atual está dentro de `if (destinationId)`. Como `destinationId` era opcional, bastava omitir `usinaId`/`supplierId` para pular a proteção inteira. Depois do Step 2 `destinationId` é sempre preenchido, então o `if` deixa de ser condicional — mas deixá-lo ali convida a regressão. Trocar:

```ts
        if (destinationId) {
            const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
            const { data: recentTransfers } = await supabase
```

por:

```ts
        // Sem `if`: destinationId é obrigatório desde a validação acima. O
        // throttle antigo vivia dentro de um `if (destinationId)` e quem
        // omitisse o destino pulava a proteção inteira.
        {
            const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
            const { data: recentTransfers } = await supabase
```

- [ ] **Step 4: Deploy**

```bash
npx supabase functions deploy transfer-asaas-pix --project-ref abbysvxnnhwvvzhftoms
```

- [ ] **Step 5: Verificar que destino arbitrário é recusado**

Console do navegador, sessão admin:

```js
await supabase.functions.invoke('transfer-asaas-pix', { body: { amount: 0.01, pixKey: 'chave-que-nao-existe@exemplo.com', pixKeyType: 'EMAIL' } })
```

Expected: `Informe supplierId ou usinaId. Transferência sem destino cadastrado não é permitida.` — e nenhuma linha nova em `financial_transfers`.

- [ ] **Step 6: Verificar que a sonda anônima continua barrada**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SB_URL/functions/v1/transfer-asaas-pix" -H "Authorization: Bearer $SB_ANON" -H "apikey: $SB_ANON" -H "Content-Type: application/json" -d '{"amount":1,"supplierId":"83dfcbcd-eab4-4a1c-9da4-5360ee96331a"}'
```

Expected: `401`. Aqui o payload é um destino **real** e válido — é o teste de que o portão da Task 1 aguenta um payload bem formado, não só um `{}`.

- [ ] **Step 7: Confirmar que o pagamento legítimo continua de pé**

Em `src/components/SupplierModal.jsx:300` o corpo já manda `supplier_id`. Confirmar no código que manda — se não mandar, ajustar o chamador para incluir `supplierId: formData.id` antes de considerar a task pronta. Mesmo para `src/pages/dashboards/BillingList.jsx:74`, que hoje manda `pix_key` mas precisa passar a mandar `supplierId: supplier.id`.

```bash
grep -n "supplier_id\|supplierId\|usinaId" src/components/SupplierModal.jsx src/pages/dashboards/BillingList.jsx
```

Se algum chamador não enviar id de destino, edite-o para enviar. Um chamador que só mandava `pix_key` passa a receber `Informe supplierId ou usinaId` — quebra silenciosa de pagamento se não for corrigido agora.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/transfer-asaas-pix/index.ts src/components/SupplierModal.jsx src/pages/dashboards/BillingList.jsx
git commit -m "fix(seguranca): derivar chave PIX do cadastro em vez do corpo da requisicao

pixKey e pixKeyType vindos do cliente passam a ser ignorados. O destino e
resolvido por supplierId, ou por usinaId -> usinas.supplier_id -> suppliers.

Corrige tambem o throttle anti-fraude, que vivia dentro de
if (destinationId) e era pulado por quem omitisse o destino."
```

---

## Task 3: Trilha de auditoria — registrar quem pediu cada transferência

Hoje `financial_transfers` não guarda autor. Se houver uma próxima movimentação estranha, a pergunta "quem disparou" continua sem resposta no banco.

**Files:**
- Create: `supabase/migrations/20260819_financial_transfers_requested_by.sql`
- Modify: `supabase/functions/transfer-asaas-pix/index.ts`

**Interfaces:**
- Consumes: `auth.userId` de `requireAdmin` (Task 1).
- Produces: coluna `financial_transfers.requested_by uuid`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Trilha de autoria das transferências PIX.
--
-- Nullable de propósito: as 6 linhas históricas foram criadas quando a função
-- era anônima e não há como atribuí-las a ninguém. Preencher com um id
-- qualquer seria inventar um fato.
ALTER TABLE public.financial_transfers
    ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.financial_transfers.requested_by IS
    'Usuário autenticado que disparou a transferência. NULL nas linhas anteriores a 19/08/2026, quando a Edge Function aceitava chamada anônima.';
```

- [ ] **Step 2: Aplicar a migration**

```bash
npx supabase db push --project-ref abbysvxnnhwvvzhftoms
```

- [ ] **Step 3: Verificar que a coluna existe**

```bash
npx supabase db execute --project-ref abbysvxnnhwvvzhftoms "select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='financial_transfers' and column_name='requested_by'"
```

Expected: uma linha, `requested_by | YES`.

- [ ] **Step 4: Gravar o autor no insert**

Em `transfer-asaas-pix/index.ts`, no bloco `// 4. Record the transfer request in the database`, trocar:

```ts
            .insert({
                amount: amount,
                destination_type: destinationType,
                destination_id: destinationId,
                status: dbStatus,
                asaas_transfer_id: transferId
            })
```

por:

```ts
            .insert({
                amount: amount,
                destination_type: destinationType,
                destination_id: destinationId,
                status: dbStatus,
                asaas_transfer_id: transferId,
                requested_by: auth.userId
            })
```

- [ ] **Step 5: Deploy e verificação**

```bash
npx supabase functions deploy transfer-asaas-pix --project-ref abbysvxnnhwvvzhftoms
```

Fazer um repasse real pequeno pelo CRM (ou o próximo repasse legítimo que estiver na fila) e conferir:

```bash
npx supabase db execute --project-ref abbysvxnnhwvvzhftoms "select id, created_at, amount, requested_by from financial_transfers order by created_at desc limit 3"
```

Expected: a linha nova tem `requested_by` preenchido; as antigas seguem `NULL`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260819_financial_transfers_requested_by.sql supabase/functions/transfer-asaas-pix/index.ts
git commit -m "feat(auditoria): registrar autor da transferencia em financial_transfers"
```

---

## Task 4: Fechar as demais funções financeiras anônimas

Quatro funções ainda aceitam chamada anônima e usam a chave Asaas de produção. Nenhuma delas move dinheiro para fora como o PIX, mas todas operam sobre a conta: criar, alterar e cancelar cobranças, e criar clientes. `manage-asaas-customer` ainda aceita `{ test: true }`, que faz uma chamada autenticada à Asaas e devolve sucesso/erro — um oráculo anônimo para descobrir se a chave está válida.

**Files:**
- Modify: `supabase/functions/manage-asaas-customer/index.ts`
- Modify: `supabase/functions/create-asaas-charge/index.ts`
- Modify: `supabase/functions/update-asaas-charge/index.ts`
- Modify: `supabase/functions/cancel-asaas-charge/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `requireAdmin`, `corsHeaders` da Task 1.
- Produces: nada que tasks posteriores usem.

- [ ] **Step 1: Sondas iniciais — registrar o estado atual das quatro**

```bash
for f in manage-asaas-customer create-asaas-charge update-asaas-charge cancel-asaas-charge; do printf "%-26s %s\n" "$f" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB_URL/functions/v1/$f" -H 'Content-Type: application/json' -d '{}')"; done
```

Expected agora: nenhuma devolve `401`. Anote os códigos.

- [ ] **Step 2: Aplicar o portão nas quatro funções**

Em cada um dos quatro `index.ts`, fazer a mesma transformação:

1. Remover a declaração local `const corsHeaders = {...}` e importar:

```ts
import { corsHeaders } from "../_shared/cors.ts"
import { requireAdmin } from "../_shared/auth.ts"
```

2. Mover a criação do client de service role para **antes** do `try`, e inserir o portão logo depois — antes de qualquer `req.json()`:

```ts
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const auth = await requireAdmin(req, supabase)
    if (!auth.ok) {
        return new Response(
            JSON.stringify({ error: auth.error }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: auth.status }
        )
    }

    try {
```

3. Remover a criação duplicada do client que ficou dentro do `try`.

- [ ] **Step 3: Remover o log da chave em `manage-asaas-customer`**

Apagar a linha:

```ts
        console.log(`Config found: URL=${asaasUrl}, Key=${asaasKey.substring(0, 10)}...`);
```

Substituir por:

```ts
        console.log(`Config found: URL=${asaasUrl}`);
```

Os logs de Edge Function são legíveis por qualquer pessoa com acesso ao painel do projeto e ficam retidos. Dez caracteres iniciais não abrem a conta, mas confirmam ambiente e prefixo para quem já tem um fragmento.

- [ ] **Step 4: Ligar `verify_jwt` no `config.toml`**

Trocar `verify_jwt = false` para `verify_jwt = true` nos quatro blocos:
`[functions.create-asaas-charge]`, `[functions.update-asaas-charge]`, `[functions.cancel-asaas-charge]`, `[functions.manage-asaas-customer]`.

**Não** mexer em `[functions.asaas-webhook]`, `[functions.autentique-webhook]` nem `[functions.onboarding-finalizar]`: os dois primeiros são chamados por servidores externos que não têm JWT (o webhook da Asaas valida por `asaas-access-token` contra `secret_key`, que já está implementado), e o terceiro roda na página pública de adesão, como diz o comentário no próprio arquivo.

- [ ] **Step 5: Deploy das quatro**

```bash
for f in manage-asaas-customer create-asaas-charge update-asaas-charge cancel-asaas-charge; do npx supabase functions deploy "$f" --project-ref abbysvxnnhwvvzhftoms; done
```

- [ ] **Step 6: Repetir as sondas — agora todas devem barrar**

```bash
for f in manage-asaas-customer create-asaas-charge update-asaas-charge cancel-asaas-charge; do printf "%-26s anon=%s sem-header=%s\n" "$f" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB_URL/functions/v1/$f" -H "Authorization: Bearer $SB_ANON" -H "apikey: $SB_ANON" -H 'Content-Type: application/json' -d '{}')" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB_URL/functions/v1/$f" -H 'Content-Type: application/json' -d '{}')"; done
```

Expected: `401` nas oito medições.

- [ ] **Step 7: Verificar que o webhook da Asaas não foi afetado**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SB_URL/functions/v1/asaas-webhook" -H 'Content-Type: application/json' -d '{}'
```

Expected: `401` vindo da própria função (token de webhook ausente), **não** do gateway — e a função continua alcançável sem JWT. Se voltar `401` do gateway, `verify_jwt` foi ligado por engano no `asaas-webhook` e as confirmações de pagamento da Asaas param de chegar.

- [ ] **Step 8: Fumaça no CRM**

Logado como admin: abrir a tela de cobranças e emitir uma cobrança de teste, e em Configurações → Integração Financeira usar o botão de testar conexão. Ambos devem funcionar como antes.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/manage-asaas-customer/index.ts supabase/functions/create-asaas-charge/index.ts supabase/functions/update-asaas-charge/index.ts supabase/functions/cancel-asaas-charge/index.ts supabase/config.toml
git commit -m "fix(seguranca): exigir admin autenticado nas funcoes de cobranca Asaas

As quatro aceitavam chamada anonima usando a chave de producao. Remove
tambem o console.log que imprimia os 10 primeiros caracteres da chave."
```

---

## Task 5: `create-asaas-token-charge` — usuário autenticado, e o dono da cobrança vem do token

Esta função **não** pode receber o portão de admin: quem a chama é `src/pages/StandaloneRecharge.jsx`, a tela em que um usuário comum recarrega o próprio saldo. Exigir `admin` aqui quebraria a recarga para todo mundo.

O problema dela é outro, e é sério: `user_id` **e `price`** vêm do corpo da requisição. Com a chave `anon` (pública) e `verify_jwt = true` no gateway, a função hoje aceita qualquer corpo — e mesmo depois de exigir sessão, um usuário logado pode declarar o preço que quiser da própria recarga, ou emitir cobrança em nome de outro usuário.

**Files:**
- Modify: `supabase/functions/create-asaas-token-charge/index.ts`

**Interfaces:**
- Consumes: `requireUser`, `corsHeaders` da Task 1.
- Produces: contrato novo do corpo — `{ token_amount: number }`. `user_id` e `price` no corpo passam a ser ignorados.

- [ ] **Step 1: Sonda inicial**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SB_URL/functions/v1/create-asaas-token-charge" -H "Authorization: Bearer $SB_ANON" -H "apikey: $SB_ANON" -H 'Content-Type: application/json' -d '{}'
```

Expected agora: **não** `401` — a chave anon atravessa o `verify_jwt = true` e a função responde `Faltam parâmetros obrigatórios.` Esta sonda é a demonstração mais limpa de por que `verify_jwt` sozinho não protege nada: a função **já está** com `verify_jwt: true` no deploy e mesmo assim atende um chamador sem usuário nenhum.

- [ ] **Step 2: Descobrir de onde o preço deve vir**

```bash
grep -n "price\|pkg\|PACKAGES\|token_amount" src/pages/StandaloneRecharge.jsx | head -30
```

Os pacotes hoje estão no cliente. Se existir tabela de pacotes no banco, use-a como fonte do preço. Se **não** existir, não invente uma nesta task: fixe a tabela de preços como constante no topo da Edge Function, que é código de servidor e o usuário não edita:

```ts
// Tabela de preços do servidor. Enquanto os pacotes viverem só no cliente,
// é aqui que eles viram fato: preço vindo do corpo da requisição é preço
// escolhido por quem paga.
const TOKEN_PACKAGES: Record<number, number> = {
    // token_amount: price em R$ — copiar os valores exatos de StandaloneRecharge.jsx
}
```

Copie os pares exatos do arquivo do front. Se os dois divergirem depois, a função recusa e ninguém paga errado em silêncio — que é o comportamento desejado.

- [ ] **Step 3: Aplicar o portão e derivar dono e preço**

Substituir o topo do arquivo (imports + declaração local de `corsHeaders`) e o bloco de leitura do corpo por:

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"
import { corsHeaders } from "../_shared/cors.ts"
import { requireUser } from "../_shared/auth.ts"

const TOKEN_PACKAGES: Record<number, number> = {
    // preencher no Step 2
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const auth = await requireUser(req, supabase)
    if (!auth.ok) {
        return new Response(
            JSON.stringify({ error: auth.error }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: auth.status }
        )
    }

    try {
        const { token_amount } = await req.json()

        // O dono da cobrança é quem está logado, não quem o corpo diz ser.
        const user_id = auth.userId

        // O preço é o do servidor. O corpo não opina.
        const price = TOKEN_PACKAGES[Number(token_amount)]
        if (price === undefined) {
            throw new Error(`Pacote de ${token_amount} tokens não existe.`)
        }
```

Remover a criação duplicada do client dentro do `try` e a validação antiga `if (!token_amount || !price || !user_id)`.

- [ ] **Step 4: Deploy**

```bash
npx supabase functions deploy create-asaas-token-charge --project-ref abbysvxnnhwvvzhftoms
```

- [ ] **Step 5: Verificar que a chave anon não passa mais**

```bash
curl -s -X POST "$SB_URL/functions/v1/create-asaas-token-charge" -H "Authorization: Bearer $SB_ANON" -H "apikey: $SB_ANON" -H 'Content-Type: application/json' -d '{"token_amount":100}'
```

Expected: `{"error":"Sessão inválida ou expirada."}`, status `401`.

- [ ] **Step 6: Verificar que preço forjado é recusado**

No console do navegador, logado como usuário comum na tela de recarga:

```js
await supabase.functions.invoke('create-asaas-token-charge', { body: { token_amount: 100, price: 0.01, user_id: 'qualquer-outro-uuid' } })
```

Expected: a cobrança sai pelo preço real do pacote de 100 tokens e em nome do **próprio** usuário logado — `price` e `user_id` do corpo ignorados. Confira o valor e o cliente da cobrança gerada antes de dar a task por pronta.

- [ ] **Step 7: Fumaça na tela de recarga**

Abrir `StandaloneRecharge`, escolher um pacote e gerar a cobrança. Deve funcionar como antes, com o mesmo valor exibido na tela.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/create-asaas-token-charge/index.ts
git commit -m "fix(seguranca): exigir sessao e derivar dono e preco no servidor na recarga

user_id e price vinham do corpo da requisicao: dava para emitir cobranca em
nome de outro usuario e escolher o proprio preco. Agora o dono vem do token
e o preco de uma tabela no servidor.

Portao e requireUser, nao requireAdmin: a tela de recarga e' de usuario
comum e exigir admin quebraria a funcionalidade."
```

---

## Task 6: Alinhar a migration de `integrations_config` com a produção

A produção já tem a policy correta (`integrations_config_admin_only`, com `check_user_is_admin(auth.uid())`). O arquivo de migration, não: ele cria uma policy que dá acesso total a **qualquer** usuário autenticado — incluindo os papéis `lead`, `subscriber`, `originator` e `supplier`, que se cadastram sozinhos pelo onboarding público. Rodar as migrations do zero, ou reaplicar esse arquivo, reabre o acesso à chave.

**Files:**
- Modify: `supabase/migrations/20260131_create_integrations_config.sql`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Confirmar o estado real da produção antes de escrever**

```bash
npx supabase db execute --project-ref abbysvxnnhwvvzhftoms "select polname, coalesce(pg_get_expr(polqual, polrelid),'-') as using_expr from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='integrations_config'"
```

Expected: uma linha — `integrations_config_admin_only | check_user_is_admin(auth.uid())`.

Se voltar outra coisa, **pare e reporte**: significa que a produção regrediu desde o levantamento e a prioridade muda.

- [ ] **Step 2: Corrigir a policy no arquivo**

Substituir o bloco final do arquivo:

```sql
-- Policies (Restrict access to Admins ideally, but for now allow authenticated)
CREATE POLICY "Enable all for authenticated users" 
ON integrations_config FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);
```

por:

```sql
-- Policy: somente administradores.
--
-- A versão original desta migration liberava para qualquer `authenticated`
-- com USING (true). Como o onboarding público cria login para leads e
-- assinantes, "authenticated" inclui qualquer visitante que se cadastrou —
-- e esta tabela guarda a chave de produção da Asaas em texto puro.
--
-- A produção já foi corrigida à mão em algum momento; este arquivo ficou
-- para trás. Um `db reset` reintroduziria o buraco em silêncio.
DROP POLICY IF EXISTS "Enable all for authenticated users" ON integrations_config;

CREATE POLICY integrations_config_admin_only
ON integrations_config FOR ALL
TO authenticated
USING (public.check_user_is_admin(auth.uid()))
WITH CHECK (public.check_user_is_admin(auth.uid()));
```

- [ ] **Step 3: Verificar que a migration é idempotente contra a produção**

```bash
npx supabase db push --project-ref abbysvxnnhwvvzhftoms --dry-run
```

Expected: nenhuma alteração pendente que recrie a policy antiga. Como o arquivo já foi aplicado, o `db push` não vai reexecutá-lo — o valor da correção é para o próximo `db reset` ou ambiente novo. Se o dry-run indicar que vai reaplicar, **pare**: reaplicar um `CREATE TABLE IF NOT EXISTS` é inócuo, mas confirme antes de deixar rodar.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260131_create_integrations_config.sql
git commit -m "fix(seguranca): migration de integrations_config restringe a admin

O arquivo criava policy com USING(true) para authenticated, o que inclui
leads e assinantes criados pelo onboarding publico. A producao ja estava
corrigida a mao; o arquivo reintroduziria o buraco num db reset."
```

---

## Task 7: Apagar os scripts que despejam a configuração e o código morto do PIX

**Files:**
- Delete: `check_asaas_config.js`
- Delete: `list_all_configs.js`
- Modify: `src/components/PlantClosingModal.jsx`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Confirmar que ninguém importa os dois scripts**

```bash
grep -rn "check_asaas_config\|list_all_configs" --include=*.js --include=*.jsx --include=*.json --include=*.yml . | grep -v node_modules
```

Expected: nenhuma linha além dos próprios arquivos. Se `package.json` ou algum workflow referenciar, pare e reporte.

- [ ] **Step 2: Apagar os dois scripts**

```bash
git rm check_asaas_config.js list_all_configs.js
```

São scripts de depuração na raiz de um repositório público cuja única função é `select('*')` em `integrations_config` e imprimir o resultado — `api_key` e `secret_key` de produção incluídos. Eles não vazaram a chave (o `select` roda com a chave `anon`, que a policy de admin barra), mas documentam publicamente onde ela mora e como buscá-la.

- [ ] **Step 3: Apagar o corpo morto de `handlePayout`**

Em `src/components/PlantClosingModal.jsx`, `handlePayout` começa na **linha 212**. O corpo tem um `return` cedo que desarma a função, e abaixo dele todo o código original inalcançável — incluindo a chamada real a `transfer-asaas-pix` na linha 247 — entre `/* eslint-disable no-unreachable */` na **linha 236** e `/* eslint-enable no-unreachable */` na **linha 354**.

Apagar as linhas **236 a 354 inclusive**, preservando o `return` cedo e tudo o que vem antes dele. Confirmar os limites antes de cortar (o arquivo pode ter mudado):

```bash
grep -n "no-unreachable\|handlePayout" src/components/PlantClosingModal.jsx
```

Expected: `212: const handlePayout`, `236: /* eslint-disable no-unreachable */`, `354: /* eslint-enable no-unreachable */`, e uma referência em comentário na linha 579 — **essa última fica**, é a explicação do botão desarmado na UI.

O código apagado está preservado no git (`git show cbc6e66^:src/components/PlantClosingModal.jsx`) e descrito em prosa na spec §1.2. Entre esse `return` e um PIX real existem um merge mal resolvido ou um refactor que remove early-returns — e essa chamada manda `pixKey: usina.pix_key`, um campo que **não existe** na tabela `usinas`, então ela nem funcionaria: falharia depois de já ter passado pelo portão.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: sem erros. Se o `eslint-disable no-unreachable` ficou órfão (sem código inalcançável abaixo), o ESLint acusa diretiva não utilizada — remova a diretiva também.

- [ ] **Step 5: Build, para garantir que o front não quebrou**

Run: `npm run build`
Expected: build conclui sem erro.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/PlantClosingModal.jsx
git commit -m "chore(seguranca): remover scripts que despejam integrations_config e codigo PIX morto

check_asaas_config.js e list_all_configs.js faziam select('*') na tabela
que guarda a chave Asaas, na raiz de um repositorio publico.

handlePayout tinha o corpo original inteiro abaixo de um return cedo, sob
eslint-disable no-unreachable, incluindo a chamada real a
transfer-asaas-pix. O corpo esta em cbc6e66^ e na spec 1.2."
```

---

## Task 8: Varredura final e relatório de fechamento

**Files:**
- Create: `docs/superpowers/specs/2026-08-19-relatorio-exposicao-asaas.md`

**Interfaces:**
- Consumes: resultados de todas as tasks anteriores.
- Produces: nada.

- [ ] **Step 1: Sonda completa de todas as funções que tocam a Asaas**

```bash
for f in transfer-asaas-pix pay-asaas-bill pagar-conta-ug create-asaas-charge update-asaas-charge cancel-asaas-charge manage-asaas-customer create-asaas-token-charge; do printf "%-28s %s\n" "$f" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SB_URL/functions/v1/$f" -H "Authorization: Bearer $SB_ANON" -H "apikey: $SB_ANON" -H 'Content-Type: application/json' -d '{}')"; done
```

Expected: `401` em todas as oito.

**`pagar-conta-ug` é a exceção que já está correta — não aplique o portão da Task 4 nela.** Ela tem `verify_jwt: false` de propósito: quem a chama é o próprio banco, via `pg_net`, dentro de `fechar_producao`, e pg_net não carrega JWT de usuário. A autenticação dela é um segredo compartilhado no header `x-fechamento-token`, conferido contra `integrations_config.service_name = 'fechamento_hook'`, e é a **primeira** coisa que a função faz, fora do `try`, antes de ler o corpo. Ela também deriva do banco a linha digitável e o valor (recusando divergência acima de meio centavo), tem guarda de idempotência e trata a fronteira do dinheiro explicitamente. Ela devolve `401` sem o header — que é o resultado esperado da sonda. Se alguém "corrigir" essa função com `requireAdmin`, o fechamento mensal para de pagar as contas das UGs.

Se qualquer **outra** função da lista não devolver `401`, aplique nela o portão da Task 4 antes de seguir.

- [ ] **Step 2: Confirmar que a chave nova não vazou para lugar nenhum**

```bash
git grep -I -n -F '$aact_' $(git rev-list --all) | head
```

Expected: nenhuma saída. Rodar depois da troca de chave feita pelo dono, para confirmar que a nova também não foi commitada.

- [ ] **Step 3: Conferir tabelas com RLS ligada e nenhuma policy**

Uma tabela com RLS ligada e zero policies nega tudo por RLS, mas o `GRANT` a `anon` continua lá — e basta alguém criar uma policy permissiva depois para abrir. Listar as que estão nesse estado:

```bash
npx supabase db execute --project-ref abbysvxnnhwvvzhftoms "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid=c.oid) order by 1"
```

Expected: `lead_access_codes` aparece (achado do levantamento de 19/08). Registrar a lista no relatório como pendência — este plano **não** trata dela.

- [ ] **Step 4: Escrever o relatório**

Criar `docs/superpowers/specs/2026-08-19-relatorio-exposicao-asaas.md` com, cada um em uma seção:

1. **O que estava aberto** — `transfer-asaas-pix` anônima com `amount`/`pixKey` livres; repositório público anunciando `verify_jwt = false`; quatro funções de cobrança anônimas; throttle contornável por omissão do destino; migration de `integrations_config` liberando qualquer `authenticated`.
2. **O que não estava** — chave nunca commitada (varredura de `$aact_` no working tree e em todo o histórico: zero); `.env` e `dist` fora do rastreamento; RLS de produção já em admin-only; escalação por `profiles` barrada pelo trigger `tr_protect_profile_privileges`.
3. **O que foi corrigido** — uma linha por task, com o código HTTP antes e depois.
4. **O que continua em aberto** — repositório ainda público (se o dono não decidiu); `lead_access_codes` com RLS sem policy; `check_user_is_admin` do banco ainda aceita `manager`, papel sem nenhum usuário; a chave Asaas segue em texto puro em `integrations_config`, legível por qualquer admin do CRM pela tela de Configurações.
5. **Conciliação** — resultado do cruzamento entre o extrato `/transfers` da Asaas e as linhas de `financial_transfers`, preenchido pelo dono.

- [ ] **Step 5: Commit e abrir o PR**

```bash
git add docs/superpowers/specs/2026-08-19-relatorio-exposicao-asaas.md
git commit -m "docs(seguranca): relatorio de fechamento da exposicao Asaas"
git push -u origin fix/seguranca-asaas
```

Abrir PR de `fix/seguranca-asaas` para `main`.

**Atenção ao merge:** push em `main` dispara `deploy.yml` e republica o CRM em `crm.b2wenergia.com.br`. A branch `impl/fechamento-mensal` está segurada aguardando o Antigravity — este PR toca `src/components/PlantClosingModal.jsx`, `src/components/SupplierModal.jsx` e `src/pages/dashboards/BillingList.jsx`, então verifique conflito com o fechamento antes de mesclar. As correções de Edge Function e de banco (Tasks 1–5) **já estão em produção** pelo deploy direto e não dependem deste merge.

---

## Ordem e paralelismo

Tasks 1 e 2 são sequenciais e urgentes — Task 1 sozinha já fecha o acesso anônimo ao PIX. Tasks 3, 4, 5, 6 e 7 são independentes entre si e podem ir em qualquer ordem depois da Task 2. Task 8 é a última.

Se o tempo for curto, **Task 1 é a que não pode esperar.**

**Uma função que este plano deliberadamente não toca:** `pagar-conta-ug`. Ela é anônima por desenho (chamada pelo banco via `pg_net`, sem JWT possível) e já tem portão próprio por segredo compartilhado, além de derivar valor e boleto do banco. Ver a nota na Task 8, Step 1 — aplicar `requireAdmin` nela quebraria o fechamento mensal.
