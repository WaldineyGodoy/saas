-- Task 16: handle_invoice_paid_ledger com permissao propria (decisao do dono, 22/09/2026)
--
-- Com o RLS de originators_v2 (Task 15), a funcao SECURITY INVOKER nao enxerga
-- a linha do originador quando quem marca a fatura como paga nao e papel
-- interno; a comissao (conta 2.1.2) e a gestao deixavam de ser lancadas em
-- silencio. A tela de Faturas e aberta a todos os papeis.
--
-- Corpo copiado byte a byte de pg_get_functiondef (md5(prosrc) =
-- f3f96c75af32fbbbd1591aacb3705999). A UNICA mudanca e o cabecalho:
-- SECURITY DEFINER + SET search_path. Nenhuma linha da logica foi alterada.
-- Dona da funcao: postgres (dona tambem de todas as tabelas que o corpo toca).

CREATE OR REPLACE FUNCTION public.handle_invoice_paid_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_usina_id uuid;
    v_supplier_id uuid;
    v_originator_id uuid;
    v_gestao_percentual numeric;
    v_service_values jsonb;
    v_tipo_unidade text;
    v_fatura_terceiro boolean;

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
    -- Only proceed if status changed to 'pago' or 'liquidado'
    IF NEW.status::text IN ('pago', 'liquidado') AND OLD.status IS DISTINCT FROM NEW.status THEN

        -- 1. Get Metadata (Usina, Supplier, Originator, Tipo Unidade)
        SELECT u.id, u.supplier_id, u.gestao_percentual, u.service_values, s.originator_id,
               cu.tipo_unidade, cu.fatura_consumo_terceiro
        INTO v_usina_id, v_supplier_id, v_gestao_percentual, v_service_values, v_originator_id,
             v_tipo_unidade, v_fatura_terceiro
        FROM public.consumer_units cu
        JOIN public.usinas u ON u.id = cu.usina_id
        LEFT JOIN public.subscribers s ON s.id = cu.subscriber_id
        WHERE cu.id = NEW.uc_id;

        -- GUARD CLAUSE: Do not process financial splits for 'geradora' units.
        -- Excecao: UG que abriga consumo de terceiro (telhado arrendado) tem
        -- assinante real sendo cobrado, entao o split roda normalmente.
        IF v_tipo_unidade = 'geradora' AND COALESCE(v_fatura_terceiro, false) = false THEN
            RETURN NEW;
        END IF;

        v_transaction_id := gen_random_uuid();
        v_valor_total := COALESCE(NEW.valor_a_pagar, 0); -- FIXED: Prevent null violation
        v_valor_concessionaria := COALESCE(NEW.valor_concessionaria, 0);
        v_base_calculo := v_valor_total - v_valor_concessionaria;

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
                v_comissao_recorrente := v_base_calculo * (COALESCE((v_split_originador->>'recurrent')::numeric, 0) / 100);

                IF v_is_first_invoice THEN
                    v_comissao_start := v_base_calculo * (COALESCE((v_split_originador->>'start')::numeric, 0) / 100);
                END IF;
            END IF;
        END IF;

        -- 4. Calculate B2W Management Fee (before commission deduction)
        -- Na fatura de start a B2W fica zerada (decisao do dono, 18/08/2026).
        IF v_comissao_start <> 0 THEN
            v_valor_b2w_gestao := 0;
        ELSE
            v_valor_b2w_gestao := (v_base_calculo * (COALESCE(v_gestao_percentual, 15) / 100)) - v_comissao_recorrente;

            -- A gestao nao fica negativa por causa da comissao recorrente: se a
            -- recorrente passa do gestao_percentual da usina, a B2W zera em vez de
            -- pagar do proprio bolso (decisao do dono, 18/08/2026).
            -- Restrito a base positiva de proposito: base negativa e prejuizo
            -- compartilhado, e ali a B2W deve mesmo absorver a sua fatia.
            IF v_base_calculo > 0 AND v_valor_b2w_gestao < 0 THEN
                v_valor_b2w_gestao := 0;
            END IF;
        END IF;

        -- 5. Calculate Service Values (Split into categories)
        IF v_service_values IS NOT NULL THEN
            v_valor_b2w_manutencao := COALESCE((v_service_values->>'Manutenção')::numeric, 0);
            v_valor_b2w_arrendamento := COALESCE((v_service_values->>'Arrendamento')::numeric, 0);
        END IF;

        -- 6. Calculate Investor Share (Residual)
        v_valor_investidor := v_valor_total - v_valor_concessionaria -
                              (v_valor_b2w_gestao + v_comissao_recorrente) -
                              v_comissao_start;

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

        -- 9. Create Entries
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        VALUES (v_transaction_id, v_account_bank, v_valor_total, 'Recebimento Fatura ' || NEW.id, 'invoice', NEW.id, CASE WHEN NEW.asaas_payment_id IS NULL THEN NULL ELSE NEW.asaas_payment_id || ':' || NEW.id END);

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_taxa_bancaria, v_taxa_asaas, 'Taxa Boleto Asaas', 'invoice', NEW.id);
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_bank, -v_taxa_asaas, 'Dedução Taxa Asaas', 'invoice', NEW.id);

        IF v_valor_concessionaria <> 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_concessionaria, -v_valor_concessionaria, 'Provisão Conta Energia', 'invoice', NEW.id);
        END IF;

        IF (v_comissao_start + v_comissao_recorrente) <> 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_comissoes, -(v_comissao_start + v_comissao_recorrente), 'Comissão Originador (Start+Rec)', 'originator', v_originator_id);
        END IF;

        IF v_valor_b2w_gestao <> 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_gestao, -v_valor_b2w_gestao, 'Receita Gestão B2W (Líquida)', 'invoice', NEW.id);
        END IF;

        -- Always insert investor repasse even if negative (debit) or zero (visibility)
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_investidor, -v_valor_investidor, 'Crédito Repasse Investidor', 'supplier', v_supplier_id);

    END IF;
    RETURN NEW;
END;
$function$;
