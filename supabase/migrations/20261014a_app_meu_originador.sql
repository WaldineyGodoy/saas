-- =====================================================================
-- App: link de indicação do Parceiro Power (bug reportado pelo dono,
-- 14/10/2026). A Home Connect só sabia mostrar o link do assinante
-- (app_perfil.subscriber.short_url); para o parceiro, app_perfil só diz
-- originator = true, sem id nem link, e a tela dizia "Disponível para
-- assinantes". Esta função devolve o cadastro de parceiro da própria conta.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.app_meu_originador()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object('id', o.id, 'name', o.name, 'short_url', o.short_url, 'ativo', o.ativo IS DISTINCT FROM false)
    FROM public.originators_v2 o
   WHERE o.id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.app_meu_originador() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_meu_originador() TO authenticated;
