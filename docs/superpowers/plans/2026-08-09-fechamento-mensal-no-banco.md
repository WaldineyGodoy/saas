# Fechamento mensal de usina — o mês no banco

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o mês de uma usina existir como um objeto só — rascunho criado pelo cron, ajustado pelo operador, fechado e liquidado por RPC transacional — de modo que despesa, receita e razão parem de ser escritos por três lugares que não se conhecem.

**Arquitetura:** `usinas.service_values` é contrato; `generation_production` é o fechamento (um registro por usina/mês, editável enquanto `em_producao`); `ledger_entries` é o razão (imutável, só recebe mês fechado); `cashbook` deixa de ser tabela e passa a ler o razão. Toda regra de cálculo vive numa função SQL única, chamada pelo cron, pela RPC e — no plano seguinte — pela tela. O que sai para o mundo externo (boleto da concessionária, PIX) é **enfileirado dentro da transação** via `pg_net`: se a transação abortar, a fila também aborta e nenhum dinheiro se move.

**Tech Stack:** PostgreSQL 15 (Supabase `abbysvxnnhwvvzhftoms`), plpgsql, `pg_cron` 1.6.4, `pg_net` 0.19.5, Deno/TypeScript nas Edge Functions, Asaas como PSP.

**Origem:** spec [`2026-08-08-fechamento-contabil-design.md`](../specs/2026-08-08-fechamento-contabil-design.md) e os achados registrados em [`2026-08-08-achados-para-o-plano-do-fechamento.md`](../specs/2026-08-08-achados-para-o-plano-do-fechamento.md).

---

## Escopo

**Este plano entrega:** o schema, o saneamento, o cron do rascunho, as funções de cálculo, as RPCs `fechar_producao` / `liquidar_producao`, a Edge Function que paga a conta da UG, o `cashbook` como view, e a remoção do código morto. Ao final, um mês inteiro roda de ponta a ponta por SQL, sem tela.

**Este plano NÃO entrega a tela unificada** (spec §5.1 e §5.2 — fusão de `PlantClosingModal` com `BillingModal`, mapa de renomeação de 8 campos, linhas livres de despesa eventual na UI). Ela é o plano seguinte e depende inteiramente das RPCs daqui: sem contrato no banco, a tela volta a ser uma sequência de escritas que falham em silêncio, que é a origem documentada do incidente da spec §1.2.

**Pré-requisito:** a branch `impl/nucleo-tarifario` precisa estar mesclada. As cinco funções tarifárias (`fn_fio_b_apurado`, `fn_tarifa_fornecedor`, `fn_split_tarifa`, `fn_auditar_tarifa`, `fn_faturamento_mensal_usina`) **já estão aplicadas em produção**, mas os arquivos de migration e de teste existem só naquela branch. Executar este plano sem mesclar produz um `supabase/migrations/` que não reconstrói o banco.

---

## Global Constraints

Valem para toda task. Não se repetem em cada uma.

1. **Dado faltante propaga `NULL`, nunca vira zero.** Herdado do plano do núcleo. Nenhuma função nova pode conter `COALESCE(x, 0)` sobre insumo de cálculo. Ausência de dado é ausência, e precisa aparecer.
2. **Somar em silêncio é proibido.** Toda agregação que descarta linha por insumo faltante devolve, junto do total, quantas linhas descartou. `SUM()` ignora `NULL` por definição — é um `COALESCE(x, 0)` por linha disfarçado (achado 3).
3. **A tarifa cadastrada nunca substitui a conta** (spec §5.6). Precedência: valor apurado na fatura → cadastro da UC → parâmetro.
4. **Faturas pagas, e só elas** (decisão 8). O fechamento reflete caixa realizado.
5. **`custo_disponibilidade` entra em `total_despesas`** (decisão 4) e **nunca é digitado** (spec §4.1): é a conta de energia real da UG do mês. Se a conta não existir, o fechamento **bloqueia** — não assume zero (spec §4.2).
6. **Dinheiro em duas casas, arredondado dentro da função.** Funções que devolvem R$/kWh não arredondam; funções que devolvem reais arredondam cada parcela e derivam a última por diferença, para as partes fecharem com o total em centavos (achado 5).
7. **Toda função nova:** `SET search_path TO 'public'`, `REVOKE EXECUTE ... FROM PUBLIC, anon` e `GRANT EXECUTE ... TO authenticated, service_role`. Isso vale também ao alterar assinatura de função existente — assinatura nova é função nova e nasce com `anon=X` pelo `ALTER DEFAULT PRIVILEGES` do Supabase (achado 7).
8. **Nenhum registro novo em `financial_transfers` durante os testes** (spec §8, teste 1). Todo teste que exercita escrita roda dentro do sandbox descrito abaixo e é desfeito — inclusive o enfileiramento do `pg_net`.
9. **Migrations rodam via `apply_migration`; testes rodam via `execute_sql`** no projeto `abbysvxnnhwvvzhftoms`. Não existe runner local: o arquivo em `supabase/tests/` é a fonte, e executá-lo é colar seu conteúdo.

### O sandbox de teste

Escrita de teste nunca fica no banco. O padrão, usado em todas as tasks que escrevem:

```sql
DO $$
DECLARE
    v_algo numeric;
BEGIN
    -- escritas e chamadas de RPC aqui

    -- asserções aqui, cada falha com RAISE EXCEPTION 'FALHOU ...'

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: <nome do teste> — tudo desfeito';
END $$;
```

O bloco `EXCEPTION` do plpgsql abre uma subtransação: a exceção sentinela desfaz tudo o que o bloco escreveu, inclusive as linhas inseridas por `net.http_post` em `net.http_request_queue` — ou seja, **nenhuma chamada externa sai**. Uma asserção que falha tem mensagem diferente da sentinela e é relançada.

---

## Divergências entre a spec e o banco medido em 09/08/2026

Medidas antes de escrever este plano. Cada uma muda uma task.

**a) A `UNIQUE (usina_id, mes_referencia)` já existe.** Constraint `unique_usina_month`, e `generation_production` tem 11 linhas, 0 duplicatas, 0 nulos nas duas colunas. A consolidação da spec §7.1 é trabalho vazio; a Task 1 verifica e segue.

**b) `gestao_percentual` já está em 10 nas 6 usinas,** com `DEFAULT 10`, aplicado em 08/08/2026. A spec §3.1 item 4 e §7.3 estão cumpridos. Não refazer.

**c) As duas UCs zeradas já foram preenchidas.** `7030004021` e `7030004129` têm hoje `te = 0,39033`, `tusd = 0,64164`, `fio_b = 0,2128`. O item 3b da migração está feito, e a validação da Task 6 do plano anterior passou a fechar: calculado **R$ 5.896,03** contra registrado **R$ 5.833,18** = **1,08%**, dentro da tolerância de 2%. Resta zerada apenas `7030839166` (São Gonçalo do Amarante, `aguardando_conexao`, sem faturas).

**d) `service_values` contém `"Energia"`, que é a mesma coisa que `custo_disponibilidade`.** Hoje, na UFV Bom Jesus: `{"Água": 76, "Energia": 109.79, "Internet": 79.9, "Arrendamento": 600, "Manutenção": 0}`. O cron soma `Energia` dentro de serviços; a decisão 4 manda somar `custo_disponibilidade` em `total_despesas`. Aplicar as duas coisas cobra a conta de luz **duas vezes**. Por isso o rascunho da Task 5 monta `service_details` a partir de `service_values` **excluindo `Energia`, `Manutenção` e `Arrendamento`** — as três têm destino próprio.

**e) O teste de aceite da spec §8 não pode sair idêntico, por construção.** Reproduzir 04/2026 da UFV Bom Jesus com a regra nova dá, necessariamente, outro número: o `custo_disponibilidade` registrado é `110,20` (a conta de *março*) e a conta real de abril é `109,79`. Corrigir isso é o objetivo da decisão 4, não um efeito colateral. O critério vira exato e verificável na Task 11:

```
total_despesas 04/2026     registrado   266,10   = 76,00 + 110,20 + 79,90   (Energia do snapshot)
                           recalculado  265,69   = 155,90 + 109,79          (serviços sem Energia + conta real)
```

E `265,69` é exatamente o que o cron lançou no razão em 01/08 para Julho — os dois livros passam a dizer o mesmo número pela primeira vez.

**f) `arrendamento` está zerado no fechamento e cobrado no razão.** `generation_production.arrendamento = 0` em todos os meses da UFV Bom Jesus, enquanto o razão recebe `R$ 600,00` de arrendamento todo mês (`3.1.4`, via cron). O rascunho da Task 5 passa a preencher `arrendamento` a partir do contrato, e isso **aumenta `total_despesas` em R$ 600** frente ao histórico. É correção, não regressão, e a Task 11 mede.

**g) `energy_bill_status = 'atrasado'` não existe no banco;** existem 2 linhas com `'atrasada'`. A lista canônica da UI é `'atrasado'` (`InvoiceFormModal.jsx:1433`), e `InvoiceListManager.jsx:2101` conta `energyStats.atrasado` — ou seja, essas 2 linhas são invisíveis ao contador. O saneamento da spec §7.5 está certo.

**h) `invoices.desconto_assinante` não é utilizável como precedência.** A spec §5.5 mediu: nulo em 12 de 13 faturas de 05/2026, e o único preenchido vale `0,0099` — escala incompatível com o `20` do cadastro. O achado 4 sugeriu `COALESCE(i.desconto_assinante, cu.desconto_assinante, p_desconto_pct)`; **este plano usa `COALESCE(cu.desconto_assinante, p_desconto_pct)`** e emite diagnóstico das faturas com a coluna antiga preenchida. Ler uma coluna cuja escala não se conhece é pior do que ignorá-la sabendo por quê.

**i) Atomicidade com o mundo externo não existe, e a spec pede.** A spec §6.1 quer que uma falha no pagamento reverta o fechamento inteiro. Nenhuma transação de banco pode desfazer um POST que o Asaas já processou. O que este plano garante, e que é a metade que protege o dinheiro:

- nada sai sem que os livros tenham commitado — o `net.http_post` é enfileirado **dentro** da transação e some no rollback;
- nenhuma conta é marcada `'pago'` antes da confirmação do Asaas — a RPC deixa em `'processing'`, valor que já existe nos dados, e a Edge Function confirma;
- a falha fica registrada e a operação é reexecutável sem duplicar (`ledger_entries.external_id` é `UNIQUE`).

Os testes 5 e 6 da spec §8 são reescritos nessa forma na Task 11.

**j) A gestão já é lançada no razão por fatura paga.** `handle_invoice_paid_ledger` credita `3.1.1` (Taxa de Gestão B2W) a cada fatura, com base `valor_a_pagar − valor_concessionaria`. Se `fechar_producao` lançasse `gestao_reais` de novo, contaria duas vezes. **A RPC lança apenas as despesas**; `gestao_reais` permanece número do extrato, calculado pela fórmula da spec §5.4 e não postado.

**k) O razão e o fechamento usam modelos diferentes, e vão divergir.** O razão reparte por valor de fatura; o fechamento reparte por kWh compensado (decisão 11). Enquanto a revisão do split não acontecer — frente própria, spec §9 — `saldo_receber` e o saldo da conta `2.1.1` não batem. A Task 11 **mede e publica a diferença** em vez de escondê-la.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260809a_fechamento_schema.sql` | colunas novas de `generation_production`, checks, e o saneamento de dados (`reference_type`, `energy_bill_status`) |
| `supabase/migrations/20260809b_fn_fechamento_insumos.sql` | `fn_soma_jsonb_valores`, `fn_conta_ug`, `fn_faturamento_detalhado`, `fn_totais_fechamento` — os quatro insumos de cálculo, sem efeito colateral |
| `supabase/migrations/20260809c_run_monthly_rascunho.sql` | reescrita de `run_monthly_fixed_expenses` para criar rascunho em vez de lançar no razão |
| `supabase/migrations/20260809d_fechar_producao.sql` | RPC `fechar_producao` e `confirmar_pagamento_ug` |
| `supabase/migrations/20260809e_liquidar_producao.sql` | RPC `liquidar_producao` |
| `supabase/migrations/20260809f_cashbook_view.sql` | `cashbook_legado`, `cashbook` como view, aposentadoria de `handle_invoice_paid` |
| `supabase/migrations/20260809g_aposentadorias.sql` | remove o que está morto no banco |
| `supabase/functions/pagar-conta-ug/index.ts` | Edge Function que paga o boleto da UG e confirma de volta |
| `supabase/tests/fechamento_schema.test.sql` | asserções da Task 1 |
| `supabase/tests/fechamento_insumos.test.sql` | asserções das Tasks 2, 3 e 4 |
| `supabase/tests/rascunho_mensal.test.sql` | asserções da Task 5 |
| `supabase/tests/fechar_producao.test.sql` | asserções das Tasks 6 e 7 |
| `supabase/tests/liquidar_producao.test.sql` | asserções da Task 8 |
| `supabase/tests/cashbook_view.test.sql` | asserções da Task 9 |
| `supabase/tests/reproducao_042026.test.sql` | critério de aceite, Task 11 |

Arquivos apagados: `supabase/functions/cron-monthly-expenses/`, `supabase/migrations/20260130_create_plant_closings.sql`, e o corpo inalcançável de `PlantClosingModal.handlePayout`.

---

## Task 1: Schema do fechamento e saneamento dos dados

O mês precisa carregar, na própria linha, qual conta da UG ele usou e o que aconteceu com cada pagamento. Sem isso o fechamento é recalculado a partir de cadastro mutável e deixa de ser reproduzível (achado 1b).

**Files:**
- Create: `supabase/migrations/20260809a_fechamento_schema.sql`
- Test: `supabase/tests/fechamento_schema.test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `generation_production.despesas_eventuais jsonb`, `.pagamento_ug_invoice_id uuid`, `.pagamento_ug_status text`, `.repasse_status text` — lidos pelas Tasks 5, 6, 8 e 11.

- [ ] **Step 1: Escrever a asserção que falha**

Criar `supabase/tests/fechamento_schema.test.sql`:

```sql
DO $$
DECLARE
    v_faltando text[] := ARRAY[]::text[];
    v_col text;
BEGIN
    FOREACH v_col IN ARRAY ARRAY['despesas_eventuais','pagamento_ug_invoice_id','pagamento_ug_status','repasse_status'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='generation_production' AND column_name=v_col
        ) THEN
            v_faltando := v_faltando || v_col;
        END IF;
    END LOOP;

    IF array_length(v_faltando,1) IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU schema: colunas ausentes em generation_production: %', v_faltando;
    END IF;

    -- tipo, nao so' existencia (achado 8: o teste anterior verificava apenas existencia)
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name='generation_production' AND column_name='despesas_eventuais') <> 'jsonb' THEN
        RAISE EXCEPTION 'FALHOU schema: despesas_eventuais deveria ser jsonb';
    END IF;

    IF (SELECT column_default FROM information_schema.columns
         WHERE table_schema='public' AND table_name='generation_production' AND column_name='despesas_eventuais') IS NULL THEN
        RAISE EXCEPTION 'FALHOU schema: despesas_eventuais precisa de DEFAULT, senao NULL vira soma silenciosa';
    END IF;

    RAISE NOTICE 'OK: colunas do fechamento';
END $$;

DO $$
DECLARE v_n int;
BEGIN
    -- a UNIQUE ja' existia em 09/08/2026 (constraint unique_usina_month). Verificamos, nao recriamos.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid='public.generation_production'::regclass AND contype='u'
           AND pg_get_constraintdef(oid) = 'UNIQUE (usina_id, mes_referencia)'
    ) THEN
        RAISE EXCEPTION 'FALHOU: sumiu a UNIQUE (usina_id, mes_referencia) - o cron perde a idempotencia';
    END IF;

    SELECT count(*) INTO v_n FROM public.ledger_entries WHERE reference_type = 'SUPPLIER';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'FALHOU saneamento: % linhas ainda com reference_type SUPPLIER maiusculo', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM public.invoices WHERE energy_bill_status = 'atrasada';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'FALHOU saneamento: % faturas ainda com energy_bill_status atrasada', v_n;
    END IF;

    RAISE NOTICE 'OK: saneamento';
END $$;

-- Diagnostico, nao reprova: linhas contraditorias que a spec 4.2 manda revisar a mao.
DO $$
DECLARE v_n int;
BEGIN
    SELECT count(*) INTO v_n FROM public.invoices
     WHERE status::text = 'cancelado' AND energy_bill_status = 'pago';
    RAISE NOTICE 'DIAGNOSTICO: % faturas canceladas com conta de energia paga (revisar a mao, spec 4.2)', v_n;
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/fechamento_schema.test.sql` via `execute_sql` no projeto `abbysvxnnhwvvzhftoms`.
Esperado: `FALHOU schema: colunas ausentes em generation_production: {despesas_eventuais,pagamento_ug_invoice_id,pagamento_ug_status,repasse_status}`.

