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
-- ATENCAO (04/10/2026): desde a 20261004d_rls_fechamento a politica
-- invoices_update_interno tem USING fn_papel_interno(), e nao so WITH CHECK.
-- O UPDATE do papel nao interno agora tambem e barrado como 0 linhas
-- atualizadas, sem erro; o teste reconhece o bloqueio por ROW_COUNT = 0.
--
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).

DO $$
DECLARE
    v_role_original     text := current_user;
    -- Perfis reais (producao): um nao interno e um interno. Resolvidos em
    -- tempo de execucao desde 28/09/2026: os dois uuids que estavam fixos aqui
    -- viraram role='subscriber' em producao, e o teste passou a acusar "admin
    -- NAO e interno" por causa do dado, nao do codigo.
    v_perfil_assinante  uuid;
    v_perfil_admin      uuid;

    v_plano             uuid;
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

    v_linhas_externo    integer;
    v_secdef            boolean;
    v_dona              text;
    v_config            text;
BEGIN

    -- Plano de Usina (20261006f): a usina deixou de apontar direto para o
    -- plano de assinatura; agora aponta para um plano de usina, que aponta
    -- para ele. pg_temp.pu cria o plano de usina com a MESMA gestao que o
    -- plano ja dava (b2w.L1 da matriz valida, ou gestao_percentual), para
    -- nenhum numero esperado deste arquivo mudar. Some no rollback.
    EXECUTE $pu$
      CREATE FUNCTION pg_temp.pu(p_plano uuid) RETURNS uuid LANGUAGE sql AS $f$
        INSERT INTO public.planos_usina (nome, percentual_recorrente)
        SELECT 'SANDBOX pu ' || p.nome,
               COALESCE(CASE WHEN jsonb_typeof(p.recorrente_config #> '{regras_multinivel,b2w,niveis}') = 'object'
                             THEN (p.recorrente_config #>> '{regras_multinivel,b2w,niveis,L1}')::numeric END,
                        p.gestao_percentual, 0)
          FROM public.planos_assinatura_energia p
         WHERE p.id = p_plano
        RETURNING id
      $f$
    $pu$;
    -- 0a. escolhe os dois perfis (mesma lista de papeis de fn_papel_interno).
    SELECT id INTO v_perfil_admin
      FROM public.profiles
     WHERE role IN ('super_admin', 'admin', 'manager', 'coordinator')
     ORDER BY role, id LIMIT 1;

    SELECT id INTO v_perfil_assinante
      FROM public.profiles
     WHERE role NOT IN ('super_admin', 'admin', 'manager', 'coordinator')
     ORDER BY role, id LIMIT 1;

    IF v_perfil_admin IS NULL OR v_perfil_assinante IS NULL THEN
        RAISE EXCEPTION 'FALHA: profiles nao tem um perfil interno E um nao interno; sem os dois o teste nao compara nada';
    END IF;

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
    -- ATUALIZADO na Task 6 (20260928i_gatilho_split): o gatilho nao le mais
    -- originators_v2.split_commission -- quem recebe vem de
    -- fn_participantes_recompensa e quanto vem da matriz do plano. O ponto do
    -- teste nao mudou (e ate ficou mais forte): fn_participantes_recompensa so
    -- tem EXECUTE para service_role, entao so um gatilho SECURITY DEFINER
    -- dono postgres consegue montar o rateio -- se a funcao perder isso, os
    -- lancamentos abaixo mudam.
    -- tipo_recompensa EXPLICITO a partir da Task 11 (20260929d): o default da
    -- coluna e 'start', e plano 'start' nao paga recorrencia fora da fatura
    -- elegivel -- este teste mede a recorrencia, entao pinamos 'recorrente'.
    -- Task 12 (20260929e): a base virou consumo_compensado x (tarifa x
    -- (1 - desconto/100) - Fio B). Com tarifa 1,20, Fio B 0,20 e plano sem
    -- desconto a tarifa liquida e 1,00/kWh, entao consumo_compensado = v_base
    -- reproduz exatamente a base de antes e os tres valores esperados nao
    -- mudam.
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX16-C1', 'Sandbox Task16', 'SANDBOX Task16 conc', 'RN', 1.20, 0.20);

    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Plano Task16', 'recorrente', 10, 50, jsonb_build_object('regras_multinivel', '{
      "b2w":   {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
      "lider": {"niveis": {"L1": "1",  "L2": "1",  "L3": "1",  "L4": "0"},  "max_niveis": 3},
      "ppe":   {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppp":   {"niveis": {"L1": "4",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppf":   {"niveis": {"L1": "2",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}
    }'::jsonb))
    RETURNING id INTO v_plano;

    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX Originador Task16', 'ppe', true)
    RETURNING id INTO v_orig;

    -- gestao_percentual 15 de proposito: a gestao vem do PLANO (10), nao da
    -- usina -- se alguem reverter isso, v_esp_gestao acusa.
    INSERT INTO public.usinas (gestao_percentual, plano_usina_id)
    VALUES (15, pg_temp.pu(v_plano)) RETURNING id INTO v_usina;

    INSERT INTO public.subscribers (originator_id, short_url)
    VALUES (v_orig, 'sandbox://task16/definer') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task16 conc', '{"uf": "RN"}'::jsonb, v_plano) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', v_base, 0, CURRENT_DATE + 5, v_base) RETURNING id INTO v_inv;

    -- base = 1000 kWh compensados x 1,00 (tarifa 1,20 - Fio B 0,20, sem
    -- desconto no plano) = 1000; teto = 500 (piso 50%):
    --   2.1.2 comissoes  = PPE nivel 1, 5%          -> -50
    --   3.1.1 gestao B2W = matriz b2w L1, 10%       -> -100
    --   2.1.1 investidor = residual, 1000 - 150     -> -850
    v_esp_comissoes  := -(v_base * 0.05);
    v_esp_gestao     := -(v_base * 0.10);
    v_esp_investidor := -(v_base - v_base * 0.10 - v_base * 0.05);

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
        GET DIAGNOSTICS v_linhas_externo = ROW_COUNT;
        -- desde a 20261004d o bloqueio chega como 0 linhas, sem erro: so
        -- "rodou" se o UPDATE de fato tocou a fatura.
        v_externo_rodou := (v_linhas_externo > 0);
    EXCEPTION WHEN insufficient_privilege THEN
        -- barrado por invoices_update_interno (20260922h): o cenario original da
        -- Task 16 nao e mais alcancavel por esta porta. Sem silencio: o papel
        -- nao interno nao lanca meio rateio, ele simplesmente nao passa. O
        -- bloqueio chega de duas formas: excecao (este ramo) ou 0 linhas
        -- atualizadas, sem erro (20261004d, acima).
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
