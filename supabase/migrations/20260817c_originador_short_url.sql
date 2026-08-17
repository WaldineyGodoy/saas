-- =====================================================================
-- short_url passa a ser o padrão do link de indicação
-- Data: 17/08/2026
--
-- Antes, `short_url` só era gerado quando o próprio originador abria o
-- dashboard dele — e o dashboard estava quebrado (`profile` usado sem
-- `useAuth()`, e busca por `originators_v2.user_id`, coluna inexistente).
-- Resultado: os 8 originadores cadastrados tinham `short_url` nulo, e
-- cada tela do CRM montava o link longo do seu jeito — uma delas
-- apontando para `/clientes`, rota que devolve 404.
--
-- Depende da Edge Function `originador-short-url` (verify_jwt=false),
-- que monta o link de convite, encurta no YOURLS e grava.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_originador_gerar_short_url()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $fn$
BEGIN
  -- Quem já veio com link (importação, recadastro) não é reencurtado.
  IF NEW.short_url IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- pg_net é assíncrono: a requisição entra numa fila e sai depois do
  -- COMMIT. Se a transação voltar atrás, a chamada volta junto — não
  -- sobra link encurtado apontando para originador que nunca existiu.
  -- E uma queda do YOURLS não derruba o cadastro do originador.
  PERFORM net.http_post(
    url     := 'https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/originador-short-url',
    body    := jsonb_build_object('originator_id', NEW.id),
    params  := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 15000
  );

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fn_originador_gerar_short_url() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_originador_gerar_short_url() IS
  'Dispara a geração do link de indicação encurtado (YOURLS) para um originador recém-criado. Assíncrona via pg_net: falha no YOURLS não derruba o cadastro.';

-- O gatilho fica no BANCO, e não no front, de propósito: vale para
-- qualquer origem — modal do CRM, formulário público /cadastro,
-- importação via SQL. Nenhuma tela precisa lembrar de gerar o link.
--
-- AFTER INSERT porque a linha precisa existir: a Edge Function lê o
-- originador pelo id para montar o link com o nome.
DROP TRIGGER IF EXISTS trg_originador_short_url ON public.originators_v2;
CREATE TRIGGER trg_originador_short_url
  AFTER INSERT ON public.originators_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_originador_gerar_short_url();

-- ---------------------------------------------------------------------
-- Backfill dos 8 originadores existentes — executado em 17/08/2026 por
-- chamada direta à função, e registrado aqui para reprodutibilidade:
--
--   curl -X POST \
--     https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/originador-short-url \
--     -H "Content-Type: application/json" -d '{"all_missing":true}'
--
-- A função é idempotente: quem já tem short_url é ignorado.
-- ---------------------------------------------------------------------
