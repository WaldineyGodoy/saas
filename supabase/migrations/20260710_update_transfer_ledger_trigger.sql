-- Update trigger function to process transfers only on 'completed' status
CREATE OR REPLACE FUNCTION public.handle_transfer_ledger()
RETURNS trigger AS $$
DECLARE
    v_transaction_id uuid;
    v_account_bank uuid;
    v_account_liab uuid;
    v_account_code text;
    v_is_sandbox boolean;
BEGIN
    -- Check current environment
    SELECT (environment = 'sandbox') INTO v_is_sandbox 
    FROM public.integrations_config 
    WHERE service_name = 'financial_api';
    
    v_is_sandbox := COALESCE(v_is_sandbox, false);

    -- When a transfer is COMPLETED (either newly inserted or transitioned from pending)
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
        v_transaction_id := gen_random_uuid();
        
        IF NEW.destination_type IN ('usina', 'supplier') THEN
            v_account_code := '2.1.1';
        ELSIF NEW.destination_type = 'originator' THEN
            v_account_code := '2.1.2';
        ELSE
            v_account_code := '2.1.0';
        END IF;

        SELECT id INTO v_account_liab FROM public.ledger_accounts WHERE code = v_account_code;
        SELECT id INTO v_account_bank FROM public.ledger_accounts WHERE code = '1.1.1.01';

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id, is_sandbox)
        VALUES (v_transaction_id, v_account_liab, NEW.amount, 'Pagamento Transferência/PIX', 'payout_' || NEW.destination_type, NEW.id, NEW.asaas_transfer_id, v_is_sandbox);

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, is_sandbox)
        VALUES (v_transaction_id, v_account_bank, -NEW.amount, 'Saída Banco Asaas', 'payout_' || NEW.destination_type, NEW.id, v_is_sandbox);

    -- When a transfer fails or is reversed, we ONLY reverse it if it was previously completed
    ELSIF NEW.status IN ('failed', 'reversed') AND OLD.status = 'completed' THEN
        v_transaction_id := gen_random_uuid();
        
        IF NEW.destination_type IN ('usina', 'supplier') THEN
            v_account_code := '2.1.1';
        ELSIF NEW.destination_type = 'originator' THEN
            v_account_code := '2.1.2';
        ELSE
            v_account_code := '2.1.0';
        END IF;

        SELECT id INTO v_account_liab FROM public.ledger_accounts WHERE code = v_account_code;
        SELECT id INTO v_account_bank FROM public.ledger_accounts WHERE code = '1.1.1.01';

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id, is_sandbox)
        VALUES (v_transaction_id, v_account_liab, -NEW.amount, 'Estorno Transferência Falha', 'payout_' || NEW.destination_type, NEW.id, NEW.asaas_transfer_id, v_is_sandbox);

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, is_sandbox)
        VALUES (v_transaction_id, v_account_bank, NEW.amount, 'Estorno Saída Banco Asaas', 'payout_' || NEW.destination_type, NEW.id, v_is_sandbox);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
