-- =====================================================================
-- Opções da conta nova: parceiro e investidor pelo app (20261011b)
-- Padrao da casa: termina em RAISE EXCEPTION 'SANDBOX_OK' (tudo desfeito).
-- =====================================================================
DO $$
DECLARE
  v_novo uuid := gen_random_uuid();
  v_outro uuid := gen_random_uuid();
  v_staff uuid;
  v_id uuid; v_id2 uuid; v_j jsonb; v_o record;
  v_dados jsonb := jsonb_build_object(
    'name', '  Pedro   Parceiro Teste ', 'phone', '(84) 99876-5432', 'cpf_cnpj', '111.444.777-35',
    'pix_key_type', 'cpf', 'pix_key', 'qualquer', 'profession', 'Corretor',
    'address', jsonb_build_object('cep', '59000-000', 'rua', 'Rua A', 'numero', '10', 'bairro', 'Centro', 'cidade', 'Natal', 'uf', 'rn'));
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, email_confirmed_at)
  VALUES (v_novo, 'pedro.parc@example.test', '{"name":"Pedro Parceiro"}', 'authenticated', 'authenticated', now());
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
  VALUES (v_outro, 'sem.confirmar@example.test', '{"name":"Sem Confirmar"}', 'authenticated', 'authenticated');

  -- ---------------- 1. sem e-mail confirmado nao vira parceiro ----------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outro, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.app_cadastrar_parceiro(v_dados);
    RAISE EXCEPTION 'FALHA 1: virou parceiro sem confirmar o e-mail';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ---------------- 2. dados invalidos sao recusados ----------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_novo, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.app_cadastrar_parceiro(v_dados || '{"cpf_cnpj":"111.444.777-00"}');
    RAISE EXCEPTION 'FALHA 2: aceitou CPF invalido';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.app_cadastrar_parceiro(v_dados || '{"pix_key_type":"email","pix_key":""}');
    RAISE EXCEPTION 'FALHA 2b: aceitou PIX vazio';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- ---------------- 3. cadastro: id e e-mail da conta, campos sensiveis no padrao ----------------
  v_id := public.app_cadastrar_parceiro(v_dados || '{"cargo":"diretor","split_commission":{"start":99}}');
  SELECT * INTO v_o FROM public.originators_v2 WHERE id = v_novo;
  IF v_id <> v_novo OR v_o.email <> 'pedro.parc@example.test' THEN
    RAISE EXCEPTION 'FALHA 3: o parceiro deveria nascer com o id e o e-mail da conta';
  END IF;
  IF v_o.name <> 'Pedro Parceiro Teste' OR v_o.pix_key <> '11144477735' OR v_o.cpf_cnpj <> '11144477735' OR v_o.address ->> 'uf' <> 'RN' THEN
    RAISE EXCEPTION 'FALHA 3b: dados normalizados errados: % % % %', v_o.name, v_o.pix_key, v_o.cpf_cnpj, v_o.address;
  END IF;
  IF v_o.cargo <> 'ppf' OR v_o.split_commission ->> 'start' <> '0' THEN
    RAISE EXCEPTION 'FALHA 3c: o app definiu cargo/comissao: % %', v_o.cargo, v_o.split_commission;
  END IF;
  v_j := public.app_perfil();
  IF NOT (v_j ->> 'originator')::boolean OR (v_j ->> 'sem_produto')::boolean THEN
    RAISE EXCEPTION 'FALHA 3d: perfil deveria mostrar parceiro e sair do sem produto: %', v_j;
  END IF;
  BEGIN
    PERFORM public.app_cadastrar_parceiro(v_dados);
    RAISE EXCEPTION 'FALHA 3e: cadastrou parceiro duas vezes';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- ---------------- 4. papel: a sessao nao sobe, o job sobe ----------------
  IF (SELECT role::text FROM public.profiles WHERE id = v_novo) <> 'lead' THEN
    RAISE EXCEPTION 'FALHA 4: o papel subiu dentro da sessao do usuario';
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.fn_promover_papeis_pendentes();
  IF (SELECT role::text FROM public.profiles WHERE id = v_novo) <> 'originator' THEN
    RAISE EXCEPTION 'FALHA 4b: o job deveria subir o papel para originator';
  END IF;
  IF (SELECT role::text FROM public.profiles WHERE id = v_outro) <> 'lead' THEN
    RAISE EXCEPTION 'FALHA 4c: o job mexeu em quem nao e parceiro';
  END IF;

  -- ---------------- 5. interesse em investir: lead com etiquetas ----------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_novo, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.app_registrar_interesse_investimento('{"phone":"123","interesses":["cotas"]}');
    RAISE EXCEPTION 'FALHA 5: aceitou celular invalido';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.app_registrar_interesse_investimento('{"phone":"84998765432","interesses":["lixo"]}');
    RAISE EXCEPTION 'FALHA 5a: aceitou sem nenhuma forma de investir';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_id := public.app_registrar_interesse_investimento(
    '{"name":"Pedro","phone":"84998765432","interesses":["eletropostos","cotas","vagas"],"faixa":"50k-200k","cidade":"Natal","uf":"rn","mensagem":"Quero usina"}');
  SELECT * INTO v_o FROM public.leads WHERE id = v_id;
  IF v_o.tags <> ARRAY['#Cotas', '#Eletropostos', '#Investidor', '#Locação de Vagas'] THEN
    RAISE EXCEPTION 'FALHA 5b: etiquetas erradas: %', v_o.tags;
  END IF;
  IF v_o.status::text <> 'sem_interacao' OR v_o.user_id <> v_novo OR v_o.qualificacao #>> '{investimento,faixa}' <> '50k-200k' THEN
    RAISE EXCEPTION 'FALHA 5c: lead de investidor mal formado: % % %', v_o.status, v_o.user_id, v_o.qualificacao;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_history h WHERE h.entity_type = 'lead' AND h.entity_id = v_id
                   AND h.metadata ->> 'acao' = 'interesse_investimento_app') THEN
    RAISE EXCEPTION 'FALHA 5d: o historico do CRM deveria registrar a qualificacao';
  END IF;
  v_j := public.app_perfil();
  IF v_j ->> 'interesse_investimento' IS NULL OR v_j -> 'lead' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'FALHA 5e: investidor nao e adesao de energia em andamento: %', v_j;
  END IF;

  -- pedir de novo: mesmo lead, etiquetas somadas
  v_id2 := public.app_registrar_interesse_investimento('{"phone":"84998765432","interesses":["financiamento"]}');
  IF v_id2 <> v_id OR NOT (SELECT '#Financiamento' = ANY(tags) FROM public.leads WHERE id = v_id)
     OR NOT (SELECT '#Cotas' = ANY(tags) FROM public.leads WHERE id = v_id) THEN
    RAISE EXCEPTION 'FALHA 5f: pedir de novo deveria somar no mesmo lead';
  END IF;

  -- ---------------- 6. a mesma pessoa tambem quer energia ----------------
  PERFORM public.app_registrar_interesse(jsonb_build_object('name', 'Pedro', 'phone', '84998765432'), NULL, 'app');
  IF NOT (SELECT '#Energia por Assinatura' = ANY(tags) FROM public.leads WHERE id = v_id) THEN
    RAISE EXCEPTION 'FALHA 6: a adesao de energia deveria marcar o lead';
  END IF;
  IF public.app_perfil() #>> '{lead,id}' IS DISTINCT FROM v_id::text THEN
    RAISE EXCEPTION 'FALHA 6b: com energia, o lead volta a ser adesao em andamento';
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END
$$;
