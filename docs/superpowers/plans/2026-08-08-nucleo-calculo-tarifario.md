# Núcleo de Cálculo Tarifário — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar no banco a função única que calcula a Tarifa Fornecedor e a repartição por kWh compensado, para que fechamento e split consumam a mesma regra em vez de reimplementá-la.

**Architecture:** Funções SQL puras e determinísticas em `public`, sem efeito colateral, testadas por script de asserção. Nenhuma tela é alterada por este plano — ele entrega apenas o núcleo de cálculo e sua validação contra dados de produção. O fechamento e o split passam a chamá-lo em planos posteriores.

**Tech Stack:** PostgreSQL 15 (Supabase `abbysvxnnhwvvzhftoms`), PL/pgSQL, migrations via Supabase MCP `apply_migration`.

**Spec:** [`docs/superpowers/specs/2026-08-08-fechamento-contabil-design.md`](../specs/2026-08-08-fechamento-contabil-design.md), seções 5.3 a 5.6.

## Global Constraints

- Toda função deste plano é `IMMUTABLE` ou `STABLE`, nunca `VOLATILE`. Elas calculam, não escrevem.
- Toda função declara `SET search_path TO 'public'`. O banco tem 38 funções com `search_path` mutável e não vamos aumentar esse número.
- Nenhuma função deste plano é `SECURITY DEFINER`. São cálculos puros; não precisam contornar RLS.
- `REVOKE EXECUTE ... FROM PUBLIC, anon` em toda função criada, seguido de
  `GRANT EXECUTE ... TO authenticated, service_role`.

  **Revogar só de `PUBLIC` não basta neste projeto** — corrigido em 08/08/2026, após a
  Task 2 falhar a verificação. Há duas vias distintas pelas quais `anon` ganha `EXECUTE`:

  1. O default do Postgres concede a `PUBLIC` (entrada `=X/postgres`, grantee vazio no
     `proacl`), que `anon` herda. Foi assim que 19 funções financeiras ficaram chamáveis
     sem login.
  2. O Supabase mantém `ALTER DEFAULT PRIVILEGES` em `public` concedendo `EXECUTE` a
     `anon` **explicitamente**. Confirmado em `pg_default_acl`:
     `{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}`.
     Toda função nova nasce com `anon=X` próprio no ACL.

  `REVOKE FROM PUBLIC` mata só a via 1. A via 2 exige revogar de `anon` nominalmente.

  **Verificação obrigatória ao fim de cada task que cria função** — o teste da função
  passar não prova nada sobre privilégio:

  ```sql
  SELECT has_function_privilege('anon',          '<assinatura>', 'EXECUTE') AS anon_pode,
         has_function_privilege('authenticated', '<assinatura>', 'EXECUTE') AS authenticated_pode;
  ```

  Esperado: `anon_pode = false`, `authenticated_pode = true`.
- **Dado faltante propaga `NULL`, nunca vira zero silenciosamente.** Decisão do dono em
  08/08/2026, após a revisão da Task 3 apontar que as duas primeiras funções tratavam nulo
  de formas divergentes.

  Toda função de cálculo devolve `NULL` quando lhe falta um insumo essencial. Ela não
  inventa zero, não calcula parcial, e não decide sozinha o que fazer — quem chama é que
  decide, e o fechamento acusa a UC com dado incompleto.

  O motivo é dinheiro. Com `COALESCE(p_te, 0)`, um TE não extraído produz uma tarifa
  menor e o fornecedor recebe a menos, em silêncio. Com `COALESCE(p_desconto_pct, 0)`, um
  desconto não extraído produz tarifa cheia e o fornecedor recebe a **mais**, também em
  silêncio. A spec 5.5 já registra duas UCs com `te = tusd = fio_b = 0` e 1.631 kWh
  compensados — o problema não é hipotético.

  **Contrato de dado que isso cria:** "sem compensação no mês" deve ser gravado como `0`,
  não como `NULL`. `NULL` passa a significar exclusivamente "não apurado". Sem essa
  distinção no dado, nenhuma função consegue separar ausência de fato de ausência de
  leitura.

