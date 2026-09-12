-- Boleto e pagamento podem nascer em qualquer ordem: a imobiliaria manda os 12
-- de uma vez em janeiro, e a competencia de agosto so' e' reconhecida em
-- setembro. Os dois lados precisam se encontrar.
--
-- Lado 1: gatilho em arrendamento_boletos, para o boleto que chega DEPOIS.
-- Lado 2: fn_reconhecer_arrendamento procura o boleto guardado, para o
--         pagamento que nasce DEPOIS.

create or replace function public.fn_arrendamento_boleto_anexa()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
    v_pag uuid;
begin
    select ap.id into v_pag
      from arrendamento_pagamentos ap
     where ap.beneficiary_id = new.beneficiary_id
       and ap.competencia    = new.competencia
       and ap.status in ('aguardando_boleto', 'a_pagar', 'falhou');

    if v_pag is null then
        return new;
    end if;

    update arrendamento_pagamentos
       set linha_digitavel = new.linha_digitavel,
           status = case when status = 'aguardando_boleto' then 'a_pagar' else status end
     where id = v_pag;

    update arrendamento_boletos set arrendamento_pagamento_id = v_pag where id = new.id;

    return new;
end;
$$;

drop trigger if exists trg_arrendamento_boleto_anexa on public.arrendamento_boletos;
create trigger trg_arrendamento_boleto_anexa
    after insert or update of linha_digitavel on public.arrendamento_boletos
    for each row execute function public.fn_arrendamento_boleto_anexa();


create or replace function public.fn_reconhecer_arrendamento(
    p_usina_id       uuid,
    p_competencia    date,
    p_valor          numeric,
    p_origem         text,
    p_transaction_id uuid default null
)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
    v_area         uuid;
    v_usina_nome   text;
    v_dia          integer;
    v_venc         date;
    v_tx           uuid := coalesce(p_transaction_id, gen_random_uuid());
    v_acc_passivo  uuid;
    v_acc_receita  uuid;
    v_acc_despesa  uuid;
    v_r            record;
    v_forma        text;
    v_linha        text;
    v_boleto_id    uuid;
    v_pag_id       uuid;
    v_ref          text;
    v_passivo      numeric := 0;
    v_receita      numeric := 0;
    v_criados      integer := 0;
    v_comp         text := to_char(p_competencia, 'MM/YYYY');
begin
    if p_origem is null or p_origem not in ('fornecedor', 'b2w_pre_operacao') then
        raise exception 'fn_reconhecer_arrendamento: regime % nao existe (use fornecedor ou b2w_pre_operacao)', p_origem;
    end if;

    if p_valor is null then
        raise exception 'fn_reconhecer_arrendamento: valor nulo nao reconhece (usina %, competencia %)', p_usina_id, p_competencia;
    end if;

    select u.leased_area_id, u.name into v_area, v_usina_nome
      from usinas u where u.id = p_usina_id;

    if v_usina_nome is null then
        raise exception 'fn_reconhecer_arrendamento: usina % nao existe', p_usina_id;
    end if;

    if v_area is null then
        raise exception 'Usina "%" nao tem area arrendada vinculada: nao ha a quem repassar', v_usina_nome;
    end if;

    select la.dia_pagamento into v_dia from leased_areas la where la.id = v_area;

    if v_dia is not null then
        v_venc := make_date(
            extract(year  from (p_competencia + interval '1 month'))::int,
            extract(month from (p_competencia + interval '1 month'))::int,
            v_dia);
    end if;

    select id into v_acc_passivo from ledger_accounts where code = '2.1.5';
    select id into v_acc_receita from ledger_accounts where code = '3.1.4';
    select id into v_acc_despesa from ledger_accounts where code = '4.2.1';

    if v_acc_passivo is null or v_acc_receita is null or v_acc_despesa is null then
        raise exception 'Plano de contas incompleto: 2.1.5, 3.1.4 ou 4.2.1 nao existe (Task 1 nao rodou)';
    end if;

    for v_r in select * from fn_ratear_arrendamento(v_area, p_valor) loop

        continue when v_r.valor = 0;

        v_ref := 'arrendamento:' || p_usina_id || ':' || to_char(p_competencia, 'YYYY-MM') || ':' || v_r.beneficiary_id;

        if v_r.tipo = 'casa' then
            if p_origem = 'fornecedor' then
                insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
                values (v_tx, v_acc_receita, -v_r.valor,
                        'Intermediacao de arrendamento (' || v_usina_nome || ') ' || v_comp,
                        'arrendamento', v_r.beneficiary_id, v_ref || ':receita')
                on conflict (external_id) do nothing;
                v_receita := v_receita + v_r.valor;
            end if;
            continue;
        end if;

        select b.forma_pagamento into v_forma
          from leased_area_beneficiaries b where b.id = v_r.beneficiary_id;

        -- Boleto ja' guardado para esta competencia entra junto, e o pagamento
        -- nasce pronto em vez de esperar alguem digitar 47 digitos.
        v_linha     := null;
        v_boleto_id := null;
        if v_forma = 'boleto' then
            select ab.id, ab.linha_digitavel into v_boleto_id, v_linha
              from arrendamento_boletos ab
             where ab.beneficiary_id = v_r.beneficiary_id
               and ab.competencia    = p_competencia;
        end if;

        insert into arrendamento_pagamentos
            (beneficiary_id, usina_id, competencia, valor, vencimento, origem, forma_pagamento, linha_digitavel, external_id)
        values
            (v_r.beneficiary_id, p_usina_id, p_competencia, v_r.valor, v_venc, p_origem, v_forma, v_linha, v_ref)
        on conflict (beneficiary_id, usina_id, competencia) do nothing
        returning id into v_pag_id;

        if v_pag_id is not null then
            v_criados := v_criados + 1;
            if v_boleto_id is not null then
                update arrendamento_boletos set arrendamento_pagamento_id = v_pag_id where id = v_boleto_id;
            end if;
        end if;

        insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        values (v_tx, v_acc_passivo, -v_r.valor,
                'Arrendamento a pagar (' || v_usina_nome || ') ' || v_comp,
                'arrendamento', v_r.beneficiary_id, v_ref || ':passivo')
        on conflict (external_id) do nothing;

        v_passivo := v_passivo + v_r.valor;

        if p_origem = 'b2w_pre_operacao' then
            insert into ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
            values (v_tx, v_acc_despesa, v_r.valor,
                    'Arrendamento pre-operacao (' || v_usina_nome || ') ' || v_comp,
                    'arrendamento', v_r.beneficiary_id, v_ref || ':despesa')
            on conflict (external_id) do nothing;
        end if;
    end loop;

    return jsonb_build_object(
        'transaction_id',     v_tx,
        'usina',              v_usina_nome,
        'competencia',        p_competencia,
        'origem',             p_origem,
        'total',              p_valor,
        'passivo',            v_passivo,
        'receita_casa',       v_receita,
        'pagamentos_criados', v_criados,
        'vencimento',         v_venc
    );
end;
$$;

revoke execute on function public.fn_reconhecer_arrendamento(uuid, date, numeric, text, uuid) from public, anon;
grant  execute on function public.fn_reconhecer_arrendamento(uuid, date, numeric, text, uuid) to authenticated, service_role;
