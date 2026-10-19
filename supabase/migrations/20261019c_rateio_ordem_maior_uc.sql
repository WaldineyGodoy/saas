-- Ordem do rateio: assinante pela MAIOR conta individual, e a regra vale em toda
-- lista gerada (decisões do dono, 19/10/2026).
--
-- 1) Entre assinantes, vence quem tem a maior UC (a maior franquia individual),
--    não a maior soma. Ex.: A com uma UC de 3.000 vem antes de B com três de
--    1.500. Empate: a soma, depois o id do assinante.
-- 2) O gerador da lista (botão "Gerar Lista de Rateio" e a ponte da TT) monta o
--    retrato SEMPRE nessa ordem, sem gravar nada em consumer_units: a ordem do
--    modal da usina só muda quando uma TT é CONCLUÍDA (fn_concluir_tt chama
--    fn_reordenar_prioridade_usina). TT não concluída = modal intacto.
--
-- A regra mora em fn_ordem_rateio_usina, usada pelos dois lados.

create or replace function public.fn_ordem_rateio_usina(p_usina_id uuid)
returns table (uc_id uuid, ordem int)
language sql
stable
security definer
set search_path = public
as $$
    with base as (
        select c.id, c.tipo_unidade, c.subscriber_id, c.numero_uc,
               coalesce(c.franquia, 0) as f,
               (c.tipo_unidade = 'geradora'
                or c.status::text in ('ativo', 'em_atraso', 'aguardando_conexao')) as elegivel
          from consumer_units c
         where c.usina_id = p_usina_id
    ), assinante as (
        -- Só as UCs que entram na lista contam para ordenar o assinante.
        select subscriber_id, max(f) as maior, sum(f) as total
          from base where elegivel group by subscriber_id
    )
    select b.id,
           (row_number() over (
               order by (b.tipo_unidade = 'geradora') desc,
                        b.elegivel desc,
                        a.maior desc nulls last, a.total desc nulls last, b.subscriber_id,
                        b.f desc, b.numero_uc))::int
      from base b
      left join assinante a on a.subscriber_id is not distinct from b.subscriber_id;
$$;

revoke all on function public.fn_ordem_rateio_usina(uuid) from public, anon, authenticated;

