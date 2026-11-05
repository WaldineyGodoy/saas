-- ===========================================================================
-- Faturas retidas do contrato de Gestão de Créditos (dono, 05/11/2026)
--
-- `suppliers.contract_terms.faturasRetidas` = N. Nas N primeiras faturas
-- pagas de CADA UC (o mesmo ordinal do Bônus Start), a parte que caberia ao
-- fornecedor não vai para o repasse (2.1.1): fica retida na Associação para
-- pagar a comissão dos corretores de energia, num passivo próprio (2.1.7).
--
-- Decisões do dono (05/11/2026):
--   * contagem por UC;
--   * só a parte do fornecedor é retida -- o split roda normal (B2W, Start,
--     recorrência dos parceiros);
--   * passivo novo 2.1.7, baixado quando a comissão for paga;
--   * vale só para faturas pagas daqui em diante, e o ordinal conta as já
--     pagas: UC que já pagou N ou mais não é afetada.
--
-- Parte do fornecedor zero ou negativa (base negativa) não é retida: não há
-- o que reter, e reter negativo seria a Associação cobrindo prejuízo.
-- ===========================================================================

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '2.1.7', 'Retenção para Comissão de Corretores (Associação)', 'liability', p.id
  FROM public.ledger_accounts p
 WHERE p.code = '2.1.0'
   AND NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE code = '2.1.7');

DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    d := pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        -- 1. variáveis
        ($de$    v_account_taxa_bancaria uuid;$de$,
         $para$    v_account_taxa_bancaria uuid;

    -- Faturas retidas (20261105a)
    v_faturas_retidas     int := 0;
    v_valor_retido        numeric := 0;
    v_retencao            jsonb;
    v_account_retencao    uuid;   -- 2.1.7$para$),

        -- 2. a parte do fornecedor das N primeiras faturas da UC vai à Associação
        ($de$        v_valor_fornecedor := round(COALESCE(v_fornecedor_base, 0), 2);$de$,
         $para$        v_valor_fornecedor := round(COALESCE(v_fornecedor_base, 0), 2);

        -- 4c. FATURAS RETIDAS (20261105a). contract_terms e jsonb editado pela
        -- tela: so vale numero inteiro nao negativo; o resto e "sem retencao".
        SELECT CASE WHEN q.x ~ '^[0-9]+(\.0+)?$' THEN trunc(q.x::numeric)::int ELSE 0 END
          INTO v_faturas_retidas
          FROM (SELECT s.contract_terms ->> 'faturasRetidas' AS x
                  FROM public.suppliers s WHERE s.id = v_supplier_id) q;
        v_faturas_retidas := COALESCE(v_faturas_retidas, 0);

        IF v_faturas_retidas > 0 AND v_ordinal <= v_faturas_retidas AND v_valor_fornecedor > 0 THEN
            v_valor_retido     := v_valor_fornecedor;
            v_valor_fornecedor := 0;
        END IF;

        v_retencao := jsonb_build_object(
            'faturas_retidas', v_faturas_retidas,
            'fatura_ordinal',  v_ordinal,
            'aplicado',        v_valor_retido > 0,
            'valor',           v_valor_retido,
            'conta',           '2.1.7',
            'motivo', CASE
                WHEN v_faturas_retidas = 0 THEN 'contrato sem faturas retidas'
                WHEN v_ordinal > v_faturas_retidas THEN 'fatura ordinal ' || v_ordinal || ' depois das ' || v_faturas_retidas || ' retidas'
                WHEN v_valor_retido = 0 THEN 'parte do fornecedor zero ou negativa: nada a reter'
                ELSE 'fatura ' || v_ordinal || ' de ' || v_faturas_retidas || ' retidas: parte do fornecedor vai a Associacao'
            END);$para$),

        -- 3. a soma da transacao continua dando zero
        ($de$+ v_valor_fornecedor - v_caixa_liquido;$de$,
         $para$+ v_valor_fornecedor + v_valor_retido - v_caixa_liquido;$para$),

        -- 4. conta
        ($de$SELECT id INTO v_account_receber        FROM public.ledger_accounts WHERE code = '1.1.2';$de$,
         $para$SELECT id INTO v_account_receber        FROM public.ledger_accounts WHERE code = '1.1.2';
        SELECT id INTO v_account_retencao       FROM public.ledger_accounts WHERE code = '2.1.7';

        IF v_account_retencao IS NULL AND v_valor_retido <> 0 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: a conta 2.1.7 (Retencao para Comissao de Corretores) nao existe; a fatura % reteria % sem contrapartida', NEW.id, v_valor_retido;
        END IF;$para$),

        -- 5. lancamento
        ($de$        -- 8.4 Fornecedor (2.1.1): sempre lancado, inclusive zero ou negativo.$de$,
         $para$        -- 8.3b Faturas retidas (2.1.7): a parte do fornecedor fica com a
        --      Associacao para a comissao dos corretores. Referencia o
        --      fornecedor, para saber de qual contrato saiu a retencao.
        IF v_valor_retido <> 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_retencao, -v_valor_retido,
                    'Retenção Associação — comissão de corretores (fatura ' || v_ordinal || ' de ' || v_faturas_retidas || ')',
                    'supplier', v_supplier_id);
        END IF;

        -- 8.4 Fornecedor (2.1.1): sempre lancado, inclusive zero ou negativo.$para$),

        -- 6. congelamento
        ($de$'fornecedor_caixa',  v_valor_fornecedor,$de$,
         $para$'fornecedor_caixa',  v_valor_fornecedor,
            'retencao_associacao', v_retencao,$para$),
        ($de$'conta_receber_formula',   'gestao + beneficiarios + fornecedor - caixa_liquido',$de$,
         $para$'conta_receber_formula',   'gestao + beneficiarios + fornecedor + retencao_associacao - caixa_liquido',$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    v_n := (length(d) - length(replace(d, '''20261010_plano_usina_adendo''', '')))
           / length('''20261010_plano_usina_adendo''');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger: versao achada % vezes (esperado 2)', v_n;
    END IF;
    d := replace(d, '''20261010_plano_usina_adendo''', '''20261105_faturas_retidas''');

    EXECUTE d;
END
$patch$;
