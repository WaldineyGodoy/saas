-- OCPP 1.6-J: estrutura no banco (Tarefa 2 do plano).
-- Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md §4
-- Teste: supabase/tests/ocpp_estrutura.test.sql
-- Depende de 20261007a_recarga_seguranca.sql.
--
-- Quem escreve: o CSMS e as Edge Functions, com service role (ignora RLS).
-- Pelo app, o interno cadastra carregador/conector e enfileira comando de
-- operador (Reset, ChangeAvailability...); o resto ele so le. Fornecedor le o
-- carregador, conectores, transacoes e medicoes do proprio eletroposto. idTag,
-- fila e trilha de frames sao so do interno. anon nao ve nada.

-- ---------------------------------------------------------------------------
-- 1. Tarifa ao motorista no plano de eletroposto (spec §4.9)
-- ---------------------------------------------------------------------------
alter table public.planos_assinatura_energia
    add column if not exists tarifa_motorista_kwh numeric(10,4)
        constraint planos_tarifa_motorista_kwh_positiva check (tarifa_motorista_kwh > 0);

comment on column public.planos_assinatura_energia.tarifa_motorista_kwh is
    'Preco por kWh cobrado do motorista nos eletropostos com este plano. O checkout grava a foto em recargas_eletroposto.tarifa_kwh_aplicada.';

