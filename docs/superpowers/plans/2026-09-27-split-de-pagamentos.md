# Split de Pagamentos (Plano de Recompensas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cada fatura paga divide o dinheiro pela matriz do Plano de Recompensas — B2W, Líder, Parceiro Power, Assinante Conect e fornecedor — com o plano como fonte única dos percentuais e o piso do fornecedor garantido.

**Architecture:** o plano (`planos_assinatura_energia`) passa a ser a fonte de gestão, desconto, modalidade e matriz. A UC e a usina apontam para ele. Um motor puro em SQL calcula o split a partir de (base, participantes, regras, piso); o gatilho de fatura paga só resolve os participantes na árvore, chama o motor, congela o resultado na fatura e lança no razão.

**Tech Stack:** Postgres/Supabase (SECURITY DEFINER, RLS, gatilhos), testes SQL `SANDBOX_OK`, React+Vite no CRM (telas ficam para um plano seguinte).

## Global Constraints

- Projeto Supabase: `abbysvxnnhwvvzhftoms`. Migrações: `supabase/migrations/20260927<letra>_*.sql`, aplicadas pelo MCP `apply_migration` com o mesmo nome.
- Testes SQL: bloco `DO $$ … $$` terminando em `RAISE EXCEPTION 'SANDBOX_OK'`; rodar pelo MCP `execute_sql`; **sucesso = erro `SANDBOX_OK`**. Nunca deixar resíduo.
- **Dinheiro real:** o razão de produção (`ledger_entries`) não pode ganhar, perder ou alterar lançamento por causa deste trabalho. Toda verificação compara a impressão digital (contagem + soma) antes e depois.
- **Substituição direta:** o motor antigo de comissão (`originators_v2.split_commission`) deixa de ser lido. Os R$ 135,91 já lançados na conta 2.1.2 (8 lançamentos, abr–ago/2026) ficam intactos.
- Percentuais (níveis **relativos a quem recebe**): B2W 10% fixo; Líder 1% nos níveis 1–3; PPE 5%/2%; PPP 4%/2%; PPF 2%/2%; Assinante Conect 2% só no nível 1. Piso do fornecedor: 50% da tarifa bruta, configurável por plano.
- PPP com licença anual vencida: **recorrência suspensa (0%) e o valor vai para a B2W**, não para o fornecedor (decisão do dono, 27/09/2026).
- PPE: promoção automática ao ser PPP com 1000 assinantes ativos na rede; rebaixamento nunca é automático.
- Bônus Start: até 3 faturas, configurável por plano; pode não existir.
- Commits terminam com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Não commitar arquivos de outras sessões (`Plano de Recompensas/*`, `MessageTriggerModal.jsx`, `LeadsList.jsx`, `SupplierModal.jsx`).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260927a_cargos_e_arvore.sql` | cargo, líder, licença, histórico de cargo, `indicado_por_uc_id`, guarda de ciclo, backfill |
| `supabase/migrations/20260927b_plano_como_fonte.sql` | plano em usina/UC, campos de gestão/modalidade/desconto no plano, normalização da matriz |
| `supabase/migrations/20260927c_motor_split.sql` | `fn_calcular_split_recompensa` (puro) |
| `supabase/migrations/20260927d_participantes.sql` | `fn_participantes_recompensa` (árvore) |
| `supabase/migrations/20260927e_gatilho_split.sql` | `handle_invoice_paid_ledger` reescrito + conta do Conect + congelamento na fatura |
| `supabase/migrations/20260927f_credito_conect.sql` | `creditos_indicacao` + consumo no cálculo da fatura |
| `supabase/migrations/20260927g_promocao_ppe.sql` | contagem da rede + promoção automática + histórico |
| `supabase/tests/split_*.test.sql` | um arquivo por tarefa |

---

### Task 1: Levantamento da base e do efeito da troca de gestão

Sem código e sem escrita. Gera as duas respostas que o motor depende.

**Files:** Create `docs/superpowers/specs/2026-09-27-base-e-gestao-levantamento.md`

- [ ] **Step 1:** para 10 faturas pagas reais de UCs consumidoras, montar a tabela: `valor_a_pagar`, `valor_concessionaria`, `base = valor_a_pagar − valor_concessionaria`, `consumo_kwh`, `energia_injetada`, `desconto_aplicado`/`desconto_assinante`, a tarifa e o Fio B da concessionária da UC. Calcular `kwh × (tarifa − fio_b − desconto)` e comparar com `base`.
- [ ] **Step 2:** dizer qual valor monetário corresponde à "base de cálculo líquida" do Plano de Recompensas e qual a divergência média e máxima. Se divergir em mais de 1%, **PARAR** e escrever a pergunta objetiva para o dono (qual dos dois vale), sem seguir para a Task 2.
- [ ] **Step 3:** efeito da troca de gestão: para cada usina, `gestao_percentual` atual, quantas UCs ativas, e a diferença em R$ nos últimos 3 meses de faturas pagas caso a gestão passasse a 10%. Tabela usina a usina, com o total.
- [ ] **Step 4:** commit do documento; relatar ao controlador o resumo das duas respostas.

---

### Task 2: Cargos, licença e árvore de indicação

**Files:** Create `supabase/migrations/20260927a_cargos_e_arvore.sql`, `supabase/tests/split_cargos_arvore.test.sql`

**Interfaces produzidas:**
- `originators_v2.cargo text` (`lider|ppe|ppp|ppf`, default `ppf`), `lider_id uuid` (auto-FK), `licenca_valor numeric`, `licenca_vencimento date`, `licenca_status text` (`ativa|vencida|isenta`, derivado por gatilho a partir do vencimento).
- `originator_cargo_history(id, originator_id, cargo_anterior, cargo_novo, motivo, assinantes_na_rede, criado_em, criado_por)`.
- `consumer_units.indicado_por_uc_id uuid` (auto-FK, `ON DELETE SET NULL`).
- `fn_uc_sem_ciclo()` — gatilho BEFORE INSERT OR UPDATE em `consumer_units`: recusa (`ERRCODE 22023`) se `indicado_por_uc_id` apontar para a própria UC, para UC do mesmo assinante, ou se subir a cadeia e reencontrar a UC (teto de 50 saltos).
- Backfill: os 8 originadores existentes recebem `cargo = 'ppf'`; nenhum recebe `lider_id`.
- RLS: as colunas novas seguem as políticas já existentes (Task 15 de 22/09). `cargo`, `lider_id` e os campos de licença entram na guarda `fn_originador_guarda_campos_sensiveis` — papel não interno não altera.

- [ ] **Step 1: teste primeiro** (`split_cargos_arvore.test.sql`): cargo default `ppf`; cargo inválido recusado; ciclo de indicação recusado nas três formas (própria UC, mesmo assinante, cadeia); `licenca_status` vira `vencida` quando o vencimento passa; originador não interno não altera o próprio cargo (42501); backfill deixou os 8 em `ppf`.
- [ ] **Step 2:** rodar → RED.
- [ ] **Step 3:** escrever a migração conforme as interfaces acima.
- [ ] **Step 4:** aplicar, rodar → `SANDBOX_OK`; conferir por SELECT que os 8 estão em `ppf` e que nenhuma UC ganhou `indicado_por_uc_id`.
- [ ] **Step 5:** commit `feat(recompensas): cargos, licenca do PPP e arvore de indicacao`.

---

### Task 3: O plano como fonte única

**Files:** Create `supabase/migrations/20260927b_plano_como_fonte.sql`, `supabase/tests/split_plano_fonte.test.sql`

**Interfaces produzidas:**
- `planos_assinatura_energia` ganha `gestao_percentual numeric default 10`, `modalidade text` (`autoconsumo_remoto|geracao_compartilhada`), `desconto_assinante numeric`, `piso_fornecedor_pct numeric default 50` (se ainda não estiverem em `recorrente_config`; quando estiverem, a coluna é a fonte e o JSON passa a espelhá-la).
- `usinas.plano_assinatura_id uuid`, `consumer_units.plano_assinatura_id uuid`.
- `fn_plano_da_uc(p_uc uuid) returns planos_assinatura_energia` — resolve nesta ordem: plano da UC → plano da usina da UC → `NULL`.
- `fn_regras_recompensa_uc(p_uc uuid) returns jsonb` — devolve `{plano_id, gestao_pct, piso_pct, desconto_pct, modalidade, regras_multinivel, start_config}`; `NULL` quando não há plano.
- Normalização da matriz nos planos existentes: `ppe` 5/2, `ppp` 4/2, `ppf` 2/2 (`max_niveis` 2), `lider` 1/1/1/0 (`max_niveis` 3), `b2w` 10 em todos (`max_niveis` 4), `assinante_conect` L1 2 (`max_niveis` 1). As chaves legadas (`associacao`, `embaixador`, `coordenador`, `assinante`) são removidas de `regras` para não haver dois vocabulários.

- [ ] **Step 1: teste primeiro:** `fn_plano_da_uc` nas três situações (UC com plano, UC sem plano e usina com plano, nenhum dos dois); `fn_regras_recompensa_uc` devolve os percentuais normalizados; os planos existentes ficam com a matriz acordada e sem chaves legadas.
- [ ] **Step 2:** RED. **Step 3:** migração. **Step 4:** aplicar, GREEN.
- [ ] **Step 5:** commit `feat(recompensas): plano como fonte de gestao, desconto, modalidade e matriz`.

---

### Task 4: Motor puro do split

**Files:** Create `supabase/migrations/20260927c_motor_split.sql`, `supabase/tests/split_motor.test.sql`

**Interface produzida:**

```sql
fn_calcular_split_recompensa(
  p_base numeric,            -- base de cálculo líquida em R$
  p_teto_deducao numeric,    -- R$ máximos que podem ser deduzidos sem furar o piso do fornecedor
  p_regras jsonb,            -- regras_multinivel do plano
  p_participantes jsonb      -- [{papel:'lider'|'ppe'|'ppp'|'ppf'|'assinante_conect', id:uuid, nivel:int, suspenso:bool}]
) returns jsonb
```

Devolve:
```json
{"b2w": {"pct": 10, "valor": 0.0, "pct_absorvido": 0.0, "valor_absorvido": 0.0},
 "beneficiarios": [{"papel":"ppe","id":"...","nivel":1,"pct":5,"valor":0.0,"cortado":0.0}],
 "total_deduzido": 0.0, "corte_aplicado": 0.0, "fornecedor": 0.0}
