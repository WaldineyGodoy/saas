# Plano de Usina — Adendo de 10/10/2026 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o §6 da spec (decisões 12–17): cota de usina sem dono só vai à B2W se couber, Líder do originador da usina, plano de assinatura só na UC e obrigatório, trava de versão no plano de assinatura e originador copiado do lead.

**Architecture:** Quatro migrações novas no Supabase (`20261010a`–`20261010d`), aplicadas em produção pelo MCP como as anteriores; o motor do split é corrigido por substituição completa (`fn_calcular_split_recompensa`, `fn_regras_recompensa_uc`, `fn_plano_da_uc`) e por patch com âncora única sobre o corpo vivo (`fn_participantes_recompensa`, `handle_invoice_paid_ledger`), sempre atrás de trava de md5. Depois, três tarefas de tela (plano de usina, UC, plano de assinatura) e a verificação final.

**Tech Stack:** PostgreSQL/Supabase (plpgsql, RLS, gatilhos), MCP `execute_sql`/`apply_migration` no projeto `abbysvxnnhwvvzhftoms`; React 18 + Vite; vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-06-plano-usina-design.md`, **§6 (adendo de 10/10/2026)**, que substitui o que contradiz nas seções anteriores.
- Worktree `C:\Users\Godoy\Documents\HTML\WorkSpace 1 Antigravity\.claude\worktrees\plano-usina`, branch `impl/plano-usina`. Nunca `cd` para o checkout principal. **Sem push, sem merge.** Nunca `git stash` puro.
- B2W nunca é cortada. Supressões que não são de usina (PPP com licença vencida, Conect inativo, parceiro/Líder do assinante inativos) continuam indo inteiras à B2W.
- Ordem de corte nova: `originador_usina` → `lider_originador_usina` → `assinante_conect` → parceiro (`ppe|ppp|ppf`) → `lider`.
- Papel novo: `lider_originador_usina`, conta 2.1.2, `reference_type = 'originator'`, descrição `Recompensa Líder do Originador da Usina (nível 1)`; nunca "Bônus Start". Percentual em `planos_usina.originador_lider_recorrente_pct` (default 0).
- Plano de recompensas da UC = só `consumer_units.plano_assinatura_id` (sem fallback). `planos_usina.plano_assinatura_id` sai.
- Obrigatoriedade do plano na UC: UC com `tipo_unidade IS DISTINCT FROM 'geradora'` não entra/fica em `ativo`, `em_atraso` ou `em_transf_titularidade` sem plano **numa escrita direta**; mudança em cascata feita por outro gatilho (usina passando a `gerando` → UCs `ativo`; fatura vencida → UC `em_atraso`) **não é barrada** — só gera `RAISE WARNING` (ver Task 10, nota de desenho).
- Trava do plano de assinatura: plano com UC (`consumer_units.plano_assinatura_id`) ou eletroposto (`eletropostos.plano_id`) vinculado não muda `desconto_assinante`, `tipo_recompensa`, `start_config->'faturas_elegiveis'`, `start_config->'regras'`, `recorrente_config->'regras_multinivel'`, `gestao_percentual`, `piso_fornecedor_pct`, `modalidade`, `tarifa_motorista_kwh`, `recompensas_ativo`. Nome, `ativo` e os metadados de `recorrente_config` (ex.: `lastro_tarifario`) continuam editáveis.
- Funções SECURITY DEFINER: dono `postgres`, `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (exceto as RPCs de tela, SECURITY INVOKER com `GRANT EXECUTE ... TO authenticated, service_role`).
- Suítes SQL: arquivo inteiro num `DO $$ ... RAISE EXCEPTION 'SANDBOX_OK'; END $$;`; sucesso = `ERROR: P0001: SANDBOX_OK`; colar do disco **um bloco DO por chamada** (`split_participantes` tem dois); a saída é colada **verbatim** no relatório. Se o filtro da API interromper a colagem de um arquivo grande, **pare e reporte BLOCKED** com a lista do que não rodou — o controlador roda.
- Nenhum número esperado de suíte existente pode mudar, a não ser os listados explicitamente numa tarefa. Se outro mudar, **pare e reporte** a mensagem verbatim.
- Razão de produção conferido antes e depois de cada migração: `SELECT (SELECT count(*) FROM ledger_entries), (SELECT count(DISTINCT transaction_id) FROM ledger_entries), (SELECT sum(amount) FROM ledger_entries), (SELECT count(*) FROM invoices WHERE recompensas_aplicadas IS NOT NULL);` (em 10/10/2026: 458 / 155 / −10694.80823478260874 / 7). Mudança só por fluxo real de outra área; liste as transações novas se mudar.
- Arquivos `.jsx` são CRLF: editar por script Python preservando o fim de linha (`io.open(p, encoding='utf-8', newline='')`, normalizar para `\n`, trocar, voltar para `\r\n`), com âncora achada **exatamente uma vez**. `src/lib/*.js` e `tests/*.js` são LF.
- Lint só dos arquivos tocados (`npx eslint <arquivos>`; o repo inteiro estoura memória); sintaxe com `npx esbuild <arquivos> --loader:.jsx=jsx --outdir=<scratchpad>/esb`. Erro de eslint pré-existente se prova rodando o eslint na versão `git show HEAD:<arquivo>`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Nota de desenho (ajuste da decisão 16, achado ao escrever o plano)

`handle_usina_status_change` (gatilho em `usinas`) põe **todas** as UCs da usina em `ativo` quando a usina vira `gerando`, e `handle_invoice_status_change` põe a UC em `em_atraso` quando a fatura vence. Se a obrigatoriedade barrasse essas cascatas, uma UC sem plano impediria a usina inteira de entrar em operação. Por isso o gatilho só **recusa** quando a escrita é direta (`pg_trigger_depth() = 1`: tela, RPC, SQL) e, em cascata, deixa passar com `RAISE WARNING` — a fatura dessa UC cai em `uc_sem_plano` (sem recompensas nem gestão) até alguém escolher o plano. A Task 10 atualiza o texto da decisão 16 na spec.

## File Structure

- Create `supabase/migrations/20261010a_plano_so_na_uc.sql` — sai `planos_usina.plano_assinatura_id`; entra `originador_lider_recorrente_pct`; `fn_plano_da_uc` só UC; ajustes de `fn_planos_usina_trava`, `fn_usinas_vinculo_plano_usina`, `fn_planos_usina_nova_versao`; gatilho de obrigatoriedade.
- Create `supabase/migrations/20261010b_lider_originador_cota_orfa.sql` — `fn_regras_recompensa_uc`, `fn_participantes_recompensa` (patch), `fn_calcular_split_recompensa` (substituição), `handle_invoice_paid_ledger` (patch).
- Create `supabase/migrations/20261010c_trava_plano_assinatura.sql` — colunas `status`/`substitui_plano_id`, trava, vínculo só a plano ativo (UC e eletroposto), RPCs de nova versão e de mover UCs.
- Create `supabase/migrations/20261010d_originador_do_lead.sql` — cópia do originador do lead dentro de `fn_suppliers_originador_admin`.
- Create `supabase/tests/plano_assinatura_versao.test.sql` — trava e versões do plano de assinatura.
- Modify `supabase/tests/plano_usina.test.sql` e as suítes do split (fixtures: plano na UC).
- Create `src/lib/planoAssinaturaVersao.js` + `tests/plano-assinatura-versao.test.js`.
- Modify `src/lib/planoUsina.js`, `tests/plano-usina.test.js`, `src/pages/settings/components/PlanoUsinaModal.jsx`, `PlanosUsinaLista.jsx`, `UsinasPlanosTab.jsx`, `src/pages/settings/PlansServicesSettings.jsx`, `src/components/PowerPlantModal.jsx`, `src/components/ConsumerUnitModal.jsx`, `src/pages/settings/components/PlanModal.jsx`, `EletropostoPlanModal.jsx`, `src/pages/dashboards/LeadsList.jsx`.

---

### Task 10: Plano de assinatura só na UC (dados, motor, obrigatoriedade e fixtures)

**Files:**
- Create: `supabase/migrations/20261010a_plano_so_na_uc.sql`
- Modify: `supabase/tests/plano_usina.test.sql`, `split_gatilho.test.sql`, `split_bonus_start.test.sql`, `split_base_compensada.test.sql`, `split_conta_receber.test.sql`, `split_piso_tarifa_bruta.test.sql`, `invoice_paid_ledger_definer.test.sql`, `split_plano_fonte.test.sql`; e, se o Step 6 acusar, `abatimento_credito_indicacao.test.sql`, `assinante_conect.test.sql`, `invoices_pagamento_admin.test.sql`
- Modify: `docs/superpowers/specs/2026-10-06-plano-usina-design.md` (texto da decisão 16)

**Interfaces:**
- Consumes: `planos_usina`, `fn_plano_usina_da_uc(uuid)`, `fn_regras_recompensa_uc(uuid)` (vivas desde 20261006f/g).
- Produces: coluna `planos_usina.originador_lider_recorrente_pct numeric NOT NULL DEFAULT 0` (0–100, dentro da trava); `planos_usina.plano_assinatura_id` **não existe mais**; `fn_plano_da_uc(p_uc)` lê só a UC; gatilho `tr_consumer_units_plano_obrigatorio`; `fn_planos_usina_nova_versao(p_origem, p_dados)` aceita e herda `originador_lider_recorrente_pct`.

- [ ] **Step 1: Impressão digital do razão** — rode a consulta de Global Constraints e anote.

- [ ] **Step 2: Escrever a migração**

`supabase/migrations/20261010a_plano_so_na_uc.sql`:

```sql
-- Plano de Usina -- adendo de 10/10/2026, decisao 16 (spec secao 6).
-- O plano de assinatura (matriz PPE/PPP/PPF/Lider/Conect) mora SO na UC e e
-- obrigatorio nela; o plano de usina deixa de apontar para um plano de
-- assinatura -- a recompensa dele e a do originador do FORNECEDOR (e do Lider
-- desse originador, decisao 13: coluna nova aqui, motor na 20261010b).

DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM public.planos_usina WHERE plano_assinatura_id IS NOT NULL) THEN
        RAISE EXCEPTION 'planos_usina.plano_assinatura_id tem valor: decidir o destino antes de remover a coluna';
    END IF;
    IF EXISTS (SELECT 1 FROM public.consumer_units
                WHERE plano_assinatura_id IS NULL
                  AND tipo_unidade IS DISTINCT FROM 'geradora'
                  AND status::text IN ('ativo', 'em_atraso', 'em_transf_titularidade')) THEN
        RAISE EXCEPTION 'ha UC em operacao sem plano de assinatura: vincular antes de ligar a obrigatoriedade';
    END IF;
END
$guard$;

ALTER TABLE public.planos_usina
    ADD COLUMN originador_lider_recorrente_pct numeric NOT NULL DEFAULT 0
        CHECK (originador_lider_recorrente_pct BETWEEN 0 AND 100);

COMMENT ON COLUMN public.planos_usina.originador_lider_recorrente_pct IS
  'Percentual recorrente do Lider do originador do fornecedor da usina (originators_v2.lider_id com cargo lider), sobre a base de cada fatura paga das UCs dela. Sem Lider valido e ativo, a cota so vai a B2W se couber no teto (decisao 12).';

-- 1. Plano de recompensas da UC: so a UC (sem fallback do plano de usina).
CREATE OR REPLACE FUNCTION public.fn_plano_da_uc(p_uc uuid)
RETURNS planos_assinatura_energia
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.*
    FROM public.consumer_units cu
    JOIN public.planos_assinatura_energia p ON p.id = cu.plano_assinatura_id
   WHERE cu.id = p_uc;
$function$;

-- 2. Trava do plano de usina: sai plano_assinatura_id, entra o % do Lider.
CREATE OR REPLACE FUNCTION public.fn_planos_usina_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF (NEW.percentual_recorrente, NEW.taxa_admin_reais, NEW.taxa_recuperacao_pct,
        NEW.retencao_rescisao_pct, NEW.multa_atraso_mes_pct, NEW.multa_atraso_teto_pct,
        NEW.garantia_instalacao_meses, NEW.desconto_pct, NEW.dia_corte, NEW.dia_repasse,
        NEW.prazo_transferencia_dias, NEW.prazo_honorarios_dias, NEW.originador_recorrente_pct,
        NEW.originador_bonus_fechamentos, NEW.originador_lider_recorrente_pct)
       IS DISTINCT FROM
       (OLD.percentual_recorrente, OLD.taxa_admin_reais, OLD.taxa_recuperacao_pct,
        OLD.retencao_rescisao_pct, OLD.multa_atraso_mes_pct, OLD.multa_atraso_teto_pct,
        OLD.garantia_instalacao_meses, OLD.desconto_pct, OLD.dia_corte, OLD.dia_repasse,
        OLD.prazo_transferencia_dias, OLD.prazo_honorarios_dias, OLD.originador_recorrente_pct,
        OLD.originador_bonus_fechamentos, OLD.originador_lider_recorrente_pct)
       AND EXISTS (SELECT 1 FROM public.usinas u WHERE u.plano_usina_id = OLD.id)
    THEN
        RAISE EXCEPTION 'O plano de usina "%" ja tem usina vinculada: percentuais e valores nao mudam mais. Crie uma nova versao.', OLD.nome
            USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

-- 3. Vinculo: plano de usina so precisa estar ativo.
CREATE OR REPLACE FUNCTION public.fn_usinas_vinculo_plano_usina()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_plano record;
BEGIN
    IF (TG_OP = 'INSERT' AND NEW.plano_usina_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.plano_usina_id IS DISTINCT FROM OLD.plano_usina_id) THEN
        IF auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
            RAISE EXCEPTION 'So admin vincula usina a plano de usina.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    IF NEW.plano_usina_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.plano_usina_id IS DISTINCT FROM OLD.plano_usina_id) THEN
        SELECT nome, status INTO v_plano
          FROM public.planos_usina WHERE id = NEW.plano_usina_id;
        IF v_plano.status <> 'ativo' THEN
            RAISE EXCEPTION 'O plano de usina "%" esta somente para contratos: escolha um plano ativo.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

-- 4. Nova versao do plano de usina: sem plano_assinatura_id, com o % do Lider.
CREATE OR REPLACE FUNCTION public.fn_planos_usina_nova_versao(p_origem uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_origem public.planos_usina;
    v_novo   uuid;
BEGIN
    SELECT * INTO v_origem FROM public.planos_usina WHERE id = p_origem FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_planos_usina_nova_versao: plano de usina % nao existe', p_origem;
    END IF;

    INSERT INTO public.planos_usina (
        nome, descricao, percentual_recorrente, taxa_admin_reais, taxa_recuperacao_pct,
        retencao_rescisao_pct, multa_atraso_mes_pct, multa_atraso_teto_pct,
        garantia_instalacao_meses, desconto_pct, dia_corte, dia_repasse,
        prazo_transferencia_dias, prazo_honorarios_dias,
        originador_recorrente_pct, originador_bonus_fechamentos,
        originador_lider_recorrente_pct, status, substitui_plano_id)
    VALUES (
        COALESCE(NULLIF(btrim(p_dados ->> 'nome'), ''), v_origem.nome || ' (nova versao)'),
        CASE WHEN p_dados ? 'descricao' THEN p_dados ->> 'descricao' ELSE v_origem.descricao END,
        COALESCE((p_dados ->> 'percentual_recorrente')::numeric,     v_origem.percentual_recorrente),
        COALESCE((p_dados ->> 'taxa_admin_reais')::numeric,          v_origem.taxa_admin_reais),
        COALESCE((p_dados ->> 'taxa_recuperacao_pct')::numeric,      v_origem.taxa_recuperacao_pct),
        COALESCE((p_dados ->> 'retencao_rescisao_pct')::numeric,     v_origem.retencao_rescisao_pct),
        COALESCE((p_dados ->> 'multa_atraso_mes_pct')::numeric,      v_origem.multa_atraso_mes_pct),
        COALESCE((p_dados ->> 'multa_atraso_teto_pct')::numeric,     v_origem.multa_atraso_teto_pct),
        COALESCE((p_dados ->> 'garantia_instalacao_meses')::integer, v_origem.garantia_instalacao_meses),
        COALESCE((p_dados ->> 'desconto_pct')::numeric,              v_origem.desconto_pct),
        COALESCE((p_dados ->> 'dia_corte')::integer,                 v_origem.dia_corte),
        COALESCE((p_dados ->> 'dia_repasse')::integer,               v_origem.dia_repasse),
        COALESCE((p_dados ->> 'prazo_transferencia_dias')::integer,  v_origem.prazo_transferencia_dias),
        COALESCE((p_dados ->> 'prazo_honorarios_dias')::integer,     v_origem.prazo_honorarios_dias),
        COALESCE((p_dados ->> 'originador_recorrente_pct')::numeric, v_origem.originador_recorrente_pct),
        CASE WHEN p_dados ? 'originador_bonus_fechamentos'
             THEN COALESCE((SELECT array_agg(x::integer ORDER BY x::integer)
                              FROM jsonb_array_elements_text(p_dados -> 'originador_bonus_fechamentos') x), '{}')
             ELSE v_origem.originador_bonus_fechamentos END,
        COALESCE((p_dados ->> 'originador_lider_recorrente_pct')::numeric, v_origem.originador_lider_recorrente_pct),
        'ativo',
        p_origem)
    RETURNING id INTO v_novo;

    UPDATE public.planos_usina SET status = 'somente_contratos' WHERE id = p_origem;
    RETURN v_novo;
END;
$function$;

-- 5. Sai a coluna (depois das funcoes que a liam).
ALTER TABLE public.planos_usina DROP COLUMN plano_assinatura_id;

COMMENT ON COLUMN public.usinas.plano_usina_id IS
  'Plano de Usina. Liga a gestao B2W do split e a recompensa do originador do fornecedor (e do Lider dele). O plano de assinatura de cada UC continua vindo da UC.';

COMMENT ON TABLE public.planos_usina IS
  'Plano de Usina (spec 2026-10-06, secao 6): gestao B2W (percentual_recorrente = os 10% da B2W no split), taxas cobradas pelo fechamento mensal, termos dos contratos de compra e venda e de gestao, e a recompensa de quem esta ligado ao FORNECEDOR (originador e Lider dele). A recompensa de quem esta ligado ao ASSINANTE vem do plano de assinatura da UC. Com usina vinculada, numeros nao mudam (fn_planos_usina_trava): mudar = fn_planos_usina_nova_versao.';

-- 6. Plano de assinatura obrigatorio na UC em operacao (decisao 16).
CREATE OR REPLACE FUNCTION public.fn_consumer_units_plano_obrigatorio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF NEW.plano_assinatura_id IS NULL
       AND NEW.tipo_unidade IS DISTINCT FROM 'geradora'
       AND NEW.status::text IN ('ativo', 'em_atraso', 'em_transf_titularidade') THEN
        -- Cascata de outro gatilho (usina virou 'gerando', fatura venceu):
        -- barrar travaria a usina inteira. Passa e avisa; a fatura dessa UC
        -- cai em uc_sem_plano ate alguem escolher o plano.
        IF pg_trigger_depth() > 1 THEN
            RAISE WARNING 'UC % entrou em % sem plano de assinatura (mudanca automatica): as faturas dela nao lancam recompensas nem gestao ate o plano ser escolhido', NEW.id, NEW.status;
        ELSE
            RAISE EXCEPTION 'Escolha o plano de assinatura da UC antes de coloca-la em %.', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_consumer_units_plano_obrigatorio() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_consumer_units_plano_obrigatorio() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_consumer_units_plano_obrigatorio
    BEFORE INSERT OR UPDATE OF status, plano_assinatura_id, tipo_unidade ON public.consumer_units
    FOR EACH ROW EXECUTE FUNCTION public.fn_consumer_units_plano_obrigatorio();
```

- [ ] **Step 3: Testes novos em `plano_usina.test.sql` (RED) e adaptação do arquivo**

No `plano_usina.test.sql`, antes de aplicar a migração:

1. `pg_temp.fatura_paga(p_usina, p_ppe, p_plano_uc)` continua igual, mas **toda** chamada passa um plano de recompensas (nunca `NULL`): O1, O3, O4 → `v_rec_plano`; O2 → `v_rec_piso675`; O5 → `v_rec_start`; O6 → `v_rec_start1`; M1 → `v_rec_plano`.
2. Tire `plano_assinatura_id` de **todos** os `INSERT INTO public.planos_usina` do arquivo. Os planos de recompensas de cada plano de usina passam a ir na UC (item 1).
3. T3: apague o bloco "trocar o plano de recompensas devia ser recusado" e ponha no lugar:

```sql
    v_pegou := false;
    BEGIN
        UPDATE public.planos_usina SET originador_lider_recorrente_pct = 1 WHERE id = v_pu;
    EXCEPTION WHEN others THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T3: com usina, mudar originador_lider_recorrente_pct devia ser recusado';
    END IF;
```

4. T5 inverte (decisão 16 — plano de usina sem plano de recompensas recebe usina):

```sql
    INSERT INTO public.planos_usina (nome) VALUES ('SANDBOX PU sem recompensas') RETURNING id INTO v_pu_sem_rec;
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu_sem_rec);   -- passa: plano de usina so precisa estar ativo
```

5. T6: tire `OR v_row.plano_assinatura_id IS DISTINCT FROM v_rec_plano` da condição.
6. M1 vira "UC com o plano de recompensas na mesma usina" (mesmos números, `{-120,-60,-820,0}`) e entra **M1b** logo depois:

```sql
    -- M1b -- UC sem plano proprio NAO herda mais o plano da usina (decisao 16):
    --        fatura cai em uc_sem_plano, sem gestao nem recompensa.
    --        A UC fica em 'ativacao' porque UC ativa sem plano e recusada.
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://pu/m1b') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina2, 'consumidora', 'ativacao', 'SANDBOX PU conc', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;
    v_contas := pg_temp.contas(v_inv);
    IF v_contas[1] <> 0 OR v_contas[2] <> 0 OR v_contas[4] <> 0 THEN
        RAISE EXCEPTION 'FALHA M1b: UC sem plano em usina com plano de usina lancou gestao/recompensa: %', v_contas;
    END IF;
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec ->> 'motivo' IS DISTINCT FROM 'uc_sem_plano' THEN
        RAISE EXCEPTION 'FALHA M1b: motivo = %, esperado uc_sem_plano', v_rec ->> 'motivo';
    END IF;
```

7. M4: o plano de usina `v_pu3` não tem mais plano de recompensas; a UC do M4 ganha `plano_assinatura_id = v_rec_sem_matriz` no `INSERT INTO public.consumer_units` (status continua `'ativo'`).
8. O8: a UC já tem `v_rec_plano_uc`; nada muda.
9. Acima da linha marcada, os casos da obrigatoriedade:

```sql
    -- ==================================================================
    -- U1 -- UC ativa sem plano de assinatura e recusada (escrita direta).
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pu/u1') RETURNING id INTO v_sub;
    v_pegou := false;
    BEGIN
        INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status) VALUES (v_sub, 'beneficiaria', 'ativo');
    EXCEPTION WHEN check_violation THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%plano de assinatura%' THEN
        RAISE EXCEPTION 'FALHA U1: UC ativa sem plano foi aceita (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- U2 -- em ativacao sem plano passa (onboarding publico); ativar sem plano e recusado.
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status)
    VALUES (v_sub, 'beneficiaria', 'ativacao') RETURNING id INTO v_uc;
    v_pegou := false;
    BEGIN
        UPDATE public.consumer_units SET status = 'ativo' WHERE id = v_uc;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA U2: ativar UC sem plano devia ser recusado';
    END IF;

    -- U3 -- geradora nao precisa de plano.
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status) VALUES (v_sub, 'geradora', 'ativo');

    -- U4 -- tirar o plano de UC ativa e recusado.
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id)
    VALUES (v_sub, 'beneficiaria', 'ativo', v_rec_plano) RETURNING id INTO v_uc;
    v_pegou := false;
    BEGIN
        UPDATE public.consumer_units SET plano_assinatura_id = NULL WHERE id = v_uc;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA U4: tirar o plano de UC ativa devia ser recusado';
    END IF;

    -- U5 -- cascata (gatilho de outro gatilho) NAO e barrada: simulada por
    --       um gatilho de teste em invoices que ativa a UC. Funcao e gatilho
    --       sao DDL dentro da transacao: somem no rollback do SANDBOX_OK.
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status)
    VALUES (v_sub, 'beneficiaria', 'ativacao') RETURNING id INTO v_uc;
    EXECUTE $t$
      CREATE FUNCTION public.fn_sandbox_ativa_uc() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN UPDATE public.consumer_units SET status = 'ativo' WHERE id = NEW.uc_id; RETURN NEW; END $f$
    $t$;
    EXECUTE 'CREATE TRIGGER tr_sandbox_ativa_uc AFTER INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_sandbox_ativa_uc()';
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 10, 0, CURRENT_DATE + 5);
    EXECUTE 'DROP TRIGGER tr_sandbox_ativa_uc ON public.invoices';
    IF (SELECT status::text FROM public.consumer_units WHERE id = v_uc) <> 'ativo' THEN
        RAISE EXCEPTION 'FALHA U5: a cascata devia ativar a UC mesmo sem plano';
    END IF;
```

Run: cole `plano_usina.test.sql` no `execute_sql`. Expected (antes da migração): FAIL — a primeira falha é a de U1 (`FALHA U1: UC ativa sem plano foi aceita`) ou um erro de M1b/T5. Cole verbatim.

- [ ] **Step 4: Aplicar a migração**

`apply_migration` com nome `20261010a_plano_so_na_uc` e o conteúdo do arquivo. Expected: sucesso. Se o `DO $guard$` estourar, **pare e reporte** a mensagem verbatim.

- [ ] **Step 5: GREEN em `plano_usina.test.sql`** — cole de novo. Expected: `ERROR: P0001: SANDBOX_OK`.

- [ ] **Step 6: Adaptar os fixtures das outras suítes**

Desde o Step 4 a UC não herda mais o plano da usina, e UC ativa sem plano é recusada. Em cada suíte, `pg_temp.pu(p_plano)` passa a **não** gravar `plano_assinatura_id` (tire a coluna e o `p.id` do `INSERT ... SELECT`; o `percentual_recorrente` continua vindo do plano, para a gestão não mudar), e cada `INSERT INTO public.consumer_units` de UC **não geradora** ganha `plano_assinatura_id` com o plano que a usina dela usava:

| Suíte | usina → plano da UC |
|---|---|
| `split_gatilho` | `v_usina`→`v_plano`, `v_usina_p73`→`v_plano_p73`, `v_usina_p95`→`v_plano_p95`, `v_usina_start`→`v_plano_start`, `v_usina_nula`→`v_plano_nula`, `v_usina_orfao`→`v_plano_orfao`; casos 12 e 16 (UC com `usina_id NULL`) → `v_plano`; caso 4 (`v_usina_sem_plano`, que mede `uc_sem_plano`) → **sem plano e `status 'ativacao'`**; caso 6 (geradora) não muda |
| `split_bonus_start` | `v_usina_start`→`v_plano_start`, `v_usina_ambos`→`v_plano_ambos`, `v_usina_rec`→`v_plano_rec` |
| `split_base_compensada` | as três usinas → `v_plano` |
| `split_conta_receber` | `v_usina`→`v_plano` |
| `split_piso_tarifa_bruta` | `v_usina`→`v_plano`; caso 2 (`v_usina_sem_plano`, mede `uc_sem_plano`) → **sem plano e `status 'ativacao'`** |
| `invoice_paid_ledger_definer` | `v_usina`→`v_plano` |
| `split_plano_fonte` | ver abaixo |

