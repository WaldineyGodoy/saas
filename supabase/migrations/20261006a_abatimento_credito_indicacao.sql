-- =====================================================================
-- Abatimento do credito de indicacao (Assinante Connect)
-- Data: 06/10/2026 · branch app-v1.3 · plano: docs/plano-abatimento-indicacao.md
--
-- O credito ja nasce: quando a fatura do indicado e paga,
-- handle_invoice_paid_ledger lanca os 2% do Connect na 2.1.6 (negativo,
-- reference_type 'subscriber', reference_id = quem indicou). Faltava o
-- consumo. Regras do dono (05/10/2026):
--
--   * o credito e da PESSOA; abate primeiro a fatura de vencimento mais
--     proximo e, no empate, a de maior valor;
--   * zerada uma fatura, o restante transborda para a proxima;
--   * o que sobra depois do ciclo inteiro e DESCARTADO, na conta nova
--     3.1.5 (Creditos de Indicacao Nao Utilizados);
--   * ciclo abaixo de R$ 5,00 nao gera boleto: a cobranca e adiada e o
--     valor vai junto na proxima fatura (invoices.cobranca_adiada).
--
-- Contabilidade do abatimento: +x na 2.1.6 (baixa a obrigacao com o
-- indicador) e -x na 1.1.2 dele. Quando a fatura e paga, o caixa menor
-- faz o gatilho lancar +x na 1.1.2 -- as duas pernas se anulam. A base da
-- recompensa e a energia compensada, entao o split nao muda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Conta 3.1.5
-- ---------------------------------------------------------------------
INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '3.1.5', 'Créditos de Indicação Não Utilizados', 'income', a.parent_id
  FROM public.ledger_accounts a
 WHERE a.code = '3.1.1'
   AND NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE code = '3.1.5');

-- ---------------------------------------------------------------------
-- 2. Fatura: abatimento e cobranca adiada
-- ---------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS abatimento_indicacao numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cobranca_adiada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cobranca_adiada_em timestamptz;

COMMENT ON COLUMN public.invoices.abatimento_indicacao IS
  'Credito de indicacao (Assinante Connect) abatido nesta fatura. valor_a_pagar ja vem liquido dele; fn_calcular_fatura o desconta de novo ao recalcular.';
COMMENT ON COLUMN public.invoices.cobranca_adiada IS
  'Ciclo ficou abaixo do minimo do boleto (R$ 5,00): nao houve cobranca e a fatura vai junto no proximo ciclo do assinante.';

