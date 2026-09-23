-- Teste: handle_invoice_paid_ledger lanca o rateio da fatura paga com permissao
-- propria (SECURITY DEFINER), sem depender do que o chamador enxerga.
--
-- Contexto: com o RLS de originators_v2 (Task 15), a funcao SECURITY INVOKER
-- enxergava zero linhas quando quem rodava o UPDATE nao era papel interno. Nao
-- sumia so a comissao (2.1.2): sem o split, a gestao B2W (3.1.1) inflava e o
-- residuo do investidor (2.1.1) mudava. Por isso as tres contas sao conferidas.
--
-- ATENCAO (22/09/2026): a migracao 20260922h_invoices_pagamento_admin, aplicada
-- DEPOIS da 20260922g, fechou o UPDATE de invoices a papel interno
-- (invoices_update_interno, WITH CHECK fn_papel_interno()). Hoje o papel nao
-- interno e barrado ANTES de chegar no gatilho. O teste cobre os dois mundos:
--   * barrado  -> registra o bloqueio e cobra a propriedade no catalogo
--                 (SECURITY DEFINER, dona postgres, search_path fixo);
--   * liberado -> compara conta a conta o rateio do papel nao interno com o do
--                 admin, que e o cenario original da Task 16.
-- Se a politica de invoices for afrouxada de novo, o ramo de comparacao volta a
-- rodar sozinho.
--
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).

DO $$
DECLARE
    v_role_original     text := current_user;
    -- perfis reais (producao): um assinante (nao interno) e um admin.
    -- O papel de cada um e conferido em tempo de execucao, para o teste nao
    -- virar "admin contra admin" em silencio se a linha mudar de papel.
    v_perfil_assinante  uuid := '2b750e88-4737-4551-b051-273e453c77dc';
    v_perfil_admin      uuid := 'f03891c0-b4ba-4b90-af45-8c28b80aa2cf';

    v_orig              uuid;
    v_usina             uuid;
    v_sub               uuid;
    v_uc                uuid;
    v_inv               uuid;
    v_txn               uuid;

    v_acc_comissoes     uuid;  -- 2.1.2
    v_acc_gestao        uuid;  -- 3.1.1
    v_acc_investidor    uuid;  -- 2.1.1

    v_base              numeric := 1000;
    v_esp_comissoes     numeric;
    v_esp_gestao        numeric;
    v_esp_investidor    numeric;

    v_externo_rodou     boolean := false;
    v_ext_comissoes     numeric;
    v_ext_gestao        numeric;
    v_ext_investidor    numeric;
    v_adm_comissoes     numeric;
    v_adm_gestao        numeric;
    v_adm_investidor    numeric;

    v_secdef            boolean;
    v_dona              text;
    v_config            text;
