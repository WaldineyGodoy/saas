-- =====================================================================
-- Convite do originador no app (20261011a) · 11/10/2026
-- Padrao da casa: termina em RAISE EXCEPTION 'SANDBOX_OK' (tudo desfeito).
-- =====================================================================
DO $$
DECLARE
  v_orig uuid := gen_random_uuid();
  v_inativo uuid := gen_random_uuid();
  v_novo uuid := gen_random_uuid();
  v_ind uuid; v_lead uuid; v_visita uuid; v_j jsonb;
BEGIN
  INSERT INTO public.originators_v2 (id, name, email) VALUES (v_orig, 'Carlos Embaixador Teste', 'carlos.emb@example.test');
  INSERT INTO public.originators_v2 (id, name, email, ativo) VALUES (v_inativo, 'Inativo Teste', 'inativo.emb@example.test', false);
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status)
  VALUES ('Maria Indicadora Teste', '11144477735', 'maria.ind@example.test', '84931313131', 'ativo') RETURNING id INTO v_ind;

  -- ---------------- 1. o link do originador e reconhecido ----------------
  v_j := public.fn_indicador_publico(v_orig::text);
  IF NOT (v_j ->> 'valido')::boolean OR v_j ->> 'tipo' <> 'originador' OR v_j ->> 'primeiro_nome' <> 'Carlos' OR v_j ? 'email' THEN
    RAISE EXCEPTION 'FALHA 1: originador deveria ser valido, tipo originador, so o primeiro nome: %', v_j;
  END IF;
  v_j := public.fn_indicador_publico(upper(v_ind::text));
  IF v_j ->> 'tipo' <> 'assinante' OR v_j ->> 'primeiro_nome' <> 'Maria' THEN
    RAISE EXCEPTION 'FALHA 1b: assinante deveria seguir como antes: %', v_j;
  END IF;
  IF (public.fn_indicador_publico(v_inativo::text) ->> 'valido')::boolean THEN
    RAISE EXCEPTION 'FALHA 1c: aceitou originador inativo';
  END IF;

  -- ---------------- 2. cadastro pelo app com o convite: comissao no lead ----------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, email_confirmed_at)
  VALUES (v_novo, 'novo.conv@example.test', '{"name":"Joana Convite"}', 'authenticated', 'authenticated', now());
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_novo, 'role', 'authenticated')::text, true);

  v_visita := public.app_registrar_interesse(jsonb_build_object('name', 'Joana Convite', 'phone', '84934343434'), v_orig::text, 'link');
  SELECT lead_id INTO v_lead FROM public.lead_visitas WHERE id = v_visita;
  IF (SELECT originator_id FROM public.leads WHERE id = v_lead) IS DISTINCT FROM v_orig THEN
    RAISE EXCEPTION 'FALHA 2: o lead deveria ficar com o originador do convite';
  END IF;
  IF (SELECT indicador_assinante_id FROM public.leads WHERE id = v_lead) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 2b: convite de originador nao e indicacao de assinante';
  END IF;
  IF (SELECT originator_id FROM public.lead_visitas WHERE id = v_visita) IS DISTINCT FROM v_orig THEN
    RAISE EXCEPTION 'FALHA 2c: a visita deveria guardar o originador';
  END IF;
  IF public.app_perfil() #>> '{lead,indicador_nome}' IS DISTINCT FROM 'Carlos' THEN
    RAISE EXCEPTION 'FALHA 2d: o perfil deveria mostrar o convite do originador: %', public.app_perfil();
  END IF;

  -- ---------------- 3. p_dados nao injeta originador por fora do link ----------------
  v_visita := public.app_registrar_interesse(
    jsonb_build_object('name', 'Joana Convite', 'phone', '84934343434', 'originator_id', v_inativo), v_ind::text, 'qr');
  IF (SELECT originator_id FROM public.lead_visitas WHERE id = v_visita) IS NOT DISTINCT FROM v_inativo THEN
    RAISE EXCEPTION 'FALHA 3: originator_id do p_dados passou sem validacao';
  END IF;
  IF (SELECT indicador_assinante_id FROM public.lead_visitas WHERE id = v_visita) IS DISTINCT FROM v_ind THEN
    RAISE EXCEPTION 'FALHA 3b: a indicacao do assinante deveria valer na nova visita';
  END IF;

  -- ---------------- 4. o originador nao convida a si mesmo ----------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_orig, 'role', 'authenticated')::text, true);
  v_j := public.fn_indicador_publico(v_orig::text);
  IF (v_j ->> 'valido')::boolean OR v_j ->> 'motivo' <> 'proprio' THEN
    RAISE EXCEPTION 'FALHA 4: aceitou o proprio convite: %', v_j;
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END
$$;