```

Regras: percentual = `regras[papel].niveis['L'||nivel]`, zero quando `nivel > max_niveis`; B2W sempre entra. **Participante com `suspenso: true` não recebe e o percentual dele é somado à B2W** (`pct_absorvido`/`valor_absorvido`), nunca ao fornecedor — é o caso do PPP com licença vencida. se a soma passar de `p_teto_deducao`, cortar na ordem `assinante_conect` → parceiro (`ppe|ppp|ppf`) → `lider`, registrando `cortado` por beneficiário e o total em `corte_aplicado`; a B2W nunca é cortada; `fornecedor = p_base − total_deduzido`; base ≤ 0 devolve tudo zerado e `fornecedor = p_base`. Função `IMMUTABLE`, sem acesso a tabela.

- [ ] **Step 1: teste primeiro**, uma asserção por linha da matriz, com base 100,00 e teto folgado: PPE nível 1 → B2W 10, PPE 5, Líder 1, fornecedor 84; PPP nível 1 → 4; PPF nível 1 → 2; parceiro nível 2 → 2; parceiro nível 3 → 0; Líder nível 4 → 0; Conect nível 1 → 2; Conect nível 2 → 0; PPP nível 1 suspenso → PPP 0 e B2W 14 (10 + 4 absorvidos), fornecedor inalterado. Mais: teto apertado cortando só o Conect; teto ainda menor cortando Conect e parceiro; B2W intacta nos dois; base 0 e base negativa.
- [ ] **Step 2:** RED. **Step 3:** implementação. **Step 4:** GREEN.
- [ ] **Step 5:** commit `feat(recompensas): motor puro do split com trava anti-deficit`.

---

### Task 5: Resolver os participantes na árvore

**Files:** Create `supabase/migrations/20260927d_participantes.sql`, `supabase/tests/split_participantes.test.sql`

**Interface produzida:** `fn_participantes_recompensa(p_uc uuid) returns jsonb` — array no formato que a Task 4 consome.

Regras:
- **Assinante Conect:** dono da UC apontada por `indicado_por_uc_id`; nível 1 sempre; só entra se o assinante dele estiver `ativo`.
- **Parceiro:** originador do assinante da UC (`subscribers.originator_id`); nível = 1 quando a UC não veio de indicação, 2 quando veio (um salto), 3+ conforme a cadeia, com teto de 50 saltos; só entra se `status` do originador for ativo; `cargo` define o percentual; **PPP com `licenca_status = 'vencida'` entra com `suspenso: true`** (recorrência suspensa; o motor manda o percentual dele para a B2W).
- **Líder:** `lider_id` do parceiro; nível = o mesmo nível do parceiro; só entra se ativo.
- **Pergunta ao dono antes do Step 3:** quando o recebedor está **inativo** (originador, líder ou assinante do Conect), o percentual dele fica com o fornecedor ou é absorvido pela B2W, como na licença vencida? Não implementar sem essa resposta.
- Sem assinante, sem originador ou com UC geradora: array vazio.

- [ ] **Step 1: teste primeiro** com fixture de rede: venda direta; indicação em 1 salto; cadeia de 4 saltos; originador inativo; PPP com licença vencida; assinante do Conect inativo; UC sem originador.
- [ ] **Step 2:** RED. **Step 3:** implementação. **Step 4:** GREEN.
- [ ] **Step 5:** commit `feat(recompensas): resolucao de participantes na arvore de indicacao`.

---

### Task 6: Reescrita do gatilho de fatura paga

**Files:** Create `supabase/migrations/20260927e_gatilho_split.sql`, `supabase/tests/split_gatilho.test.sql`

**Mudanças:**
- Conta nova no razão: `2.1.6 — Créditos de Indicação a Assinantes` (obrigação com o Assinante Conect). Parceiro e Líder continuam em `2.1.2`, com `reference_type='originator'`.
- `invoices.recompensas_aplicadas jsonb` guarda o retorno do motor (percentuais, valores, cortes, plano e versão da regra) — é o congelamento: mudar o plano depois não reescreve a fatura.
- O gatilho: resolve plano (Task 3) → base (resultado da Task 1) → teto de dedução a partir do piso → participantes (Task 5) → motor (Task 4) → lança: B2W em `3.1.1`, parceiro/líder em `2.1.2`, Conect em `2.1.6`, fornecedor em `2.1.1`, mantendo os lançamentos que já existem hoje (banco, taxa Asaas, concessionária, manutenção, arrendamento).
- Sem plano para a UC: nenhum lançamento de recompensa, fornecedor recebe o residual como hoje, e a fatura registra o motivo em `recompensas_aplicadas`.
- Bônus Start: quando o plano tiver `start_config` e a fatura estiver entre as elegíveis, aplica os percentuais daquela fatura **no lugar** da recorrência, com o mesmo teto e a mesma ordem de corte.
- `originators_v2.split_commission` deixa de ser lido.

- [ ] **Step 1: teste primeiro**, comparando o razão gerado: venda direta PPE (B2W 10%, PPE 5%, Líder 1%); PPP com licença vencida (B2W 14%, parceiro 0); indicação (parceiro 2% + Conect 2%); UC sem plano (nada de recompensa); fatura de start; piso furado (corte na ordem certa); UC geradora (nada, como hoje); e que os lançamentos de banco/taxa/concessionária continuam idênticos aos de hoje.
- [ ] **Step 2:** RED. **Step 3:** implementação (copiar o corpo atual e trocar só os blocos 3, 4 e 6; manter `SECURITY DEFINER` e `search_path`). **Step 4:** aplicar, GREEN, e conferir a impressão digital do razão antes/depois.
- [ ] **Step 5:** commit `feat(recompensas): gatilho de fatura paga usa a matriz do plano`.

---

### Task 7: Crédito do Assinante Conect e abatimento na fatura

**Files:** Create `supabase/migrations/20260927f_credito_conect.sql`, `supabase/tests/split_credito_conect.test.sql`

**Interfaces produzidas:**
- `creditos_indicacao(id, subscriber_id, invoice_origem_id, uc_origem_id, valor, pct_usado, criado_em, consumido_em, invoice_consumo_id, valor_aplicado, valor_descartado)`; RLS: leitura do próprio assinante e de papel interno; escrita só `service_role`/interno.
- `fn_consumir_credito_indicacao(p_subscriber uuid, p_invoice uuid, p_valor_fatura numeric) returns numeric` — consome o saldo pendente até o valor da fatura, grava `valor_aplicado`/`valor_descartado`, devolve o total abatido. Idempotente por `invoice_consumo_id`.
- O gatilho da Task 6 grava o crédito quando o Conect recebe.
- O cálculo da fatura (`fn_calcular_fatura`) passa a abater o saldo, limitado ao valor da fatura; o excedente é descartado e registrado.

- [ ] **Step 1: teste primeiro:** crédito nasce quando a fatura da indicada é paga; abatimento menor que a fatura; abatimento maior que a fatura (aplica o teto e registra o descarte); chamada repetida não abate duas vezes; assinante sem crédito não muda a fatura.
- [ ] **Step 2:** RED. **Step 3:** implementação. **Step 4:** GREEN.
- [ ] **Step 5:** commit `feat(recompensas): credito de indicacao e abatimento na fatura do assinante`.

---

### Task 8: Promoção automática a PPE

**Files:** Create `supabase/migrations/20260927g_promocao_ppe.sql`, `supabase/tests/split_promocao_ppe.test.sql`

**Interfaces produzidas:**
- `fn_assinantes_na_rede(p_originator uuid) returns int` — assinantes ativos cujo originador é ele, mais os que vieram por indicação dentro da rede dele (recursivo, teto de 50 níveis).
- `fn_promover_ppe()` — para cada `ppp` com licença ativa e `fn_assinantes_na_rede >= 1000`, grava `cargo='ppe'` e uma linha em `originator_cargo_history` com a contagem e o motivo `promocao_automatica`. Nunca rebaixa.
- Agendamento: `pg_cron` diário (o projeto já usa `cron.job`), fora do horário dos robôs.

- [ ] **Step 1: teste primeiro:** PPP com 999 não promove; com 1000 promove e grava histórico; PPP com licença vencida não promove; PPE existente não é alterado; PPF não é promovido; rodar duas vezes não duplica histórico.
- [ ] **Step 2:** RED. **Step 3:** implementação. **Step 4:** GREEN + conferir que nenhum originador real mudou de cargo (hoje nenhum tem 1000).
- [ ] **Step 5:** commit `feat(recompensas): promocao automatica a PPE com registro`.

---

## Fora deste plano (vira plano seguinte)

- Telas: modal do originador (cargo, líder, licença), tela "Equipe" com a rede, modal do assinante (split das fatias, link de indicação, saldo), vínculo usina↔plano na tela da usina.
- Link de indicação do assinante (short_url, raiz, `p_indicador_assinante_id` na RPC de adesão).
- Eletropostos.
- Baixa do repasse ao originador no razão.
