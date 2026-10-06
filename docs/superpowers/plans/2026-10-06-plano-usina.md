# Plano de Usina — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o Plano de Usina (gestão B2W, termos do contrato, plano de recompensas e regra do originador que trouxe a usina), ligá-lo ao motor de split e dar a ele telas de criar/editar/versionar e de vincular usinas.

**Architecture:** Tabela nova `planos_usina` com trava de versão no banco; `usinas` ganha `plano_usina_id` e `originador_id` e perde `plano_assinatura_id`. O motor resolve UC → (plano da UC ou plano de usina) para a matriz e usa `planos_usina.percentual_recorrente` como gestão B2W; o originador da usina vira o papel `originador_usina`, primeiro da ordem de corte. As funções do motor que foram alteradas direto no banco são patchadas sobre o corpo vivo, com trava de md5.

**Tech Stack:** Supabase Postgres (plpgsql, RLS) via MCP `execute_sql`/`apply_migration`; React 18 + Vite; vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-plano-usina-design.md`

## Global Constraints

- Projeto Supabase: `abbysvxnnhwvvzhftoms`. Migração = arquivo em `supabase/migrations/` **e** `apply_migration` com o mesmo nome. Nomes desta branch: `20261006e_planos_usina`, `20261006f_plano_usina_motor`, `20261006g_originador_usina`. **Antes de aplicar**, confirme que o nome não existe: `SELECT name FROM supabase_migrations.schema_migrations WHERE name LIKE '20261006%';` (em 06/10 já existem `a`–`d`, de outra sessão). Se a letra estiver tomada, use a próxima livre e troque o nome no arquivo e no texto de versão.
- Teste SQL = arquivo inteiro num `DO $$ … RAISE EXCEPTION 'SANDBOX_OK'; END $$;`. Sucesso **é** o erro `SANDBOX_OK` (o raise desfaz tudo). Rode **o arquivo do disco**, colando o conteúdo no `execute_sql`; pode tirar só linhas que são **apenas** comentário. Cole no relatório a mensagem de erro **verbatim**. "Passou" sem a mensagem literal não vale (houve dois relatórios falsos de SANDBOX_OK nesta frente: plpgsql só prepara cada SQL na primeira execução).
- Funções SECURITY DEFINER: dona `postgres`, `SET search_path = public, pg_temp`, e `REVOKE ALL … FROM PUBLIC, anon, authenticated` explícito (o `ALTER DEFAULT PRIVILEGES` do Supabase dá EXECUTE a anon/authenticated; `FROM PUBLIC` sozinho não tira).
- Corpos vivos em 06/10/2026 (patch aborta se mudarem): `handle_invoice_paid_ledger` md5(prosrc) `e8efea563e729bf482dedb0a4a71c759`; `fn_participantes_recompensa` `da355ffe5bd41a5e9a017a7f345a333b`; `fn_calcular_split_recompensa` `e7890b3e191d2921801afcfc5e3d51c9`. O gatilho **não** é mais o do arquivo `20260930b`: a sessão do app (`saas-mobile-indicacao`, branch `app-v1.3`) aplicou um `replace` nele em `20261006a_abatimento_credito_indicacao`.
- Razão de produção: o motor novo **já lança dinheiro real** (22 UCs no Plano Premium; 6 faturas lançadas em 06/10). Impressão digital em 06/10 ~18h: 425 lançamentos / 146 transações / soma `-10694.8082347826087400` / 6 faturas com `recompensas_aplicadas`. Antes e depois de cada migração e de cada rodada de teste, rode a consulta da Task 1 Step 1. Mudança entre as duas leituras só é aceitável se vier de fatura real (não `SANDBOX`) — confira, nunca suponha.
- Regras de negócio que valem em todas as tasks (spec, decisões do dono de 06/10/2026):
  - gestão B2W do plano de usina = os 10% da B2W no split (**mesma cobrança**), igual em todos os níveis;
  - plano de recompensas = `COALESCE(consumer_units.plano_assinatura_id, planos_usina.plano_assinatura_id)` — **o da UC tem precedência**;
  - na fatura do Bônus Start o `b2w` do `start_config` continua mandando;
  - `originador_usina`: % e bônus definidos **no plano da usina**; sem originador vinculado ou com originador inativo, a parte **fica para a associação** (B2W); recebe em toda fatura paga, inclusive plano `start`; é o **primeiro** da ordem de corte (`originador_usina → assinante_conect → parceiro → lider`); B2W nunca é cortada;
  - plano com usina vinculada não muda número nem plano de recompensas — mudar = nova versão, e a antiga vira `somente_contratos`;
  - usina só entra em plano `ativo` **com** plano de recompensas;
  - só admin vincula usina a plano de usina ou a originador (`auth.uid()` nulo = service_role/SQL direto, passa).
- Front: `npx vitest run tests/<arquivo>` para testes; lint **só nos arquivos tocados** (`npx eslint <arquivos>` — o lint do repo inteiro estoura memória); checagem de sintaxe com `npx esbuild <arquivo> --loader:.jsx=jsx --outdir=<scratchpad>/esb`.
- O worktree não tem `node_modules`. Crie um junction **uma vez** (Task 4 Step 1) e, ao final, desfaça com `cmd //c rmdir node_modules` **antes** de qualquer `git worktree remove` — o remove atravessa o junction e apaga o `node_modules` do checkout principal.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Não** fazer merge no `main` nem push: a branch `impl/plano-usina` tem merge próprio, quando o dono liberar.
- **Sequência de merge:** depois da Task 2, `usinas.plano_assinatura_id` não existe mais no banco (que é um só para todas as branches). A `impl/split-pagamentos` **sozinha** grava nessa coluna pelo modal da usina e pela aba Usinas — publicada isolada, salvar uma usina passaria a dar erro. Como `impl/plano-usina` nasceu dela e contém todos os commits do split, o que vai para o `main` é a `impl/plano-usina`; a `impl/split-pagamentos` não é mais mergeada sozinha. Diga isso no relatório final.
- Mensagens de erro do banco em português sem acento (padrão do repo); textos de tela com acento.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261006e_planos_usina.sql` (novo) | tabela, RLS, colunas novas em `usinas`, trava de versão, regra de vínculo, RPC de nova versão, plano padrão |
| `supabase/migrations/20261006f_plano_usina_motor.sql` (novo) | resolução das regras via plano de usina, gestão do plano, remoção de `usinas.plano_assinatura_id` |
| `supabase/migrations/20261006g_originador_usina.sql` (novo) | papel `originador_usina` em participantes, motor e gatilho (patch sobre o corpo vivo) |
| `supabase/tests/plano_usina.test.sql` (novo) | todos os casos desta branch |
| `supabase/tests/{split_gatilho,split_bonus_start,split_base_compensada,split_conta_receber,split_piso_tarifa_bruta,invoice_paid_ledger_definer,split_plano_fonte}.test.sql` | fixtures passam a ligar usina via plano de usina |
| `src/lib/planoUsina.js` (novo) | lista única dos campos do plano, mapeamento para o contrato, validação, rascunho de versão |
| `tests/plano-usina.test.js` (novo) | vitest de `planoUsina.js` |
| `src/pages/settings/components/PlanoUsinaModal.jsx` (novo) | criar / editar / nova versão |
| `src/pages/settings/components/PlanosUsinaLista.jsx` (novo) | tabela dos planos de usina na aba Usinas |
| `src/pages/settings/components/UsinasPlanosTab.jsx` | vínculo em lote passa a usar `plano_usina_id` |
| `src/pages/settings/PlansServicesSettings.jsx` | carrega planos de usina, monta a aba, guarda de exclusão do plano de recompensas |
| `src/components/PowerPlantModal.jsx` | seletor do plano de usina, originador da usina, termos do contrato vindos do plano |

---

### Task 1: Dados — `planos_usina`, travas e plano padrão

**Files:**
- Create: `supabase/migrations/20261006e_planos_usina.sql`
- Create: `supabase/tests/plano_usina.test.sql`

**Interfaces:**
- Produces: tabela `public.planos_usina` (colunas da spec §1); `usinas.plano_usina_id uuid`, `usinas.originador_id uuid`; `public.fn_planos_usina_nova_versao(p_origem uuid, p_dados jsonb) RETURNS uuid`; gatilhos `tr_planos_usina_trava` e `tr_usinas_vinculo_plano_usina`; helpers de teste `pg_temp.fatura_paga(p_usina uuid, p_ppe uuid, p_plano_uc uuid) RETURNS uuid` e `pg_temp.contas(p_inv uuid) RETURNS numeric[]` (`[3.1.1, 2.1.2, 2.1.1, soma]`), criados dentro do arquivo de teste.

- [ ] **Step 1: Anotar a impressão digital do razão**

Rode no MCP `execute_sql`:

```sql
SELECT (SELECT count(*) FROM ledger_entries) AS lancamentos,
       (SELECT count(DISTINCT transaction_id) FROM ledger_entries) AS transacoes,
       (SELECT sum(amount) FROM ledger_entries) AS soma,
       (SELECT count(*) FROM invoices WHERE recompensas_aplicadas IS NOT NULL) AS congeladas;
