# Relatório de fechamento — exposição da chave Asaas

**Data:** 19/08/2026
**Origem:** investigação aberta por movimentações não reconhecidas na conta Asaas da B2W.
**Plano executado:** [`2026-08-19-fechar-exposicao-asaas.md`](../plans/2026-08-19-fechar-exposicao-asaas.md)
**Branch:** `fix/seguranca-asaas`

---

## 1. O que estava aberto

### 1.1 🔴 `transfer-asaas-pix` disparava PIX para qualquer chave, sem autenticação

O achado central. A função tinha `verify_jwt = false` e **nenhuma** verificação de identidade no corpo: não lia `Authorization`, não chamava `getUser()`, não checava papel. Aceitava `amount` e `pixKey` direto do corpo da requisição, lia a chave de produção da Asaas com `SERVICE_ROLE_KEY`, e fazia `POST /transfers` com destino arbitrário. `Access-Control-Allow-Origin: '*'`.

Sonda antes da correção, sem nenhuma credencial:

```
POST /functions/v1/transfer-asaas-pix   {}
→ HTTP 400  {"error":"Missing required fields: amount or pixKey"}
```

Um `400` ali é a prova do buraco: a requisição anônima atravessou tudo e parou só na validação de campo. Bastava preencher `amount` e `pixKey`.

O único freio era um throttle de 2 minutos — dentro de `if (destinationId)`. Quem omitisse `usinaId`/`supplierId` **pulava o throttle inteiro**.

### 1.2 🔴 O repositório é público

`github.com/WaldineyGodoy/saas` está com `"private": false`. O `supabase/config.toml` público listava, linha a linha, quais funções dispensavam JWT, e cada `index.ts` público entregava o formato exato do payload. Receita pronta.

### 1.3 🟠 Quatro funções de cobrança anônimas

`create-asaas-charge`, `update-asaas-charge`, `cancel-asaas-charge` e `manage-asaas-customer` aceitavam chamada anônima usando a chave de produção. `manage-asaas-customer` ainda respondia a `{test: true}`, fazendo uma chamada autenticada à Asaas e devolvendo sucesso/erro — um oráculo anônimo para descobrir se a chave estava válida.

`manage-asaas-customer` também logava os 10 primeiros caracteres da chave. Logs de Edge Function ficam retidos e legíveis no painel do projeto.

### 1.4 🟠 `create-asaas-token-charge`: preço e dono escolhidos por quem paga

`user_id` e `price` vinham do corpo. Um usuário podia emitir cobrança em nome de outro, ou comprar tokens pelo preço que declarasse.

Esta função é a **demonstração mais limpa de que `verify_jwt` não protege nada sozinho**: ela já estava com `verify_jwt: true` no deploy e mesmo assim respondia `HTTP 200` a um chamador que só tinha a chave `anon` pública. A chave `anon` é um JWT válido e assinado, viaja no bundle do front, e passa pelo gateway do Supabase sem obstáculo. Só `auth.getUser(token)` prova que existe usuário.

### 1.5 🟡 A migration de `integrations_config` reintroduziria o buraco

O arquivo `20260131_create_integrations_config.sql` criava a policy `USING (true)` para qualquer `authenticated`. Como o onboarding público cria login para leads e assinantes, "authenticated" inclui qualquer visitante cadastrado — e a tabela guarda a chave de produção em texto puro. A produção já estava corrigida à mão; o arquivo, não. Um `db reset` reabriria em silêncio.

### 1.6 🟡 Scripts de depuração e código morto

`check_asaas_config.js` e `list_all_configs.js`, na raiz do repositório público, faziam `select('*')` em `integrations_config` e imprimiam o resultado.

`PlantClosingModal.handlePayout` tinha 119 linhas de código inalcançável abaixo de um `return` cedo, sob `eslint-disable no-unreachable`, incluindo a chamada real a `transfer-asaas-pix`.

---

## 2. O que **não** estava aberto

Verificado, e vale registrar para não virar caça a fantasma:

- **A chave nunca foi commitada.** Varredura de `$aact_` em todo o working tree de `Documents/HTML` (todos os projetos, não só o CRM) e em **todos os commits de todas as branches**: zero ocorrências. A chave vive apenas em `integrations_config`.
- **`.env` e `dist/` estão no `.gitignore`** e não são rastreados.
- **A RLS de `integrations_config` em produção já estava correta** — `integrations_config_admin_only`, com `check_user_is_admin(auth.uid())`.
- **Escalação de privilégio por `profiles` está barrada.** A policy de UPDATE permitiria ao usuário editar a própria linha sem `WITH CHECK`, mas o trigger `tr_protect_profile_privileges` restaura `role`, `superior_id` e `commission_split` para quem não é admin.
- **`pagar-conta-ug` está bem construída.** É anônima de propósito (chamada pelo banco via `pg_net`, que não carrega JWT), mas autentica por segredo compartilhado em `x-fechamento-token` antes de ler o corpo, deriva do banco a linha digitável e o valor, recusa divergência acima de meio centavo, e tem guarda de idempotência. **Não foi tocada** — aplicar `requireAdmin` nela quebraria o fechamento mensal.
- **`pay-asaas-bill` já tinha portão funcionando.** Rejeita com `"Invalid user token"` e nunca chega na Asaas.

---

## 3. O que foi corrigido

| # | Correção | Antes | Depois |
|---|---|---|---|
| 1 | Portão de identidade (`_shared/auth.ts`) + `verify_jwt` em `transfer-asaas-pix` | `400` sem credencial | `401` sem header, `401` com chave anon, `401` com chave anon + payload bem formado |
| 2 | Destino do PIX derivado do cadastro (`supplierId`, ou `usinaId → usinas.supplier_id → suppliers`); `pixKey` do corpo ignorada; throttle sem o `if` que o contornava | destino arbitrário aceito | destino sem cadastro recusado antes de qualquer chamada à Asaas |
| 3 | `financial_transfers.requested_by` gravando o autor | sem trilha de autoria | autor registrado a cada transferência |
| 4 | Portão nas quatro funções de cobrança + remoção do log da chave | nenhuma devolvia `401` | `401` nas quatro, com chave anon e sem header |
| 5 | `create-asaas-token-charge`: `requireUser`, dono vindo do token, preço de tabela no servidor | `HTTP 200` para chave anon; preço e dono do corpo | `401` para chave anon; contrato `{package_id, quantity}` |
| 6 | Migration de `integrations_config` alinhada com a produção | `USING (true)` para `authenticated` | `check_user_is_admin(auth.uid())` |
| 7 | Scripts de despejo apagados; 119 linhas de código PIX morto removidas | — | — |

**Varredura final, todas as funções que tocam a Asaas, com a chave `anon` pública:**

```
transfer-asaas-pix           401
pay-asaas-bill               200  ← ver §4.2, não é buraco
pagar-conta-ug               401
create-asaas-charge          401
update-asaas-charge          401
cancel-asaas-charge          401
manage-asaas-customer        401
create-asaas-token-charge    401
```

Nenhuma sonda moveu dinheiro: `financial_transfers` permaneceu em 6 linhas, última de 11/08.

---

## 4. O que continua em aberto

### 4.1 Ações do dono, ainda pendentes

1. **Revogar a chave de produção Asaas e gerar uma nova.** Enquanto a chave antiga viver, tudo acima é contenção, não cura. Atualizar em Configurações → Integração Financeira.
2. **Conciliar o extrato `/transfers` da Asaas contra `financial_transfers`.** Ver §5.
3. **Decidir sobre a visibilidade do repositório.** Torná-lo privado não desfaz o que já foi lido, mas para de distribuir o mapa.

### 4.2 `pay-asaas-bill` devolve `200` em falha de autenticação

Não é vulnerabilidade — o portão funciona e a Asaas nunca é chamada. Mas o `catch` genérico devolve `status: 200` para todo erro, inclusive o de autenticação. Efeito prático: uma varredura de segurança que procure status ≠ 200 marca esta função como aberta, e uma que procure = 200 marca como falha silenciosa. Não foi alterado de propósito: os chamadores do CRM leem `data.error` do corpo, e trocar o status quebraria o tratamento de erro deles para ganhar apenas legibilidade.