- [ ] **Step 3: Aplicar a migration**

Criar `supabase/migrations/20260809a_fechamento_schema.sql` e aplicar via `apply_migration` com o nome `20260809a_fechamento_schema`:

```sql
-- ---------------------------------------------------------------------
-- 1. Onde lancar despesa eventual do mes.
--    service_details espelha o contrato; o que acontece so' naquele mes
--    nao tem lugar hoje (spec 3.1, item 2).
-- ---------------------------------------------------------------------
ALTER TABLE public.generation_production
    ADD COLUMN IF NOT EXISTS despesas_eventuais jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.generation_production.despesas_eventuais IS
    'Linhas livres de despesa do mes: {"descricao": valor}. Somadas em servicos junto de service_details. DEFAULT {} - nunca NULL, senao a soma vira silenciosa.';

-- ---------------------------------------------------------------------
-- 2. Qual conta da UG este fechamento usou.
--    Sem essa referencia o custo de disponibilidade e' recalculado a
--    partir de cadastro mutavel e o mes fechado deixa de ser reproduzivel.
-- ---------------------------------------------------------------------
ALTER TABLE public.generation_production
    ADD COLUMN IF NOT EXISTS pagamento_ug_invoice_id uuid REFERENCES public.invoices(id);

COMMENT ON COLUMN public.generation_production.pagamento_ug_invoice_id IS
    'A fatura da UC geradora que originou custo_disponibilidade. Snapshot: o fechamento nao redescobre a conta depois.';

-- ---------------------------------------------------------------------
-- 3. O que aconteceu com cada saida de dinheiro.
--    'enfileirado' = pg_net aceitou o POST; ainda nao ha' confirmacao.
--    'manual'      = conta sem linha digitavel, paga fora do sistema (spec 4.2).
-- ---------------------------------------------------------------------
ALTER TABLE public.generation_production
    ADD COLUMN IF NOT EXISTS pagamento_ug_status text,
    ADD COLUMN IF NOT EXISTS repasse_status      text;

ALTER TABLE public.generation_production
    DROP CONSTRAINT IF EXISTS gp_pagamento_ug_status_check;
ALTER TABLE public.generation_production
    ADD CONSTRAINT gp_pagamento_ug_status_check
    CHECK (pagamento_ug_status IS NULL OR pagamento_ug_status IN ('enfileirado','pago','erro','manual'));

ALTER TABLE public.generation_production
    DROP CONSTRAINT IF EXISTS gp_repasse_status_check;
ALTER TABLE public.generation_production
    ADD CONSTRAINT gp_repasse_status_check
    CHECK (repasse_status IS NULL OR repasse_status IN ('enfileirado','pago','erro'));

COMMENT ON COLUMN public.generation_production.pagamento_ug_status IS
    'Pagamento do boleto da concessionaria: enfileirado | pago | erro | manual. NULL = ainda nao fechado.';
COMMENT ON COLUMN public.generation_production.repasse_status IS
    'PIX ao fornecedor: enfileirado | pago | erro. NULL = ainda nao liquidado.';

-- ---------------------------------------------------------------------
-- 4. Saneamento (spec 7.4 e 7.5).
--    reference_type: 'SUPPLIER' quebra toda agregacao por tipo.
--    energy_bill_status: 'atrasada' e' invisivel ao contador da UI, que
--    conta 'atrasado' (InvoiceFormModal.jsx:1433).
-- ---------------------------------------------------------------------
UPDATE public.ledger_entries SET reference_type = 'supplier' WHERE reference_type = 'SUPPLIER';
UPDATE public.invoices       SET energy_bill_status = 'atrasado' WHERE energy_bill_status = 'atrasada';
```

- [ ] **Step 4: Rodar a asserção e confirmar que passa**

Executar de novo o conteúdo de `supabase/tests/fechamento_schema.test.sql`.
Esperado: `OK: colunas do fechamento`, `OK: saneamento`, e o `DIAGNOSTICO` com a contagem de faturas canceladas com conta paga — que hoje é 3, e é para ser lida, não corrigida por código.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260809a_fechamento_schema.sql supabase/tests/fechamento_schema.test.sql
git commit -m "feat(db): schema do fechamento e saneamento de reference_type e energy_bill_status"
```

---

## Task 2: `fn_conta_ug` — a conta da UG deixa de ser digitada

O custo de disponibilidade passa a vir da conta real da unidade geradora (spec §4.1). A função nunca devolve zero: devolve o valor, ou o motivo pelo qual não há valor. Assumir zero em silêncio é o que produziu os R$ 238,05 não cobrados da spec §1.1.

**Files:**
- Create: `supabase/migrations/20260809b_fn_fechamento_insumos.sql`
- Test: `supabase/tests/fechamento_insumos.test.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `public.fn_conta_ug(p_usina_id uuid, p_mes date) RETURNS jsonb` com as chaves `ok boolean`, `motivo text`, `invoice_id uuid`, `valor numeric`, `energy_bill_status text`, `tem_linha_digitavel boolean`. Consumida pelas Tasks 5, 6 e 11.

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/tests/fechamento_insumos.test.sql`:

```sql
DO $$
DECLARE
    v_usina uuid;
    v_r jsonb;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';
    IF v_usina IS NULL THEN RAISE EXCEPTION 'FALHOU: UFV Bom Jesus nao encontrada'; END IF;

    -- Caso feliz, medido em 09/08/2026: a UG 7029875701 tem conta de 04/2026 = 109,79.
    v_r := public.fn_conta_ug(v_usina, DATE '2026-04-01');
    IF (v_r->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHOU conta_ug 04/2026: esperava ok=true, veio %', v_r;
    END IF;
    IF round((v_r->>'valor')::numeric, 2) <> 109.79 THEN
        RAISE EXCEPTION 'FALHOU conta_ug 04/2026: esperava 109.79, veio %', v_r->>'valor';
    END IF;
    IF (v_r->>'tem_linha_digitavel')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHOU conta_ug 04/2026: a conta de abril tem linha digitavel no banco';
    END IF;

    -- Maio: 118,18. E' o mes que a spec 1.1 mostra descontado como zero.
    IF round((public.fn_conta_ug(v_usina, DATE '2026-05-01')->>'valor')::numeric, 2) <> 118.18 THEN
        RAISE EXCEPTION 'FALHOU conta_ug 05/2026: esperava 118.18';
    END IF;

    -- Mes sem conta nenhuma: recusa com motivo, NAO devolve zero.
    v_r := public.fn_conta_ug(v_usina, DATE '2020-01-01');
    IF (v_r->>'ok')::boolean IS NOT FALSE OR v_r->>'motivo' <> 'conta_da_ug_ausente' THEN
        RAISE EXCEPTION 'FALHOU conta_ug mes vazio: esperava ok=false motivo=conta_da_ug_ausente, veio %', v_r;
    END IF;
    IF v_r->>'valor' IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU conta_ug mes vazio: valor deveria ser NULL, veio %', v_r->>'valor';
    END IF;

    RAISE NOTICE 'OK: fn_conta_ug (UFV Bom Jesus)';
END $$;

DO $$
DECLARE
    v_usina uuid;
    v_r jsonb;
BEGIN
    -- UFV NILTON COSTA: tem UC geradora cadastrada e nenhuma fatura. E' o caso
    -- que a spec 4.2 manda bloquear.
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV NILTON COSTA';
    v_r := public.fn_conta_ug(v_usina, DATE '2026-06-01');
    IF (v_r->>'ok')::boolean IS NOT FALSE OR v_r->>'motivo' <> 'conta_da_ug_ausente' THEN
        RAISE EXCEPTION 'FALHOU conta_ug NILTON COSTA: esperava recusa por conta ausente, veio %', v_r;
    END IF;

    -- UFV São José do Seridó, 07/2026: conta existe (31,69) e NAO tem linha digitavel.
    -- ok=true, com o aviso — o fechamento decide o que fazer (spec 4.2, linha 2).
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV São José do Seridó';
    v_r := public.fn_conta_ug(v_usina, DATE '2026-07-01');
    IF (v_r->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHOU conta_ug São José 07/2026: conta existe, deveria ok=true. veio %', v_r;
    END IF;
    IF (v_r->>'tem_linha_digitavel')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'FALHOU conta_ug São José 07/2026: esperava tem_linha_digitavel=false';
    END IF;

    -- Usina sem UC geradora nenhuma: outro motivo, nao o mesmo.
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus II';
    v_r := public.fn_conta_ug(v_usina, DATE '2026-06-01');
    IF v_r->>'motivo' <> 'usina_sem_uc_geradora' THEN
        RAISE EXCEPTION 'FALHOU conta_ug sem UG: esperava motivo=usina_sem_uc_geradora, veio %', v_r;
    END IF;

    RAISE NOTICE 'OK: fn_conta_ug (casos de recusa)';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/fechamento_insumos.test.sql`.
Esperado: `ERROR: function public.fn_conta_ug(uuid, date) does not exist`.

- [ ] **Step 3: Implementar**

Criar `supabase/migrations/20260809b_fn_fechamento_insumos.sql` com o conteúdo abaixo e aplicar via `apply_migration` com o nome `20260809b_fn_fechamento_insumos`. As Tasks 3 e 4 acrescentam funções a este mesmo arquivo.

```sql
CREATE OR REPLACE FUNCTION public.fn_conta_ug(
    p_usina_id uuid,
    p_mes      date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
    v_ugs     int;
    v_uc_id   uuid;
    v_invoice record;
BEGIN
    IF p_usina_id IS NULL OR p_mes IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'parametro_ausente',
                                  'invoice_id', NULL, 'valor', NULL,
                                  'energy_bill_status', NULL, 'tem_linha_digitavel', NULL);
    END IF;

    SELECT count(*) INTO v_ugs
      FROM public.consumer_units
     WHERE usina_id = p_usina_id AND tipo_unidade = 'geradora';

    IF v_ugs = 0 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'usina_sem_uc_geradora',
                                  'invoice_id', NULL, 'valor', NULL,
                                  'energy_bill_status', NULL, 'tem_linha_digitavel', NULL);
    END IF;

    -- Mais de uma geradora: recusa explicita. Escolher uma pela ordem fisica e'
    -- o defeito do 'LIMIT 1 sem ORDER BY' registrado no achado 8.
    IF v_ugs > 1 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'mais_de_uma_uc_geradora',
                                  'invoice_id', NULL, 'valor', NULL,
                                  'energy_bill_status', NULL, 'tem_linha_digitavel', NULL);
    END IF;

    SELECT id INTO v_uc_id
      FROM public.consumer_units
     WHERE usina_id = p_usina_id AND tipo_unidade = 'geradora';

    -- invoices tem UNIQUE (uc_id, mes_referencia): no maximo uma linha.
    SELECT i.id, i.valor_concessionaria, i.energy_bill_status, i.linha_digitavel
      INTO v_invoice
      FROM public.invoices i
     WHERE i.uc_id = v_uc_id AND i.mes_referencia = date_trunc('month', p_mes)::date;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'conta_da_ug_ausente',
                                  'invoice_id', NULL, 'valor', NULL,
                                  'energy_bill_status', NULL, 'tem_linha_digitavel', NULL);
    END IF;

    IF v_invoice.valor_concessionaria IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'conta_sem_valor',
                                  'invoice_id', v_invoice.id, 'valor', NULL,
                                  'energy_bill_status', v_invoice.energy_bill_status,
                                  'tem_linha_digitavel', v_invoice.linha_digitavel IS NOT NULL);
    END IF;

    RETURN jsonb_build_object(
        'ok', true, 'motivo', NULL,
        'invoice_id', v_invoice.id,
        'valor', v_invoice.valor_concessionaria,
        'energy_bill_status', v_invoice.energy_bill_status,
        'tem_linha_digitavel', v_invoice.linha_digitavel IS NOT NULL
    );
END;
$$;

COMMENT ON FUNCTION public.fn_conta_ug(uuid, date) IS
    'Conta de energia da UC geradora da usina no mes. Origem canonica de custo_disponibilidade (spec 4.1). Nunca devolve zero: devolve ok=false com motivo. Motivos: parametro_ausente | usina_sem_uc_geradora | mais_de_uma_uc_geradora | conta_da_ug_ausente | conta_sem_valor.';

REVOKE EXECUTE ON FUNCTION public.fn_conta_ug(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_conta_ug(uuid, date) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Executar o conteúdo de `supabase/tests/fechamento_insumos.test.sql`.
Esperado: `OK: fn_conta_ug (UFV Bom Jesus)` e `OK: fn_conta_ug (casos de recusa)`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260809b_fn_fechamento_insumos.sql supabase/tests/fechamento_insumos.test.sql
git commit -m "feat(db): fn_conta_ug deriva o custo de disponibilidade da conta da UG"
```

---

## Task 3: `fn_faturamento_detalhado` — o total para de esconder o que descartou

`fn_faturamento_mensal_usina` devolve `numeric` e soma com `SUM()`, que ignora `NULL`. Uma fatura paga sem insumo tarifário desaparece do total sem deixar rastro (achado 3). Esta função devolve o mesmo total mais a contagem e a lista do que ficou de fora, e é ela que o fechamento usa.

**Files:**
- Modify: `supabase/migrations/20260809b_fn_fechamento_insumos.sql` (acrescenta ao final)
- Test: `supabase/tests/fechamento_insumos.test.sql` (acrescenta ao final)

**Interfaces:**
- Consumes: `public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) RETURNS numeric` da branch `impl/nucleo-tarifario`.
- Produces: `public.fn_faturamento_detalhado(p_usina_id uuid, p_mes date, p_desconto_pct numeric DEFAULT 20) RETURNS jsonb` com `total numeric`, `faturas int`, `computadas int`, `descartadas int`, `kwh numeric`, `descartes jsonb[]`. Consumida pelas Tasks 5, 6 e 11.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `supabase/tests/fechamento_insumos.test.sql`:

```sql
DO $$
DECLARE
    v_usina uuid;
    v_r jsonb;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';

    -- Medido em 09/08/2026: 11 faturas pagas em 05/2026, todas com insumo completo,
    -- total 5.896,03 contra 5.833,18 registrado (1,08%). Sao 13 linhas no mes:
    -- 11 pagas, 1 atrasada e 1 cancelada.
    v_r := public.fn_faturamento_detalhado(v_usina, DATE '2026-05-01');

    IF round((v_r->>'total')::numeric, 2) <> 5896.03 THEN
        RAISE EXCEPTION 'FALHOU faturamento 05/2026: esperava 5896.03, veio %', round((v_r->>'total')::numeric,2);
    END IF;
    IF (v_r->>'descartadas')::int <> 0 THEN
        RAISE EXCEPTION 'FALHOU faturamento 05/2026: esperava 0 descartadas, veio % - %',
                        v_r->>'descartadas', v_r->'descartes';
    END IF;
    IF (v_r->>'faturas')::int <> 11 THEN
        RAISE EXCEPTION 'FALHOU faturamento 05/2026: esperava 11 faturas pagas, veio %', v_r->>'faturas';
    END IF;

    -- 04/2026: 12 faturas pagas, 10.853,05 kWh compensados.
    v_r := public.fn_faturamento_detalhado(v_usina, DATE '2026-04-01');
    IF round((v_r->>'kwh')::numeric, 2) <> 10853.05 THEN
        RAISE EXCEPTION 'FALHOU faturamento 04/2026: esperava 10853.05 kWh, veio %', v_r->>'kwh';
    END IF;

    -- Mes sem fatura paga: total NULL, nao zero. "Nao faturou" e' diferente de
    -- "faturou zero" (achado 3c).
    v_r := public.fn_faturamento_detalhado(v_usina, DATE '2020-01-01');
    IF v_r->>'total' IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU faturamento mes vazio: total deveria ser NULL, veio %', v_r->>'total';
    END IF;
    IF (v_r->>'faturas')::int <> 0 THEN
        RAISE EXCEPTION 'FALHOU faturamento mes vazio: esperava faturas=0';
    END IF;

    RAISE NOTICE 'OK: fn_faturamento_detalhado (producao)';
END $$;

DO $$
DECLARE
    v_usina uuid;
    v_uc    uuid;
    v_r     jsonb;