```

Anote os quatro números no relatório. Se mudarem entre duas leituras, liste as transações novas (`SELECT … FROM ledger_entries ORDER BY created_at DESC LIMIT 30`) e confirme que são de faturas reais.

- [ ] **Step 2: Escrever o teste (RED)**

Crie `supabase/tests/plano_usina.test.sql`:

```sql
-- Teste: Plano de Usina (spec docs/superpowers/specs/2026-10-06-plano-usina-design.md).
--
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).
-- Casos novos entram ACIMA da linha marcada no fim do arquivo.
--
-- Fixture comum: concessionaria sandbox com tarifa 1,20 e Fio B 0,20 e planos
-- de recompensas com desconto 0 -> tarifa liquida 1,00/kWh. Toda fatura de
-- pg_temp.fatura_paga tem 1000 kWh compensados, valor 1000 e conta da
-- concessionaria 0: base = caixa = 1000, e a 1.1.2 nao recebe nada.
DO $$
DECLARE
    c_matriz constant jsonb := '{
      "b2w":   {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
      "lider": {"niveis": {"L1": "1",  "L2": "1",  "L3": "1",  "L4": "0"},  "max_niveis": 3},
      "ppe":   {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppp":   {"niveis": {"L1": "4",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppf":   {"niveis": {"L1": "2",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}
    }'::jsonb;

    -- planos de recompensas (planos_assinatura_energia)
    v_rec_plano      uuid;   -- recorrente, piso 50
    v_rec_plano_uc   uuid;   -- recorrente, piso 50 -- o "plano proprio" da UC
    v_rec_piso675    uuid;   -- recorrente, piso 67,5
    v_rec_start      uuid;   -- start, janela [2]
    v_rec_start1     uuid;   -- start, janela [1]
    v_rec_sem_matriz uuid;   -- b2w.niveis null

    -- planos de usina
    v_pu         uuid;
    v_pu_novo    uuid;
    v_pu_sem_rec uuid;
    v_pu2        uuid;
    v_pu3        uuid;
    v_pu_orig    uuid;
    v_pu_corte   uuid;
    v_pu_start   uuid;
    v_pu_start1  uuid;
    v_row        public.planos_usina;

    -- usinas
    v_usina      uuid;
    v_usina2     uuid;
    v_usina3     uuid;
    v_usina4     uuid;
    v_usina_corte uuid;
    v_usina_inat uuid;
    v_usina_sem_orig uuid;
    v_usina_start uuid;
    v_usina_start1 uuid;
    v_usina_matriz uuid;

    -- originadores
    v_lider        uuid;
    v_ppe          uuid;
    v_orig_usina   uuid;
    v_orig_inativo uuid;

    v_sub    uuid;
    v_uc     uuid;
    v_inv    uuid;
    v_contas numeric[];
    v_rec    jsonb;
    v_ben    jsonb;
    v_regras jsonb;
    v_n      integer;
    v_msg    text;
    v_pegou  boolean;
BEGIN
    -- ------------------------------------------------------------------
    -- helpers (somem no rollback do SANDBOX_OK)
    -- ------------------------------------------------------------------
    EXECUTE $h$
      CREATE FUNCTION pg_temp.fatura_paga(p_usina uuid, p_ppe uuid, p_plano_uc uuid)
      RETURNS uuid LANGUAGE plpgsql AS $f$
      DECLARE v_sub uuid; v_uc uuid; v_inv uuid;
      BEGIN
        INSERT INTO public.subscribers (originator_id, status, short_url)
        VALUES (p_ppe, 'ativo', 'sandbox://pu/' || gen_random_uuid()) RETURNING id INTO v_sub;
        INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
        VALUES (v_sub, p_usina, 'consumidora', 'ativo', 'SANDBOX PU conc', '{"uf": "RN"}'::jsonb, p_plano_uc)
        RETURNING id INTO v_uc;
        INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
        VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;
        UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;
        RETURN v_inv;
      END $f$
    $h$;

    EXECUTE $h$
      CREATE FUNCTION pg_temp.contas(p_inv uuid) RETURNS numeric[] LANGUAGE sql AS $f$
        SELECT ARRAY[
          COALESCE(SUM(e.amount) FILTER (WHERE a.code = '3.1.1'), 0),
          COALESCE(SUM(e.amount) FILTER (WHERE a.code = '2.1.2'), 0),
          COALESCE(SUM(e.amount) FILTER (WHERE a.code = '2.1.1'), 0),
          COALESCE(SUM(e.amount), 0)]
          FROM public.ledger_entries e
          JOIN public.ledger_accounts a ON a.id = e.account_id
         WHERE e.transaction_id = (
               SELECT e2.transaction_id FROM public.ledger_entries e2
                 JOIN public.ledger_accounts a2 ON a2.id = e2.account_id
                WHERE e2.reference_id = p_inv AND a2.code = '1.1.1.01' LIMIT 1)
      $f$
    $h$;

    -- ------------------------------------------------------------------
    -- fixture comum
    -- ------------------------------------------------------------------
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBXPU-C1', 'Sandbox Plano Usina', 'SANDBOX PU conc', 'RN', 1.20, 0.20);

    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX PU rec piso50', 'recorrente', 10, 50, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_rec_plano;

    -- ==================================================================
    -- T2 -- seguranca: RLS ligada, 4 politicas, anon sem leitura nem RPC.
    -- ==================================================================
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.planos_usina'::regclass) THEN
        RAISE EXCEPTION 'FALHA T2: planos_usina sem RLS';
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'planos_usina';
    IF v_n <> 4 THEN
        RAISE EXCEPTION 'FALHA T2: esperadas 4 politicas em planos_usina, achei %', v_n;
    END IF;
    IF has_table_privilege('anon', 'public.planos_usina', 'SELECT') THEN
        RAISE EXCEPTION 'FALHA T2: anon le planos_usina';
    END IF;
    IF has_function_privilege('anon', 'public.fn_planos_usina_nova_versao(uuid, jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALHA T2: anon executa fn_planos_usina_nova_versao';
    END IF;

    -- ==================================================================
    -- T3 -- trava de versao: sem usina edita tudo; com usina, numero e plano
    --       de recompensas sao recusados e nome/descricao passam.
    -- ==================================================================
    INSERT INTO public.planos_usina (nome, percentual_recorrente, plano_assinatura_id)
    VALUES ('SANDBOX PU trava', 10, v_rec_plano) RETURNING id INTO v_pu;

    UPDATE public.planos_usina SET percentual_recorrente = 11 WHERE id = v_pu;   -- sem usina: passa

    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu) RETURNING id INTO v_usina;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_usina SET percentual_recorrente = 12 WHERE id = v_pu;
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%nova versao%' THEN
        RAISE EXCEPTION 'FALHA T3: com usina, mudar percentual_recorrente devia ser recusado pedindo nova versao (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_usina SET originador_bonus_fechamentos = '{2}' WHERE id = v_pu;
    EXCEPTION WHEN others THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T3: com usina, mudar originador_bonus_fechamentos devia ser recusado';
    END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_usina SET plano_assinatura_id = NULL WHERE id = v_pu;
    EXCEPTION WHEN others THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T3: com usina, trocar o plano de recompensas devia ser recusado';
    END IF;

    UPDATE public.planos_usina SET nome = 'SANDBOX PU trava renomeado', descricao = 'outra' WHERE id = v_pu;  -- passa

    -- ==================================================================
    -- T4 -- excluir plano com usina e recusado pela FK RESTRICT.
    -- ==================================================================
    v_pegou := false;
    BEGIN
        DELETE FROM public.planos_usina WHERE id = v_pu;
    EXCEPTION WHEN foreign_key_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T4: excluir plano com usina vinculada devia ser recusado';
    END IF;

    -- ==================================================================
    -- T5 -- plano sem plano de recompensas nao recebe usina.
    -- ==================================================================
    INSERT INTO public.planos_usina (nome) VALUES ('SANDBOX PU sem recompensas') RETURNING id INTO v_pu_sem_rec;

    v_pegou := false;
    BEGIN
        INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu_sem_rec);
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%plano de recompensas%' THEN
        RAISE EXCEPTION 'FALHA T5: plano sem plano de recompensas recebeu usina (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- ==================================================================
    -- T6 -- nova versao: nasce ativo com substitui_plano_id, herda o que
    --       nao veio em p_dados; o antigo vira somente_contratos e continua
    --       com a usina dele, mas nao aceita usina nova.
    -- ==================================================================
    v_pu_novo := public.fn_planos_usina_nova_versao(v_pu,
        jsonb_build_object('nome', 'SANDBOX PU trava v2', 'percentual_recorrente', 12));

    SELECT * INTO v_row FROM public.planos_usina WHERE id = v_pu_novo;
    IF v_row.percentual_recorrente <> 12 OR v_row.substitui_plano_id IS DISTINCT FROM v_pu
       OR v_row.status <> 'ativo' OR v_row.plano_assinatura_id IS DISTINCT FROM v_rec_plano
       OR v_row.taxa_admin_reais <> 10 OR v_row.nome <> 'SANDBOX PU trava v2' THEN
        RAISE EXCEPTION 'FALHA T6: nova versao errada: %', row_to_json(v_row);
    END IF;

    SELECT * INTO v_row FROM public.planos_usina WHERE id = v_pu;
    IF v_row.status <> 'somente_contratos' THEN
        RAISE EXCEPTION 'FALHA T6: o plano antigo devia virar somente_contratos, esta %', v_row.status;
    END IF;

    SELECT count(*) INTO v_n FROM public.usinas WHERE id = v_usina AND plano_usina_id = v_pu;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA T6: a usina do plano antigo nao pode mudar de plano sozinha';
    END IF;

    UPDATE public.usinas SET name = 'SANDBOX PU usina' WHERE id = v_usina;   -- outra coluna: passa

    v_pegou := false;
    BEGIN
        INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu);
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%somente para contratos%' THEN
        RAISE EXCEPTION 'FALHA T6: plano somente_contratos recebeu usina nova (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- ==================================================================
    -- T7 -- CHECKs: percentual acima de 100 e fechamento 0 sao recusados.
    -- ==================================================================
    v_pegou := false;
    BEGIN
        INSERT INTO public.planos_usina (nome, percentual_recorrente) VALUES ('SANDBOX PU 101', 101);
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T7: percentual_recorrente 101 foi aceito';
    END IF;

    v_pegou := false;
    BEGIN
        INSERT INTO public.planos_usina (nome, originador_bonus_fechamentos) VALUES ('SANDBOX PU bonus 0', '{0}');
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T7: fechamento 0 no bonus foi aceito';
    END IF;

    -- ==================================================================
    -- T8 -- so admin vincula. Simula um usuario logado que nao e admin.
    -- ==================================================================
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
    v_pegou := false;
    BEGIN
        UPDATE public.usinas SET plano_usina_id = v_pu_novo WHERE id = v_usina;
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_pegou OR v_msg NOT LIKE '%admin%' THEN
        RAISE EXCEPTION 'FALHA T8: usuario nao admin trocou o plano da usina (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- >>> casos novos entram acima desta linha <<<
    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Cole o arquivo no `execute_sql`. Esperado: erro `relation "public.planos_usina" does not exist` (ou equivalente apontando `planos_usina`). Cole a mensagem verbatim.

- [ ] **Step 4: Escrever a migração**

Crie `supabase/migrations/20261006e_planos_usina.sql`:

```sql
-- Plano de Usina -- dados, travas e plano padrao.
-- Spec: docs/superpowers/specs/2026-10-06-plano-usina-design.md (secao 1).
--
-- Decisoes do dono (06/10/2026): o plano reune gestao B2W, termos do
-- contrato de compra e venda, plano de recompensas e a regra do originador
-- que trouxe a usina. Vinculo vivo, mas o plano nao muda numero depois que
-- tem usina: mudou valor, nasce uma versao nova e a antiga fica so para os
-- contratos que ja estao nela.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
CREATE TABLE public.planos_usina (
    id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                         text NOT NULL CHECK (btrim(nome) <> ''),
    descricao                    text,
    percentual_recorrente        numeric NOT NULL DEFAULT 10  CHECK (percentual_recorrente BETWEEN 0 AND 100),
    taxa_admin_reais             numeric NOT NULL DEFAULT 10  CHECK (taxa_admin_reais >= 0),
    taxa_recuperacao_pct         numeric NOT NULL DEFAULT 8   CHECK (taxa_recuperacao_pct BETWEEN 0 AND 100),
    retencao_rescisao_pct        numeric NOT NULL DEFAULT 10  CHECK (retencao_rescisao_pct BETWEEN 0 AND 100),
    multa_atraso_mes_pct         numeric NOT NULL DEFAULT 0.5 CHECK (multa_atraso_mes_pct >= 0),
    multa_atraso_teto_pct        numeric NOT NULL DEFAULT 10  CHECK (multa_atraso_teto_pct >= 0),
    garantia_instalacao_meses    integer NOT NULL DEFAULT 12  CHECK (garantia_instalacao_meses >= 0),
    originador_recorrente_pct    numeric NOT NULL DEFAULT 0   CHECK (originador_recorrente_pct BETWEEN 0 AND 100),
    originador_bonus_fechamentos integer[] NOT NULL DEFAULT '{}'
                                 CHECK (0 < ALL (originador_bonus_fechamentos)
                                        AND array_position(originador_bonus_fechamentos, NULL) IS NULL),
    plano_assinatura_id          uuid REFERENCES public.planos_assinatura_energia(id) ON DELETE RESTRICT,
    status                       text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'somente_contratos')),
    substitui_plano_id           uuid REFERENCES public.planos_usina(id) ON DELETE SET NULL,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX planos_usina_plano_assinatura_id_idx ON public.planos_usina (plano_assinatura_id);

COMMENT ON TABLE public.planos_usina IS
  'Plano de Usina (spec 2026-10-06): gestao B2W (percentual_recorrente = clausula (b) do contrato = os 10% da B2W no split), taxas de administracao e recuperacao (cobradas pelo fechamento mensal), termos do contrato de compra e venda, plano de recompensas e a regra do originador que trouxe a usina. Com usina vinculada, numeros e plano de recompensas nao mudam (fn_planos_usina_trava): mudar = fn_planos_usina_nova_versao.';
COMMENT ON COLUMN public.planos_usina.originador_recorrente_pct IS
  'Percentual recorrente do originador que trouxe a usina (usinas.originador_id), sobre a base de cada fatura paga das UCs dela. Sem originador ou com originador inativo, fica para a associacao (B2W).';
COMMENT ON COLUMN public.planos_usina.originador_bonus_fechamentos IS
  'Ordinais dos fechamentos COM SALDO POSITIVO da usina cujo saldo vai ao originador em vez do fornecedor (ex.: {2}); sem originador, vai para a associacao. Executado pelo fechamento mensal.';

-- ---------------------------------------------------------------------------
-- 2. RLS: leitura para logado, escrita so admin (padrao de planos_assinatura_energia)
-- ---------------------------------------------------------------------------
ALTER TABLE public.planos_usina ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planos_usina FROM anon;

CREATE POLICY planos_usina_leitura_logado ON public.planos_usina
    FOR SELECT TO authenticated USING (true);
CREATE POLICY planos_usina_insere_admin ON public.planos_usina
    FOR INSERT TO authenticated WITH CHECK (public.fn_eh_admin());
CREATE POLICY planos_usina_altera_admin ON public.planos_usina
    FOR UPDATE TO authenticated USING (public.fn_eh_admin()) WITH CHECK (public.fn_eh_admin());
CREATE POLICY planos_usina_apaga_admin ON public.planos_usina
    FOR DELETE TO authenticated USING (public.fn_eh_admin());

-- ---------------------------------------------------------------------------
-- 3. Usina: plano de usina e originador
-- ---------------------------------------------------------------------------
ALTER TABLE public.usinas
    ADD COLUMN plano_usina_id uuid REFERENCES public.planos_usina(id) ON DELETE RESTRICT,
    ADD COLUMN originador_id  uuid REFERENCES public.originators_v2(id) ON DELETE SET NULL;

CREATE INDEX usinas_plano_usina_id_idx ON public.usinas (plano_usina_id);

COMMENT ON COLUMN public.usinas.plano_usina_id IS
  'Plano de Usina. Liga a gestao B2W do split e o plano de recompensas padrao das UCs sem plano proprio.';
COMMENT ON COLUMN public.usinas.originador_id IS
  'Originador que trouxe a usina para o sistema. Recebe o que o plano da usina preve em originador_recorrente_pct e originador_bonus_fechamentos.';

-- ---------------------------------------------------------------------------
-- 4. Trava de versao
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_planos_usina_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF (NEW.percentual_recorrente, NEW.taxa_admin_reais, NEW.taxa_recuperacao_pct,
        NEW.retencao_rescisao_pct, NEW.multa_atraso_mes_pct, NEW.multa_atraso_teto_pct,
        NEW.garantia_instalacao_meses, NEW.originador_recorrente_pct,
        NEW.originador_bonus_fechamentos, NEW.plano_assinatura_id)
       IS DISTINCT FROM
       (OLD.percentual_recorrente, OLD.taxa_admin_reais, OLD.taxa_recuperacao_pct,
        OLD.retencao_rescisao_pct, OLD.multa_atraso_mes_pct, OLD.multa_atraso_teto_pct,
        OLD.garantia_instalacao_meses, OLD.originador_recorrente_pct,
        OLD.originador_bonus_fechamentos, OLD.plano_assinatura_id)
       AND EXISTS (SELECT 1 FROM public.usinas u WHERE u.plano_usina_id = OLD.id)
    THEN
        RAISE EXCEPTION 'O plano de usina "%" ja tem usina vinculada: percentuais, valores e plano de recompensas nao mudam mais. Crie uma nova versao.', OLD.nome
            USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_planos_usina_trava() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_usina_trava() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_planos_usina_trava
    BEFORE UPDATE ON public.planos_usina
    FOR EACH ROW EXECUTE FUNCTION public.fn_planos_usina_trava();

-- ---------------------------------------------------------------------------
-- 5. Regra de vinculo (e quem pode vincular)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_usinas_vinculo_plano_usina()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_plano record;
BEGIN
    -- Ligar ou trocar o split de uma usina move dinheiro: so admin. auth.uid()
    -- nulo e service_role ou SQL direto (migracao, teste) -- passa.
    IF (TG_OP = 'INSERT' AND (NEW.plano_usina_id IS NOT NULL OR NEW.originador_id IS NOT NULL))
       OR (TG_OP = 'UPDATE' AND (NEW.plano_usina_id IS DISTINCT FROM OLD.plano_usina_id
                                 OR NEW.originador_id IS DISTINCT FROM OLD.originador_id)) THEN
        IF auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
            RAISE EXCEPTION 'So admin vincula usina a plano de usina ou a originador.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- A regra olha so a TROCA de plano: usina que ja esta num plano que virou
    -- somente_contratos continua salvando as outras colunas.
    IF NEW.plano_usina_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.plano_usina_id IS DISTINCT FROM OLD.plano_usina_id) THEN
        SELECT nome, status, plano_assinatura_id INTO v_plano
          FROM public.planos_usina WHERE id = NEW.plano_usina_id;
        IF v_plano.status <> 'ativo' THEN
            RAISE EXCEPTION 'O plano de usina "%" esta somente para contratos: escolha um plano ativo.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_plano.plano_assinatura_id IS NULL THEN
            RAISE EXCEPTION 'O plano de usina "%" nao tem plano de recompensas: sem ele a usina ficaria sem gestao B2W no razao.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_usinas_vinculo_plano_usina() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_usinas_vinculo_plano_usina() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_usinas_vinculo_plano_usina
    BEFORE INSERT OR UPDATE OF plano_usina_id, originador_id ON public.usinas
    FOR EACH ROW EXECUTE FUNCTION public.fn_usinas_vinculo_plano_usina();

-- ---------------------------------------------------------------------------
-- 6. Nova versao (SECURITY INVOKER: a RLS de admin vale)
-- ---------------------------------------------------------------------------
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

    -- Chave ausente em p_dados herda do plano de origem.
    INSERT INTO public.planos_usina (
        nome, descricao, percentual_recorrente, taxa_admin_reais, taxa_recuperacao_pct,
        retencao_rescisao_pct, multa_atraso_mes_pct, multa_atraso_teto_pct,
        garantia_instalacao_meses, originador_recorrente_pct, originador_bonus_fechamentos,
        plano_assinatura_id, status, substitui_plano_id)
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
        COALESCE((p_dados ->> 'originador_recorrente_pct')::numeric, v_origem.originador_recorrente_pct),
        CASE WHEN p_dados ? 'originador_bonus_fechamentos'
             THEN COALESCE((SELECT array_agg(x::integer ORDER BY x::integer)
                              FROM jsonb_array_elements_text(p_dados -> 'originador_bonus_fechamentos') x), '{}')
             ELSE v_origem.originador_bonus_fechamentos END,
        CASE WHEN p_dados ? 'plano_assinatura_id'
             THEN NULLIF(p_dados ->> 'plano_assinatura_id', '')::uuid
             ELSE v_origem.plano_assinatura_id END,
        'ativo',
        p_origem)
    RETURNING id INTO v_novo;

    UPDATE public.planos_usina SET status = 'somente_contratos' WHERE id = p_origem;
    RETURN v_novo;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_planos_usina_nova_versao(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_planos_usina_nova_versao(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_planos_usina_nova_versao(uuid, jsonb) IS
  'Cria a versao nova de um plano de usina a partir de p_origem (chave ausente em p_dados herda) e passa o antigo para somente_contratos. As usinas do antigo nao mudam.';

-- ---------------------------------------------------------------------------
-- 7. Plano padrao (decisao 5): valores de DEFAULTS_USINA, sem plano de
--    recompensas, sem originador, sem usina.
-- ---------------------------------------------------------------------------
INSERT INTO public.planos_usina (nome, descricao)
VALUES ('Plano Usina Padrão',
        'Valores do contrato de compra e venda v2 (24/08/2026). Sem plano de recompensas e sem regra de originador: preencha antes de vincular a primeira usina, enquanto o plano ainda é editável.');
```

