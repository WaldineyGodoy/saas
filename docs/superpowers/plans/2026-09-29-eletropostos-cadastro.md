# Eletropostos — cadastro e telas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** criar no CRM a entidade Eletroposto — com UC (e usina pela UC), fornecedores com percentual, originador, plano e tarifa do investidor — e a área no menu lateral com Kanban, lista e filtros.

**Architecture:** duas tabelas novas (`eletropostos`, `eletroposto_fornecedores`) com RLS fechada. Os fornecedores são gravados numa transação só, pela RPC `fn_salvar_fornecedores_eletroposto`. A soma dos percentuais é conferida por um gatilho de restrição adiado, que olha o estado final e não o intermediário. Toda regra pura da tela (filtros, validação, payload, tradução de erro) fica em `src/lib/eletropostos.js`, testada com `node --test`. A lista e o modal só montam a interface.

**Tech Stack:** Postgres/Supabase (RLS, gatilhos, RPC SECURITY INVOKER), React + Vite, `@dnd-kit` (o mesmo Kanban da `PowerPlantList`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-29-eletropostos-cadastro-design.md`

## Global Constraints

**Banco**
- Projeto Supabase `abbysvxnnhwvvzhftoms` (produção, sem staging).
- **DDL é aplicado pelo dono no SQL Editor**, porque o `apply_migration` em produção é bloqueado. O agente escreve o arquivo, pede ao dono para rodar e confere depois por `execute_sql` (só leitura e testes SANDBOX).
- Testes SQL:
  - bloco `DO $$ … $$` terminando em `RAISE EXCEPTION 'SANDBOX_OK'`, rodado pelo `execute_sql`;
  - **sucesso = erro `SANDBOX_OK`**;
  - nunca deixar resíduo.
- **Não muda nenhum gatilho** de `consumer_units`, `usinas`, `suppliers` ou `invoices`, e nada entra em `ledger_entries`.
- Os status do eletroposto são manuais: `pre_operacao` (padrão), `em_instalacao`, `operando`, `manutencao`, `inativo` e `cancelado`.
- **Uma UC atende no máximo um eletroposto** (`unique`). A usina **não tem coluna**: vem de `consumer_units.usina_id`.
- `plano_id` só aceita plano com `recorrente_config->>'categoria_plano' = 'eletroposto'`.
- A soma dos percentuais **ativos** dos fornecedores de um eletroposto nunca passa de 100. Abaixo de 100 é aceito.

**Acesso**
- Papéis internos (`public.fn_papel_interno()`: `super_admin`, `admin`, `manager`, `coordinator`) leem e gravam.
- O papel `supplier` só **lê** os eletropostos em que participa, via `suppliers.profile_id = auth.uid()`.
- `anon` não tem acesso.

**Repositório**
- Repo CRM: `C:\Users\Godoy\Documents\HTML\WorkSpace 1 Antigravity`.
- Branch `impl/eletropostos` em worktree `.claude/worktrees/eletropostos`.
- **Nunca fazer push em `main` sem autorização do dono**, porque o `main` publica `crm.b2wenergia.com.br`.
- **Worktree e `node_modules`:** a worktree usa junction de `node_modules`. Antes de remover a worktree, desfazer o link com `cmd //c "rmdir <worktree>\node_modules"`. Senão, o `git worktree remove` apaga o `node_modules` do checkout principal.
- **Commits:**
  - terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - não incluir arquivos de outras sessões (`.ua/`, `B2W Charge/`, `Plano de Recompensas/*`).

**Verificação**
- O repo não tem vitest instalado (o script `test` falha). Os testes de JS rodam com `node --test`.
- Lint: `npx eslint <arquivos>`.
  - Arquivo novo tem que dar 0 erros.
  - Arquivo existente não pode ter mais erros que no `main`.
- Build: `npm run build`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260929a_eletropostos.sql` | enum, duas tabelas, guardas (plano, soma), RPC de fornecedores, RLS |
| `supabase/tests/eletropostos.test.sql` | prova das guardas, da RPC e da RLS |
| `src/lib/eletropostos.js` | status, filtros, validação e payload dos fornecedores, payload do eletroposto, tradução de erro |
| `src/lib/eletropostos.test.js` | testes `node --test` da lib |
| `src/components/EletropostoModal.jsx` | cadastro em 4 abas (Dados, UC e Usina, Fornecedores, Técnico) |
| `src/pages/dashboards/EletropostoList.jsx` | Kanban/lista, filtros, abrir modal, arrastar status |
| `src/pages/Dashboard.jsx` (modificar) | item de menu e `case` da tela |

---

### Task 0: Worktree

**Files:** nenhum.

- [ ] **Step 1: criar a worktree e o junction**

```bash
cd "/c/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity"
git worktree add .claude/worktrees/eletropostos -b impl/eletropostos main
cmd //c mklink /J ".claude\\worktrees\\eletropostos\\node_modules" "node_modules"
```

Expected: `Preparing worktree (new branch 'impl/eletropostos')` e `Junction created`.

- [ ] **Step 2: conferir a base**

```bash
cd "/c/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity/.claude/worktrees/eletropostos"
git log --oneline -1
ls docs/superpowers/specs/2026-09-29-eletropostos-cadastro-design.md
```

Expected: o HEAD é o commit da spec (ou posterior no `main`), e o arquivo existe.

Todos os caminhos das tasks seguintes são relativos a essa worktree.

---

### Task 1: Banco — tabelas, guardas, RPC e RLS

**Files:**
- Create: `supabase/tests/eletropostos.test.sql`
- Create: `supabase/migrations/20260929a_eletropostos.sql`

**Interfaces produzidas (usadas pelas Tasks 2–4):**
- Tabela `public.eletropostos(id, nome, endereco jsonb, status eletroposto_status, consumer_unit_id, originator_id, plano_id, tarifa_investidor_kwh, qtd_carregadores, potencia_kw, tipo_recarga, fabricante, modelo, observacoes, created_at, updated_at)`.
- Tabela `public.eletroposto_fornecedores(id, eletroposto_id, supplier_id, percentual, ativo, created_at, updated_at)`.
- Restrição única `eletropostos_consumer_unit_id_key`.
- RPC `public.fn_salvar_fornecedores_eletroposto(p_eletroposto_id uuid, p_fornecedores jsonb) returns void`.
  - `p_fornecedores` é um array de `{ "supplier_id": uuid, "percentual": number, "ativo": boolean }`.
  - Erros:
    - `22023` para lista inválida, fornecedor vazio ou repetido;
    - `P0002` para eletroposto não encontrado ou sem permissão;
    - `23514` na soma acima de 100, disparado no commit.
- Mensagens de erro em português, prontas para mostrar ao usuário.

- [ ] **Step 1: escrever o teste**

`supabase/tests/eletropostos.test.sql`:

```sql
-- Eletropostos (projeto 1): estrutura, guardas, RPC de fornecedores e RLS.
-- Spec: docs/superpowers/specs/2026-09-29-eletropostos-cadastro-design.md
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
--
-- A soma dos percentuais e um gatilho ADIADO (confere no commit). Como este
-- bloco nunca comita, o teste forca a conferencia com SET CONSTRAINTS ...
-- IMMEDIATE, que dispara na hora os eventos pendentes.
DO $$
DECLARE
  v_adm      uuid := gen_random_uuid();   -- admin (papel interno)
  v_forn_usr uuid := gen_random_uuid();   -- usuario do fornecedor A
  v_outro    uuid := gen_random_uuid();   -- usuario de um fornecedor sem eletroposto
  v_assin    uuid := gen_random_uuid();   -- assinante (papel nao interno)
  v_dono     text := current_user;
  v_sup_a    uuid;
  v_sup_b    uuid;
  v_sup_c    uuid;
  v_sup_x    uuid;
  v_uc1      uuid;
  v_uc2      uuid;
  v_plano_el uuid;
  v_plano_as uuid;
  v_e1       uuid;
  v_e2       uuid;
  v_n        integer;
  v_num      numeric;
  v_txt      text;
  v_erro     text;
  v_state    text;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (v_adm,      'adm.eletro@teste.invalid',   '{"name":"Admin"}',        'authenticated', 'authenticated'),
    (v_forn_usr, 'forn.eletro@teste.invalid',  '{"name":"Fornecedor A"}', 'authenticated', 'authenticated'),
    (v_outro,    'outro.eletro@teste.invalid', '{"name":"Fornecedor X"}', 'authenticated', 'authenticated'),
    (v_assin,    'assin.eletro@teste.invalid', '{"name":"Assinante"}',    'authenticated', 'authenticated');

  UPDATE public.profiles SET role = 'admin'      WHERE id = v_adm;
  UPDATE public.profiles SET role = 'supplier'   WHERE id IN (v_forn_usr, v_outro);
  UPDATE public.profiles SET role = 'subscriber' WHERE id = v_assin;
  SELECT count(*) INTO v_n FROM public.profiles WHERE id IN (v_adm, v_forn_usr, v_outro, v_assin);
  IF v_n <> 4 THEN RAISE EXCEPTION 'FIXTURE: so % dos 4 perfis foram criados', v_n; END IF;

  INSERT INTO public.suppliers (name, profile_id) VALUES ('Forn A eletro teste', v_forn_usr) RETURNING id INTO v_sup_a;
  INSERT INTO public.suppliers (name) VALUES ('Forn B eletro teste') RETURNING id INTO v_sup_b;
  INSERT INTO public.suppliers (name) VALUES ('Forn C eletro teste') RETURNING id INTO v_sup_c;
  INSERT INTO public.suppliers (name, profile_id) VALUES ('Forn X eletro teste', v_outro) RETURNING id INTO v_sup_x;

  INSERT INTO public.consumer_units (numero_uc) VALUES ('TESTE-ELETRO-0001') RETURNING id INTO v_uc1;
  INSERT INTO public.consumer_units (numero_uc) VALUES ('TESTE-ELETRO-0002') RETURNING id INTO v_uc2;

  INSERT INTO public.planos_assinatura_energia (nome, recorrente_config)
  VALUES ('Plano eletro teste', '{"categoria_plano":"eletroposto"}'::jsonb) RETURNING id INTO v_plano_el;
  INSERT INTO public.planos_assinatura_energia (nome, recorrente_config)
  VALUES ('Plano assinatura teste', '{}'::jsonb) RETURNING id INTO v_plano_as;

  -- =====================================================================
  -- 1) Estrutura: status padrao, UC unica, plano so de eletroposto, nome
  -- =====================================================================
  INSERT INTO public.eletropostos (nome, consumer_unit_id, plano_id)
  VALUES ('Eletroposto teste 1', v_uc1, v_plano_el) RETURNING id INTO v_e1;

  SELECT status::text INTO v_txt FROM public.eletropostos WHERE id = v_e1;
  IF v_txt <> 'pre_operacao' THEN RAISE EXCEPTION 'FALHOU: status padrao e % (esperado pre_operacao)', v_txt; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletropostos (nome, consumer_unit_id) VALUES ('Repete UC', v_uc1);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'FALHOU: UC repetida deu % (esperado 23505): %', v_state, v_erro; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletropostos (nome, plano_id) VALUES ('Plano errado', v_plano_as);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: plano de assinatura deu % (esperado 23514): %', v_state, v_erro; END IF;
  IF v_erro NOT ILIKE '%plano de eletroposto%' THEN RAISE EXCEPTION 'FALHOU: mensagem pouco clara no plano: %', v_erro; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletropostos (nome) VALUES ('   ');
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: nome vazio deu % (esperado 23514): %', v_state, v_erro; END IF;

  INSERT INTO public.eletropostos (nome, consumer_unit_id) VALUES ('Eletroposto teste 2', v_uc2) RETURNING id INTO v_e2;

  -- updated_at: now() e fixo na transacao, entao o teste envelhece a linha
  -- antes de atualizar.
  UPDATE public.eletropostos SET updated_at = '2000-01-01' WHERE id = v_e1;
  UPDATE public.eletropostos SET nome = 'Eletroposto teste 1b' WHERE id = v_e1;
  SELECT count(*) INTO v_n FROM public.eletropostos WHERE id = v_e1 AND updated_at > '2001-01-01';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: updated_at nao foi atualizado'; END IF;

  -- =====================================================================
  -- 2) Fornecedores direto na tabela (conferencia imediata)
  -- =====================================================================
  SET CONSTRAINTS public.trg_eletroposto_fornecedores_soma IMMEDIATE;

  INSERT INTO public.eletroposto_fornecedores (eletroposto_id, supplier_id, percentual)
  VALUES (v_e1, v_sup_a, 60), (v_e1, v_sup_b, 40);   -- 100 exatos: aceito

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletroposto_fornecedores (eletroposto_id, supplier_id, percentual) VALUES (v_e1, v_sup_c, 0.01);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: soma 100,01 deu % (esperado 23514): %', v_state, v_erro; END IF;
  IF v_erro NOT ILIKE '%100%' THEN RAISE EXCEPTION 'FALHOU: mensagem da soma nao cita 100%%: %', v_erro; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletroposto_fornecedores (eletroposto_id, supplier_id, percentual) VALUES (v_e1, v_sup_a, 1);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'FALHOU: fornecedor repetido deu % (esperado 23505): %', v_state, v_erro; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletroposto_fornecedores (eletroposto_id, supplier_id, percentual) VALUES (v_e2, v_sup_c, 0);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: percentual 0 deu % (esperado 23514): %', v_state, v_erro; END IF;

  -- inativo nao conta na soma
  UPDATE public.eletroposto_fornecedores SET ativo = false WHERE eletroposto_id = v_e1 AND supplier_id = v_sup_b;
  INSERT INTO public.eletroposto_fornecedores (eletroposto_id, supplier_id, percentual) VALUES (v_e1, v_sup_c, 40);
  DELETE FROM public.eletroposto_fornecedores WHERE eletroposto_id = v_e1 AND supplier_id IN (v_sup_b, v_sup_c);

  -- =====================================================================
  -- 3) RPC fn_salvar_fornecedores_eletroposto (conferencia adiada, como em
  --    producao: cada chamada do PostgREST e uma transacao)
  -- =====================================================================
  SET CONSTRAINTS public.trg_eletroposto_fornecedores_soma DEFERRED;

  -- estado: A=60. Troca para A=40, B=60 (passa por 100 so no fim).
  PERFORM public.fn_salvar_fornecedores_eletroposto(v_e1,
    jsonb_build_array(jsonb_build_object('supplier_id', v_sup_a, 'percentual', 40),
                      jsonb_build_object('supplier_id', v_sup_b, 'percentual', 60)));
  SET CONSTRAINTS public.trg_eletroposto_fornecedores_soma IMMEDIATE;
  SELECT count(*), sum(percentual) INTO v_n, v_num FROM public.eletroposto_fornecedores WHERE eletroposto_id = v_e1 AND ativo;
  IF v_n <> 2 OR v_num <> 100 THEN RAISE EXCEPTION 'FALHOU: RPC deixou % linha(s) somando %', v_n, v_num; END IF;
  SELECT percentual INTO v_num FROM public.eletroposto_fornecedores WHERE eletroposto_id = v_e1 AND supplier_id = v_sup_a;
  IF v_num <> 40 THEN RAISE EXCEPTION 'FALHOU: RPC nao atualizou A (ficou %)', v_num; END IF;

  -- remove B, entra C
  SET CONSTRAINTS public.trg_eletroposto_fornecedores_soma DEFERRED;
  PERFORM public.fn_salvar_fornecedores_eletroposto(v_e1,
    jsonb_build_array(jsonb_build_object('supplier_id', v_sup_a, 'percentual', 40),
                      jsonb_build_object('supplier_id', v_sup_c, 'percentual', 60, 'ativo', true)));
  SET CONSTRAINTS public.trg_eletroposto_fornecedores_soma IMMEDIATE;
  SELECT count(*) INTO v_n FROM public.eletroposto_fornecedores WHERE eletroposto_id = v_e1 AND supplier_id = v_sup_b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: RPC nao removeu o fornecedor que saiu da lista'; END IF;

  -- soma 120: recusada no commit, e nada muda
  v_state := NULL;
  BEGIN
    SET CONSTRAINTS public.trg_eletroposto_fornecedores_soma DEFERRED;
    PERFORM public.fn_salvar_fornecedores_eletroposto(v_e1,
      jsonb_build_array(jsonb_build_object('supplier_id', v_sup_a, 'percentual', 60),
                        jsonb_build_object('supplier_id', v_sup_c, 'percentual', 60)));
    SET CONSTRAINTS public.trg_eletroposto_fornecedores_soma IMMEDIATE;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  SET CONSTRAINTS public.trg_eletroposto_fornecedores_soma IMMEDIATE;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: RPC com soma 120 deu % (esperado 23514): %', v_state, v_erro; END IF;
  SELECT sum(percentual) INTO v_num FROM public.eletroposto_fornecedores WHERE eletroposto_id = v_e1 AND ativo;
  IF v_num <> 100 THEN RAISE EXCEPTION 'FALHOU: RPC recusada alterou os percentuais (soma %)', v_num; END IF;

  -- fornecedor repetido e fornecedor vazio na lista
  v_state := NULL;
  BEGIN
    PERFORM public.fn_salvar_fornecedores_eletroposto(v_e1,
      jsonb_build_array(jsonb_build_object('supplier_id', v_sup_a, 'percentual', 10),
                        jsonb_build_object('supplier_id', v_sup_a, 'percentual', 10)));
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'FALHOU: lista com repetido deu % (esperado 22023): %', v_state, v_erro; END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.fn_salvar_fornecedores_eletroposto(v_e1, '[{"percentual": 10}]'::jsonb);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'FALHOU: fornecedor vazio deu % (esperado 22023): %', v_state, v_erro; END IF;

  -- lista vazia remove todos
  PERFORM public.fn_salvar_fornecedores_eletroposto(v_e2, '[]'::jsonb);

  -- =====================================================================
  -- 4) RLS
  -- =====================================================================
  PERFORM set_config('role', 'authenticated', true);

  -- 4a) fornecedor A: le so o eletroposto em que participa, nao grava
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_forn_usr, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.eletropostos WHERE id IN (v_e1, v_e2);
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: fornecedor A enxerga % eletroposto(s) (esperado 1)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.eletroposto_fornecedores WHERE eletroposto_id = v_e1;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: fornecedor A enxerga % socio(s) do proprio eletroposto (esperado 2)', v_n; END IF;

  UPDATE public.eletropostos SET nome = 'invadido' WHERE id = v_e1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: fornecedor alterou o eletroposto'; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletropostos (nome) VALUES ('forjado');
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: fornecedor inseriu eletroposto (SQLSTATE %)', v_state; END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.fn_salvar_fornecedores_eletroposto(v_e1,
      jsonb_build_array(jsonb_build_object('supplier_id', v_sup_a, 'percentual', 100)));
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM 'P0002' THEN RAISE EXCEPTION 'FALHOU: fornecedor usou a RPC (SQLSTATE %): %', v_state, v_erro; END IF;

  -- 4b) fornecedor sem eletroposto e assinante: nada
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outro, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.eletropostos;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: fornecedor alheio enxerga % eletroposto(s)', v_n; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_assin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.eletropostos;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: assinante enxerga % eletroposto(s)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.eletroposto_fornecedores;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: assinante enxerga % linha(s) de fornecedores', v_n; END IF;

  -- 4c) admin: le e grava tudo, usa a RPC
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.eletropostos WHERE id IN (v_e1, v_e2);
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: admin enxerga % dos 2 eletropostos', v_n; END IF;
  UPDATE public.eletropostos SET status = 'operando' WHERE id = v_e2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao mudou o status'; END IF;
  PERFORM public.fn_salvar_fornecedores_eletroposto(v_e2,
    jsonb_build_array(jsonb_build_object('supplier_id', v_sup_x, 'percentual', 100)));

  -- 4d) anon: sem acesso nenhum
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  v_state := NULL;
  BEGIN
    SELECT count(*) INTO v_n FROM public.eletropostos;
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: anon consultou eletropostos (SQLSTATE %)', v_state; END IF;

  PERFORM set_config('role', v_dono, true);

  -- =====================================================================
  -- 5) Excluir o eletroposto leva os fornecedores junto; a UC fica
  -- =====================================================================
  DELETE FROM public.eletropostos WHERE id = v_e1;
  SELECT count(*) INTO v_n FROM public.eletroposto_fornecedores WHERE eletroposto_id = v_e1;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: fornecedores sobraram apos excluir o eletroposto'; END IF;
  SELECT count(*) INTO v_n FROM public.consumer_units WHERE id = v_uc1;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: excluir o eletroposto apagou a UC'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