`split_plano_fonte`: a UC `v_uc_com_plano_proprio` continua com `v_plano_uc`; `v_uc_so_usina` e `v_uc_sem_nenhum` vão para `status 'ativacao'`; o caso 2 passa a esperar **NULL** (sem fallback):

```sql
  v_plano_row := public.fn_plano_da_uc(v_uc_so_usina);
  IF v_plano_row.id IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 2: UC sem plano proprio devolveu % (esperado NULL: o plano de usina nao da mais plano de recompensas)', v_plano_row.id;
  END IF;
```

Depois rode, do disco, cada suíte acima **e** `abatimento_credito_indicacao`, `assinante_conect`, `invoices_pagamento_admin`, `split_participantes` (2 blocos), `split_cargos_arvore`. Se uma das três primeiras recusar UC ativa sem plano, dê à UC um plano criado no próprio fixture (`INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config) VALUES ('SANDBOX <suite>', 'recorrente', 10, 50, '{"regras_multinivel": {"b2w": {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4}}}'::jsonb)`) **somente se** isso não mudar nenhum número esperado; se mudar, use `status 'ativacao'`; se nenhum dos dois servir, **pare e reporte**.

Expected: `ERROR: P0001: SANDBOX_OK` em todas. Nenhum número esperado muda (só o caso 2 do `split_plano_fonte`, acima).

- [ ] **Step 7: Atualizar a decisão 16 na spec**

Em `docs/superpowers/specs/2026-10-06-plano-usina-design.md`, troque a linha que começa com `    - obrigatoriedade: no banco, UC` por:

```markdown
    - obrigatoriedade: no banco, UC não geradora não entra nem fica em `ativo`, `em_atraso` ou `em_transf_titularidade` sem plano **numa escrita direta** (tela, RPC, SQL); mudança em cascata feita por outro gatilho (usina virando `gerando`, fatura vencida) passa com `RAISE WARNING`, para uma UC sem plano não travar a usina inteira — a fatura dela cai em `uc_sem_plano` até o plano ser escolhido. Na tela da UC o campo é obrigatório. O onboarding público (`fn_criar_assinante_publico`, que cria a UC em ativação sem plano) não muda. Em 10/10/2026 as 18 UCs beneficiárias em operação já têm plano.
```

- [ ] **Step 8: Razão depois** — rode a consulta e compare com o Step 1.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20261010a_plano_so_na_uc.sql supabase/tests/ docs/superpowers/specs/2026-10-06-plano-usina-design.md
git commit -m "feat(plano-usina): plano de assinatura so na UC e obrigatorio; plano de usina sem plano de recompensas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Motor — Líder do originador da usina e cota sem dono só se couber

**Files:**
- Create: `supabase/migrations/20261010b_lider_originador_cota_orfa.sql`
- Modify: `supabase/tests/plano_usina.test.sql` (casos C1–C2, L1–L4 acima da linha marcada)

**Interfaces:**
- Consumes: `planos_usina.originador_lider_recorrente_pct` (Task 10); `fn_plano_usina_da_uc(uuid)`.
- Produces: participante `{"papel": "lider_originador_usina", "id": <uuid|null>, "nivel": 1, "suspenso": bool}`; entrada `lider_originador_usina` na matriz quando o % > 0; motor com ordem `['originador_usina','lider_originador_usina','assinante_conect','parceiro','lider']`; beneficiário de usina suspenso sai com `pct 0`, `valor 0`, `cortado` = o que foi cortado e `absorvido_b2w` = o que foi à B2W; versão gravada `20261010_plano_usina_adendo`.

- [ ] **Step 1: Casos novos (RED)** — acima de `-- >>> casos novos entram acima desta linha <<<` em `plano_usina.test.sql`. Base 1000 (tarifa 1,20, Fio B 0,20, sem desconto), UC com `v_ppe` (PPE nível 1 5% + Líder 1%):

```sql
    -- ==================================================================
    -- fixture: Lider do originador da usina
    -- ==================================================================
    DECLARE
        v_lider_usina   uuid;
        v_lider_inat    uuid;
        v_orig_c_lider  uuid;
        v_orig_c_linat  uuid;
        v_orig_s_lider  uuid;
        v_forn_c_lider  uuid;
        v_forn_c_linat  uuid;
        v_forn_s_lider  uuid;
        v_forn_sem      uuid;
        v_pu_lider      uuid;
        v_pu_orfa675    uuid;
        v_rec_piso68    uuid;
        v_rec_piso70    uuid;
    BEGIN
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU lider da usina', 'lider', true) RETURNING id INTO v_lider_usina;
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU lider inativo', 'lider', false) RETURNING id INTO v_lider_inat;
        INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id) VALUES ('SANDBOX PU orig c/ lider', 'ppf', true, v_lider_usina) RETURNING id INTO v_orig_c_lider;
        INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id) VALUES ('SANDBOX PU orig c/ lider inativo', 'ppf', true, v_lider_inat) RETURNING id INTO v_orig_c_linat;
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU orig s/ lider', 'ppf', true) RETURNING id INTO v_orig_s_lider;

        INSERT INTO public.suppliers (name, originator_id) VALUES ('SANDBOX PU forn c/ lider', v_orig_c_lider) RETURNING id INTO v_forn_c_lider;
        INSERT INTO public.suppliers (name, originator_id) VALUES ('SANDBOX PU forn c/ lider inativo', v_orig_c_linat) RETURNING id INTO v_forn_c_linat;
        INSERT INTO public.suppliers (name, originator_id) VALUES ('SANDBOX PU forn s/ lider', v_orig_s_lider) RETURNING id INTO v_forn_s_lider;
        INSERT INTO public.suppliers (name) VALUES ('SANDBOX PU forn sem originador') RETURNING id INTO v_forn_sem;

        -- plano de usina 12% + originador 3% + Lider dele 1%
        INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, originador_lider_recorrente_pct)
        VALUES ('SANDBOX PU 12+3+1', 12, 3, 1) RETURNING id INTO v_pu_lider;

        -- L1 -- o Lider do originador recebe 1% em 2.1.2.
        --   B2W 120 | 2.1.2 = PPE 50 + Lider 10 + originador 30 + Lider do originador 10 = 100 | fornecedor 780
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_c_lider) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_plano);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-120, -100, -780, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA L1: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-100,-780,0}', v_contas;
        END IF;
        SELECT count(*) INTO v_n FROM public.ledger_entries
         WHERE reference_id = v_lider_usina AND reference_type = 'originator' AND amount = -10
           AND description = 'Recompensa Líder do Originador da Usina (nível 1)'
           AND transaction_id = (SELECT transaction_id FROM public.ledger_entries
                                  WHERE reference_id = v_inv AND reference_type = 'invoice' LIMIT 1);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'FALHA L1: esperado 1 lancamento de -10 em 2.1.2 para o Lider do originador, achei %', v_n;
        END IF;

        -- L2 -- Lider inativo: a cota dele (10) vai para a B2W (cabe no teto 400).
        --   B2W 130 | 2.1.2 = 90 | fornecedor 780
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_c_linat) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_plano);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-130, -90, -780, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA L2: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-130,-90,-780,0}', v_contas;
        END IF;

        -- L3 -- originador sem Lider: mesma conta do L2.
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_s_lider) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_plano);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-130, -90, -780, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA L3: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-130,-90,-780,0}', v_contas;
        END IF;

        -- L4 -- ordem de corte: originador da usina, depois o Lider dele, antes do PPE.
        --   piso 68: piso em R$ = 1000 x 1,20 x 68% = 816 -> teto 184
        --   bruto 220 (120 + 30 + 10 + 50 + 10), excesso 36:
        --   originador 30 -> 0 (cortado 30), Lider do originador 10 -> 4 (cortado 6),
        --   PPE 50 e Lider 10 intactos. 2.1.2 = 4 + 50 + 10 = 64; fornecedor 816.
        INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
        VALUES ('SANDBOX PU rec piso68', 'recorrente', 10, 68, jsonb_build_object('regras_multinivel', c_matriz))
        RETURNING id INTO v_rec_piso68;
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_c_lider) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_piso68);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-120, -64, -816, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA L4: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-64,-816,0}', v_contas;
        END IF;
        SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
        SELECT b INTO v_ben FROM jsonb_array_elements(v_rec -> 'resultado' -> 'beneficiarios') b
         WHERE b ->> 'papel' = 'lider_originador_usina';
        IF (v_ben ->> 'cortado')::numeric IS DISTINCT FROM 6::numeric OR (v_ben ->> 'valor')::numeric IS DISTINCT FROM 4::numeric THEN
            RAISE EXCEPTION 'FALHA L4: Lider do originador devia ser o 2o cortado (cortado 6, valor 4), veio %', v_ben;
        END IF;

        -- plano de usina 12% + originador 3%, fornecedor SEM originador
        INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct)
        VALUES ('SANDBOX PU 12+3 orfa', 12, 3) RETURNING id INTO v_pu_orfa675;

        -- C1 -- cota sem dono so vai a B2W se couber (decisao 12).
        --   piso 67,5 -> teto 190; bruto 210 (B2W 120 + cota orfa 30 + PPE 50 + Lider 10),
        --   excesso 20 sai da cota orfa: 30 -> 10, e so esses 10 vao a B2W.
        --   B2W 130 | 2.1.2 = 60 (PPE e Lider intactos) | fornecedor 810
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_orfa675, v_forn_sem) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_piso675);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-130, -60, -810, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA C1: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-130,-60,-810,0}', v_contas;
        END IF;
        SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
        SELECT b INTO v_ben FROM jsonb_array_elements(v_rec -> 'resultado' -> 'beneficiarios') b
         WHERE b ->> 'papel' = 'originador_usina';
        IF (v_ben ->> 'valor')::numeric <> 0 OR (v_ben ->> 'cortado')::numeric <> 20 OR (v_ben ->> 'absorvido_b2w')::numeric <> 10 THEN
            RAISE EXCEPTION 'FALHA C1: cota orfa congelada errada (esperado valor 0, cortado 20, absorvido_b2w 10): %', v_ben;
        END IF;
        IF (v_rec -> 'resultado' -> 'b2w' ->> 'valor_absorvido')::numeric <> 10 THEN
            RAISE EXCEPTION 'FALHA C1: b2w.valor_absorvido = %, esperado 10', v_rec -> 'resultado' -> 'b2w' ->> 'valor_absorvido';
        END IF;

        -- C2 -- excesso maior que a cota: ela zera e o resto sai do PPE.
        --   piso 70 -> piso em R$ 840 -> teto 160; excesso 50:
        --   cota orfa 30 -> 0, PPE 50 -> 30. B2W 120 | 2.1.2 = 40 | fornecedor 840
        INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
        VALUES ('SANDBOX PU rec piso70', 'recorrente', 10, 70, jsonb_build_object('regras_multinivel', c_matriz))
        RETURNING id INTO v_rec_piso70;
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_orfa675, v_forn_sem) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_piso70);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-120, -40, -840, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA C2: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-40,-840,0}', v_contas;
        END IF;
    END;
```

(`v_usina`, `v_inv`, `v_contas`, `v_rec`, `v_ben`, `v_n`, `c_matriz`, `v_ppe`, `v_rec_plano`, `v_rec_piso675` já existem no bloco externo.)

Run: cole o arquivo. Expected: FAIL — `FALHA L1: ... esperado {-120,-100,-780,0}` (o papel ainda não existe; 3.1.1 vem −120 e 2.1.2 −90). Cole verbatim.

- [ ] **Step 2: Escrever a migração**

`supabase/migrations/20261010b_lider_originador_cota_orfa.sql`:

```sql
-- Plano de Usina -- adendo de 10/10/2026 (spec secao 6), decisoes 12 e 13.
--  * 13: o Lider do originador do fornecedor recebe originador_lider_recorrente_pct
--    (papel lider_originador_usina, nivel 1, so recorrencia);
--  * 12: cota de usina sem dono (originador ou Lider dele ausente/inativo) nao
--    engorda a B2W antes do corte: fica na fila, e a PRIMEIRA a ser cortada,
--    e so o que sobrar vai a B2W. As demais supressoes continuam como estao.
-- fn_participantes_recompensa e handle_invoice_paid_ledger sao PATCHADAS sobre
-- o corpo vivo atras de trava de md5 (mesmo padrao da 20261006g).

-- ---------------------------------------------------------------------------
-- 0. Travas de md5 (corpos vivos em 10/10/2026, conferidos na Task 9)
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_participantes_recompensa(uuid)'::regprocedure))
       <> '81895914cfb58b20c764ca129d2bd07c' THEN
        RAISE EXCEPTION 'fn_participantes_recompensa mudou desde 10/10/2026: re-derivar o patch';
    END IF;
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb)'::regprocedure))
       <> '60ee6b0152cd3181845ea4e0dcc90963' THEN
        RAISE EXCEPTION 'fn_calcular_split_recompensa mudou desde 10/10/2026: re-derivar a substituicao';
    END IF;
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_invoice_paid_ledger()'::regprocedure))
       <> '1211633a8ad91bd473a2f4abdf0c8109' THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger mudou desde 10/10/2026: re-derivar o patch';
    END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. fn_regras_recompensa_uc: injeta lider_originador_usina na matriz
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_regras_recompensa_uc(p_uc uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plano  public.planos_assinatura_energia;
  v_pu     public.planos_usina;
  v_matriz jsonb;
  v_gestao numeric;
  v_pct    text;
BEGIN
  v_plano := public.fn_plano_da_uc(p_uc);

  IF v_plano.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_pu     := public.fn_plano_usina_da_uc(p_uc);
  v_matriz := v_plano.recorrente_config -> 'regras_multinivel';
  v_gestao := v_plano.gestao_percentual;

  -- Plano de Usina: a gestao B2W e o percentual_recorrente do plano da
  -- usina, igual em todos os niveis. So sobrescreve matriz VALIDA: sem
  -- b2w.niveis objeto, o gatilho tem de continuar caindo em plano_sem_matriz.
  IF v_pu.id IS NOT NULL THEN
    v_gestao := v_pu.percentual_recorrente;
    IF jsonb_typeof(v_matriz #> '{b2w,niveis}') = 'object' THEN
      v_pct := v_pu.percentual_recorrente::text;
      v_matriz := jsonb_set(v_matriz, '{b2w}', jsonb_build_object(
        'niveis', jsonb_build_object('L1', v_pct, 'L2', v_pct, 'L3', v_pct, 'L4', v_pct),
        'max_niveis', 4));

      -- quem esta ligado ao FORNECEDOR: so nivel 1, nao e multinivel.
      IF v_pu.originador_recorrente_pct > 0 THEN
        v_matriz := v_matriz || jsonb_build_object('originador_usina', jsonb_build_object(
          'niveis', jsonb_build_object('L1', v_pu.originador_recorrente_pct::text,
                                       'L2', '0', 'L3', '0', 'L4', '0'),
          'max_niveis', 1));
      END IF;
      IF v_pu.originador_lider_recorrente_pct > 0 THEN
        v_matriz := v_matriz || jsonb_build_object('lider_originador_usina', jsonb_build_object(
          'niveis', jsonb_build_object('L1', v_pu.originador_lider_recorrente_pct::text,
                                       'L2', '0', 'L3', '0', 'L4', '0'),
          'max_niveis', 1));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'plano_id', v_plano.id,
    'plano_usina_id', v_pu.id,
    'percentual_recorrente', v_pu.percentual_recorrente,
    'tipo_recompensa', v_plano.tipo_recompensa,
    'gestao_pct', v_gestao,
    'piso_pct', v_plano.piso_fornecedor_pct,
    'desconto_pct', v_plano.desconto_assinante,
    'modalidade', v_plano.modalidade,
    'regras_multinivel', v_matriz,
    'start_config', v_plano.start_config
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. fn_participantes_recompensa: o participante lider_originador_usina
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    d := pg_get_functiondef('public.fn_participantes_recompensa(uuid)'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$  SELECT s.originator_id AS originador_id, pu.originador_recorrente_pct, o.ativo
    INTO v_ou$de$,
         $para$  SELECT s.originator_id AS originador_id, pu.originador_recorrente_pct, o.ativo,
         pu.originador_lider_recorrente_pct, o.lider_id, ol.cargo AS lider_cargo, ol.ativo AS lider_ativo
    INTO v_ou$para$),
        ($de$    LEFT JOIN public.originators_v2 o ON o.id = s.originator_id
   WHERE cu.id = p_uc;$de$,
         $para$    LEFT JOIN public.originators_v2 o ON o.id = s.originator_id
    LEFT JOIN public.originators_v2 ol ON ol.id = o.lider_id
   WHERE cu.id = p_uc;$para$),
        ($de$      'suspenso', v_ou.originador_id IS NULL OR NOT COALESCE(v_ou.ativo, false)
    );
  END IF;$de$,
         $para$      'suspenso', v_ou.originador_id IS NULL OR NOT COALESCE(v_ou.ativo, false)
    );
  END IF;

  -- Adendo 10/10/2026 (decisao 13): o Lider do originador do fornecedor.
  -- So vale lider_id com cargo 'lider' (regra F3 do assinante); sem Lider
  -- valido e ativo, entra suspenso e o motor trata como cota sem dono
  -- (decisao 12: so vai a B2W se couber).
  IF FOUND AND COALESCE(v_ou.originador_lider_recorrente_pct, 0) > 0 THEN
    v_res := v_res || jsonb_build_object(
      'papel', 'lider_originador_usina',
      'id', CASE WHEN v_ou.lider_cargo = 'lider' THEN v_ou.lider_id END,
      'nivel', 1,
      'suspenso', v_ou.lider_id IS NULL OR v_ou.lider_cargo IS DISTINCT FROM 'lider'
                  OR NOT COALESCE(v_ou.lider_ativo, false)
    );
  END IF;$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'fn_participantes_recompensa: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    EXECUTE d;
END
$patch$;

-- ---------------------------------------------------------------------------
-- 3. fn_calcular_split_recompensa: papel novo, ordem de corte, cota sem dono
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_calcular_split_recompensa(p_base numeric, p_teto_deducao numeric, p_regras jsonb, p_participantes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_n_orig_usina     int;
  v_n_lider_usina    int;
  v_pct_b2w          numeric;
  v_valor_b2w        numeric;
  v_valor_absorvido  numeric := 0;
  v_pct_absorvido    numeric := 0;
  v_beneficiarios    jsonb := '[]'::jsonb;
  v_item             jsonb;
  v_papel            text;
  v_nivel            int;
  v_suspenso         boolean;
  v_pct              numeric;
  v_valor            numeric;
  v_max_niveis       int;
  v_total_bruto      numeric;
  v_excesso          numeric;
  v_corte_aplicado   numeric := 0;
  v_arr              jsonb[];
  v_idx              int;
  v_cat              text;
  v_cut              numeric;
  v_valor_atual      numeric;
  v_cortado_atual    numeric;
  v_total_deduzido   numeric;
  v_teto_estourado   boolean;
  v_n_parceiro       int;
  v_n_lider          int;
  v_n_conect         int;
  v_resto            numeric;
  v_pct_resto        numeric;
BEGIN
  -- Guarda de contrato (F1/F2/F5): entrada invalida estoura erro em vez de
  -- produzir um numero silenciosamente errado.
  IF p_base IS NULL THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_base nao pode ser NULL (base ausente nao e o mesmo que base zero)';
  END IF;

  IF p_teto_deducao IS NULL THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_teto_deducao nao pode ser NULL (teto ausente nao e o mesmo que teto zero -- viraria trava anti-deficit sempre aberta)';
  END IF;

  IF p_regras #> '{b2w,niveis}' IS NULL THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_regras precisa da chave b2w.niveis (a B2W sempre recebe; regra ausente nao pode zerar ela em silencio)';
  END IF;

  -- F7: no maximo um participante por categoria.
  SELECT
    count(*) FILTER (WHERE elem->>'papel' IN ('ppe', 'ppp', 'ppf')),
    count(*) FILTER (WHERE elem->>'papel' = 'lider'),
    count(*) FILTER (WHERE elem->>'papel' = 'assinante_conect'),
    count(*) FILTER (WHERE elem->>'papel' = 'originador_usina'),
    count(*) FILTER (WHERE elem->>'papel' = 'lider_originador_usina')
    INTO v_n_parceiro, v_n_lider, v_n_conect, v_n_orig_usina, v_n_lider_usina
    FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb)) elem;

  IF v_n_parceiro > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "parceiro" (ppe|ppp|ppf sao o mesmo agente indicador em niveis diferentes e nunca coexistem no mesmo pagamento) -- isso e bug de quem montou a lista, nao um caso de negocio', v_n_parceiro;
  END IF;

  IF v_n_lider > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "lider" -- so pode haver um por pagamento, isso e bug de quem montou a lista, nao um caso de negocio', v_n_lider;
  END IF;

  IF v_n_conect > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "assinante_conect" -- so pode haver um por pagamento, isso e bug de quem montou a lista, nao um caso de negocio', v_n_conect;
  END IF;

  IF v_n_orig_usina > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "originador_usina" -- uma usina tem um so originador, isso e bug de quem montou a lista, nao um caso de negocio', v_n_orig_usina;
  END IF;

  IF v_n_lider_usina > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "lider_originador_usina" -- o originador da usina tem um so Lider, isso e bug de quem montou a lista, nao um caso de negocio', v_n_lider_usina;
  END IF;

  -- F3: base sempre com 2 casas ja na entrada.
  p_base := round(p_base, 2);

  -- base <= 0: nada a partilhar, tudo zerado, fornecedor fica com a base.
  IF p_base <= 0 THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'papel', elem->>'papel',
               'id', elem->'id',
               'nivel', (elem->>'nivel')::int,
               'pct', 0,
               'valor', 0,
               'cortado', 0
             )
           ), '[]'::jsonb)
      INTO v_beneficiarios
      FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb)) elem;

    RETURN jsonb_build_object(
      'b2w', jsonb_build_object('pct', 0, 'valor', 0, 'pct_absorvido', 0, 'valor_absorvido', 0),
      'beneficiarios', v_beneficiarios,
      'total_deduzido', 0,
      'corte_aplicado', 0,
      'fornecedor', p_base,
      'teto_estourado', (0::numeric > p_teto_deducao)
    );
  END IF;

  v_pct_b2w := GREATEST(COALESCE((p_regras #>> ARRAY['b2w','niveis','L1'])::numeric, 0), 0);
  v_valor_b2w := round(p_base * v_pct_b2w / 100, 2);

  -- 1a passada: um item por participante, com pct/valor brutos.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb))
  LOOP
    v_papel    := v_item->>'papel';
    v_nivel    := NULLIF(v_item->>'nivel', '')::int;
    v_suspenso := COALESCE((v_item->>'suspenso')::boolean, false);
    v_max_niveis := COALESCE((p_regras #>> ARRAY[v_papel, 'max_niveis'])::int, 0);

    IF v_nivel IS NULL OR v_nivel > v_max_niveis THEN
      v_pct := 0;
    ELSE
      v_pct := GREATEST(COALESCE((p_regras #>> ARRAY[v_papel, 'niveis', 'L' || v_nivel])::numeric, 0), 0);
    END IF;

    v_valor := round(p_base * v_pct / 100, 2);

    IF v_suspenso AND v_papel IN ('originador_usina', 'lider_originador_usina') THEN
      -- Decisao 12 (10/10/2026): cota de usina sem dono fica na fila de
      -- corte (e a primeira) e so o que sobrar vai a B2W, depois do corte.
      v_beneficiarios := v_beneficiarios || jsonb_build_object(
        'papel', v_papel, 'id', v_item->'id', 'nivel', v_nivel,
        'pct', v_pct, 'valor', v_valor, 'cortado', 0, 'para_b2w', true
      );
    ELSIF v_suspenso THEN
      -- demais supressoes: percentual e valor vao para a B2W (nunca ao fornecedor)
      v_pct_absorvido   := v_pct_absorvido + v_pct;
      v_valor_absorvido := v_valor_absorvido + v_valor;
      v_beneficiarios := v_beneficiarios || jsonb_build_object(
        'papel', v_papel, 'id', v_item->'id', 'nivel', v_nivel,
        'pct', 0, 'valor', 0, 'cortado', 0
      );
    ELSE
      v_beneficiarios := v_beneficiarios || jsonb_build_object(
        'papel', v_papel, 'id', v_item->'id', 'nivel', v_nivel,
        'pct', v_pct, 'valor', v_valor, 'cortado', 0
      );
    END IF;
  END LOOP;

  -- F4: pct e valor da B2W sao sempre o TOTAL que ela recebe.
  v_valor_b2w := v_valor_b2w + v_valor_absorvido;
  v_pct_b2w   := v_pct_b2w + v_pct_absorvido;

  -- a cota de usina sem dono entra no bruto pela lista de beneficiarios
  SELECT v_valor_b2w + COALESCE(SUM((b->>'valor')::numeric), 0)
    INTO v_total_bruto
    FROM jsonb_array_elements(v_beneficiarios) b;

  -- trava anti-deficit: corta na ordem originador_usina -> lider_originador_usina
  -- -> assinante_conect -> parceiro -> lider. B2W nunca e alvo do corte.
  IF v_total_bruto > p_teto_deducao THEN
    v_excesso := v_total_bruto - p_teto_deducao;

    SELECT array_agg(elem ORDER BY ord)
      INTO v_arr
      FROM jsonb_array_elements(v_beneficiarios) WITH ORDINALITY AS t(elem, ord);

    FOR v_cat IN SELECT unnest(ARRAY['originador_usina', 'lider_originador_usina', 'assinante_conect', 'parceiro', 'lider'])
    LOOP
      EXIT WHEN v_excesso <= 0;

      FOR v_idx IN 1 .. COALESCE(array_length(v_arr, 1), 0)
      LOOP
        EXIT WHEN v_excesso <= 0;

        v_papel := v_arr[v_idx] ->> 'papel';
        CONTINUE WHEN NOT (
          (v_cat = 'originador_usina'       AND v_papel = 'originador_usina') OR
          (v_cat = 'lider_originador_usina' AND v_papel = 'lider_originador_usina') OR
          (v_cat = 'assinante_conect'       AND v_papel = 'assinante_conect') OR
          (v_cat = 'parceiro'               AND v_papel IN ('ppe', 'ppp', 'ppf')) OR
          (v_cat = 'lider'                  AND v_papel = 'lider')
        );

        v_valor_atual := (v_arr[v_idx] ->> 'valor')::numeric;
        CONTINUE WHEN v_valor_atual <= 0;

        v_cut := LEAST(v_valor_atual, v_excesso);
        v_cortado_atual := (v_arr[v_idx] ->> 'cortado')::numeric + v_cut;

        v_arr[v_idx] := jsonb_set(
          jsonb_set(v_arr[v_idx], '{valor}', to_jsonb(v_valor_atual - v_cut)),
          '{cortado}', to_jsonb(v_cortado_atual)
        );

        v_excesso        := v_excesso - v_cut;
        v_corte_aplicado := v_corte_aplicado + v_cut;
      END LOOP;
    END LOOP;

    SELECT jsonb_agg(elem ORDER BY ord)
      INTO v_beneficiarios
      FROM unnest(v_arr) WITH ORDINALITY AS t(elem, ord);
  END IF;

  -- Decisao 12: o que sobrou da cota de usina sem dono vai a B2W. O total
  -- nao muda (sai da lista e entra na B2W); o beneficiario fica com valor 0
  -- e registra em absorvido_b2w quanto foi para a associacao.
  SELECT array_agg(elem ORDER BY ord)
    INTO v_arr
    FROM jsonb_array_elements(v_beneficiarios) WITH ORDINALITY AS t(elem, ord);

  FOR v_idx IN 1 .. COALESCE(array_length(v_arr, 1), 0)
  LOOP
    CONTINUE WHEN NOT COALESCE((v_arr[v_idx] ->> 'para_b2w')::boolean, false);

    v_resto := (v_arr[v_idx] ->> 'valor')::numeric;
    IF v_resto > 0 THEN
      v_pct_resto := CASE WHEN (v_arr[v_idx] ->> 'cortado')::numeric = 0
                          THEN (v_arr[v_idx] ->> 'pct')::numeric
                          ELSE round((v_arr[v_idx] ->> 'pct')::numeric * v_resto
                                     / (v_resto + (v_arr[v_idx] ->> 'cortado')::numeric), 4) END;
      v_valor_absorvido := v_valor_absorvido + v_resto;
      v_pct_absorvido   := v_pct_absorvido + v_pct_resto;
      v_valor_b2w       := v_valor_b2w + v_resto;
      v_pct_b2w         := v_pct_b2w + v_pct_resto;
    END IF;

    v_arr[v_idx] := (v_arr[v_idx] - 'para_b2w')
                    || jsonb_build_object('pct', 0, 'valor', 0, 'absorvido_b2w', v_resto);
  END LOOP;

  v_beneficiarios := COALESCE(
    (SELECT jsonb_agg(elem ORDER BY ord) FROM unnest(v_arr) WITH ORDINALITY AS t(elem, ord)),
    '[]'::jsonb);

  v_total_deduzido := v_total_bruto - v_corte_aplicado;
  v_teto_estourado := (v_total_deduzido > p_teto_deducao);

  RETURN jsonb_build_object(
    'b2w', jsonb_build_object(
      'pct', v_pct_b2w,
      'valor', v_valor_b2w,
      'pct_absorvido', v_pct_absorvido,
      'valor_absorvido', v_valor_absorvido
    ),
    'beneficiarios', v_beneficiarios,
    'total_deduzido', v_total_deduzido,
    'corte_aplicado', v_corte_aplicado,
    'fornecedor', p_base - v_total_deduzido,
    'teto_estourado', v_teto_estourado
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. handle_invoice_paid_ledger: conta, rotulo, Start e versao
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    d := pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider', 'originador_usina') THEN$de$,
         $para$ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider', 'originador_usina', 'lider_originador_usina') THEN$para$),
        ($de$WHEN 'originador_usina' THEN 'Originador da Usina'$de$,
         $para$WHEN 'originador_usina' THEN 'Originador da Usina'
                                      WHEN 'lider_originador_usina' THEN 'Líder do Originador da Usina'$para$),
        ($de$AND v_ben_papel <> 'originador_usina'$de$,
         $para$AND v_ben_papel NOT IN ('originador_usina', 'lider_originador_usina')$para$),
        ($de$ELSIF v_papel_key = 'originador_usina' THEN$de$,
         $para$ELSIF v_papel_key IN ('originador_usina', 'lider_originador_usina') THEN$para$),
        ($de$'originador_usina', v_matriz -> 'originador_usina');$de$,
         $para$v_papel_key, v_matriz -> v_papel_key);$para$),
        ($de$'originador_usina', v_matriz -> 'originador_usina'));$de$,
         $para$'originador_usina', v_matriz -> 'originador_usina',
                    'lider_originador_usina', v_matriz -> 'lider_originador_usina'));$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    v_n := (length(d) - length(replace(d, '''20261006g_originador_usina''', '')))
           / length('''20261006g_originador_usina''');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger: versao achada % vezes (esperado 2)', v_n;
    END IF;
    d := replace(d, '''20261006g_originador_usina''', '''20261010_plano_usina_adendo''');

    EXECUTE d;
END
$patch$;
```

