-- B2W Charge: fecha a liberacao de energia forjavel (pre-requisito do OCPP).
-- Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md §2.1
-- Teste: supabase/tests/recarga_seguranca.test.sql
--
-- Antes: politicas USING (true) para qualquer papel. Com a chave publica do
-- Supabase dava para marcar recarga como paga e ler nome/e-mail/telefone de
-- todos os motoristas. Agora:
--   * anon nao toca na tabela; escrita so por service role (Edge Functions/CSMS);
--   * interno le e grava; motorista cadastrado le as proprias recargas;
--   * motorista avulso acompanha por fn_recarga_publica (sem dados pessoais);
--   * pending_payment -> paid so por fn_marcar_recarga_paga (idempotente).

-- Colunas lidas pela tela; preenchidas pelo CSMS a partir da migracao OCPP.
ALTER TABLE public.recargas_eletroposto
  ADD COLUMN IF NOT EXISTS kwh_consumido   NUMERIC(10, 3),
  ADD COLUMN IF NOT EXISTS valor_final     NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS valor_estornado NUMERIC(10, 2);

DROP POLICY IF EXISTS "Permitir leitura da recarga" ON public.recargas_eletroposto;
DROP POLICY IF EXISTS "Permitir criacao de solicitacao de recarga" ON public.recargas_eletroposto;
DROP POLICY IF EXISTS "Permitir atualizacao da recarga" ON public.recargas_eletroposto;
REVOKE ALL ON public.recargas_eletroposto FROM anon;

DROP POLICY IF EXISTS recargas_interno ON public.recargas_eletroposto;
CREATE POLICY recargas_interno ON public.recargas_eletroposto
  FOR ALL TO authenticated
  USING (public.fn_papel_interno()) WITH CHECK (public.fn_papel_interno());

DROP POLICY IF EXISTS recargas_motorista_le ON public.recargas_eletroposto;
CREATE POLICY recargas_motorista_le ON public.recargas_eletroposto
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Leitura do motorista avulso: quem tem o uuid da recarga (devolvido so a
-- quem criou o checkout) ve o andamento, nunca os dados pessoais.
CREATE OR REPLACE FUNCTION public.fn_recarga_publica(p_recarga_id uuid)
RETURNS TABLE (
  status          text,
  kwh_estimado    numeric,
  kwh_consumido   numeric,
  valor           numeric,
  valor_final     numeric,
  valor_estornado numeric,
  conector_numero integer,
  nome_posto      text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.status, r.kwh_estimado, r.kwh_consumido, r.valor, r.valor_final,
         r.valor_estornado, r.conector_numero, e.nome
    FROM public.recargas_eletroposto r
    LEFT JOIN public.eletropostos e ON e.id = r.eletroposto_id
   WHERE r.id = p_recarga_id;
$$;

COMMENT ON FUNCTION public.fn_recarga_publica(uuid) IS
  'Andamento de uma recarga para a tela /recarga (motorista avulso). Sem dados pessoais.';
REVOKE EXECUTE ON FUNCTION public.fn_recarga_publica(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recarga_publica(uuid) TO anon, authenticated, service_role;

-- Transicao usada pelo webhook da Stripe. So a primeira entrega surte efeito:
-- devolve o id da recarga quando ela saiu de pending_payment agora, e nulo se
-- ja estava paga (reenvio), em outro status ou se o PaymentIntent nao existe.
CREATE OR REPLACE FUNCTION public.fn_marcar_recarga_paga(p_payment_intent_id text)
RETURNS uuid
LANGUAGE sql VOLATILE
SET search_path = public, pg_temp
AS $$
  UPDATE public.recargas_eletroposto
     SET status = 'paid', updated_at = now()
   WHERE stripe_payment_intent_id = p_payment_intent_id
     AND status = 'pending_payment'
  RETURNING id;
$$;

COMMENT ON FUNCTION public.fn_marcar_recarga_paga(text) IS
  'pending_payment -> paid pelo webhook (service role). Idempotente: reenvio devolve nulo.';
REVOKE EXECUTE ON FUNCTION public.fn_marcar_recarga_paga(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_marcar_recarga_paga(text) TO service_role;
