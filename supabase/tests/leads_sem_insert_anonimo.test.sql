-- =====================================================================
-- Leads sem insert anonimo (20261006c) · 06/10/2026
-- Padrao da casa: termina em RAISE EXCEPTION 'SANDBOX_OK' (tudo desfeito).
-- =====================================================================
DO $$
DECLARE v_visita uuid; v_ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;

  -- insert direto: recusado
  BEGIN
    INSERT INTO public.leads (name, phone, status) VALUES ('Robo direto', '84921212121', 'simulacao');
    v_ok := true;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := false;
  END;
  IF v_ok THEN RAISE EXCEPTION 'FALHA 1: anon ainda insere direto em leads'; END IF;

  -- caminho do site: funciona
  v_visita := public.fn_registrar_lead_publico(
    jsonb_build_object('name', 'Teste Site', 'phone', '84921212121', 'email', 'site@example.test'), 'link');
  IF v_visita IS NULL THEN RAISE EXCEPTION 'FALHA 2: a funcao publica nao devolveu a visita'; END IF;

  -- e o preenchimento do /contrato pela visita continua
  IF public.fn_lead_adesao(v_visita) ->> 'email' <> 'site@example.test' THEN
    RAISE EXCEPTION 'FALHA 3: fn_lead_adesao pela visita falhou para anon';
  END IF;

  RESET ROLE;
  RAISE EXCEPTION 'SANDBOX_OK';
END
$$;