-- ---------------------------------------------------------------------------
-- 2. Carregador (Charge Point)
-- ---------------------------------------------------------------------------
create table public.eletroposto_carregadores (
    id                    uuid primary key default gen_random_uuid(),
    eletroposto_id        uuid not null references public.eletropostos(id) on delete cascade,
    -- chargeBoxIdentity: ultimo segmento da URL ws(s)://host/ocpp/<ocpp_id>
    ocpp_id               text not null unique check (ocpp_id ~ '^[A-Za-z0-9_-]{1,48}$'),
    -- Basic Auth (Security Profile 1). Nulo = so ambiente local (OCPP_AUTH=off).
    senha_hash            text,
    vendor                text,
    modelo                text,
    serial                text,
    firmware              text,
    heartbeat_intervalo_s integer not null default 60 check (heartbeat_intervalo_s > 0),
    online                boolean not null default false,
    ultimo_boot_em        timestamptz,
    ultimo_contato_em     timestamptz,
    estado_registro       text not null default 'pendente'
                          check (estado_registro in ('pendente', 'aceito', 'rejeitado')),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

comment on table public.eletroposto_carregadores is
    'Carregador OCPP 1.6-J de um eletroposto. vendor/modelo/serial/firmware vem do BootNotification.';
comment on column public.eletroposto_carregadores.senha_hash is
    'Hash (scrypt) da senha Basic Auth. Nunca a senha. Sem SELECT para authenticated: so o CSMS (service role) le.';

create index eletroposto_carregadores_eletroposto_id_idx on public.eletroposto_carregadores (eletroposto_id);

create trigger trg_eletroposto_carregadores_updated_at
    before update on public.eletroposto_carregadores
    for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Conector (connector_id 0 = estacao inteira)
-- ---------------------------------------------------------------------------
create table public.eletroposto_conectores (
    id                  uuid primary key default gen_random_uuid(),
    carregador_id       uuid not null references public.eletroposto_carregadores(id) on delete cascade,
    connector_id        integer not null check (connector_id >= 0),
    status              text not null default 'Unavailable' check (status in (
                            'Available', 'Preparing', 'Charging', 'SuspendedEVSE', 'SuspendedEV',
                            'Finishing', 'Reserved', 'Unavailable', 'Faulted')),
    error_code          text not null default 'NoError' check (error_code in (
                            'ConnectorLockFailure', 'EVCommunicationError', 'GroundFailure',
                            'HighTemperature', 'InternalError', 'LocalListConflict', 'NoError',
                            'OtherError', 'OverCurrentFailure', 'OverVoltage', 'PowerMeterFailure',
                            'PowerSwitchFailure', 'ReaderFailure', 'ResetFailure', 'UnderVoltage',
                            'WeakSignal')),
    info                text,
    vendor_error_code   text,
    status_em           timestamptz,
    -- Faulted grave (EmergencyStop, GroundFailure): so libera depois de Reset aceito + novo Boot.
    bloqueado_ate_reset boolean not null default false,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (carregador_id, connector_id)
);

comment on table public.eletroposto_conectores is
    'Estado de cada conector pelo StatusNotification (ChargePointStatus/ChargePointErrorCode do OCPP 1.6).';

create trigger trg_eletroposto_conectores_updated_at
    before update on public.eletroposto_conectores
    for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 4. idTag efemero por recarga (CiString20Type)
-- ---------------------------------------------------------------------------
create table public.ocpp_id_tags (
    id_tag     text primary key check (char_length(id_tag) between 1 and 20),
    recarga_id uuid references public.recargas_eletroposto(id) on delete set null,
    status     text not null default 'Accepted'
               check (status in ('Accepted', 'Blocked', 'Expired', 'Invalid', 'ConcurrentTx')),
    expira_em  timestamptz,
    usado_em   timestamptz,
    created_at timestamptz not null default now()
);

comment on table public.ocpp_id_tags is
    'idTag de uso unico por recarga (RC + 18 base32). Depois do StopTransaction vira Expired.';

create index ocpp_id_tags_recarga_id_idx on public.ocpp_id_tags (recarga_id);

-- ---------------------------------------------------------------------------
-- 5. Transacao (transactionId OCPP = id inteiro)
-- ---------------------------------------------------------------------------
create table public.ocpp_transacoes (
    id                 bigint generated always as identity primary key,
    -- restrict: carregador com historico nao some
    carregador_id      uuid not null references public.eletroposto_carregadores(id) on delete restrict,
    connector_id       integer not null check (connector_id > 0),
    recarga_id         uuid references public.recargas_eletroposto(id) on delete set null,
    id_tag             text not null,
    meter_start_wh     bigint not null,
    meter_stop_wh      bigint,
    inicio_em          timestamptz not null,
    fim_em             timestamptz,
    motivo_parada      text check (motivo_parada in (
                           'EmergencyStop', 'EVDisconnected', 'HardReset', 'Local', 'Other',
                           'PowerLoss', 'Reboot', 'Remote', 'SoftReset', 'UnlockCommand', 'DeAuthorized')),
    -- carregador_id|connector_id|id_tag|timestamp do StartTransaction: retransmissao devolve o mesmo id
    chave_idempotencia text not null unique,
    created_at         timestamptz not null default now()
);

create index ocpp_transacoes_carregador_id_idx on public.ocpp_transacoes (carregador_id);
create index ocpp_transacoes_recarga_id_idx on public.ocpp_transacoes (recarga_id);

-- ---------------------------------------------------------------------------
-- 6. Medicao (energia sempre em Wh, potencia em W)
-- ---------------------------------------------------------------------------
create table public.ocpp_medicoes (
    id           bigint generated always as identity primary key,
    transacao_id bigint not null references public.ocpp_transacoes(id) on delete cascade,
    connector_id integer not null,
    medido_em    timestamptz not null,
    measurand    text not null default 'Energy.Active.Import.Register',
    -- '' = sem fase. Texto vazio (e nao nulo) para a unicidade valer e o
    -- upsert do PostgREST (onConflict por colunas) funcionar.
    phase        text not null default '',
    valor        numeric not null,
    unidade      text not null,
    contexto     text,
    created_at   timestamptz not null default now(),
    -- reenvio apos queda nao duplica (on conflict do nothing). O indice desta
    -- restricao tambem atende a consulta por (transacao_id, medido_em).
    constraint ocpp_medicoes_unica unique (transacao_id, medido_em, measurand, phase)
);

-- ---------------------------------------------------------------------------
-- 7. Fila de comandos app -> CSMS
-- ---------------------------------------------------------------------------
create table public.ocpp_comandos (
    id                   uuid primary key default gen_random_uuid(),
    carregador_id        uuid not null references public.eletroposto_carregadores(id) on delete cascade,
    acao                 text not null check (acao in (
                             'RemoteStartTransaction', 'RemoteStopTransaction', 'Reset',
                             'ChangeAvailability', 'GetConfiguration', 'ChangeConfiguration',
                             'UnlockConnector', 'TriggerMessage')),
    payload              jsonb not null default '{}'::jsonb,
    status               text not null default 'pendente' check (status in (
                             'pendente', 'enviado', 'aceito', 'rejeitado', 'erro', 'expirado')),
    tentativas           integer not null default 0 check (tentativas >= 0),
    proxima_tentativa_em timestamptz not null default now(),
    expira_em            timestamptz not null default now() + interval '2 minutes',
    resposta             jsonb,
    erro                 text,
    recarga_id           uuid references public.recargas_eletroposto(id) on delete set null,
    -- ex.: start:<recarga_id>. Nulo para comando de operador (pode repetir).
    chave_idempotencia   text unique,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

comment on table public.ocpp_comandos is
    'Fila app -> CSMS. O CSMS consome por Realtime + varredura, envia ao carregador e grava a resposta.';

create index ocpp_comandos_fila_idx on public.ocpp_comandos (status, proxima_tentativa_em);
create index ocpp_comandos_carregador_id_idx on public.ocpp_comandos (carregador_id);
create index ocpp_comandos_recarga_id_idx on public.ocpp_comandos (recarga_id);

create trigger trg_ocpp_comandos_updated_at
    before update on public.ocpp_comandos
    for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Trilha de frames (retencao 30 dias)
-- ---------------------------------------------------------------------------
create table public.ocpp_mensagens (
    id            bigint generated always as identity primary key,
    -- nulo quando o handshake foi recusado (ocpp_id nao cadastrado, CP-02)
    carregador_id uuid references public.eletroposto_carregadores(id) on delete cascade,
    ocpp_id       text not null,
    direcao       text not null check (direcao in ('entrada', 'saida')),
    -- 2 CALL, 3 CALLRESULT, 4 CALLERROR; nulo para evento de conexao
    tipo          smallint check (tipo in (2, 3, 4)),
    unique_id     text,
    acao          text,
    payload       jsonb,
    criado_em     timestamptz not null default now()
);

create index ocpp_mensagens_carregador_criado_idx on public.ocpp_mensagens (carregador_id, criado_em);
create index ocpp_mensagens_criado_em_idx on public.ocpp_mensagens (criado_em);

select cron.unschedule('ocpp-mensagens-limpeza')
where exists (select 1 from cron.job where jobname = 'ocpp-mensagens-limpeza');

select cron.schedule(
    'ocpp-mensagens-limpeza',
    '23 4 * * *',
    $cron$ delete from public.ocpp_mensagens where criado_em < now() - interval '30 days' $cron$
);

-- ---------------------------------------------------------------------------
-- 9. Recarga: status 'starting', colunas OCPP e maquina de status (spec §4.8)
-- ---------------------------------------------------------------------------
alter table public.recargas_eletroposto drop constraint if exists recargas_eletroposto_status_check;
alter table public.recargas_eletroposto add constraint recargas_eletroposto_status_check check (
    status in ('pending_payment', 'paid', 'starting', 'charging', 'completed', 'failed', 'canceled'));

alter table public.recargas_eletroposto
    add column if not exists ocpp_id_tag       text,
    add column if not exists ocpp_transacao_id bigint references public.ocpp_transacoes(id) on delete set null,
    add column if not exists kwh_limite        numeric(10,3),
    add column if not exists kwh_consumido     numeric(10,3),
    add column if not exists valor_final       numeric(10,2),
    add column if not exists valor_estornado   numeric(10,2),
    add column if not exists stripe_refund_id  text,
    add column if not exists iniciada_em       timestamptz,
    add column if not exists finalizada_em     timestamptz,
    add column if not exists motivo_fim        text;

-- Mesmo mapa de supabase/functions/_shared/recarga.ts (RECARGA_TRANSICOES).
create or replace function public.fn_recarga_transicao_valida()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if new.status is distinct from old.status and not (
        (old.status = 'pending_payment' and new.status in ('paid', 'failed', 'canceled')) or
        (old.status = 'paid'            and new.status in ('starting', 'failed')) or
        (old.status = 'starting'        and new.status in ('charging', 'failed', 'canceled')) or
        (old.status = 'charging'        and new.status = 'completed')
    ) then
        raise exception 'Transição de status da recarga inválida: % -> %.', old.status, new.status
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_recarga_transicao_valida on public.recargas_eletroposto;
create trigger trg_recarga_transicao_valida
    before update of status on public.recargas_eletroposto
    for each row execute function public.fn_recarga_transicao_valida();

drop trigger if exists trg_recargas_eletroposto_updated_at on public.recargas_eletroposto;
create trigger trg_recargas_eletroposto_updated_at
    before update on public.recargas_eletroposto
    for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 10. Acesso
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para a politica de uma tabela nao depender da RLS da outra
-- (mesmo padrao de fn_eletroposto_do_fornecedor).
create or replace function public.fn_carregador_do_fornecedor(p_carregador_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from eletroposto_carregadores c
         where c.id = p_carregador_id
           and fn_eletroposto_do_fornecedor(c.eletroposto_id)
    );
$$;

create or replace function public.fn_transacao_do_fornecedor(p_transacao_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from ocpp_transacoes t
         where t.id = p_transacao_id
           and fn_carregador_do_fornecedor(t.carregador_id)
    );
$$;

revoke all on function public.fn_carregador_do_fornecedor(uuid) from public, anon;
revoke all on function public.fn_transacao_do_fornecedor(bigint) from public, anon;
grant execute on function public.fn_carregador_do_fornecedor(uuid) to authenticated;
grant execute on function public.fn_transacao_do_fornecedor(bigint) to authenticated;

alter table public.eletroposto_carregadores enable row level security;
alter table public.eletroposto_conectores   enable row level security;
alter table public.ocpp_id_tags             enable row level security;
alter table public.ocpp_transacoes          enable row level security;
alter table public.ocpp_medicoes            enable row level security;
alter table public.ocpp_comandos            enable row level security;
alter table public.ocpp_mensagens           enable row level security;

revoke all on public.eletroposto_carregadores, public.eletroposto_conectores, public.ocpp_id_tags,
              public.ocpp_transacoes, public.ocpp_medicoes, public.ocpp_comandos, public.ocpp_mensagens
  from anon;

-- O que o CSMS grava, o app so le.
revoke insert, update, delete on public.ocpp_id_tags, public.ocpp_transacoes,
                                 public.ocpp_medicoes, public.ocpp_mensagens
  from authenticated;
revoke update, delete on public.ocpp_comandos from authenticated;

-- senha_hash: nenhuma leitura pelo app. SELECT so nas outras colunas.
revoke select on public.eletroposto_carregadores from authenticated;
grant select (id, eletroposto_id, ocpp_id, vendor, modelo, serial, firmware, heartbeat_intervalo_s,
              online, ultimo_boot_em, ultimo_contato_em, estado_registro, created_at, updated_at)
  on public.eletroposto_carregadores to authenticated;

create policy carregadores_interno on public.eletroposto_carregadores
    for all to authenticated
    using (public.fn_papel_interno()) with check (public.fn_papel_interno());
create policy carregadores_fornecedor_le on public.eletroposto_carregadores
    for select to authenticated
    using (public.fn_eletroposto_do_fornecedor(eletroposto_id));

create policy conectores_interno on public.eletroposto_conectores
    for all to authenticated
    using (public.fn_papel_interno()) with check (public.fn_papel_interno());
create policy conectores_fornecedor_le on public.eletroposto_conectores
    for select to authenticated
    using (public.fn_carregador_do_fornecedor(carregador_id));

create policy id_tags_interno_le on public.ocpp_id_tags
    for select to authenticated using (public.fn_papel_interno());

create policy transacoes_interno_le on public.ocpp_transacoes
    for select to authenticated using (public.fn_papel_interno());
create policy transacoes_fornecedor_le on public.ocpp_transacoes
    for select to authenticated using (public.fn_carregador_do_fornecedor(carregador_id));

create policy medicoes_interno_le on public.ocpp_medicoes
    for select to authenticated using (public.fn_papel_interno());
create policy medicoes_fornecedor_le on public.ocpp_medicoes
    for select to authenticated using (public.fn_transacao_do_fornecedor(transacao_id));

-- Interno enfileira comando de operador; o CSMS (service role) atualiza.
create policy comandos_interno_le on public.ocpp_comandos
    for select to authenticated using (public.fn_papel_interno());
create policy comandos_interno_insere on public.ocpp_comandos
    for insert to authenticated with check (public.fn_papel_interno());

create policy mensagens_interno_le on public.ocpp_mensagens
    for select to authenticated using (public.fn_papel_interno());

-- ---------------------------------------------------------------------------
-- 11. Realtime: o CSMS assina os INSERTs da fila
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.ocpp_comandos;
