-- ===========================================================================
-- BOLETO DA LICENCA DO ORIGINADOR NO ASAAS (dono, 14/11/2026)
-- Depende de 20261113a (licenca anual por cargo + vouchers).
--
--   * Boleto so para quem tem licenca COBRADA: preco do cargo no plano > 0 e
--     valor (preco menos o voucher) > 0. Voucher de isencao total nao gera
--     boleto (a licenca ja ativa no dia do voucher).
--   * Valor = licenca_valor (ja com o desconto do voucher).
--   * Adesao (nunca pagou): vence em poucos dias. Renovacao (licenca em dia):
--     liberada nos 30 dias antes do fim e vence NA DATA DA RENOVACAO; paga
--     antes, o novo ano comeca no fim do anterior (nao perde dias).
--   * Um boleto em aberto por originador. Pago (webhook do Asaas), a
--     licenca vira 'ativa' sozinha por fn_licenca_registrar_pagamento.
--
-- Quem cria/cancela no Asaas e a Edge Function licenca-originador-cobranca
-- (equipe do CRM); a tabela nao aceita escrita do navegador.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.originador_licenca_cobrancas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  originator_id       uuid NOT NULL REFERENCES public.originators_v2(id) ON DELETE CASCADE,
  tipo                text NOT NULL CHECK (tipo IN ('adesao', 'renovacao')),
  cargo               text NOT NULL,
  plano_originador_id uuid REFERENCES public.planos_originador(id) ON DELETE SET NULL,
  voucher_id          uuid REFERENCES public.originador_vouchers(id) ON DELETE SET NULL,
  preco               numeric(12, 2) NOT NULL,
  desconto            numeric(12, 2) NOT NULL DEFAULT 0,
  valor               numeric(12, 2) NOT NULL CHECK (valor > 0),
  vencimento          date NOT NULL,
  status              text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'vencido', 'cancelado')),
  asaas_payment_id    text UNIQUE,
  asaas_customer_id   text,
  boleto_url          text,
  fatura_url          text,
  linha_digitavel     text,
  pago_em             date,
  licenca_ate         date,          -- vencimento da licenca que o pagamento gerou
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid
);

-- Um boleto em aberto (pendente ou vencido sem baixa) por originador.
CREATE UNIQUE INDEX IF NOT EXISTS ux_licenca_cobranca_aberta
  ON public.originador_licenca_cobrancas (originator_id)
  WHERE status IN ('pendente', 'vencido');

CREATE INDEX IF NOT EXISTS ix_licenca_cobranca_originador
  ON public.originador_licenca_cobrancas (originator_id, created_at DESC);

ALTER TABLE public.originador_licenca_cobrancas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS licenca_cobrancas_leitura_interna ON public.originador_licenca_cobrancas;
CREATE POLICY licenca_cobrancas_leitura_interna ON public.originador_licenca_cobrancas
  FOR SELECT TO authenticated USING (public.fn_papel_interno());

REVOKE ALL ON public.originador_licenca_cobrancas FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.originador_licenca_cobrancas FROM authenticated;
GRANT SELECT ON public.originador_licenca_cobrancas TO authenticated;

COMMENT ON TABLE public.originador_licenca_cobrancas IS
  'Boletos (Asaas) da licenca anual do originador. Escrita so pela Edge Function licenca-originador-cobranca e pelo asaas-webhook. Dono, 14/11/2026.';

-- Baixa do pagamento (chamada pelo asaas-webhook, com a chave de servidor).
-- Idempotente: pagamento ja baixado devolve o que foi gravado.
CREATE OR REPLACE FUNCTION public.fn_licenca_registrar_pagamento(p_asaas_payment_id text, p_data date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_c    public.originador_licenca_cobrancas%ROWTYPE;
  v_o    public.originators_v2%ROWTYPE;
  v_data date := coalesce(p_data, current_date);
  v_inicio date;
BEGIN
  SELECT * INTO v_c FROM public.originador_licenca_cobrancas
   WHERE asaas_payment_id = p_asaas_payment_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'cobranca_nao_encontrada');
  END IF;
  IF v_c.status = 'pago' THEN
    RETURN jsonb_build_object('ok', true, 'ja_baixada', true, 'licenca_ate', v_c.licenca_ate);
  END IF;

  SELECT * INTO v_o FROM public.originators_v2 WHERE id = v_c.originator_id FOR UPDATE;

  -- Cargo trocado depois do boleto: registra o pagamento, mas nao ativa a
  -- licenca do cargo novo (a equipe decide).
  IF v_o.id IS NULL OR v_o.cargo IS DISTINCT FROM v_c.cargo THEN
    UPDATE public.originador_licenca_cobrancas SET status = 'pago', pago_em = v_data WHERE id = v_c.id;
    INSERT INTO public.crm_history (entity_type, entity_id, content, metadata)
    VALUES ('originator', v_c.originator_id,
            'Boleto da licenca pago, mas o cargo mudou desde a emissao: licenca NAO ativada automaticamente. Confira no modal.',
            jsonb_build_object('cobranca_id', v_c.id, 'asaas_payment_id', p_asaas_payment_id, 'valor', v_c.valor));
    RETURN jsonb_build_object('ok', true, 'ativou', false, 'motivo', 'cargo_mudou');
  END IF;

  -- Renovacao paga antes do fim: o ano novo comeca no fim do anterior.
  v_inicio := v_data;
  IF v_o.licenca_paga_em IS NOT NULL AND v_o.licenca_vencimento IS NOT NULL
     AND v_o.licenca_vencimento >= v_data THEN
    v_inicio := v_o.licenca_vencimento;
  END IF;

  UPDATE public.originators_v2 SET licenca_paga_em = v_inicio WHERE id = v_o.id
  RETURNING * INTO v_o;

  UPDATE public.originador_licenca_cobrancas
     SET status = 'pago', pago_em = v_data, licenca_ate = v_o.licenca_vencimento
   WHERE id = v_c.id;

  INSERT INTO public.crm_history (entity_type, entity_id, content, metadata)
  VALUES ('originator', v_o.id,
          format('Licenca anual paga (boleto Asaas, R$ %s). Valida ate %s.',
                 to_char(v_c.valor, 'FM999G999G990D00'), to_char(v_o.licenca_vencimento, 'DD/MM/YYYY')),
          jsonb_build_object('cobranca_id', v_c.id, 'asaas_payment_id', p_asaas_payment_id,
                             'valor', v_c.valor, 'pago_em', v_data, 'licenca_ate', v_o.licenca_vencimento));

  RETURN jsonb_build_object('ok', true, 'ativou', true, 'licenca_ate', v_o.licenca_vencimento);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_licenca_registrar_pagamento(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_licenca_registrar_pagamento(text, date) TO service_role;
