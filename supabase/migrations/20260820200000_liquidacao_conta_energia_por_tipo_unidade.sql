-- Liquidação da conta de energia: a contrapartida depende do tipo da UC.
--
-- Beneficiária: a B2W recebeu do assinante e repassa à concessionária. A
-- provisão nasce em 2.1.3.01 (Repasse Concessionária) dentro de
-- handle_invoice_paid_ledger, quando a fatura do assinante é paga.
--
-- Geradora: não há cobrança ao assinante — handle_invoice_paid_ledger tem
-- guard clause e retorna antes de provisionar. A conta da UG é despesa da
-- usina, provisionada em 2.1.4 (Despesas Operacionais Usina) pelo
-- cron-monthly-expenses. Debitar 2.1.3.01 aqui deixaria esse passivo
-- invertido, com débito sem provisão correspondente.

CREATE OR REPLACE FUNCTION public.liquidate_concessionaria_payment(p_invoice_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_transaction_id uuid := gen_random_uuid();
    v_account_bank uuid;
    v_account_destino uuid;
    v_tipo_unidade text;
    v_descricao text;
BEGIN
    SELECT cu.tipo_unidade
      INTO v_tipo_unidade
      FROM public.invoices i
      JOIN public.consumer_units cu ON cu.id = i.uc_id
     WHERE i.id = p_invoice_id;

    SELECT id INTO v_account_bank FROM public.ledger_accounts WHERE code = '1.1.1.01';

    IF v_tipo_unidade = 'geradora' THEN
        SELECT id INTO v_account_destino FROM public.ledger_accounts WHERE code = '2.1.4';
        v_descricao := 'Liquidação Conta Energia UG (Despesa Usina)';
    ELSE
        SELECT id INTO v_account_destino FROM public.ledger_accounts WHERE code = '2.1.3.01';
        v_descricao := 'Liquidação Conta Energia';
    END IF;

    IF v_account_destino IS NULL OR v_account_bank IS NULL THEN
        RAISE EXCEPTION 'Plano de contas incompleto: conta de destino ou banco nao encontrada';
    END IF;

    -- 1. Debitar o passivo (diminui o saldo credor acumulado)
    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (v_transaction_id, v_account_destino, p_amount, v_descricao, 'invoice', p_invoice_id);

    -- 2. Creditar Banco (saída de dinheiro da B2W)
    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (v_transaction_id, v_account_bank, -p_amount, 'Pagamento Conta Energia (Banco)', 'invoice', p_invoice_id);
END;
$function$;
