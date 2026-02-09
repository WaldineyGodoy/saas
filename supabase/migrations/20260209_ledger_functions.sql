-- Function to handle Invoice Payment (Income Split)
CREATE OR REPLACE FUNCTION public.handle_invoice_paid_ledger()
RETURNS TRIGGER AS $$
DECLARE
    v_usina_id uuid;
    v_gestao_percentual numeric;
    v_valor_total numeric;
    v_valor_cip numeric;
    v_valor_b2w numeric;
    v_valor_usina numeric;
    v_valor_comissao numeric := 0;
    v_transaction_id uuid;
    v_account_bank uuid;
    v_account_income_b2w uuid;
    v_account_liab_usina uuid;
    v_account_liab_cip uuid;
    v_account_liab_comm uuid;
BEGIN
    -- Only proceed if status changed to 'pago'
    IF NEW.status = 'pago' AND (OLD.status IS DISTINCT FROM 'pago') THEN
        
        v_transaction_id := gen_random_uuid();
        v_valor_total := NEW.valor_a_pagar;
        v_valor_cip := COALESCE(NEW.iluminacao_publica, 0) + COALESCE(NEW.tarifa_minima_custo_disp, 0); -- Adding Available Cost to CIP/Pass-through

        -- Get Usina and Percentage
        SELECT u.id, COALESCE(u.gestao_percentual, 15) -- Default 15% if null
        INTO v_usina_id, v_gestao_percentual
        FROM public.consumer_units cu
        JOIN public.usinas u ON u.id = cu.usina_id
        WHERE cu.id = NEW.uc_id;

        -- Check for Commissions related to this invoice
        SELECT COALESCE(SUM(valor_pagar), 0)
        INTO v_valor_comissao
        FROM public.commissions
        WHERE invoice_id = NEW.id AND status = 'em_aberto';

        -- Calculate B2W Fee (Service Revenue)
        -- Assuming B2W fee is calculated on the Gross Receipt (Total - CIP)? Or Total?
        -- Let's assume on Total for now, or Total - CIP. 
        -- Standard: Fee on the Energy Generation Value. 
        -- Let's use simple logic: B2W Fee = Total * % (Adjust if needed by user)
        v_valor_b2w := (v_valor_total - v_valor_cip) * (v_gestao_percentual / 100);
        
        -- Calculate Usina Share (Residual)
        v_valor_usina := v_valor_total - v_valor_cip - v_valor_b2w - v_valor_comissao;

        -- Get Account IDs (using codes from seed)
        SELECT id INTO v_account_bank FROM public.ledger_accounts WHERE code = '1.1.1.01'; -- Asaas
        SELECT id INTO v_account_income_b2w FROM public.ledger_accounts WHERE code = '3.1.1'; -- Taxa B2W
        SELECT id INTO v_account_liab_usina FROM public.ledger_accounts WHERE code = '2.1.1'; -- Obrigações Usina
        SELECT id INTO v_account_liab_cip FROM public.ledger_accounts WHERE code = '2.1.3.01'; -- CIP
        SELECT id INTO v_account_liab_comm FROM public.ledger_accounts WHERE code = '2.1.2'; -- Comissões

        -- Create Entries

        -- 1. DEBIT BANK (Total Receipt)
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        VALUES (v_transaction_id, v_account_bank, v_valor_total, 'Recebimento Fatura ' || NEW.id, 'invoice', NEW.id, NEW.asaas_payment_id);

        -- 2. CREDIT CIP (If any)
        IF v_valor_cip > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_liab_cip, -v_valor_cip, 'Repasse CD/CIP', 'invoice', NEW.id);
        END IF;

        -- 3. CREDIT COMMISSIONS (If any)
        IF v_valor_comissao > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_liab_comm, -v_valor_comissao, 'Provisão Comissão', 'invoice', NEW.id);
        END IF;

        -- 4. CREDIT B2W REVENUE
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_income_b2w, -v_valor_b2w, 'Receita Taxa Gestão', 'invoice', NEW.id);

        -- 5. CREDIT USINA LIABILITY (The rest)
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_liab_usina, -v_valor_usina, 'A Pagar Usina', 'invoice', NEW.id);

    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for Invoices
DROP TRIGGER IF EXISTS tr_invoice_paid_ledger ON public.invoices;
CREATE TRIGGER tr_invoice_paid_ledger
    AFTER UPDATE ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_invoice_paid_ledger();


-- Function to handle Financial Transfers (Payouts)
CREATE OR REPLACE FUNCTION public.handle_transfer_ledger()
RETURNS TRIGGER AS $$
DECLARE
    v_transaction_id uuid;
    v_account_bank uuid;
    v_account_liab uuid;
    v_account_code text;
BEGIN
    -- Only if status is completed
    IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed' OR OLD.status IS NULL) THEN
        
        v_transaction_id := gen_random_uuid();
        
        -- Determine Liability Account based on Destination
        IF NEW.destination_type = 'usina' THEN
            v_account_code := '2.1.1'; -- Obrigações Usina
        ELSIF NEW.destination_type = 'originator' THEN
            v_account_code := '2.1.2'; -- Comissões
        ELSE
            v_account_code := '2.1.0'; -- Generic Liability fallback
        END IF;

        SELECT id INTO v_account_liab FROM public.ledger_accounts WHERE code = v_account_code;
        SELECT id INTO v_account_bank FROM public.ledger_accounts WHERE code = '1.1.1.01'; -- Asaas

        -- 1. DEBIT LIABILITY (Reduce Debt)
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        VALUES (v_transaction_id, v_account_liab, NEW.amount, 'Pagamento Transferência/PIX', 'payout_' || NEW.destination_type, NEW.id, NEW.asaas_transfer_id);

        -- 2. CREDIT BANK (Money Out)
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_bank, -NEW.amount, 'Saída Banco Asaas', 'payout_' || NEW.destination_type, NEW.id);

    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for Financial Transfers
DROP TRIGGER IF EXISTS tr_transfer_ledger ON public.financial_transfers;
CREATE TRIGGER tr_transfer_ledger
    AFTER INSERT OR UPDATE ON public.financial_transfers
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_transfer_ledger();
