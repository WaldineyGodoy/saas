-- =====================================================================
-- Cadastro pelo app e indicacao (20261006d) · 06/10/2026
-- Padrao da casa: termina em RAISE EXCEPTION 'SANDBOX_OK' (tudo desfeito).
-- =====================================================================
DO $$
DECLARE
  v_orig_antigo uuid := gen_random_uuid();
  v_golpe uuid := gen_random_uuid();
  v_novo uuid := gen_random_uuid();
  v_ind uuid; v_lead uuid; v_visita uuid; v_j jsonb; v_txt text;
BEGIN
  -- parceiro cadastrado no CRM, ainda sem login, com uma visita registrada
  INSERT INTO public.originators_v2 (id, name, email) VALUES (v_orig_antigo, 'Parceiro Teste', 'parceiro.teste@example.test');
  INSERT INTO public.leads (name, phone, status) VALUES ('Lead do Parceiro', '84930303030', 'simulacao') RETURNING id INTO v_lead;
  INSERT INTO public.lead_visitas (lead_id, dados, originator_id) VALUES (v_lead, '{}', v_orig_antigo);

  -- ---------------- 1. login NAO confirmado com o e-mail do parceiro ----------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
  VALUES (v_golpe, 'parceiro.teste@example.test', '{"name":"Golpe"}', 'authenticated', 'authenticated');
  IF NOT EXISTS (SELECT 1 FROM public.originators_v2 WHERE id = v_orig_antigo) THEN
    RAISE EXCEPTION 'FALHA 1: login sem confirmacao tomou o id do parceiro';
  END IF;
  IF (SELECT role::text FROM public.profiles WHERE id = v_golpe) <> 'lead' THEN
    RAISE EXCEPTION 'FALHA 1b: login sem confirmacao ganhou papel de parceiro';
  END IF;

  -- ---------------- 2. ao confirmar, liga o parceiro e a visita acompanha ----------------
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = v_golpe;
  IF NOT EXISTS (SELECT 1 FROM public.originators_v2 WHERE id = v_golpe) THEN
    RAISE EXCEPTION 'FALHA 2: e-mail confirmado deveria ligar o parceiro';
  END IF;
  IF (SELECT originator_id FROM public.lead_visitas WHERE lead_id = v_lead) <> v_golpe THEN
    RAISE EXCEPTION 'FALHA 2b: a visita nao acompanhou a troca de id do parceiro';
  END IF;
  IF (SELECT role::text FROM public.profiles WHERE id = v_golpe) <> 'originator' THEN
    RAISE EXCEPTION 'FALHA 2c: papel deveria virar originator na confirmacao';
  END IF;

  -- ---------------- 3. indicador publico ----------------
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status)
  VALUES ('Maria Indicadora Teste', '11144477735', 'maria.ind@example.test', '84931313131', 'ativo') RETURNING id INTO v_ind;
  v_j := public.fn_indicador_publico(v_ind::text);
  IF NOT (v_j ->> 'valido')::boolean OR v_j ->> 'primeiro_nome' <> 'Maria' OR v_j ? 'email' THEN
    RAISE EXCEPTION 'FALHA 3: indicador valido deveria devolver so o primeiro nome: %', v_j;
  END IF;
  IF (public.fn_indicador_publico('lixo') ->> 'valido')::boolean THEN RAISE EXCEPTION 'FALHA 3b: aceitou id invalido'; END IF;

  -- ---------------- 4. login novo do app, ainda sem confirmar: nao registra ----------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
  VALUES (v_novo, 'novo.app@example.test', '{"name":"Joana App"}', 'authenticated', 'authenticated');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_novo, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.app_registrar_interesse(jsonb_build_object('name', 'Joana App', 'phone', '84932323232'), v_ind::text, 'qr');
    RAISE EXCEPTION 'FALHA 4: registrou interesse sem e-mail confirmado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ---------------- 5. confirmado: lead ligado ao login, visita por QR ----------------
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = v_novo;
  v_j := public.app_perfil();
  IF NOT (v_j ->> 'sem_produto')::boolean THEN RAISE EXCEPTION 'FALHA 5: login novo deveria estar sem produto: %', v_j; END IF;

  v_visita := public.app_registrar_interesse(jsonb_build_object('name', 'Joana App', 'phone', '84932323232'), v_ind::text, 'qr');
  SELECT l.id INTO v_lead FROM public.leads l JOIN public.lead_visitas v ON v.lead_id = l.id WHERE v.id = v_visita;
  IF (SELECT user_id FROM public.leads WHERE id = v_lead) <> v_novo THEN RAISE EXCEPTION 'FALHA 5b: lead nao ficou ligado ao login'; END IF;
  SELECT meio || '|' || coalesce(indicador_assinante_id::text, '') INTO v_txt FROM public.lead_visitas WHERE id = v_visita;
  IF v_txt <> 'qr|' || v_ind THEN RAISE EXCEPTION 'FALHA 5c: visita deveria ser qr com o indicador: %', v_txt; END IF;
  IF (SELECT email FROM public.leads WHERE id = v_lead) <> 'novo.app@example.test' THEN
    RAISE EXCEPTION 'FALHA 5d: o e-mail do lead deveria ser o da conta';
  END IF;
  v_j := public.app_perfil();
  IF v_j #>> '{lead,indicador_nome}' <> 'Maria' THEN RAISE EXCEPTION 'FALHA 5e: perfil deveria mostrar a indicacao: %', v_j; END IF;

  -- ---------------- 6. link invalido e auto-indicacao recusados ----------------
  BEGIN
    PERFORM public.app_registrar_interesse(jsonb_build_object('name', 'Joana App', 'phone', '84932323232'), gen_random_uuid()::text, 'app');
    RAISE EXCEPTION 'FALHA 6: aceitou indicador inexistente';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  UPDATE public.subscribers SET user_id = v_novo WHERE id = v_ind;   -- Joana "e" a Maria
  IF (public.fn_indicador_publico(v_ind::text) ->> 'valido')::boolean THEN
    RAISE EXCEPTION 'FALHA 6b: aceitou auto-indicacao';
  END IF;

  -- ---------------- 7. virou assinante: papel sobe e sai do "sem produto" ----------------
  -- Na sessao do proprio usuario a protecao de papel segura a troca...
  IF (SELECT role::text FROM public.profiles WHERE id = v_novo) <> 'lead' THEN
    RAISE EXCEPTION 'FALHA 7a: o papel subiu dentro da sessao do usuario';
  END IF;
  -- ...e sobe quando a assinatura chega pelo webhook (sem sessao de usuario).
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.subscribers SET status = 'contrato_assinado' WHERE id = v_ind;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_novo, 'role', 'authenticated')::text, true);
  IF (SELECT role::text FROM public.profiles WHERE id = v_novo) <> 'subscriber' THEN
    RAISE EXCEPTION 'FALHA 7: papel deveria virar subscriber ao ganhar cadastro';
  END IF;
  IF (public.app_perfil() ->> 'sem_produto')::boolean THEN RAISE EXCEPTION 'FALHA 7b: assinante ainda aparece sem produto'; END IF;

  -- ---------------- 8. a protecao segue barrando o resto ----------------
  UPDATE public.profiles SET role = 'admin' WHERE id = v_novo;
  IF (SELECT role::text FROM public.profiles WHERE id = v_novo) <> 'subscriber' THEN
    RAISE EXCEPTION 'FALHA 8: o proprio usuario conseguiu virar admin';
  END IF;
  UPDATE public.profiles SET role = 'lead' WHERE id = v_novo;
  UPDATE public.profiles SET role = 'originator' WHERE id = v_novo;
  IF (SELECT role::text FROM public.profiles WHERE id = v_novo) = 'originator' THEN
    RAISE EXCEPTION 'FALHA 8b: virou originator sem ser parceiro';
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END
$$;