```

- [ ] **Step 2: rodar o teste antes da migração (RED)**

Rodar o conteúdo do arquivo pelo MCP `execute_sql` (projeto `abbysvxnnhwvvzhftoms`).

Expected: falha com `relation "public.eletropostos" does not exist`, ou erro de `SET CONSTRAINTS` com a restrição inexistente. Qualquer erro diferente de `SANDBOX_OK` conta como RED.

**Se a falha vier dos fixtures** (INSERT em `suppliers`, `consumer_units` ou `planos_assinatura_energia` recusado por algum gatilho): corrigir **só o fixture** (acrescentar a coluna exigida) e repetir. Nunca mexer em gatilho existente.

- [ ] **Step 3: escrever a migração**

`supabase/migrations/20260929a_eletropostos.sql`:

```sql
-- Eletropostos no CRM — cadastro (projeto 1).
-- Spec: docs/superpowers/specs/2026-09-29-eletropostos-cadastro-design.md
--
-- Cadeia: usina -> compensa na UC -> a UC fornece ao eletroposto.
-- So cria o que e novo: nenhum gatilho de UC, usina, fornecedor ou fatura
-- muda, e nada entra no razao. O dinheiro (energia fornecida x tarifa do
-- investidor - despesas) e o projeto 2.

-- ---------------------------------------------------------------------------
-- 1. Status (manual, espelha a usina)
-- ---------------------------------------------------------------------------
create type public.eletroposto_status as enum
    ('pre_operacao', 'em_instalacao', 'operando', 'manutencao', 'inativo', 'cancelado');

