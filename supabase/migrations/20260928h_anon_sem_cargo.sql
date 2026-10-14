-- Task 10 (Split de Pagamentos): o cadastro publico nao escolhe o proprio
-- cargo, lider nem licenca. Achado da Task 5.
--
-- O furo: `fn_originador_guarda_campos_sensiveis` saia cedo com
-- `auth.uid() IS NULL`, condicao pensada para service_role/cron/migracao —
-- mas o `anon` (cadastro publico, policy originators_v2_anon_signup) tambem
-- nao tem uid. Logo, para o anon a guarda inteira era um no-op: nem a
-- normalizacao de split_commission/short_url (20260922f) nem a de
-- cargo/lider_id/licenca/ativo (20260927a/20260928e) valiam. Com o motor de
-- split ligado, `cargo='ppe'` gravado no cadastro paga 5% de recorrencia.
--
-- Hoje o grant de colunas do anon (20260921d: so as 9 do formulario) impede
-- o ataque por PostgREST — mas era a UNICA barreira, e qualquer alargamento
-- do grant (ou uma RPC anonima que insira no lugar do anon) reabriria o furo.
-- Esta migracao faz a guarda valer tambem para o anon.
--
-- Como distinguir os chamadores (verificado no projeto):
--   * PostgREST faz `SET LOCAL ROLE <role do JWT>` e grava o JWT inteiro em
--     `request.jwt.claims`. O GUC `role` NAO muda dentro de uma funcao
--     SECURITY DEFINER (so `current_user` muda, e vira o dono da funcao);
--     por isso a guarda le o GUC `role` e o claim `role` (auth.role()).
--   * anon:          role='anon',         claim role='anon' (sem sub)
--   * authenticated: role='authenticated', claim role='authenticated' + sub
--   * service_role:  role='service_role', claim role='service_role'
--   * postgres (migracao, cron, SQL direto): role='none', sem claims
--
-- Regra: e confiavel quem for papel interno (admin etc.), OU tiver claim
-- nulo/service_role E o GUC `role` for none/service_role/postgres/
-- supabase_admin. Todo o resto (anon, authenticated comum, papel
-- desconhecido) cai na normalizacao. Falha fechada: papel novo nao ganha
-- poder por omissao.
--
-- O comportamento do UPDATE nao muda para quem ja o tinha (authenticated
-- comum); o anon nao tem policy de UPDATE, entao nunca chega a ele.

CREATE OR REPLACE FUNCTION public.fn_originador_guarda_campos_sensiveis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claim text := coalesce(auth.role(), '');
  v_guc   text := coalesce(current_setting('role', true), '');
BEGIN
  -- Confiavel: papel interno, ou service role / postgres (migracao, cron).
  -- `auth.uid() IS NULL` NAO e evidencia de service role: o anon tambem nao
  -- tem uid.
  IF public.fn_papel_interno()
     OR (v_claim IN ('', 'service_role')
         AND v_guc IN ('none', '', 'postgres', 'service_role', 'supabase_admin')) THEN
    RETURN NEW;
  END IF;

  -- OLD nao existe no INSERT; por isso o desvio por TG_OP antes de qualquer
  -- comparacao com OLD.
  IF TG_OP = 'INSERT' THEN
    -- Cadastro publico legitimo nao manda nenhum destes campos; quem mandar
    -- (tentando se auto-promover) e normalizado em silencio, sem derrubar o
    -- INSERT de quem nao fez nada de errado.
    NEW.split_commission := '{"start": 0, "recurrent": 0}'::jsonb;
    NEW.short_url := NULL;
    NEW.cargo := 'ppf';
    NEW.lider_id := NULL;
    NEW.licenca_valor := NULL;
    NEW.licenca_vencimento := NULL;
    NEW.ativo := true;
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

  IF NEW.cargo IS DISTINCT FROM OLD.cargo THEN
    RAISE EXCEPTION 'O cargo do embaixador e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.lider_id IS DISTINCT FROM OLD.lider_id THEN
    RAISE EXCEPTION 'O lider do embaixador e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.licenca_valor IS DISTINCT FROM OLD.licenca_valor THEN
    RAISE EXCEPTION 'O valor da licenca do PPP e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.licenca_vencimento IS DISTINCT FROM OLD.licenca_vencimento THEN
    RAISE EXCEPTION 'O vencimento da licenca do PPP e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    RAISE EXCEPTION 'A situacao (ativo) do embaixador e definida pela B2W e nao pode ser alterada pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_originador_guarda_campos_sensiveis() IS
  'Guarda de campos sensiveis de originators_v2. Confiavel so papel interno, service_role e postgres (claim role nulo/service_role E GUC role none/service_role/postgres/supabase_admin); auth.uid() nulo NAO basta (o anon tambem nao tem uid). Qualquer outro chamador (anon, authenticated comum): no INSERT tem split_commission, short_url, cargo, lider_id, licenca e ativo normalizados em silencio; no UPDATE nao altera esses campos nem id/cpf_cnpj (erro insufficient_privilege).';

REVOKE EXECUTE ON FUNCTION public.fn_originador_guarda_campos_sensiveis() FROM PUBLIC, anon, authenticated;
