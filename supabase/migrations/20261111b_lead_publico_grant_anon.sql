-- Devolve ao visitante sem login (anon) a execução de `fn_registrar_lead_publico`.
--
-- O simulador público (LeadCaptureForm) chama esta RPC sem sessão. A permissão
-- foi dada em 20261006b, mas sumiu do banco por fora das migrações (em
-- 11/11/2026 o ACL tinha só postgres, authenticated e service_role), e o
-- simulador falhava para quem não estava logado.
GRANT EXECUTE ON FUNCTION public.fn_registrar_lead_publico(jsonb, text, text) TO anon;