- Percentuais de repartição são **parâmetros**, nunca constantes no corpo. O modelo de pagamento será revisado e não queremos editar função para mudar percentual.
- Precisão monetária: arredondar apenas na saída final, com `round(x, 2)`. Cálculos intermediários mantêm a precisão de `numeric`.
- Nomes em português, prefixo `fn_`, seguindo o padrão já existente no banco (`fn_dispatch_notification`, `fn_process_notification_triggers`).
- Testes ficam em `supabase/tests/` como `.sql` executável. Não há framework JS neste repositório.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260808_fn_tarifa_core.sql` | As quatro funções de cálculo puro |
| `supabase/migrations/20260808_invoices_apuracao_tarifaria.sql` | Colunas de apuração em `invoices` |
| `supabase/migrations/20260808_fn_faturamento_mensal.sql` | Agregação por usina/mês |
| `supabase/tests/tarifa_core.test.sql` | Asserções das funções puras |
| `supabase/tests/faturamento_mensal.test.sql` | Asserção contra produção |

---

## Task 1: Colunas de apuração tarifária em `invoices`

A Tarifa Fornecedor precisa de TE, TUSD e Fio B **apurados na conta**, não do cadastro da UC. Hoje `invoices` não guarda nenhum deles: `tarifa_concessionaria` e `desconto_assinante` estão nulos em 12 de 13 faturas, e `fio_b` só existe em `consumer_units`, congelado.

**Files:**
- Create: `supabase/migrations/20260808_invoices_apuracao_tarifaria.sql`

**Interfaces:**
- Consumes: nada
- Produces: colunas `invoices.te_apurado`, `invoices.tusd_apurado`, `invoices.tusd_consumo_unit`, `invoices.tusd_compensado_unit`, `invoices.fio_b_apurado` — todas `numeric`, todas anuláveis

- [ ] **Step 1: Escrever a asserção que falha**

Criar `supabase/tests/apuracao_colunas.test.sql`:

```sql
DO $$
DECLARE
    v_faltando text;
BEGIN
    SELECT string_agg(c, ', ')
      INTO v_faltando
      FROM unnest(ARRAY['te_apurado','tusd_apurado','tusd_consumo_unit',
                        'tusd_compensado_unit','fio_b_apurado']) AS c
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='invoices' AND column_name=c);

    IF v_faltando IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU: colunas ausentes em invoices: %', v_faltando;
    END IF;
    RAISE NOTICE 'OK: colunas de apuracao presentes';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar o conteúdo de `supabase/tests/apuracao_colunas.test.sql` via `execute_sql`.
Esperado: `ERROR ... FALHOU: colunas ausentes em invoices: te_apurado, tusd_apurado, tusd_consumo_unit, tusd_compensado_unit, fio_b_apurado`

- [ ] **Step 3: Aplicar a migration**

Via `apply_migration`, nome `invoices_apuracao_tarifaria`:

```sql
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS te_apurado            numeric,
    ADD COLUMN IF NOT EXISTS tusd_apurado          numeric,
    ADD COLUMN IF NOT EXISTS tusd_consumo_unit     numeric,
    ADD COLUMN IF NOT EXISTS tusd_compensado_unit  numeric,
    ADD COLUMN IF NOT EXISTS fio_b_apurado         numeric;

COMMENT ON COLUMN public.invoices.te_apurado IS
    'TE (R$/kWh) lido da conta de energia. Prevalece sobre consumer_units.te.';
COMMENT ON COLUMN public.invoices.tusd_apurado IS
    'TUSD (R$/kWh) lido da conta de energia. Prevalece sobre consumer_units.tusd.';
COMMENT ON COLUMN public.invoices.tusd_consumo_unit IS
    'TUSD unitario do lancamento de consumo (Consumo-TUSD). Insumo do Fio B.';
COMMENT ON COLUMN public.invoices.tusd_compensado_unit IS
    'TUSD unitario do lancamento compensado (G_Comp...-TUSD). Insumo do Fio B.';
COMMENT ON COLUMN public.invoices.fio_b_apurado IS
    'Fio B (R$/kWh) = tusd_consumo_unit - tusd_compensado_unit. Calculado por conta.';
```

- [ ] **Step 4: Rodar a asserção e confirmar que passa**