BEGIN
    -- 0. propriedade no catalogo: e isto que a migracao 20260922g garante, e e o
    --    que um CREATE OR REPLACE descuidado derrubaria sem ninguem perceber.
    SELECT p.prosecdef, pg_get_userbyid(p.proowner), coalesce(p.proconfig::text, '')
      INTO v_secdef, v_dona, v_config
      FROM pg_proc p WHERE p.oid = 'public.handle_invoice_paid_ledger()'::regprocedure;

    IF NOT v_secdef THEN
        RAISE EXCEPTION 'FALHA: handle_invoice_paid_ledger voltou a ser SECURITY INVOKER';
    END IF;
    IF v_dona <> 'postgres' THEN
        RAISE EXCEPTION 'FALHA: dona da funcao e %, esperado postgres', v_dona;
    END IF;
    IF v_config NOT LIKE '%search_path=public, pg_temp%' THEN
        RAISE EXCEPTION 'FALHA: search_path da funcao nao esta fixo: %', v_config;
    END IF;

    SELECT id INTO v_acc_comissoes  FROM public.ledger_accounts WHERE code = '2.1.2';
    SELECT id INTO v_acc_gestao     FROM public.ledger_accounts WHERE code = '3.1.1';
    SELECT id INTO v_acc_investidor FROM public.ledger_accounts WHERE code = '2.1.1';
    IF v_acc_comissoes IS NULL OR v_acc_gestao IS NULL OR v_acc_investidor IS NULL THEN
        RAISE EXCEPTION 'FALHA: contas 2.1.2 / 3.1.1 / 2.1.1 nao existem no plano de contas';
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

    -- Primeira fatura paga da UC, base = valor_a_pagar (concessionaria zerada):
    --   comissao  = start 10% + recorrente 4%             -> lancamento -140
    --   gestao    = zerada porque houve comissao de start -> sem lancamento (0)
    --   investidor= base - (gestao + recorrente) - start  -> lancamento -860
    v_esp_comissoes  := -(v_base * 0.10 + v_base * 0.04);
    v_esp_gestao     := 0;
    v_esp_investidor := -(v_base - 0 - (0 + v_base * 0.04) - v_base * 0.10);

    -- 1) quem marca como paga NAO e papel interno -------------------------
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_perfil_assinante, 'role', 'authenticated')::text, true);

    IF auth.uid() IS DISTINCT FROM v_perfil_assinante THEN
        RAISE EXCEPTION 'FALHA: claims nao aplicadas, auth.uid() = %', auth.uid();
    END IF;
    IF public.fn_papel_interno() THEN
        RAISE EXCEPTION 'FALHA: perfil % escolhido como nao interno E interno, teste invalido', v_perfil_assinante;
    END IF;

    BEGIN
        UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;
        v_externo_rodou := true;
    EXCEPTION WHEN insufficient_privilege THEN
        -- barrado por invoices_update_interno (20260922h): o cenario original da
        -- Task 16 nao e mais alcancavel por esta porta. Sem silencio: o papel
        -- nao interno nao lanca meio rateio, ele simplesmente nao passa.
        v_externo_rodou := false;
    END;

    PERFORM set_config('role', v_role_original, true);
    PERFORM set_config('request.jwt.claims', '', true);

    IF v_externo_rodou THEN
        SELECT transaction_id INTO v_txn
          FROM public.ledger_entries WHERE reference_id = v_inv LIMIT 1;
        IF v_txn IS NULL THEN
            RAISE EXCEPTION 'FALHA: papel nao interno marcou a fatura como paga e nao gerou lancamento nenhum';
        END IF;

        SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
               COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
               COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0)
          INTO v_ext_comissoes, v_ext_gestao, v_ext_investidor
          FROM public.ledger_entries WHERE transaction_id = v_txn;

        -- desfaz os lancamentos para repetir o mesmo cenario como admin
        DELETE FROM public.ledger_entries WHERE transaction_id = v_txn;
        DELETE FROM public.ledger_entries WHERE reference_id IN (v_inv, v_orig);
        UPDATE public.invoices SET status = 'a_vencer' WHERE id = v_inv;
    ELSE
        -- garante que a tentativa barrada nao deixou nada para tras
        IF EXISTS (SELECT 1 FROM public.ledger_entries WHERE reference_id IN (v_inv, v_orig)) THEN
            RAISE EXCEPTION 'FALHA: UPDATE barrado deixou lancamento no razao';
        END IF;
        IF (SELECT status::text FROM public.invoices WHERE id = v_inv) <> 'a_vencer' THEN
            RAISE EXCEPTION 'FALHA: UPDATE barrado mudou o status da fatura';
        END IF;
    END IF;

    -- 2) quem marca como paga E admin -------------------------------------
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_perfil_admin, 'role', 'authenticated')::text, true);

    IF auth.uid() IS DISTINCT FROM v_perfil_admin THEN
        RAISE EXCEPTION 'FALHA: claims nao aplicadas, auth.uid() = %', auth.uid();
    END IF;
    IF NOT public.fn_papel_interno() THEN
        RAISE EXCEPTION 'FALHA: perfil % escolhido como admin NAO e interno, teste invalido', v_perfil_admin;
    END IF;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    PERFORM set_config('role', v_role_original, true);
    PERFORM set_config('request.jwt.claims', '', true);

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA: admin nao gerou lancamento nenhum para a fatura';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0)
      INTO v_adm_comissoes, v_adm_gestao, v_adm_investidor
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    -- asserts: o rateio do admin bate com o esperado -----------------------
    IF v_adm_comissoes <> v_esp_comissoes THEN
        RAISE EXCEPTION 'FALHA: admin lancou % na conta 2.1.2, esperado %', v_adm_comissoes, v_esp_comissoes;
    END IF;
    IF v_adm_gestao <> v_esp_gestao THEN
        RAISE EXCEPTION 'FALHA: admin lancou % na conta 3.1.1, esperado %', v_adm_gestao, v_esp_gestao;
    END IF;
    IF v_adm_investidor <> v_esp_investidor THEN
        RAISE EXCEPTION 'FALHA: admin lancou % na conta 2.1.1, esperado %', v_adm_investidor, v_esp_investidor;
    END IF;

    -- ... e o papel nao interno, quando consegue passar, produz o MESMO rateio
    IF v_externo_rodou THEN
        IF v_ext_comissoes <> v_adm_comissoes THEN
            RAISE EXCEPTION 'FALHA: conta 2.1.2 (comissao): papel nao interno lancou % e admin lancou %',
                v_ext_comissoes, v_adm_comissoes;
        END IF;
        IF v_ext_gestao <> v_adm_gestao THEN
            RAISE EXCEPTION 'FALHA: conta 3.1.1 (gestao B2W): papel nao interno lancou % e admin lancou %',
                v_ext_gestao, v_adm_gestao;
        END IF;
        IF v_ext_investidor <> v_adm_investidor THEN
            RAISE EXCEPTION 'FALHA: conta 2.1.1 (repasse investidor): papel nao interno lancou % e admin lancou %',
                v_ext_investidor, v_adm_investidor;
        END IF;
    ELSE
        RAISE NOTICE 'Papel nao interno barrado por invoices_update_interno (20260922h); comparacao pulada, propriedade cobrada no catalogo.';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
