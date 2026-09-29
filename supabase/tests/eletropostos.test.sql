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
