-- =====================================================================
-- Task 15 — correcao 1: a guarda tambem precisa valer no INSERT
--
-- A `20260922d` fechou o UPDATE, mas o grant de INSERT de `authenticated`
-- cobre TODAS as colunas (o `anon` ja estava restrito as do formulario pela
-- `20260921d`). Com a politica de INSERT exigindo apenas `id = auth.uid()`,
-- qualquer usuario logado que ainda nao tivesse linha em `originators_v2`
-- podia gravar a propria com:
--
--   { id: <seu uid>, email: <seu e-mail>, split_commission: {"start":50,"recurrent":50} }
--
-- Em seguida `trg_originador_confirma_perfil` o promovia a `originator` e
-- `handle_invoice_paid_ledger` passava a lancar 50% de cada fatura paga na
-- conta 2.1.2 em nome dele. Ou seja: a fraude que a 20260922d impediu por
-- UPDATE continuava aberta por INSERT, e ainda mais barata — nao precisava
-- nem de uma linha existente.
--
-- Tratamento no INSERT: normalizar em silencio, e nao recusar. O cadastro
-- publico legitimo (OriginatorSignupForm) nao manda nenhum desses campos;
-- derrubar o INSERT com erro so quebraria a adesao de quem nao fez nada de
-- errado. `split_commission` volta ao default da coluna
-- ('{"start": 0, "recurrent": 0}') e `short_url` volta a nulo.
--
-- Zerar `short_url` nao deixa o embaixador sem link: e exatamente a
-- condicao que `fn_originador_gerar_short_url` (AFTER INSERT, pg_net,
-- service role) exige para chamar a Edge Function e gerar o link oficial —
-- a funcao retorna sem fazer nada quando `short_url` ja veio preenchido.
--
-- O comportamento no UPDATE fica igual ao da 20260922d (erro claro com
-- ERRCODE insufficient_privilege).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_originador_guarda_campos_sensiveis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Sem usuario na sessao = service role (Edge Functions), cron ou migracao.
  -- E esse o caminho que grava `short_url`: `trg_originador_short_url`
  -- chama a Edge Function `originador-short-url`, que escreve com a chave
  -- de servico e sem Authorization de usuario (auth.uid() nulo).
  IF auth.uid() IS NULL OR public.fn_papel_interno() THEN
    RETURN NEW;
  END IF;

  -- OLD nao existe no INSERT; por isso o desvio por TG_OP antes de qualquer
  -- comparacao com OLD.
  IF TG_OP = 'INSERT' THEN
    -- Mesmo valor do DEFAULT da coluna. Quem nao manda a coluna ja chega
    -- aqui com ele (o default e aplicado antes do gatilho BEFORE), entao
    -- para o cadastro publico isto e um no-op.
    NEW.split_commission := '{"start": 0, "recurrent": 0}'::jsonb;
    NEW.short_url := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Nao e possivel trocar o id do embaixador. Fale com a equipe da B2W.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.split_commission IS DISTINCT FROM OLD.split_commission THEN
    RAISE EXCEPTION 'A comissao (split_commission) e definida pela B2W e nao pode ser alterada pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.short_url IS DISTINCT FROM OLD.short_url THEN
    RAISE EXCEPTION 'O link de indicacao encurtado (short_url) e gerado pela B2W e nao pode ser alterado aqui.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.cpf_cnpj IS DISTINCT FROM OLD.cpf_cnpj THEN
    RAISE EXCEPTION 'O CPF/CNPJ do embaixador so pode ser corrigido pela equipe da B2W.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_originador_guarda_campos_sensiveis() IS
  'Quem nao e papel interno nem service role: no INSERT tem split_commission e short_url normalizados em silencio; no UPDATE nao altera split_commission, short_url, id nem cpf_cnpj (erro insufficient_privilege), inclusive na propria linha.';

REVOKE EXECUTE ON FUNCTION public.fn_originador_guarda_campos_sensiveis() FROM PUBLIC, anon, authenticated;

-- O gatilho da 20260922d era BEFORE UPDATE; recriado para cobrir o INSERT.
DROP TRIGGER IF EXISTS trg_originador_guarda_campos ON public.originators_v2;
CREATE TRIGGER trg_originador_guarda_campos
  BEFORE INSERT OR UPDATE ON public.originators_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_originador_guarda_campos_sensiveis();