### 4.3 `lead_access_codes` tem RLS ligada e nenhuma policy

Hoje isso nega tudo via RLS, mas os `GRANT`s a `anon` continuam na tabela — basta alguém criar uma policy permissiva depois para abrir. Fora do escopo deste plano.

### 4.4 `check_user_is_admin` aceita `manager`

A função do banco autoriza `admin`, `super_admin` e `manager`. Nenhum usuário tem papel `manager` hoje (papéis em uso: `supplier` 4, `lead` 4, `originator` 3, `subscriber` 3, `admin` 2, `super_admin` 1). O `_shared/auth.ts` deliberadamente **não** replica `manager` — mas a policy de `integrations_config` ainda o aceita, então um futuro `manager` leria a chave.

### 4.5 A chave segue em texto puro no banco

`integrations_config.api_key` é legível por qualquer admin do CRM pela tela de Configurações, e por qualquer coisa com `SERVICE_ROLE_KEY`. Reduzir isso (Vault do Supabase, ou segredo de Edge Function em vez de linha de tabela) é uma frente própria.

### 4.6 Não verificado: o caminho legítimo do admin

As sondas provam que o acesso anônimo fechou. **Não foi possível verificar de dentro** que um admin real continua passando — isso exige credencial de admin, que não tenho. O que sustenta a expectativa: os papéis em `ADMIN_ROLES` batem com os dados reais, e o padrão `auth.getUser` + checagem de papel é o mesmo de `pay-asaas-bill`, em produção. **Precisa de confirmação na tela** antes de considerar a frente encerrada — ver §6.

---

## 5. Conciliação (a preencher pelo dono)

`financial_transfers` tem 6 linhas, todas para o fornecedor `83dfcbcd-eab4-4a1c-9da4-5360ee96331a`:

| data | valor |
|---|---:|
| 11/08/2026 | R$ 1.863,01 |
| 10/08/2026 | R$ 4.421,16 |
| 10/07/2026 | R$ 866,42 |
| 10/07/2026 | R$ 5.000,00 |
| 11/06/2026 | R$ 2.000,00 |
| 10/06/2026 | R$ 4.479,31 |

Todas coerentes com repasses de usina. **As movimentações não reconhecidas não estão aqui** — o que significa que não passaram pelo CRM.

Duas leituras possíveis, e o extrato da Asaas decide qual:

- **(a)** foram feitas direto contra a API da Asaas com a chave, ou pelo painel — fora do alcance deste código;
- **(b)** foram feitas por `transfer-asaas-pix` e o `insert` em `financial_transfers` falhou. O código antigo logava o erro e **retornava sucesso mesmo assim**, então isso é possível sem deixar rastro no banco.

A hipótese (b) não pode ser descartada pelo que existe hoje. A partir de agora `requested_by` fecha essa lacuna para o futuro.

Preencher aqui o resultado do cruzamento:

```
Transferências no extrato Asaas no período: ___
Com linha correspondente em financial_transfers: ___
Sem correspondência (investigar): ___
```

---

## 6. Confirmação pendente na tela

Antes de encerrar, logado como `admin` no CRM:

1. **Repasse a fornecedor** (`SupplierModal`) — abrir o modal de pagamento de um fornecedor com chave PIX cadastrada. Não precisa confirmar o pagamento; basta ver que a tela responde.
2. **Repasse por usina** (`BillingList`) — este é o que mudou de contrato (passou a mandar `usinaId` em vez de `pix_key`). É o de maior risco de regressão.
3. **Emissão de cobrança** e **botão de testar conexão** em Configurações → Integração Financeira.
4. **Recarga de tokens** (`StandaloneRecharge`), com um usuário comum: conferir que o valor cobrado bate com o da tela.

Prova sem mover dinheiro, no console do navegador com sessão de admin:

```js
await supabase.functions.invoke('transfer-asaas-pix', { body: {} })
```

Esperado: `Valor da transferencia ausente ou nao positivo.` — passou pelo portão e parou na validação. Um `401` aqui significa que o CRM quebrou.
