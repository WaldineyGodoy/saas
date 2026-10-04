-- OCPP (Tarefa 9): numero publico do conector e destino resolvido da recarga.
-- Teste: supabase/tests/conector_numero.test.sql
-- Depende de 20261004b_ocpp_estrutura.sql.
--
-- A URL /recarga?posto=<eletroposto_id>&conector=<numero> usa um numero
-- sequencial por ELETROPOSTO (1, 2, 3...), nao o connector_id do OCPP, que
-- recomeca em 1 a cada carregador. connector_id 0 (a estacao) nao tem numero.
--
-- Unicidade (eletroposto_id, numero) atravessa carregadores. Escolha: copiar
-- eletroposto_id para o conector (coluna mantida por gatilho, nao confiavel
-- vinda de fora) e usar um unique comum, que e checado pelo proprio indice e
-- nao tem janela de corrida como uma validacao em gatilho teria. Custo: mover
-- um carregador de eletroposto arrasta os conectores; se algum numero colidir
-- no destino, a troca e recusada (23505).
--
-- O numero e atribuido sozinho (maior + 1 do eletroposto) quando o conector
-- nasce sem ele, que e o caso do CSMS ao criar o conector no primeiro
-- StatusNotification. O interno pode informar um numero explicito.

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------
alter table public.eletroposto_conectores
    add column if not exists eletroposto_id uuid references public.eletropostos(id) on delete cascade,
    add column if not exists numero integer constraint eletroposto_conectores_numero_positivo check (numero > 0);

-- Backfill: eletroposto do carregador e numeros 1..n por eletroposto.
update public.eletroposto_conectores k
   set eletroposto_id = c.eletroposto_id
  from public.eletroposto_carregadores c
 where c.id = k.carregador_id
   and k.eletroposto_id is null;

update public.eletroposto_conectores k
   set numero = x.n
  from (
        select k2.id,
               row_number() over (partition by k2.eletroposto_id
                                  order by c2.created_at, c2.ocpp_id, k2.connector_id) as n
          from public.eletroposto_conectores k2
          join public.eletroposto_carregadores c2 on c2.id = k2.carregador_id
         where k2.connector_id > 0
       ) x
 where x.id = k.id
   and k.numero is null;

alter table public.eletroposto_conectores alter column eletroposto_id set not null;

alter table public.eletroposto_conectores
    add constraint eletroposto_conectores_estacao_sem_numero check (connector_id > 0 or numero is null),
    add constraint eletroposto_conectores_posto_numero_unica unique (eletroposto_id, numero);

comment on column public.eletroposto_conectores.eletroposto_id is
    'Copia de eletroposto_carregadores.eletroposto_id, mantida por gatilho (nunca confiar no valor enviado). Existe para o unique (eletroposto_id, numero).';
comment on column public.eletroposto_conectores.numero is
    'Numero publico do conector no eletroposto (URL /recarga?posto=..&conector=<numero>). Nulo na estacao (connector_id 0).';

-- ---------------------------------------------------------------------------
-- 2. Gatilhos
-- ---------------------------------------------------------------------------
create or replace function public.fn_conector_preenche_posto_numero()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    select c.eletroposto_id into new.eletroposto_id
      from eletroposto_carregadores c
     where c.id = new.carregador_id;

    if tg_op = 'INSERT' and new.numero is null and new.connector_id > 0 then
        -- serializa a numeracao por eletroposto; o unique continua sendo a garantia
        perform pg_advisory_xact_lock(hashtext('conector_numero:' || new.eletroposto_id::text));
        select coalesce(max(k.numero), 0) + 1 into new.numero
          from eletroposto_conectores k
         where k.eletroposto_id = new.eletroposto_id;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_conector_preenche_posto_numero on public.eletroposto_conectores;
create trigger trg_conector_preenche_posto_numero
    before insert or update of carregador_id, eletroposto_id on public.eletroposto_conectores
    for each row execute function public.fn_conector_preenche_posto_numero();

create or replace function public.fn_carregador_move_conectores()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    update eletroposto_conectores
       set eletroposto_id = new.eletroposto_id
     where carregador_id = new.id;
    return new;
end;
$$;

drop trigger if exists trg_carregador_move_conectores on public.eletroposto_carregadores;
create trigger trg_carregador_move_conectores
    after update of eletroposto_id on public.eletroposto_carregadores
    for each row
    when (old.eletroposto_id is distinct from new.eletroposto_id)
    execute function public.fn_carregador_move_conectores();

-- ---------------------------------------------------------------------------
-- 3. Recarga: destino resolvido no checkout
-- ---------------------------------------------------------------------------
-- Webhook e stop-charging sabem para onde mandar o comando sem repetir a busca.
alter table public.recargas_eletroposto
    add column if not exists carregador_id      uuid references public.eletroposto_carregadores(id) on delete set null,
    add column if not exists ocpp_connector_id  integer
        constraint recargas_ocpp_connector_id_positivo check (ocpp_connector_id > 0);

comment on column public.recargas_eletroposto.carregador_id is
    'Carregador resolvido no checkout a partir de (eletroposto_id, conector_numero).';
comment on column public.recargas_eletroposto.ocpp_connector_id is
    'connectorId OCPP resolvido no checkout (o conector_numero e o numero publico, outro conceito).';

create index if not exists recargas_eletroposto_carregador_id_idx on public.recargas_eletroposto (carregador_id);