A 5ª âncora (`... 'originador_usina');`, terminada em `);`) é a da fatura do Start, dentro do `FOR v_papel_key`; a 6ª (terminada em `));`) é a do plano start fora da janela. Uma não contém a outra. Se alguma âncora não for achada exatamente uma vez, o `RAISE` aborta a migração inteira (ela roda numa transação) e nada é aplicado: reporte a âncora e o trecho vivo correspondente (`pg_get_functiondef`).

- [ ] **Step 3: Aplicar** — `apply_migration` com nome `20261010b_lider_originador_cota_orfa`. Expected: sucesso. Se uma trava de md5 ou âncora estourar, **pare e reporte** verbatim.

- [ ] **Step 4: GREEN** — cole `plano_usina.test.sql`. Expected: `ERROR: P0001: SANDBOX_OK`.

- [ ] **Step 5: Regressão do motor** — cole, do disco: `split_motor`, `split_motor_guardas`, `split_motor_uma_por_categoria`, `split_participantes` (2 blocos), `split_gatilho`, `split_bonus_start`, `split_piso_tarifa_bruta`. Expected: `SANDBOX_OK` em todas, sem mudar número.

- [ ] **Step 6: Razão e md5 novos**

```sql
SELECT proname, md5(prosrc) FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('fn_participantes_recompensa','fn_calcular_split_recompensa','handle_invoice_paid_ledger','fn_regras_recompensa_uc')
 ORDER BY 1;
```

Anote no relatório junto com a impressão digital do razão.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261010b_lider_originador_cota_orfa.sql supabase/tests/plano_usina.test.sql
git commit -m "feat(plano-usina): Lider do originador da usina recebe; cota de usina sem dono so vai a B2W se couber

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Trava de versão no plano de assinatura

**Files:**
- Create: `supabase/migrations/20261010c_trava_plano_assinatura.sql`
- Create: `supabase/tests/plano_assinatura_versao.test.sql`
- Modify: `supabase/tests/split_gatilho.test.sql` (caso 1, congelamento)

**Interfaces:**
- Consumes: `planos_assinatura_energia`, `consumer_units.plano_assinatura_id`, `eletropostos.plano_id`, `planos_distribuidoras(plano_id, concessionaria, created_at)`, `public.fn_eh_admin()`.
- Produces: colunas `planos_assinatura_energia.status text NOT NULL DEFAULT 'ativo'` (`ativo` | `somente_contratos`) e `substitui_plano_id uuid`; gatilho `tr_planos_assinatura_trava`; gatilhos `tr_consumer_units_plano_ativo` e `tr_eletropostos_plano_ativo`; RPCs `public.fn_planos_assinatura_nova_versao(p_origem uuid, p_dados jsonb) RETURNS uuid` e `public.fn_planos_assinatura_mover_ucs(p_de uuid, p_para uuid) RETURNS integer` (SECURITY INVOKER, `authenticated`). A mensagem de recusa da trava contém o texto `nova versao` (a tela da Task 16 detecta por ele).

- [ ] **Step 1: Teste (RED)** — `supabase/tests/plano_assinatura_versao.test.sql`:

```sql
-- Teste: trava de versao do plano de assinatura (spec 2026-10-06, secao 6, decisao 17).
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).
DO $$
DECLARE
    c_matriz constant jsonb := '{
      "b2w":   {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
      "ppe":   {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2}
    }'::jsonb;
    v_livre   uuid;
    v_plano   uuid;
    v_novo    uuid;
    v_sub     uuid;
    v_uc      uuid;
    v_uc2     uuid;
    v_row     public.planos_assinatura_energia;
    v_n       integer;
    v_msg     text;
    v_pegou   boolean;
BEGIN
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config)
    VALUES ('SANDBOX PV livre', 'recorrente', 10, 50, 20, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_livre;
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config)
    VALUES ('SANDBOX PV', 'recorrente', 10, 50, 20, jsonb_build_object('regras_multinivel', c_matriz, 'lastro_tarifario', '{"tarifa_bruta": 1.0}'::jsonb))
    RETURNING id INTO v_plano;
    INSERT INTO public.planos_distribuidoras (plano_id, concessionaria) VALUES (v_plano, 'SANDBOX PV conc');

    -- V0 -- colunas novas com default
    SELECT * INTO v_row FROM public.planos_assinatura_energia WHERE id = v_plano;
    IF v_row.status <> 'ativo' OR v_row.substitui_plano_id IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA V0: plano novo devia nascer ativo e sem substitui_plano_id: %', row_to_json(v_row);
    END IF;

    -- V1 -- sem UC, numero muda livre
    UPDATE public.planos_assinatura_energia SET desconto_assinante = 18 WHERE id = v_livre;

    -- fixture: uma UC no plano
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pv/1') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id)
    VALUES (v_sub, 'beneficiaria', 'ativo', v_plano) RETURNING id INTO v_uc;

    -- V2 -- com UC: desconto, piso, matriz e Start recusados pedindo nova versao
    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia SET desconto_assinante = 15 WHERE id = v_plano;
    EXCEPTION WHEN check_violation THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%nova versao%' THEN
        RAISE EXCEPTION 'FALHA V2: desconto de plano com UC devia ser recusado pedindo nova versao (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia SET piso_fornecedor_pct = 45 WHERE id = v_plano;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V2: piso de plano com UC devia ser recusado'; END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia
           SET recorrente_config = jsonb_set(recorrente_config, '{regras_multinivel,ppe,niveis,L1}', '"6"')
         WHERE id = v_plano;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V2: matriz de plano com UC devia ser recusada'; END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia SET start_config = '{"faturas_elegiveis": [2]}'::jsonb WHERE id = v_plano;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V2: start_config de plano com UC devia ser recusado'; END IF;

    -- V3 -- nome, ativo e metadados (lastro_tarifario) passam
    UPDATE public.planos_assinatura_energia
       SET nome = 'SANDBOX PV renomeado', ativo = true,
           recorrente_config = jsonb_set(recorrente_config, '{lastro_tarifario}', '{"tarifa_bruta": 1.1}'::jsonb)
     WHERE id = v_plano;

    -- V4 -- nova versao: nasce ativa com substitui_plano_id, herda o que nao veio,
    --       copia as distribuidoras; a antiga vira somente_contratos e mantem a UC.
    v_novo := public.fn_planos_assinatura_nova_versao(v_plano, jsonb_build_object('desconto_assinante', 15));
    SELECT * INTO v_row FROM public.planos_assinatura_energia WHERE id = v_novo;
    IF v_row.status <> 'ativo' OR v_row.substitui_plano_id IS DISTINCT FROM v_plano
       OR v_row.desconto_assinante <> 15 OR v_row.piso_fornecedor_pct <> 50
       OR v_row.recorrente_config -> 'regras_multinivel' IS DISTINCT FROM c_matriz
       OR v_row.nome <> 'SANDBOX PV renomeado (nova versão)' THEN
        RAISE EXCEPTION 'FALHA V4: nova versao errada: %', row_to_json(v_row);
    END IF;
    SELECT count(*) INTO v_n FROM public.planos_distribuidoras WHERE plano_id = v_novo AND concessionaria = 'SANDBOX PV conc';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA V4: distribuidoras nao foram copiadas (%)', v_n; END IF;
    IF (SELECT status FROM public.planos_assinatura_energia WHERE id = v_plano) <> 'somente_contratos' THEN
        RAISE EXCEPTION 'FALHA V4: o plano antigo devia virar somente_contratos';
    END IF;
    IF (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc) IS DISTINCT FROM v_plano THEN
        RAISE EXCEPTION 'FALHA V4: a UC do plano antigo nao pode mudar sozinha';
    END IF;

    -- V5 -- UC nova so aponta para plano ativo; a UC antiga continua salvando
    v_pegou := false;
    BEGIN
        INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id)
        VALUES (v_sub, 'beneficiaria', 'ativo', v_plano);
    EXCEPTION WHEN check_violation THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%somente para contratos%' THEN
        RAISE EXCEPTION 'FALHA V5: UC nova entrou em plano somente_contratos (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;
    UPDATE public.consumer_units SET numero_uc = 'SANDBOX-PV-1' WHERE id = v_uc;   -- passa

    -- V6 -- mover UCs para a versao nova (admin em lote)
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id)
    VALUES (v_sub, 'beneficiaria', 'ativacao', v_livre) RETURNING id INTO v_uc2;
    v_n := public.fn_planos_assinatura_mover_ucs(v_plano, v_novo);
    IF v_n <> 1 OR (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc) IS DISTINCT FROM v_novo THEN
        RAISE EXCEPTION 'FALHA V6: mover UCs moveu % e a UC esta em %', v_n,
            (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc);
    END IF;
    IF (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc2) IS DISTINCT FROM v_livre THEN
        RAISE EXCEPTION 'FALHA V6: mover UCs tocou UC de outro plano';
    END IF;
    v_pegou := false;
    BEGIN
        PERFORM public.fn_planos_assinatura_mover_ucs(v_novo, v_plano);   -- destino somente_contratos
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V6: mover UCs para plano somente_contratos devia ser recusado'; END IF;

    -- V7 -- seguranca
    IF has_function_privilege('anon', 'public.fn_planos_assinatura_nova_versao(uuid, jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_planos_assinatura_mover_ucs(uuid, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALHA V7: anon executa RPC de versao de plano';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
```

