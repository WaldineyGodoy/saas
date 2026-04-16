-- Function to handle Invoice Payment (Income Split) with refined logic
CREATE OR REPLACE FUNCTION public.handle_invoice_paid_ledger()
RETURNS TRIGGER AS $$
DECLARE
    v_usina_id uuid;
    v_supplier_id uuid;
    v_originator_id uuid;
    v_gestao_percentual numeric;
    v_service_values jsonb;
    
    v_valor_total numeric;
    v_valor_concessionaria numeric;
    v_base_calculo numeric;
    
    v_is_first_invoice boolean;
    v_split_originador jsonb;
    v_comissao_start numeric := 0;
    v_comissao_recorrente numeric := 0;
    
    v_valor_b2w_gestao numeric;
    v_valor_b2w_manutencao numeric := 0;
    v_valor_b2w_arrendamento numeric := 0;
    v_valor_despesas_op numeric := 0;
    v_valor_investidor numeric;
    v_taxa_asaas numeric;
    
    v_transaction_id uuid;
    v_account_bank uuid;
    v_account_gestao uuid;
    v_account_manutencao uuid;
    v_account_arrendamento uuid;
    v_account_investidor uuid;
    v_account_concessionaria uuid;
    v_account_comissoes uuid;
    v_account_despesas_op uuid;
    v_account_taxa_bancaria uuid;
