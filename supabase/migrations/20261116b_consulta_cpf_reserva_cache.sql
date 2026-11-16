-- Corrige 20261116a: a reserva de uma consulta que so le o cache nascia como
-- 'reservado', e 'reservado' conta como credito gasto no teto diario do
-- publico. Resultado: leitura de cache ocupava vaga de credito que nunca
-- gastou (e continuava ocupando se a funcao caisse antes de registrar o
-- resultado). Agora so a consulta que vai a API nasce 'reservado'.
CREATE OR REPLACE FUNCTION public.fn_cpf_reservar(
  p_origem text, p_ip_hash text, p_usa_api boolean, p_limite_ip_hora integer, p_limite_dia integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer; v_id bigint;
BEGIN
  IF p_origem NOT IN ('interno', 'publico') THEN
    RAISE EXCEPTION 'origem invalida: %', p_origem USING ERRCODE = '22023';
  END IF;

  IF p_origem = 'publico' THEN
    PERFORM pg_advisory_xact_lock(hashtext('fn_cpf_reservar'));

    SELECT count(*) INTO v_n FROM public.cpf_consultas_uso
     WHERE origem = 'publico' AND ip_hash = coalesce(p_ip_hash, '') AND quando > now() - interval '1 hour';
    IF v_n >= greatest(p_limite_ip_hora, 0) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'limite_publico');
    END IF;

    IF p_usa_api THEN
      SELECT count(*) INTO v_n FROM public.cpf_consultas_uso
       WHERE origem = 'publico' AND resultado IN ('reservado', 'encontrado') AND quando > now() - interval '1 day';
      IF v_n >= greatest(p_limite_dia, 0) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'limite_publico');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.cpf_consultas_uso (origem, ip_hash, resultado)
  VALUES (p_origem, coalesce(p_ip_hash, ''), CASE WHEN p_usa_api THEN 'reservado' ELSE 'cache' END)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fn_cpf_reservar(text, text, boolean, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_cpf_reservar(text, text, boolean, integer, integer) TO service_role;