-- Grava a ordem no cadastro (o que o modal mostra). Só a TT concluída chama.
create or replace function public.fn_reordenar_prioridade_usina(p_usina_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update consumer_units c
       set prioridade = o.ordem
      from fn_ordem_rateio_usina(p_usina_id) o
     where c.id = o.uc_id
       and c.prioridade is distinct from o.ordem;
end;
$$;

revoke all on function public.fn_reordenar_prioridade_usina(uuid) from public, anon, authenticated;

-- Gerador: idêntico ao de 20261012i, exceto a ORDEM do retrato, que vem da regra.
create or replace function public.fn_gerar_lista_rateio_interno(p_usina_id uuid, p_origem text default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_usina    usinas%rowtype;
    v_card_id  uuid;
    v_elig     jsonb;
    v_proc     jsonb := '[]'::jsonb;
    v_item     jsonb;
    v_idx      int;
    v_total    numeric;
    v_cur      numeric := 0;
    v_prc      numeric;
    v_saldo_ix int := 0;
    v_ger_ix   int := -1;
    v_alvo     int;
    v_n        int;
    v_pct      numeric;
    v_porcent  boolean;
begin
    select * into v_usina from usinas where id = p_usina_id for update;
    if not found then raise exception 'Usina nao encontrada.'; end if;

    if exists (select 1 from rateio_lists where usina_id = p_usina_id and status = 'processando') then
        update usinas set lista_rateio_pendente = true where id = p_usina_id;
        return null;
    end if;

    select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_elig
      from (
        select o.ordem as ord,
               jsonb_build_object(
                   'id', cu.id,
                   'numero_uc', cu.numero_uc,
                   'tipo_unidade', cu.tipo_unidade,
                   'status', cu.status::text,
                   'franquia', cu.franquia,
                   'consumo_medio_kwh', null,
                   'cpf_cnpj', coalesce(nullif(cu.cpf_cnpj_fatura, ''), s.cpf_cnpj, ''),
                   'saldo_remanescente', coalesce(cu.saldo_remanescente, false),
                   'prioridade', cu.prioridade) as x
          from consumer_units cu
          join fn_ordem_rateio_usina(p_usina_id) o on o.uc_id = cu.id
          left join subscribers s on s.id = cu.subscriber_id
         where cu.usina_id = p_usina_id
           and (cu.tipo_unidade = 'geradora'
                or cu.status::text in ('ativo', 'em_atraso', 'aguardando_conexao'))
      ) q;

    v_n := jsonb_array_length(v_elig);
    if v_n = 0 then
        return null;
    end if;

    v_porcent := coalesce(v_usina.rateio_type, 'prioridade') = 'porcentagem';

    if not v_porcent then
        v_idx := 0;
        for v_item in select * from jsonb_array_elements(v_elig) loop
            v_idx := v_idx + 1;
            v_proc := v_proc || jsonb_build_array(v_item || jsonb_build_object('prioridade', v_idx));
        end loop;
    else
        v_total := coalesce(nullif(v_usina.geracao_estimada_kwh, 0), 1);
        for v_idx in 0 .. v_n - 1 loop
            if (v_elig -> v_idx ->> 'saldo_remanescente')::boolean then v_saldo_ix := v_idx; end if;
            if v_ger_ix = -1 and (v_elig -> v_idx ->> 'tipo_unidade') = 'geradora' then v_ger_ix := v_idx; end if;
        end loop;
        if not exists (select 1 from jsonb_array_elements(v_elig) e where (e ->> 'saldo_remanescente')::boolean) then
            v_saldo_ix := case when v_ger_ix <> -1 then v_ger_ix else 0 end;
        end if;
        v_alvo := null;

        for v_idx in 0 .. v_n - 1 loop
            v_item := v_elig -> v_idx;
            v_prc := coalesce((v_item ->> 'franquia')::numeric, 0) / v_total * 100;
            if v_cur + v_prc <= 100 then
                v_cur := v_cur + v_prc;
                v_proc := v_proc || jsonb_build_array(v_item || jsonb_build_object('calculatedPercentage', v_prc));
            elsif v_cur < 100 then
                v_proc := v_proc || jsonb_build_array(v_item || jsonb_build_object('calculatedPercentage', 100 - v_cur));
                v_cur := 100;
                exit;
            else
                exit;
            end if;
        end loop;

        if v_cur < 100 and jsonb_array_length(v_proc) > 0 then
            v_alvo := 0;
            for v_idx in 0 .. jsonb_array_length(v_proc) - 1 loop
                if (v_proc -> v_idx ->> 'id') = (v_elig -> v_saldo_ix ->> 'id') then v_alvo := v_idx; end if;
            end loop;
            v_pct := coalesce((v_proc -> v_alvo ->> 'calculatedPercentage')::numeric, 0) + (100 - v_cur);
            v_proc := jsonb_set(v_proc, array[v_alvo::text, 'calculatedPercentage'], to_jsonb(v_pct));
        end if;
    end if;

    select id into v_card_id from rateio_lists
     where usina_id = p_usina_id and status = 'criada' order by created_at desc limit 1;

    if v_card_id is not null then
        update rateio_lists
           set ucs_snapshot = v_proc, qtd_ucs = jsonb_array_length(v_proc),
               rateio_type = coalesce(v_usina.rateio_type, 'prioridade'),
               concessionaria = v_usina.concessionaria,
               unidade_geradora = v_usina.unidade_geradora,
               updated_at = now()
         where id = v_card_id;
        perform fn_rateio_evento(v_card_id, 'retrato_renovado', jsonb_build_object('origem', p_origem, 'qtd_ucs', jsonb_array_length(v_proc)));
    else
        insert into rateio_lists
            (usina_id, usina_name, concessionaria, unidade_geradora, qtd_ucs, ucs_snapshot,
             rateio_type, status, status_dates, origem)
        values
            (p_usina_id, v_usina.name, v_usina.concessionaria, v_usina.unidade_geradora,
             jsonb_array_length(v_proc), v_proc, coalesce(v_usina.rateio_type, 'prioridade'),
             'criada', jsonb_build_object('criada_at', now()), p_origem)
        returning id into v_card_id;
        perform fn_rateio_evento(v_card_id, 'criada', jsonb_build_object('origem', p_origem, 'qtd_ucs', jsonb_array_length(v_proc)));
    end if;

    update usinas set lista_rateio_pendente = false where id = p_usina_id;
    return v_card_id;
end;
$$;

revoke all on function public.fn_gerar_lista_rateio_interno(uuid, text) from public, anon, authenticated;