BEGIN
    -- Only proceed if status changed to 'pago'
    IF NEW.status = 'pago' AND (OLD.status IS DISTINCT FROM 'pago') THEN
        
        v_transaction_id := gen_random_uuid();
        v_valor_total := NEW.valor_a_pagar;
        v_valor_concessionaria := COALESCE(NEW.valor_concessionaria, 0);
        v_base_calculo := v_valor_total - v_valor_concessionaria;

        -- 1. Get Metadata (Usina, Supplier, Originator)
        SELECT u.id, u.supplier_id, u.gestao_percentual, u.service_values, s.originator_id
        INTO v_usina_id, v_supplier_id, v_gestao_percentual, v_service_values, v_originator_id
        FROM public.consumer_units cu
        JOIN public.usinas u ON u.id = cu.usina_id
        JOIN public.subscribers s ON s.id = cu.subscriber_id
        WHERE cu.id = NEW.uc_id;

        -- 2. Detect if it's the First Invoice Paid for this UC
        SELECT NOT EXISTS (
            SELECT 1 FROM public.invoices 
            WHERE uc_id = NEW.uc_id AND status = 'pago' AND id <> NEW.id
        ) INTO v_is_first_invoice;

        -- 3. Calculate Commissions (Originator)
        IF v_originator_id IS NOT NULL THEN
            SELECT split_commission INTO v_split_originador 
            FROM public.originators_v2 WHERE id = v_originator_id;

            IF v_split_originador IS NOT NULL THEN
                -- Recurrent (Paid by B2W from Gestão)
                v_comissao_recorrente := v_base_calculo * (COALESCE((v_split_originador->>'recurrent')::numeric, 0) / 100);
                
                -- Start (Paid by Investor - only first invoice)
                IF v_is_first_invoice THEN
                    v_comissao_start := v_base_calculo * (COALESCE((v_split_originador->>'start')::numeric, 0) / 100);
                END IF;
            END IF;
        END IF;

        -- 4. Calculate B2W Management Fee (before commission deduction)
        v_valor_b2w_gestao := (v_base_calculo * (COALESCE(v_gestao_percentual, 15) / 100)) - v_comissao_recorrente;

        -- 5. Calculate Service Values (Split into categories)
        IF v_service_values IS NOT NULL THEN
            v_valor_b2w_manutencao := COALESCE((v_service_values->>'Manutenção')::numeric, 0);
            v_valor_b2w_arrendamento := COALESCE((v_service_values->>'Arrendamento')::numeric, 0);
            
            v_valor_despesas_op := COALESCE((v_service_values->>'Água')::numeric, 0) + 
                                   COALESCE((v_service_values->>'Energia')::numeric, 0) + 
                                   COALESCE((v_service_values->>'Internet')::numeric, 0);
        END IF;

        -- 6. Calculate Investor Share (Residual)
        v_valor_investidor := v_valor_total - v_valor_concessionaria - 
                              (v_valor_b2w_gestao + v_comissao_recorrente) - 
                              v_valor_b2w_manutencao - v_valor_b2w_arrendamento - 
                              v_valor_despesas_op - v_comissao_start;

        -- 7. Calculate Asaas Fee (0.99 or 1.99)
        IF NOW() < '2026-04-19'::timestamp THEN
            v_taxa_asaas := 0.99;
        ELSE
            v_taxa_asaas := 1.99;
        END IF;

        -- 8. Get Account IDs
        SELECT id INTO v_account_bank FROM public.ledger_accounts WHERE code = '1.1.1.01';
        SELECT id INTO v_account_taxa_bancaria FROM public.ledger_accounts WHERE code = '4.1.1';
        SELECT id INTO v_account_gestao FROM public.ledger_accounts WHERE code = '3.1.1';
        SELECT id INTO v_account_manutencao FROM public.ledger_accounts WHERE code = '3.1.3';
        SELECT id INTO v_account_arrendamento FROM public.ledger_accounts WHERE code = '3.1.4';
        SELECT id INTO v_account_investidor FROM public.ledger_accounts WHERE code = '2.1.1';
        SELECT id INTO v_account_concessionaria FROM public.ledger_accounts WHERE code = '2.1.3.01';
        SELECT id INTO v_account_comissoes FROM public.ledger_accounts WHERE code = '2.1.2';
        SELECT id INTO v_account_despesas_op FROM public.ledger_accounts WHERE code = '2.1.4';

        -- 9. Create Entries
        -- [Lógica de inserções no ledger_entries conforme o trigger aplicado via migration]
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        VALUES (v_transaction_id, v_account_bank, v_valor_total, 'Recebimento Fatura ' || NEW.id, 'invoice', NEW.id, NEW.asaas_payment_id);

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_taxa_bancaria, v_taxa_asaas, 'Taxa Boleto Asaas', 'invoice', NEW.id);
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_bank, -v_taxa_asaas, 'Dedução Taxa Asaas', 'invoice', NEW.id);

        IF v_valor_concessionaria > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_concessionaria, -v_valor_concessionaria, 'Provisão Conta Energia', 'invoice', NEW.id);
        END IF;

        IF (v_comissao_start + v_comissao_recorrente) > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_comissoes, -(v_comissao_start + v_comissao_recorrente), 'Comissão Originador (Start+Rec)', 'originator', v_originator_id);
        END IF;

        IF v_valor_b2w_gestao > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_gestao, -v_valor_b2w_gestao, 'Receita Gestão B2W (Líquida)', 'invoice', NEW.id);
        END IF;
        
        IF v_valor_b2w_manutencao > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_manutencao, -v_valor_b2w_manutencao, 'Receita Manutenção B2W', 'invoice', NEW.id);
        END IF;

        IF v_valor_b2w_arrendamento > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_arrendamento, -v_valor_b2w_arrendamento, 'Receita Arrendamento B2W', 'invoice', NEW.id);
        END IF;

        IF v_valor_despesas_op > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_despesas_op, -v_valor_despesas_op, 'Provisão Despesas Operacionais Usina', 'invoice', NEW.id);
        END IF;

        IF v_valor_investidor > 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_investidor, -v_valor_investidor, 'Crédito Repasse Investidor', 'supplier', v_supplier_id);
        END IF;

    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para Faturas
DROP TRIGGER IF EXISTS tr_invoice_paid_ledger ON public.invoices;
CREATE TRIGGER tr_invoice_paid_ledger
    AFTER UPDATE ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_invoice_paid_ledger();

-- RPC para liquidar pagamento de concessionária
CREATE OR REPLACE FUNCTION public.liquidate_concessionaria_payment(p_invoice_id uuid, p_amount numeric)
RETURNS void AS $$
DECLARE
    v_transaction_id uuid := gen_random_uuid();
    v_account_bank uuid;
    v_account_concessionaria uuid;
BEGIN
    SELECT id INTO v_account_bank FROM public.ledger_accounts WHERE code = '1.1.1.01';
    SELECT id INTO v_account_concessionaria FROM public.ledger_accounts WHERE code = '2.1.3.01';

    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (v_transaction_id, v_account_concessionaria, p_amount, 'Liquidação Conta Energia', 'invoice', p_invoice_id);

    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (v_transaction_id, v_account_bank, -p_amount, 'Pagamento Conta Energia (Banco)', 'invoice', p_invoice_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