-- ---------------------------------------------------------------------------
-- 2. Eletroposto
-- ---------------------------------------------------------------------------
create table public.eletropostos (
    id                    uuid primary key default gen_random_uuid(),
    nome                  text not null check (btrim(nome) <> ''),
    endereco              jsonb not null default '{}'::jsonb,
    status                public.eletroposto_status not null default 'pre_operacao',
    -- Uma UC atende no maximo um eletroposto. A usina vem da UC.
    consumer_unit_id      uuid unique references public.consumer_units(id) on delete set null,
    -- Hierarquia (Lider, Parceiro Power) do split: e do eletroposto, nao do fornecedor.
    originator_id         uuid references public.originators_v2(id) on delete set null,
    plano_id              uuid references public.planos_assinatura_energia(id) on delete set null,
    tarifa_investidor_kwh numeric(10,4) check (tarifa_investidor_kwh >= 0),
    qtd_carregadores      integer check (qtd_carregadores >= 0),
    potencia_kw           numeric check (potencia_kw >= 0),
    tipo_recarga          text check (tipo_recarga in ('AC', 'DC', 'AC_DC')),
    fabricante            text,
    modelo                text,
    observacoes           text,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

comment on table public.eletropostos is
    'Eletroposto: consome de uma UC (que e compensada por uma usina) e tem um ou mais fornecedores (eletroposto_fornecedores). Status manual.';
comment on column public.eletropostos.consumer_unit_id is
    'UC que fornece energia ao eletroposto. Unica. A usina e lida por consumer_units.usina_id, nunca gravada aqui.';
comment on column public.eletropostos.originator_id is
    'Originador cuja hierarquia (Lider, Parceiro Power) entra no split do eletroposto.';
comment on column public.eletropostos.tarifa_investidor_kwh is
    'Tarifa do investidor (piso), R$/kWh. Base do projeto 2: energia fornecida x tarifa do investidor - despesas.';

create index eletropostos_originator_id_idx on public.eletropostos (originator_id);
create index eletropostos_plano_id_idx on public.eletropostos (plano_id);

create trigger trg_eletropostos_updated_at
    before update on public.eletropostos
    for each row execute function public.handle_updated_at();

-- So plano da aba Eletropostos (categoria_plano = 'eletroposto').
create or replace function public.fn_eletroposto_plano_valido()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.plano_id is not null and not exists (
        select 1 from planos_assinatura_energia p
         where p.id = new.plano_id
           and p.recorrente_config->>'categoria_plano' = 'eletroposto'
    ) then
        raise exception 'O plano escolhido não é um plano de eletroposto.'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger trg_eletroposto_plano_valido
    before insert or update of plano_id on public.eletropostos
    for each row execute function public.fn_eletroposto_plano_valido();

-- ---------------------------------------------------------------------------
-- 3. Fornecedores do eletroposto (divisao do lucro)
-- ---------------------------------------------------------------------------
create table public.eletroposto_fornecedores (
    id             uuid primary key default gen_random_uuid(),
    eletroposto_id uuid not null references public.eletropostos(id) on delete cascade,
    supplier_id    uuid not null references public.suppliers(id),
    percentual     numeric(5,2) not null check (percentual > 0 and percentual <= 100),
    ativo          boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (eletroposto_id, supplier_id)
);

comment on table public.eletroposto_fornecedores is
    'Fornecedores (investidores) do eletroposto e o percentual de cada um. Soma dos ativos <= 100 (gatilho adiado). Gravar pela RPC fn_salvar_fornecedores_eletroposto.';

create index eletroposto_fornecedores_supplier_id_idx on public.eletroposto_fornecedores (supplier_id);

create trigger trg_eletroposto_fornecedores_updated_at
    before update on public.eletroposto_fornecedores
    for each row execute function public.handle_updated_at();

-- Adiado: confere o estado final da transacao, entao trocar 60/40 por 40/60
-- nao falha no meio do caminho.
create or replace function public.fn_eletroposto_fornecedores_soma()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_soma numeric;
begin
    select coalesce(sum(percentual), 0) into v_soma
      from eletroposto_fornecedores
     where eletroposto_id = new.eletroposto_id
       and ativo;

    if v_soma > 100 then
        raise exception using
            errcode = '23514',
            message = format('A soma dos percentuais dos fornecedores do eletroposto passa de 100%% (%s%%).', v_soma);
    end if;
    return null;
end;
$$;

create constraint trigger trg_eletroposto_fornecedores_soma
    after insert or update on public.eletroposto_fornecedores
    deferrable initially deferred
    for each row execute function public.fn_eletroposto_fornecedores_soma();

-- Grava a lista inteira numa transacao so: remove quem saiu, insere quem
-- entrou e atualiza so o que mudou. SECURITY INVOKER: a RLS decide quem pode.
create or replace function public.fn_salvar_fornecedores_eletroposto(
    p_eletroposto_id uuid,
    p_fornecedores   jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_lista jsonb := coalesce(p_fornecedores, '[]'::jsonb);
begin
    if jsonb_typeof(v_lista) <> 'array' then
        raise exception 'Lista de fornecedores inválida.' using errcode = '22023';
    end if;

    if exists (select 1 from jsonb_array_elements(v_lista) x
                where coalesce(x->>'supplier_id', '') = '') then
        raise exception 'Há fornecedor sem identificação na lista.' using errcode = '22023';
    end if;

    if exists (select 1 from jsonb_array_elements(v_lista) x
                group by x->>'supplier_id' having count(*) > 1) then
        raise exception 'O mesmo fornecedor aparece duas vezes na lista.' using errcode = '22023';
    end if;

    -- FOR UPDATE exige a politica de escrita: quem so le cai aqui.
    perform 1 from eletropostos where id = p_eletroposto_id for update;
    if not found then
        raise exception 'Eletroposto não encontrado ou sem permissão para alterar.' using errcode = 'P0002';
    end if;

    delete from eletroposto_fornecedores f
     where f.eletroposto_id = p_eletroposto_id
       and not exists (select 1 from jsonb_array_elements(v_lista) x
                        where (x->>'supplier_id')::uuid = f.supplier_id);

    insert into eletroposto_fornecedores (eletroposto_id, supplier_id, percentual, ativo)
    select p_eletroposto_id,
           (x->>'supplier_id')::uuid,
           (x->>'percentual')::numeric,
           coalesce((x->>'ativo')::boolean, true)
      from jsonb_array_elements(v_lista) x
    on conflict (eletroposto_id, supplier_id) do update
       set percentual = excluded.percentual,
           ativo      = excluded.ativo
     where (eletroposto_fornecedores.percentual, eletroposto_fornecedores.ativo)
           is distinct from (excluded.percentual, excluded.ativo);
end;
$$;

revoke all on function public.fn_salvar_fornecedores_eletroposto(uuid, jsonb) from public, anon;
grant execute on function public.fn_salvar_fornecedores_eletroposto(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Acesso
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para a politica de uma tabela nao depender da RLS da outra.
create or replace function public.fn_eletroposto_do_fornecedor(p_eletroposto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1
          from eletroposto_fornecedores f
          join suppliers s on s.id = f.supplier_id
         where f.eletroposto_id = p_eletroposto_id
           and s.profile_id = auth.uid()
    );
$$;

revoke all on function public.fn_eletroposto_do_fornecedor(uuid) from public, anon;
grant execute on function public.fn_eletroposto_do_fornecedor(uuid) to authenticated;

alter table public.eletropostos enable row level security;
alter table public.eletroposto_fornecedores enable row level security;

revoke all on public.eletropostos from anon;
revoke all on public.eletroposto_fornecedores from anon;

create policy eletropostos_interno on public.eletropostos
    for all to authenticated
    using (public.fn_papel_interno())
    with check (public.fn_papel_interno());

create policy eletropostos_fornecedor_le on public.eletropostos
    for select to authenticated
    using (public.fn_eletroposto_do_fornecedor(id));

create policy eletroposto_fornecedores_interno on public.eletroposto_fornecedores
    for all to authenticated
    using (public.fn_papel_interno())
    with check (public.fn_papel_interno());

create policy eletroposto_fornecedores_fornecedor_le on public.eletroposto_fornecedores
    for select to authenticated
    using (public.fn_eletroposto_do_fornecedor(eletroposto_id));
```

Observação sobre a mensagem da soma: ela é montada por `format()`, em que `%%` é um `%` literal e `%s` é o valor. A mensagem sai como "passa de 100% (120.00%)".

Se o PL/pgSQL do teste recusar `SET CONSTRAINTS` direto, trocar cada linha por `EXECUTE 'SET CONSTRAINTS public.trg_eletroposto_fornecedores_soma IMMEDIATE';` (ou `DEFERRED`). A migração não muda por isso.

- [ ] **Step 4: pedir ao dono para aplicar**

Mensagem ao dono: "Rode no SQL Editor o arquivo `supabase/migrations/20260929a_eletropostos.sql` (branch `impl/eletropostos`). Ele só cria o que é novo: enum, duas tabelas, 4 funções e as políticas."

Esperar a confirmação.

- [ ] **Step 5: rodar o teste (GREEN)**

Rodar `supabase/tests/eletropostos.test.sql` pelo `execute_sql`.

Expected: erro `SANDBOX_OK`.

- [ ] **Step 6: conferir que nada sobrou e que nada existente mudou**

```sql
select (select count(*) from public.eletropostos) eletropostos,
       (select count(*) from public.eletroposto_fornecedores) fornecedores,
       (select count(*) from public.suppliers where name like '%eletro teste%') sup_teste,
       (select count(*) from public.consumer_units where numero_uc like 'TESTE-ELETRO-%') uc_teste,
       (select count(*) from public.planos_assinatura_energia where nome like '%teste') planos_teste;
```

Expected: tudo `0`.

- [ ] **Step 7: commit**

```bash
git add supabase/migrations/20260929a_eletropostos.sql supabase/tests/eletropostos.test.sql
git commit -m "feat(eletropostos): tabelas, guardas de UC/plano/soma, RPC de fornecedores e RLS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regras da tela em `src/lib/eletropostos.js`

**Files:**
- Create: `src/lib/eletropostos.test.js`
- Create: `src/lib/eletropostos.js`

**Interfaces produzidas (usadas pelas Tasks 3 e 4):**
- `STATUS_ELETROPOSTO: Array<{status, label, color, bg}>`, nas 6 colunas e na ordem do Kanban.
- `TIPOS_RECARGA: Array<{value, label}>`.
- `statusConfig(status) -> {status, label, color, bg}`; um status desconhecido cai no primeiro.
- `usinaDoEletroposto(e) -> {id, name, status} | null`, que lê `e.consumer_unit.usina`.
- `filtrarEletropostos(lista, {busca, status, usinaId, supplierId, originatorId}) -> lista`.
- `somaPercentuais(fornecedores) -> number`: só os ativos, com 2 casas.
- `validarFornecedores(fornecedores) -> string | null`: mensagem que bloqueia o salvar, ou `null`.
- `paraPayloadFornecedores(fornecedores) -> Array<{supplier_id, percentual:number, ativo:boolean}>`.
- `montarPayloadEletroposto(form) -> objeto de colunas de eletropostos`.
- `mensagemErroEletroposto(error) -> string`.

Formato das linhas de fornecedor no estado da tela: `{ supplier_id: string, percentual: string|number, ativo: boolean }`.

Formato do `form`: `{ nome, status, plano_id, originator_id, tarifa_investidor_kwh, consumer_unit_id, cep, rua, numero, bairro, cidade, uf, ibge, qtd_carregadores, potencia_kw, tipo_recarga, fabricante, modelo, observacoes }`. Todos são strings; os números podem vir como `''`.

- [ ] **Step 1: escrever o teste**

`src/lib/eletropostos.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    STATUS_ELETROPOSTO,
    statusConfig,
    usinaDoEletroposto,
    filtrarEletropostos,
    somaPercentuais,
    validarFornecedores,
    paraPayloadFornecedores,
    montarPayloadEletroposto,
    mensagemErroEletroposto,
} from './eletropostos.js';

const E1 = {
    id: 'e1', nome: 'Posto Centro', status: 'operando', originator_id: 'o1',
    endereco: { cidade: 'Natal', uf: 'RN' },
    consumer_unit: { id: 'uc1', numero_uc: '7010192824', usina: { id: 'u1', name: 'Bom Jesus II' } },
    fornecedores: [{ supplier_id: 's1', percentual: 60, ativo: true }, { supplier_id: 's2', percentual: 40, ativo: true }],
};
const E2 = {
    id: 'e2', nome: 'Shopping Sul', status: 'pre_operacao', originator_id: null,
    endereco: { cidade: 'Parnamirim', uf: 'RN' },
    consumer_unit: null,
    fornecedores: [{ supplier_id: 's3', percentual: 100, ativo: true }],
};

test('status: seis colunas na ordem do Kanban', () => {
    assert.deepEqual(
        STATUS_ELETROPOSTO.map(s => s.status),
        ['pre_operacao', 'em_instalacao', 'operando', 'manutencao', 'inativo', 'cancelado'],
    );
    assert.equal(statusConfig('operando').label, 'Operando');
    assert.equal(statusConfig('xpto').status, 'pre_operacao');
});

test('usina vem da UC, e nulo sem UC', () => {
    assert.equal(usinaDoEletroposto(E1).name, 'Bom Jesus II');
    assert.equal(usinaDoEletroposto(E2), null);
    assert.equal(usinaDoEletroposto(null), null);
});

test('filtros: busca por nome, UC e cidade, sem diferenciar maiusculas', () => {
    const lista = [E1, E2];
    assert.deepEqual(filtrarEletropostos(lista, { busca: 'centro' }).map(e => e.id), ['e1']);
    assert.deepEqual(filtrarEletropostos(lista, { busca: '7010192' }).map(e => e.id), ['e1']);
    assert.deepEqual(filtrarEletropostos(lista, { busca: 'PARNA' }).map(e => e.id), ['e2']);
    assert.deepEqual(filtrarEletropostos(lista, {}).map(e => e.id), ['e1', 'e2']);
});

test('filtros: status, usina, fornecedor e originador combinam', () => {
    const lista = [E1, E2];
    assert.deepEqual(filtrarEletropostos(lista, { status: 'pre_operacao' }).map(e => e.id), ['e2']);
    assert.deepEqual(filtrarEletropostos(lista, { usinaId: 'u1' }).map(e => e.id), ['e1']);
    assert.deepEqual(filtrarEletropostos(lista, { supplierId: 's3' }).map(e => e.id), ['e2']);
    assert.deepEqual(filtrarEletropostos(lista, { originatorId: 'o1' }).map(e => e.id), ['e1']);
    assert.deepEqual(filtrarEletropostos(lista, { originatorId: 'o1', status: 'pre_operacao' }), []);
});

test('soma: so os ativos, duas casas', () => {
    assert.equal(somaPercentuais([{ percentual: '33.33' }, { percentual: 33.33 }, { percentual: '33.34' }]), 100);
    assert.equal(somaPercentuais([{ percentual: 60 }, { percentual: 40, ativo: false }]), 60);
    assert.equal(somaPercentuais([]), 0);
    assert.equal(somaPercentuais(undefined), 0);
});

test('validacao dos fornecedores', () => {
    assert.equal(validarFornecedores([]), null);
    assert.equal(validarFornecedores([{ supplier_id: 's1', percentual: '60' }, { supplier_id: 's2', percentual: '40' }]), null);
    assert.match(validarFornecedores([{ supplier_id: '', percentual: '10' }]), /Escolha o fornecedor/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '10' }, { supplier_id: 's1', percentual: '10' }]), /duas vezes/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '0' }]), /maior que 0/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '' }]), /maior que 0/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '100.5' }]), /maior que 0/);
    assert.match(validarFornecedores([{ supplier_id: 's1', percentual: '70' }, { supplier_id: 's2', percentual: '40' }]), /passa de 100% \(110%\)/);
    // inativo nao entra na soma
    assert.equal(validarFornecedores([{ supplier_id: 's1', percentual: '70' }, { supplier_id: 's2', percentual: '40', ativo: false }]), null);
});

test('payload dos fornecedores para a RPC', () => {
    assert.deepEqual(
        paraPayloadFornecedores([{ supplier_id: 's1', percentual: '60.5' }, { supplier_id: 's2', percentual: 39.5, ativo: false }]),
        [{ supplier_id: 's1', percentual: 60.5, ativo: true }, { supplier_id: 's2', percentual: 39.5, ativo: false }],
    );
});

test('payload do eletroposto: vazios viram null e endereco vira jsonb', () => {
    const form = {
        nome: '  Posto Centro ', status: 'operando', plano_id: '', originator_id: 'o1',
        tarifa_investidor_kwh: '0.85', consumer_unit_id: '', cep: '59000-000', rua: 'Rua A', numero: '10',
        bairro: 'Centro', cidade: 'Natal', uf: 'RN', ibge: '2408102', qtd_carregadores: '2', potencia_kw: '',
        tipo_recarga: '', fabricante: ' Joult ', modelo: '', observacoes: '',
    };
    assert.deepEqual(montarPayloadEletroposto(form), {
        nome: 'Posto Centro', status: 'operando', plano_id: null, originator_id: 'o1',
        tarifa_investidor_kwh: 0.85, consumer_unit_id: null,
        endereco: { cep: '59000-000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Natal', uf: 'RN', ibge: '2408102' },
        qtd_carregadores: 2, potencia_kw: null, tipo_recarga: null, fabricante: 'Joult', modelo: null, observacoes: null,
    });
});

test('mensagem de erro: UC ja usada, plano errado e generico', () => {
    assert.equal(
        mensagemErroEletroposto({ code: '23505', message: 'duplicate key value violates unique constraint "eletropostos_consumer_unit_id_key"' }),
        'Essa UC já está ligada a outro eletroposto.',
    );
    assert.equal(
        mensagemErroEletroposto({ code: '23514', message: 'O plano escolhido não é um plano de eletroposto.' }),
        'O plano escolhido não é um plano de eletroposto.',
    );
    assert.equal(mensagemErroEletroposto({ message: 'falhou' }), 'falhou');
    assert.equal(mensagemErroEletroposto(null), 'Erro desconhecido.');
});
```

- [ ] **Step 2: rodar (RED)**

```bash
node --test src/lib/eletropostos.test.js
```

Expected: FAIL com `Cannot find module ... eletropostos.js`.

- [ ] **Step 3: implementar**

`src/lib/eletropostos.js`:

```js
/**
 * Eletropostos — regras puras da tela (sem React, sem Supabase).
 * Spec: docs/superpowers/specs/2026-09-29-eletropostos-cadastro-design.md
 *
 * Quem decide de verdade e o banco (migracao 20260929a): UC unica, plano so
 * de eletroposto e soma dos fornecedores <= 100. Isto aqui so evita mandar
 * ao banco o que ele vai recusar e traduz o que ele recusou.
 */

export const STATUS_ELETROPOSTO = [
    { status: 'pre_operacao', label: 'Pré-Operação', color: '#6d28d9', bg: '#ede9fe' },
    { status: 'em_instalacao', label: 'Em Instalação', color: '#9a3412', bg: '#ffedd5' },
    { status: 'operando', label: 'Operando', color: '#166534', bg: '#dcfce7' },
    { status: 'manutencao', label: 'Manutenção', color: '#991b1b', bg: '#fee2e2' },
    { status: 'inativo', label: 'Inativo', color: '#64748b', bg: '#f1f5f9' },
    { status: 'cancelado', label: 'Cancelado', color: '#94a3b8', bg: '#f1f5f9' },
];

export const TIPOS_RECARGA = [
    { value: 'AC', label: 'AC' },
    { value: 'DC', label: 'DC' },
    { value: 'AC_DC', label: 'AC e DC' },
];

export const statusConfig = (status) =>
    STATUS_ELETROPOSTO.find(s => s.status === status) || STATUS_ELETROPOSTO[0];

// A usina nunca e gravada no eletroposto: vem da UC.
export const usinaDoEletroposto = (eletroposto) => eletroposto?.consumer_unit?.usina || null;

export const filtrarEletropostos = (lista, filtros = {}) => {
    const { busca = '', status = '', usinaId = '', supplierId = '', originatorId = '' } = filtros;
    const termo = busca.trim().toLowerCase();

    return (lista || []).filter(e => {
        if (status && e.status !== status) return false;
        if (usinaId && usinaDoEletroposto(e)?.id !== usinaId) return false;
        if (supplierId && !(e.fornecedores || []).some(f => f.supplier_id === supplierId)) return false;
        if (originatorId && e.originator_id !== originatorId) return false;
        if (!termo) return true;
        return [e.nome, e.consumer_unit?.numero_uc, e.endereco?.cidade]
            .some(v => String(v || '').toLowerCase().includes(termo));
    });
};

// Duas casas, como a coluna numeric(5,2): 33,33 + 33,33 + 33,34 = 100.
export const somaPercentuais = (fornecedores) =>
    Math.round(
        (fornecedores || [])
            .filter(f => f.ativo !== false)
            .reduce((acc, f) => acc + (Number(f.percentual) || 0), 0) * 100
    ) / 100;

export const validarFornecedores = (fornecedores) => {
    const lista = fornecedores || [];
    const vistos = new Set();

    for (const f of lista) {
        if (!f.supplier_id) return 'Escolha o fornecedor em todas as linhas.';
        if (vistos.has(f.supplier_id)) return 'O mesmo fornecedor aparece duas vezes.';
        vistos.add(f.supplier_id);

        const p = f.percentual === '' || f.percentual === null ? NaN : Number(f.percentual);
        if (!(p > 0 && p <= 100)) return 'Cada percentual precisa ser maior que 0 e no máximo 100.';
    }

    const soma = somaPercentuais(lista);
    if (soma > 100) return `A soma dos percentuais passa de 100% (${soma}%).`;
    return null;
};

export const paraPayloadFornecedores = (fornecedores) =>
    (fornecedores || []).map(f => ({
        supplier_id: f.supplier_id,
        percentual: Number(f.percentual),
        ativo: f.ativo !== false,
    }));

const numeroOuNulo = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const textoOuNulo = (v) => {
    const t = String(v ?? '').trim();
    return t === '' ? null : t;
};

export const montarPayloadEletroposto = (form) => ({
    nome: form.nome.trim(),
    status: form.status,
    plano_id: form.plano_id || null,
    originator_id: form.originator_id || null,
    tarifa_investidor_kwh: numeroOuNulo(form.tarifa_investidor_kwh),
    consumer_unit_id: form.consumer_unit_id || null,
    endereco: {
        cep: form.cep, rua: form.rua, numero: form.numero, bairro: form.bairro,
        cidade: form.cidade, uf: form.uf, ibge: form.ibge,
    },
    qtd_carregadores: numeroOuNulo(form.qtd_carregadores),
    potencia_kw: numeroOuNulo(form.potencia_kw),
    tipo_recarga: form.tipo_recarga || null,
    fabricante: textoOuNulo(form.fabricante),
    modelo: textoOuNulo(form.modelo),
    observacoes: textoOuNulo(form.observacoes),
});

export const mensagemErroEletroposto = (error) => {
    if (!error) return 'Erro desconhecido.';
    if (error.code === '23505' && String(error.message).includes('consumer_unit_id')) {
        return 'Essa UC já está ligada a outro eletroposto.';
    }
    return error.message || 'Erro desconhecido.';
};
```

- [ ] **Step 4: rodar (GREEN)**

```bash
node --test src/lib/eletropostos.test.js
```

Expected: `# pass 9` e `# fail 0`.

- [ ] **Step 5: lint e commit**

```bash
npx eslint src/lib/eletropostos.js src/lib/eletropostos.test.js
git add src/lib/eletropostos.js src/lib/eletropostos.test.js
git commit -m "feat(eletropostos): regras da tela (status, filtros, fornecedores, payload)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected do eslint: sem erros. Se o eslint reclamar de `node:test` fora de ambiente node, acrescentar `/* eslint-env node */` só no arquivo de teste.

---

### Task 3: `EletropostoModal.jsx`

**Files:**
- Create: `src/components/EletropostoModal.jsx`

**Interfaces:**
- Consome, da Task 2: `STATUS_ELETROPOSTO`, `TIPOS_RECARGA`, `somaPercentuais`, `validarFornecedores`, `paraPayloadFornecedores`, `montarPayloadEletroposto`, `mensagemErroEletroposto`.
- Consome, da Task 1: a RPC `fn_salvar_fornecedores_eletroposto`.
- Produz: `<EletropostoModal eletroposto={obj|null} somenteLeitura={bool} onClose={fn} onSave={fn()} onDelete={fn(id)} />`. O `eletroposto` vem com o formato do select da Task 4: `consumer_unit`, `originator`, `plano` e `fornecedores[].supplier`.

- [ ] **Step 1: escrever o componente**

`src/components/EletropostoModal.jsx`:

```jsx
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAddressByCep } from '../lib/api';
import { useUI } from '../contexts/UIContext';
import {
    STATUS_ELETROPOSTO,
    TIPOS_RECARGA,
    somaPercentuais,
    validarFornecedores,
    paraPayloadFornecedores,
    montarPayloadEletroposto,
    mensagemErroEletroposto,
} from '../lib/eletropostos';

const ABAS = [
    { id: 'dados', label: 'Dados' },
    { id: 'uc', label: 'UC e Usina' },
    { id: 'fornecedores', label: 'Fornecedores' },
    { id: 'tecnico', label: 'Técnico' },
];

const estadoInicial = (e) => ({
    nome: e?.nome || '',
    status: e?.status || 'pre_operacao',
    plano_id: e?.plano_id || '',
    originator_id: e?.originator_id || '',
    tarifa_investidor_kwh: e?.tarifa_investidor_kwh ?? '',
    consumer_unit_id: e?.consumer_unit_id || '',
    cep: e?.endereco?.cep || '',
    rua: e?.endereco?.rua || '',
    numero: e?.endereco?.numero || '',
    bairro: e?.endereco?.bairro || '',
    cidade: e?.endereco?.cidade || '',
    uf: e?.endereco?.uf || '',
    ibge: e?.endereco?.ibge || '',
    qtd_carregadores: e?.qtd_carregadores ?? '',
    potencia_kw: e?.potencia_kw ?? '',
    tipo_recarga: e?.tipo_recarga || '',
    fabricante: e?.fabricante || '',
    modelo: e?.modelo || '',
    observacoes: e?.observacoes || '',
});

const fornecedoresIniciais = (e) =>
    (e?.fornecedores || []).map(f => ({
        supplier_id: f.supplier_id,
        percentual: String(Number(f.percentual)),
        ativo: f.ativo !== false,
    }));

// Quem so le (fornecedor) nao enxerga todas as opcoes pela RLS: o valor atual
// do eletroposto entra na lista para o select nao ficar em branco.
const comAtual = (lista, atual) =>
    atual && !lista.some(i => i.id === atual.id) ? [atual, ...lista] : lista;

const corDaSoma = (soma) => (soma === 100 ? '#166534' : soma > 100 ? '#991b1b' : '#9a3412');

export default function EletropostoModal({ eletroposto, somenteLeitura = false, onClose, onSave, onDelete }) {
    const { showAlert, showConfirm } = useUI();
    const [aba, setAba] = useState('dados');
    const [form, setForm] = useState(() => estadoInicial(eletroposto));
    const [fornecedores, setFornecedores] = useState(() => fornecedoresIniciais(eletroposto));
    // Guarda o id depois do primeiro INSERT: se a RPC dos fornecedores falhar,
    // salvar de novo atualiza em vez de duplicar o eletroposto.
    const [idSalvo, setIdSalvo] = useState(eletroposto?.id || null);
    const [salvando, setSalvando] = useState(false);
    const [erroCarga, setErroCarga] = useState(null);
    const [buscaUc, setBuscaUc] = useState('');
    const [opcoes, setOpcoes] = useState({ planos: [], originadores: [], suppliers: [], ucs: [], ucsOcupadas: new Set() });

    useEffect(() => {
        let vivo = true;
        (async () => {
            const [planos, originadores, suppliers, ucs, ocupadas] = await Promise.all([
                supabase.from('planos_assinatura_energia').select('id, nome, ativo')
                    .eq('recorrente_config->>categoria_plano', 'eletroposto').order('nome'),
                supabase.from('originators_v2').select('id, name').order('name'),
                supabase.from('suppliers').select('id, name, status').order('name'),
                supabase.from('consumer_units')
                    .select('id, numero_uc, status, subscriber:subscriber_id (name), usina:usina_id (id, name, status)')
                    .order('numero_uc'),
                supabase.from('eletropostos').select('id, consumer_unit_id').not('consumer_unit_id', 'is', null),
            ]);
            if (!vivo) return;
            const erro = [planos, originadores, suppliers, ucs, ocupadas].find(r => r.error)?.error;
            setErroCarga(erro ? erro.message : null);
            setOpcoes({
                planos: planos.data || [],
                originadores: originadores.data || [],
                suppliers: suppliers.data || [],
                ucs: ucs.data || [],
                ucsOcupadas: new Set((ocupadas.data || [])
                    .filter(o => o.id !== eletroposto?.id)
                    .map(o => o.consumer_unit_id)),
            });
        })();
        return () => { vivo = false; };
    }, [eletroposto?.id]);

    const campo = (nome) => ({
        value: form[nome],
        onChange: (ev) => setForm(f => ({ ...f, [nome]: ev.target.value })),
    });

    const planos = comAtual(opcoes.planos, eletroposto?.plano || null);
    const originadores = comAtual(opcoes.originadores, eletroposto?.originator || null);
    const suppliers = useMemo(() => {
        const dosSocios = (eletroposto?.fornecedores || []).map(f => f.supplier).filter(Boolean);
        return dosSocios.reduce((acc, s) => comAtual(acc, s), opcoes.suppliers);
    }, [opcoes.suppliers, eletroposto?.fornecedores]);

    const ucSelecionada = useMemo(() => {
        if (!form.consumer_unit_id) return null;
        return opcoes.ucs.find(u => u.id === form.consumer_unit_id)
            || (eletroposto?.consumer_unit?.id === form.consumer_unit_id ? eletroposto.consumer_unit : null);
    }, [form.consumer_unit_id, opcoes.ucs, eletroposto?.consumer_unit]);

    const ucsDisponiveis = useMemo(() => {
        const termo = buscaUc.trim().toLowerCase();
        const livres = opcoes.ucs.filter(u => !opcoes.ucsOcupadas.has(u.id) && u.id !== form.consumer_unit_id);
        const achadas = termo
            ? livres.filter(u => [u.numero_uc, u.subscriber?.name].some(v => String(v || '').toLowerCase().includes(termo)))
            : livres;
        return achadas.slice(0, 50);
    }, [buscaUc, opcoes.ucs, opcoes.ucsOcupadas, form.consumer_unit_id]);

    const soma = somaPercentuais(fornecedores);

    const buscarCep = async () => {
        if (form.cep.replace(/\D/g, '').length !== 8) return;
        try {
            const end = await fetchAddressByCep(form.cep);
            setForm(f => ({
                ...f,
                cep: end.cep || f.cep,
                rua: end.rua || f.rua,
                bairro: end.bairro || f.bairro,
                cidade: end.cidade || f.cidade,
                uf: end.uf || f.uf,
                ibge: end.ibge || f.ibge,
            }));
        } catch (e) {
            showAlert(e.message, 'warning');
        }
    };

    const alterarFornecedor = (i, mudanca) =>
        setFornecedores(lista => lista.map((f, j) => (j === i ? { ...f, ...mudanca } : f)));

    const handleSubmit = async (ev) => {
        ev.preventDefault();
        if (somenteLeitura) return;

        if (!form.nome.trim()) {
            setAba('dados');
            showAlert('Informe o nome do eletroposto.', 'warning');
            return;
        }
        const erroFornecedores = validarFornecedores(fornecedores);
        if (erroFornecedores) {
            setAba('fornecedores');
            showAlert(erroFornecedores, 'warning');
            return;
        }

        setSalvando(true);
        try {
            const payload = montarPayloadEletroposto(form);
            const { data, error } = idSalvo
                ? await supabase.from('eletropostos').update(payload).eq('id', idSalvo).select('id').single()
                : await supabase.from('eletropostos').insert(payload).select('id').single();
            if (error) throw new Error(mensagemErroEletroposto(error));
            setIdSalvo(data.id);

            const { error: erroRpc } = await supabase.rpc('fn_salvar_fornecedores_eletroposto', {
                p_eletroposto_id: data.id,
                p_fornecedores: paraPayloadFornecedores(fornecedores),
            });
            if (erroRpc) throw new Error('O eletroposto foi salvo, mas os fornecedores não: ' + mensagemErroEletroposto(erroRpc));

            if (fornecedores.length > 0 && soma !== 100) {
                showAlert(`Salvo. A soma dos fornecedores está em ${soma}%, não em 100%.`, 'warning');
            }
            onSave();
        } catch (e) {
            showAlert(e.message, 'error');
        } finally {
            setSalvando(false);
        }
    };

    const handleExcluir = async () => {
        if (!idSalvo) return;
        const ok = await showConfirm(
            `Excluir o eletroposto "${form.nome}"? Os fornecedores ligados a ele também saem. A UC não é alterada.`,
            'Excluir eletroposto', 'Excluir', 'Cancelar'
        );
        if (!ok) return;
        const { data, error } = await supabase.from('eletropostos').delete().eq('id', idSalvo).select('id');
        if (error || !data?.length) {
            showAlert('Não foi possível excluir: ' + (error?.message || 'sem permissão.'), 'error');
            return;
        }
        onDelete(idSalvo);
    };

    const estiloAba = (id) => ({
        padding: '0.6rem 1rem', border: 'none', cursor: 'pointer', fontWeight: 600,
        background: 'transparent', color: aba === id ? 'var(--color-blue)' : '#64748b',
        borderBottom: aba === id ? '2px solid var(--color-blue)' : '2px solid transparent',
    });
    const grade = (colunas) => ({ display: 'grid', gridTemplateColumns: colunas, gap: '1rem' });

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '900px' }}>
                <div className="modal-header">
                    <h3>{idSalvo ? form.nome || 'Eletroposto' : 'Novo Eletroposto'}</h3>
                    <button type="button" onClick={onClose} className="modal-close">&times;</button>
                </div>

                {erroCarga && (
                    <p style={{ color: '#991b1b', background: '#fee2e2', padding: '0.5rem 0.8rem', borderRadius: '6px' }}>
                        Erro ao carregar as opções: {erroCarga}
                    </p>
                )}

                <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--color-border)', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                    {ABAS.map(a => (
                        <button key={a.id} type="button" style={estiloAba(a.id)} onClick={() => setAba(a.id)}>
                            {a.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSubmit}>
                    <fieldset disabled={somenteLeitura || salvando} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                        {aba === 'dados' && (
                            <>
                                <div className="form-group">
                                    <label className="label">Nome</label>
                                    <input className="input" {...campo('nome')} />
                                </div>
                                <div style={grade('1fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">Status</label>
                                        <select className="input" {...campo('status')}>
                                            {STATUS_ELETROPOSTO.map(s => <option key={s.status} value={s.status}>{s.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Plano de eletroposto</label>
                                        <select className="input" {...campo('plano_id')}>
                                            <option value="">Sem plano</option>
                                            {planos.map(p => <option key={p.id} value={p.id}>{p.nome}{p.ativo === false ? ' (inativo)' : ''}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Originador (hierarquia do split)</label>
                                        <select className="input" {...campo('originator_id')}>
                                            <option value="">Sem originador</option>
                                            {originadores.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Tarifa do investidor (R$/kWh, piso)</label>
                                        <input className="input" type="number" min="0" step="0.0001" {...campo('tarifa_investidor_kwh')} />
                                    </div>
                                </div>
                                <div style={grade('1fr 2fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">CEP</label>
                                        <input className="input" {...campo('cep')} onBlur={buscarCep} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Rua</label>
                                        <input className="input" {...campo('rua')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Número</label>
                                        <input className="input" {...campo('numero')} />
                                    </div>
                                </div>
                                <div style={grade('2fr 2fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">Bairro</label>
                                        <input className="input" {...campo('bairro')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Cidade</label>
                                        <input className="input" {...campo('cidade')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">UF</label>
                                        <input className="input" maxLength={2} {...campo('uf')} />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="label">Observações</label>
                                    <textarea className="input" rows={3} {...campo('observacoes')} />
                                </div>
                            </>
                        )}

                        {aba === 'uc' && (
                            <>
                                <div className="form-group">
                                    <label className="label">UC que fornece a energia</label>
                                    <input
                                        className="input"
                                        placeholder="Buscar por número da UC ou assinante..."
                                        value={buscaUc}
                                        onChange={ev => setBuscaUc(ev.target.value)}
                                        style={{ marginBottom: '0.5rem' }}
                                    />
                                    <select className="input" {...campo('consumer_unit_id')}>
                                        <option value="">Sem UC</option>
                                        {ucSelecionada && (
                                            <option value={ucSelecionada.id}>
                                                {ucSelecionada.numero_uc}{ucSelecionada.subscriber?.name ? ` — ${ucSelecionada.subscriber.name}` : ''}
                                            </option>
                                        )}
                                        {ucsDisponiveis.map(u => (
                                            <option key={u.id} value={u.id}>
                                                {u.numero_uc}{u.subscriber?.name ? ` — ${u.subscriber.name}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <small style={{ color: 'var(--color-text-light)' }}>
                                        Só aparecem UCs que não estão ligadas a outro eletroposto (até 50 por busca).
                                    </small>
                                </div>

                                <div className="card" style={{ background: 'var(--color-bg-light)', padding: '1rem' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>Usina (vem da UC)</div>
                                    {!ucSelecionada ? (
                                        <div>Escolha uma UC.</div>
                                    ) : ucSelecionada.usina ? (
                                        <div style={{ fontWeight: 'bold' }}>
                                            {ucSelecionada.usina.name}
                                            <span style={{ fontWeight: 'normal', color: '#64748b' }}> · {String(ucSelecionada.usina.status || '').replace('_', ' ')}</span>
                                        </div>
                                    ) : (
                                        <div style={{ color: '#9a3412' }}>UC sem usina vinculada.</div>
                                    )}
                                    {ucSelecionada && (
                                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.3rem' }}>
                                            Status da UC: {String(ucSelecionada.status || '-').replace('_', ' ')}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {aba === 'fornecedores' && (
                            <>
                                {fornecedores.length === 0 && (
                                    <p style={{ color: 'var(--color-text-light)' }}>Nenhum fornecedor ligado a este eletroposto.</p>
                                )}
                                {fornecedores.map((f, i) => (
                                    <div key={i} style={{ ...grade('3fr 1fr auto auto'), alignItems: 'end', marginBottom: '0.75rem' }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="label">Fornecedor</label>
                                            <select className="input" value={f.supplier_id} onChange={ev => alterarFornecedor(i, { supplier_id: ev.target.value })}>
                                                <option value="">Escolha...</option>
                                                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="label">%</label>
                                            <input className="input" type="number" min="0.01" max="100" step="0.01"
                                                value={f.percentual} onChange={ev => alterarFornecedor(i, { percentual: ev.target.value })} />
                                        </div>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', paddingBottom: '0.6rem' }}>
                                            <input type="checkbox" checked={f.ativo !== false} onChange={ev => alterarFornecedor(i, { ativo: ev.target.checked })} />
                                            Ativo
                                        </label>
                                        {!somenteLeitura && (
                                            <button type="button" className="btn btn-secondary" style={{ marginBottom: '0.2rem' }}
                                                onClick={() => setFornecedores(lista => lista.filter((_, j) => j !== i))}>
                                                Remover
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {!somenteLeitura && (
                                    <button type="button" className="btn btn-secondary"
                                        onClick={() => setFornecedores(lista => [...lista, { supplier_id: '', percentual: '', ativo: true }])}>
                                        + Adicionar fornecedor
                                    </button>
                                )}
                                <div style={{ marginTop: '1rem', fontWeight: 'bold', color: corDaSoma(soma) }}>
                                    Total dos ativos: {soma}%
                                    {soma !== 100 && fornecedores.length > 0 && (
                                        <span style={{ fontWeight: 'normal' }}>
                                            {soma > 100 ? ' — passa de 100%, não é possível salvar.' : ' — ainda não fecha 100%.'}
                                        </span>
                                    )}
                                </div>
                            </>
                        )}

                        {aba === 'tecnico' && (
                            <>
                                <div style={grade('1fr 1fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">Qtd. de carregadores</label>
                                        <input className="input" type="number" min="0" step="1" {...campo('qtd_carregadores')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Potência por carregador (kW)</label>
                                        <input className="input" type="number" min="0" step="0.1" {...campo('potencia_kw')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Tipo de recarga</label>
                                        <select className="input" {...campo('tipo_recarga')}>
                                            <option value="">Não informado</option>
                                            {TIPOS_RECARGA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={grade('1fr 1fr')}>
                                    <div className="form-group">
                                        <label className="label">Fabricante</label>
                                        <input className="input" {...campo('fabricante')} />
                                    </div>
                                    <div className="form-group">
                                        <label className="label">Modelo</label>
                                        <input className="input" {...campo('modelo')} />
                                    </div>
                                </div>
                            </>
                        )}
                    </fieldset>

                    <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                        <div>
                            {idSalvo && !somenteLeitura && (
                                <button type="button" className="btn btn-secondary" style={{ color: '#991b1b' }} onClick={handleExcluir}>
                                    Excluir
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                {somenteLeitura ? 'Fechar' : 'Cancelar'}
                            </button>
                            {!somenteLeitura && (
                                <button type="submit" className="btn btn-primary" disabled={salvando}>
                                    {salvando ? 'Salvando...' : 'Salvar'}
                                </button>
                            )}
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: lint**

```bash
npx eslint src/components/EletropostoModal.jsx
```

Expected: 0 erros. Corrigir no próprio arquivo o que aparecer, sem desligar regra.

- [ ] **Step 3: commit**

```bash
git add src/components/EletropostoModal.jsx
git commit -m "feat(eletropostos): modal de cadastro em 4 abas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `EletropostoList.jsx` e menu lateral

**Files:**
- Create: `src/pages/dashboards/EletropostoList.jsx`
- Modify: `src/pages/Dashboard.jsx` (import junto dos outros `./dashboards/*`; item de menu logo depois de `power_plants`; `case` depois de `'power_plants'`)

**Interfaces:**
- Consome, da Task 2: `STATUS_ELETROPOSTO`, `statusConfig`, `filtrarEletropostos` e `usinaDoEletroposto`.
- Consome, da Task 3: `EletropostoModal`.
- Consome também `ehPapelInterno` (`src/lib/papeis.js`) e `useAuth().profile.role`.

- [ ] **Step 1: medir o lint do `Dashboard.jsx` antes (linha de base)**

```bash
npx eslint src/pages/Dashboard.jsx 2>&1 | tail -3
```

Anotar o número de problemas. O depois não pode ter mais.

- [ ] **Step 2: escrever a lista**

`src/pages/dashboards/EletropostoList.jsx`:

```jsx
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useUI } from '../../contexts/UIContext';
import { ehPapelInterno } from '../../lib/papeis';
import EletropostoModal from '../../components/EletropostoModal';
import { STATUS_ELETROPOSTO, statusConfig, filtrarEletropostos, usinaDoEletroposto } from '../../lib/eletropostos';
import {
    DndContext,
    PointerSensor,
    useSensor,
    useSensors,
    closestCorners,
    DragOverlay,
    useDroppable
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const SELECT_ELETROPOSTO = `
    *,
    consumer_unit:consumer_unit_id (id, numero_uc, status, usina:usina_id (id, name, status)),
    originator:originator_id (id, name),
    plano:plano_id (id, nome),
    fornecedores:eletroposto_fornecedores (id, supplier_id, percentual, ativo, supplier:supplier_id (id, name))
`;

const FILTROS_VAZIOS = { busca: '', status: '', usinaId: '', supplierId: '', originatorId: '' };

const nomesFornecedores = (e) =>
    (e.fornecedores || [])
        .filter(f => f.ativo)
        .map(f => `${f.supplier?.name || 'Fornecedor'} (${Number(f.percentual)}%)`)
        .join(', ');

function StatusBadge({ status }) {
    const cfg = statusConfig(status);
    return (
        <span style={{
            display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '99px',
            fontSize: '0.7rem', fontWeight: 'bold', textTransform: 'uppercase',
            background: cfg.bg, color: cfg.color
        }}>
            {cfg.label}
        </span>
    );
}

function KanbanCard({ eletroposto, onClick, isOverlay, podeArrastar }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: eletroposto.id, disabled: !!isOverlay || !podeArrastar });
    const usina = usinaDoEletroposto(eletroposto);
    const socios = nomesFornecedores(eletroposto);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        zIndex: isDragging ? 1000 : 1,
        position: 'relative',
        width: isOverlay ? '300px' : 'auto'
    };

    return (
        <div
            ref={setNodeRef}
            className="kanban-card"
            style={style}
            {...(!isOverlay ? attributes : {})}
            {...(!isOverlay ? listeners : {})}
            onClick={() => !isOverlay && onClick(eletroposto)}
        >
            <div style={{ marginBottom: '0.5rem' }}><StatusBadge status={eletroposto.status} /></div>
            <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--color-text-dark)', lineHeight: 1.2, marginBottom: '0.5rem' }}>
                {eletroposto.nome}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-blue)', background: '#eff6ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    UC {eletroposto.consumer_unit?.numero_uc || '—'}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#166534', background: '#dcfce7', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {usina?.name || 'Sem usina'}
                </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '0.3rem' }}>
                {socios || 'Sem fornecedor'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{eletroposto.endereco?.cidade ? `${eletroposto.endereco.cidade}/${eletroposto.endereco.uf || ''}` : '—'}</span>
                <span>{eletroposto.originator?.name || ''}</span>
            </div>
        </div>
    );
}

function KanbanColumn({ status, label, color, itens, onCardClick, podeArrastar }) {
    const { setNodeRef, isOver } = useDroppable({ id: status });
    return (
        <div
            ref={setNodeRef}
            className="kanban-column"
            style={{ borderTop: `4px solid ${color}`, background: isOver ? '#e2e8f0' : '#f8fafc', transition: 'background 0.2s ease' }}
        >
            <div className="kanban-column-header" style={{ color }}>
                <span style={{ textTransform: 'uppercase', fontSize: '0.85rem', fontWeight: 'bold' }}>{label}</span>
                <span style={{ fontSize: '0.8rem', background: color, color: 'white', padding: '0.1rem 0.5rem', borderRadius: '99px' }}>
                    {itens.length}
                </span>
            </div>
            <div className="kanban-column-content">
                <SortableContext items={itens.map(e => e.id)} strategy={verticalListSortingStrategy}>
                    {itens.map(e => (
                        <KanbanCard key={e.id} eletroposto={e} onClick={onCardClick} podeArrastar={podeArrastar} />
                    ))}
                </SortableContext>
            </div>
        </div>
    );
}

export default function EletropostoList() {
    const { profile } = useAuth();
    const { showAlert } = useUI();
    const podeEditar = ehPapelInterno(profile?.role);

    const [eletropostos, setEletropostos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState(null);
    const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
    const [viewMode, setViewMode] = useState('kanban');
    const [activeId, setActiveId] = useState(null);
    const [modalAberto, setModalAberto] = useState(false);
    const [emEdicao, setEmEdicao] = useState(null);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

    const carregar = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('eletropostos')
            .select(SELECT_ELETROPOSTO)
            .order('created_at', { ascending: false });
        setErro(error ? error.message : null);
        setEletropostos(data || []);
        setLoading(false);
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    const filtrados = useMemo(() => filtrarEletropostos(eletropostos, filtros), [eletropostos, filtros]);

    // Opcoes dos filtros saem do que foi carregado: so aparece o que existe.
    const opcoes = useMemo(() => {
        const usinas = new Map();
        const fornecedores = new Map();
        const originadores = new Map();
        for (const e of eletropostos) {
            const u = usinaDoEletroposto(e);
            if (u) usinas.set(u.id, u.name);
            for (const f of e.fornecedores || []) if (f.supplier) fornecedores.set(f.supplier_id, f.supplier.name);
            if (e.originator) originadores.set(e.originator_id, e.originator.name);
        }
        const ordenar = (m) => [...m.entries()]
            .map(([id, nome]) => ({ id, nome }))
            .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
        return { usinas: ordenar(usinas), fornecedores: ordenar(fornecedores), originadores: ordenar(originadores) };
    }, [eletropostos]);

    const filtro = (nome) => ({
        value: filtros[nome],
        onChange: (ev) => setFiltros(f => ({ ...f, [nome]: ev.target.value })),
    });

    const abrir = (e) => { setEmEdicao(e); setModalAberto(true); };

    const handleDragEnd = async ({ active, over }) => {
        setActiveId(null);
        if (!over || !podeEditar) return;

        const alvoEhColuna = STATUS_ELETROPOSTO.some(s => s.status === over.id);
        const novoStatus = alvoEhColuna ? over.id : eletropostos.find(e => e.id === over.id)?.status;
        const atual = eletropostos.find(e => e.id === active.id);
        if (!novoStatus || !atual || atual.status === novoStatus) return;

        setEletropostos(lista => lista.map(e => (e.id === active.id ? { ...e, status: novoStatus } : e)));
        const { data, error } = await supabase
            .from('eletropostos')
            .update({ status: novoStatus })
            .eq('id', active.id)
            .select('id');
        if (error || !data?.length) {
            showAlert('Não foi possível mudar o status: ' + (error?.message || 'sem permissão.'), 'error');
            carregar();
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2>Eletropostos</h2>
                {podeEditar && (
                    <button onClick={() => abrir(null)} className="btn btn-primary">+ Novo Eletroposto</button>
                )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                <input className="input" style={{ maxWidth: '320px' }} placeholder="Buscar por nome, UC ou cidade..." {...filtro('busca')} />
                <select className="input" style={{ maxWidth: '180px' }} {...filtro('status')}>
                    <option value="">Todos os status</option>
                    {STATUS_ELETROPOSTO.map(s => <option key={s.status} value={s.status}>{s.label}</option>)}
                </select>
                <select className="input" style={{ maxWidth: '200px' }} {...filtro('usinaId')}>
                    <option value="">Todas as usinas</option>
                    {opcoes.usinas.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
                <select className="input" style={{ maxWidth: '200px' }} {...filtro('supplierId')}>
                    <option value="">Todos os fornecedores</option>
                    {opcoes.fornecedores.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
                <select className="input" style={{ maxWidth: '200px' }} {...filtro('originatorId')}>
                    <option value="">Todos os originadores</option>
                    {opcoes.originadores.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
                <button type="button" className="btn btn-secondary" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar</button>
                <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <button onClick={() => setViewMode('list')} className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`} style={{ borderRadius: 0, border: 'none' }}>
                        Lista
                    </button>
                    <button onClick={() => setViewMode('kanban')} className={`btn ${viewMode === 'kanban' ? 'btn-primary' : 'btn-secondary'}`} style={{ borderRadius: 0, border: 'none' }}>
                        Kanban
                    </button>
                </div>
            </div>

            {erro && <p style={{ color: '#991b1b' }}>Erro ao carregar eletropostos: {erro}</p>}

            {loading ? <p>Carregando...</p> : viewMode === 'list' ? (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="table-container">
                        {filtrados.length === 0 ? (
                            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-light)' }}>Nenhum eletroposto encontrado.</p>
                        ) : (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Nome / Cidade</th>
                                        <th>UC / Usina</th>
                                        <th>Fornecedores</th>
                                        <th>Originador</th>
                                        <th>Status</th>
                                        <th>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtrados.map(e => (
                                        <tr key={e.id}>
                                            <td>
                                                <div style={{ fontWeight: 'bold' }}>{e.nome}</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)' }}>
                                                    {e.endereco?.cidade ? `${e.endereco.cidade}/${e.endereco.uf || ''}` : '—'}
                                                </div>
                                            </td>
                                            <td>
                                                <div>{e.consumer_unit?.numero_uc || '—'}</div>
                                                <div style={{ fontSize: '0.85rem', color: '#166534' }}>{usinaDoEletroposto(e)?.name || 'Sem usina'}</div>
                                            </td>
                                            <td style={{ fontSize: '0.85rem' }}>{nomesFornecedores(e) || '—'}</td>
                                            <td>{e.originator?.name || '—'}</td>
                                            <td><StatusBadge status={e.status} /></td>
                                            <td>
                                                <button onClick={() => abrir(e)} className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
                                                    {podeEditar ? 'Editar' : 'Ver'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={({ active }) => setActiveId(active.id)}
                    onDragEnd={handleDragEnd}
                    onDragCancel={() => setActiveId(null)}
                >
                    <div className="kanban-box">
                        <div className="kanban-board">
                            {STATUS_ELETROPOSTO.map(({ status, label, color }) => (
                                <KanbanColumn
                                    key={status}
                                    status={status}
                                    label={label}
                                    color={color}
                                    itens={filtrados.filter(e => e.status === status)}
                                    onCardClick={abrir}
                                    podeArrastar={podeEditar}
                                />
                            ))}
                        </div>
                    </div>
                    <DragOverlay adjustScale={true}>
                        {activeId ? (
                            <KanbanCard eletroposto={eletropostos.find(e => e.id === activeId)} isOverlay={true} podeArrastar={false} />
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}

            {modalAberto && (
                <EletropostoModal
                    eletroposto={emEdicao}
                    somenteLeitura={!podeEditar}
                    onClose={() => setModalAberto(false)}
                    onSave={() => { setModalAberto(false); carregar(); }}
                    onDelete={(id) => { setModalAberto(false); setEletropostos(lista => lista.filter(e => e.id !== id)); }}
                />
            )}
        </div>
    );
}
```

- [ ] **Step 3: ligar no menu (`src/pages/Dashboard.jsx`)**

Import, logo depois de `import PowerPlantList from './dashboards/PowerPlantList';`:

```jsx
import EletropostoList from './dashboards/EletropostoList';
```

No bloco `// 7. Usinas`, logo depois de `items.push({ id: 'power_plants', ... })`:

```jsx
            items.push({ id: 'eletropostos', label: 'Eletropostos', icon: 'bi-ev-station' });
```

No `switch (activeView)`, logo depois de `case 'power_plants': return <PowerPlantList />;`:

```jsx
            case 'eletropostos': return <EletropostoList />;
```

- [ ] **Step 4: lint e build**

```bash
npx eslint src/pages/dashboards/EletropostoList.jsx src/components/EletropostoModal.jsx src/lib/eletropostos.js
npx eslint src/pages/Dashboard.jsx 2>&1 | tail -3
node --test src/lib/eletropostos.test.js
npm run build
```

Expected:
- os arquivos novos, com 0 erros;
- o `Dashboard.jsx` com a mesma contagem do Step 1;
- os testes passando;
- build terminando com `✓ built in` sem erro.

- [ ] **Step 5: commit**

```bash
git add src/pages/dashboards/EletropostoList.jsx src/pages/Dashboard.jsx
git commit -m "feat(eletropostos): area no menu lateral com Kanban, lista e filtros

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Revisão, publicação e validação no ar

**Files:** nenhum novo. Se a validação achar defeito, corrigir no arquivo da task correspondente, com commit próprio.

- [ ] **Step 1: revisão do diff inteiro**

```bash
git diff main...impl/eletropostos --stat
```

Conferir, contra a spec:
- 4 abas;
- 6 colunas;
- 5 filtros;
- o papel `supplier` só lê (sem botão novo, sem arrastar, modal em modo leitura);
- a usina é sempre lida da UC.

- [ ] **Step 2: pedir autorização ao dono para publicar**

Mensagem: "Branch `impl/eletropostos` pronta (migração aplicada, testes SQL e JS passando, build ok). Posso fazer merge em `main` e push? Isso publica o CRM."

**Não seguir sem um sim.**

- [ ] **Step 3: merge e push (só com o sim)**

```bash
cd "/c/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity"
git merge --ff-only impl/eletropostos || git merge --no-ff impl/eletropostos -m "Merge branch 'impl/eletropostos'"
git push origin main
gh run list --workflow "Deploy to GitHub Pages" --limit 1
```

Esperar o run ficar `completed success`. Depois, repetir o `curl` até o bundle publicado mudar de nome, por causa do cache do CDN:

```bash
curl -s https://crm.b2wenergia.com.br/ | grep -o 'assets/index-[^"]*\.js'
```

- [ ] **Step 4: validar no navegador (sessão que o dono deixou logada)**

1. `resize_window` para 1400x900.
2. Abrir `https://crm.b2wenergia.com.br/dashboard`.
3. Clicar em "Eletropostos" no menu lateral, **pelas coordenadas do screenshot** (o clique por ref erra a posição).
4. Conferir as 6 colunas vazias.
5. Criar **"TESTE ELETROPOSTO — apagar"**:
   - UC qualquer livre, anotando a usina que aparece;
   - 2 fornecedores com 60% e 40%;
   - salvar.
6. Conferir o card na coluna Pré-Operação, com a UC e a usina.
7. Arrastar o card para "Operando" e recarregar: ele tem que continuar lá.
8. Reabrir o cadastro:
   - pôr 70% + 40% e salvar → o salvar é bloqueado com "passa de 100%";
   - voltar a 60/40.
9. Filtros:
   - filtrar por usina e por fornecedor: o card aparece;
   - filtrar por outro status: o card some.
10. Alternar para Lista: a linha aparece com os fornecedores "(60%)" e "(40%)".
11. Excluir o registro de teste e conferir no banco:

```sql
select count(*) from public.eletropostos;
select count(*) from public.eletroposto_fornecedores;
```

Expected: `0` e `0`.

12. `read_console_messages` com `onlyErrors`: nenhum erro novo.
13. Tirar um screenshot do Kanban para o dono antes de excluir o teste (item 11).

- [ ] **Step 5: limpar a worktree**

```bash
cd "/c/Users/Godoy/Documents/HTML/WorkSpace 1 Antigravity"
cmd //c "rmdir .claude\\worktrees\\eletropostos\\node_modules"
git worktree remove .claude/worktrees/eletropostos
```

- [ ] **Step 6: memória**

Criar `crm-eletropostos.md` na memória do projeto com:
- as tabelas;
- a regra da UC única e da usina lida pela UC;
- a hierarquia no eletroposto;
- a base do projeto 2 (energia fornecida × tarifa do investidor − despesas);
- o que está pendente.

Apontar o arquivo no `MEMORY.md`.