Run: cole. Expected: FAIL com `column "status" does not exist` ou `FALHA V0`. Cole verbatim.

- [ ] **Step 2: Migração** — `supabase/migrations/20261010c_trava_plano_assinatura.sql`:

```sql
-- Trava de versao do plano de assinatura (spec 2026-10-06, secao 6, decisao 17).
-- Plano com UC ou eletroposto vinculado nao muda o que move dinheiro; mudar =
-- nova versao. A antiga fica somente para os contratos que ja estao nela.

ALTER TABLE public.planos_assinatura_energia
    ADD COLUMN status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'somente_contratos')),
    ADD COLUMN substitui_plano_id uuid REFERENCES public.planos_assinatura_energia(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.planos_assinatura_energia.status IS
  'ativo = recebe UC/eletroposto novo; somente_contratos = versao antiga, mantida para as UCs que ja estao nela (fn_planos_assinatura_nova_versao).';

-- 1. Trava
CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF (NEW.desconto_assinante, NEW.tipo_recompensa,
        NEW.start_config -> 'faturas_elegiveis', NEW.start_config -> 'regras',
        NEW.recorrente_config -> 'regras_multinivel', NEW.gestao_percentual,
        NEW.piso_fornecedor_pct, NEW.modalidade, NEW.tarifa_motorista_kwh, NEW.recompensas_ativo)
       IS DISTINCT FROM
       (OLD.desconto_assinante, OLD.tipo_recompensa,
        OLD.start_config -> 'faturas_elegiveis', OLD.start_config -> 'regras',
        OLD.recorrente_config -> 'regras_multinivel', OLD.gestao_percentual,
        OLD.piso_fornecedor_pct, OLD.modalidade, OLD.tarifa_motorista_kwh, OLD.recompensas_ativo)
       AND (EXISTS (SELECT 1 FROM public.consumer_units c WHERE c.plano_assinatura_id = OLD.id)
            OR EXISTS (SELECT 1 FROM public.eletropostos e WHERE e.plano_id = OLD.id))
    THEN
        RAISE EXCEPTION 'O plano "%" ja tem UC ou eletroposto vinculado: desconto, piso, gestao, matriz, Start, tipo e modalidade nao mudam mais. Crie uma nova versao.', OLD.nome
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_planos_assinatura_trava() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_assinatura_trava() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_planos_assinatura_trava
    BEFORE UPDATE ON public.planos_assinatura_energia
    FOR EACH ROW EXECUTE FUNCTION public.fn_planos_assinatura_trava();

-- 2. Vinculo so a plano ativo (UC e eletroposto). Manter o plano atual numa
--    edicao sempre passa: a regra olha so a TROCA.
CREATE OR REPLACE FUNCTION public.fn_consumer_units_plano_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_plano record;
BEGIN
    IF NEW.plano_assinatura_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.plano_assinatura_id IS DISTINCT FROM OLD.plano_assinatura_id) THEN
        SELECT nome, status INTO v_plano FROM public.planos_assinatura_energia WHERE id = NEW.plano_assinatura_id;
        IF v_plano.status <> 'ativo' THEN
            RAISE EXCEPTION 'O plano "%" esta somente para contratos: escolha a versao ativa.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_consumer_units_plano_ativo() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_consumer_units_plano_ativo() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_consumer_units_plano_ativo
    BEFORE INSERT OR UPDATE OF plano_assinatura_id ON public.consumer_units
    FOR EACH ROW EXECUTE FUNCTION public.fn_consumer_units_plano_ativo();

CREATE OR REPLACE FUNCTION public.fn_eletropostos_plano_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_plano record;
BEGIN
    IF NEW.plano_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.plano_id IS DISTINCT FROM OLD.plano_id) THEN
        SELECT nome, status INTO v_plano FROM public.planos_assinatura_energia WHERE id = NEW.plano_id;
        IF v_plano.status <> 'ativo' THEN
            RAISE EXCEPTION 'O plano "%" esta somente para contratos: escolha a versao ativa.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_eletropostos_plano_ativo() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_eletropostos_plano_ativo() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_eletropostos_plano_ativo
    BEFORE INSERT OR UPDATE OF plano_id ON public.eletropostos
    FOR EACH ROW EXECUTE FUNCTION public.fn_eletropostos_plano_ativo();

-- 3. Nova versao (SECURITY INVOKER: a RLS de escrita de planos vale)
CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_nova_versao(p_origem uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_origem public.planos_assinatura_energia;
    v_nova   public.planos_assinatura_energia;
BEGIN
    SELECT * INTO v_origem FROM public.planos_assinatura_energia WHERE id = p_origem FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_planos_assinatura_nova_versao: plano % nao existe', p_origem;
    END IF;

    -- Chave ausente em p_dados herda do plano de origem.
    v_nova := jsonb_populate_record(v_origem,
                COALESCE(p_dados, '{}'::jsonb) - 'id' - 'status' - 'substitui_plano_id' - 'created_at' - 'updated_at');
    v_nova.id                 := gen_random_uuid();
    v_nova.status             := 'ativo';
    v_nova.substitui_plano_id := p_origem;
    v_nova.created_at         := now();
    v_nova.updated_at         := now();
    IF btrim(COALESCE(v_nova.nome, '')) = '' OR v_nova.nome = v_origem.nome THEN
        v_nova.nome := v_origem.nome || ' (nova versão)';
    END IF;

    INSERT INTO public.planos_assinatura_energia SELECT (v_nova).*;

    INSERT INTO public.planos_distribuidoras (plano_id, concessionaria)
    SELECT v_nova.id, d.concessionaria FROM public.planos_distribuidoras d WHERE d.plano_id = p_origem;

    UPDATE public.planos_assinatura_energia SET status = 'somente_contratos' WHERE id = p_origem;
    RETURN v_nova.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_planos_assinatura_nova_versao(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_planos_assinatura_nova_versao(uuid, jsonb) TO authenticated, service_role;

-- 4. Mover UCs e eletropostos de uma versao para outra (so admin)
CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_mover_ucs(p_de uuid, p_para uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_ucs int;
    v_ele int;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
        RAISE EXCEPTION 'So admin move UCs de plano.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (SELECT status FROM public.planos_assinatura_energia WHERE id = p_para) IS DISTINCT FROM 'ativo' THEN
        RAISE EXCEPTION 'O plano de destino precisa estar ativo.' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.consumer_units SET plano_assinatura_id = p_para WHERE plano_assinatura_id = p_de;
    GET DIAGNOSTICS v_ucs = ROW_COUNT;
    UPDATE public.eletropostos SET plano_id = p_para WHERE plano_id = p_de;
    GET DIAGNOSTICS v_ele = ROW_COUNT;
    RETURN v_ucs + v_ele;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_planos_assinatura_mover_ucs(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_planos_assinatura_mover_ucs(uuid, uuid) TO authenticated, service_role;
```

- [ ] **Step 3: Aplicar** — `apply_migration` com nome `20261010c_trava_plano_assinatura`.

- [ ] **Step 4: GREEN** — cole `plano_assinatura_versao.test.sql`. Expected: `SANDBOX_OK`.

- [ ] **Step 5: Adaptar o caso 1 do `split_gatilho`**

O caso 1 muda o plano **depois** de vinculado para provar que o congelamento não é reescrito; a trava agora recusa. Envolva os dois `UPDATE public.planos_assinatura_energia` do caso 1 com a trava desligada só nesta transação:

```sql
    -- a trava de versao (20261010c) recusaria mexer no plano com UC; aqui o
    -- ponto e provar o congelamento, entao ela e desligada SO nesta transacao
    -- (some no rollback do SANDBOX_OK).
    ALTER TABLE public.planos_assinatura_energia DISABLE TRIGGER tr_planos_assinatura_trava;
```

antes do primeiro `UPDATE`, e `ALTER TABLE public.planos_assinatura_energia ENABLE TRIGGER tr_planos_assinatura_trava;` depois do segundo. Procure no `supabase/tests/` outro `UPDATE public.planos_assinatura_energia` em plano com UC (`grep -n "UPDATE public.planos_assinatura_energia" supabase/tests/*.sql`) e aplique o mesmo tratamento, com o mesmo comentário.

- [ ] **Step 6: Regressão** — cole do disco: `split_gatilho`, `planos_escrita_so_admin`, `eletropostos`, `plano_usina`. Expected: `SANDBOX_OK` em todas.

- [ ] **Step 7: Razão** — consulta de Global Constraints.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261010c_trava_plano_assinatura.sql supabase/tests/plano_assinatura_versao.test.sql supabase/tests/split_gatilho.test.sql
git commit -m "feat(planos): trava de versao no plano de assinatura; UC/eletroposto novo so em plano ativo; mover UCs em lote

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Originador copiado do lead

**Files:**
- Create: `supabase/migrations/20261010d_originador_do_lead.sql`
- Modify: `supabase/tests/plano_usina.test.sql` (casos F1–F3)
- Modify: `src/pages/dashboards/LeadsList.jsx` (prop do `SupplierModal`)

**Interfaces:**
- Consumes: `suppliers.lead_id`, `leads.originator_id`, `fn_suppliers_originador_admin` (20261006e).
- Produces: gatilho `tr_suppliers_originador_admin` passa a disparar em `INSERT OR UPDATE OF originator_id, lead_id` e preenche `originator_id` a partir do lead.

- [ ] **Step 1: Casos (RED)** — acima da linha marcada em `plano_usina.test.sql`. Use um usuário interno **não admin** (`manager`), criado como em `split_anon_sem_cargo.test.sql` (`INSERT INTO auth.users ...; UPDATE public.profiles SET role = 'manager' WHERE id = ...`). Para o lead, leia os campos obrigatórios em `supabase/tests/lead_publico_unico.test.sql` e insira o mínimo.

```sql
    DECLARE
        v_mgr   uuid := gen_random_uuid();
        v_lead  uuid;
        v_orig1 uuid;
        v_orig2 uuid;
        v_forn  uuid;
    BEGIN
        INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
        VALUES (v_mgr, 'mgr.pu.lead@teste.invalid', '{"name":"Mgr"}', 'authenticated', 'authenticated');
        UPDATE public.profiles SET role = 'manager' WHERE id = v_mgr;

        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU orig do lead', 'ppf', true) RETURNING id INTO v_orig1;
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU outro orig', 'ppf', true) RETURNING id INTO v_orig2;
        -- ajuste as colunas obrigatorias de leads conforme lead_publico_unico.test.sql
        INSERT INTO public.leads (name, originator_id) VALUES ('SANDBOX PU lead', v_orig1) RETURNING id INTO v_lead;

        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);

        -- F1 -- fornecedor nasce do lead sem originador: o banco copia o do lead
        INSERT INTO public.suppliers (name, lead_id) VALUES ('SANDBOX PU forn do lead', v_lead) RETURNING id INTO v_forn;
        IF (SELECT originator_id FROM public.suppliers WHERE id = v_forn) IS DISTINCT FROM v_orig1 THEN
            RAISE EXCEPTION 'FALHA F1: originador do lead nao foi copiado';
        END IF;

        -- F2 -- nao admin mandando o MESMO originador do lead: passa
        INSERT INTO public.suppliers (name, lead_id, originator_id) VALUES ('SANDBOX PU forn do lead 2', v_lead, v_orig1);

        -- F3 -- nao admin mandando OUTRO originador: recusado
        v_pegou := false;
        BEGIN
            INSERT INTO public.suppliers (name, lead_id, originator_id) VALUES ('SANDBOX PU forn do lead 3', v_lead, v_orig2);
        EXCEPTION WHEN insufficient_privilege THEN v_pegou := true;
        END;
        PERFORM set_config('request.jwt.claims', '', true);
        IF NOT v_pegou THEN
            RAISE EXCEPTION 'FALHA F3: nao admin gravou originador diferente do lead';
        END IF;
    END;
```

Se a RLS de `suppliers` recusar o INSERT do `manager` antes do gatilho (erro `42501` de política, não a mensagem "So admin define o originador"), troque `set_config('request.jwt.claims', ...)` por `set_config('role', 'authenticated', true)` + claims, como em `split_cargos_arvore.test.sql`, e confirme qual papel interno a RLS de `suppliers` aceita para INSERT; registre no relatório.

Run: cole. Expected: FAIL em `FALHA F1: originador do lead nao foi copiado`.

- [ ] **Step 2: Migração** — `supabase/migrations/20261010d_originador_do_lead.sql`:

```sql
-- Originador copiado do lead, no servidor (spec 2026-10-06, secao 6, decisao 15).
-- Fornecedor criado (ou atualizado) com lead_id e sem originador recebe o
-- originador do lead. A trava "so admin altera" aceita esse valor.

CREATE OR REPLACE FUNCTION public.fn_suppliers_originador_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_do_lead uuid;
BEGIN
    IF NEW.lead_id IS NOT NULL THEN
        SELECT l.originator_id INTO v_do_lead FROM public.leads l WHERE l.id = NEW.lead_id;
    END IF;

    -- copia so quando o fornecedor ainda nao tinha originador
    IF NEW.originator_id IS NULL AND v_do_lead IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.originator_id IS NULL) THEN
        NEW.originator_id := v_do_lead;
    END IF;

    IF ((TG_OP = 'INSERT' AND NEW.originator_id IS NOT NULL)
        OR (TG_OP = 'UPDATE' AND NEW.originator_id IS DISTINCT FROM OLD.originator_id))
       AND NEW.originator_id IS DISTINCT FROM v_do_lead
       AND auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
        RAISE EXCEPTION 'So admin define o originador do fornecedor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER tr_suppliers_originador_admin ON public.suppliers;
CREATE TRIGGER tr_suppliers_originador_admin
    BEFORE INSERT OR UPDATE OF originator_id, lead_id ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.fn_suppliers_originador_admin();

-- fornecedores que ja vieram de lead e ainda estao sem originador
UPDATE public.suppliers s
   SET originator_id = l.originator_id
  FROM public.leads l
 WHERE l.id = s.lead_id
   AND l.originator_id IS NOT NULL
   AND s.originator_id IS NULL;
```

