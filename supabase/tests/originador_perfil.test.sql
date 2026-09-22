-- Task 3: papel do embaixador (originator) e colunas do anon em originators_v2
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
DO $$
DECLARE v_id uuid := gen_random_uuid(); v_role text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
  VALUES (v_id, 'emb.teste@teste.invalid', '{"name":"Emb Teste"}', 'authenticated', 'authenticated');
  SELECT role INTO v_role FROM public.profiles WHERE id = v_id;
  IF v_role <> 'lead' THEN RAISE EXCEPTION 'FIXTURE: handle_new_user deu %', v_role; END IF;

  INSERT INTO public.originators_v2 (id, name, email, phone, cpf_cnpj)
  VALUES (v_id, 'Emb Teste', 'emb.teste@teste.invalid', '84999990000', '52998224725');
  SELECT role INTO v_role FROM public.profiles WHERE id = v_id;
  IF v_role <> 'originator' THEN RAISE EXCEPTION 'FALHOU: papel ficou %', v_role; END IF;

  -- Nome real da coluna de comissao confirmado em information_schema.columns: split_commission (jsonb).
  IF has_column_privilege('anon', 'public.originators_v2', 'split_commission', 'INSERT') THEN
    RAISE EXCEPTION 'FALHOU: anon ainda grava split_commission';
  END IF;
  IF NOT has_column_privilege('anon', 'public.originators_v2', 'pix_key', 'INSERT') THEN
    RAISE EXCEPTION 'FALHOU: anon perdeu pix_key';
  END IF;
  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