-- ---------------------------------------------------------------------
-- 3. Extrato dos movimentos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creditos_indicacao_uso (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id  uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  invoice_id     uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ciclo          date,
  tipo           text NOT NULL CHECK (tipo IN ('abatimento', 'descarte', 'estorno')),
  valor          numeric NOT NULL CHECK (valor > 0),
  ordem          integer,
  transaction_id uuid NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creditos_indicacao_uso_sub
  ON public.creditos_indicacao_uso (subscriber_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_creditos_indicacao_uso_invoice
  ON public.creditos_indicacao_uso (invoice_id) WHERE invoice_id IS NOT NULL;

ALTER TABLE public.creditos_indicacao_uso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS creditos_indicacao_uso_leitura ON public.creditos_indicacao_uso;
CREATE POLICY creditos_indicacao_uso_leitura ON public.creditos_indicacao_uso
  FOR SELECT TO authenticated
  USING (public.fn_chamador_interno()
         OR subscriber_id = public.fn_app_subscriber_id());
-- Sem politica de escrita: so as funcoes SECURITY DEFINER abaixo gravam.

COMMENT ON TABLE public.creditos_indicacao_uso IS
  'Movimentos do credito de indicacao: abatimento numa fatura, descarte da sobra do ciclo (3.1.5) e estorno por cancelamento. Fonte do extrato (V1.1).';

-- ---------------------------------------------------------------------
-- 4. Saldo: o que a 2.1.6 deve ao assinante
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_saldo_credito_indicacao(p_subscriber uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT greatest(0, round(-coalesce(sum(le.amount), 0), 2))
    FROM public.ledger_entries le
    JOIN public.ledger_accounts a ON a.id = le.account_id AND a.code = '2.1.6'
   WHERE le.reference_type = 'subscriber'
     AND le.reference_id = p_subscriber
     AND coalesce(le.is_sandbox, false) = false
     AND (public.fn_chamador_interno() OR p_subscriber = public.fn_app_subscriber_id());
$$;

REVOKE EXECUTE ON FUNCTION public.fn_saldo_credito_indicacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_saldo_credito_indicacao(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Aplicar o credito no ciclo que vai ser emitido
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_aplicar_credito_indicacao(p_subscriber uuid, p_invoice_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_conect   uuid;
  v_receber  uuid;
  v_descarte uuid;
  v_saldo    numeric;
  v_inicial  numeric;
  v_x        numeric;
  v_tx       uuid := gen_random_uuid();
  v_ordem    int := 0;
  v_fat      record;
  v_achadas  int;
  v_ciclos   date[];
  v_aberto   boolean;
  v_descartado numeric := 0;
  v_por_fatura jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.fn_chamador_interno() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF p_subscriber IS NULL OR p_invoice_ids IS NULL OR cardinality(p_invoice_ids) = 0 THEN
    RETURN jsonb_build_object('saldo_inicial', 0, 'aplicado', 0, 'descartado', 0, 'por_fatura', '[]'::jsonb);
  END IF;

  -- Duas emissoes do mesmo assinante ao mesmo tempo nao gastam o mesmo saldo.
  PERFORM pg_advisory_xact_lock(hashtext('credito_indicacao:' || p_subscriber::text));

  SELECT id INTO v_conect   FROM public.ledger_accounts WHERE code = '2.1.6';
  SELECT id INTO v_receber  FROM public.ledger_accounts WHERE code = '1.1.2';
  SELECT id INTO v_descarte FROM public.ledger_accounts WHERE code = '3.1.5';
  IF v_conect IS NULL OR v_receber IS NULL OR v_descarte IS NULL THEN
    RAISE EXCEPTION 'fn_aplicar_credito_indicacao: contas 2.1.6, 1.1.2 ou 3.1.5 ausentes';
  END IF;

  -- Todas as faturas pedidas tem de ser do assinante e estar abertas, sem
  -- cobranca. Uma que nao bate e erro de quem chamou, nao algo a pular.
  SELECT count(*), array_agg(DISTINCT date_trunc('month', i.mes_referencia)::date)
    INTO v_achadas, v_ciclos
    FROM public.invoices i
    JOIN public.consumer_units cu ON cu.id = i.uc_id
   WHERE i.id = ANY (p_invoice_ids)
     AND cu.subscriber_id = p_subscriber
     AND i.status::text NOT IN ('pago', 'cancelado', 'cancelada', 'confirmado')
     AND i.asaas_payment_id IS NULL
     AND i.consolidated_invoice_id IS NULL;

  IF v_achadas <> cardinality(p_invoice_ids) THEN
    RAISE EXCEPTION 'fn_aplicar_credito_indicacao: % de % faturas sao do assinante e estao abertas sem cobranca',
      v_achadas, cardinality(p_invoice_ids) USING ERRCODE = '22023';
  END IF;

  v_saldo := public.fn_saldo_credito_indicacao(p_subscriber);
  v_inicial := v_saldo;
  IF v_saldo <= 0 THEN
    RETURN jsonb_build_object('saldo_inicial', 0, 'aplicado', 0, 'descartado', 0, 'por_fatura', '[]'::jsonb);
  END IF;

  -- Ordem do dono: vencimento mais proximo; no empate, maior valor.
  FOR v_fat IN
    SELECT i.id, i.valor_a_pagar, i.mes_referencia, i.vencimento
      FROM public.invoices i
     WHERE i.id = ANY (p_invoice_ids)
     ORDER BY i.vencimento ASC NULLS LAST, i.valor_a_pagar DESC NULLS LAST, i.id
       FOR UPDATE
  LOOP
    EXIT WHEN v_saldo <= 0;
    v_ordem := v_ordem + 1;
    v_x := least(v_saldo, greatest(0, round(coalesce(v_fat.valor_a_pagar, 0), 2)));
    CONTINUE WHEN v_x <= 0;

    UPDATE public.invoices
       SET abatimento_indicacao = abatimento_indicacao + v_x,
           valor_a_pagar        = round(valor_a_pagar - v_x, 2)
     WHERE id = v_fat.id;

    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (v_tx, v_conect, v_x, 'Abatimento Crédito Indicação (fatura ' || v_fat.id || ')', 'subscriber', p_subscriber),
           (v_tx, v_receber, -v_x, 'Abatimento Crédito Indicação (fatura ' || v_fat.id || ')', 'subscriber', p_subscriber);

    INSERT INTO public.creditos_indicacao_uso (subscriber_id, invoice_id, ciclo, tipo, valor, ordem, transaction_id)
    VALUES (p_subscriber, v_fat.id, date_trunc('month', v_fat.mes_referencia)::date, 'abatimento', v_x, v_ordem, v_tx);

    v_por_fatura := v_por_fatura || jsonb_build_object('invoice_id', v_fat.id, 'ordem', v_ordem, 'valor', v_x);
    v_saldo := round(v_saldo - v_x, 2);
  END LOOP;

  -- Fatura zerada pelo credito esta quitada: sem boleto e sem taxa do Asaas.
  -- Ir para 'pago' dispara o gatilho do razao normalmente (caixa zero).
  UPDATE public.invoices
     SET status = 'pago', asaas_status = 'QUITADA_CREDITO',
         cobranca_adiada = false, cobranca_adiada_em = NULL
   WHERE id = ANY (p_invoice_ids)
     AND abatimento_indicacao > 0
     AND coalesce(valor_a_pagar, 0) <= 0;

  -- Sobra: descartada so quando o ciclo fecha -- nao resta, alem destas,
  -- fatura do assinante naqueles meses ainda sem cobranca. Na emissao
  -- individual pela tela as outras UCs do mes ainda vem depois.
  IF v_saldo > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.invoices i
        JOIN public.consumer_units cu ON cu.id = i.uc_id
       WHERE cu.subscriber_id = p_subscriber
         AND date_trunc('month', i.mes_referencia)::date = ANY (v_ciclos)
         AND NOT (i.id = ANY (p_invoice_ids))
         AND i.status::text NOT IN ('pago', 'cancelado', 'cancelada', 'confirmado')
         AND i.asaas_payment_id IS NULL
         AND i.consolidated_invoice_id IS NULL
         AND NOT i.cobranca_adiada
    ) INTO v_aberto;

    IF NOT v_aberto THEN
      INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
      VALUES (v_tx, v_conect, v_saldo, 'Descarte Crédito Indicação não utilizado no ciclo', 'subscriber', p_subscriber),
             (v_tx, v_descarte, -v_saldo, 'Descarte Crédito Indicação não utilizado no ciclo', 'subscriber', p_subscriber);
      INSERT INTO public.creditos_indicacao_uso (subscriber_id, invoice_id, ciclo, tipo, valor, transaction_id)
      VALUES (p_subscriber, NULL, (SELECT max(c) FROM unnest(v_ciclos) c), 'descarte', v_saldo, v_tx);
      v_descartado := v_saldo;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'saldo_inicial', v_inicial,
    'aplicado', round(v_inicial - v_saldo, 2),
    'descartado', v_descartado,
    'por_fatura', v_por_fatura,
    'transaction_id', v_tx);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_aplicar_credito_indicacao(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_credito_indicacao(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.fn_aplicar_credito_indicacao(uuid, uuid[]) IS
  'Abate o saldo de indicacao nas faturas do ciclo (vencimento asc, valor desc), quita as zeradas e descarta a sobra quando o ciclo fecha. Chamada pela create-asaas-charge antes de criar o boleto.';

-- ---------------------------------------------------------------------
-- 6. Cancelamento devolve o abatimento ao saldo
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_estornar_abatimento_indicacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_sub uuid; v_tx uuid := gen_random_uuid();
  v_conect uuid; v_receber uuid; v_x numeric := NEW.abatimento_indicacao;
BEGIN
  IF NEW.status::text IN ('cancelado', 'cancelada')
     AND OLD.status::text NOT IN ('cancelado', 'cancelada')
     AND v_x > 0 THEN
    SELECT cu.subscriber_id INTO v_sub FROM public.consumer_units cu WHERE cu.id = NEW.uc_id;
    SELECT id INTO v_conect  FROM public.ledger_accounts WHERE code = '2.1.6';
    SELECT id INTO v_receber FROM public.ledger_accounts WHERE code = '1.1.2';

    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (v_tx, v_conect, -v_x, 'Estorno Abatimento Crédito Indicação (fatura ' || NEW.id || ' cancelada)', 'subscriber', v_sub),
           (v_tx, v_receber, v_x, 'Estorno Abatimento Crédito Indicação (fatura ' || NEW.id || ' cancelada)', 'subscriber', v_sub);
    INSERT INTO public.creditos_indicacao_uso (subscriber_id, invoice_id, ciclo, tipo, valor, transaction_id)
    VALUES (v_sub, NEW.id, date_trunc('month', NEW.mes_referencia)::date, 'estorno', v_x, v_tx);

    -- A fatura cancelada volta ao valor cheio: se for reemitida, o credito
    -- e aplicado de novo pelo caminho normal.
    UPDATE public.invoices
       SET valor_a_pagar = round(coalesce(valor_a_pagar, 0) + v_x, 2),
           abatimento_indicacao = 0
     WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_estornar_abatimento_indicacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_estornar_abatimento_indicacao ON public.invoices;
CREATE TRIGGER trg_estornar_abatimento_indicacao
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW
  WHEN (NEW.abatimento_indicacao > 0 AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_estornar_abatimento_indicacao();

-- ---------------------------------------------------------------------
-- 7. fn_calcular_fatura: recalcular nao apaga o abatimento
-- ---------------------------------------------------------------------
DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fn_calcular_fatura(uuid, boolean)'::regprocedure);
  IF strpos(d, 'abatimento_indicacao') > 0 THEN
    RETURN; -- ja aplicado
  END IF;
  IF strpos(d, 'i.valor_concessionaria, i.asaas_payment_id,') = 0
     OR strpos(d, '    return next;') = 0 THEN
    RAISE EXCEPTION 'fn_calcular_fatura mudou; revisar o patch do abatimento';
  END IF;
  d := replace(d, 'i.valor_concessionaria, i.asaas_payment_id,',
                  'i.valor_concessionaria, i.asaas_payment_id, i.abatimento_indicacao,');
  -- O abatimento sai do valor a pagar depois do calculo, nos dois modos.
  d := replace(d, E'    if p_gravar then\n        update public.invoices i',
                  E'    -- Credito de indicacao ja abatido (20261006a): continua abatido.\n'
               || E'    valor_a_pagar := greatest(0, round(valor_a_pagar - coalesce(f.abatimento_indicacao, 0), 2));\n\n'
               || E'    if p_gravar then\n        update public.invoices i');
  IF strpos(d, 'Credito de indicacao ja abatido') = 0 THEN
    RAISE EXCEPTION 'fn_calcular_fatura: ponto de insercao do abatimento nao encontrado';
  END IF;
  EXECUTE d;
END
$patch$;

-- ---------------------------------------------------------------------
-- 8. Razao: fatura quitada por credito nao paga taxa do Asaas
-- ---------------------------------------------------------------------
DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure);
  IF strpos(d, 'QUITADA_CREDITO') > 0 THEN
    RETURN;
  END IF;
  IF strpos(d, E'            v_taxa_asaas := 1.99;\n        END IF;') = 0 THEN
    RAISE EXCEPTION 'handle_invoice_paid_ledger mudou; revisar o patch da taxa';
  END IF;
  d := replace(d, E'            v_taxa_asaas := 1.99;\n        END IF;',
                  E'            v_taxa_asaas := 1.99;\n        END IF;\n'
               || E'        -- Quitada pelo credito de indicacao (20261006a): sem boleto, sem taxa.\n'
               || E'        IF NEW.asaas_status = ''QUITADA_CREDITO'' THEN\n'
               || E'            v_taxa_asaas := 0;\n'
               || E'        END IF;');
  EXECUTE d;
END
$patch$;

-- ---------------------------------------------------------------------
-- 9. Fila de emissao: cobranca adiada vai junto no proximo ciclo
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_fila_emissao_faturas(p_limite integer DEFAULT 50)
 RETURNS TABLE(subscriber_id uuid, subscriber_name text, billing_mode text, ciclo date, retroativo boolean, ucs integer, prontas integer, ja_cobradas integer, dispensadas integer, sem_valor integer, ausentes integer, total numeric, invoice_ids uuid[], vencimento_sugerido date, impedimento text, observacao text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with todas as (
        select cu.subscriber_id, i.mes_referencia, cu.id as uc_id, i.id as invoice_id,
               coalesce(i.valor_a_pagar, 0) as valor,
               -- adiada conta como resolvida no proprio ciclo: ela vai no proximo.
               (i.asaas_payment_id is not null or i.consolidated_invoice_id is not null
                or coalesce(i.cobranca_adiada, false)) as cobrada,
               coalesce(i.cobranca_adiada, false) as adiada,
               i.status::text as st
        from invoices i
        join consumer_units cu on cu.id = i.uc_id
        where coalesce(cu.nao_faturavel, false) = false
          and coalesce(cu.tipo_unidade, 'beneficiaria') <> 'geradora'
          and i.status::text <> 'cancelado'
    ),
    abertas as (select * from todas where not cobrada and st <> 'pago'),
    adiadas as (
        select * from todas
         where adiada and st not in ('pago', 'cancelada')
           and valor > 0
    ),
    ciclos  as (select distinct subscriber_id, mes_referencia from abertas),
    esperadas as (
        select c.subscriber_id, c.mes_referencia, cu.id as uc_id, cu.numero_uc
        from ciclos c
        join consumer_units cu on cu.subscriber_id = c.subscriber_id
        where coalesce(cu.nao_faturavel, false) = false
          and coalesce(cu.tipo_unidade, 'beneficiaria') <> 'geradora'
          and (cu.status::text in ('ativo','em_atraso','em_transf_titularidade')
               or exists (select 1 from abertas a
                          where a.uc_id = cu.id and a.mes_referencia = c.mes_referencia))
    ),
    classificada as (
        select e.subscriber_id, e.mes_referencia, e.numero_uc, t.invoice_id, t.valor,
               case
                   when coalesce(t.valor, 0) > 0 and not t.cobrada and t.st <> 'pago' then 'pronta'
                   when t.invoice_id is not null and (t.cobrada or t.st = 'pago')     then 'cobrada'
                   when exists (select 1 from dispensas_ciclo d
                                where d.uc_id = e.uc_id
                                  and d.ciclo = date_trunc('month', e.mes_referencia)::date)
                                                                                      then 'dispensada'
                   when t.invoice_id is null                                          then 'ausente'
                   else 'sem_valor'
               end as situacao
        from esperadas e
        left join todas t on t.uc_id = e.uc_id and t.mes_referencia = e.mes_referencia
    ),
    agregada as (
        select c.subscriber_id, c.mes_referencia,
               count(*)::int                                          as ucs,
               count(*) filter (where situacao='pronta')::int         as prontas,
               count(*) filter (where situacao='cobrada')::int        as ja_cobradas,
               count(*) filter (where situacao='dispensada')::int     as dispensadas,
               count(*) filter (where situacao='sem_valor')::int      as sem_valor,
               count(*) filter (where situacao='ausente')::int        as ausentes,
               coalesce(sum(valor) filter (where situacao='pronta'),0) as total,
               array_agg(invoice_id order by numero_uc)
                   filter (where situacao='pronta')                   as invoice_ids,
               string_agg(numero_uc, ', ' order by numero_uc)
                   filter (where situacao='sem_valor')                as ucs_sem_valor,
               string_agg(numero_uc, ', ' order by numero_uc)
                   filter (where situacao='ausente')                  as ucs_ausentes,
               string_agg(numero_uc, ', ' order by numero_uc)
                   filter (where situacao='dispensada')               as ucs_dispensadas,
               (select count(distinct a2.mes_referencia)
                  from abertas a2 where a2.subscriber_id = c.subscriber_id) as ciclos_pendentes,
               (select string_agg(to_char(x, 'MM/YYYY'), ', ' order by x)
                  from (select distinct a3.mes_referencia as x
                          from abertas a3 where a3.subscriber_id = c.subscriber_id) q) as lista_ciclos,
               (select max(a4.mes_referencia)
                  from abertas a4 where a4.subscriber_id = c.subscriber_id) as ciclo_mais_novo,
               (select min(a5.mes_referencia)
                  from abertas a5 where a5.subscriber_id = c.subscriber_id) as ciclo_mais_antigo
        from classificada c
        group by c.subscriber_id, c.mes_referencia
    ),
    -- As adiadas entram no ciclo aberto mais antigo do assinante (o que o
    -- emissor escolhe primeiro), desde que sejam de mes anterior a ele.
    com_adiadas as (
        select a.*,
               case when a.mes_referencia = a.ciclo_mais_antigo then
                    (select array_agg(d.invoice_id order by d.mes_referencia, d.invoice_id)
                       from adiadas d
                      where d.subscriber_id = a.subscriber_id and d.mes_referencia < a.mes_referencia)
               end as adiadas_ids,
               case when a.mes_referencia = a.ciclo_mais_antigo then
                    (select sum(d.valor) from adiadas d
                      where d.subscriber_id = a.subscriber_id and d.mes_referencia < a.mes_referencia)
               end as adiadas_total
        from agregada a
    )
    select a.subscriber_id,
           s.name,
           s.billing_mode::text,
           a.mes_referencia,
           (a.mes_referencia < a.ciclo_mais_novo) as retroativo,
           a.ucs, a.prontas, a.ja_cobradas, a.dispensadas, a.sem_valor, a.ausentes,
           round(a.total + coalesce(a.adiadas_total, 0), 2),
           case when a.invoice_ids is null then null
                else a.invoice_ids || coalesce(a.adiadas_ids, '{}'::uuid[]) end,
           public.fn_vencimento_sugerido(coalesce(s.consolidated_due_day, 10)),
           nullif(concat_ws('; ',
               case when a.ausentes > 0
                    then a.ausentes || ' UC ativa sem fatura no ciclo: ' || a.ucs_ausentes end,
               case when a.sem_valor > 0
                    then a.sem_valor || ' UC com fatura a R$ 0,00: ' || a.ucs_sem_valor end,
               case when a.prontas = 0
                    then 'nada apurado para cobrar' end
           ), '') as impedimento,
           nullif(concat_ws('; ',
               case when a.dispensadas > 0
                    then a.dispensadas || ' UC dispensada deste ciclo (volta a cobranca se a conta aparecer): '
                         || a.ucs_dispensadas end,
               case when a.ciclos_pendentes > 1
                    then a.ciclos_pendentes || ' ciclos em aberto (' || a.lista_ciclos
                         || ') -- cada um sai em boleto proprio' end,
               case when coalesce(cardinality(a.adiadas_ids), 0) > 0
                    then cardinality(a.adiadas_ids) || ' fatura(s) de ciclo anterior abaixo de R$ 5,00 vao junto' end
           ), '') as observacao
    from com_adiadas a
    join subscribers s on s.id = a.subscriber_id
    order by s.name, a.mes_referencia
    limit p_limite;
$function$;