- [ ] **Step 3: Aplicar** — `apply_migration` com nome `20261010d_originador_do_lead`. Anote quantos fornecedores o `UPDATE` final alcançou (`SELECT count(*) FROM suppliers WHERE originator_id IS NOT NULL` antes e depois).

- [ ] **Step 4: GREEN** — cole `plano_usina.test.sql`. Expected: `SANDBOX_OK`.

- [ ] **Step 5: Tela** — em `src/pages/dashboards/LeadsList.jsx` (CRLF, por script com âncora única), no objeto passado como `supplier` ao `SupplierModal`, troque

```
                        lead_id: leadToConvert.id,
```

por

```
                        lead_id: leadToConvert.id,
                        // o banco copia o originador do lead (20261010d); aqui
                        // ele so aparece na tela desde a abertura do modal
                        originator_id: leadToConvert.originator_id,
```

A âncora aparece também no `SubscriberModal`? Não: lá é `originator_id: leadToConvert.originator_id` e `id: null`. Confirme que `lead_id: leadToConvert.id,` ocorre **uma** vez. Rode `npx esbuild src/pages/dashboards/LeadsList.jsx --loader:.jsx=jsx --outdir=<scratchpad>/esb` e `npx eslint src/pages/dashboards/LeadsList.jsx` (sem erro novo).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261010d_originador_do_lead.sql supabase/tests/plano_usina.test.sql src/pages/dashboards/LeadsList.jsx
git commit -m "feat(plano-usina): fornecedor criado do lead herda o originador no servidor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Telas do plano de usina sem plano de recompensas e com o Líder do originador

**Files:**
- Modify: `src/lib/planoUsina.js`, `tests/plano-usina.test.js`
- Modify: `src/pages/settings/components/PlanoUsinaModal.jsx`, `PlanosUsinaLista.jsx`, `UsinasPlanosTab.jsx`, `src/pages/settings/PlansServicesSettings.jsx`, `src/components/PowerPlantModal.jsx`

**Interfaces:**
- Consumes: colunas da Task 10.
- Produces: `CAMPOS_PLANO_USINA` com a entrada `originador_lider_recorrente_pct`; `PLANO_USINA_VAZIO` sem `plano_assinatura_id` e com `originador_lider_recorrente_pct: 0`; `payloadPlanoUsina` sem `plano_assinatura_id`; `planoAceitaUsina(plano) => !!plano && plano.status === 'ativo'`; `PlanoUsinaModal` e `PlanosUsinaLista` sem a prop `planosRecompensa`.

- [ ] **Step 0: Junction do `node_modules`** — na raiz do worktree, com PowerShell:

```powershell
New-Item -ItemType Junction -Path node_modules -Target "C:\Users\Godoy\Documents\HTML\WorkSpace 1 Antigravity\node_modules"
```

(Fica até a Task 17, que o remove com `cmd //c rmdir node_modules`. Nunca rode `git worktree remove` com ele no lugar.)

- [ ] **Step 1: Testes (RED)** — em `tests/plano-usina.test.js`:
  - no objeto `PLANO` do topo, troque `plano_assinatura_id: 'rec1'` por `originador_lider_recorrente_pct: 1`;
  - na asserção da lista `CAMPOS_TRAVADOS` (linha com `'originador_recorrente_pct', 'originador_bonus_fechamentos', 'plano_assinatura_id'`), troque por `'originador_recorrente_pct', 'originador_lider_recorrente_pct', 'originador_bonus_fechamentos'` e mantenha a ordem que `CAMPOS_TRAVADOS` passará a ter (entradas de `CAMPOS_PLANO_USINA` na ordem do array, depois `originador_bonus_fechamentos`);
  - no objeto esperado de `PLANO_USINA_VAZIO`, troque `plano_assinatura_id: null` por `originador_lider_recorrente_pct: 0`;
  - apague `expect(r.plano_assinatura_id).toBe('rec1');` e a parte de `payloadPlanoUsina` que testa `plano_assinatura_id` (`plano_assinatura_id: ''` na entrada e `expect(p.plano_assinatura_id).toBeNull();`), e acrescente `expect(p).not.toHaveProperty('plano_assinatura_id');` e `expect(p.originador_lider_recorrente_pct).toBe(1);`;
  - o teste `so plano ativo com plano de recompensas aceita usina` vira:

```js
    test('plano de usina ativo aceita usina, com ou sem regra de originador', () => {
        expect(planoAceitaUsina(PLANO)).toBe(true);
        expect(planoAceitaUsina({ ...PLANO, status: 'somente_contratos' })).toBe(false);
        expect(planoAceitaUsina({ ...PLANO, originador_recorrente_pct: 0 })).toBe(true);
        expect(planoAceitaUsina(null)).toBe(false);
    });
```

  - acrescente um teste do campo novo:

```js
    test('o % do Lider do originador e campo do plano, travado e validado', () => {
        const campo = CAMPOS_PLANO_USINA.find(c => c.chave === 'originador_lider_recorrente_pct');
        expect(campo).toMatchObject({ contrato: null, gestao: null, max: 100 });
        expect(CAMPOS_TRAVADOS).toContain('originador_lider_recorrente_pct');
        expect(validarPlanoUsina({ ...PLANO, originador_lider_recorrente_pct: 101 }).join(' ')).toMatch(/Líder do originador/);
    });
```

Run: `npx vitest run tests/plano-usina.test.js` — Expected: FAIL (campo inexistente, `plano_assinatura_id` presente).

- [ ] **Step 2: `src/lib/planoUsina.js`**
  - em `CAMPOS_PLANO_USINA`, depois da entrada `originador_recorrente_pct`, acrescente
    `{ chave: 'originador_lider_recorrente_pct', rotulo: 'Líder do originador — recorrente (%)', contrato: null, gestao: null, max: 100 }`;
  - `CAMPOS_TRAVADOS` = `[...CAMPOS_PLANO_USINA.map(c => c.chave), 'originador_bonus_fechamentos']`;
  - `PLANO_USINA_VAZIO`: tire `plano_assinatura_id: null`, ponha `originador_lider_recorrente_pct: 0` depois de `originador_recorrente_pct: 0`;
  - `payloadPlanoUsina`: tire a linha `plano_assinatura_id: dados.plano_assinatura_id || null`;
  - `planoAceitaUsina`: `export const planoAceitaUsina = (plano) => !!plano && plano.status === 'ativo';` com o comentário `/** Mesma regra de fn_usinas_vinculo_plano_usina (20261010a): basta estar ativo. */`;
  - no comentário do topo, acrescente: "Desde 10/10/2026 o plano de usina não aponta para plano de assinatura: as recompensas de quem está ligado ao assinante vêm do plano da UC."

Run: `npx vitest run tests/plano-usina.test.js` — Expected: PASS.

- [ ] **Step 3: Telas** (todas CRLF; por script com âncora única; procure cada ponto com `grep -n`)
  - `PlanoUsinaModal.jsx`: tire a prop `planosRecompensa`, `recompensasSel`, `descontoDiverge`, o bloco do `<label>Plano de recompensas</label>` com o `<select>` e o aviso de desconto divergente (linhas ~42–45, ~124–145). O texto da trava (linha ~108) passa a "percentuais e valores não mudam mais". O campo `originador_lider_recorrente_pct` deve aparecer no bloco "Originador da usina", ao lado do `originador_recorrente_pct`, com a nota "Sem Líder válido e ativo no originador do fornecedor, essa parte fica para a associação se couber no teto." Se o modal renderiza os campos de `CAMPOS_PLANO_USINA` por grupo, inclua a chave nova no grupo do originador; se renderiza um a um, acrescente o input igual ao do `originador_recorrente_pct`.
  - `PlanosUsinaLista.jsx`: tire a prop `planosRecompensa`, `nomeRecompensas` e a coluna "Recompensas" (cabeçalho e célula ~93–94); a célula passa a mostrar `Originador {pct}% · Líder {pct}%`. O subtítulo (linha ~42) vira "Gestão B2W, termos do contrato e recompensa do originador do fornecedor". Tire `planosRecompensa={planosRecompensa}` do `PlanoUsinaModal` (linha ~128).
  - `UsinasPlanosTab.jsx`: no rótulo da opção (linha ~139) tire o ramo `!p.plano_assinatura_id ? ' (sem plano de recompensas)'`; os textos de confirmação (linhas ~72–73) passam a: vincular → "A partir de agora, toda fatura paga das UCs {alvo} lança a gestão B2W e a recompensa do originador do fornecedor pelo plano de usina; as recompensas do assinante seguem o plano de cada UC. Faturas já lançadas não mudam."; desvincular → "As próximas faturas pagas das UCs {alvo} deixam de lançar a gestão B2W do plano de usina e a recompensa do originador do fornecedor: a gestão volta a sair do plano de cada UC." A nota da linha ~188 vira "Usina sem plano de usina: a gestão B2W sai do plano de assinatura de cada UC."
  - `PlansServicesSettings.jsx`: a guarda de exclusão (linhas ~145–149) deixa de contar `planos_usina` e passa a contar `consumer_units` (`plano_assinatura_id`) e `eletropostos` (`plano_id`), com a mensagem "Este plano tem N UC(s)/eletroposto(s) vinculado(s) e não pode ser excluído." Tire `planosRecompensa={planosAssinatura}` (linha ~717) se `UsinasPlanosTab`/`PlanosUsinaLista` não usarem mais.
  - `PowerPlantModal.jsx`: na carga dos planos (perto da linha 491) troque `.select('*, planos_assinatura_energia(nome, tipo_recompensa, desconto_assinante)')` por `.select('*')` e ajuste o comentário; no bloco da linha ~4315: tire `const recompensas = ...` e o trecho `{recompensas ? ... : ''}`; o subtítulo vira "Gestão B2W, termos do contrato e recompensa do originador do fornecedor desta usina"; no rótulo da opção (linha ~4334) tire o ramo `!pl.plano_assinatura_id ? ' (sem plano de recompensas)'`; no resumo acrescente `Líder do originador {pct}%` depois do `% recorrente` do originador; a mensagem de "sem plano" (linha ~4351) vira "Ao salvar, a gestão B2W volta a sair do plano de assinatura de cada UC."

- [ ] **Step 4: Verificar**

```bash
git grep -n "plano_assinatura_id" -- src/lib/planoUsina.js src/pages/settings/components/PlanoUsinaModal.jsx src/pages/settings/components/PlanosUsinaLista.jsx src/pages/settings/components/UsinasPlanosTab.jsx src/components/PowerPlantModal.jsx
npx esbuild src/pages/settings/components/PlanoUsinaModal.jsx src/pages/settings/components/PlanosUsinaLista.jsx src/pages/settings/components/UsinasPlanosTab.jsx src/pages/settings/PlansServicesSettings.jsx src/components/PowerPlantModal.jsx --loader:.jsx=jsx --outdir="<scratchpad>/esb"
npx eslint src/lib/planoUsina.js tests/plano-usina.test.js src/pages/settings/components/PlanoUsinaModal.jsx src/pages/settings/components/PlanosUsinaLista.jsx src/pages/settings/components/UsinasPlanosTab.jsx src/pages/settings/PlansServicesSettings.jsx src/components/PowerPlantModal.jsx
npx vitest run tests/plano-usina.test.js
```

Expected: o `git grep` **sem saída**; esbuild `Done`; eslint sem erro novo; vitest PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/planoUsina.js tests/plano-usina.test.js src/pages/settings/components/PlanoUsinaModal.jsx src/pages/settings/components/PlanosUsinaLista.jsx src/pages/settings/components/UsinasPlanosTab.jsx src/pages/settings/PlansServicesSettings.jsx src/components/PowerPlantModal.jsx
git commit -m "feat(plano-usina): telas sem plano de recompensas no plano de usina; Lider do originador

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: UC com plano de assinatura obrigatório e só versão ativa

**Files:**
- Modify: `src/components/ConsumerUnitModal.jsx`

**Interfaces:**
- Consumes: `planos_assinatura_energia.status` (Task 12); gatilhos `tr_consumer_units_plano_obrigatorio` (Task 10) e `tr_consumer_units_plano_ativo` (Task 12).
- Produces: a tela recusa salvar UC não geradora em `ativo`, `em_atraso` ou `em_transf_titularidade` sem plano, com a mesma regra do banco.

- [ ] **Step 1: Carga dos planos** — linha ~262: `.select('id, nome, desconto_assinante')` → `.select('id, nome, desconto_assinante, status')`.

- [ ] **Step 2: Opções do seletor** — no `<select>` de `formData.plano_assinatura_id` (linha ~2562), renderize só `planos.filter(p => p.status === 'ativo' || p.id === formData.plano_assinatura_id)`; a opção do plano atual que for `somente_contratos` mostra o sufixo ` (versão antiga — somente contratos)`. O rótulo do campo ganha ` *`.

- [ ] **Step 3: Validação antes de gravar** — na função que monta o payload (perto da linha 956, `plano_assinatura_id: formData.plano_assinatura_id || null`), antes do `insert`/`update`, acrescente a guarda (use o `showAlert`/`alert` que o arquivo já usa para erros de validação e saia da função sem gravar):

