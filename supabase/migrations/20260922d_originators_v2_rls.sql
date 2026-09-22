-- =====================================================================
-- Task 15: RLS de originators_v2 (decisao do dono, 22/09/2026)
--
-- A politica `originators_v2_authenticated` era `ALL` com `USING true` e
-- `WITH CHECK true`: QUALQUER usuario logado — lead, assinante, fornecedor,
-- ou quem acabou de se cadastrar pelo formulario publico de embaixador —
-- lia CPF, PIX e comissao de todos os embaixadores e podia trocar o PIX de
-- qualquer um. Trocar o PIX alheio nao da erro nenhum: a comissao
-- simplesmente passa a cair na conta de outra pessoa, e isso so aparece
-- quando o embaixador reclama que nao recebeu.
--
-- Regra que passa a valer para `authenticated`:
--   SELECT / INSERT / UPDATE .... a propria linha (id = auth.uid()) ou papel interno
--   DELETE ................... so papel interno
--   campos de comissao/identidade (split_commission, short_url, id, cpf_cnpj)
--                              so mudam por papel interno ou service role
--
-- `anon` fica exatamente como estava (20260921d): INSERT das colunas do
-- formulario publico e SELECT so de `id, phone` (a landing /convite).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quem e "a equipe interna"
--
-- `check_user_is_admin` ja existe, mas so aceita admin/super_admin/manager
-- e e usada por outras politicas — mexer nela mudaria o acesso de tabelas
-- que nao sao desta tarefa. Esta funcao e a do vocabulario desta decisao
-- (inclui `coordinator`) e le o papel do usuario da sessao, sem parametro
-- que possa ser forjado na chamada.
--
-- SECURITY DEFINER porque `profiles` tem RLS: sem isso a politica
-- dependeria de o usuario poder ler a propria linha de `profiles`.
-- STABLE para o planner nao reavaliar linha a linha.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_papel_interno()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.role IN ('super_admin', 'admin', 'manager', 'coordinator')
  );
$fn$;

COMMENT ON FUNCTION public.fn_papel_interno() IS
  'Verdadeiro quando o usuario da sessao tem papel interno da B2W (super_admin, admin, manager, coordinator). Nao aceita parametro de proposito: o id vem sempre de auth.uid().';

REVOKE EXECUTE ON FUNCTION public.fn_papel_interno() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_papel_interno() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Politicas
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS originators_v2_authenticated ON public.originators_v2;

-- Uma politica por comando: com `ALL` nao da para deixar o DELETE mais
-- estreito que o SELECT.
CREATE POLICY originators_v2_select_propria_ou_interno
  ON public.originators_v2 FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.fn_papel_interno());

-- O cadastro publico as vezes roda ja autenticado (quando a confirmacao de
-- e-mail esta desligada, o signUp devolve sessao). Nesse caminho o INSERT
-- vem com id = auth.uid(); o papel ainda e 'lead' neste instante, porque
-- `trg_originador_confirma_perfil` so promove DEPOIS do INSERT — por isso a
-- clausula da propria linha nao pode depender do papel.
CREATE POLICY originators_v2_insert_propria_ou_interno
  ON public.originators_v2 FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.fn_papel_interno());

CREATE POLICY originators_v2_update_propria_ou_interno
  ON public.originators_v2 FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.fn_papel_interno())
  WITH CHECK (id = auth.uid() OR public.fn_papel_interno());

-- Apagar embaixador apaga o historico de atribuicao de leads e comissoes.
CREATE POLICY originators_v2_delete_interno
  ON public.originators_v2 FOR DELETE TO authenticated
  USING (public.fn_papel_interno());

-- ---------------------------------------------------------------------
-- 3. Guarda dos campos que valem dinheiro
--
-- A politica de UPDATE deixa o embaixador cuidar do proprio cadastro
-- (nome, telefone, endereco, chave PIX). Mas linha e dele nao quer dizer
-- que tudo na linha e dele: `split_commission` e quanto a B2W paga,
-- `cpf_cnpj` e a identidade de quem recebe e `short_url` e o link que
-- atribui o lead. Esses tres nao se auto-concedem.
--
-- Fica no banco, e nao na tela, porque o PostgREST aceita UPDATE em
-- qualquer coluna com grant — nao adianta a tela nao mostrar o campo.
-- ---------------------------------------------------------------------
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
  'Impede que quem nao e papel interno (nem service role) altere split_commission, short_url, id ou cpf_cnpj de originators_v2 — inclusive na propria linha.';

REVOKE EXECUTE ON FUNCTION public.fn_originador_guarda_campos_sensiveis() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_originador_guarda_campos ON public.originators_v2;
CREATE TRIGGER trg_originador_guarda_campos
  BEFORE UPDATE ON public.originators_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_originador_guarda_campos_sensiveis();
