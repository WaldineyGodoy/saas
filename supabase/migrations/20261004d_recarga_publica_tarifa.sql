-- OCPP (Tarefa 11): a tela /recarga mostra o valor parcial (kWh x tarifa) durante a
-- recarga. A tarifa e a foto gravada no checkout (tarifa_kwh_aplicada), nao a do
-- plano de hoje: o motorista paga o preco que viu. Dado nao pessoal.
-- Muda o tipo de retorno, por isso DROP + CREATE (mesmos GRANTs da 20261004a).
-- Depende de 20261004a_recarga_seguranca.sql.
DROP FUNCTION IF EXISTS public.fn_recarga_publica(uuid);

CREATE FUNCTION public.fn_recarga_publica(p_recarga_id uuid)
RETURNS TABLE (
  status              text,
  kwh_estimado        numeric,
  kwh_consumido       numeric,
  valor               numeric,
  valor_final         numeric,
  valor_estornado     numeric,
  conector_numero     integer,
  nome_posto          text,
  tarifa_kwh_aplicada numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.status, r.kwh_estimado, r.kwh_consumido, r.valor, r.valor_final,
         r.valor_estornado, r.conector_numero, e.nome, r.tarifa_kwh_aplicada
    FROM public.recargas_eletroposto r
    LEFT JOIN public.eletropostos e ON e.id = r.eletroposto_id
   WHERE r.id = p_recarga_id;
$$;

COMMENT ON FUNCTION public.fn_recarga_publica(uuid) IS
  'Andamento de uma recarga para a tela /recarga (motorista avulso). Sem dados pessoais.';
REVOKE EXECUTE ON FUNCTION public.fn_recarga_publica(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recarga_publica(uuid) TO anon, authenticated, service_role;
