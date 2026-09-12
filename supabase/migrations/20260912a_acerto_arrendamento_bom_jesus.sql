-- Task 12 do plano 2026-09-11-arrendamento-repasse: so' o RECONHECIMENTO.
-- Nenhum pagamento acontece aqui; nenhum centavo sai do banco.
--
-- Os lancamentos manuais abaixo sao a excecao consciente a regra "nunca
-- inserir em ledger_entries a mao": sao correcao historica de competencia, e
-- nenhuma funcao e' dona desse ato. Levam external_id, entao rodar duas vezes
-- nao duplica.
--
-- Efeito medido em 12/09/2026, com as 9 linhas geradas:
--   2.1.5 Arrendamento a Pagar ....... -2.400,00  (obrigacao reconhecida)
--   3.1.4 Intermediacao .............. ...... 0   (margem e zero nas duas areas)
--   4.2.1 Pre-operacao ............... +1.200,00  (custo da B2W)
--   2.1.1 Repasse ao Investidor ...... inalterado
--   1.1.1.01 Banco Asaas ............. inalterado
-- E o desbalanco historico do razao continua nos mesmos -10.694,81, o que
-- prova que as duas transacoes fecharam em zero.

do $$
declare
    v_bj1  uuid := '9bf1349b-6c79-4f68-a8e4-bc00f00850f5';  -- UFV Bom Jesus
    v_bj2  uuid := '7c49ff51-c04b-4135-8a90-3a257d2efe94';  -- UFV Bom Jesus II
    v_forn uuid;
    v_rec  uuid;
    v_txA  uuid := gen_random_uuid();
    v_txB  uuid := gen_random_uuid();
    v_soma numeric;
begin
    select id into v_forn from ledger_accounts where code = '2.1.1';
    select id into v_rec  from ledger_accounts where code = '3.1.4';

    ----------------------------------------------------------------- A
    -- Bom Jesus I, Jose Santiago. Cobrado do fornecedor (usina em operacao).
    --
    -- O razao tinha as competencias rotuladas Junho e Julho; as devidas sao
    -- Julho e Agosto. Junho foi cobrado indevidamente e Agosto nunca foi
    -- reconhecido -- o total coincide em R$ 1.200 por acaso.
    perform public.fn_reconhecer_arrendamento(v_bj1, date '2026-07-01', 600, 'fornecedor', v_txA);
    perform public.fn_reconhecer_arrendamento(v_bj1, date '2026-08-01', 600, 'fornecedor', v_txA);

    -- A receita que nunca foi da B2W volta para zero.
    insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
    values (v_txA, v_rec, 1200,
            'Reclassificacao: arrendamento de Bom Jesus nao e receita da B2W, e obrigacao com o arrendante',
            'arrendamento', v_bj1, 'acerto:bom-jesus-i:reclassifica-3.1.4')
    on conflict (external_id) do nothing;

    -- Correcao de competencia no fornecedor. O efeito liquido e' ZERO: o
    -- Tobias continua debitado nos mesmos R$ 1.200, agora nos meses certos.
    insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
    values (v_txA, v_forn, -600,
            'Estorno arrendamento Junho/2026 (competencia indevida: o contrato comeca em Julho)',
            'arrendamento', v_bj1, 'acerto:bom-jesus-i:estorno-junho')
    on conflict (external_id) do nothing;

    insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
    values (v_txA, v_forn, 600,
            'Arrendamento Agosto/2026 (competencia nunca reconhecida)',
            'arrendamento', v_bj1, 'acerto:bom-jesus-i:agosto')
    on conflict (external_id) do nothing;

    ----------------------------------------------------------------- B
    -- Bom Jesus II, Marcos Santiago. Pre-operacao: a usina so' passou a gerar
    -- em 31/08/2026, entao Julho e Agosto sao custo da propria B2W (decisao
    -- do dono em 11/09/2026). O Tobias NAO e' tocado.
    perform public.fn_reconhecer_arrendamento(v_bj2, date '2026-07-01', 600, 'b2w_pre_operacao', v_txB);
    perform public.fn_reconhecer_arrendamento(v_bj2, date '2026-08-01', 600, 'b2w_pre_operacao', v_txB);

    ----------------------------------------------------------- conferencia
    select sum(amount) into v_soma from ledger_entries where transaction_id = v_txA;
    if v_soma is distinct from 0 then
        raise exception 'Transacao A fechou em % e nao em zero', v_soma;
    end if;

    select sum(amount) into v_soma from ledger_entries where transaction_id = v_txB;
    if v_soma is distinct from 0 then
        raise exception 'Transacao B fechou em % e nao em zero', v_soma;
    end if;

    select sum(e.amount) into v_soma from ledger_entries e join ledger_accounts a on a.id=e.account_id where a.code = '3.1.4';
    if v_soma is distinct from 0 then
        raise exception '3.1.4 deveria zerar (margem e zero nas duas areas) e ficou em %', v_soma;
    end if;

    select sum(e.amount) into v_soma from ledger_entries e join ledger_accounts a on a.id=e.account_id where a.code = '2.1.5';
    if v_soma is distinct from -2400 then
        raise exception 'Obrigacao com os arrendantes deveria ser -2400 e ficou em %', v_soma;
    end if;

    select sum(e.amount) into v_soma from ledger_entries e join ledger_accounts a on a.id=e.account_id
     where a.code = '2.1.1' and e.transaction_id in (v_txA, v_txB);
    if v_soma is distinct from 0 then
        raise exception 'O repasse ao investidor deveria ficar intacto e mudou em %', v_soma;
    end if;
end $$;
