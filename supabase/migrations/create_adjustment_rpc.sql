CREATE OR REPLACE FUNCTION public.register_supplier_refund(
    p_supplier_id uuid,
    p_invoice_id uuid,
    p_amount numeric,
    p_description text DEFAULT 'Estorno de Provisão / Crédito Ajuste Faturamento'
) RETURNS void AS $$
DECLARE
    v_transaction_id uuid := gen_random_uuid();
    v_account_investidor uuid;
    v_account_concessionaria uuid;
BEGIN
    SELECT id INTO v_account_investidor FROM public.ledger_accounts WHERE code = '2.1.1';
    SELECT id INTO v_account_concessionaria FROM public.ledger_accounts WHERE code = '2.1.3.01';

    -- 1. Crédito na conta do Fornecedor (aumentando o saldo a receber dele)
    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (v_transaction_id, v_account_investidor, -p_amount, p_description, 'supplier', p_supplier_id);

    -- 2. Débito (estorno) na provisão da Concessionária
    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (v_transaction_id, v_account_concessionaria, p_amount, p_description, 'invoice', p_invoice_id);

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