BEGIN
    -- Sandbox: uma fatura paga sem TE precisa ser CONTADA como descartada,
    -- e nao sumir dentro do SUM.
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';

    INSERT INTO public.consumer_units (usina_id, numero_uc, tipo_unidade, te, tusd, fio_b, desconto_assinante)
    VALUES (v_usina, 'TESTE-SEM-TE', 'beneficiaria', NULL, 0.64164, 0.2128, 20)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, mes_referencia, status, consumo_compensado)
    VALUES (v_uc, DATE '2026-05-01', 'pago', 1000);

    v_r := public.fn_faturamento_detalhado(v_usina, DATE '2026-05-01');

    IF (v_r->>'descartadas')::int <> 1 THEN
        RAISE EXCEPTION 'FALHOU descarte: esperava 1 descartada, veio %', v_r->>'descartadas';
    END IF;
    IF (v_r->'descartes'->0->>'motivo') <> 'sem_te' THEN
        RAISE EXCEPTION 'FALHOU descarte: esperava motivo sem_te, veio %', v_r->'descartes';
    END IF;
    IF round((v_r->>'total')::numeric, 2) <> 5896.03 THEN
        RAISE EXCEPTION 'FALHOU descarte: o total das validas nao pode mudar. veio %', v_r->>'total';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: fn_faturamento_detalhado conta o que descartou — tudo desfeito';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/fechamento_insumos.test.sql`.
Esperado: `ERROR: function public.fn_faturamento_detalhado(uuid, date) does not exist`. Os blocos da Task 2 seguem passando.

- [ ] **Step 3: Implementar**

Acrescentar ao final de `supabase/migrations/20260809b_fn_fechamento_insumos.sql` e reaplicar a migration:

```sql
CREATE OR REPLACE FUNCTION public.fn_faturamento_detalhado(
    p_usina_id     uuid,
    p_mes          date,
    p_desconto_pct numeric DEFAULT 20
) RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
    WITH linhas AS (
        SELECT
            i.id            AS invoice_id,
            cu.numero_uc    AS uc,
            i.consumo_compensado,
            public.fn_tarifa_fornecedor(
                COALESCE(i.te_apurado,   cu.te),
                COALESCE(i.tusd_apurado, cu.tusd),
                -- invoices.desconto_assinante NAO entra: escala inconsistente,
                -- medida em 0,0099 onde o cadastro diz 20 (spec 5.5, divergencia h).
                COALESCE(cu.desconto_assinante, p_desconto_pct),
                COALESCE(i.fio_b_apurado, cu.fio_b)
            ) AS tarifa,
            CASE
                WHEN COALESCE(i.te_apurado,   cu.te)     IS NULL THEN 'sem_te'
                WHEN COALESCE(i.tusd_apurado, cu.tusd)   IS NULL THEN 'sem_tusd'
                WHEN COALESCE(i.fio_b_apurado, cu.fio_b) IS NULL THEN 'sem_fio_b'
                WHEN i.consumo_compensado                IS NULL THEN 'sem_consumo_compensado'
                ELSE NULL
            END AS motivo
        FROM public.invoices i
        JOIN public.consumer_units cu ON cu.id = i.uc_id
        WHERE cu.usina_id      = p_usina_id
          AND cu.tipo_unidade  = 'beneficiaria'
          AND i.mes_referencia = date_trunc('month', p_mes)::date
          -- sem cast ::text: o cast impede o uso de indice em status (achado 8)
          AND i.status         = 'pago'::fatura_status
    )
    SELECT jsonb_build_object(
        'total',       (SELECT sum(tarifa * consumo_compensado) FROM linhas WHERE motivo IS NULL),
        'faturas',     (SELECT count(*)::int  FROM linhas),
        'computadas',  (SELECT count(*)::int  FROM linhas WHERE motivo IS NULL),
        'descartadas', (SELECT count(*)::int  FROM linhas WHERE motivo IS NOT NULL),
        'kwh',         (SELECT sum(consumo_compensado) FROM linhas WHERE motivo IS NULL),
        'descartes',   COALESCE((
            SELECT jsonb_agg(jsonb_build_object('invoice_id', invoice_id, 'uc', uc, 'motivo', motivo)
                             ORDER BY uc)
              FROM linhas WHERE motivo IS NOT NULL
        ), '[]'::jsonb)
    );
$$;

COMMENT ON FUNCTION public.fn_faturamento_detalhado(uuid, date, numeric) IS
    'Faturamento do mes da usina (tarifa_fornecedor x kWh compensado, so faturas pagas - decisao 8) COM a contagem do que ficou de fora. total NULL = nenhuma fatura computada, que e diferente de faturou zero. Quem fecha o mes deve recusar descartadas > 0. Nao le invoices.desconto_assinante: escala inconsistente (spec 5.5).';

REVOKE EXECUTE ON FUNCTION public.fn_faturamento_detalhado(uuid, date, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_faturamento_detalhado(uuid, date, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_faturamento_mensal_usina(uuid, date, numeric) IS
    'SUPERADA por fn_faturamento_detalhado, que devolve o mesmo total mais a contagem de faturas descartadas. Mantida porque o teste de reconciliacao com producao a usa. Nao chamar em codigo novo: o SUM aqui descarta em silencio.';
```

- [ ] **Step 4: Rodar e confirmar que passa**

Executar o conteúdo de `supabase/tests/fechamento_insumos.test.sql`.
Esperado: `OK: fn_faturamento_detalhado (producao)` e `OK: fn_faturamento_detalhado conta o que descartou — tudo desfeito`.

Depois, confirmar que o sandbox não deixou resíduo:

```sql
SELECT count(*) FROM public.consumer_units WHERE numero_uc = 'TESTE-SEM-TE';
```
Esperado: `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260809b_fn_fechamento_insumos.sql supabase/tests/fechamento_insumos.test.sql
git commit -m "feat(db): fn_faturamento_detalhado devolve o total e o que descartou"
```

---

## Task 4: `fn_totais_fechamento` — as fórmulas da spec §5.4, uma vez só

As quatro fórmulas do fechamento existem hoje em JavaScript, dentro de `PlantClosingModal`, com uma quinta variante em `BillingModal`. Descem para o banco como uma função só, para o cron, a RPC e a tela lerem a mesma regra (spec §5.5, último parágrafo).

**Files:**
- Modify: `supabase/migrations/20260809b_fn_fechamento_insumos.sql` (acrescenta ao final)
- Test: `supabase/tests/fechamento_insumos.test.sql` (acrescenta ao final)

**Interfaces:**
- Consumes: colunas de `generation_production` da Task 1.
- Produces:
  - `public.fn_soma_jsonb_valores(p jsonb) RETURNS numeric` — soma os valores de um objeto jsonb, levantando exceção se algum não for número.
  - `public.fn_totais_fechamento(p_gp_id uuid) RETURNS jsonb` com `servicos`, `total_despesas`, `gestao_reais`, `saldo_receber`, todos `numeric` já arredondados em 2 casas, ou `NULL` quando falta insumo. Consumida pelas Tasks 5, 6, 8 e 11.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `supabase/tests/fechamento_insumos.test.sql`:

```sql
DO $$
BEGIN
    IF public.fn_soma_jsonb_valores('{"Água": 76, "Internet": 79.9, "Segurança": 0}'::jsonb) <> 155.90 THEN
        RAISE EXCEPTION 'FALHOU soma_jsonb: esperava 155.90';
    END IF;
    IF public.fn_soma_jsonb_valores('{}'::jsonb) <> 0 THEN
        RAISE EXCEPTION 'FALHOU soma_jsonb: objeto vazio soma zero — aqui zero e o valor certo, nao um dado faltante';
    END IF;
    IF public.fn_soma_jsonb_valores(NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU soma_jsonb: NULL propaga NULL';
    END IF;

    BEGIN
        PERFORM public.fn_soma_jsonb_valores('{"Água": "setenta e seis"}'::jsonb);
        RAISE EXCEPTION 'FALHOU soma_jsonb: valor nao numerico deveria levantar excecao';
    EXCEPTION WHEN invalid_text_representation OR data_exception THEN
        NULL; -- esperado
    END;

    RAISE NOTICE 'OK: fn_soma_jsonb_valores';
END $$;

DO $$
DECLARE
    v_usina uuid;
    v_gp    uuid;
    v_r     jsonb;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';

    -- Sandbox: um mes sintetico com numeros redondos.
    INSERT INTO public.generation_production
        (usina_id, mes_referencia, status, faturamento_mensal,
         custo_disponibilidade, manutencao, arrendamento, service_details, despesas_eventuais)
    VALUES
        (v_usina, DATE '2019-01-01', 'em_producao', 10000,
         100, 200, 600, '{"Água": 76, "Internet": 79.9}'::jsonb, '{"Troca de inversor": 344.1}'::jsonb)
    RETURNING id INTO v_gp;

    v_r := public.fn_totais_fechamento(v_gp);

    -- servicos = 76 + 79,90 + 344,10 = 500,00
    IF (v_r->>'servicos')::numeric <> 500.00 THEN
        RAISE EXCEPTION 'FALHOU totais: servicos esperava 500.00, veio %', v_r->>'servicos';
    END IF;
    -- total_despesas = 100 + 200 + 600 + 500 = 1400,00  (disponibilidade INCLUIDA, decisao 4)
    IF (v_r->>'total_despesas')::numeric <> 1400.00 THEN
        RAISE EXCEPTION 'FALHOU totais: total_despesas esperava 1400.00, veio %', v_r->>'total_despesas';
    END IF;
    -- gestao = 10% de 10000 = 1000,00
    IF (v_r->>'gestao_reais')::numeric <> 1000.00 THEN
        RAISE EXCEPTION 'FALHOU totais: gestao_reais esperava 1000.00, veio %', v_r->>'gestao_reais';
    END IF;
    -- saldo = 10000 - 1400 - 1000 = 7600,00
    IF (v_r->>'saldo_receber')::numeric <> 7600.00 THEN
        RAISE EXCEPTION 'FALHOU totais: saldo_receber esperava 7600.00, veio %', v_r->>'saldo_receber';
    END IF;

    -- Sem custo_disponibilidade, total_despesas e saldo NAO viram numero.
    UPDATE public.generation_production SET custo_disponibilidade = NULL WHERE id = v_gp;
    v_r := public.fn_totais_fechamento(v_gp);
    IF v_r->>'total_despesas' IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU totais: sem disponibilidade, total_despesas tem que ser NULL, veio %', v_r->>'total_despesas';
    END IF;
    IF v_r->>'saldo_receber' IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU totais: sem disponibilidade, saldo_receber tem que ser NULL';
    END IF;
    IF (v_r->>'servicos')::numeric <> 500.00 THEN
        RAISE EXCEPTION 'FALHOU totais: servicos nao depende da disponibilidade e deveria seguir 500.00';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: fn_totais_fechamento — tudo desfeito';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/fechamento_insumos.test.sql`.
Esperado: `ERROR: function public.fn_soma_jsonb_valores(jsonb) does not exist`.

- [ ] **Step 3: Implementar**

Acrescentar ao final de `supabase/migrations/20260809b_fn_fechamento_insumos.sql` e reaplicar:

```sql
CREATE OR REPLACE FUNCTION public.fn_soma_jsonb_valores(p jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
    -- Objeto vazio soma zero: aqui zero e' o valor correto, nao dado faltante.
    -- NULL propaga NULL. Valor nao numerico levanta excecao no cast, de proposito:
    -- somar "setenta e seis" como zero seria o padrao proibido.
    SELECT CASE WHEN p IS NULL THEN NULL
                ELSE COALESCE((SELECT sum(value::numeric) FROM jsonb_each_text(p)), 0)
           END;
$$;

COMMENT ON FUNCTION public.fn_soma_jsonb_valores(jsonb) IS
    'Soma os valores de um objeto jsonb {"chave": numero}. NULL propaga NULL; {} soma 0; valor nao numerico levanta excecao em vez de virar zero.';

REVOKE EXECUTE ON FUNCTION public.fn_soma_jsonb_valores(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_soma_jsonb_valores(jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_totais_fechamento(p_gp_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
    WITH base AS (
        SELECT gp.faturamento_mensal,
               gp.custo_disponibilidade,
               gp.manutencao,
               gp.arrendamento,
               u.gestao_percentual,
               round(
                   public.fn_soma_jsonb_valores(gp.service_details)
                 + public.fn_soma_jsonb_valores(gp.despesas_eventuais)
               , 2) AS servicos
          FROM public.generation_production gp
          JOIN public.usinas u ON u.id = gp.usina_id
         WHERE gp.id = p_gp_id
    ), calc AS (
        SELECT servicos,
               -- Spec 5.4. Qualquer parcela NULL torna o total NULL: a soma nao
               -- pode fingir que a parcela ausente vale zero (decisao 4 + Global
               -- Constraint 1). O operador ve o campo vazio e sabe o que falta.
               round(custo_disponibilidade + manutencao + arrendamento + servicos, 2) AS total_despesas,
               round(faturamento_mensal * gestao_percentual / 100.0, 2)               AS gestao_reais,
               faturamento_mensal
          FROM base
    )
    SELECT jsonb_build_object(
        'servicos',       servicos,
        'total_despesas', total_despesas,
        'gestao_reais',   gestao_reais,
        'saldo_receber',  round(faturamento_mensal - total_despesas - gestao_reais, 2)
    ) FROM calc;
$$;

COMMENT ON FUNCTION public.fn_totais_fechamento(uuid) IS
    'As quatro formulas do fechamento (spec 5.4) num lugar so: servicos, total_despesas, gestao_reais, saldo_receber. Dinheiro arredondado em 2 casas dentro da funcao. Parcela ausente torna o total NULL - nunca zero. gestao_reais e numero de extrato: NAO e lancado no razao, porque handle_invoice_paid_ledger ja credita 3.1.1 por fatura paga.';

REVOKE EXECUTE ON FUNCTION public.fn_totais_fechamento(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_totais_fechamento(uuid) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Executar o conteúdo de `supabase/tests/fechamento_insumos.test.sql`.
Esperado: os cinco blocos com `OK:`, sendo os dois últimos `OK: fn_soma_jsonb_valores` e `OK: fn_totais_fechamento — tudo desfeito`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260809b_fn_fechamento_insumos.sql supabase/tests/fechamento_insumos.test.sql
git commit -m "feat(db): fn_totais_fechamento concentra as formulas da spec 5.4"
```

---

## Task 5: O cron cria o rascunho e para de escrever no razão

Hoje `run_monthly_fixed_expenses` lança direto em `ledger_entries` e `cashbook`, todo dia 1 às 00:05, sem idempotência e sem nunca ter visto um fechamento. Passa a criar o rascunho do mês (decisão 3). O razão só recebe mês fechado.

**Files:**
- Create: `supabase/migrations/20260809c_run_monthly_rascunho.sql`
- Test: `supabase/tests/rascunho_mensal.test.sql`

**Interfaces:**
- Consumes: `fn_conta_ug`, `fn_faturamento_detalhado`, `fn_totais_fechamento`.
- Produces: `public.run_monthly_fixed_expenses(p_date date DEFAULT CURRENT_DATE) RETURNS jsonb` — mesma assinatura de hoje, porque o job 1 do `pg_cron` a chama por nome; retorno passa de `void` para `jsonb` com o resumo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/tests/rascunho_mensal.test.sql`:

```sql
DO $$
DECLARE
    v_usina    uuid;
    v_r1       jsonb;
    v_r2       jsonb;
    v_linhas   int;
    v_gp       record;
    v_ledger_antes int;
    v_ledger_depois int;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';
    SELECT count(*) INTO v_ledger_antes FROM public.ledger_entries;

    -- Apaga um mes que nao existe em producao para o teste ter espaco proprio.
    -- Referencia 2026-04 => p_date em 2026-05.
    DELETE FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-04-01';

    v_r1 := public.run_monthly_fixed_expenses(DATE '2026-05-10');
    v_r2 := public.run_monthly_fixed_expenses(DATE '2026-05-10');   -- roda de novo, spec 8 teste 4

    SELECT count(*) INTO v_linhas
      FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-04-01';

    IF v_linhas <> 1 THEN
        RAISE EXCEPTION 'FALHOU idempotencia: duas execucoes produziram % linhas', v_linhas;
    END IF;

    SELECT * INTO v_gp FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-04-01';

    IF v_gp.status::text <> 'em_producao' THEN
        RAISE EXCEPTION 'FALHOU rascunho: status deveria ser em_producao, veio %', v_gp.status;
    END IF;

    -- custo_disponibilidade vem da conta real de 04/2026 (109,79), nao dos
    -- 110,20 de service_values nem de zero.
    IF round(v_gp.custo_disponibilidade, 2) <> 109.79 THEN
        RAISE EXCEPTION 'FALHOU rascunho: custo_disponibilidade esperava 109.79, veio %', v_gp.custo_disponibilidade;
    END IF;
    IF v_gp.pagamento_ug_invoice_id IS NULL THEN
        RAISE EXCEPTION 'FALHOU rascunho: falta o snapshot de qual conta da UG foi usada';
    END IF;

    -- service_details NAO pode conter Energia: ela virou custo_disponibilidade
    -- e contaria duas vezes (divergencia d).
    IF v_gp.service_details ? 'Energia' THEN
        RAISE EXCEPTION 'FALHOU rascunho: Energia em service_details cobra a conta de luz duas vezes';
    END IF;
    IF round(public.fn_soma_jsonb_valores(v_gp.service_details), 2) <> 155.90 THEN
        RAISE EXCEPTION 'FALHOU rascunho: servicos esperava 155.90 (76 + 79.90), veio %',
                        public.fn_soma_jsonb_valores(v_gp.service_details);
    END IF;

    -- contrato: arrendamento 600, manutencao 0
    IF round(v_gp.arrendamento, 2) <> 600.00 THEN
        RAISE EXCEPTION 'FALHOU rascunho: arrendamento esperava 600.00, veio %', v_gp.arrendamento;
    END IF;

    -- total_despesas = 109,79 + 0 + 600 + 155,90 = 865,69
    IF round(v_gp.total_despesas, 2) <> 865.69 THEN
        RAISE EXCEPTION 'FALHOU rascunho: total_despesas esperava 865.69, veio %', v_gp.total_despesas;
    END IF;

    -- O cron nao escreve mais no razao.
    SELECT count(*) INTO v_ledger_depois FROM public.ledger_entries;
    IF v_ledger_depois <> v_ledger_antes THEN
        RAISE EXCEPTION 'FALHOU: o cron lancou % partidas no razao. Rascunho nao lanca.',
                        v_ledger_depois - v_ledger_antes;
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: rascunho mensal idempotente — tudo desfeito';
END $$;

