-- Teste: handle_invoice_paid_ledger lanca a comissao do originador (conta 2.1.2)
-- com o MESMO valor, seja quem marcar a fatura como paga papel interno ou nao.
--
-- Contexto: com o RLS de originators_v2 (Task 15), a funcao SECURITY INVOKER
-- enxerga zero linhas quando quem roda o UPDATE nao e papel interno, e a
-- comissao some em silencio. A migracao 20260922g torna a funcao SECURITY
-- DEFINER (dona: postgres) sem tocar na logica.
--
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).

DO $$
DECLARE
    v_role_original     text := current_user;
    -- perfis reais (producao): um assinante (nao interno) e um admin
    v_perfil_assinante  uuid := '2b750e88-4737-4551-b051-273e453c77dc';
    v_perfil_admin      uuid := 'f03891c0-b4ba-4b90-af45-8c28b80aa2cf';

    v_orig              uuid;
    v_usina             uuid;
    v_sub               uuid;
    v_uc                uuid;
    v_inv               uuid;
    v_acc_comissoes     uuid;
    v_txn               uuid;

    v_base              numeric := 1000;
    v_esperado          numeric;
    v_comissao_externo  numeric;
    v_comissao_admin    numeric;
BEGIN
    SELECT id INTO v_acc_comissoes FROM public.ledger_accounts WHERE code = '2.1.2';
    IF v_acc_comissoes IS NULL THEN
        RAISE EXCEPTION 'FALHA: conta 2.1.2 nao existe no plano de contas';
    END IF;

    -- fixture ------------------------------------------------------------
    INSERT INTO public.originators_v2 (name, split_commission)
    VALUES ('SANDBOX Originador Task16', '{"start": 10, "recurrent": 4}'::jsonb)
    RETURNING id INTO v_orig;

    INSERT INTO public.usinas (gestao_percentual) VALUES (15) RETURNING id INTO v_usina;

    INSERT INTO public.subscribers (originator_id) VALUES (v_orig) RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', v_base, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    -- primeira fatura paga da UC: start (10%) + recorrente (4%) sobre a base
    v_esperado := -(v_base * 0.10 + v_base * 0.04);

    -- 1) quem marca como paga NAO e papel interno -------------------------
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_perfil_assinante, 'role', 'authenticated')::text, true);

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    PERFORM set_config('role', v_role_original, true);
    PERFORM set_config('request.jwt.claims', '', true);

    SELECT COALESCE(SUM(amount), 0) INTO v_comissao_externo
      FROM public.ledger_entries
     WHERE account_id = v_acc_comissoes AND reference_id = v_orig;

    -- desfaz os lancamentos para repetir o cenario como admin
    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv LIMIT 1;
    IF v_txn IS NOT NULL THEN
        DELETE FROM public.ledger_entries WHERE transaction_id = v_txn;
    END IF;
    DELETE FROM public.ledger_entries WHERE reference_id = v_orig;
    UPDATE public.invoices SET status = 'a_vencer' WHERE id = v_inv;

    -- 2) quem marca como paga E admin -------------------------------------
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_perfil_admin, 'role', 'authenticated')::text, true);

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    PERFORM set_config('role', v_role_original, true);
    PERFORM set_config('request.jwt.claims', '', true);

    SELECT COALESCE(SUM(amount), 0) INTO v_comissao_admin
      FROM public.ledger_entries
     WHERE account_id = v_acc_comissoes AND reference_id = v_orig;

    -- asserts -------------------------------------------------------------
    IF v_comissao_admin <> v_esperado THEN
        RAISE EXCEPTION 'FALHA: admin lancou % na conta 2.1.2, esperado %',
            v_comissao_admin, v_esperado;
    END IF;

    IF v_comissao_externo <> v_comissao_admin THEN
        RAISE EXCEPTION 'FALHA: papel nao interno lancou % na conta 2.1.2 e admin lancou % (comissao perdida em silencio)',
            v_comissao_externo, v_comissao_admin;
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
