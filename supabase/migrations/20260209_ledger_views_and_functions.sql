-- 1. Create a helper View to link Ledger Entries to Entities (Originator/Supplier)
CREATE OR REPLACE VIEW public.view_ledger_enriched AS
SELECT
    le.id,
    le.transaction_id,
    le.account_id,
    la.code as account_code,
    la.name as account_name,
    la.type as account_type,
    le.amount,
    le.description,
    le.reference_type,
    le.reference_id,
    le.created_at,
    -- Derive Originator ID: Invoice -> UC -> Subscriber -> Originator
    CASE
        WHEN le.reference_type = 'invoice' THEN s.originator_id
        WHEN le.reference_type = 'payout_originator' THEN ft.destination_id
        ELSE NULL
    END as originator_id,
    -- Derive Supplier ID: Invoice -> UC -> Usina -> Supplier
    CASE
        WHEN le.reference_type = 'invoice' THEN u.supplier_id
        WHEN le.reference_type = 'payout_usina' THEN ft.destination_id
        ELSE NULL
    END as supplier_id,
    -- Derive Usina ID
    CASE
        WHEN le.reference_type = 'invoice' THEN cu.usina_id 
        WHEN le.reference_type = 'payout_usina' THEN NULL 
        ELSE NULL
    END as usina_id
FROM public.ledger_entries le
JOIN public.ledger_accounts la ON le.account_id = la.id
LEFT JOIN public.invoices i ON le.reference_type = 'invoice' AND le.reference_id = i.id
LEFT JOIN public.financial_transfers ft ON le.reference_type LIKE 'payout_%' AND le.reference_id = ft.id
-- Joins for derivation
LEFT JOIN public.consumer_units cu ON i.uc_id = cu.id
LEFT JOIN public.subscribers s ON cu.subscriber_id = s.id
LEFT JOIN public.usinas u ON cu.usina_id = u.id;

-- 2. Function to Get Balance for an Entity
CREATE OR REPLACE FUNCTION public.get_financial_balance(
    p_entity_id uuid,
    p_entity_type text -- 'originator' or 'supplier'
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_balance numeric := 0;
    v_account_code text;
BEGIN
    IF p_entity_type = 'originator' THEN
        v_account_code := '2.1.2'; -- Comissões a Pagar (Liability)
        
        -- Sum is Negative (Credit). Balance is positive debt.
        SELECT COALESCE(ABS(SUM(amount)), 0)
        INTO v_balance
        FROM public.view_ledger_enriched
        WHERE originator_id = p_entity_id
        AND account_code = v_account_code;
        
    ELSIF p_entity_type = 'supplier' THEN
        v_account_code := '2.1.1'; -- Obrigações Usina
        
        SELECT COALESCE(ABS(SUM(amount)), 0)
        INTO v_balance
        FROM public.view_ledger_enriched
        WHERE supplier_id = p_entity_id
        AND account_code = v_account_code;
    END IF;

    RETURN v_balance;
END;
$$;

-- 3. Function to Get Statement (Extrato)
CREATE OR REPLACE FUNCTION public.get_financial_statement(
    p_entity_id uuid,
    p_entity_type text
)
RETURNS TABLE (
    id uuid,
    created_at timestamptz,
    description text,
    type text, -- 'credit', 'debit'
    amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        v.id,
        v.created_at,
        v.description,
        CASE WHEN v.amount < 0 THEN 'credit' ELSE 'debit' END as type,
        ABS(v.amount) as amount
    FROM public.view_ledger_enriched v
    WHERE 
        (p_entity_type = 'originator' AND v.originator_id = p_entity_id AND v.account_code = '2.1.2')
        OR
        (p_entity_type = 'supplier' AND v.supplier_id = p_entity_id AND v.account_code = '2.1.1')
    ORDER BY v.created_at DESC;
END;
$$;

-- 4. Materialized View for "Closed Invoices" and B2W Profit
DROP MATERIALIZED VIEW IF EXISTS public.mv_closed_invoices_financials;
CREATE MATERIALIZED VIEW public.mv_closed_invoices_financials AS
SELECT
    i.id as invoice_id,
    i.mes_referencia,
    i.status,
    i.valor_a_pagar as total_invoice_value,
    -- B2W Revenue (Account 3.1.1)
    COALESCE(ABS((
        SELECT SUM(le.amount) 
        FROM public.ledger_entries le 
        JOIN public.ledger_accounts la ON le.account_id = la.id 
        WHERE le.reference_id = i.id AND la.code = '3.1.1'
    )), 0) as b2w_revenue,
    -- Supplier Portion (Account 2.1.1)
    COALESCE(ABS((
        SELECT SUM(le.amount) 
        FROM public.ledger_entries le 
        JOIN public.ledger_accounts la ON le.account_id = la.id 
        WHERE le.reference_id = i.id AND la.code = '2.1.1'
    )), 0) as supplier_share,
    -- Commission (Account 2.1.2)
    COALESCE(ABS((
        SELECT SUM(le.amount) 
        FROM public.ledger_entries le 
        JOIN public.ledger_accounts la ON le.account_id = la.id 
        WHERE le.reference_id = i.id AND la.code = '2.1.2'
    )), 0) as commission_share,
    -- Entity Links
    s.originator_id,
    u.supplier_id,
    cu.usina_id,
    cu.subscriber_id,
    i.created_at
FROM public.invoices i
LEFT JOIN public.consumer_units cu ON i.uc_id = cu.id
LEFT JOIN public.subscribers s ON cu.subscriber_id = s.id
LEFT JOIN public.usinas u ON cu.usina_id = u.id
WHERE i.status = 'pago';

CREATE INDEX idx_mv_closed_invoices_originator ON public.mv_closed_invoices_financials(originator_id);
CREATE INDEX idx_mv_closed_invoices_supplier ON public.mv_closed_invoices_financials(supplier_id);

GRANT SELECT ON public.view_ledger_enriched TO authenticated;
GRANT SELECT ON public.mv_closed_invoices_financials TO authenticated;
