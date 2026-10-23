-- =====================================================================
-- Upload de documentos do assinante pelo CRM: quem pode gravar no bucket
-- Data: 23/10/2026
--
-- Padrao da casa: DO que termina em RAISE EXCEPTION 'SANDBOX_OK'. Sucesso =
-- receber esse erro; ele desfaz tudo, entao nenhum objeto de teste sobra.
--
-- Regra: so quem passa em check_user_is_admin() (admin, super_admin,
-- manager) grava no bucket `documentos-assinante`, e so nele. A leitura ja
-- existia; faltava a escrita, e sem ela o modal do assinante nao tinha como
-- anexar documento (so o assistente publico, por URL assinada, enviava).
-- =====================================================================

DO $$
DECLARE
  v_admin uuid; v_comum uuid; v_n int;
BEGIN
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_comum FROM public.profiles WHERE role IN ('originator', 'subscriber', 'supplier') ORDER BY created_at LIMIT 1;
  IF v_admin IS NULL OR v_comum IS NULL THEN
    RAISE EXCEPTION 'FALHA: faltou perfil admin (%) ou nao-admin (%) para o teste', v_admin, v_comum;
  END IF;

  -- ---------- 1. admin grava no bucket de documentos ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('documentos-assinante', '00000000-0000-0000-0000-000000000000/identidade/teste-admin.pdf');
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'FALHA: admin foi recusado ao gravar em documentos-assinante';
  END;

  -- ---------- 2. admin NAO grava em outro bucket por esta politica ----------
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('outro-bucket-qualquer', 'teste-admin.pdf');
    -- Sem erro de privilegio: so e aceitavel se o bucket nao existe (FK) -- tratado abaixo.
    RAISE EXCEPTION 'FALHA: admin gravou em bucket que nao e o de documentos';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN foreign_key_violation THEN NULL;
  END;

  RESET ROLE;

  -- ---------- 3. perfil comum e recusado ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comum, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('documentos-assinante', '00000000-0000-0000-0000-000000000000/identidade/teste-comum.pdf');
    RAISE EXCEPTION 'FALHA: perfil nao-admin gravou em documentos-assinante';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;

  -- ---------- 4. anonimo e recusado ----------
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('documentos-assinante', '00000000-0000-0000-0000-000000000000/identidade/teste-anon.pdf');
    RAISE EXCEPTION 'FALHA: anonimo gravou em documentos-assinante';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