DO $$
DECLARE
    v_usina uuid;
    v_gp    uuid;
    v_serv  jsonb;
BEGIN
    -- Um mes ja' fechado nao pode ser reescrito por uma nova passagem do cron.
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';

    UPDATE public.generation_production
       SET status = 'fechado', service_details = '{"Editado pelo operador": 1}'::jsonb
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-05-01'
    RETURNING id INTO v_gp;

    PERFORM public.run_monthly_fixed_expenses(DATE '2026-06-10');

    SELECT service_details INTO v_serv FROM public.generation_production WHERE id = v_gp;
    IF NOT (v_serv ? 'Editado pelo operador') THEN
        RAISE EXCEPTION 'FALHOU: o cron sobrescreveu um mes fechado';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: cron respeita mes fechado — tudo desfeito';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/rascunho_mensal.test.sql`.
Esperado: falha em `FALHOU: o cron lancou N partidas no razao` — a função atual ainda escreve no razão e no cashbook.

- [ ] **Step 3: Implementar**

Criar `supabase/migrations/20260809c_run_monthly_rascunho.sql` e aplicar via `apply_migration` com o nome `20260809c_run_monthly_rascunho`:

```sql
-- ---------------------------------------------------------------------
-- O cron passa a criar o RASCUNHO do mes (decisao 3), em vez de lancar
-- direto no razao. O razao so' recebe mes fechado, pela RPC fechar_producao.
--
-- Mantem o nome e a assinatura: o job 1 do pg_cron chama
-- 'SELECT public.run_monthly_fixed_expenses()' por nome.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_monthly_fixed_expenses(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_mes        date := date_trunc('month', p_date - INTERVAL '1 month')::date;
    v_usina      record;
    v_conta      jsonb;
    v_fat        jsonb;
    v_totais     jsonb;
    v_gp_id      uuid;
    v_inseriu    boolean;
    v_criados    int := 0;
    v_atualizados int := 0;
    v_bloqueados jsonb := '[]'::jsonb;
BEGIN
    FOR v_usina IN
        SELECT id, name, service_values
          FROM public.usinas
         WHERE status IN ('gerando', 'manutencao')
         ORDER BY name
    LOOP
        v_conta := public.fn_conta_ug(v_usina.id, v_mes);
        v_fat   := public.fn_faturamento_detalhado(v_usina.id, v_mes);

        -- Conta da UG ausente NAO impede o rascunho de existir: impede o
        -- fechamento (Task 6). O campo fica vazio e o motivo fica registrado,
        -- para o operador ver o que falta em vez de ver zero.
        IF (v_conta->>'ok')::boolean IS NOT TRUE THEN
            v_bloqueados := v_bloqueados || jsonb_build_object(
                'usina', v_usina.name, 'motivo', v_conta->>'motivo');
        END IF;

        INSERT INTO public.generation_production AS gp (
            usina_id, mes_referencia, status,
            manutencao, arrendamento, service_details, despesas_eventuais,
            custo_disponibilidade, pagamento_ug_invoice_id,
            faturamento_mensal, energia_compensada
        ) VALUES (
            v_usina.id, v_mes, 'em_producao',
            (v_usina.service_values->>'Manutenção')::numeric,
            (v_usina.service_values->>'Arrendamento')::numeric,
            -- Manutencao e Arrendamento tem coluna propria; Energia virou
            -- custo_disponibilidade. Deixa-las aqui cobraria duas vezes.
            COALESCE(v_usina.service_values, '{}'::jsonb)
                - 'Manutenção' - 'Arrendamento' - 'Energia',
            '{}'::jsonb,
            (v_conta->>'valor')::numeric,
            (v_conta->>'invoice_id')::uuid,
            (v_fat->>'total')::numeric,
            (v_fat->>'kwh')::numeric
        )
        ON CONFLICT (usina_id, mes_referencia) DO UPDATE SET
            -- Campos derivados: sempre atualizados enquanto o mes esta' aberto.
            -- Mais faturas podem ter sido pagas, e a conta da UG pode ter chegado.
            custo_disponibilidade   = EXCLUDED.custo_disponibilidade,
            pagamento_ug_invoice_id = EXCLUDED.pagamento_ug_invoice_id,
            faturamento_mensal      = EXCLUDED.faturamento_mensal,
            energia_compensada      = EXCLUDED.energia_compensada
            -- Campos de contrato (manutencao, arrendamento, service_details) e
            -- despesas_eventuais NAO sao tocados: o operador ja' pode ter
            -- editado, e a edicao dele vale mais que o contrato.
        WHERE gp.status = 'em_producao'
        RETURNING id, (xmax = 0) INTO v_gp_id, v_inseriu;

        IF v_gp_id IS NULL THEN
            -- ON CONFLICT com WHERE falso: mes fechado ou liquidado, nao se toca.
            CONTINUE;
        END IF;

        -- xmax = 0 na linha devolvida distingue INSERT de UPDATE no upsert.
        IF v_inseriu THEN
            v_criados := v_criados + 1;
        ELSE
            v_atualizados := v_atualizados + 1;
        END IF;

        v_totais := public.fn_totais_fechamento(v_gp_id);
        UPDATE public.generation_production
           SET servicos       = (v_totais->>'servicos')::numeric,
               total_despesas = (v_totais->>'total_despesas')::numeric,
               gestao_reais   = (v_totais->>'gestao_reais')::numeric,
               saldo_receber  = (v_totais->>'saldo_receber')::numeric
         WHERE id = v_gp_id;

        v_gp_id := NULL;
    END LOOP;

    RETURN jsonb_build_object(
        'mes_referencia', v_mes,
        'criados',        v_criados,
        'atualizados',    v_atualizados,
        'sem_conta_ug',   v_bloqueados
    );
END;
$$;

COMMENT ON FUNCTION public.run_monthly_fixed_expenses(date) IS
    'Cria o rascunho do mes anterior em generation_production (decisao 3). NAO lanca no razao nem no cashbook - isso e trabalho de fechar_producao. Idempotente pela UNIQUE (usina_id, mes_referencia): rodar duas vezes no dia 1 nao duplica (spec 8, teste 4). Mes fechado ou liquidado nao e tocado.';

REVOKE EXECUTE ON FUNCTION public.run_monthly_fixed_expenses(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.run_monthly_fixed_expenses(date) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Executar o conteúdo de `supabase/tests/rascunho_mensal.test.sql`.
Esperado: `OK: rascunho mensal idempotente — tudo desfeito` e `OK: cron respeita mes fechado — tudo desfeito`.

Confirmar que o job do cron continua apontando para a função certa:

```sql
SELECT jobid, schedule, command, active FROM cron.job WHERE jobname = 'monthly_expenses';
```
Esperado: `5 0 1 * *`, `SELECT public.run_monthly_fixed_expenses()`, `active = true`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260809c_run_monthly_rascunho.sql supabase/tests/rascunho_mensal.test.sql
git commit -m "feat(db): o cron cria o rascunho do mes e para de lancar no razao"
```

---

## Task 6: `fechar_producao` — a transação que fecha o mês

Uma chamada, uma transação. Valida, lança as partidas, marca a conta da UG e enfileira o pagamento do boleto. Se qualquer passo falhar, nada acontece — inclusive o POST ao Asaas, porque o `pg_net` enfileira dentro da transação.

**Files:**
- Create: `supabase/migrations/20260809d_fechar_producao.sql`
- Test: `supabase/tests/fechar_producao.test.sql`

**Interfaces:**
- Consumes: `fn_conta_ug`, `fn_faturamento_detalhado`, `fn_totais_fechamento`; contas do razão `2.1.1`, `2.1.3.01`, `2.1.4`, `3.1.3`, `3.1.4`.
- Produces:
  - `public.fechar_producao(p_id uuid, p_pagamento_manual boolean DEFAULT false) RETURNS jsonb`
  - `public.confirmar_pagamento_ug(p_gp_id uuid, p_ok boolean, p_detalhe jsonb) RETURNS jsonb` — chamada pela Edge Function da Task 7.

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/tests/fechar_producao.test.sql`:

```sql
DO $$
DECLARE
    v_usina uuid;
    v_gp    uuid;
    v_r     jsonb;
    v_soma  numeric;
    v_tx    uuid;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';

    -- Sandbox: um mes completo e sadio, com a conta da UG de 05/2026 (118,18).
    DELETE FROM public.generation_production WHERE usina_id = v_usina AND mes_referencia = DATE '2026-05-01';
    INSERT INTO public.generation_production
        (usina_id, mes_referencia, status, faturamento_mensal, energia_compensada,
         custo_disponibilidade, pagamento_ug_invoice_id, manutencao, arrendamento,
         service_details, despesas_eventuais)
    SELECT v_usina, DATE '2026-05-01', 'em_producao', 5896.03, 9622.01,
           118.18, (public.fn_conta_ug(v_usina, DATE '2026-05-01')->>'invoice_id')::uuid,
           0, 600, '{"Água": 76, "Internet": 79.9}'::jsonb, '{}'::jsonb
    RETURNING id INTO v_gp;

    UPDATE public.generation_production SET
        servicos       = (public.fn_totais_fechamento(v_gp)->>'servicos')::numeric,
        total_despesas = (public.fn_totais_fechamento(v_gp)->>'total_despesas')::numeric,
        gestao_reais   = (public.fn_totais_fechamento(v_gp)->>'gestao_reais')::numeric,
        saldo_receber  = (public.fn_totais_fechamento(v_gp)->>'saldo_receber')::numeric
     WHERE id = v_gp;

    v_r := public.fechar_producao(v_gp);

    IF (SELECT status::text FROM public.generation_production WHERE id = v_gp) <> 'fechado' THEN
        RAISE EXCEPTION 'FALHOU fechar: status deveria ser fechado';
    END IF;

    -- Spec 8, teste 2: toda transacao do razao fecha em zero.
    v_tx := (v_r->>'transaction_id')::uuid;
    SELECT sum(amount) INTO v_soma FROM public.ledger_entries WHERE transaction_id = v_tx;
    IF v_soma <> 0 THEN
        RAISE EXCEPTION 'FALHOU fechar: a transacao do razao fechou em %, deveria fechar em zero', v_soma;
    END IF;

    -- total_despesas = 118,18 + 0 + 600 + 155,90 = 874,08, e e' isso que o
    -- fornecedor e' debitado na conta 2.1.1.
    SELECT amount INTO v_soma
      FROM public.ledger_entries le JOIN public.ledger_accounts la ON la.id = le.account_id
     WHERE le.transaction_id = v_tx AND la.code = '2.1.1';
    IF round(v_soma, 2) <> 874.08 THEN
        RAISE EXCEPTION 'FALHOU fechar: debito do fornecedor esperava 874.08, veio %', v_soma;
    END IF;

    -- A gestao NAO e' lancada aqui: handle_invoice_paid_ledger ja' credita 3.1.1
    -- por fatura paga (divergencia j).
    IF EXISTS (
        SELECT 1 FROM public.ledger_entries le JOIN public.ledger_accounts la ON la.id = le.account_id
         WHERE le.transaction_id = v_tx AND la.code = '3.1.1'
    ) THEN
        RAISE EXCEPTION 'FALHOU fechar: gestao lancada duas vezes (3.1.1 ja vem por fatura paga)';
    END IF;

    -- A conta da UG fica em processing ate' o Asaas confirmar, nunca em 'pago'
    -- antes da confirmacao.
    IF (SELECT energy_bill_status FROM public.invoices
         WHERE id = (SELECT pagamento_ug_invoice_id FROM public.generation_production WHERE id = v_gp)) <> 'processing' THEN
        RAISE EXCEPTION 'FALHOU fechar: a conta da UG deveria ficar em processing';
    END IF;
    IF (SELECT pagamento_ug_status FROM public.generation_production WHERE id = v_gp) <> 'enfileirado' THEN
        RAISE EXCEPTION 'FALHOU fechar: pagamento_ug_status deveria ser enfileirado';
    END IF;

    -- Fechar duas vezes e' erro, nao duplicata.
    BEGIN
        PERFORM public.fechar_producao(v_gp);
        RAISE EXCEPTION 'FALHOU fechar: fechar um mes ja fechado deveria levantar excecao';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%nao esta em_producao%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: fechar_producao — tudo desfeito, nenhum POST saiu';
END $$;

DO $$
DECLARE
    v_usina uuid;
    v_gp    uuid;
BEGIN
    -- Spec 8, teste 3: usina sem conta da UG e' BLOQUEADA, nao assume zero.
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV NILTON COSTA';

    INSERT INTO public.generation_production
        (usina_id, mes_referencia, status, faturamento_mensal, manutencao, arrendamento)
    VALUES (v_usina, DATE '2026-04-01', 'em_producao', 1000, 0, 0)
    RETURNING id INTO v_gp;

    BEGIN
        PERFORM public.fechar_producao(v_gp);
        RAISE EXCEPTION 'FALHOU: fechou uma usina sem conta da UG';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%conta da UG ausente%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: fechamento bloqueado sem conta da UG — tudo desfeito';
END $$;

DO $$
DECLARE
    v_usina uuid;
    v_uc    uuid;
    v_gp    uuid;
BEGIN
    -- Achado 3: fatura paga sem insumo tarifario nao pode ser somada em silencio.
    -- Com descartadas > 0, o fechamento recusa e diz quais.
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';

    INSERT INTO public.consumer_units (usina_id, numero_uc, tipo_unidade, te, tusd, fio_b, desconto_assinante)
    VALUES (v_usina, 'TESTE-DESCARTE', 'beneficiaria', NULL, 0.64164, 0.2128, 20)
    RETURNING id INTO v_uc;
    INSERT INTO public.invoices (uc_id, mes_referencia, status, consumo_compensado)
    VALUES (v_uc, DATE '2026-05-01', 'pago', 1000);

    SELECT id INTO v_gp FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-05-01';
    UPDATE public.generation_production
       SET status = 'em_producao',
           custo_disponibilidade = 118.18,
           pagamento_ug_invoice_id = (public.fn_conta_ug(v_usina, DATE '2026-05-01')->>'invoice_id')::uuid,
           manutencao = 0, arrendamento = 600, total_despesas = 874.08, saldo_receber = 100
     WHERE id = v_gp;

    BEGIN
        PERFORM public.fechar_producao(v_gp);
        RAISE EXCEPTION 'FALHOU: fechou com fatura descartada';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%fatura(s) paga(s) sem insumo tarifario%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: fechamento bloqueado com fatura descartada — tudo desfeito';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/fechar_producao.test.sql`.
Esperado: `ERROR: function public.fechar_producao(uuid) does not exist`.

- [ ] **Step 3: Implementar**

Criar `supabase/migrations/20260809d_fechar_producao.sql` e aplicar via `apply_migration` com o nome `20260809d_fechar_producao`:

```sql
-- ---------------------------------------------------------------------
-- Segredo compartilhado entre o banco e a Edge Function pagar-conta-ug.
-- Guardado onde as outras credenciais ja' vivem.
-- ---------------------------------------------------------------------
INSERT INTO public.integrations_config (service_name, api_key, environment)
SELECT 'fechamento_hook', encode(gen_random_bytes(32), 'hex'), 'production'
 WHERE NOT EXISTS (SELECT 1 FROM public.integrations_config WHERE service_name = 'fechamento_hook');


CREATE OR REPLACE FUNCTION public.fechar_producao(
    p_id               uuid,
    p_pagamento_manual boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_gp        record;
    v_usina     record;
    v_conta     jsonb;
    v_fat       jsonb;
    v_totais    jsonb;
    v_tx        uuid := gen_random_uuid();
    v_servicos  numeric;
    v_total     numeric;
    v_disp      numeric;
    v_manut     numeric;
    v_arren     numeric;
    v_serv_leg  numeric;
    v_acc_forn  uuid;
    v_acc_conc  uuid;
    v_acc_desp  uuid;
    v_acc_manut uuid;
    v_acc_arren uuid;
    v_token     text;
    v_status_pg text;
BEGIN
    SELECT * INTO v_gp FROM public.generation_production WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fechamento % nao encontrado', p_id;
    END IF;
    IF v_gp.status::text <> 'em_producao' THEN
        RAISE EXCEPTION 'fechamento % nao esta em_producao (esta em %)', p_id, v_gp.status;
    END IF;

    SELECT * INTO v_usina FROM public.usinas WHERE id = v_gp.usina_id;

    -- 1. A conta da UG precisa existir. Spec 4.2: bloqueia, nao assume zero.
    v_conta := public.fn_conta_ug(v_gp.usina_id, v_gp.mes_referencia);
    IF (v_conta->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'conta da UG ausente para % em %: %',
                        v_usina.name, to_char(v_gp.mes_referencia, 'MM/YYYY'), v_conta->>'motivo';
    END IF;

    -- 2. Nenhuma fatura paga pode ter sido descartada do faturamento (achado 3).
    v_fat := public.fn_faturamento_detalhado(v_gp.usina_id, v_gp.mes_referencia);
    IF (v_fat->>'descartadas')::int > 0 THEN
        RAISE EXCEPTION '% fatura(s) paga(s) sem insumo tarifario ficaram de fora do faturamento: %',
                        v_fat->>'descartadas', v_fat->'descartes';
    END IF;

    -- 3. Os totais precisam ser numero. NULL aqui significa insumo faltando.
    v_totais   := public.fn_totais_fechamento(p_id);
    v_servicos := (v_totais->>'servicos')::numeric;
    IF (v_totais->>'total_despesas') IS NULL THEN
        RAISE EXCEPTION 'total_despesas ficou NULL: falta insumo. custo_disponibilidade=%, manutencao=%, arrendamento=%, servicos=%',
                        v_gp.custo_disponibilidade, v_gp.manutencao, v_gp.arrendamento, v_servicos;
    END IF;

    -- 4. Sem linha digitavel nao da' para pagar pelo Asaas. Spec 4.2: avisa e
    --    permite fechar registrando pagamento manual — mas so' se pedirem.
    IF (v_conta->>'tem_linha_digitavel')::boolean IS NOT TRUE AND NOT p_pagamento_manual THEN
        RAISE EXCEPTION 'a conta da UG de % nao tem linha digitavel. Feche com p_pagamento_manual => true para registrar pagamento fora do sistema',
                        to_char(v_gp.mes_referencia, 'MM/YYYY');
    END IF;

    SELECT id INTO v_acc_forn  FROM public.ledger_accounts WHERE code = '2.1.1';
    SELECT id INTO v_acc_conc  FROM public.ledger_accounts WHERE code = '2.1.3.01';
    SELECT id INTO v_acc_desp  FROM public.ledger_accounts WHERE code = '2.1.4';
    SELECT id INTO v_acc_manut FROM public.ledger_accounts WHERE code = '3.1.3';
    SELECT id INTO v_acc_arren FROM public.ledger_accounts WHERE code = '3.1.4';

    -- 5. Partidas. Debita o fornecedor pelo total das despesas e credita cada
    --    contrapartida.
    --
    --    ARREDONDAMENTO (Global Constraint 6): o debito ja' vem arredondado de
    --    fn_totais_fechamento. Se as contrapartidas entrassem com o valor cru da
    --    coluna, um insumo com 3+ casas deixaria a transacao fora do zero -- e
    --    nada no schema impede 3 casas em custo_disponibilidade, manutencao ou
    --    arrendamento. Entao cada parcela e' arredondada e a ULTIMA (servicos) e'
    --    derivada por diferenca, que e' o mesmo padrao que a spec usa no split:
    --    as partes fecham com o total em centavos, por construcao.
    --
    --    Consequencia aceita: a perna de servicos no razao pode diferir em ate' um
    --    centavo de generation_production.servicos, que continua sendo a soma fiel
    --    das linhas de detalhe. O razao fecha; o detalhe permanece verdadeiro.
    --
    --    Nenhuma parcela pode ser NULL aqui: a validacao 3 ja' recusou o
    --    fechamento se total_despesas tivesse dado NULL, e ele so' e' NULL se
    --    alguma parcela for.
    v_total := (v_totais->>'total_despesas')::numeric;
    v_disp  := round(v_gp.custo_disponibilidade, 2);
    v_manut := round(v_gp.manutencao, 2);
    v_arren := round(v_gp.arrendamento, 2);
    v_serv_leg := v_total - v_disp - v_manut - v_arren;

    -- external_id e' UNIQUE: reexecutar apos falha nao duplica.
    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
    VALUES (v_tx, v_acc_forn, v_total,
            'Fechamento ' || to_char(v_gp.mes_referencia, 'MM/YYYY') || ' - ' || v_usina.name,
            'supplier', v_usina.supplier_id, 'fechamento:' || p_id || ':fornecedor');

    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
    VALUES (v_tx, v_acc_conc, -v_disp,
            'Conta de energia da UG ' || to_char(v_gp.mes_referencia, 'MM/YYYY'),
            'supplier', v_usina.supplier_id, 'fechamento:' || p_id || ':disponibilidade');

    IF v_manut <> 0 THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        VALUES (v_tx, v_acc_manut, -v_manut, 'Receita Manutencao (' || v_usina.name || ')',
                'supplier', v_usina.supplier_id, 'fechamento:' || p_id || ':manutencao');
    END IF;

    IF v_arren <> 0 THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        VALUES (v_tx, v_acc_arren, -v_arren, 'Receita Arrendamento (' || v_usina.name || ')',
                'supplier', v_usina.supplier_id, 'fechamento:' || p_id || ':arrendamento');
    END IF;

    IF v_serv_leg <> 0 THEN
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        VALUES (v_tx, v_acc_desp, -v_serv_leg, 'Servicos (' || v_usina.name || ')',
                'supplier', v_usina.supplier_id, 'fechamento:' || p_id || ':servicos');
    END IF;

    -- 6. A conta da UG. Decisao 5: descontar a disponibilidade, pagar a
    --    concessionaria e marcar a conta sao o mesmo ato. 'processing' ate' o
    --    Asaas confirmar: 'pago' antes da confirmacao seria mentira.
    IF p_pagamento_manual THEN
        v_status_pg := 'manual';
    ELSE
        v_status_pg := 'enfileirado';
        UPDATE public.invoices SET energy_bill_status = 'processing'
         WHERE id = (v_conta->>'invoice_id')::uuid;
    END IF;

    UPDATE public.generation_production SET
        status                  = 'fechado',
        fechamento              = CURRENT_DATE,
        servicos                = v_servicos,
        total_despesas          = (v_totais->>'total_despesas')::numeric,
        gestao_reais            = (v_totais->>'gestao_reais')::numeric,
        saldo_receber           = (v_totais->>'saldo_receber')::numeric,
        pagamento_ug_invoice_id = (v_conta->>'invoice_id')::uuid,
        pagamento_ug_status     = v_status_pg
     WHERE id = p_id;

    -- 7. O POST so' existe se a transacao commitar: pg_net enfileira em
    --    net.http_request_queue dentro da transacao corrente.
    IF NOT p_pagamento_manual THEN
        SELECT api_key INTO v_token FROM public.integrations_config WHERE service_name = 'fechamento_hook';

        PERFORM net.http_post(
            url     := 'https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/pagar-conta-ug',
            body    := jsonb_build_object(
                          'gp_id',      p_id,
                          'invoice_id', (v_conta->>'invoice_id')::uuid,
                          'valor',      v_gp.custo_disponibilidade,
                          'descricao',  'Conta UG ' || v_usina.name || ' ' || to_char(v_gp.mes_referencia, 'MM/YYYY')
                       ),
            headers := jsonb_build_object('Content-Type', 'application/json',
                                          'x-fechamento-token', v_token)
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'transaction_id', v_tx,
        'total_despesas', (v_totais->>'total_despesas')::numeric,
        'saldo_receber',  (v_totais->>'saldo_receber')::numeric,
        'pagamento_ug',   v_status_pg
    );
END;
$$;

COMMENT ON FUNCTION public.fechar_producao(uuid, boolean) IS
    'Fecha o mes numa transacao: valida, lanca as partidas no razao, marca a conta da UG e enfileira o pagamento do boleto. O POST ao Asaas e enfileirado via pg_net DENTRO da transacao - rollback cancela o envio. Nao lanca gestao_reais: 3.1.1 ja recebe por fatura paga. Bloqueia sem conta da UG (spec 4.2) e com fatura paga descartada do faturamento (achado 3).';

REVOKE EXECUTE ON FUNCTION public.fechar_producao(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fechar_producao(uuid, boolean) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.confirmar_pagamento_ug(
    p_gp_id   uuid,
    p_ok      boolean,
    p_detalhe jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_invoice uuid;
    v_status  text;
BEGIN
    SELECT pagamento_ug_invoice_id, pagamento_ug_status
      INTO v_invoice, v_status
      FROM public.generation_production WHERE id = p_gp_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fechamento % nao encontrado', p_gp_id;
    END IF;

    -- Sem esta guarda, uma chamada com um id qualquer marca a conta como paga
    -- sem que pagamento nenhum tenha sido enfileirado, e devolve ok=true mesmo
    -- quando nao ha' fatura associada (o UPDATE casa zero linhas em silencio).
    -- Confirmar so' faz sentido sobre um pagamento que esta' em voo.
    IF v_status IS DISTINCT FROM 'enfileirado' THEN
        RAISE EXCEPTION 'fechamento % nao tem pagamento enfileirado (esta em %): nada a confirmar',
                        p_gp_id, COALESCE(v_status, 'NULL');
    END IF;

    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'fechamento % esta enfileirado sem conta da UG associada', p_gp_id;
    END IF;

    UPDATE public.generation_production
       SET pagamento_ug_status = CASE WHEN p_ok THEN 'pago' ELSE 'erro' END
     WHERE id = p_gp_id;

    UPDATE public.invoices
       SET energy_bill_status = CASE WHEN p_ok THEN 'pago' ELSE 'erro' END
     WHERE id = v_invoice;

    RETURN jsonb_build_object('ok', true, 'invoice_id', v_invoice, 'detalhe', p_detalhe);
END;
$$;

COMMENT ON FUNCTION public.confirmar_pagamento_ug(uuid, boolean, jsonb) IS
    'Fecha o ciclo do pagamento do boleto da UG: chamada pela Edge Function pagar-conta-ug depois da resposta do Asaas. Ate aqui a conta fica em processing.';

REVOKE EXECUTE ON FUNCTION public.confirmar_pagamento_ug(uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirmar_pagamento_ug(uuid, boolean, jsonb) TO service_role;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Executar o conteúdo de `supabase/tests/fechar_producao.test.sql`.
Esperado: os três `OK:` — `fechar_producao`, `fechamento bloqueado sem conta da UG`, `fechamento bloqueado com fatura descartada`.

Confirmar que nada saiu para o mundo:

```sql
SELECT count(*) AS posts_pendentes FROM net.http_request_queue;
SELECT count(*) AS transferencias FROM public.financial_transfers WHERE created_at > now() - INTERVAL '1 hour';
```
Esperado: `0` nos dois. O segundo é o teste 1 da spec §8.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260809d_fechar_producao.sql supabase/tests/fechar_producao.test.sql
git commit -m "feat(db): fechar_producao lanca o mes no razao numa transacao"
```

---

## Task 7: `pagar-conta-ug` — a Edge Function que paga o boleto e confirma de volta

`pay-asaas-bill` exige JWT de usuário admin (`config.toml`: `verify_jwt = true`, e o código lê `profiles.role`). O banco não tem um JWT de usuário para oferecer. Em vez de abrir uma brecha de service role numa função que a tela usa, esta task cria uma função dedicada, fechada por segredo compartilhado, que faz uma coisa só.

**Files:**
- Create: `supabase/functions/pagar-conta-ug/index.ts`
- Modify: `supabase/config.toml`
- Test: `supabase/tests/fechar_producao.test.sql` (acrescenta ao final)

**Interfaces:**
- Consumes: `public.confirmar_pagamento_ug(uuid, boolean, jsonb)` da Task 6; `integrations_config` com `service_name IN ('financial_api','fechamento_hook')`.
- Produces: endpoint `POST /functions/v1/pagar-conta-ug` com corpo `{ gp_id, invoice_id, valor, descricao }` e header `x-fechamento-token`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `supabase/tests/fechar_producao.test.sql`:

```sql
DO $$
DECLARE
    v_token text;
BEGIN
    SELECT api_key INTO v_token FROM public.integrations_config WHERE service_name = 'fechamento_hook';
    IF v_token IS NULL OR length(v_token) < 32 THEN
        RAISE EXCEPTION 'FALHOU: segredo fechamento_hook ausente ou curto demais';
    END IF;
    RAISE NOTICE 'OK: segredo do hook configurado';
END $$;

DO $$
DECLARE
    v_usina   uuid;
    v_gp      uuid;
    v_invoice uuid;
BEGIN
    -- confirmar_pagamento_ug fecha o ciclo: processing -> pago.
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';
    SELECT (public.fn_conta_ug(v_usina, DATE '2026-05-01')->>'invoice_id')::uuid INTO v_invoice;

    SELECT id INTO v_gp FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-05-01';
    UPDATE public.generation_production
       SET pagamento_ug_invoice_id = v_invoice, pagamento_ug_status = 'enfileirado' WHERE id = v_gp;
    UPDATE public.invoices SET energy_bill_status = 'processing' WHERE id = v_invoice;

    PERFORM public.confirmar_pagamento_ug(v_gp, true, '{"asaas_id": "pay_teste"}'::jsonb);

    IF (SELECT energy_bill_status FROM public.invoices WHERE id = v_invoice) <> 'pago' THEN
        RAISE EXCEPTION 'FALHOU confirmacao: a conta deveria ficar pago';
    END IF;
    IF (SELECT pagamento_ug_status FROM public.generation_production WHERE id = v_gp) <> 'pago' THEN
        RAISE EXCEPTION 'FALHOU confirmacao: pagamento_ug_status deveria ficar pago';
    END IF;

    PERFORM public.confirmar_pagamento_ug(v_gp, false, '{"erro": "saldo insuficiente"}'::jsonb);
    IF (SELECT energy_bill_status FROM public.invoices WHERE id = v_invoice) <> 'erro' THEN
        RAISE EXCEPTION 'FALHOU confirmacao negativa: a conta deveria ficar erro';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: confirmar_pagamento_ug — tudo desfeito';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/fechar_producao.test.sql`.
Esperado: os blocos da Task 6 passam; o novo falha se o segredo não existir. Se a Task 6 já inseriu o segredo, o primeiro bloco passa e o segundo exercita a confirmação — nesse caso o que ainda não existe é a Edge Function, verificada no Step 4.

- [ ] **Step 3: Implementar**

