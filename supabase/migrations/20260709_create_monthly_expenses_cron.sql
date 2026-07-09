-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Stored Procedure to run monthly fixed expenses
CREATE OR REPLACE FUNCTION public.run_monthly_fixed_expenses(p_date date DEFAULT CURRENT_DATE)
RETURNS void AS $$
DECLARE
    v_ref_date date;
    v_ref_month_name text;
    v_ref_year text;
    
    v_usina record;
    
    v_manutencao numeric;
    v_arrendamento numeric;
    v_internet numeric;
    v_seguranca numeric;
    v_agua numeric;
    v_energia numeric;
    v_servicos_total numeric;
    
    v_transaction_id uuid;
    
    v_account_fornecedor uuid;
    v_account_manutencao uuid;
    v_account_arrendamento uuid;
    v_account_despesas_op uuid;
    
    v_months text[] := ARRAY['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    v_month_idx integer;
BEGIN
    -- Determine reference month (previous month)
    v_ref_date := p_date - INTERVAL '1 month';
    v_month_idx := EXTRACT(MONTH FROM v_ref_date);
    v_ref_month_name := v_months[v_month_idx];
    v_ref_year := EXTRACT(YEAR FROM v_ref_date)::text;

    -- Get Ledger Accounts
    SELECT id INTO v_account_fornecedor FROM public.ledger_accounts WHERE code = '2.1.1';
    SELECT id INTO v_account_manutencao FROM public.ledger_accounts WHERE code = '3.1.3';
    SELECT id INTO v_account_arrendamento FROM public.ledger_accounts WHERE code = '3.1.4';
    SELECT id INTO v_account_despesas_op FROM public.ledger_accounts WHERE code = '2.1.4';

    -- Loop through active usinas
    FOR v_usina IN (SELECT id, supplier_id, name, service_values FROM public.usinas WHERE status = 'active' OR status = 'Ativo') LOOP
        
        -- Parse service values
        v_manutencao := COALESCE((v_usina.service_values->>'Manutenção')::numeric, 0);
        v_arrendamento := COALESCE((v_usina.service_values->>'Arrendamento')::numeric, 0);
        
        v_internet := COALESCE((v_usina.service_values->>'Internet')::numeric, 0);
        v_seguranca := COALESCE((v_usina.service_values->>'Segurança')::numeric, 0);
        v_agua := COALESCE((v_usina.service_values->>'Água')::numeric, 0);
        v_energia := COALESCE((v_usina.service_values->>'Energia')::numeric, 0);
        
        v_servicos_total := v_internet + v_seguranca + v_agua + v_energia;
        
        -- If there are expenses to launch
        IF (v_manutencao + v_arrendamento + v_servicos_total) > 0 THEN
            v_transaction_id := gen_random_uuid();
            
            -- 1. Insert into ledger_entries to debit the supplier (positive amount in passivo decreases balance)
            IF v_manutencao > 0 THEN
                -- Debit Supplier
                INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
                VALUES (v_transaction_id, v_account_fornecedor, v_manutencao, 'Despesa Fixa: Manutenção - ' || v_ref_month_name || '/' || v_ref_year, 'supplier', v_usina.supplier_id);
                
                -- Credit B2W Revenue
                INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
                VALUES (v_transaction_id, v_account_manutencao, -v_manutencao, 'Receita Manutenção (' || v_usina.name || ')', 'supplier', v_usina.supplier_id);
                
                -- Cashbook Entry
                INSERT INTO public.cashbook (usina_id, type, category, amount, description, status, transaction_date)
                VALUES (v_usina.id, 'saida', 'manutencao', v_manutencao, 'Manutenção - Ref. ' || v_ref_month_name || '/' || v_ref_year, 'provisionado', CURRENT_TIMESTAMP);
            END IF;

            IF v_arrendamento > 0 THEN
                -- Debit Supplier
                INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
                VALUES (v_transaction_id, v_account_fornecedor, v_arrendamento, 'Despesa Fixa: Arrendamento - ' || v_ref_month_name || '/' || v_ref_year, 'supplier', v_usina.supplier_id);
                
                -- Credit B2W Revenue
                INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
                VALUES (v_transaction_id, v_account_arrendamento, -v_arrendamento, 'Receita Arrendamento (' || v_usina.name || ')', 'supplier', v_usina.supplier_id);
                
                -- Cashbook Entry
                INSERT INTO public.cashbook (usina_id, type, category, amount, description, status, transaction_date)
                VALUES (v_usina.id, 'saida', 'arrendamento', v_arrendamento, 'Arrendamento - Ref. ' || v_ref_month_name || '/' || v_ref_year, 'provisionado', CURRENT_TIMESTAMP);
            END IF;

            IF v_servicos_total > 0 THEN
                -- Debit Supplier
                INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
                VALUES (v_transaction_id, v_account_fornecedor, v_servicos_total, 'Despesas Fixas: Serviços (Net/Seg/Agua/En) - ' || v_ref_month_name || '/' || v_ref_year, 'supplier', v_usina.supplier_id);
                
                -- Credit Despesas Operacionais
                INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
                VALUES (v_transaction_id, v_account_despesas_op, -v_servicos_total, 'Serviços (' || v_usina.name || ')', 'supplier', v_usina.supplier_id);
                
                -- Cashbook Entry
                INSERT INTO public.cashbook (usina_id, type, category, amount, description, status, transaction_date)
                VALUES (v_usina.id, 'saida', 'servicos', v_servicos_total, 'Serviços Gerais - Ref. ' || v_ref_month_name || '/' || v_ref_year, 'provisionado', CURRENT_TIMESTAMP);
            END IF;
            
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove existing job if it exists to replace it
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('monthly_expenses')
        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly_expenses');

        -- Schedule job to run at 00:05 on day 1 of every month
        PERFORM cron.schedule('monthly_expenses', '5 0 1 * *', 'SELECT public.run_monthly_fixed_expenses()');
    END IF;
END $$;