- [ ] **Step 5: Aplicar a migração**

Confirme o nome livre (Global Constraints), depois `apply_migration` com `name: 20261006e_planos_usina` e o conteúdo do arquivo.

- [ ] **Step 6: Rodar o teste e ver passar**

Cole `supabase/tests/plano_usina.test.sql` no `execute_sql`. Esperado: `ERROR: P0001: SANDBOX_OK`. Cole verbatim.

- [ ] **Step 7: Conferir o plano padrão e o razão**

```sql
SELECT nome, percentual_recorrente, taxa_admin_reais, taxa_recuperacao_pct, retencao_rescisao_pct,
       multa_atraso_mes_pct, multa_atraso_teto_pct, garantia_instalacao_meses,
       originador_recorrente_pct, originador_bonus_fechamentos, plano_assinatura_id, status
  FROM public.planos_usina;
```

Esperado: uma linha, `Plano Usina Padrão | 10 | 10 | 8 | 10 | 0.5 | 10 | 12 | 0 | {} | null | ativo`. Depois rode a consulta do Step 1 e compare.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261006e_planos_usina.sql supabase/tests/plano_usina.test.sql
git commit -m "feat(plano-usina): tabela planos_usina, trava de versao e vinculo da usina

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Motor — regras via plano de usina e gestão do plano

**Files:**
- Create: `supabase/migrations/20261006f_plano_usina_motor.sql`
- Modify: `supabase/tests/plano_usina.test.sql` (casos M1–M4 acima da linha marcada)
- Modify: `supabase/tests/split_gatilho.test.sql`, `split_bonus_start.test.sql`, `split_base_compensada.test.sql`, `split_conta_receber.test.sql`, `split_piso_tarifa_bruta.test.sql`, `invoice_paid_ledger_definer.test.sql`, `split_plano_fonte.test.sql`

**Interfaces:**
- Consumes: `planos_usina`, `usinas.plano_usina_id` (Task 1).
- Produces: `public.fn_plano_usina_da_uc(p_uc uuid) RETURNS public.planos_usina`; `fn_regras_recompensa_uc(p_uc uuid)` passa a devolver também `plano_usina_id` (uuid|null) e `percentual_recorrente` (numeric|null), com `gestao_pct` e `regras_multinivel.b2w` sobrescritos pelo plano de usina; `usinas.plano_assinatura_id` deixa de existir. Helper de teste `pg_temp.pu(p_plano uuid) RETURNS uuid` (cria plano de usina com a mesma gestão que o plano de recompensas já dava).

- [ ] **Step 1: Escrever os casos M1–M4 (RED)**

Em `supabase/tests/plano_usina.test.sql`, insira **acima** de `-- >>> casos novos entram acima desta linha <<<`:

```sql
    -- ==================================================================
    -- fixture do motor: PPE com lider; venda direta (nivel 1)
    --   base 1000, piso 50 -> teto 1000 - 1000 x 1,20 x 50% = 400
    -- ==================================================================
    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX PU Lider', 'lider', true) RETURNING id INTO v_lider;
    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
    VALUES ('SANDBOX PU PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;

    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX PU rec da UC', 'recorrente', 10, 50, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_rec_plano_uc;

    INSERT INTO public.planos_usina (nome, percentual_recorrente, plano_assinatura_id)
    VALUES ('SANDBOX PU 12', 12, v_rec_plano) RETURNING id INTO v_pu2;
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu2) RETURNING id INTO v_usina2;

    -- ==================================================================
    -- M1 -- gestao vem do plano de usina (12%), UC sem plano proprio.
    --   B2W 120 | PPE 5% 50 + Lider 1% 10 | fornecedor 1000 - 180 = 820
    -- ==================================================================
    v_inv    := pg_temp.fatura_paga(v_usina2, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -60, -820, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA M1: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-60,-820,0}', v_contas;
    END IF;
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec ->> 'plano_id')::uuid IS DISTINCT FROM v_rec_plano THEN
        RAISE EXCEPTION 'FALHA M1: plano_id congelado = %, esperado o plano de recompensas do plano de usina %', v_rec ->> 'plano_id', v_rec_plano;
    END IF;

    -- ==================================================================
    -- M2 -- UC com plano proprio na mesma usina: o plano de recompensas e o
    --       da UC, mas a gestao continua a do plano de usina (12%).
    -- ==================================================================
    v_inv    := pg_temp.fatura_paga(v_usina2, v_ppe, v_rec_plano_uc);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -60, -820, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA M2: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-60,-820,0}', v_contas;
    END IF;
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec ->> 'plano_id')::uuid IS DISTINCT FROM v_rec_plano_uc THEN
        RAISE EXCEPTION 'FALHA M2: plano_id congelado = %, esperado o plano da UC %', v_rec ->> 'plano_id', v_rec_plano_uc;
    END IF;

    -- ==================================================================
    -- M3 -- usina SEM plano de usina, UC com plano proprio: comportamento de
    --       hoje, gestao da matriz do plano da UC (10%).
    --   B2W 100 | 60 | fornecedor 840
    -- ==================================================================
    INSERT INTO public.usinas (name) VALUES ('SANDBOX PU sem plano de usina') RETURNING id INTO v_usina3;
    v_inv    := pg_temp.fatura_paga(v_usina3, v_ppe, v_rec_plano_uc);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-100, -60, -840, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA M3: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-100,-60,-840,0}', v_contas;
    END IF;

    -- ==================================================================
    -- M4 -- matriz invalida NAO e consertada pela sobrescrita: b2w.niveis
    --       null continua null (o gatilho tem de cair em plano_sem_matriz).
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX PU matriz nula', 'recorrente', 10, 50,
            '{"regras_multinivel": {"b2w": {"niveis": null, "max_niveis": 4}}}'::jsonb)
    RETURNING id INTO v_rec_sem_matriz;
    INSERT INTO public.planos_usina (nome, percentual_recorrente, plano_assinatura_id)
    VALUES ('SANDBOX PU matriz nula', 12, v_rec_sem_matriz) RETURNING id INTO v_pu3;
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu3) RETURNING id INTO v_usina_matriz;
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pu/m4') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_matriz, 'consumidora', 'ativo', 'SANDBOX PU conc', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;
    v_regras := public.fn_regras_recompensa_uc(v_uc);
    IF jsonb_typeof(v_regras #> '{regras_multinivel,b2w,niveis}') = 'object' THEN
        RAISE EXCEPTION 'FALHA M4: a sobrescrita do plano de usina "consertou" uma matriz sem b2w.niveis: %', v_regras -> 'regras_multinivel';
    END IF;
    IF (v_regras ->> 'gestao_pct')::numeric IS DISTINCT FROM 12::numeric THEN
        RAISE EXCEPTION 'FALHA M4: gestao_pct = %, esperado 12 (do plano de usina)', v_regras ->> 'gestao_pct';
    END IF;
```

- [ ] **Step 2: Rodar e ver falhar**

Cole o arquivo. Esperado: `FALHA M1: [3.1.1, 2.1.2, 2.1.1, soma] = {0,0,-1000,0}, esperado {-120,-60,-820,0}` (hoje o motor não enxerga o plano de usina: UC sem plano cai em `uc_sem_plano`). Cole verbatim.

- [ ] **Step 3: Escrever a migração**

Crie `supabase/migrations/20261006f_plano_usina_motor.sql`:

```sql
-- Plano de Usina -- o motor do split passa a enxergar o plano da usina.
-- Spec: docs/superpowers/specs/2026-10-06-plano-usina-design.md (secao 2).
--
--  * plano de recompensas = COALESCE(UC.plano_assinatura_id,
--    planos_usina.plano_assinatura_id): o plano contratado na UC manda
--    (ConsumerUnitModal grava desde 03/10/2026; 22 UCs no Plano Premium);
--  * gestao B2W = planos_usina.percentual_recorrente, igual em todos os
--    niveis, quando a usina tem plano de usina -- "mesma cobranca" dos 10% da
--    B2W no split (decisao do dono, 06/10/2026);
--  * usinas.plano_assinatura_id sai: nunca foi preenchida e nenhum codigo do
--    main grava nela. Ficar com ela seria a segunda fonte do mesmo vinculo.

DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM public.usinas WHERE plano_assinatura_id IS NOT NULL) THEN
        RAISE EXCEPTION 'usinas.plano_assinatura_id tem valor: migrar para plano de usina antes de remover a coluna';
    END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_plano_usina_da_uc(p_uc uuid)
RETURNS public.planos_usina
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT pu.*
    FROM public.consumer_units cu
    JOIN public.usinas u        ON u.id = cu.usina_id
    JOIN public.planos_usina pu ON pu.id = u.plano_usina_id
   WHERE cu.id = p_uc;
$function$;

ALTER FUNCTION public.fn_plano_usina_da_uc(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_plano_usina_da_uc(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_plano_usina_da_uc(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_plano_da_uc(p_uc uuid)
RETURNS planos_assinatura_energia
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.*
    FROM public.consumer_units cu
    LEFT JOIN public.usinas u        ON u.id = cu.usina_id
    LEFT JOIN public.planos_usina pu ON pu.id = u.plano_usina_id
    LEFT JOIN public.planos_assinatura_energia p
      ON p.id = COALESCE(cu.plano_assinatura_id, pu.plano_assinatura_id)
   WHERE cu.id = p_uc;
$function$;

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
  -- Texto, como na matriz gravada pela tela ("10"), para o congelamento
  -- comparar igual.
  IF v_pu.id IS NOT NULL THEN
    v_gestao := v_pu.percentual_recorrente;
    IF jsonb_typeof(v_matriz #> '{b2w,niveis}') = 'object' THEN
      v_pct := v_pu.percentual_recorrente::text;
      v_matriz := jsonb_set(v_matriz, '{b2w}', jsonb_build_object(
        'niveis', jsonb_build_object('L1', v_pct, 'L2', v_pct, 'L3', v_pct, 'L4', v_pct),
        'max_niveis', 4));
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

ALTER TABLE public.usinas DROP COLUMN plano_assinatura_id;
```

- [ ] **Step 4: Aplicar a migração**

Confirme o nome livre e `apply_migration` com `name: 20261006f_plano_usina_motor`. Se o `DROP COLUMN` falhar por dependência (view ou política), **pare** e reporte a dependência — não force.

- [ ] **Step 5: Rodar o teste novo e ver passar**

Cole `plano_usina.test.sql`. Esperado: `ERROR: P0001: SANDBOX_OK`. Cole verbatim.

- [ ] **Step 6: Adaptar as fixtures das suítes existentes**

As suítes gravam `usinas.plano_assinatura_id`, que não existe mais. Salve no scratchpad `migra_fixtures.py` e rode a partir da raiz do worktree:

```python
# -*- coding: utf-8 -*-
import io, re

HELPER = """
    -- Plano de Usina (20261006f): a usina deixou de apontar direto para o
    -- plano de assinatura; agora aponta para um plano de usina, que aponta
    -- para ele. pg_temp.pu cria o plano de usina com a MESMA gestao que o
    -- plano ja dava (b2w.L1 da matriz valida, ou gestao_percentual), para
    -- nenhum numero esperado deste arquivo mudar. Some no rollback.
    EXECUTE $pu$
      CREATE FUNCTION pg_temp.pu(p_plano uuid) RETURNS uuid LANGUAGE sql AS $f$
        INSERT INTO public.planos_usina (nome, percentual_recorrente, plano_assinatura_id)
        SELECT 'SANDBOX pu ' || p.nome,
               COALESCE(CASE WHEN jsonb_typeof(p.recorrente_config #> '{regras_multinivel,b2w,niveis}') = 'object'
                             THEN (p.recorrente_config #>> '{regras_multinivel,b2w,niveis,L1}')::numeric END,
                        p.gestao_percentual, 0),
               p.id
          FROM public.planos_assinatura_energia p
         WHERE p.id = p_plano
        RETURNING id
      $f$
    $pu$;
"""

ARQS = ['split_gatilho', 'split_bonus_start', 'split_base_compensada', 'split_conta_receber',
        'split_piso_tarifa_bruta', 'invoice_paid_ledger_definer', 'split_plano_fonte']

for nome in ARQS:
    p = 'supabase/tests/%s.test.sql' % nome
    raw = io.open(p, encoding='utf-8', newline='').read()
    crlf = '\r\n' in raw
    s = raw.replace('\r\n', '\n')
    antes = s.count('plano_assinatura_id')

    # helper logo depois do BEGIN do bloco DO (primeiro BEGIN em coluna 0)
    m = re.search(r'^BEGIN\n', s, re.M)
    assert m, nome + ': BEGIN do DO nao achado'
    s = s[:m.end()] + HELPER + s[m.end():]

    n = 0
    for padrao, troca in [
        (r'INSERT INTO public\.usinas \(plano_assinatura_id\) VALUES \((v_\w+)\)',
         r'INSERT INTO public.usinas (plano_usina_id) VALUES (pg_temp.pu(\1))'),
        (r'INSERT INTO public\.usinas \(plano_assinatura_id, grupo_tarifario\)(\s+)VALUES \((v_\w+), ',
         r'INSERT INTO public.usinas (plano_usina_id, grupo_tarifario)\1VALUES (pg_temp.pu(\2), '),
        (r'INSERT INTO public\.usinas \(gestao_percentual, plano_assinatura_id\)(\s+)VALUES \((\d+), (v_\w+)\)',
         r'INSERT INTO public.usinas (gestao_percentual, plano_usina_id)\1VALUES (\2, pg_temp.pu(\3))'),
        (r"INSERT INTO public\.usinas \(name, plano_assinatura_id\) VALUES \(('[^']*'), (v_\w+)\)",
         r'INSERT INTO public.usinas (name, plano_usina_id) VALUES (\1, pg_temp.pu(\2))'),
    ]:
        s, k = re.subn(padrao, troca, s)
        n += k

    resto = re.findall(r'INSERT INTO public\.usinas \([^)]*plano_assinatura_id', s)
    assert not resto, nome + ': sobrou INSERT em usinas com plano_assinatura_id: %r' % resto
    print(nome, 'trocas:', n, '| ocorrencias de plano_assinatura_id antes/depois:', antes, s.count('plano_assinatura_id'))

    if crlf:
        s = s.replace('\n', '\r\n')
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
```

Esperado: `split_gatilho` 6 trocas, `split_bonus_start` 3, `split_base_compensada` 3, `split_conta_receber` 1, `split_piso_tarifa_bruta` 1, `invoice_paid_ledger_definer` 1, `split_plano_fonte` 1. As ocorrências que sobram são de `consumer_units.plano_assinatura_id` e de comentários — confira com `git diff --stat` e `git diff supabase/tests/split_plano_fonte.test.sql`.

- [ ] **Step 7: Ajustar a única asserção que muda de propósito**

Em `supabase/tests/split_plano_fonte.test.sql`, o caso 4 consulta a UC que tem plano próprio (gestão 12) numa usina cujo plano de usina tem a gestão do plano da usina (9). Pela spec §2, a gestão agora vem do plano de usina. Troque:

```sql
  IF (v_regras->>'gestao_pct')::numeric IS DISTINCT FROM 12::numeric THEN
    RAISE EXCEPTION 'FALHOU 4: gestao_pct veio % (esperado 12)', v_regras->>'gestao_pct';
```

por:

```sql
  -- Plano de Usina (spec 2026-10-06 secao 2): a gestao B2W vem do plano de
  -- usina mesmo quando a UC tem plano proprio. O plano da UC continua
  -- mandando no resto (plano_id, piso, desconto, modalidade).
  IF (v_regras->>'gestao_pct')::numeric IS DISTINCT FROM 9::numeric THEN
    RAISE EXCEPTION 'FALHOU 4: gestao_pct veio % (esperado 9, a gestao do plano de usina)', v_regras->>'gestao_pct';
```

Nenhuma outra asserção de nenhuma suíte pode mudar. Se outra falhar no Step 8, **pare e reporte** a mensagem verbatim — não ajuste o esperado.

- [ ] **Step 8: Rodar todas as suítes do split**

Cole, um por vez, os arquivos: `split_gatilho`, `split_bonus_start`, `split_base_compensada`, `split_conta_receber`, `split_piso_tarifa_bruta`, `invoice_paid_ledger_definer`, `split_plano_fonte`, `split_motor`, `split_motor_guardas`, `split_motor_uma_por_categoria`, `split_participantes`, `split_cargos_arvore`, `split_anon_sem_cargo`, `plano_usina`. Esperado em todos: `ERROR: P0001: SANDBOX_OK`. Cole as 14 mensagens verbatim. Depois rode a consulta da Task 1 Step 1 e compare.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20261006f_plano_usina_motor.sql supabase/tests/
git commit -m "feat(plano-usina): motor le gestao e plano de recompensas pelo plano de usina

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Motor — papel `originador_usina`

**Files:**
- Create: `supabase/migrations/20261006g_originador_usina.sql`
- Modify: `supabase/tests/plano_usina.test.sql` (casos O1–O8)

**Interfaces:**
- Consumes: `fn_regras_recompensa_uc` (Task 2), `planos_usina.originador_recorrente_pct`, `usinas.originador_id` (Task 1).
- Produces: participante `{"papel": "originador_usina", "id": <uuid|null>, "nivel": 1, "suspenso": bool}` em `fn_participantes_recompensa`; entrada `originador_usina: {niveis: {L1: "<pct>", L2: "0", L3: "0", L4: "0"}, max_niveis: 1}` em `regras_multinivel` quando o plano de usina tem `originador_recorrente_pct > 0`; ordem de corte do motor `['originador_usina','assinante_conect','parceiro','lider']`; lançamento em 2.1.2 com descrição `Recompensa Originador da Usina (nível 1)`; versão gravada `20261006g_originador_usina`.

- [ ] **Step 1: Escrever os casos O1–O8 (RED)**

Insira **acima** da linha marcada em `plano_usina.test.sql`:

```sql
    -- ==================================================================
    -- fixture do originador da usina: plano de usina 12% + originador 3%
    -- ==================================================================
    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX PU quem trouxe a usina', 'ppf', true) RETURNING id INTO v_orig_usina;
    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX PU originador inativo', 'ppf', false) RETURNING id INTO v_orig_inativo;

    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, plano_assinatura_id)
    VALUES ('SANDBOX PU 12+3', 12, 3, v_rec_plano) RETURNING id INTO v_pu_orig;
    INSERT INTO public.usinas (plano_usina_id, originador_id) VALUES (v_pu_orig, v_orig_usina) RETURNING id INTO v_usina4;

    -- ==================================================================
    -- O1 -- o originador da usina recebe 3% em 2.1.2.
    --   B2W 120 | 2.1.2 = PPE 50 + Lider 10 + originador 30 = 90
    --   fornecedor = 1000 - 210 = 790
    -- ==================================================================
    v_inv    := pg_temp.fatura_paga(v_usina4, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -90, -790, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O1: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-90,-790,0}', v_contas;
    END IF;
    SELECT count(*) INTO v_n
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '2.1.2' AND e.reference_type = 'originator' AND e.reference_id = v_orig_usina
       AND e.amount = -30 AND e.description = 'Recompensa Originador da Usina (nível 1)'
       AND e.transaction_id = (SELECT transaction_id FROM public.ledger_entries
                                WHERE reference_id = v_inv AND reference_type = 'invoice' LIMIT 1);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA O1: esperado 1 lancamento de -30 em 2.1.2 para o originador da usina, achei %', v_n;
    END IF;
    -- o congelamento passa a dizer de qual plano de usina veio a gestao
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec ->> 'plano_usina_id')::uuid IS DISTINCT FROM v_pu_orig
       OR (v_rec ->> 'percentual_recorrente')::numeric IS DISTINCT FROM 12::numeric THEN
        RAISE EXCEPTION 'FALHA O1: congelamento sem plano_usina_id/percentual_recorrente certos: % / %',
            v_rec ->> 'plano_usina_id', v_rec ->> 'percentual_recorrente';
    END IF;

    -- ==================================================================
    -- O2 -- corte: o originador da usina e o PRIMEIRO a perder.
    --   piso 67,5: piso em R$ = 1000 x 1,20 x 67,5% = 810 -> teto 190
    --   bruto 210, excesso 20: originador 30 -> 10 (cortado 20); PPE 50 e
    --   Lider 10 intactos. fornecedor = 1000 - 190 = 810.
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX PU rec piso67.5', 'recorrente', 10, 67.5, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_rec_piso675;
    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, plano_assinatura_id)
    VALUES ('SANDBOX PU corte', 12, 3, v_rec_piso675) RETURNING id INTO v_pu_corte;
    INSERT INTO public.usinas (plano_usina_id, originador_id) VALUES (v_pu_corte, v_orig_usina) RETURNING id INTO v_usina_corte;

    v_inv    := pg_temp.fatura_paga(v_usina_corte, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -70, -810, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O2: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-70,-810,0}', v_contas;
    END IF;
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec -> 'resultado' -> 'beneficiarios') b
     WHERE b ->> 'papel' = 'originador_usina';
    IF (v_ben ->> 'cortado')::numeric IS DISTINCT FROM 20::numeric OR (v_ben ->> 'valor')::numeric IS DISTINCT FROM 10::numeric THEN
        RAISE EXCEPTION 'FALHA O2: originador da usina devia ser o 1o cortado (cortado 20, valor 10), veio %', v_ben;
    END IF;
    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec -> 'resultado' -> 'beneficiarios') b
     WHERE b ->> 'papel' = 'ppe';
    IF COALESCE((v_ben ->> 'cortado')::numeric, 0) <> 0 OR (v_ben ->> 'valor')::numeric <> 50 THEN
        RAISE EXCEPTION 'FALHA O2: o PPE vem depois do originador da usina e devia ficar intacto (50), veio %', v_ben;
    END IF;
    IF (v_rec -> 'resultado' ->> 'teto_estourado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA O2: teto_estourado = %, esperado false', v_rec -> 'resultado' ->> 'teto_estourado';
    END IF;

    -- ==================================================================
    -- O3 -- originador inativo: a parte dele fica para a associacao (B2W).
    --   B2W 120 + 30 = 150 | 2.1.2 60 | fornecedor 790
    -- ==================================================================
    INSERT INTO public.usinas (plano_usina_id, originador_id) VALUES (v_pu_orig, v_orig_inativo) RETURNING id INTO v_usina_inat;
    v_inv    := pg_temp.fatura_paga(v_usina_inat, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-150, -60, -790, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O3: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-150,-60,-790,0}', v_contas;
    END IF;

    -- ==================================================================
    -- O4 -- usina SEM originador: o previsto no plano fica para a associacao.
    -- ==================================================================
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu_orig) RETURNING id INTO v_usina_sem_orig;
    v_inv    := pg_temp.fatura_paga(v_usina_sem_orig, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-150, -60, -790, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O4: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-150,-60,-790,0}', v_contas;
    END IF;

    -- ==================================================================
    -- O5 -- plano start FORA da janela: parceiro e lider nao recebem, o
    --       originador da usina recebe (decisao 9).
    --   B2W 120 | 2.1.2 = so o originador, 30 | fornecedor 850
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config, start_config)
    VALUES ('SANDBOX PU start janela 2', 'start', 10, 50, jsonb_build_object('regras_multinivel', c_matriz),
            '{"faturas_elegiveis": [2], "regras": {"2": {"b2w": 0, "ppe": 20, "lider": 10, "ppp": 0, "ppf": 0, "assinante_conect": 0}}}'::jsonb)
    RETURNING id INTO v_rec_start;
    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, plano_assinatura_id)
    VALUES ('SANDBOX PU start', 12, 3, v_rec_start) RETURNING id INTO v_pu_start;
    INSERT INTO public.usinas (plano_usina_id, originador_id) VALUES (v_pu_start, v_orig_usina) RETURNING id INTO v_usina_start;

    v_inv    := pg_temp.fatura_paga(v_usina_start, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -30, -850, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O5: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-30,-850,0}', v_contas;
    END IF;

    -- ==================================================================
    -- O6 -- fatura DO Start: b2w do start_config (0), PPE 20% = 200, Lider
    --       10% = 100, originador da usina 3% = 30 -- e o lancamento dele NAO
    --       se chama "Bonus Start". Teto isento = base.
    --   3.1.1 0 | 2.1.2 330 | fornecedor 670
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config, start_config)
    VALUES ('SANDBOX PU start janela 1', 'start', 10, 50, jsonb_build_object('regras_multinivel', c_matriz),
            '{"faturas_elegiveis": [1], "regras": {"1": {"b2w": 0, "ppe": 20, "lider": 10, "ppp": 0, "ppf": 0, "assinante_conect": 0}}}'::jsonb)
    RETURNING id INTO v_rec_start1;
    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, plano_assinatura_id)
    VALUES ('SANDBOX PU start 1', 12, 3, v_rec_start1) RETURNING id INTO v_pu_start1;
    INSERT INTO public.usinas (plano_usina_id, originador_id) VALUES (v_pu_start1, v_orig_usina) RETURNING id INTO v_usina_start1;

    v_inv    := pg_temp.fatura_paga(v_usina_start1, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[0, -330, -670, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O6: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {0,-330,-670,0}', v_contas;
    END IF;
    SELECT count(*) INTO v_n FROM public.ledger_entries
     WHERE reference_id = v_orig_usina AND amount = -30
       AND description = 'Recompensa Originador da Usina (nível 1)'
       AND transaction_id = (SELECT transaction_id FROM public.ledger_entries
                              WHERE reference_id = v_inv AND reference_type = 'invoice' LIMIT 1);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA O6: o lancamento do originador da usina na fatura do Start nao saiu como Recompensa (achei %)', v_n;
    END IF;

    -- ==================================================================
    -- O7 -- motor: dois originador_usina no mesmo pagamento e bug -> estoura.
    -- ==================================================================
    v_pegou := false;
    BEGIN
        PERFORM public.fn_calcular_split_recompensa(1000, 1000,
            '{"b2w": {"niveis": {"L1": "10"}, "max_niveis": 4},
              "originador_usina": {"niveis": {"L1": "3"}, "max_niveis": 1}}'::jsonb,
            '[{"papel": "originador_usina", "id": null, "nivel": 1},
              {"papel": "originador_usina", "id": null, "nivel": 1}]'::jsonb);
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%originador_usina%' THEN
        RAISE EXCEPTION 'FALHA O7: dois originador_usina deviam estourar no motor (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- ==================================================================
    -- O8 -- usina sem plano de usina: o originador dela nao entra (nao ha
    --       regra que diga quanto ele recebe).
    -- ==================================================================
    UPDATE public.usinas SET originador_id = v_orig_usina WHERE id = v_usina3;
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://pu/o8') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina3, 'consumidora', 'ativo', 'SANDBOX PU conc', '{"uf": "RN"}'::jsonb, v_rec_plano_uc)
    RETURNING id INTO v_uc;
    SELECT count(*) INTO v_n FROM jsonb_array_elements(public.fn_participantes_recompensa(v_uc)) b
     WHERE b ->> 'papel' = 'originador_usina';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA O8: usina sem plano de usina pos o originador dela entre os participantes';
    END IF;
```