-- ---------------------------------------------------------------------------
-- 4. Um idTag por recarga (webhooks simultaneos)
-- ---------------------------------------------------------------------------
-- Duas entregas do webhook ao mesmo tempo geravam dois idTags Accepted para a
-- mesma recarga. Com o unique parcial, o segundo insert falha (23505) e quem
-- perdeu le o tag vencedor. idTag sem recarga (totem, RC-06) continua livre.
create unique index if not exists ocpp_id_tags_recarga_unica
    on public.ocpp_id_tags (recarga_id) where recarga_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Reserva atomica do conector durante o pagamento
-- ---------------------------------------------------------------------------
-- Recarga paid/starting/charging ocupa o conector; pending_payment ocupa por
-- p_reserva_min minutos (o valor vem de RESERVA_PAGAMENTO_MIN em
-- _shared/recarga.ts, unica definicao). Checar e inserir sob o mesmo
-- advisory lock do conector: dois checkouts simultaneos nao passam juntos.
-- Devolve o id da recarga criada, ou nulo se o conector esta reservado/em uso.
-- Só service_role (a Edge Function create-charging-checkout).
create or replace function public.fn_reservar_recarga(
    p_carregador_id        uuid,
    p_connector_id         integer,
    p_reserva_min          integer,
    p_eletroposto_id       uuid,
    p_conector_numero      integer,
    p_user_id              uuid,
    p_motorista_nome       text,
    p_motorista_email      text,
    p_motorista_telefone   text,
    p_valor                numeric,
    p_kwh_estimado         numeric,
    p_tarifa_kwh_aplicada  numeric,
    p_metadata             jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id uuid;
begin
    if p_reserva_min is null or p_reserva_min < 0 then
        raise exception 'p_reserva_min invalido' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('conector_reserva:' || p_carregador_id::text || ':' || p_connector_id::text));

    if exists (
        select 1 from recargas_eletroposto r
         where r.carregador_id = p_carregador_id
           and r.ocpp_connector_id = p_connector_id
           and (
                r.status in ('paid', 'starting', 'charging')
                or (r.status = 'pending_payment'
                    and r.created_at > now() - make_interval(mins => p_reserva_min))
           )
    ) then
        return null;
    end if;

    insert into recargas_eletroposto (
        eletroposto_id, conector_numero, carregador_id, ocpp_connector_id,
        tipo_usuario, user_id, motorista_nome, motorista_email, motorista_telefone,
        valor, kwh_estimado, tarifa_kwh_aplicada, status, metadata
    ) values (
        p_eletroposto_id, p_conector_numero, p_carregador_id, p_connector_id,
        case when p_user_id is null then 'avulso' else 'cadastrado' end,
        p_user_id, p_motorista_nome, p_motorista_email, p_motorista_telefone,
        p_valor, p_kwh_estimado, p_tarifa_kwh_aplicada, 'pending_payment',
        coalesce(p_metadata, '{}'::jsonb)
    ) returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.fn_reservar_recarga(uuid, integer, integer, uuid, integer, uuid, text, text, text, numeric, numeric, numeric, jsonb)
    from public, anon, authenticated;
grant execute on function public.fn_reservar_recarga(uuid, integer, integer, uuid, integer, uuid, text, text, text, numeric, numeric, numeric, jsonb)
    to service_role;

-- ---------------------------------------------------------------------------
-- 6. Dados publicos do posto para a tela /recarga (anon)
-- ---------------------------------------------------------------------------
-- anon nao le eletropostos nem planos. Estas funcoes devolvem so campos nao
-- pessoais, e SO de postos 'operando' (pre-operacao, instalacao, manutencao,
-- inativo e cancelado nao vendem recarga). A tarifa vem do plano; posto sem
-- plano/tarifa volta com tarifa nula e a tela mostra "Recarga indisponivel".
create or replace function public.fn_eletroposto_publico(p_id uuid)
returns table (
    id                   uuid,
    nome                 text,
    endereco             text,
    potencia_kw          numeric,
    tipo_recarga         text,
    qtd_carregadores     integer,
    tarifa_motorista_kwh numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select e.id, e.nome, e.endereco, e.potencia_kw, e.tipo_recarga, e.qtd_carregadores,
           p.tarifa_motorista_kwh
      from eletropostos e
      left join planos_assinatura_energia p on p.id = e.plano_id
     where e.id = p_id
       and e.status = 'operando';
$$;

create or replace function public.fn_eletropostos_publicos()
returns table (
    id                   uuid,
    nome                 text,
    endereco             text,
    potencia_kw          numeric,
    tipo_recarga         text,
    qtd_carregadores     integer,
    tarifa_motorista_kwh numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select e.id, e.nome, e.endereco, e.potencia_kw, e.tipo_recarga, e.qtd_carregadores,
           p.tarifa_motorista_kwh
      from eletropostos e
      left join planos_assinatura_energia p on p.id = e.plano_id
     where e.status = 'operando'
     order by e.nome
     limit 50;
$$;

revoke all on function public.fn_eletroposto_publico(uuid) from public;
revoke all on function public.fn_eletropostos_publicos() from public;
grant execute on function public.fn_eletroposto_publico(uuid) to anon, authenticated, service_role;
grant execute on function public.fn_eletropostos_publicos() to anon, authenticated, service_role;