```js
        // Mesma regra de fn_consumer_units_plano_obrigatorio (20261010a).
        const STATUS_EXIGE_PLANO = ['ativo', 'em_atraso', 'em_transf_titularidade'];
        if (!formData.plano_assinatura_id
            && formData.tipo_unidade !== 'geradora'
            && STATUS_EXIGE_PLANO.includes(formData.status)) {
            showAlert('Escolha o plano de assinatura da UC antes de colocá-la em operação.', 'error');
            return;
        }
```

Confirme o nome real do estado (`formData.status`, `formData.tipo_unidade`) e da função de alerta no arquivo antes de escrever; se diferirem, use os nomes do arquivo e registre no relatório.

- [ ] **Step 4: Verificar** — `npx esbuild src/components/ConsumerUnitModal.jsx --loader:.jsx=jsx --outdir="<scratchpad>/esb"`; `npx eslint src/components/ConsumerUnitModal.jsx` (sem erro novo contra `git show HEAD:...`); `git diff --stat` só neste arquivo, dezenas de linhas.

- [ ] **Step 5: Commit**

```bash
git add src/components/ConsumerUnitModal.jsx
git commit -m "feat(uc): plano de assinatura obrigatorio na UC em operacao e so versao ativa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Telas de plano de assinatura com versão

**Files:**
- Create: `src/lib/planoAssinaturaVersao.js`, `tests/plano-assinatura-versao.test.js`
- Modify: `src/pages/settings/components/PlanModal.jsx`, `src/pages/settings/components/EletropostoPlanModal.jsx`, `src/pages/settings/PlansServicesSettings.jsx`

**Interfaces:**
- Consumes: RPCs `fn_planos_assinatura_nova_versao(p_origem, p_dados)` e `fn_planos_assinatura_mover_ucs(p_de, p_para)`; mensagem da trava contém `nova versao`.
- Produces: `ehRecusaDeNovaVersao(erro) => boolean`; `textoConfirmaNovaVersao(nome) => string`; `versaoSucessora(planos, plano) => plano|null`.

- [ ] **Step 1: Testes (RED)** — `tests/plano-assinatura-versao.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { ehRecusaDeNovaVersao, textoConfirmaNovaVersao, versaoSucessora } from '../src/lib/planoAssinaturaVersao.js';

describe('versao do plano de assinatura', () => {
    test('reconhece a recusa da trava pelo texto do banco', () => {
        expect(ehRecusaDeNovaVersao({ message: 'O plano "X" ja tem UC ou eletroposto vinculado: ... Crie uma nova versao.' })).toBe(true);
        expect(ehRecusaDeNovaVersao({ message: 'permission denied' })).toBe(false);
        expect(ehRecusaDeNovaVersao(null)).toBe(false);
    });

    test('texto de confirmacao diz que as UCs atuais ficam no plano antigo', () => {
        const t = textoConfirmaNovaVersao('Plano Premium');
        expect(t).toMatch(/Plano Premium/);
        expect(t).toMatch(/nova versão/i);
        expect(t).toMatch(/continuam/i);
    });

    test('acha a versao ativa que substitui o plano', () => {
        const planos = [
            { id: 'a', status: 'somente_contratos', substitui_plano_id: null },
            { id: 'b', status: 'somente_contratos', substitui_plano_id: 'a' },
            { id: 'c', status: 'ativo', substitui_plano_id: 'b' }
        ];
        expect(versaoSucessora(planos, planos[1])?.id).toBe('c');
        expect(versaoSucessora(planos, planos[0])?.id).toBe('c');
        expect(versaoSucessora(planos, planos[2])).toBeNull();
    });
});
```

Run: `npx vitest run tests/plano-assinatura-versao.test.js` — Expected: FAIL (módulo não existe).

- [ ] **Step 2: `src/lib/planoAssinaturaVersao.js`**

```js
/**
 * Versão do plano de assinatura (spec 2026-10-06, seção 6, decisão 17).
 * O banco recusa mudar o que move dinheiro num plano com UC ou eletroposto
 * (fn_planos_assinatura_trava); a tela oferece então a nova versão
 * (fn_planos_assinatura_nova_versao) e, depois, mover as UCs em lote
 * (fn_planos_assinatura_mover_ucs).
 */

/** A recusa da trava sempre pede "nova versao". */
export const ehRecusaDeNovaVersao = (erro) => /nova vers[aã]o/i.test(String(erro?.message ?? ''));

export const textoConfirmaNovaVersao = (nome) =>
    `O plano "${nome}" já tem UC ou eletroposto vinculado e os números dele não mudam mais.\n\n` +
    'Salvar cria uma NOVA VERSÃO com estes valores. As UCs e eletropostos atuais continuam no plano antigo ' +
    '(somente contratos) até um admin movê-los em lote; os novos vão para a versão nova.\n\nContinuar?';

/** Versão ativa no fim da cadeia substitui_plano_id que começa em `plano`. */
export const versaoSucessora = (planos, plano) => {
    let atual = plano;
    const vistos = new Set();
    for (;;) {
        if (!atual || vistos.has(atual.id)) return null;
        vistos.add(atual.id);
        const prox = planos.find(p => p.substitui_plano_id === atual.id);
        if (!prox) return atual.id === plano.id ? null : (atual.status === 'ativo' ? atual : null);
        atual = prox;
    }
};
```

Run: `npx vitest run tests/plano-assinatura-versao.test.js` — Expected: PASS.

- [ ] **Step 3: `PlanModal.jsx`** (CRLF, por script) — no `handleSave`, troque o ramo de edição

```js
            if (planoId) {
                const { error } = await supabase
                    .from('planos_assinatura_energia')
                    .update(payload)
                    .eq('id', planoId);

                if (error) throw error;
            } else {
```

por

```js
            if (planoId) {
                const { error } = await supabase
                    .from('planos_assinatura_energia')
                    .update(payload)
                    .eq('id', planoId);

                if (error) {
                    // Plano com UC/eletroposto: o banco recusa mudar número e
                    // pede nova versão (20261010c). A antiga mantém as UCs.
                    if (!ehRecusaDeNovaVersao(error) || !window.confirm(textoConfirmaNovaVersao(planToEdit.nome))) throw error;
                    const { data: novoId, error: verErr } = await supabase
                        .rpc('fn_planos_assinatura_nova_versao', { p_origem: planoId, p_dados: payload });
                    if (verErr) throw verErr;
                    planoId = novoId;
                }
            } else {
```

e importe `import { ehRecusaDeNovaVersao, textoConfirmaNovaVersao } from '../../../lib/planoAssinaturaVersao';` junto dos outros imports. As distribuidoras logo abaixo já usam `planoId` e passam a gravar na versão nova (a RPC copiou as da antiga; a tela grava as marcadas). A mensagem de sucesso: quando `planoId !== planToEdit?.id` e `planToEdit?.id` existe, `'Nova versão do plano criada. As UCs atuais continuam na versão antiga até serem movidas.'`. Se `planToEdit?.status === 'somente_contratos'`, mostre no topo do modal o aviso "Esta é uma versão antiga (somente contratos). Salvar números cria uma versão nova a partir dela."

- [ ] **Step 4: `EletropostoPlanModal.jsx`** — mesma troca no ramo `if (planToEdit?.id) { ... update ... }` (sem distribuidoras): na recusa, confirmar e chamar a RPC; sucesso "Nova versão do plano de eletroposto criada. Os eletropostos atuais continuam na versão antiga até serem movidos." Mesmo import e mesmo aviso de versão antiga.

- [ ] **Step 5: `PlansServicesSettings.jsx`**
  - a carga dos planos (linhas ~48 e ~130) passa a trazer as contagens: `.select('*, consumer_units(count), eletropostos(count)')`; se o PostgREST recusar o embed por ambiguidade de FK, use `consumer_units!consumer_units_plano_assinatura_id_fkey(count)` e `eletropostos!eletropostos_plano_id_fkey(count)` (confira o nome real das FKs com `select conname from pg_constraint where confrelid = 'public.planos_assinatura_energia'::regclass`);
  - no card/linha de cada plano: selo "Somente contratos" quando `status === 'somente_contratos'`, e "N UC(s)" / "N eletroposto(s)";
  - nos planos `somente_contratos` com UC ou eletroposto e com `versaoSucessora(planos, plano)`, botão **"Mover para a versão nova"** que pede `window.confirm('Mover as N UC(s)/eletroposto(s) de "{antigo}" para "{novo}"? A próxima fatura paga delas já usa a versão nova.')` e chama `supabase.rpc('fn_planos_assinatura_mover_ucs', { p_de: plano.id, p_para: sucessor.id })`, mostra `Movidas: {n}` e recarrega a lista; erro vai para o `showAlert` do arquivo;
  - planos `somente_contratos` saem dos seletores de criação (lead, nova UC) que esta tela alimenta, se houver.

- [ ] **Step 6: Verificar**

```bash
npx esbuild src/pages/settings/components/PlanModal.jsx src/pages/settings/components/EletropostoPlanModal.jsx src/pages/settings/PlansServicesSettings.jsx --loader:.jsx=jsx --outdir="<scratchpad>/esb"
npx eslint src/lib/planoAssinaturaVersao.js tests/plano-assinatura-versao.test.js src/pages/settings/components/PlanModal.jsx src/pages/settings/components/EletropostoPlanModal.jsx src/pages/settings/PlansServicesSettings.jsx
npx vitest run tests/plano-assinatura-versao.test.js tests/plano-usina.test.js tests/plano-matriz.test.js
```

Expected: esbuild `Done`; eslint sem erro novo; vitest PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/planoAssinaturaVersao.js tests/plano-assinatura-versao.test.js src/pages/settings/components/PlanModal.jsx src/pages/settings/components/EletropostoPlanModal.jsx src/pages/settings/PlansServicesSettings.jsx
git commit -m "feat(planos): nova versao do plano de assinatura pela tela e mover UCs em lote

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Verificação final do adendo

**Files:**
- Modify: `.superpowers/sdd/2026-10-06-plano-usina/progress.md` (ignorado pelo git)
- Modify: `C:\Users\Godoy\.claude\projects\C--Users-Godoy-Documents-HTML\memory\crm-indicacao-recorrencia.md`

- [ ] **Step 1: Suítes, do disco, verbatim** — `split_gatilho`, `split_bonus_start`, `split_base_compensada`, `split_conta_receber`, `split_piso_tarifa_bruta`, `invoice_paid_ledger_definer`, `split_plano_fonte`, `split_motor`, `split_motor_guardas`, `split_motor_uma_por_categoria`, `split_participantes` (2 blocos), `split_cargos_arvore`, `split_anon_sem_cargo`, `plano_usina`, `plano_assinatura_versao`, `abatimento_credito_indicacao`, `assinante_conect`, `invoices_pagamento_admin`, `eletropostos`, `planos_escrita_so_admin`. Expected: `ERROR: P0001: SANDBOX_OK` em todas.

- [ ] **Step 2: Estado de produção**

```sql
SELECT count(*) FROM public.planos_usina WHERE nome LIKE 'SANDBOX%';
SELECT count(*) FROM public.planos_assinatura_energia WHERE nome LIKE 'SANDBOX%';
SELECT nome, status FROM public.planos_assinatura_energia ORDER BY nome;
SELECT count(*) FROM public.consumer_units
 WHERE plano_assinatura_id IS NULL AND tipo_unidade IS DISTINCT FROM 'geradora'
   AND status::text IN ('ativo','em_atraso','em_transf_titularidade');
SELECT proname, md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
 ('fn_participantes_recompensa','fn_calcular_split_recompensa','handle_invoice_paid_ledger','fn_regras_recompensa_uc','fn_plano_da_uc',
  'fn_planos_usina_trava','fn_usinas_vinculo_plano_usina','fn_planos_usina_nova_versao','fn_suppliers_originador_admin',
  'fn_consumer_units_plano_obrigatorio','fn_planos_assinatura_trava','fn_consumer_units_plano_ativo','fn_eletropostos_plano_ativo',
  'fn_planos_assinatura_nova_versao','fn_planos_assinatura_mover_ucs') ORDER BY 1;
```

Expected: 0, 0, Premium e Ultra Connect `ativo`, 0; md5 anotados. E a impressão digital do razão.

- [ ] **Step 3: vitest e grep**

```bash
npx vitest run tests/plano-usina.test.js tests/plano-assinatura-versao.test.js tests/plano-matriz.test.js tests/contrato.test.js tests/contrato-paginas.test.js
git grep -n "plano_assinatura_id" -- src
```

O `git grep` só pode mostrar `consumer_units` (ConsumerUnitModal, StandaloneAnalysisModal), a guarda de exclusão de `PlansServicesSettings` e nada de `planos_usina`.

- [ ] **Step 4: Revisão de código** — superpowers:requesting-code-review sobre os commits das Tasks 10–16, com a spec §6 e este plano.

- [ ] **Step 5: Registrar** — no `progress.md`, uma linha por task com commit, migração, md5 e saídas verbatim. Na memória `crm-indicacao-recorrencia.md`, na seção do Plano de Usina: plano de assinatura só na UC e obrigatório (com a exceção das cascatas); papel `lider_originador_usina`; cota de usina sem dono só vai à B2W se couber (primeira cortada); trava de versão do plano de assinatura com `status`/`substitui_plano_id` e as RPCs; originador copiado do lead.

- [ ] **Step 6: Desfazer o junction** — `cmd //c rmdir node_modules` na raiz do worktree.

- [ ] **Step 7: Parar aqui** — sem merge nem push. Reportar ao dono o que entrou, as saídas, os md5 e que a trava do plano de assinatura e a obrigatoriedade já valem em produção (a tela nova só chega com o merge).