- [ ] **Step 2: Rodar e ver falhar**

Cole o arquivo. Esperado: `FALHA O1: [3.1.1, 2.1.2, 2.1.1, soma] = {-120,-60,-820,0}, esperado {-120,-90,-790,0}`. Cole verbatim.

- [ ] **Step 3: Conferir os corpos vivos**

```sql
SELECT p.proname, md5(p.prosrc)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('handle_invoice_paid_ledger', 'fn_participantes_recompensa', 'fn_calcular_split_recompensa')
 ORDER BY 1;
```

Esperado: os três md5 dos Global Constraints. Se algum diferir, **pare**: outra sessão mexeu na função; reporte qual, e só siga depois de re-derivar as âncoras do Step 4 contra o corpo novo (`pg_get_functiondef`).

- [ ] **Step 4: Escrever a migração**

Crie `supabase/migrations/20261006g_originador_usina.sql`:

```sql
-- Plano de Usina -- o originador que trouxe a usina vira o papel
-- originador_usina no split. Spec: docs/superpowers/specs/2026-10-06-plano-usina-design.md (secao 2).
--
--  * percentual em planos_usina.originador_recorrente_pct (decisao do dono,
--    06/10/2026: a regra mora no plano da usina);
--  * sem originador vinculado ou com originador inativo: entra suspenso e a
--    parte fica para a associacao (B2W), como em toda supressao;
--  * recebe em toda fatura paga, inclusive em plano start e na fatura do Start;
--  * e o PRIMEIRO da ordem de corte; a B2W continua nunca cortada.
--
-- As tres funcoes sao PATCHADAS sobre o corpo vivo (pg_get_functiondef +
-- replace + EXECUTE), cada uma atras de uma trava de md5: o gatilho foi
-- alterado direto no banco em 06/10/2026 por 20261006a_abatimento_credito_indicacao
-- (branch app-v1.3) e nao e mais o do arquivo 20260930b.

-- ---------------------------------------------------------------------------
-- 0. fn_regras_recompensa_uc: injeta originador_usina na matriz
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
  -- Texto, como na matriz gravada pela tela ("10"), para o congelamento
  -- comparar igual.
  IF v_pu.id IS NOT NULL THEN
    v_gestao := v_pu.percentual_recorrente;
    IF jsonb_typeof(v_matriz #> '{b2w,niveis}') = 'object' THEN
      v_pct := v_pu.percentual_recorrente::text;
      v_matriz := jsonb_set(v_matriz, '{b2w}', jsonb_build_object(
        'niveis', jsonb_build_object('L1', v_pct, 'L2', v_pct, 'L3', v_pct, 'L4', v_pct),
        'max_niveis', 4));

      -- originador_usina: so nivel 1, nao e multinivel.
      IF v_pu.originador_recorrente_pct > 0 THEN
        v_matriz := v_matriz || jsonb_build_object('originador_usina', jsonb_build_object(
          'niveis', jsonb_build_object('L1', v_pu.originador_recorrente_pct::text,
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
-- 1. fn_participantes_recompensa: o participante originador_usina
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_participantes_recompensa(uuid)'::regprocedure))
       <> 'da355ffe5bd41a5e9a017a7f345a333b' THEN
        RAISE EXCEPTION 'fn_participantes_recompensa mudou desde 06/10/2026: re-derivar o patch antes de aplicar';
    END IF;

    d := pg_get_functiondef('public.fn_participantes_recompensa(uuid)'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$DECLARE
$de$, $para$DECLARE
  v_ou        record;
$para$),
        ($de$  RETURN v_res;
END;$de$, $para$  -- Plano de Usina (spec 2026-10-06 secao 2): quem trouxe a USINA. Entra
  -- sempre que o plano da usina preve percentual; sem originador vinculado,
  -- ou com ele inativo, entra suspenso e o motor manda o valor para a B2W
  -- (associacao), como em toda supressao.
  SELECT u.originador_id, pu.originador_recorrente_pct, o.ativo
    INTO v_ou
    FROM public.consumer_units cu
    JOIN public.usinas u        ON u.id = cu.usina_id
    JOIN public.planos_usina pu ON pu.id = u.plano_usina_id
    LEFT JOIN public.originators_v2 o ON o.id = u.originador_id
   WHERE cu.id = p_uc;

  IF FOUND AND COALESCE(v_ou.originador_recorrente_pct, 0) > 0 THEN
    v_res := v_res || jsonb_build_object(
      'papel', 'originador_usina', 'id', v_ou.originador_id, 'nivel', 1,
      'suspenso', v_ou.originador_id IS NULL OR NOT COALESCE(v_ou.ativo, false)
    );
  END IF;

  RETURN v_res;
END;$para$)
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
-- 2. fn_calcular_split_recompensa: guarda de um por pagamento e ordem de corte
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    IF md5((SELECT prosrc FROM pg_proc
             WHERE oid = 'public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb)'::regprocedure))
       <> 'e7890b3e191d2921801afcfc5e3d51c9' THEN
        RAISE EXCEPTION 'fn_calcular_split_recompensa mudou desde 06/10/2026: re-derivar o patch antes de aplicar';
    END IF;

    d := pg_get_functiondef('public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb)'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$DECLARE
$de$, $para$DECLARE
  v_n_orig_usina     int;
$para$),
        ($de$    INTO v_n_parceiro, v_n_lider, v_n_conect$de$,
         $para$    ,count(*) FILTER (WHERE elem->>'papel' = 'originador_usina')
    INTO v_n_parceiro, v_n_lider, v_n_conect, v_n_orig_usina$para$),
        ($de$', v_n_conect;
  END IF;$de$, $para$', v_n_conect;
  END IF;

  -- Plano de Usina: uma usina tem um so originador.
  IF v_n_orig_usina > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "originador_usina" -- uma usina tem um so originador, isso e bug de quem montou a lista, nao um caso de negocio', v_n_orig_usina;
  END IF;$para$),
        ($de$unnest(ARRAY['assinante_conect', 'parceiro', 'lider'])$de$,
         $para$unnest(ARRAY['originador_usina', 'assinante_conect', 'parceiro', 'lider'])$para$),
        ($de$(v_cat = 'assinante_conect' AND v_papel = 'assinante_conect') OR$de$,
         $para$(v_cat = 'originador_usina' AND v_papel = 'originador_usina') OR
          (v_cat = 'assinante_conect' AND v_papel = 'assinante_conect') OR$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'fn_calcular_split_recompensa: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    EXECUTE d;
END
$patch$;

-- ---------------------------------------------------------------------------
-- 3. handle_invoice_paid_ledger: conta, Start e congelamento
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_invoice_paid_ledger()'::regprocedure))
       <> 'e8efea563e729bf482dedb0a4a71c759' THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger mudou desde 06/10/2026: re-derivar o patch antes de aplicar';
    END IF;

    d := pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        -- 3a. o papel vai para 2.1.2, como parceiro e lider
        ($de$ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider') THEN$de$,
         $para$ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider', 'originador_usina') THEN$para$),
        ($de$WHEN 'lider' THEN 'Líder'$de$,
         $para$WHEN 'lider' THEN 'Líder'
                                      WHEN 'originador_usina' THEN 'Originador da Usina'$para$),
        -- 3b. o lancamento dele nunca se chama "Bonus Start"
        ($de$CASE WHEN v_caminho = 'bonus_start' AND v_ben_nivel = '1'$de$,
         $para$CASE WHEN v_caminho = 'bonus_start' AND v_ben_nivel = '1' AND v_ben_papel <> 'originador_usina'$para$),
        -- 3c. fatura do Start: copia a entrada da matriz, o start_config nao fala dele
        ($de$'max_niveis', 4));
                    ELSE$de$,
         $para$'max_niveis', 4));
                    ELSIF v_papel_key = 'originador_usina' THEN
                        -- Plano de Usina (decisao 9): quem trouxe a USINA
                        -- recebe a recorrencia tambem na fatura do Start.
                        v_matriz_efetiva := v_matriz_efetiva || jsonb_build_object(
                            'originador_usina', v_matriz -> 'originador_usina');
                    ELSE$para$),
        -- 3d. plano start fora da janela: b2w + originador da usina
        ($de$v_matriz_efetiva := jsonb_build_object('b2w', v_matriz -> 'b2w');$de$,
         $para$-- Plano de Usina (decisao 9): o originador da usina recebe mesmo
                -- em plano start fora da janela.
                v_matriz_efetiva := jsonb_strip_nulls(jsonb_build_object(
                    'b2w', v_matriz -> 'b2w',
                    'originador_usina', v_matriz -> 'originador_usina'));$para$),
        -- 3e. congelamento
        ($de$v_plano -> 'plano_id',$de$,
         $para$v_plano -> 'plano_id',
            'plano_usina_id',        v_plano -> 'plano_usina_id',
            'percentual_recorrente', v_plano -> 'percentual_recorrente',$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    -- 3f. versao gravada no congelamento (aparece duas vezes)
    v_n := (length(d) - length(replace(d, '''20260929f_conta_receber_assinante''', '')))
           / length('''20260929f_conta_receber_assinante''');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger: versao achada % vezes (esperado 2)', v_n;
    END IF;
    d := replace(d, '''20260929f_conta_receber_assinante''', '''20261006g_originador_usina''');

    EXECUTE d;
END
$patch$;
```

- [ ] **Step 5: Aplicar a migração**

Confirme o nome livre e `apply_migration` com `name: 20261006g_originador_usina`. Depois:

```sql
SELECT p.proname, md5(p.prosrc), p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('handle_invoice_paid_ledger', 'fn_participantes_recompensa', 'fn_calcular_split_recompensa', 'fn_regras_recompensa_uc')
 ORDER BY 1;
```

Anote os md5 novos no relatório (a próxima sessão que patchar estas funções precisa deles). Esperado: `handle_invoice_paid_ledger` e `fn_participantes_recompensa` continuam `prosecdef = true`, dona `postgres`, `search_path=public, pg_temp`.

- [ ] **Step 6: Rodar todas as suítes do split**

As mesmas 14 do Task 2 Step 8. Esperado: `ERROR: P0001: SANDBOX_OK` em todas. Cole as 14 mensagens verbatim. Depois a consulta da Task 1 Step 1.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261006g_originador_usina.sql supabase/tests/plano_usina.test.sql
git commit -m "feat(plano-usina): originador da usina recebe no split e e o primeiro cortado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Biblioteca do front — `planoUsina.js`

**Files:**
- Create: `src/lib/planoUsina.js`
- Test: `tests/plano-usina.test.js`

**Interfaces:**
- Produces (todos `export`):
  - `CAMPOS_PLANO_USINA: Array<{chave: string, rotulo: string, contrato: string|null, max: number|null, inteiro?: boolean}>`
  - `CHAVES_CONTRATO_DO_PLANO: string[]` — chaves de `DEFAULTS_USINA` que vêm do plano
  - `CAMPOS_TRAVADOS: string[]`
  - `PLANO_USINA_VAZIO: object`
  - `termosContratoDoPlano(plano) => {[chaveContrato]: number}`
  - `lerFechamentos(texto) => number[] | null`
  - `validarPlanoUsina(dados) => string[]`
  - `rascunhoNovaVersao(plano) => object`
  - `payloadPlanoUsina(dados) => object`
  - `planoAceitaUsina(plano) => boolean`

- [ ] **Step 1: Ligar o `node_modules` (uma vez)**

```bash
cmd //c mklink /J node_modules "..\..\..\node_modules"
```

Rode na raiz do worktree. Esperado: `Junction created for node_modules`. **Ao final da branch, desfaça com `cmd //c rmdir node_modules` antes de qualquer `git worktree remove`.**

- [ ] **Step 2: Escrever o teste (RED)**

Crie `tests/plano-usina.test.js`:

```js
import { test, expect, describe } from 'vitest';
import {
    CAMPOS_PLANO_USINA,
    CHAVES_CONTRATO_DO_PLANO,
    CAMPOS_TRAVADOS,
    PLANO_USINA_VAZIO,
    termosContratoDoPlano,
    lerFechamentos,
    validarPlanoUsina,
    rascunhoNovaVersao,
    payloadPlanoUsina,
    planoAceitaUsina
} from '../src/lib/planoUsina.js';

const PLANO = {
    id: 'p1', nome: 'Plano A', descricao: 'd', status: 'ativo',
    percentual_recorrente: 12, taxa_admin_reais: 9.5, taxa_recuperacao_pct: 7,
    retencao_rescisao_pct: 11, multa_atraso_mes_pct: 0.4, multa_atraso_teto_pct: 9,
    garantia_instalacao_meses: 24, originador_recorrente_pct: 3,
    originador_bonus_fechamentos: [2], plano_assinatura_id: 'rec1'
};

describe('campos do plano de usina', () => {
    test('o contrato recebe exatamente os 7 termos comerciais (spec secao 1)', () => {
        expect(CHAVES_CONTRATO_DO_PLANO).toEqual([
            'percentualRecorrente', 'taxaAdmin', 'taxaRecuperacao', 'retencaoRescisao',
            'multaAtrasoMes', 'multaAtrasoTeto', 'garantiaInstalacaoMeses'
        ]);
    });

    test('a trava espelha fn_planos_usina_trava', () => {
        expect(CAMPOS_TRAVADOS).toEqual([
            'percentual_recorrente', 'taxa_admin_reais', 'taxa_recuperacao_pct', 'retencao_rescisao_pct',
            'multa_atraso_mes_pct', 'multa_atraso_teto_pct', 'garantia_instalacao_meses',
            'originador_recorrente_pct', 'originador_bonus_fechamentos', 'plano_assinatura_id'
        ]);
    });

    test('o vazio tem os mesmos defaults da migracao 20261006e', () => {
        expect(PLANO_USINA_VAZIO).toMatchObject({
            percentual_recorrente: 10, taxa_admin_reais: 10, taxa_recuperacao_pct: 8,
            retencao_rescisao_pct: 10, multa_atraso_mes_pct: 0.5, multa_atraso_teto_pct: 10,
            garantia_instalacao_meses: 12, originador_recorrente_pct: 0,
            originador_bonus_fechamentos: [], plano_assinatura_id: null
        });
        expect(CAMPOS_PLANO_USINA.every(c => c.chave in PLANO_USINA_VAZIO)).toBe(true);
    });
});

describe('termosContratoDoPlano', () => {
    test('traduz as colunas do plano para as chaves do gerador do contrato', () => {
        expect(termosContratoDoPlano(PLANO)).toEqual({
            percentualRecorrente: 12, taxaAdmin: 9.5, taxaRecuperacao: 7, retencaoRescisao: 11,
            multaAtrasoMes: 0.4, multaAtrasoTeto: 9, garantiaInstalacaoMeses: 24
        });
    });

    test('numeric do Postgres chega como string e vira numero', () => {
        expect(termosContratoDoPlano({ ...PLANO, percentual_recorrente: '12.50' }).percentualRecorrente).toBe(12.5);
    });

    test('sem plano, nada', () => {
        expect(termosContratoDoPlano(null)).toEqual({});
    });
});

describe('lerFechamentos', () => {
    test('aceita um ou varios, ordena e tira repetidos', () => {
        expect(lerFechamentos('2')).toEqual([2]);
        expect(lerFechamentos('3, 2;2 5')).toEqual([2, 3, 5]);
    });

    test('vazio e lista vazia', () => {
        expect(lerFechamentos('')).toEqual([]);
        expect(lerFechamentos(null)).toEqual([]);
    });

    test('zero, negativo, fracao ou texto -> null', () => {
        expect(lerFechamentos('0')).toBeNull();
        expect(lerFechamentos('-1')).toBeNull();
        expect(lerFechamentos('1.5')).toBeNull();
        expect(lerFechamentos('dois')).toBeNull();
    });
});

describe('validarPlanoUsina', () => {
    test('plano completo nao tem erro', () => {
        expect(validarPlanoUsina(PLANO)).toEqual([]);
    });

    test('nome vazio, percentual acima de 100, negativo, garantia fracionada e bonus invalido', () => {
        const erros = validarPlanoUsina({
            ...PLANO, nome: '  ', percentual_recorrente: 101, taxa_admin_reais: -1,
            garantia_instalacao_meses: 1.5, originador_bonus_fechamentos: null
        });
        expect(erros).toHaveLength(5);
        expect(erros[0]).toMatch(/nome/i);
    });
});

describe('versao e gravacao', () => {
    test('rascunho da nova versao copia os valores e marca o nome', () => {
        const r = rascunhoNovaVersao(PLANO);
        expect(r.nome).toBe('Plano A (nova versão)');
        expect(r.percentual_recorrente).toBe(12);
        expect(r.plano_assinatura_id).toBe('rec1');
        expect(r).not.toHaveProperty('id');
        expect(r).not.toHaveProperty('status');
    });

    test('payload converte numeros e manda null no lugar de string vazia', () => {
        const p = payloadPlanoUsina({ ...PLANO, nome: ' X ', descricao: '', percentual_recorrente: '12', plano_assinatura_id: '' });
        expect(p.nome).toBe('X');
        expect(p.descricao).toBeNull();
        expect(p.percentual_recorrente).toBe(12);
        expect(p.plano_assinatura_id).toBeNull();
        expect(p).not.toHaveProperty('id');
        expect(p).not.toHaveProperty('status');
    });

    test('so plano ativo com plano de recompensas aceita usina', () => {
        expect(planoAceitaUsina(PLANO)).toBe(true);
        expect(planoAceitaUsina({ ...PLANO, status: 'somente_contratos' })).toBe(false);
        expect(planoAceitaUsina({ ...PLANO, plano_assinatura_id: null })).toBe(false);
        expect(planoAceitaUsina(null)).toBe(false);
    });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/plano-usina.test.js`
Expected: FAIL — `Failed to resolve import "../src/lib/planoUsina.js"`.

- [ ] **Step 4: Implementar**

Crie `src/lib/planoUsina.js`:

```js
/**
 * Plano de Usina — o que a tela precisa saber dos campos de `planos_usina`
 * (spec docs/superpowers/specs/2026-10-06-plano-usina-design.md).
 *
 * O banco é a fonte das regras (trava de versão em fn_planos_usina_trava,
 * vínculo em fn_usinas_vinculo_plano_usina). Este módulo só garante que a
 * tela de planos, o modal da usina e o gerador do contrato usem a mesma
 * lista de campos.
 */

// `contrato` é a chave de DEFAULTS_USINA (src/lib/contratosUsina.js) que o
// gerador do contrato de compra e venda lê; null = o campo não vai para o
// contrato.
export const CAMPOS_PLANO_USINA = [
    { chave: 'percentual_recorrente', rotulo: 'Remuneração recorrente — gestão B2W (%)', contrato: 'percentualRecorrente', max: 100 },
    { chave: 'taxa_admin_reais', rotulo: 'Taxa de administração (R$ por consumidor ativo/mês)', contrato: 'taxaAdmin', max: null },
    { chave: 'taxa_recuperacao_pct', rotulo: 'Taxa de recuperação de crédito (%)', contrato: 'taxaRecuperacao', max: 100 },
    { chave: 'retencao_rescisao_pct', rotulo: 'Retenção / multa de rescisão (%)', contrato: 'retencaoRescisao', max: 100 },
    { chave: 'multa_atraso_mes_pct', rotulo: 'Multa de atraso (% ao mês)', contrato: 'multaAtrasoMes', max: null },
    { chave: 'multa_atraso_teto_pct', rotulo: 'Teto da multa de atraso (%)', contrato: 'multaAtrasoTeto', max: null },
    { chave: 'garantia_instalacao_meses', rotulo: 'Garantia da instalação (meses)', contrato: 'garantiaInstalacaoMeses', max: null, inteiro: true },
    { chave: 'originador_recorrente_pct', rotulo: 'Originador da usina — recorrente (%)', contrato: null, max: 100 }
];

export const CHAVES_CONTRATO_DO_PLANO = CAMPOS_PLANO_USINA.filter(c => c.contrato).map(c => c.contrato);

// Espelho de fn_planos_usina_trava: o que o banco recusa mudar quando o plano
// já tem usina vinculada.
export const CAMPOS_TRAVADOS = [
    ...CAMPOS_PLANO_USINA.map(c => c.chave),
    'originador_bonus_fechamentos',
    'plano_assinatura_id'
];

// Mesmos defaults da migração 20261006e (que são os de DEFAULTS_USINA).
export const PLANO_USINA_VAZIO = {
    nome: '',
    descricao: '',
    percentual_recorrente: 10,
    taxa_admin_reais: 10,
    taxa_recuperacao_pct: 8,
    retencao_rescisao_pct: 10,
    multa_atraso_mes_pct: 0.5,
    multa_atraso_teto_pct: 10,
    garantia_instalacao_meses: 12,
    originador_recorrente_pct: 0,
    originador_bonus_fechamentos: [],
    plano_assinatura_id: null
};

const vazio = (v) => v === null || v === undefined || v === '';

/** Colunas do plano → chaves que o gerador do contrato lê. */
export const termosContratoDoPlano = (plano) => {
    if (!plano) return {};
    const termos = {};
    for (const c of CAMPOS_PLANO_USINA) {
        if (!c.contrato || vazio(plano[c.chave])) continue;
        const n = Number(plano[c.chave]);
        if (Number.isFinite(n)) termos[c.contrato] = n;
    }
    return termos;
};

/** "2" ou "2, 3" → [2, 3]; vazio → []; qualquer coisa que não seja inteiro positivo → null. */
export const lerFechamentos = (texto) => {
    const partes = String(texto ?? '').split(/[,;\s]+/).filter(Boolean);
    const nums = partes.map(Number);
    if (nums.some(n => !Number.isInteger(n) || n <= 0)) return null;
    return [...new Set(nums)].sort((a, b) => a - b);
};

/** Erros em português, prontos para a tela; lista vazia = pode gravar. */
export const validarPlanoUsina = (dados) => {
    const erros = [];
    if (!String(dados.nome ?? '').trim()) erros.push('Informe o nome do plano.');
    for (const c of CAMPOS_PLANO_USINA) {
        const bruto = dados[c.chave];
        const n = Number(bruto);
        if (vazio(bruto) || !Number.isFinite(n) || n < 0) {
            erros.push(`${c.rotulo}: informe um número maior ou igual a zero.`);
        } else if (c.max !== null && n > c.max) {
            erros.push(`${c.rotulo}: no máximo ${c.max}.`);
        } else if (c.inteiro && !Number.isInteger(n)) {
            erros.push(`${c.rotulo}: use um número inteiro.`);
        }
    }
    if (!Array.isArray(dados.originador_bonus_fechamentos)) {
        erros.push('Bônus do originador: use números de fechamento separados por vírgula, como 2 ou 2, 3.');
    }
    return erros;
};

/** Ponto de partida da tela "Criar nova versão". */
export const rascunhoNovaVersao = (plano) => ({
    ...Object.fromEntries(Object.keys(PLANO_USINA_VAZIO).map(k => [k, plano[k] ?? PLANO_USINA_VAZIO[k]])),
    nome: `${plano.nome} (nova versão)`
});

/** O que vai para o banco (INSERT, UPDATE ou p_dados da RPC de nova versão). */
export const payloadPlanoUsina = (dados) => ({
    nome: String(dados.nome ?? '').trim(),
    descricao: String(dados.descricao ?? '').trim() || null,
    ...Object.fromEntries(CAMPOS_PLANO_USINA.map(c => [c.chave, Number(dados[c.chave])])),
    originador_bonus_fechamentos: dados.originador_bonus_fechamentos,
    plano_assinatura_id: dados.plano_assinatura_id || null
});

/** Mesma regra de fn_usinas_vinculo_plano_usina. */
export const planoAceitaUsina = (plano) =>
    !!plano && plano.status === 'ativo' && !!plano.plano_assinatura_id;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/plano-usina.test.js`
Expected: PASS (todos os testes). Cole a saída.

- [ ] **Step 6: Lint e commit**

```bash
npx eslint src/lib/planoUsina.js tests/plano-usina.test.js
git add src/lib/planoUsina.js tests/plano-usina.test.js
git commit -m "feat(plano-usina): campos do plano de usina numa lista unica para tela e contrato

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Tela — aba Usinas com criar / editar / nova versão

**Files:**
- Create: `src/pages/settings/components/PlanoUsinaModal.jsx`
- Create: `src/pages/settings/components/PlanosUsinaLista.jsx`
- Modify: `src/pages/settings/components/UsinasPlanosTab.jsx`
- Modify: `src/pages/settings/PlansServicesSettings.jsx`

**Interfaces:**
- Consumes: `planoUsina.js` (Task 4); `planos_usina`, `fn_planos_usina_nova_versao` (Task 1).
- Produces: `<PlanoUsinaModal isOpen modo={'novo'|'editar'|'versao'} plano usinasVinculadas planosRecompensa onClose onSave showAlert />`; `<PlanosUsinaLista planosUsina planosRecompensa loading onRefresh showAlert />`; `<UsinasPlanosTab planosUsina showAlert onVinculosMudaram />`.

- [ ] **Step 1: Criar o modal**

Crie `src/pages/settings/components/PlanoUsinaModal.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { X, Save, Lock, GitBranch } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
    CAMPOS_PLANO_USINA,
    PLANO_USINA_VAZIO,
    lerFechamentos,
    validarPlanoUsina,
    rascunhoNovaVersao,
    payloadPlanoUsina
} from '../../../lib/planoUsina';

/**
 * Cria, edita ou versiona um Plano de Usina (spec 2026-10-06, secao 3).
 *
 *  - 'novo'   -> INSERT
 *  - 'editar' -> UPDATE; com usina vinculada so nome e descricao (o banco
 *                recusa o resto em fn_planos_usina_trava)
 *  - 'versao' -> fn_planos_usina_nova_versao: nasce um plano novo e o antigo
 *                fica somente para contratos
 */
