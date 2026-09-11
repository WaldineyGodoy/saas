-- Task 7 do plano 2026-09-11-arrendamento-repasse.
--
-- DECISAO DE DONO UNICO DO LANCAMENTO. O plano previa duas coisas que, juntas,
-- lancariam em dobro: rotear 'arrendante' para 2.1.5 dentro de
-- handle_transfer_ledger E fazer arrendamento_pagamentos lancar na virada
-- para 'pago'. Um PIX passa pelos dois. Vale o segundo, porque ele e' o unico
-- que serve aos DOIS trilhos -- boleto nao cria linha em financial_transfers
-- e nunca passaria pelo primeiro. Entao handle_transfer_ledger passa a
-- ignorar 'arrendante' explicitamente, em vez de roteá-lo.
--
-- Isso tambem fecha o defeito original: sem o desvio, 'arrendante' caia no
-- ELSE e ia para 2.1.0, que e' conta-titulo. Lancamento em conta sintetica e'
-- defeito, nao destino.

create or replace function public.handle_transfer_ledger()
returns trigger
language plpgsql
set search_path to 'public'
as $$
DECLARE
    v_transaction_id uuid;
    v_account_bank uuid;
    v_account_liab uuid;
    v_account_code text;
    v_is_sandbox boolean;
BEGIN
    -- Arrendamento tem dono proprio do lancamento: o gatilho de
    -- arrendamento_pagamentos. Sair aqui evita a perna dupla e mantem os dois
    -- trilhos (PIX e boleto) com lancamento identico.
    IF NEW.destination_type = 'arrendante' THEN
        RETURN NEW;
    END IF;

    SELECT (environment = 'sandbox') INTO v_is_sandbox
    FROM public.integrations_config
    WHERE service_name = 'financial_api';

    v_is_sandbox := COALESCE(v_is_sandbox, false);

    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
        v_transaction_id := gen_random_uuid();

        IF NEW.destination_type IN ('usina', 'supplier') THEN
            v_account_code := '2.1.1';
        ELSIF NEW.destination_type = 'originator' THEN
            v_account_code := '2.1.2';
        ELSE
            -- 2.1.0 e' conta-titulo do Passivo Circulante. Cair aqui significa
            -- que apareceu um destino novo sem conta propria: e' para ser
            -- investigado, nao para ser contabilizado em silencio.
            v_account_code := '2.1.0';
        END IF;

        SELECT id INTO v_account_liab FROM public.ledger_accounts WHERE code = v_account_code;
        SELECT id INTO v_account_bank FROM public.ledger_accounts WHERE code = '1.1.1.01';

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id, is_sandbox)
        VALUES (v_transaction_id, v_account_liab, NEW.amount, 'Pagamento Transferência/PIX', 'payout_' || NEW.destination_type, NEW.id, NEW.asaas_transfer_id, v_is_sandbox);

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, is_sandbox)
        VALUES (v_transaction_id, v_account_bank, -NEW.amount, 'Saída Banco Asaas', 'payout_' || NEW.destination_type, NEW.id, v_is_sandbox);

    ELSIF NEW.status IN ('failed', 'reversed') AND OLD.status = 'completed' THEN
        v_transaction_id := gen_random_uuid();

        IF NEW.destination_type IN ('usina', 'supplier') THEN
            v_account_code := '2.1.1';
        ELSIF NEW.destination_type = 'originator' THEN
            v_account_code := '2.1.2';
        ELSE
            v_account_code := '2.1.0';
        END IF;

        SELECT id INTO v_account_liab FROM public.ledger_accounts WHERE code = v_account_code;
        SELECT id INTO v_account_bank FROM public.ledger_accounts WHERE code = '1.1.1.01';

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id, is_sandbox)
        VALUES (v_transaction_id, v_account_liab, -NEW.amount, 'Estorno Transferência Falha', 'payout_' || NEW.destination_type, NEW.id, NEW.asaas_transfer_id, v_is_sandbox);

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, is_sandbox)
        VALUES (v_transaction_id, v_account_bank, NEW.amount, 'Estorno Saída Banco Asaas', 'payout_' || NEW.destination_type, NEW.id, v_is_sandbox);
    END IF;

    RETURN NEW;
END;
$$;


-- O lancamento do pagamento, identico para PIX e boleto: extingue a obrigacao
-- em 2.1.5 e tira o dinheiro do banco. E' o par do reconhecimento da Task 5.
create or replace function public.fn_arrendamento_pagamento_ledger()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
    v_tx        uuid;
    v_acc_pass  uuid;
    v_acc_bank  uuid;
    v_nome      text;
    v_usina     text;
    v_comp      text;
begin
    -- So' a virada interessa. Reescrever 'pago' por cima de 'pago' nao lanca
    -- de novo.
    if not (
        (new.status = 'pago'   and old.status is distinct from 'pago') or
        (new.status = 'falhou' and old.status = 'pago')
    ) then
        return new;
    end if;

    select id into v_acc_pass from ledger_accounts where code = '2.1.5';
    select id into v_acc_bank from ledger_accounts where code = '1.1.1.01';

    select b.nome into v_nome from leased_area_beneficiaries b where b.id = new.beneficiary_id;
    select u.name into v_usina from usinas u where u.id = new.usina_id;
    v_comp := to_char(new.competencia, 'MM/YYYY');

    v_tx := gen_random_uuid();

    if new.status = 'pago' then
        insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        values (v_tx, v_acc_pass, new.valor,
                'Pagamento de arrendamento — ' || coalesce(v_nome, '?') || ' (' || coalesce(v_usina, '?') || ') ' || v_comp,
                'arrendamento_pago', new.id,
                'arrendamento_pago:' || new.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));

        insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        values (v_tx, v_acc_bank, -new.valor,
                'Saída Banco Asaas — arrendamento ' || v_comp,
                'arrendamento_pago', new.id);
    else
        insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        values (v_tx, v_acc_pass, -new.valor,
                'Estorno de arrendamento — ' || coalesce(v_nome, '?') || ' (' || coalesce(v_usina, '?') || ') ' || v_comp,
                'arrendamento_estorno', new.id,
                'arrendamento_estorno:' || new.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));

        insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        values (v_tx, v_acc_bank, new.valor,
                'Estorno Saída Banco Asaas — arrendamento ' || v_comp,
                'arrendamento_estorno', new.id);
    end if;

    return new;
end;
$$;

drop trigger if exists trg_arrendamento_pagamento_ledger on public.arrendamento_pagamentos;
create trigger trg_arrendamento_pagamento_ledger
    after update on public.arrendamento_pagamentos
    for each row execute function public.fn_arrendamento_pagamento_ledger();

-- pago_em acompanha a virada, no gatilho BEFORE que ja' cuida de updated_at.
create or replace function public.fn_arrendamento_pagamento_status_inicial()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
    if tg_op = 'INSERT' and new.status = 'a_pagar' and new.forma_pagamento = 'boleto' then
        new.status := 'aguardando_boleto';
    end if;

    if new.status = 'pago' and (tg_op = 'INSERT' or old.status is distinct from 'pago') then
        new.pago_em := coalesce(new.pago_em, now());
    elsif new.status is distinct from 'pago' then
        new.pago_em := null;
    end if;

    new.updated_at := now();
    return new;
end;
$$;