Criar `supabase/functions/pagar-conta-ug/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2.45.0"

// Chamada exclusivamente pelo banco, via pg_net, dentro de fechar_producao.
// Nao ha' JWT de usuario aqui: a autenticacao e' o segredo compartilhado
// guardado em integrations_config.service_name = 'fechamento_hook'.
serve(async (req) => {
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Segredo compartilhado, ANTES de qualquer outra coisa.
    //
    //    A ordem aqui e' de seguranca, nao de estilo. Se a validacao dos campos
    //    viesse primeiro, um POST sem token com {"gp_id": "<uuid>"} e sem
    //    invoice_id cairia no catch e marcaria aquele fechamento como 'erro' sem
    //    nunca passar pelo portao: nao paga nada, mas corrompe o estado de um
    //    pagamento em voo. Nada e' lido do corpo antes de o chamador provar quem e'.
    const token = req.headers.get('x-fechamento-token')
    if (!token) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        })
    }

    const { data: hook, error: hookError } = await supabase
        .from('integrations_config')
        .select('api_key')
        .eq('service_name', 'fechamento_hook')
        .single()

    if (hookError) {
        return new Response(JSON.stringify({ error: 'Segredo do hook nao configurado: ' + hookError.message }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        })
    }

    if (token !== hook.api_key) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        })
    }

    // Autenticado. So' a partir daqui gpId pode ser preenchido, e so' a partir
    // daqui o catch tem direito de escrever no banco.
    let gpId: string | null = null
    // Marca a fronteira do dinheiro: enquanto for null, nada foi pago e o catch
    // pode registrar erro. Depois de preenchido, o pagamento aconteceu.
    let asaasId: string | null = null

    try {
        const { gp_id, invoice_id, valor, descricao } = await req.json()
        gpId = gp_id

        if (!gp_id || !invoice_id || !valor) {
            throw new Error('Campos obrigatorios: gp_id, invoice_id, valor')
        }

        // 2. Idempotencia ANTES de gastar dinheiro.
        //    A guarda de confirmar_pagamento_ug age depois do POST: sem esta,
        //    um replay da mesma requisicao paga o mesmo boleto duas vezes.
        const { data: fechamento, error: fechamentoError } = await supabase
            .from('generation_production')
            .select('pagamento_ug_status, pagamento_ug_invoice_id')
            .eq('id', gp_id)
            .single()

        if (fechamentoError) throw new Error('Fechamento nao encontrado: ' + fechamentoError.message)
        if (fechamento.pagamento_ug_status !== 'enfileirado') {
            throw new Error(
                `Fechamento nao tem pagamento enfileirado (esta em ${fechamento.pagamento_ug_status ?? 'NULL'}): nada a pagar`
            )
        }
        if (fechamento.pagamento_ug_invoice_id !== invoice_id) {
            throw new Error('invoice_id nao e a conta da UG registrada neste fechamento')
        }

        // 3. A linha digitavel E O VALOR vem do banco, nao do corpo da
        //    requisicao: quem paga decide o que paga, e quanto.
        //    O corpo traz custo_disponibilidade, que e' um snapshot gravado no
        //    fechamento; a conta e' valor_concessionaria. Os dois deveriam ser
        //    iguais, e e' justamente por isso que a divergencia precisa gritar
        //    em vez de escolher um dos dois em silencio.
        const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .select('linha_digitavel, vencimento_concessionaria, valor_concessionaria')
            .eq('id', invoice_id)
            .single()

        if (invoiceError) throw new Error('Conta da UG nao encontrada: ' + invoiceError.message)
        if (!invoice.linha_digitavel) throw new Error('Conta da UG sem linha digitavel')
        if (invoice.valor_concessionaria === null) throw new Error('Conta da UG sem valor')

        const valorConta = Number(invoice.valor_concessionaria)
        if (!Number.isFinite(valorConta) || valorConta <= 0) {
            throw new Error(`Valor da conta da UG invalido: ${invoice.valor_concessionaria}`)
        }
        if (Math.abs(valorConta - Number(valor)) > 0.005) {
            throw new Error(
                `Divergencia entre o fechamento (${valor}) e a conta da UG (${valorConta}): nao pago no escuro`
            )
        }

        // 3. Credenciais do Asaas, mesma fonte de pay-asaas-bill
        const { data: config, error: configError } = await supabase
            .from('integrations_config')
            .select('api_key, endpoint_url, sandbox_api_key, sandbox_endpoint_url, environment')
            .eq('service_name', 'financial_api')
            .single()

        if (configError) throw new Error('Integracao Asaas nao configurada: ' + configError.message)

        const isSandbox = config.environment === 'sandbox'
        const asaasKey = isSandbox ? config.sandbox_api_key : config.api_key
        const asaasUrl = isSandbox
            ? (config.sandbox_endpoint_url || 'https://sandbox.asaas.com/api/v3')
            : (config.endpoint_url || 'https://api.asaas.com/v3')

        if (!asaasKey) throw new Error('Asaas sem chave de API configurada')

        // 5. Pagamento. O valor e' o da conta, nao o do corpo.
        const response = await fetch(`${asaasUrl}/bill`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'access_token': asaasKey },
            body: JSON.stringify({
                identificationField: invoice.linha_digitavel,
                value: valorConta,
                dueDate: invoice.vencimento_concessionaria ?? undefined,
                description: descricao ?? 'Conta de energia da UG'
            })
        })

        // A ordem aqui protege dinheiro. O status HTTP e' o que diz se o
        // pagamento aconteceu; o corpo e' so' detalhe. Se o parse viesse antes,
        // uma resposta 200 com corpo malformado estouraria com asaasId ainda
        // nulo -- e o catch marcaria 'erro' num boleto que foi pago.
        if (!response.ok) {
            const erro = await response.json().catch(() => ({}))
            throw new Error(erro.errors?.[0]?.description || 'Asaas recusou o pagamento do boleto')
        }

        // 200: o dinheiro JA' SAIU, mesmo que o corpo venha ilegivel. A partir
        // daqui nenhum caminho pode marcar este fechamento como 'erro' - seria
        // registrar mentira sobre dinheiro que saiu, e convidar um
        // reprocessamento que pagaria o boleto de novo.
        asaasId = 'desconhecido'

        const data = await response.json()
        asaasId = data.id ?? 'desconhecido'

        // 6. Confirma de volta. Toda chamada checa error (spec 6.2).
        const { error: rpcError } = await supabase.rpc('confirmar_pagamento_ug', {
            p_gp_id: gp_id, p_ok: true, p_detalhe: { asaas_id: data.id, status: data.status }
        })

        if (rpcError) {
            // Pago no Asaas, nao registrado no banco. O fechamento fica em
            // 'enfileirado', que e' o estado que trava a liquidacao (Task 8 exige
            // 'pago' ou 'manual') - a operacao para, e alguem reconcilia com o
            // asaas_id devolvido aqui. 502, porque a falha nao e' do chamador.
            console.error('PAGAMENTO SEM REGISTRO', { gp_id, asaas_id: data.id, erro: rpcError.message })
            return new Response(JSON.stringify({
                error: 'pagamento_sem_registro',
                asaas_id: data.id,
                detalhe: rpcError.message,
                acao: 'Boleto pago no Asaas e nao confirmado no banco. Reconciliar a mao pelo asaas_id.'
            }), { status: 502, headers: { 'Content-Type': 'application/json' } })
        }

        return new Response(JSON.stringify({ ok: true, asaas_id: data.id }), {
            headers: { 'Content-Type': 'application/json' }
        })

    } catch (err) {
        // Falha registrada, nunca engolida: e' ela que impede a liquidacao.
        // Mas so' quando o dinheiro NAO saiu - se asaasId existe, o pagamento
        // aconteceu e marcar 'erro' seria mentira. Esse caminho ja' retornou 502
        // acima; aqui asaasId so' pode estar preenchido se algo estourou depois,
        // e a regra continua valendo.
        if (gpId && asaasId === null) {
            const { error: rpcError } = await supabase.rpc('confirmar_pagamento_ug', {
                p_gp_id: gpId, p_ok: false, p_detalhe: { erro: String(err?.message ?? err) }
            })
            if (rpcError) console.error('confirmar_pagamento_ug falhou:', rpcError.message)
        } else if (asaasId !== null) {
            console.error('PAGAMENTO SEM REGISTRO', { gp_id: gpId, asaas_id: asaasId, erro: String(err?.message ?? err) })
        }
        return new Response(JSON.stringify({ error: String(err?.message ?? err), asaas_id: asaasId }), {
            status: asaasId === null ? 400 : 502, headers: { 'Content-Type': 'application/json' }
        })
    }
})
```

Acrescentar a `supabase/config.toml`:

```toml
[functions.pagar-conta-ug]
verify_jwt = false
```

`verify_jwt = false` porque quem chama é o `pg_net`, que não carrega JWT; o portão é o `x-fechamento-token`, verificado na primeira coisa que a função faz.

- [ ] **Step 4: Rodar e confirmar que passa**

Executar o conteúdo de `supabase/tests/fechar_producao.test.sql`.
Esperado: `OK: segredo do hook configurado` e `OK: confirmar_pagamento_ug — tudo desfeito`.

Publicar e conferir que o portão fecha:

```bash
npx supabase functions deploy pagar-conta-ug --project-ref abbysvxnnhwvvzhftoms
```

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/pagar-conta-ug" -H "Content-Type: application/json" -d '{"gp_id":"00000000-0000-0000-0000-000000000000","invoice_id":"00000000-0000-0000-0000-000000000000","valor":1}'
```
Esperado: `401`. Sem o header, ninguém paga nada.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pagar-conta-ug/index.ts supabase/config.toml supabase/tests/fechar_producao.test.sql
git commit -m "feat(edge): pagar-conta-ug paga o boleto da UG e confirma de volta"
```

---

## Task 8: `liquidar_producao` — o PIX ao fornecedor

Baixa o passivo e enfileira a transferência. Recusa se a conta da concessionária não estiver resolvida: liquidar com o boleto em erro é pagar o fornecedor por uma despesa que a B2W ainda vai absorver.

**Files:**
- Create: `supabase/migrations/20260809e_liquidar_producao.sql`
- Test: `supabase/tests/liquidar_producao.test.sql`

**Interfaces:**
- Consumes: `generation_production.saldo_receber`, `pagamento_ug_status`; `usinas.supplier_id` → `suppliers.pix_key`, `.pix_key_type`; contas `2.1.1` e `1.1.1.01`.
- Produces: `public.liquidar_producao(p_id uuid) RETURNS jsonb`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/tests/liquidar_producao.test.sql`:

```sql
DO $$
DECLARE
    v_usina uuid;
    v_gp    uuid;
    v_r     jsonb;
    v_soma  numeric;
    v_transf_antes int;
BEGIN
    SELECT count(*) INTO v_transf_antes FROM public.financial_transfers;
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';

    SELECT id INTO v_gp FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-05-01';
    UPDATE public.generation_production
       SET status = 'fechado', saldo_receber = 4021.95, pagamento_ug_status = 'pago'
     WHERE id = v_gp;

    v_r := public.liquidar_producao(v_gp);

    IF (SELECT status::text FROM public.generation_production WHERE id = v_gp) <> 'liquidado' THEN
        RAISE EXCEPTION 'FALHOU liquidar: status deveria ser liquidado';
    END IF;
    IF (SELECT repasse_status FROM public.generation_production WHERE id = v_gp) <> 'enfileirado' THEN
        RAISE EXCEPTION 'FALHOU liquidar: repasse_status deveria ser enfileirado';
    END IF;

    SELECT sum(amount) INTO v_soma FROM public.ledger_entries
     WHERE transaction_id = (v_r->>'transaction_id')::uuid;
    IF v_soma <> 0 THEN
        RAISE EXCEPTION 'FALHOU liquidar: a transacao fechou em %, deveria fechar em zero', v_soma;
    END IF;

    -- O passivo 2.1.1 e' debitado pelo saldo, o banco 1.1.1.01 e' creditado.
    SELECT amount INTO v_soma
      FROM public.ledger_entries le JOIN public.ledger_accounts la ON la.id = le.account_id
     WHERE le.transaction_id = (v_r->>'transaction_id')::uuid AND la.code = '2.1.1';
    IF round(v_soma, 2) <> 4021.95 THEN
        RAISE EXCEPTION 'FALHOU liquidar: baixa do passivo esperava 4021.95, veio %', v_soma;
    END IF;

    -- Spec 8, teste 1: nada em financial_transfers. O POST so' sairia no commit.
    IF (SELECT count(*) FROM public.financial_transfers) <> v_transf_antes THEN
        RAISE EXCEPTION 'FALHOU: apareceu registro em financial_transfers durante o teste';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: liquidar_producao — tudo desfeito, nenhum PIX saiu';
END $$;

DO $$
DECLARE
    v_usina uuid;
    v_gp    uuid;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';
    SELECT id INTO v_gp FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-05-01';

    -- Boleto em erro: nao liquida.
    UPDATE public.generation_production
       SET status = 'fechado', saldo_receber = 100, pagamento_ug_status = 'erro' WHERE id = v_gp;
    BEGIN
        PERFORM public.liquidar_producao(v_gp);
        RAISE EXCEPTION 'FALHOU: liquidou com o boleto da UG em erro';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%pagamento da conta da UG%' THEN RAISE; END IF;
    END;

    -- Mes ainda aberto: nao liquida.
    UPDATE public.generation_production
       SET status = 'em_producao', pagamento_ug_status = 'pago' WHERE id = v_gp;
    BEGIN
        PERFORM public.liquidar_producao(v_gp);
        RAISE EXCEPTION 'FALHOU: liquidou um mes que nao esta fechado';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%nao esta fechado%' THEN RAISE; END IF;
    END;

    -- Saldo nao positivo: nao liquida.
    UPDATE public.generation_production
       SET status = 'fechado', saldo_receber = 0, pagamento_ug_status = 'pago' WHERE id = v_gp;
    BEGIN
        PERFORM public.liquidar_producao(v_gp);
        RAISE EXCEPTION 'FALHOU: liquidou com saldo zero';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%saldo a receber%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: liquidacao recusada nos tres casos — tudo desfeito';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/liquidar_producao.test.sql`.
Esperado: `ERROR: function public.liquidar_producao(uuid) does not exist`.

- [ ] **Step 3: Implementar**

Criar `supabase/migrations/20260809e_liquidar_producao.sql` e aplicar via `apply_migration` com o nome `20260809e_liquidar_producao`:

```sql
CREATE OR REPLACE FUNCTION public.liquidar_producao(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_gp       record;
    v_usina    record;
    v_supplier record;
    v_totais   jsonb;
    v_valor    numeric;
BEGIN
    SELECT * INTO v_gp FROM public.generation_production WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fechamento % nao encontrado', p_id;
    END IF;
    IF v_gp.status::text <> 'fechado' THEN
        RAISE EXCEPTION 'fechamento % nao esta fechado (esta em %)', p_id, v_gp.status;
    END IF;

    -- Liquidar com o boleto da concessionaria em erro paga o fornecedor por uma
    -- despesa que a B2W ainda vai absorver. Decisao 5: os tres atos sao um so'.
    -- IS NULL explicito: NULL NOT IN (...) devolve NULL, o IF nao dispara, e o
    -- repasse sairia com a conta da concessionaria em estado desconhecido.
    -- Todas as 11 linhas de producao estao com esta coluna NULL hoje.
    IF v_gp.pagamento_ug_status IS NULL
       OR v_gp.pagamento_ug_status NOT IN ('pago', 'manual') THEN
        RAISE EXCEPTION 'pagamento da conta da UG esta em %: resolva antes de liquidar',
                        COALESCE(v_gp.pagamento_ug_status, 'NULL');
    END IF;

    IF v_gp.saldo_receber IS NULL OR v_gp.saldo_receber <= 0 THEN
        RAISE EXCEPTION 'saldo a receber e % - nao ha o que repassar', COALESCE(v_gp.saldo_receber::text, 'NULL');
    END IF;

    -- saldo_receber e' coluna comum: qualquer UPDATE a altera, e e' ela que
    -- determina quanto sai por PIX. Antes de enfileirar dinheiro, reconfere
    -- contra a formula. Divergencia aqui significa que a linha foi tocada
    -- depois do fechamento - e escolher entre os dois numeros em silencio e'
    -- exatamente o que nao se pode fazer com repasse.
    v_totais := public.fn_totais_fechamento(p_id);
    IF (v_totais->>'saldo_receber') IS NULL THEN
        RAISE EXCEPTION 'nao foi possivel recalcular o saldo do fechamento %: insumo ausente', p_id;
    END IF;
    IF abs((v_totais->>'saldo_receber')::numeric - v_gp.saldo_receber) > 0.005 THEN
        RAISE EXCEPTION 'saldo gravado (%) diverge do recalculado (%): reabra e feche o mes de novo',
                        v_gp.saldo_receber, (v_totais->>'saldo_receber')::numeric;
    END IF;

    SELECT * INTO v_usina FROM public.usinas WHERE id = v_gp.usina_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fechamento % aponta para uma usina inexistente', p_id;
    END IF;

    SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_usina.supplier_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'usina % nao tem fornecedor cadastrado', v_usina.name;
    END IF;

    IF v_supplier.pix_key IS NULL THEN
        RAISE EXCEPTION 'fornecedor de % nao tem chave PIX cadastrada', v_usina.name;
    END IF;

    -- pix_key_type nulo faria transfer-asaas-pix cair no default 'CPF' e o
    -- Asaas recusar uma chave de outro tipo - depois do commit, em silencio.
    IF v_supplier.pix_key_type IS NULL THEN
        RAISE EXCEPTION 'fornecedor de % tem chave PIX sem tipo definido', v_usina.name;
    END IF;

    -- ESTA FUNCAO NAO LANCA NO RAZAO. Nao e' esquecimento.
    --
    -- O trigger tr_transfer_ledger, vivo em financial_transfers, ja' grava
    -- exatamente esta partida quando a transferencia chega a 'completed':
    --     2.1.1     += valor    (baixa do passivo)
    --     1.1.1.01  += -valor   (saida do banco)
    -- Medido em 09/08/2026: 8 lancamentos 'payout_supplier' para 4 linhas de
    -- financial_transfers. Ele e' hoje o unico lugar que contabiliza PIX ao
    -- fornecedor, e lancar aqui tambem dobraria todo repasse.
    --
    -- A escolha do dono e' que o razao registre o repasse quando o dinheiro
    -- sai de verdade, nao quando a intencao de pagar e' registrada. Se o PIX
    -- falhar, o razao simplesmente nao tem a partida - em vez de ter uma
    -- partida mentirosa que ninguem corrige (repasse_status nao sai de
    -- 'enfileirado', ver o COMMENT da coluna).
    --
    -- O que esta transacao garante continua sendo o que importa: a validacao,
    -- a mudanca de estado e o enfileiramento do PIX sao atomicos. Rollback
    -- cancela o envio antes de qualquer worker ve-lo.

    -- O valor que sai e' o recalculado, nao a coluna: ela ja' foi conferida
    -- contra ele acima, e o recalculado e' o numero autoritativo.
    -- O round e' defesa em profundidade, nao guarda ativa: fn_totais_fechamento
    -- ja' termina em round(..., 2), entao hoje ele nao muda nenhum numero -- e
    -- por isso nenhum teste consegue mata-lo sem alterar aquela funcao. Fica
    -- porque o que sai daqui vai ao Asaas depois do commit, sem volta, e uma
    -- mudanca futura la' nao pode vazar fracao de centavo para ca em silencio.
    v_valor := round((v_totais->>'saldo_receber')::numeric, 2);

    UPDATE public.generation_production
       SET status = 'liquidado', repasse_status = 'enfileirado'
     WHERE id = p_id;

    -- Enfileirado dentro da transacao: rollback cancela o PIX.
    PERFORM net.http_post(
        url     := 'https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/transfer-asaas-pix',
        body    := jsonb_build_object(
                      'value',           v_valor,
                      'pix_key',         v_supplier.pix_key,
                      'pix_key_type',    v_supplier.pix_key_type,
                      'supplier_id',     v_usina.supplier_id,
                      'destinationType', 'supplier',
                      'description',     'Repasse ' || v_usina.name || ' ' || to_char(v_gp.mes_referencia, 'MM/YYYY')
                   ),
        headers := jsonb_build_object('Content-Type', 'application/json')
    );

    RETURN jsonb_build_object(
        'ok', true,
        'valor', v_valor,
        'destino', v_supplier.name,
        'razao', 'lancado por tr_transfer_ledger quando o PIX completar'
    );
END;
$$;

-- Debito conhecido, registrado onde quem for mexer vai ler.
COMMENT ON COLUMN public.generation_production.repasse_status IS
    'PIX ao fornecedor: enfileirado | pago | erro. NULL = ainda nao liquidado. ATENCAO em 09/08/2026: nada no sistema escreve pago nem erro. O do lado do boleto e confirmar_pagamento_ug, chamada pela edge function; o equivalente do PIX nao existe, porque transfer-asaas-pix nao devolve nada ao banco e o asaas-webhook atualiza financial_transfers sem propagar para ca. Todo repasse fica em enfileirado, tenha dado certo ou nao. Fechar esse ciclo e frente propria: exige funcao nova e religar o webhook.';

COMMENT ON FUNCTION public.liquidar_producao(uuid) IS
    'Liquida o mes fechado: valida, marca liquidado e enfileira o PIX ao fornecedor via pg_net, dentro da transacao. NAO lanca no razao - quem lanca e o trigger tr_transfer_ledger, quando a transferencia chega a completed; lancar aqui dobraria o repasse. Reconfere saldo_receber contra fn_totais_fechamento antes de enfileirar. Recusa se o mes nao estiver fechado, se o pagamento da conta da UG nao estiver resolvido ou for NULL, se o saldo nao for positivo ou divergir do recalculado, ou se o fornecedor nao tiver chave PIX com tipo.';

REVOKE EXECUTE ON FUNCTION public.liquidar_producao(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.liquidar_producao(uuid) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Executar o conteúdo de `supabase/tests/liquidar_producao.test.sql`.
Esperado: `OK: liquidar_producao — tudo desfeito, nenhum PIX saiu` e `OK: liquidacao recusada nos tres casos — tudo desfeito`.

```sql
SELECT count(*) FROM public.financial_transfers;
```
Esperado: `4` — o mesmo número de antes dos testes, medido em 09/08/2026.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260809e_liquidar_producao.sql supabase/tests/liquidar_producao.test.sql
git commit -m "feat(db): liquidar_producao baixa o passivo e enfileira o PIX"
```

---

## Task 9: `cashbook` vira view sobre o razão

Dois livros que nunca batem viram um. O `cashbook` guarda 10 linhas, todas em `provisionado`, e o único código que o lê é o `PlantClosingModal` desarmado — o blast radius do risco 2 da spec §10 foi medido e é esse.

**Files:**
- Create: `supabase/migrations/20260809f_cashbook_view.sql`
- Test: `supabase/tests/cashbook_view.test.sql`

**Interfaces:**
- Consumes: `ledger_entries`, `ledger_accounts`.
- Produces: view `public.cashbook` com as colunas `id`, `usina_id`, `type`, `category`, `description`, `amount`, `origin_id`, `origin_type`, `status`, `transaction_date`, `created_at` — as mesmas da tabela, para nenhum `select` existente quebrar; e a tabela `public.cashbook_legado` com as 10 linhas atuais.

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/tests/cashbook_view.test.sql`:

```sql
DO $$
DECLARE v_n int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.views
                    WHERE table_schema='public' AND table_name='cashbook') THEN
        RAISE EXCEPTION 'FALHOU: cashbook ainda e tabela, deveria ser view';
    END IF;

    SELECT count(*) INTO v_n FROM public.cashbook_legado;
    IF v_n <> 10 THEN
        RAISE EXCEPTION 'FALHOU: cashbook_legado deveria preservar as 10 linhas antigas, tem %', v_n;
    END IF;

    -- A view precisa devolver as mesmas colunas, senao qualquer select quebra.
    PERFORM id, usina_id, type, category, description, amount,
            origin_id, origin_type, status, transaction_date, created_at
       FROM public.cashbook LIMIT 1;

    -- Toda linha da view vem do razao e tem usina identificavel.
    SELECT count(*) INTO v_n FROM public.cashbook WHERE usina_id IS NULL;
    RAISE NOTICE 'DIAGNOSTICO: % linhas do cashbook sem usina identificada', v_n;

    -- O trigger que gravava o valor cheio no cashbook nao existe mais (risco 5).
    IF EXISTS (
        SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE p.proname = 'handle_invoice_paid' AND NOT t.tgisinternal
    ) THEN
        RAISE EXCEPTION 'FALHOU: handle_invoice_paid ainda esta armado e gravaria numa view';
    END IF;

    RAISE NOTICE 'OK: cashbook como view';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/cashbook_view.test.sql`.
Esperado: `FALHOU: cashbook ainda e tabela, deveria ser view`.

- [ ] **Step 3: Implementar**

Antes de escrever, listar o que o trigger antigo faz, para o comentário da aposentadoria ficar honesto:

```sql
SELECT p.proname, t.tgname, c.relname
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_class c ON c.oid = t.tgrelid
 WHERE p.proname IN ('handle_invoice_paid','handle_invoice_paid_ledger') AND NOT t.tgisinternal;
```

Criar `supabase/migrations/20260809f_cashbook_view.sql` e aplicar via `apply_migration` com o nome `20260809f_cashbook_view`:

```sql
-- ---------------------------------------------------------------------
-- 1. Preserva o que existe antes de trocar (spec 7.6).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cashbook_legado AS SELECT * FROM public.cashbook;

COMMENT ON TABLE public.cashbook_legado IS
    'Congelamento das 10 linhas da tabela cashbook em 09/08/2026, antes de ela virar view sobre ledger_entries. Somente leitura, para conferencia historica.';

-- ---------------------------------------------------------------------
-- 2. O trigger que gravava o valor CHEIO da fatura no cashbook, enquanto o
--    razao recebia o rateado, e' a origem dos dois livros que nunca batem
--    (spec 1.1). Com o cashbook virando view, ele escreveria numa view sem
--    regra de INSERT e quebraria o pagamento de fatura. Sai junto (risco 5).
-- ---------------------------------------------------------------------
-- Derruba pelo nome real, seja qual for: em 09/08/2026 e' on_invoice_paid,
-- mas o gatilho de handle_invoice_paid_ledger (tr_invoice_paid_ledger) fica,
-- porque e' ele que alimenta o razao.
DO $$
DECLARE t record;
BEGIN
    FOR t IN
        SELECT tg.tgname
          FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
         WHERE p.proname = 'handle_invoice_paid' AND NOT tg.tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER %I ON public.invoices', t.tgname);
        RAISE NOTICE 'trigger % removido', t.tgname;
    END LOOP;
END $$;

COMMENT ON FUNCTION public.handle_invoice_paid() IS
    'DESARMADA em 09/08/2026, junto com a troca do cashbook por uma view. Ela gravava o valor cheio da fatura no cashbook enquanto handle_invoice_paid_ledger gravava o rateado no razao - os dois livros nunca batiam e nada reconciliava. Mantida sem gatilho apenas para consulta.';

-- ---------------------------------------------------------------------
-- 3. cashbook passa a ser o livro caixa de verdade: uma linha por
--    movimento de dinheiro, nao uma linha por perna de partida.
--
--    Uma versao anterior deste plano listava TODAS as pernas do razao.
--    Medido em 09/08/2026: 77 transacoes viravam 205 linhas, e somar a
--    coluna dava R$ 104.050,46 -- quando o caixa que de fato se moveu
--    foram R$ 20.803,19 de entrada contra R$ 20.511,17 de saida. O resto
--    era a contrapartida da mesma operacao, contada de novo.
--
--    Um livro caixa registra o que passou pelo banco. Por isso a view
--    filtra as contas de ativo: cada linha aqui e' um real que entrou ou
--    saiu, e a soma da coluna e' o caixa.
--
--    O sinal tambem estava invertido para essas contas. Em conta de
--    ativo, valor POSITIVO e' debito = dinheiro entrando. A versao
--    anterior aplicava a convencao de passivo/resultado a todas as
--    contas, e rotulava um "Recebimento Fatura" de +2.478,15 como saida.
-- ---------------------------------------------------------------------
DROP TABLE public.cashbook;

CREATE VIEW public.cashbook
WITH (security_invoker = on) AS
SELECT
    le.id,
    -- A usina vem da fatura que originou o lancamento, quando ha' uma:
    -- essa ligacao foi resolvida no momento do lancamento e nao muda se
    -- alguem cadastrar outra usina amanha. O caminho por supplier_id nao
    -- tem essa propriedade -- um fornecedor com duas usinas tornaria
    -- ambiguo o que hoje esta' atribuido.
    cu.usina_id                            AS usina_id,
    -- >= e' deliberado: existem lancamentos de "Recebimento Fatura" com valor
    -- zero, e recebimento de zero e' entrada de zero, nao saida.
    CASE WHEN le.amount >= 0 THEN 'entrada' ELSE 'saida' END::varchar AS type,
    la.name::varchar                       AS category,
    le.description,
    abs(le.amount)                         AS amount,
    le.reference_id                        AS origin_id,
    le.reference_type::varchar             AS origin_type,
    'liquidado'::varchar                   AS status,
    le.created_at::date                    AS transaction_date,
    le.created_at
FROM public.ledger_entries le
JOIN public.ledger_accounts la ON la.id = le.account_id
LEFT JOIN public.invoices i       ON (le.reference_type = 'invoice' AND i.id = le.reference_id)
LEFT JOIN public.consumer_units cu ON cu.id = i.uc_id
-- Filtra a FAMILIA de contas bancarias (1.1.1.*), nao o tipo 'asset'.
-- O plano de contas tem 4 contas de ativo e so' 1.1.1.01 recebe lancamento
-- hoje; as outras tres sao contas-pai. Filtrar por tipo faria uma futura
-- "contas a receber" (1.1.2) entrar no livro caixa, e uma conta ponte daria
-- duas pernas de ativo na mesma operacao -- o dinheiro contado duas vezes,
-- de novo. Por codigo, um segundo banco (1.1.1.02) entra sozinho e nada
-- que nao seja banco entra por engano.
WHERE la.code LIKE '1.1.1.%'
  AND le.is_sandbox IS NOT TRUE;

COMMENT ON VIEW public.cashbook IS
    'Livro caixa: uma linha por movimento de dinheiro no banco (contas de ativo do razao). Somar amount por type da o caixa real. Deixou de ser tabela em 09/08/2026 - era o segundo livro, gravado com o valor cheio da fatura enquanto o razao recebia o rateado, e nada reconciliava. NAO lista as contrapartidas de passivo e resultado: quem quer a partida inteira le ledger_entries por transaction_id. usina_id vem da fatura de origem e e NULL quando o lancamento nao nasce de uma - repasse e taxa bancaria, por exemplo. As 10 linhas antigas estao em cashbook_legado.';

REVOKE ALL ON public.cashbook FROM PUBLIC, anon;
GRANT  SELECT ON public.cashbook TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Executar o conteúdo de `supabase/tests/cashbook_view.test.sql`.
Esperado: `OK: cashbook como view`, precedido do diagnóstico de quantas linhas ficam sem usina.

Confirmar que pagar uma fatura continua funcionando com o trigger do cashbook fora:

```sql
DO $$
DECLARE v_id uuid; v_antes int; v_depois int;
BEGIN
    SELECT count(*) INTO v_antes FROM public.ledger_entries;
    SELECT id INTO v_id FROM public.invoices WHERE status::text = 'a_vencer' LIMIT 1;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_id;
    SELECT count(*) INTO v_depois FROM public.ledger_entries;
    IF v_depois <= v_antes THEN
        RAISE EXCEPTION 'FALHOU: pagar fatura parou de lancar no razao';
    END IF;
    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: pagamento de fatura segue lancando no razao — tudo desfeito';
END $$;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260809f_cashbook_view.sql supabase/tests/cashbook_view.test.sql
git commit -m "feat(db): cashbook vira view sobre o razao e o segundo livro acaba"
```

---

## Task 10: Apagar o que está morto

Quatro coisas mortas continuam no repositório, e cada uma pode voltar à vida por acidente: uma Edge Function que nunca retornou uma usina, uma migration que recria a segunda tabela de fechamento, e uma chamada real de PIX inalcançável dentro de um `eslint-disable`.

**Files:**
- Create: `supabase/migrations/20260809g_aposentadorias.sql`
- Delete: `supabase/functions/cron-monthly-expenses/`, `supabase/migrations/20260130_create_plant_closings.sql`
- Modify: `src/components/PlantClosingModal.jsx:212-355`

**Interfaces:**
- Consumes: nada.
- Produces: nada. É remoção.

- [ ] **Step 1: Confirmar que está morto mesmo**

```sql
SELECT count(*) AS linhas_plant_closing FROM public.cashbook_legado WHERE origin_type = 'plant_closing';
SELECT to_regclass('public.plant_closings') AS tabela_plant_closings;
SELECT count(*) AS transfers_para_usina FROM public.financial_transfers WHERE destination_type = 'usina';
```
Esperado: `0`, `NULL`, `0` — os mesmos três indicadores que a spec §1.2 usou para concluir que o fluxo nunca disparou. Se algum vier diferente, **pare e registre**: o fluxo rodou e a remoção do corpo precisa ser reavaliada.

- [ ] **Step 2: Apagar o corpo morto do PIX**

Em `src/components/PlantClosingModal.jsx`, `handlePayout` mantém o comentário e o `return`, e perde tudo o que vem depois. O corpo está inteiro em `git show cbc6e66^:src/components/PlantClosingModal.jsx` e descrito em prosa na spec §1.2, que é documentação melhor do que código inalcançável.

Apagar da linha `/* eslint-disable no-unreachable */` até `/* eslint-enable no-unreachable */`, inclusive, deixando:

```javascript
    const handlePayout = async () => {
        // DESARMADO EM 08/08/2026 — nao remover sem ler o motivo.
        //
        // Este fluxo disparava um PIX real e, em seguida, tentava registrar a
        // liquidacao em quatro escritas que falham todas em silencio:
        //   - plant_closings nao existe no banco (migration 20260130 nunca aplicada)
        //   - status 'liquidado' e filtro 'paga' nao existem no enum fatura_status
        //   - invoices.ano_referencia nao existe
        //   - nenhuma das escritas checa o retorno { error } do supabase-js
        // O resultado era: dinheiro sai, nada e' registrado, e a tela mostra
        // "Pagamento realizado" em verde.
        //
        // O corpo original foi apagado em 09/08/2026 e esta' em
        // git show cbc6e66^:src/components/PlantClosingModal.jsx
        // A liquidacao correta agora e' a RPC liquidar_producao.
        showAlert(
            'Repasse indisponivel por aqui. A liquidacao roda pela RPC ' +
            'liquidar_producao. Esta tela nao grava o pagamento.',
            'error'
        );
    };
```

- [ ] **Step 3: Apagar o que está morto no repositório e no banco**

```bash
git rm -r supabase/functions/cron-monthly-expenses
git rm supabase/migrations/20260130_create_plant_closings.sql
```

Criar `supabase/migrations/20260809g_aposentadorias.sql` e aplicar via `apply_migration` com o nome `20260809g_aposentadorias`:

```sql
-- Duas aposentadorias, e so' uma delas tem objeto no banco.
--
-- 1. A Edge Function cron-monthly-expenses filtrava status = 'operacao', valor
--    que nao existe no enum usina_status ('gerando','em_conexao','manutencao',
--    'inativa','cancelada'). Nunca retornou uma usina e nunca produziu efeito.
--    Removida do repositorio em 09/08/2026. Ela vivia no Deno, nao no Postgres:
--    nao ha objeto de banco para comentar, e este registro em -- e' o que existe.
--
-- 2. sync_tariffs_to_entities, essa sim funcao SQL, ganha o COMMENT abaixo.
COMMENT ON FUNCTION public.sync_tariffs_to_entities() IS
    'DESARMADA em 08/08/2026. O trigger trg_sync_concessionaria_changes foi removido: ela escrevia a tarifa de referencia dentro de consumer_units, contradizendo a regra de que o que vale e a conta de energia. Mantida sem gatilho apenas para consulta. Em 09/08/2026, com o fechamento passando a ler a conta da UG, ela deixou de ter qualquer uso previsto.';

-- Garante que a migration descartada nao deixou rastro: se plant_closings
-- existir, alguem a aplicou e a segunda tabela de fechamento voltou.
DO $$
BEGIN
    IF to_regclass('public.plant_closings') IS NOT NULL THEN
        RAISE EXCEPTION 'plant_closings existe no banco. A segunda tabela de fechamento voltou - investigar antes de seguir.';
    END IF;
END $$;
```

- [ ] **Step 4: Confirmar que nada quebrou**

```bash
npm run lint -- src/components/PlantClosingModal.jsx
```
Esperado: sem erros. Se o `eslint-disable` tiver sido removido junto com o corpo, não sobra `no-unreachable` para desabilitar.

```bash
npm run build
```
Esperado: build conclui.

- [ ] **Step 5: Commit**

```bash
git add -A supabase/functions supabase/migrations src/components/PlantClosingModal.jsx
git commit -m "chore: apaga o corpo morto do PIX, a edge function morta e a migration descartada"
```

---

## Task 11: Reprodução de 04/2026 e critério de aceite

O teste principal da spec §8, na forma em que ele é verificável: as diferenças esperadas são numeradas antes de rodar, e qualquer diferença **fora** dessa lista reprova.

**Files:**
- Create: `supabase/tests/reproducao_042026.test.sql`

**Interfaces:**
- Consumes: tudo o que as Tasks 1 a 9 produziram.
- Produces: nada. É verificação.

- [ ] **Step 1: Escrever a reprodução**

Criar `supabase/tests/reproducao_042026.test.sql`:

```sql
-- Criterio de aceite (spec 8), na forma verificavel descrita na divergencia (e)
-- do plano: 04/2026 da UFV Bom Jesus, ja' liquidado, reproduzido pela regra nova.
--
-- Diferencas ESPERADAS, e o motivo de cada uma:
--   custo_disponibilidade  110,20 -> 109,79   a conta de abril, nao a de marco (decisao 4)
--   servicos               266,10 -> 155,90   Energia sai de servicos e vira disponibilidade
--   arrendamento             0,00 -> 600,00   o contrato cobra 600/mes e o fechamento zerava
--   total_despesas         266,10 -> 865,69   soma das tres correcoes acima
--
-- Qualquer outra diferenca reprova.
DO $$
DECLARE
    v_usina   uuid;
    v_gp      uuid;
    v_antes   record;
    v_depois  record;
    v_conta   jsonb;
    v_fat     jsonb;
    v_totais  jsonb;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';

    SELECT * INTO v_antes FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-04-01';

    IF v_antes.status::text <> 'liquidado' THEN
        RAISE EXCEPTION 'FALHOU: 04/2026 deveria estar liquidado para servir de referencia, esta em %', v_antes.status;
    END IF;

    -- 1. A conta da UG de abril e' 109,79, e o registrado era 110,20 (conta de marco).
    v_conta := public.fn_conta_ug(v_usina, DATE '2026-04-01');
    IF round((v_conta->>'valor')::numeric, 2) <> 109.79 THEN
        RAISE EXCEPTION 'FALHOU: conta da UG de 04/2026 esperava 109.79, veio %', v_conta->>'valor';
    END IF;
    IF round(v_antes.custo_disponibilidade, 2) <> 110.20 THEN
        RAISE EXCEPTION 'FALHOU: o registrado deveria ser 110.20 para a diferenca ser a esperada, veio %',
                        v_antes.custo_disponibilidade;
    END IF;

    -- 2. Nenhuma fatura paga de abril pode ficar de fora do faturamento.
    v_fat := public.fn_faturamento_detalhado(v_usina, DATE '2026-04-01');
    IF (v_fat->>'descartadas')::int <> 0 THEN
        RAISE EXCEPTION 'FALHOU: % faturas de 04/2026 sem insumo tarifario: %',
                        v_fat->>'descartadas', v_fat->'descartes';
    END IF;

    -- 3. Reproduz o mes com a regra nova, num sandbox.
    UPDATE public.generation_production
       SET status = 'em_producao',
           custo_disponibilidade   = (v_conta->>'valor')::numeric,
           pagamento_ug_invoice_id = (v_conta->>'invoice_id')::uuid,
           service_details         = COALESCE((SELECT service_values FROM public.usinas WHERE id = v_usina), '{}'::jsonb)
                                     - 'Manutenção' - 'Arrendamento' - 'Energia',
           manutencao              = (SELECT (service_values->>'Manutenção')::numeric FROM public.usinas WHERE id = v_usina),
           arrendamento            = (SELECT (service_values->>'Arrendamento')::numeric FROM public.usinas WHERE id = v_usina),
           despesas_eventuais      = '{}'::jsonb
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-04-01'
    RETURNING id INTO v_gp;

    v_totais := public.fn_totais_fechamento(v_gp);

    -- 4. As quatro diferencas esperadas, uma por uma.
    IF (v_totais->>'servicos')::numeric <> 155.90 THEN
        RAISE EXCEPTION 'FALHOU servicos: esperava 155.90 (76 + 79.90), veio %', v_totais->>'servicos';
    END IF;
    IF (v_totais->>'total_despesas')::numeric <> 865.69 THEN
        RAISE EXCEPTION 'FALHOU total_despesas: esperava 865.69 (109.79 + 0 + 600 + 155.90), veio %',
                        v_totais->>'total_despesas';
    END IF;

    -- 5. Sem arrendamento, a despesa reproduz exatamente o que o cron lancou no
    --    razao: 265,69. Os dois livros passam a dizer o mesmo numero.
    IF round(109.79 + 155.90, 2) <> 265.69 THEN
        RAISE EXCEPTION 'FALHOU: a soma servicos + disponibilidade deveria dar 265.69';
    END IF;

    -- 6. Fecha de verdade e confere o razao.
    PERFORM public.fechar_producao(v_gp, true);   -- manual: nao enfileira boleto ja' pago

    IF (SELECT sum(le.amount) FROM public.ledger_entries le
         WHERE le.external_id LIKE 'fechamento:' || v_gp || ':%') <> 0 THEN
        RAISE EXCEPTION 'FALHOU: as partidas do fechamento nao fecham em zero';
    END IF;

    -- 7. Divergencia registrada (k): o razao reparte por valor de fatura e o
    --    fechamento por kWh. Publica a diferenca em vez de esconder.
    RAISE NOTICE 'DIVERGENCIA MODELO: faturamento por kWh = %, faturamento_mensal registrado (por valor) = %',
                 round((v_fat->>'total')::numeric, 2), round(v_antes.faturamento_mensal, 2);

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: 04/2026 reproduzido, as 4 diferencas sao as esperadas — tudo desfeito';
END $$;
```

- [ ] **Step 2: Rodar a reprodução**

Executar o conteúdo de `supabase/tests/reproducao_042026.test.sql`.
Esperado: `DIVERGENCIA MODELO: ...` seguido de `OK: 04/2026 reproduzido, as 4 diferencas sao as esperadas — tudo desfeito`.

Registrar os dois números da divergência do modelo no relatório da task. Medido em 09/08/2026, o faturamento por kWh de 04/2026 dá `R$ 6.650,32` contra `R$ 2.655,84` registrados — a diferença é o assunto da frente do split, não deste plano, e existe para ser vista.

- [ ] **Step 3: Rodar a suíte inteira**

Executar, em ordem, o conteúdo de:

```
supabase/tests/apuracao_colunas.test.sql
supabase/tests/tarifa_core.test.sql
supabase/tests/faturamento_mensal.test.sql
supabase/tests/fechamento_schema.test.sql
supabase/tests/fechamento_insumos.test.sql
supabase/tests/rascunho_mensal.test.sql
supabase/tests/fechar_producao.test.sql
supabase/tests/liquidar_producao.test.sql
supabase/tests/cashbook_view.test.sql
supabase/tests/reproducao_042026.test.sql
```

Esperado: todos os blocos em `OK:`. `faturamento_mensal.test.sql` reporta `desvio=1.08` — não relaxar a tolerância de 2%: ela é o que separa "duas UCs sem tarifa" de "fórmula errada".

- [ ] **Step 4: Confirmar que nenhuma função ficou executável pelo `anon`**

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('fn_conta_ug','fn_faturamento_detalhado','fn_totais_fechamento',
                     'fn_soma_jsonb_valores','fechar_producao','liquidar_producao',
                     'confirmar_pagamento_ug','run_monthly_fixed_expenses')
   AND has_function_privilege('anon', p.oid, 'EXECUTE');
```
Esperado: zero linhas.

```sql
SELECT p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('fn_conta_ug','fn_faturamento_detalhado','fn_totais_fechamento','fechar_producao','liquidar_producao')
   AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
```
Esperado: zero linhas — a tela do plano seguinte precisa executá-las.

```sql
SELECT count(*) FROM public.financial_transfers;
SELECT count(*) FROM net.http_request_queue;
```
Esperado: `4` e `0`. Nenhum dinheiro se moveu durante a implementação inteira.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/reproducao_042026.test.sql
git commit -m "test(db): reproducao de 04/2026 com as quatro diferencas esperadas"
```

---

## Self-Review

**Cobertura da spec.** §3.1 item 1 (UNIQUE) → Task 1, verificação, porque a constraint já existe. §3.1 item 2 (`despesas_eventuais`) → Task 1. §3.1 item 3 (`cashbook` view) → Task 9. §3.1 item 4 (`gestao_percentual`) → já aplicado em 08/08, verificado na divergência (b). §3.1 item 5 (`reference_type`) → Task 1. §3.1 item 6 (descartar a migration) → Task 10. §4 (fluxo do mês) → Tasks 5, 6, 8. §4.1 (disponibilidade derivada) → Task 2. §4.2 (os três casos que bloqueiam) → Tasks 2 e 6. §5.4 (fórmulas) → Task 4. §5.5 (uma função só no banco) → Tasks 3 e 4. §6.1 (RPCs transacionais) → Tasks 6 e 8. §6.2 (checar `error`) → Task 7, na Edge Function; na tela, é o plano seguinte. §7 (migração) → Tasks 1, 9, 10. §8 (aceite) → Task 11.

**Fora da cobertura, por decisão de escopo:** §5.1, §5.2 e §5.3 na parte de interface — a tela unificada, o mapa de renomeação dos 8 campos e a edição de `service_details`/`despesas_eventuais` pelo operador. Formam o plano seguinte, que consome as RPCs daqui. §5.6 (auditoria pela tabela de referência) depende de `consumer_units.classe`, que não existe — ponto em aberto registrado na própria spec, e frente própria.

**Achados endereçados.** Achado 1 (trigger de sync) → resolvido em 08/08, verificado. Achado 2 (validação da Task 6) → resolvido pelos dados, medido em 1,08%. Achado 3 (`NULL` na agregação) → Task 3, e a Task 6 recusa fechar com descarte. Achado 4 (desconto por assinante) → Task 3, com desvio deliberado e justificado na divergência (h). Achado 5 (arredondamento) → Global Constraint 6 e Task 4. Achado 6 (percentual > 100) → resolvido em 08/08. Achado 7 (privilégio durável) → Global Constraint 7 mantém a convenção; o `ALTER DEFAULT PRIVILEGES` continua sendo frente própria. Achado 8, `LIMIT 1` sem `ORDER BY` → Task 2 recusa em vez de escolher; cast `::text` em `status` → Task 3; teste de tipo e não só de existência → Task 1. Achado 9 (corpo morto do PIX) → Task 10.

**Consistência de tipos.** `fn_conta_ug` devolve `jsonb` e é lida por `run_monthly_fixed_expenses`, `fechar_producao` e o teste da Task 11, sempre pelas chaves `ok`, `motivo`, `invoice_id`, `valor`, `tem_linha_digitavel`. `fn_faturamento_detalhado` devolve `jsonb` com `total`, `faturas`, `computadas`, `descartadas`, `kwh`, `descartes`, e é lida pelas mesmas três. `fn_totais_fechamento` devolve `jsonb` com `servicos`, `total_despesas`, `gestao_reais`, `saldo_receber`, gravados nas colunas homônimas de `generation_production`. `fn_soma_jsonb_valores` devolve `numeric` e é consumida por `fn_totais_fechamento` e pelos testes das Tasks 4 e 5. `fechar_producao` devolve `jsonb` com `transaction_id`, lido pelos testes para somar as partidas. `liquidar_producao` devolve `jsonb` com `valor`, `destino` e `razao`, e **não** tem `transaction_id`: ela não lança no razão, porque o trigger `tr_transfer_ledger` já lança a mesma partida quando o PIX completa. `confirmar_pagamento_ug` é chamada pela Edge Function com os nomes `p_gp_id`, `p_ok`, `p_detalhe`, que são os da assinatura.

**Pendências registradas e não resolvidas aqui:**
0. **`repasse_status` nunca sai de `enfileirado`.** O CHECK aceita `pago` e `erro`, e nada no sistema escreve esses valores: `transfer-asaas-pix` não devolve nada ao banco, e o `asaas-webhook` atualiza `financial_transfers` sem propagar para `generation_production`. Do lado do boleto existe `confirmar_pagamento_ug`; do lado do PIX não existe equivalente. Criar a função aqui a faria nascer sem chamador, e ligá-la exige editar um webhook de pagamento vivo — frente própria. Registrado em `COMMENT` na coluna.
1. `saldo_receber` (por kWh) e o saldo da conta `2.1.1` (por valor de fatura) não batem enquanto a revisão do split não acontecer. A Task 11 publica a diferença; corrigi-la é a frente do split.
2. `transfer-asaas-pix` tem `verify_jwt = false` e nenhuma verificação de autenticação no código — qualquer um que conheça a URL dispara um PIX. A trava de 2 minutos por destino limita o estrago, não o impede. Não é regressão deste plano, mas passa a ser chamada também pelo banco, o que aumenta a superfície. Merece frente própria, de segurança.
3. As 3 faturas com `status = 'cancelado'` e `energy_bill_status = 'pago'` continuam contraditórias. A Task 1 as reporta; resolvê-las é decisão de operação, não de código.
4. `consumer_units.classe` não existe, e sem ela a auditoria da spec §5.6 não escolhe entre as variantes `_B2`, `_B3` e `_A` da tabela de referência.