export default function PlanoUsinaModal({ isOpen, modo, plano, usinasVinculadas = 0, planosRecompensa, onClose, onSave, showAlert }) {
    const [dados, setDados] = useState(PLANO_USINA_VAZIO);
    const [bonusTexto, setBonusTexto] = useState('');
    const [salvando, setSalvando] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const base = modo === 'versao'
            ? rascunhoNovaVersao(plano)
            : { ...PLANO_USINA_VAZIO, ...(plano || {}) };
        setDados(base);
        setBonusTexto((base.originador_bonus_fechamentos || []).join(', '));
    }, [isOpen, modo, plano]);

    if (!isOpen) return null;

    const travado = modo === 'editar' && usinasVinculadas > 0;
    const definir = (chave, valor) => setDados(prev => ({ ...prev, [chave]: valor }));

    const titulo = modo === 'novo' ? 'Criar Plano de Usina'
        : modo === 'versao' ? `Nova versão de "${plano?.nome}"`
        : `Editar "${plano?.nome}"`;

    const salvar = async () => {
        const completo = { ...dados, originador_bonus_fechamentos: lerFechamentos(bonusTexto) };
        const erros = validarPlanoUsina(completo);
        if (erros.length) {
            showAlert(erros.join('\n'), 'error');
            return;
        }
        const payload = payloadPlanoUsina(completo);

        setSalvando(true);
        try {
            let error;
            if (modo === 'novo') {
                ({ error } = await supabase.from('planos_usina').insert([payload]));
            } else if (modo === 'versao') {
                ({ error } = await supabase.rpc('fn_planos_usina_nova_versao', { p_origem: plano.id, p_dados: payload }));
            } else {
                const mudanca = travado ? { nome: payload.nome, descricao: payload.descricao } : payload;
                ({ error } = await supabase.from('planos_usina').update(mudanca).eq('id', plano.id));
            }
            if (error) throw error;
            showAlert(
                modo === 'versao'
                    ? `Nova versão criada. "${plano.nome}" fica somente para os contratos que já estão nele.`
                    : 'Plano de usina salvo.',
                'success'
            );
            onSave?.();
            onClose();
        } catch (err) {
            console.error('Erro ao salvar plano de usina:', err);
            showAlert('Erro ao salvar plano de usina: ' + (err.message || 'erro desconhecido'), 'error');
        } finally {
            setSalvando(false);
        }
    };

    const rotulo = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' };
    const campo = (bloqueado) => ({
        width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', fontSize: '0.88rem', boxSizing: 'border-box',
        border: '1px solid #cbd5e1', background: bloqueado ? '#f1f5f9' : 'white', color: bloqueado ? '#94a3b8' : '#0f172a'
    });

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
            <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '760px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.1rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a', fontWeight: 800 }}>{titulo}</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }} title="Fechar">
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                    {travado && (
                        <div style={{ display: 'flex', gap: '0.5rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#92400e' }}>
                            <Lock size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            Este plano tem {usinasVinculadas} usina(s) vinculada(s): percentuais, valores e plano de recompensas não mudam mais. Para mudar, use "Criar nova versão".
                        </div>
                    )}
                    {modo === 'versao' && (
                        <div style={{ display: 'flex', gap: '0.5rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '0.75rem 1rem', fontSize: '0.82rem', color: '#1e40af' }}>
                            <GitBranch size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                            Ao salvar, nasce um plano novo e "{plano?.nome}" passa a valer somente para as usinas que já estão nele. Ele não aparece mais para usinas novas.
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={rotulo}>Nome do plano</label>
                            <input value={dados.nome} onChange={e => definir('nome', e.target.value)} style={campo(false)} />
                        </div>
                        <div>
                            <label style={rotulo}>Plano de recompensas</label>
                            <select
                                value={dados.plano_assinatura_id || ''}
                                disabled={travado}
                                onChange={e => definir('plano_assinatura_id', e.target.value || null)}
                                style={campo(travado)}
                            >
                                <option value="">Sem plano de recompensas (não recebe usina)</option>
                                {planosRecompensa.map(p => (
                                    <option key={p.id} value={p.id} disabled={!p.ativo && p.id !== dados.plano_assinatura_id}>
                                        {p.nome} · {p.tipo_recompensa} · desconto {Number(p.desconto_assinante)}%{p.ativo ? '' : ' (inativo)'}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label style={rotulo}>Descrição</label>
                        <textarea value={dados.descricao || ''} onChange={e => definir('descricao', e.target.value)} rows={2} style={{ ...campo(false), resize: 'vertical' }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
                        {CAMPOS_PLANO_USINA.map(c => (
                            <div key={c.chave}>
                                <label style={rotulo}>{c.rotulo}</label>
                                <input
                                    type="number"
                                    step={c.inteiro ? '1' : '0.01'}
                                    min="0"
                                    max={c.max ?? undefined}
                                    disabled={travado}
                                    value={dados[c.chave] ?? ''}
                                    onChange={e => definir(c.chave, e.target.value)}
                                    style={campo(travado)}
                                />
                            </div>
                        ))}
                        <div>
                            <label style={rotulo}>Originador da usina — bônus no(s) fechamento(s) nº</label>
                            <input
                                placeholder="ex.: 2"
                                disabled={travado}
                                value={bonusTexto}
                                onChange={e => setBonusTexto(e.target.value)}
                                style={campo(travado)}
                            />
                        </div>
                    </div>

                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
                        A gestão B2W é a mesma cobrança dos 10% da B2W no split. O originador da usina recebe o recorrente em toda fatura paga das UCs dela e,
                        no(s) fechamento(s) informado(s) com saldo positivo, o saldo que iria ao investidor. Sem originador vinculado à usina, os dois ficam para a associação.
                        Taxa de administração e de recuperação são cobradas no fechamento mensal.
                    </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderTop: '1px solid #e2e8f0' }}>
                    <button onClick={onClose} style={{ padding: '0.6rem 1.1rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 600, cursor: 'pointer' }}>
                        Cancelar
                    </button>
                    <button
                        onClick={salvar}
                        disabled={salvando}
                        style={{ padding: '0.6rem 1.2rem', borderRadius: '10px', border: 'none', background: '#0284c7', color: 'white', fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                        <Save size={16} />
                        {modo === 'versao' ? 'Criar nova versão' : 'Salvar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Criar a lista**

Crie `src/pages/settings/components/PlanosUsinaLista.jsx`:

```jsx
import { useState } from 'react';
import { Plus, Edit, Trash2, GitBranch, RefreshCw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import PlanoUsinaModal from './PlanoUsinaModal';

/**
 * Tabela dos Planos de Usina na aba Usinas de Planos e Servicos.
 * `planosUsina` vem com `usinas: [{ count }]` (embed do PostgREST pela FK
 * usinas.plano_usina_id).
 */
export default function PlanosUsinaLista({ planosUsina, planosRecompensa, loading, onRefresh, showAlert }) {
    const [modal, setModal] = useState(null); // { modo, plano, usinas }

    const nUsinas = (p) => p.usinas?.[0]?.count ?? 0;
    const nomeRecompensas = (id) => planosRecompensa.find(p => p.id === id)?.nome;

    const excluir = async (plano) => {
        if (nUsinas(plano) > 0) {
            showAlert(`O plano "${plano.nome}" tem ${nUsinas(plano)} usina(s). Plano com usina não se exclui: crie uma nova versão e mova as usinas, se for o caso.`, 'warning');
            return;
        }
        if (!window.confirm(`Excluir o plano de usina "${plano.nome}"? Esta ação não pode ser desfeita.`)) return;
        const { error } = await supabase.from('planos_usina').delete().eq('id', plano.id);
        if (error) {
            showAlert('Erro ao excluir plano de usina: ' + error.message, 'error');
            return;
        }
        showAlert(`Plano "${plano.nome}" excluído.`, 'success');
        onRefresh();
    };

    const botao = (cor) => ({
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.45rem',
        cursor: 'pointer', color: cor, display: 'flex'
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', background: 'white', padding: '1rem 1.25rem', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                <div>
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>Planos de Usina</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Gestão B2W, termos do contrato, plano de recompensas e originador da usina</div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button onClick={onRefresh} title="Atualizar lista" style={{ padding: '0.6rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', cursor: 'pointer', display: 'flex' }}>
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => setModal({ modo: 'novo', plano: null, usinas: 0 })}
                        style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none', background: '#0284c7', color: 'white', fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        <Plus size={18} />
                        Criar Plano de Usina
                    </button>
                </div>
            </div>

            <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                {planosUsina.length === 0 ? (
                    <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
                        {loading ? 'Carregando planos de usina...' : 'Nenhum plano de usina cadastrado.'}
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    <th style={{ padding: '0.85rem 1rem' }}>Plano</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Gestão</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Administração</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Recuperação</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Originador</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Recompensas</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Status</th>
                                    <th style={{ padding: '0.85rem 1rem' }}>Usinas</th>
                                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {planosUsina.map(p => (
                                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{p.nome}</div>
                                            {p.descricao && <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{p.descricao}</div>}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>{Number(p.percentual_recorrente)}%</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>R$ {Number(p.taxa_admin_reais).toFixed(2).replace('.', ',')}/consumidor</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>{Number(p.taxa_recuperacao_pct)}%</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            {Number(p.originador_recorrente_pct)}%
                                            {(p.originador_bonus_fechamentos || []).length > 0 && ` + bônus ${p.originador_bonus_fechamentos.join(', ')}º fech.`}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', color: p.plano_assinatura_id ? '#0f172a' : '#b45309' }}>
                                            {nomeRecompensas(p.plano_assinatura_id) || 'sem plano de recompensas'}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem', color: p.status === 'ativo' ? '#16a34a' : '#64748b', fontWeight: 600 }}>
                                            {p.status === 'ativo' ? 'Ativo' : 'Somente contratos'}
                                        </td>
                                        <td style={{ padding: '0.85rem 1rem' }}>{nUsinas(p)}</td>
                                        <td style={{ padding: '0.85rem 1rem' }}>
                                            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                                                <button title="Editar" onClick={() => setModal({ modo: 'editar', plano: p, usinas: nUsinas(p) })} style={botao('#0284c7')}>
                                                    <Edit size={16} />
                                                </button>
                                                {p.status === 'ativo' && (
                                                    <button title="Criar nova versão" onClick={() => setModal({ modo: 'versao', plano: p, usinas: nUsinas(p) })} style={botao('#7c3aed')}>
                                                        <GitBranch size={16} />
                                                    </button>
                                                )}
                                                <button title="Excluir" onClick={() => excluir(p)} style={botao('#ef4444')}>
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <PlanoUsinaModal
                isOpen={!!modal}
                modo={modal?.modo}
                plano={modal?.plano}
                usinasVinculadas={modal?.usinas ?? 0}
                planosRecompensa={planosRecompensa}
                onClose={() => setModal(null)}
                onSave={onRefresh}
                showAlert={showAlert}
            />
        </div>
    );
}
```

- [ ] **Step 3: Apontar o vínculo em lote para o plano de usina**

Em `src/pages/settings/components/UsinasPlanosTab.jsx`:

1. Troque todas as ocorrências de `plano_assinatura_id` por `plano_usina_id` (o arquivo só usa a coluna da usina):

```bash
sed -i 's/plano_assinatura_id/plano_usina_id/g' src/pages/settings/components/UsinasPlanosTab.jsx
```

2. Troque todas as ocorrências de `planosAssinatura` por `planosUsina`:

```bash
sed -i 's/planosAssinatura/planosUsina/g' src/pages/settings/components/UsinasPlanosTab.jsx
```

3. Troque o import do topo:

```js
import { supabase } from '../../../lib/supabase';
```

por:

```js
import { supabase } from '../../../lib/supabase';
import { planoAceitaUsina } from '../../../lib/planoUsina';
```

4. Troque a assinatura do componente:

```js
export default function UsinasPlanosTab({ planosUsina, showAlert }) {
```

por:

```js
export default function UsinasPlanosTab({ planosUsina, showAlert, onVinculosMudaram }) {
```

5. Dentro de `aplicar`, troque:

```js
            setSelecionadas(new Set());
```

por:

```js
            setSelecionadas(new Set());
            onVinculosMudaram?.();
```

6. Troque o bloco `opcoesPlano` inteiro:

```jsx
    const opcoesPlano = (
        <>
            <option value="">Sem plano</option>
            {planosUsina.map(p => (
                <option key={p.id} value={p.id} disabled={!p.ativo}>
                    {p.nome}{p.ativo ? '' : ' (inativo)'}
                </option>
            ))}
        </>
    );
```

por:

```jsx
    const opcoesPlano = (
        <>
            <option value="">Sem plano de usina</option>
            {planosUsina.map(p => (
                <option key={p.id} value={p.id} disabled={!planoAceitaUsina(p)}>
                    {p.nome}
                    {p.status === 'somente_contratos' ? ' (somente contratos)' : !p.plano_assinatura_id ? ' (sem plano de recompensas)' : ''}
                </option>
            ))}
        </>
    );
```

7. Troque o aviso fixo:

```jsx
                    Usina sem plano não lança gestão B2W nem recompensas no razão: em cada fatura paga o fornecedor fica com o caixa inteiro.
```

por:

```jsx
                    Usina sem plano de usina: a gestão B2W sai do plano escolhido em cada UC, e UC sem plano não lança gestão nem recompensas — o fornecedor fica com o caixa inteiro.
```

8. Leia as 12 primeiras linhas (comentário de cabeçalho): o `sed` já trocou a coluna; ajuste o texto se alguma frase tiver ficado sem sentido.

Confira com `grep -n "plano_assinatura_id\|planosAssinatura\|p.ativo" src/pages/settings/components/UsinasPlanosTab.jsx` — esperado: nenhuma linha.

- [ ] **Step 4: Montar a aba e a guarda de exclusão**

Em `src/pages/settings/PlansServicesSettings.jsx`:

1. Imports — depois de `import UsinasPlanosTab from './components/UsinasPlanosTab';` acrescente:

```js
import PlanosUsinaLista from './components/PlanosUsinaLista';
```

2. Estado e carga — depois do bloco `useEffect(() => { fetchPlanos(); }, [fetchPlanos]);` acrescente:

```js
    // Planos de Usina (spec 2026-10-06), com o numero de usinas de cada um.
    const [planosUsina, setPlanosUsina] = useState([]);
    const [loadingUsina, setLoadingUsina] = useState(false);

    const fetchPlanosUsina = useCallback(async () => {
        setLoadingUsina(true);
        try {
            const { data, error } = await supabase
                .from('planos_usina')
                .select('*, usinas(count)')
                .order('status')
                .order('nome');
            if (error) throw error;
            setPlanosUsina(data || []);
        } catch (err) {
            console.error('Erro ao buscar planos de usina:', err);
            showAlert('Erro ao carregar planos de usina: ' + (err.message || 'Erro de conexão'), 'error');
        } finally {
            setLoadingUsina(false);
        }
    }, [showAlert]);

    useEffect(() => {
        fetchPlanosUsina();
    }, [fetchPlanosUsina]);
```

3. Conteúdo da aba — troque:

```jsx
            {activeTab === 'usinas' && (
                <UsinasPlanosTab planosAssinatura={planosAssinatura} showAlert={showAlert} />
            )}
```

por:

```jsx
            {activeTab === 'usinas' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                    <PlanosUsinaLista
                        planosUsina={planosUsina}
                        planosRecompensa={planosAssinatura}
                        loading={loadingUsina}
                        onRefresh={fetchPlanosUsina}
                        showAlert={showAlert}
                    />
                    <UsinasPlanosTab
                        planosUsina={planosUsina}
                        showAlert={showAlert}
                        onVinculosMudaram={fetchPlanosUsina}
                    />
                </div>
            )}
```

4. Guarda de exclusão do plano de recompensas — troque o bloco inteiro:

```js
        // A FK de usinas.plano_assinatura_id e ON DELETE SET NULL: apagar o
        // plano desligaria em silencio o split das usinas dele.
        const { count, error: errCount } = await supabase
            .from('usinas')
            .select('id', { count: 'exact', head: true })
            .eq('plano_assinatura_id', plano.id);
        if (errCount) {
            showAlert('Erro ao conferir usinas do plano: ' + errCount.message, 'error');
            return;
        }
        if (count > 0) {
            showAlert(`O plano "${plano.nome}" está vinculado a ${count} usina(s). Mova-as para outro plano na aba Usinas antes de excluir — ou desative o plano.`, 'warning');
            return;
        }
```

por:

```js
        // Plano de recompensas em uso nao pode sumir: planos de usina (FK
        // RESTRICT) e UCs apontam para ele, e apagar desligaria o split delas.
        const [porPlanoUsina, porUc] = await Promise.all([
            supabase.from('planos_usina').select('id', { count: 'exact', head: true }).eq('plano_assinatura_id', plano.id),
            supabase.from('consumer_units').select('id', { count: 'exact', head: true }).eq('plano_assinatura_id', plano.id)
        ]);
        const errUso = porPlanoUsina.error || porUc.error;
        if (errUso) {
            showAlert('Erro ao conferir o uso do plano: ' + errUso.message, 'error');
            return;
        }
        if (porPlanoUsina.count > 0 || porUc.count > 0) {
            showAlert(`O plano "${plano.nome}" está em uso por ${porPlanoUsina.count} plano(s) de usina e ${porUc.count} UC(s). Desative-o em vez de excluir.`, 'warning');
            return;
        }
```

- [ ] **Step 5: Checar sintaxe e lint**

```bash
npx esbuild src/pages/settings/PlansServicesSettings.jsx src/pages/settings/components/PlanoUsinaModal.jsx src/pages/settings/components/PlanosUsinaLista.jsx src/pages/settings/components/UsinasPlanosTab.jsx --loader:.jsx=jsx --outdir="$TMPDIR/esb"
npx eslint src/pages/settings/PlansServicesSettings.jsx src/pages/settings/components/PlanoUsinaModal.jsx src/pages/settings/components/PlanosUsinaLista.jsx src/pages/settings/components/UsinasPlanosTab.jsx
npx vitest run tests/plano-usina.test.js
```

Expected: esbuild `Done`, eslint sem erro, vitest PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/settings/
git commit -m "feat(plano-usina): aba Usinas cria, edita e versiona planos de usina

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tela — usina com plano de usina, originador e contrato

**Files:**
- Modify: `src/components/PowerPlantModal.jsx`

**Interfaces:**
- Consumes: `termosContratoDoPlano`, `CHAVES_CONTRATO_DO_PLANO`, `planoAceitaUsina` (Task 4); `usinas.plano_usina_id`, `usinas.originador_id` (Task 1).
- Produces: usina grava `plano_usina_id` e `originador_id`; `contractOpts` recebe os termos do plano; `contract_terms` deixa de gravar cópia deles quando há plano.

- [ ] **Step 1: Aplicar as trocas**

`PowerPlantModal.jsx` tem fim de linha CRLF e mais de 4 mil linhas: aplique por script com âncora única. Salve no scratchpad `usina_plano_usina.py` e rode na raiz do worktree:

```python
# -*- coding: utf-8 -*-
import io, re
p = 'src/components/PowerPlantModal.jsx'
raw = io.open(p, encoding='utf-8', newline='').read()
crlf = '\r\n' in raw
s = raw.replace('\r\n', '\n')

def sub(old, new, nome):
    global s
    assert s.count(old) == 1, '%s -> %d ocorrencias' % (nome, s.count(old))
    s = s.replace(old, new)

# 1. import
m = re.search(r"^import [^\n]*from '\.\./lib/contratosUsina';\n", s, re.M)
assert m, 'import de contratosUsina nao achado'
s = s[:m.end()] + "import { termosContratoDoPlano, CHAVES_CONTRATO_DO_PLANO, planoAceitaUsina } from '../lib/planoUsina';\n" + s[m.end():]

# 2. estado inicial do formulario
sub("        plano_assinatura_id: '',\n",
    "        plano_usina_id: '',\n        originador_id: '',\n", 'estado')

# 3. carga
sub("                plano_assinatura_id: usina.plano_assinatura_id || '',\n",
    "                plano_usina_id: usina.plano_usina_id || '',\n"
    "                originador_id: usina.originador_id || '',\n", 'carga')

# 4. gravacao
sub("            plano_assinatura_id: formData.plano_assinatura_id || null,\n",
    "            plano_usina_id: formData.plano_usina_id || null,\n"
    "            originador_id: formData.originador_id || null,\n", 'gravacao')

# 5. estado das listas
sub("    const [planosRecompensa, setPlanosRecompensa] = useState([]);\n",
    "    const [planosUsina, setPlanosUsina] = useState([]);\n"
    "    const [originadores, setOriginadores] = useState([]);\n", 'listas')

# 6. carga das listas
ini = s.index("    // Planos que o motor de recompensas pode usar nesta usina.")
fim = s.index("    }, []);\n", ini) + len("    }, []);\n")
s = s[:ini] + """    // Planos de usina e originadores para a aba Financeiro (spec
    // 2026-10-06). O plano de recompensas vem embutido pela FK.
    useEffect(() => {
        (async () => {
            const [planos, origs] = await Promise.all([
                supabase.from('planos_usina')
                    .select('*, planos_assinatura_energia(nome, tipo_recompensa, desconto_assinante)')
                    .order('nome'),
                supabase.from('originators_v2')
                    .select('id, name, cargo, ativo')
                    .order('name')
            ]);
            if (planos.error) console.error('Erro ao carregar planos de usina:', planos.error);
            else setPlanosUsina(planos.data || []);
            if (origs.error) console.error('Erro ao carregar originadores:', origs.error);
            else setOriginadores(origs.data || []);
        })();
    }, []);
""" + s[fim:]

# 7. termos do contrato vindos do plano (logo depois do efeito que carrega contract_terms)
sub("    }, [usina?.id, usina?.contract_terms]);\n",
    """    }, [usina?.id, usina?.contract_terms]);

    // Termos do Plano de Usina mandam no contrato (spec 2026-10-06, secao 3):
    // com plano, recorrente, taxas, multas e garantia saem dele; sem plano,
    // voltam ao que a usina tinha gravado ou ao padrao do contrato.
    const planoUsinaSel = planosUsina.find(pl => pl.id === formData.plano_usina_id) || null;
    useEffect(() => {
        const base = { ...DEFAULTS_USINA, ...(usina?.contract_terms || {}) };
        const termos = planoUsinaSel
            ? termosContratoDoPlano(planoUsinaSel)
            : Object.fromEntries(CHAVES_CONTRATO_DO_PLANO.map(k => [k, base[k]]));
        setContractOpts(prev => ({ ...prev, ...termos }));
    }, [planoUsinaSel, usina?.contract_terms]);
""", 'efeito contrato')

# 8. contract_terms nao grava copia dos termos do plano
sub("            if (chave === 'valorTotal') continue;\n",
    "            if (chave === 'valorTotal') continue;\n"
    "            // Com Plano de Usina, recorrente, taxas, multas e garantia sao do\n"
    "            // plano: gravar copia na usina faria duas verdades.\n"
    "            if (formData.plano_usina_id && CHAVES_CONTRATO_DO_PLANO.includes(chave)) continue;\n",
    'condicoesParaGravar')

# 9. bloco da aba Financeiro
ini = s.index("                            {/* Plano de Recompensas: e o que liga o motor de split nesta usina */}")
fim = s.index("                            })()}\n", ini) + len("                            })()}\n")
s = s[:ini] + """                            {/* Plano de Usina: liga o split desta usina (spec 2026-10-06) */}
                            {(() => {
                                const recompensas = planoUsinaSel?.planos_assinatura_energia;
                                const mudouPlano = (formData.plano_usina_id || '') !== (usina?.plano_usina_id || '');
                                const rotulo = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#1e40af', textTransform: 'uppercase', marginBottom: '0.4rem' };
                                const seletor = { width: '100%', padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #bfdbfe', background: 'white', fontWeight: 600, color: '#1e3a8a' };
                                return (
                                    <div style={{ marginTop: '1.5rem', background: '#eff6ff', padding: '1.5rem', borderRadius: '16px', border: '1px solid #bfdbfe', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#1e40af', fontWeight: 700 }}>Plano de Usina</h4>
                                            <p style={{ margin: 0, fontSize: '0.8rem', color: '#2563eb' }}>Gestão B2W, termos do contrato e plano de recompensas desta usina</p>
                                        </div>
                                        <select
                                            className="crm-input"
                                            value={formData.plano_usina_id || ''}
                                            onChange={e => setFormData({ ...formData, plano_usina_id: e.target.value })}
                                            style={seletor}
                                        >
                                            <option value="">Sem plano de usina</option>
                                            {planosUsina.map(pl => (
                                                <option key={pl.id} value={pl.id} disabled={!planoAceitaUsina(pl) && pl.id !== formData.plano_usina_id}>
                                                    {pl.nome} · gestão {Number(pl.percentual_recorrente)}%
                                                    {pl.status === 'somente_contratos' ? ' (somente contratos)' : !pl.plano_assinatura_id ? ' (sem plano de recompensas)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                        {planoUsinaSel && (
                                            <p style={{ margin: 0, fontSize: '0.75rem', color: '#1e40af', lineHeight: 1.5 }}>
                                                Gestão B2W {Number(planoUsinaSel.percentual_recorrente)}% · administração R$ {Number(planoUsinaSel.taxa_admin_reais).toFixed(2).replace('.', ',')} por consumidor/mês · recuperação {Number(planoUsinaSel.taxa_recuperacao_pct)}%
                                                {recompensas ? ` · recompensas: ${recompensas.nome} (${recompensas.tipo_recompensa}, desconto ${Number(recompensas.desconto_assinante)}%)` : ''}
                                                {` · originador da usina: ${Number(planoUsinaSel.originador_recorrente_pct)}% recorrente`}
                                                {(planoUsinaSel.originador_bonus_fechamentos || []).length > 0 ? `, bônus no(s) fechamento(s) ${planoUsinaSel.originador_bonus_fechamentos.join(', ')}` : ''}.
                                                {' '}Com plano, o razão usa a gestão do plano, não a "Taxa Percentual" acima, e o contrato de compra e venda sai com os termos do plano.
                                            </p>
                                        )}
                                        {mudouPlano && (
                                            <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, color: '#b45309' }}>
                                                {formData.plano_usina_id
                                                    ? 'Ao salvar, toda fatura paga a partir de agora das UCs desta usina passa a lançar a gestão B2W pelo plano de usina. Faturas já lançadas não mudam.'
                                                    : 'Ao salvar, a gestão B2W volta a sair do plano de cada UC; UC sem plano não lança gestão nem recompensas.'}
                                            </p>
                                        )}
                                        <div>
                                            <label style={rotulo}>Originador da usina</label>
                                            <select
                                                className="crm-input"
                                                value={formData.originador_id || ''}
                                                onChange={e => setFormData({ ...formData, originador_id: e.target.value })}
                                                style={seletor}
                                            >
                                                <option value="">Sem originador (o previsto no plano fica para a associação)</option>
                                                {originadores.map(o => (
                                                    <option key={o.id} value={o.id} disabled={!o.ativo && o.id !== formData.originador_id}>
                                                        {o.name}{o.cargo ? ` · ${o.cargo}` : ''}{o.ativo ? '' : ' (inativo)'}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                );
                            })()}
""" + s[fim:]

assert 'plano_assinatura_id' not in s, 'sobrou plano_assinatura_id em PowerPlantModal'
assert 'planosRecompensa' not in s, 'sobrou planosRecompensa em PowerPlantModal'

if crlf:
    s = s.replace('\n', '\r\n')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok, crlf =', crlf)
```

Expected: `ok, crlf = True`. Se alguma asserção falhar, **pare** e reporte qual âncora — o arquivo pode ter mudado no `main` (há edição não commitada de outra sessão no checkout principal).

- [ ] **Step 2: Conferir que o efeito do contrato fica depois das declarações que usa**

```bash
grep -n "const \[formData\|const \[planosUsina\|const planoUsinaSel\|const \[contractOpts" src/components/PowerPlantModal.jsx
```

Expected: `formData`, `planosUsina` e `contractOpts` aparecem **antes** de `const planoUsinaSel`. Se não, mova o bloco do passo 7 do script para logo depois da última dessas declarações.

- [ ] **Step 3: Checar sintaxe, lint e diff**

```bash
npx esbuild src/components/PowerPlantModal.jsx --loader:.jsx=jsx --outdir="$TMPDIR/esb"
npx eslint src/components/PowerPlantModal.jsx
git diff --stat
```

Expected: esbuild `Done`; eslint sem erro **novo** — se aparecer erro, confira se ele já existia na versão anterior (`git stash` é proibido aqui; use `git show HEAD:src/components/PowerPlantModal.jsx > <scratchpad>/ppm_antes.jsx` e rode o eslint nele); diff só em `PowerPlantModal.jsx`, sem troca de fim de linha (dezenas de linhas alteradas, não milhares).

- [ ] **Step 4: Commit**

```bash
git add src/components/PowerPlantModal.jsx
git commit -m "feat(plano-usina): usina escolhe plano de usina e originador; contrato le o plano

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verificação final e revisão

**Files:**
- Modify: `.superpowers/sdd/2026-09-27-split-de-pagamentos/progress.md` (ignorado pelo git — só registro)
- Modify: `C:\Users\Godoy\.claude\projects\C--Users-Godoy-Documents-HTML\memory\crm-indicacao-recorrencia.md`

- [ ] **Step 1: Rodar tudo de novo, do disco**

As 14 suítes SQL do Task 2 Step 8 (mensagens verbatim), `npx vitest run tests/plano-usina.test.js tests/plano-matriz.test.js tests/contrato.test.js` e a consulta da Task 1 Step 1. Confira também:

```sql
SELECT count(*) FROM public.planos_usina WHERE nome LIKE 'SANDBOX%';
SELECT count(*) FROM public.usinas WHERE plano_usina_id IS NOT NULL;
```

Esperado: 0 sobras de teste. Usinas vinculadas: 0, a menos que o dono tenha vinculado — se não for 0, liste quais e reporte.

- [ ] **Step 2: Pedir revisão de código**

Use superpowers:requesting-code-review sobre `git diff impl/split-pagamentos...HEAD`, com a spec e este plano como contexto. Corrija Critical/Important antes de seguir; registre os Minor.

- [ ] **Step 3: Registrar**

Acrescente ao fim de `progress.md` uma linha por task com commit, migração, md5 novos das funções patchadas e o resultado verbatim das suítes. Atualize a memória `crm-indicacao-recorrencia.md` com: plano de usina como fonte da gestão B2W; plano da UC com precedência; papel `originador_usina` (primeiro do corte; sem originador → associação); o fechamento mensal ainda precisa cobrar taxa de administração/recuperação e executar o bônus (spec §5).

- [ ] **Step 4: Desfazer o junction**

```bash
cmd //c rmdir node_modules
```

Rode na raiz do worktree **antes** de qualquer limpeza de worktree.

- [ ] **Step 5: Parar aqui**

Não fazer merge nem push. Reportar ao dono: o que entrou, as mensagens verbatim, os md5 novos, e o que fica para o fechamento mensal (spec §5).
