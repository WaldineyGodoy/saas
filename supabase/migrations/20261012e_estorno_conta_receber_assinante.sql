-- Estorno da 1.1.2 "Conta a Receber do Assinante (saldo do ciclo)" de 6 faturas.
--
-- Na baixa, o motor dividiu uma base por formula (kWh compensado x tarifa do
-- cadastro) e lancou na 1.1.2 a diferenca para o caixa real. O assinante pagou
-- o boleto inteiro: a divida so existia no papel (R$ 136,622 no total).
--
-- Decisao do dono (12/10/2026): a B2W assume a diferenca ja lancada. O estorno
-- sai da receita de gestao (3.1.1); o repasse ao investidor (2.1.1) fica como
-- foi apurado.
--
-- Causa principal: a tarifa da fatura vem do cadastro da UC, nunca da conta.
-- A UC 198436603202 estava com 0,9864 no cadastro em 28/09 (corrigido para
-- 1,0347 em 09/10), enquanto a conta da Cosern traz R$ 1,04482/kWh.
--
-- Uma transacao de estorno por transacao original, fechando em zero.
-- Idempotente pelo external_id 'estorno_112:<transacao original>'.

do $$
declare
    v_conta_112 uuid := (select id from public.ledger_accounts where code = '1.1.2');
    v_conta_311 uuid := (select id from public.ledger_accounts where code = '3.1.1');
    v_tx uuid;
    r record;
    v_feitos int := 0;
begin
    if v_conta_112 is null or v_conta_311 is null then
        raise exception 'Conta 1.1.2 ou 3.1.1 nao encontrada.';
    end if;

    for r in
        select e.transaction_id, e.amount, e.reference_id as subscriber_id,
               f.reference_id as invoice_id
          from public.ledger_entries e
          join lateral (
                select x.reference_id
                  from public.ledger_entries x
                 where x.transaction_id = e.transaction_id
                   and x.reference_type = 'invoice'
                 limit 1
          ) f on true
         where e.account_id = v_conta_112
           and e.description = 'Conta a Receber do Assinante (saldo do ciclo)'
           and e.reference_type = 'subscriber'
           and e.transaction_id in (
                '596833f6-c32f-42f7-85fb-36f85a550b0e',  -- Mirantes 198436603202 set/26  94,70
                '0872dd06-db10-40f0-8873-3e6a346751bb',  -- Mirantes 197911803202 set/26  18,932
                'ba47d1f9-0b61-46f1-b297-af00cd540ebb',  -- Mirantes 231754003210 set/26   4,84
                '32f07991-7950-4c7d-979c-679ef9a6a089',  -- Mirantes 223634603216 set/26   4,31
                '8da3444e-afa3-4d51-9c8a-5e0f3aafe960',  -- Guanabara 49706003220 ago/26   6,94
                '8b9e81f4-e18d-4145-9482-3c450be564bc')  -- Guanabara 49706003220 set/26   6,90
    loop
        if exists (select 1 from public.ledger_entries
                    where external_id = 'estorno_112:' || r.transaction_id) then
            continue;
        end if;

        v_tx := gen_random_uuid();

        insert into public.ledger_entries
            (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        values
            (v_tx, v_conta_112, -r.amount,
             'Estorno: conta a receber do assinante inexistente (diferenca formula x caixa; tx '
                 || left(r.transaction_id::text, 8) || '). Assumido pela B2W.',
             'subscriber', r.subscriber_id, 'estorno_112:' || r.transaction_id),
            (v_tx, v_conta_311, r.amount,
             'Estorno: diferenca formula x caixa assumida pela B2W (tx '
                 || left(r.transaction_id::text, 8) || ')',
             'invoice', r.invoice_id, null);

        v_feitos := v_feitos + 1;
    end loop;

    raise notice 'Estornos lancados: %', v_feitos;
end $$;