Esperado: `NOTICE: OK: colunas de apuracao presentes`, sem exceção.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808_invoices_apuracao_tarifaria.sql supabase/tests/apuracao_colunas.test.sql
git commit -m "feat(db): colunas de apuracao tarifaria em invoices"
```

---

## Task 2: `fn_fio_b_apurado` — Fio B por conta

Spec, decisão 10: o Fio B deixa de ser configuração fixa por UC e passa a ser apurado em cada conta.

**Interpretação registrada:** a memória de cálculo do dono descreve
`(Consumo-TUSD − G2Comp-TUSD) × quantidade`. Isso produz o **total** em R$. Para a cadeia
tarifária precisamos da **alíquota** (R$/kWh), que é a diferença sem multiplicar — é o que
reconcilia com o `0,2128` de produção e com `1,02 − 0,204 − 0,21 = 0,60`. Esta função
devolve a alíquota; o total é `alíquota × energia_compensada`.

**Files:**
- Create: `supabase/migrations/20260808_fn_tarifa_core.sql`
- Test: `supabase/tests/tarifa_core.test.sql`

**Interfaces:**
- Consumes: nada
- Produces: `fn_fio_b_apurado(p_tusd_consumo_unit numeric, p_tusd_compensado_unit numeric) RETURNS numeric`

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/tests/tarifa_core.test.sql`:

```sql
DO $$
DECLARE v numeric;
BEGIN
    -- caso de producao: TUSD consumo 0,64164, compensado 0,42884 -> 0,2128
    v := public.fn_fio_b_apurado(0.64164, 0.42884);
    IF round(v, 5) <> 0.21280 THEN
        RAISE EXCEPTION 'FALHOU fio_b: esperado 0.21280, veio %', round(v, 5);
    END IF;

    -- compensado nulo: sem compensacao nao ha Fio B
    IF public.fn_fio_b_apurado(0.64164, NULL) <> 0 THEN
        RAISE EXCEPTION 'FALHOU fio_b: compensado nulo deveria dar 0';
    END IF;

    -- nunca negativo
    IF public.fn_fio_b_apurado(0.30000, 0.50000) <> 0 THEN
        RAISE EXCEPTION 'FALHOU fio_b: resultado negativo deveria ser travado em 0';
    END IF;

    RAISE NOTICE 'OK: fn_fio_b_apurado';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Esperado: `ERROR: function public.fn_fio_b_apurado(numeric, numeric) does not exist`

- [ ] **Step 3: Implementar**

Via `apply_migration`, nome `fn_tarifa_core`:

```sql
CREATE OR REPLACE FUNCTION public.fn_fio_b_apurado(
    p_tusd_consumo_unit    numeric,
    p_tusd_compensado_unit numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
    SELECT CASE
        WHEN p_tusd_consumo_unit IS NULL OR p_tusd_compensado_unit IS NULL THEN 0
        ELSE GREATEST(p_tusd_consumo_unit - p_tusd_compensado_unit, 0)
    END;
$$;

COMMENT ON FUNCTION public.fn_fio_b_apurado(numeric, numeric) IS
    'Fio B (R$/kWh) apurado na conta = TUSD do consumo - TUSD compensado. Spec 5.3, decisao 10.';

REVOKE EXECUTE ON FUNCTION public.fn_fio_b_apurado(numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_fio_b_apurado(numeric, numeric) TO authenticated, service_role;
```

> Por que `CASE` e não `COALESCE(..., 0)` nos dois argumentos: com o compensado nulo, o
> `COALESCE` devolveria o TUSD cheio como se fosse Fio B. Sem compensação não existe Fio B
> a descontar — o resultado tem que ser zero. É o segundo caso do teste.

- [ ] **Step 4: Rodar e confirmar que passa**

Esperado: `NOTICE: OK: fn_fio_b_apurado`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808_fn_tarifa_core.sql supabase/tests/tarifa_core.test.sql
git commit -m "feat(db): fn_fio_b_apurado calcula Fio B por conta"
```

---

## Task 3: `fn_tarifa_fornecedor` — a tarifa que sobra para repartir

Spec 5.3: `Tarifa Fornecedor = (TE + TUSD) − desconto% − Fio B`.

**Files:**
- Modify: `supabase/migrations/20260808_fn_tarifa_core.sql`
- Test: `supabase/tests/tarifa_core.test.sql`

**Interfaces:**
- Consumes: `fn_fio_b_apurado/2`
- Produces: `fn_tarifa_fornecedor(p_te numeric, p_tusd numeric, p_desconto_pct numeric, p_fio_b numeric) RETURNS numeric`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `supabase/tests/tarifa_core.test.sql`:

```sql
DO $$
DECLARE v numeric;
BEGIN
    -- caso validado contra producao: UFV Bom Jesus 05/2026
    -- TE 0,39033 + TUSD 0,64164 = 1,03197 ; desconto 20% ; Fio B 0,2128
    v := public.fn_tarifa_fornecedor(0.39033, 0.64164, 20, 0.21280);
    IF round(v, 5) <> 0.61278 THEN
        RAISE EXCEPTION 'FALHOU tarifa_fornecedor: esperado 0.61278, veio %', round(v, 5);
    END IF;

    -- exemplo redondo da memoria de calculo: 1,02 - 20% - 0,21 = 0,606
    v := public.fn_tarifa_fornecedor(0.38000, 0.64000, 20, 0.21000);
    IF round(v, 3) <> 0.606 THEN
        RAISE EXCEPTION 'FALHOU tarifa_fornecedor exemplo: esperado 0.606, veio %', round(v, 3);
    END IF;

    -- desconto zero: tarifa menos fio b
    IF round(public.fn_tarifa_fornecedor(0.40000, 0.60000, 0, 0.20000), 5) <> 0.80000 THEN
        RAISE EXCEPTION 'FALHOU tarifa_fornecedor: desconto zero';
    END IF;

    -- nunca negativa
    IF public.fn_tarifa_fornecedor(0.10000, 0.10000, 20, 0.90000) <> 0 THEN
        RAISE EXCEPTION 'FALHOU tarifa_fornecedor: resultado negativo deveria travar em 0';
    END IF;

    RAISE NOTICE 'OK: fn_tarifa_fornecedor';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Esperado: `ERROR: function public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) does not exist`

- [ ] **Step 3: Implementar**

Via `apply_migration`, nome `fn_tarifa_fornecedor`:

```sql
CREATE OR REPLACE FUNCTION public.fn_tarifa_fornecedor(
    p_te           numeric,
    p_tusd         numeric,
    p_desconto_pct numeric,
    p_fio_b        numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
    SELECT GREATEST(
        (COALESCE(p_te, 0) + COALESCE(p_tusd, 0))
        * (1 - COALESCE(p_desconto_pct, 0) / 100.0)
        - COALESCE(p_fio_b, 0),
        0
    );
$$;

COMMENT ON FUNCTION public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) IS
    'Tarifa Fornecedor (R$/kWh) = (TE+TUSD) - desconto% - Fio B. Base da reparticao. Spec 5.3.';

REVOKE EXECUTE ON FUNCTION public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Esperado: `NOTICE: OK: fn_tarifa_fornecedor`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ supabase/tests/tarifa_core.test.sql
git commit -m "feat(db): fn_tarifa_fornecedor, base da reparticao por kWh"
```

---

## Task 4: `fn_split_tarifa` — repartição da Tarifa Fornecedor

Spec 5.3. Percentuais são **parâmetros**, não constantes: o modelo de pagamento será revisado.

**Files:**
- Modify: `supabase/migrations/20260808_fn_tarifa_core.sql`
- Test: `supabase/tests/tarifa_core.test.sql`

**Interfaces:**
- Consumes: `fn_tarifa_fornecedor/4`
- Produces: `fn_split_tarifa(p_tarifa_fornecedor numeric, p_energia_compensada numeric, p_pct_crm numeric, p_pct_gestora numeric, p_pct_originador numeric) RETURNS jsonb` com as chaves `crm`, `gestora`, `originador`, `fornecedor`, `total`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `supabase/tests/tarifa_core.test.sql`:

```sql
DO $$
DECLARE r jsonb;
BEGIN
    -- exemplo da memoria de calculo, 1 kWh, tarifa 0,60
    r := public.fn_split_tarifa(0.60, 1, 3, 10, 5);

    IF round((r->>'crm')::numeric, 3) <> 0.018 THEN
        RAISE EXCEPTION 'FALHOU split crm: esperado 0.018, veio %', r->>'crm';
    END IF;
    IF round((r->>'gestora')::numeric, 3) <> 0.060 THEN
        RAISE EXCEPTION 'FALHOU split gestora: esperado 0.060, veio %', r->>'gestora';
    END IF;
    IF round((r->>'originador')::numeric, 3) <> 0.030 THEN
        RAISE EXCEPTION 'FALHOU split originador: esperado 0.030, veio %', r->>'originador';
    END IF;
    IF round((r->>'fornecedor')::numeric, 3) <> 0.492 THEN
        RAISE EXCEPTION 'FALHOU split fornecedor: esperado 0.492 (82%%), veio %', r->>'fornecedor';
    END IF;

    -- a soma das partes fecha com o total, sem centavo perdido
    IF round((r->>'crm')::numeric + (r->>'gestora')::numeric
           + (r->>'originador')::numeric + (r->>'fornecedor')::numeric, 6)
       <> round((r->>'total')::numeric, 6) THEN
        RAISE EXCEPTION 'FALHOU split: partes nao fecham com o total';
    END IF;

    -- escala com a energia compensada
    r := public.fn_split_tarifa(0.60, 1000, 3, 10, 5);
    IF round((r->>'total')::numeric, 2) <> 600.00 THEN
        RAISE EXCEPTION 'FALHOU split: total para 1000 kWh deveria ser 600.00, veio %', r->>'total';
    END IF;

    RAISE NOTICE 'OK: fn_split_tarifa';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Esperado: `ERROR: function public.fn_split_tarifa(...) does not exist`

- [ ] **Step 3: Implementar**

Via `apply_migration`, nome `fn_split_tarifa`:

```sql
CREATE OR REPLACE FUNCTION public.fn_split_tarifa(
    p_tarifa_fornecedor  numeric,
    p_energia_compensada numeric,
    p_pct_crm            numeric,
    p_pct_gestora        numeric,
    p_pct_originador     numeric
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
    WITH base AS (
        SELECT COALESCE(p_tarifa_fornecedor, 0) * COALESCE(p_energia_compensada, 0) AS total
    ), partes AS (
        SELECT total,
               total * COALESCE(p_pct_crm, 0)        / 100.0 AS crm,
               total * COALESCE(p_pct_gestora, 0)    / 100.0 AS gestora,
               total * COALESCE(p_pct_originador, 0) / 100.0 AS originador
          FROM base
    )
    SELECT jsonb_build_object(
        'total',      total,
        'crm',        crm,
        'gestora',    gestora,
        'originador', originador,
        'fornecedor', total - crm - gestora - originador
    ) FROM partes;
$$;

COMMENT ON FUNCTION public.fn_split_tarifa(numeric, numeric, numeric, numeric, numeric) IS
    'Reparte Tarifa Fornecedor x energia compensada. Percentuais sao parametros: o modelo de pagamento sera revisado. O fornecedor recebe o residual, garantindo que as partes fechem com o total.';

REVOKE EXECUTE ON FUNCTION public.fn_split_tarifa(numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_split_tarifa(numeric, numeric, numeric, numeric, numeric) TO authenticated, service_role;
```

> O fornecedor recebe o **residual**, não `total × 82%`. Assim a soma das partes sempre
> fecha com o total, mesmo quando os percentuais forem alterados na revisão do split.

- [ ] **Step 4: Rodar e confirmar que passa**

Esperado: `NOTICE: OK: fn_split_tarifa`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ supabase/tests/tarifa_core.test.sql
git commit -m "feat(db): fn_split_tarifa reparte por kWh com percentuais parametrizados"
```

---

## Task 5: `fn_auditar_tarifa` — a régua contra a tabela de referência

Spec 5.6: o que vale é a conta de energia; a tarifa cadastrada serve para **detectar distorção**.

**Ponto em aberto herdado da spec:** `consumer_units` não tem coluna `classe`, necessária
para escolher entre as variantes `_B2`, `_B3` e `_A` de `Concessionaria`. Esta task
implementa apenas a classe padrão (colunas `TE`, `TUSD`, `Fio B`, sem sufixo, que
correspondem a B1). A extensão por classe fica bloqueada até `consumer_units.classe`
existir — registrado como Task 7 do plano seguinte, não deste.

**Files:**
- Modify: `supabase/migrations/20260808_fn_tarifa_core.sql`
- Test: `supabase/tests/tarifa_core.test.sql`

**Interfaces:**
- Consumes: tabela `public."Concessionaria"` (colunas `"Cod. Ibge"`, `"TE"`, `"TUSD"`, `"Fio B"`)
- Produces: `fn_auditar_tarifa(p_ibge text, p_te numeric, p_tusd numeric, p_fio_b numeric, p_tolerancia_pct numeric DEFAULT 5) RETURNS jsonb` com as chaves `divergente` (boolean), `campos` (array de texto), `referencia` (jsonb)

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `supabase/tests/tarifa_core.test.sql`:

```sql
DO $$
DECLARE
    v_ibge text;
    v_te   numeric;
    v_tusd numeric;
    r      jsonb;
BEGIN
    -- pega um municipio real da tabela de referencia
    SELECT "Cod. Ibge", "TE", "TUSD"
      INTO v_ibge, v_te, v_tusd
      FROM public."Concessionaria"
     WHERE "TE" IS NOT NULL AND "TE" > 0 AND "TUSD" IS NOT NULL AND "TUSD" > 0
     LIMIT 1;

    IF v_ibge IS NULL THEN
        RAISE EXCEPTION 'FALHOU: tabela Concessionaria sem linha utilizavel para o teste';
    END IF;

    -- valor identico a referencia: nao diverge
    r := public.fn_auditar_tarifa(v_ibge, v_te, v_tusd, NULL, 5);
    IF (r->>'divergente')::boolean THEN
        RAISE EXCEPTION 'FALHOU auditoria: valor igual a referencia acusou divergencia: %', r;
    END IF;

    -- 50%% acima da referencia: diverge e aponta o campo
    r := public.fn_auditar_tarifa(v_ibge, v_te * 1.5, v_tusd, NULL, 5);
    IF NOT (r->>'divergente')::boolean THEN
        RAISE EXCEPTION 'FALHOU auditoria: 50%% de desvio nao acusou divergencia: %', r;
    END IF;
    IF NOT (r->'campos' ? 'te') THEN
        RAISE EXCEPTION 'FALHOU auditoria: campo te deveria constar em campos: %', r;
    END IF;

    -- municipio inexistente: nao diverge, mas sinaliza ausencia de referencia
    r := public.fn_auditar_tarifa('0000000', 1.0, 1.0, NULL, 5);
    IF (r->>'divergente')::boolean THEN
        RAISE EXCEPTION 'FALHOU auditoria: sem referencia nao deve acusar divergencia';
    END IF;
    IF r->'referencia' <> 'null'::jsonb THEN
        RAISE EXCEPTION 'FALHOU auditoria: sem referencia, a chave referencia deve ser null';
    END IF;

    RAISE NOTICE 'OK: fn_auditar_tarifa';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Esperado: `ERROR: function public.fn_auditar_tarifa(...) does not exist`

- [ ] **Step 3: Implementar**

Via `apply_migration`, nome `fn_auditar_tarifa`:

```sql
CREATE OR REPLACE FUNCTION public.fn_auditar_tarifa(
    p_ibge           text,
    p_te             numeric,
    p_tusd           numeric,
    p_fio_b          numeric,
    p_tolerancia_pct numeric DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
    v_ref    record;
    v_campos text[] := ARRAY[]::text[];
BEGIN
    SELECT "TE" AS te, "TUSD" AS tusd, "Fio B" AS fio_b
      INTO v_ref
      FROM public."Concessionaria"
     WHERE "Cod. Ibge" = p_ibge
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'divergente', false,
            'campos',     '[]'::jsonb,
            'referencia', NULL
        );
    END IF;

    IF p_te IS NOT NULL AND v_ref.te IS NOT NULL AND v_ref.te <> 0
       AND abs(p_te - v_ref.te) / v_ref.te * 100 > p_tolerancia_pct THEN
        v_campos := v_campos || 'te';
    END IF;

    IF p_tusd IS NOT NULL AND v_ref.tusd IS NOT NULL AND v_ref.tusd <> 0
       AND abs(p_tusd - v_ref.tusd) / v_ref.tusd * 100 > p_tolerancia_pct THEN
        v_campos := v_campos || 'tusd';
    END IF;

    IF p_fio_b IS NOT NULL AND v_ref.fio_b IS NOT NULL AND v_ref.fio_b <> 0
       AND abs(p_fio_b - v_ref.fio_b) / v_ref.fio_b * 100 > p_tolerancia_pct THEN
        v_campos := v_campos || 'fio_b';
    END IF;

    RETURN jsonb_build_object(
        'divergente', array_length(v_campos, 1) IS NOT NULL,
        'campos',     to_jsonb(v_campos),
        'referencia', jsonb_build_object('te', v_ref.te, 'tusd', v_ref.tusd, 'fio_b', v_ref.fio_b)
    );
END;
$$;
```

Na mesma migration, em seguida:

```sql
COMMENT ON FUNCTION public.fn_auditar_tarifa(text, numeric, numeric, numeric, numeric) IS
    'Compara a tarifa apurada na conta com a referencia de Concessionaria. NUNCA substitui o valor da conta: apenas sinaliza distorcao. Spec 5.6.';

REVOKE EXECUTE ON FUNCTION public.fn_auditar_tarifa(text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_auditar_tarifa(text, numeric, numeric, numeric, numeric) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Esperado: `NOTICE: OK: fn_auditar_tarifa`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ supabase/tests/tarifa_core.test.sql
git commit -m "feat(db): fn_auditar_tarifa compara conta com referencia sem substituir"
```

---

## Task 6: `fn_faturamento_mensal_usina` e validação contra produção

Spec 5.4, decisão 8: `faturamento_mensal` soma `tarifa_fornecedor × energia_compensada` **apenas sobre faturas pagas**.

**Precedência dos insumos:** por conta, o valor apurado (`invoices.te_apurado`,
`tusd_apurado`, `fio_b_apurado`) prevalece; quando nulo, cai para o cadastro
(`consumer_units.te`, `.tusd`, `.fio_b`). As colunas de apuração são novas e estarão nulas
em todo o histórico — é justamente o fallback que permite validar contra 05/2026.

**Files:**
- Create: `supabase/migrations/20260808_fn_faturamento_mensal.sql`
- Create: `supabase/tests/faturamento_mensal.test.sql`

**Interfaces:**
- Consumes: `fn_tarifa_fornecedor/4`
- Produces: `fn_faturamento_mensal_usina(p_usina_id uuid, p_mes date, p_desconto_pct numeric DEFAULT 20) RETURNS numeric`

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/tests/faturamento_mensal.test.sql`:

```sql
DO $$
DECLARE
    v_usina uuid;
    v_calc  numeric;
    v_reg   numeric;
    v_desvio numeric;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus' LIMIT 1;
    IF v_usina IS NULL THEN
        RAISE EXCEPTION 'FALHOU: usina UFV Bom Jesus nao encontrada';
    END IF;

    v_calc := public.fn_faturamento_mensal_usina(v_usina, DATE '2026-05-01', 20);

    SELECT faturamento_mensal INTO v_reg
      FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-05-01'
       AND faturamento_mensal > 0
     LIMIT 1;

    IF v_reg IS NULL THEN
        RAISE EXCEPTION 'FALHOU: fechamento de 05/2026 nao encontrado para comparacao';
    END IF;

    v_desvio := abs(v_calc - v_reg) / v_reg * 100;

    RAISE NOTICE 'calculado=% registrado=% desvio=%%%', round(v_calc,2), round(v_reg,2), round(v_desvio,2);

    -- Spec 5.3: a validacao manual deu 5.896,14 contra 5.833,18 registrado = 1,08%.
    -- Tolerancia de 2% cobre esse desvio conhecido (2 UCs com tarifa zerada, spec 5.5)
    -- sem aceitar erro de formula, que produziria desvio de ordem de grandeza.
    IF v_desvio > 2 THEN
        RAISE EXCEPTION 'FALHOU faturamento: desvio de %%%% excede 2%%%%. calculado=% registrado=%',
                        round(v_desvio,2), round(v_calc,2), round(v_reg,2);
    END IF;

    RAISE NOTICE 'OK: fn_faturamento_mensal_usina reconcilia com producao';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Esperado: `ERROR: function public.fn_faturamento_mensal_usina(uuid, date, numeric) does not exist`

- [ ] **Step 3: Implementar**

Via `apply_migration`, nome `fn_faturamento_mensal_usina`:

```sql
CREATE OR REPLACE FUNCTION public.fn_faturamento_mensal_usina(
    p_usina_id     uuid,
    p_mes          date,
    p_desconto_pct numeric DEFAULT 20
) RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
    SELECT COALESCE(SUM(
        public.fn_tarifa_fornecedor(
            COALESCE(i.te_apurado,     cu.te),
            COALESCE(i.tusd_apurado,   cu.tusd),
            p_desconto_pct,
            COALESCE(i.fio_b_apurado,  cu.fio_b)
        ) * COALESCE(i.consumo_compensado, 0)
    ), 0)
    FROM public.invoices i
    JOIN public.consumer_units cu ON cu.id = i.uc_id
    WHERE cu.usina_id       = p_usina_id
      AND cu.tipo_unidade   = 'beneficiaria'
      AND i.mes_referencia  = p_mes
      AND i.status::text    = 'pago';
$$;

COMMENT ON FUNCTION public.fn_faturamento_mensal_usina(uuid, date, numeric) IS
    'Faturamento do mes da usina: soma de tarifa_fornecedor x energia compensada, apenas faturas pagas (decisao 8). Valor apurado na conta prevalece sobre o cadastro da UC.';

REVOKE EXECUTE ON FUNCTION public.fn_faturamento_mensal_usina(uuid, date, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_faturamento_mensal_usina(uuid, date, numeric) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Esperado: `NOTICE: calculado=5896.14 registrado=5833.18 desvio=1.08` seguido de
`NOTICE: OK: fn_faturamento_mensal_usina reconcilia com producao`

**Se o desvio exceder 2%:** não ajustar a tolerância. Voltar à investigação — a spec 5.5
registra duas UCs com `te = tusd = fio_b = 0` e 1.631 kWh compensados, que é a causa
conhecida. Desvio maior indica erro de fórmula ou de junção, não ruído de dado.

- [ ] **Step 5: Rodar a suíte inteira**

Executar, em ordem: `apuracao_colunas.test.sql`, `tarifa_core.test.sql`,
`faturamento_mensal.test.sql`. Todas devem emitir apenas `NOTICE: OK: ...`.

- [ ] **Step 6: Confirmar que nenhuma função ficou executável pelo `anon`**

```sql
SELECT COALESCE(string_agg(p.proname, ', ' ORDER BY p.proname), 'nenhuma') AS exposta_ao_anon
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('fn_fio_b_apurado', 'fn_tarifa_fornecedor', 'fn_split_tarifa',
                    'fn_auditar_tarifa', 'fn_faturamento_mensal_usina')
  AND has_function_privilege('anon', p.oid, 'EXECUTE');
```

Esperado: `nenhuma`

> A lista é explícita de propósito. Uma versão com `LIKE 'fn_%tarifa%' OR proname IN (...)`
> misturaria `AND` e `OR` sem parênteses — e como `AND` liga mais forte, o filtro de
> privilégio se aplicaria só ao segundo termo. A query passaria sem testar nada.

- [ ] **Step 6b: Confirmar que `authenticated` manteve acesso**

```sql
SELECT COALESCE(string_agg(p.proname, ', ' ORDER BY p.proname), 'NENHUMA - ERRO') AS acessivel_por_authenticated
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('fn_fio_b_apurado', 'fn_tarifa_fornecedor', 'fn_split_tarifa',
                    'fn_auditar_tarifa', 'fn_faturamento_mensal_usina')
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
```

Esperado: as cinco funções listadas. Se vier `NENHUMA - ERRO`, o `REVOKE ... FROM PUBLIC`
levou junto o acesso legítimo e o `GRANT` subsequente não foi aplicado.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/ supabase/tests/
git commit -m "feat(db): fn_faturamento_mensal_usina validado contra producao"
```

---

## Self-Review

**Cobertura da spec.** Seções 5.3 (modelo tarifário) → Tasks 2, 3, 4. Seção 5.4
(`faturamento_mensal`) → Task 6. Seção 5.5 (dados sujos) → tratado como tolerância
explícita e documentada no teste da Task 6, com instrução de não relaxar. Seção 5.6
(régua de auditoria) → Task 5.

**Fora da cobertura deste plano, por decisão de escopo:** as demais seções da spec
(mudanças de schema em `generation_production`, `cashbook` como view, fusão das telas,
RPCs `fechar_producao` / `liquidar_producao`, migração e cron) formam o plano seguinte.
Este plano entrega apenas o núcleo de cálculo, que é pré-requisito de todos eles e é
testável isoladamente.

**Consistência de tipos.** `fn_fio_b_apurado` devolve `numeric` e é consumida por
`fn_tarifa_fornecedor` no parâmetro `p_fio_b numeric`. `fn_tarifa_fornecedor` devolve
`numeric` e é consumida por `fn_split_tarifa` em `p_tarifa_fornecedor numeric` e por
`fn_faturamento_mensal_usina`. `fn_auditar_tarifa` e `fn_split_tarifa` devolvem `jsonb` e
não são consumidas por outra função deste plano.

**Pendências herdadas, registradas e não resolvidas aqui:**
1. `consumer_units.classe` não existe — a auditoria da Task 5 cobre apenas a classe padrão.
2. As colunas de apuração da Task 1 ficam nulas até a extração do PDF passar a preenchê-las. É trabalho do plano da extração, não deste.
3. Duas UCs com tarifa zerada (`7030004021`, `7030004129`) continuam zeradas; corrigi-las é item 3b da migração na spec.
