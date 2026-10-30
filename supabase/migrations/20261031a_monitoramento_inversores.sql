-- ============================================================================
-- Monitoramento dos inversores das usinas (SAJ / Elekeeper Open Platform)
--
-- O robo `services/saj-monitor` roda na VPS Contabo (EasyPanel, projeto b2w),
-- porque a SAJ so aceita chamada dos IPs da whitelist do app. A cada ~10 min
-- ele le o estado dos inversores, a geracao de cada usina e os alarmes, e
-- entrega tudo a `fn_monitor_registrar`.
--
-- O que este monitoramento NAO e: fonte do fechamento. `generation_production`
-- continua sendo o numero conferido pelo operador, sobre o qual o repasse sai
-- (ver crm-geracao-fonte-de-verdade). Aqui fica o que o inversor diz, para
-- acompanhar a usina e mostrar ao investidor; nada daqui reescreve o mes.
--
-- ---------------------------------------------------------------------------
-- Sobre o acesso
--
-- O robo nao tem service_role. Ele chama a RPC com a chave anon e prova quem e
-- com um token que nasce aqui dentro (`gen_random_bytes`) e mora no Vault como
-- `monitor:saj_token`. A funcao so sabe gravar nas tabelas monitor_*, entao um
-- vazamento do container nao abre o resto do CRM.
--
-- Para levar o token ao EasyPanel (variavel MONITOR_TOKEN), uma pessoa le no
-- SQL Editor do Supabase:
--   select decrypted_secret from vault.decrypted_secrets where name = 'monitor:saj_token';
--
-- Leitura das tabelas: interno ve tudo; quem ve a usina (fn_rls_ve_usina, o
-- investidor) ve so as dela. Escrita so pela RPC.
-- ============================================================================

do $$
begin
    if not exists (select 1 from vault.secrets where name = 'monitor:saj_token') then
        perform vault.create_secret(
            encode(extensions.gen_random_bytes(32), 'hex'),
            'monitor:saj_token',
            'Token do robo saj-monitor (VPS). Conferido por fn_monitor_registrar.'
        );
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- Usina do fabricante. `usina_id` liga ao CRM e e preenchido a mao: o nome na
-- SAJ e livre ("UFV Bom Jesus" la, "UFV Bom Jesus I" aqui) e nao da para casar.
create table if not exists public.monitor_plantas (
    fabricante        text not null,
    plant_id          text not null,
    nome              text,
    usina_id          uuid references public.usinas(id) on delete set null,
    potencia_atual    numeric,          -- unidade como a SAJ envia (confirmar no 1o ciclo real)
    status_inversor   integer,
    energia_hoje_kwh  numeric,
    energia_mes_kwh   numeric,
    energia_ano_kwh   numeric,
    energia_total_kwh numeric,
    dados_em          timestamptz,      -- quando o inversor reportou
    coletado_em       timestamptz,      -- quando o robo perguntou
    dados             jsonb,            -- resposta crua da SAJ
    primary key (fabricante, plant_id)
);
create index if not exists monitor_plantas_usina on public.monitor_plantas (usina_id);

create table if not exists public.monitor_dispositivos (
    fabricante  text not null,
    device_sn   text not null,
    plant_id    text,
    plant_nome  text,
    modelo      text,
    online      boolean,
    alarme      boolean,
    visto_em    timestamptz,
    primary key (fabricante, device_sn)
);

-- Serie da potencia ao longo do dia (grafico). Uma linha por reporte do inversor.
create table if not exists public.monitor_leituras (
    fabricante       text not null,
    plant_id         text not null,
    lido_em          timestamptz not null,
    potencia_atual   numeric,
    energia_hoje_kwh numeric,
    primary key (fabricante, plant_id, lido_em)
);

-- Geracao do dia, no calendario das usinas (America/Fortaleza). Fica com o
-- maior valor visto: o contador do dia so cresce ate zerar na virada.
create table if not exists public.monitor_geracao_diaria (
    fabricante    text not null,
    plant_id      text not null,
    dia           date not null,
    energia_kwh   numeric not null,
    atualizado_em timestamptz not null default now(),
    primary key (fabricante, plant_id, dia)
);

create table if not exists public.monitor_alarmes (
    fabricante text not null,
    device_sn  text not null,
    codigo     text not null,
    inicio     timestamptz not null,
    plant_id   text,
    nome       text,
    nivel      integer,       -- 1 normal, 2 importante, 3 urgente
    estado     integer,       -- 1 pendente, 4 encerrado
    visto_em   timestamptz,
    primary key (fabricante, device_sn, codigo, inicio)
);
create index if not exists monitor_alarmes_abertos on public.monitor_alarmes (plant_id) where estado = 1;

-- Ponte ja conhecida: na SAJ a UFV Bom Jesus (plant 161369) e a Bom Jesus I do CRM.
insert into public.monitor_plantas (fabricante, plant_id, nome, usina_id)
select 'SAJ', '161369', 'UFV Bom Jesus', u.id
from public.usinas u where u.id = '9bf1349b-6c79-4f68-a8e4-bc00f00850f5'
on conflict (fabricante, plant_id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: leitura por quem ve a usina; nenhuma politica de escrita.
alter table public.monitor_plantas        enable row level security;
alter table public.monitor_dispositivos   enable row level security;
alter table public.monitor_leituras       enable row level security;
alter table public.monitor_geracao_diaria enable row level security;
alter table public.monitor_alarmes        enable row level security;

create or replace function public.fn_monitor_ve_planta(p_fabricante text, p_plant_id text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
    select fn_papel_interno() or exists (
        select 1 from monitor_plantas p
        where p.fabricante = p_fabricante and p.plant_id = p_plant_id
          and p.usina_id is not null and fn_rls_ve_usina(p.usina_id)
    );
$$;

drop policy if exists monitor_plantas_select on public.monitor_plantas;
create policy monitor_plantas_select on public.monitor_plantas
    for select using (fn_papel_interno() or (usina_id is not null and fn_rls_ve_usina(usina_id)));

drop policy if exists monitor_dispositivos_select on public.monitor_dispositivos;
create policy monitor_dispositivos_select on public.monitor_dispositivos
    for select using (fn_monitor_ve_planta(fabricante, plant_id));

drop policy if exists monitor_leituras_select on public.monitor_leituras;
create policy monitor_leituras_select on public.monitor_leituras
    for select using (fn_monitor_ve_planta(fabricante, plant_id));

drop policy if exists monitor_geracao_diaria_select on public.monitor_geracao_diaria;
create policy monitor_geracao_diaria_select on public.monitor_geracao_diaria
    for select using (fn_monitor_ve_planta(fabricante, plant_id));

drop policy if exists monitor_alarmes_select on public.monitor_alarmes;
create policy monitor_alarmes_select on public.monitor_alarmes
    for select using (fn_monitor_ve_planta(fabricante, plant_id));

-- ---------------------------------------------------------------------------
-- Entrada do robo. Um pacote por ciclo; tudo idempotente (upsert), entao
-- reenviar o mesmo pacote nao duplica nada.
create or replace function public.fn_monitor_registrar(p_token text, p_fabricante text, p_pacote jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
    v_coletado timestamptz := coalesce((p_pacote->>'coletado_em')::timestamptz, now());
    v_erros    text[] := array(select jsonb_array_elements_text(coalesce(p_pacote->'erros', '[]')));
    v_disp int; v_plantas int; v_leituras int; v_alarmes int;
begin
    if p_token is null or not exists (
        select 1 from vault.decrypted_secrets
        where name = 'monitor:' || lower(p_fabricante) || '_token' and decrypted_secret = p_token
    ) then
        raise exception 'token do monitor invalido' using errcode = '42501';
    end if;

    insert into monitor_dispositivos as d (fabricante, device_sn, plant_id, plant_nome, modelo, online, alarme, visto_em)
    select p_fabricante, x->>'device_sn', x->>'plant_id', x->>'plant_nome', x->>'modelo',
           (x->>'online')::boolean, (x->>'alarme')::boolean, v_coletado
    from jsonb_array_elements(coalesce(p_pacote->'dispositivos', '[]')) x
    where x->>'device_sn' is not null
    on conflict (fabricante, device_sn) do update set
        plant_id = excluded.plant_id, plant_nome = excluded.plant_nome, modelo = excluded.modelo,
        online = excluded.online, alarme = excluded.alarme, visto_em = excluded.visto_em;
    get diagnostics v_disp = row_count;

    insert into monitor_plantas as p (fabricante, plant_id, nome, potencia_atual, status_inversor,
        energia_hoje_kwh, energia_mes_kwh, energia_ano_kwh, energia_total_kwh, dados_em, coletado_em, dados)
    select p_fabricante, x->>'plant_id', x->>'nome', (x->>'potencia_atual')::numeric, (x->>'status_inversor')::int,
           (x->>'energia_hoje_kwh')::numeric, (x->>'energia_mes_kwh')::numeric, (x->>'energia_ano_kwh')::numeric,
           (x->>'energia_total_kwh')::numeric, (x->>'dados_em')::timestamptz, v_coletado, x->'dados'
    from jsonb_array_elements(coalesce(p_pacote->'plantas', '[]')) x
    where x->>'plant_id' is not null
    -- usina_id fica como esta; campo que a SAJ nao mandou nao apaga o anterior
    on conflict (fabricante, plant_id) do update set
        nome              = coalesce(excluded.nome, p.nome),
        potencia_atual    = coalesce(excluded.potencia_atual, p.potencia_atual),
        status_inversor   = coalesce(excluded.status_inversor, p.status_inversor),
        energia_hoje_kwh  = coalesce(excluded.energia_hoje_kwh, p.energia_hoje_kwh),
        energia_mes_kwh   = coalesce(excluded.energia_mes_kwh, p.energia_mes_kwh),
        energia_ano_kwh   = coalesce(excluded.energia_ano_kwh, p.energia_ano_kwh),
        energia_total_kwh = coalesce(excluded.energia_total_kwh, p.energia_total_kwh),
        dados_em          = coalesce(excluded.dados_em, p.dados_em),
        coletado_em       = excluded.coletado_em,
        dados             = coalesce(excluded.dados, p.dados);
    get diagnostics v_plantas = row_count;

    insert into monitor_leituras (fabricante, plant_id, lido_em, potencia_atual, energia_hoje_kwh)
    select p_fabricante, x->>'plant_id', (x->>'dados_em')::timestamptz,
           (x->>'potencia_atual')::numeric, (x->>'energia_hoje_kwh')::numeric
    from jsonb_array_elements(coalesce(p_pacote->'plantas', '[]')) x
    where x->>'plant_id' is not null and x->>'dados_em' is not null
    on conflict do nothing;
    get diagnostics v_leituras = row_count;

    -- o dia e o do reporte do inversor, nao o da coleta: logo apos a meia-noite
    -- um inversor desligado ainda devolve o total de ontem
    insert into monitor_geracao_diaria as g (fabricante, plant_id, dia, energia_kwh)
    select p_fabricante, x->>'plant_id', ((x->>'dados_em')::timestamptz at time zone 'America/Fortaleza')::date,
           (x->>'energia_hoje_kwh')::numeric
    from jsonb_array_elements(coalesce(p_pacote->'plantas', '[]')) x
    where x->>'plant_id' is not null and x->>'dados_em' is not null and x->>'energia_hoje_kwh' is not null
    on conflict (fabricante, plant_id, dia) do update set
        energia_kwh = greatest(g.energia_kwh, excluded.energia_kwh), atualizado_em = now();

    insert into monitor_alarmes as a (fabricante, device_sn, codigo, inicio, plant_id, nome, nivel, estado, visto_em)
    select p_fabricante, x->>'device_sn', x->>'codigo', (x->>'inicio')::timestamptz,
           (select d.plant_id from monitor_dispositivos d where d.fabricante = p_fabricante and d.device_sn = x->>'device_sn'),
           x->>'nome', (x->>'nivel')::int, (x->>'estado')::int, v_coletado
    from jsonb_array_elements(coalesce(p_pacote->'alarmes', '[]')) x
    where x->>'device_sn' is not null and x->>'codigo' is not null and x->>'inicio' is not null
    on conflict (fabricante, device_sn, codigo, inicio) do update set
        nome = excluded.nome, nivel = excluded.nivel, estado = excluded.estado, visto_em = excluded.visto_em;
    get diagnostics v_alarmes = row_count;

    insert into robo_execucoes (robo, iniciado_em, concluido_em, aplicou, processados, sucesso, falha, erro, detalhe)
    values ('monitor-' || lower(p_fabricante), v_coletado, now(), true,
            v_disp, v_plantas, coalesce(array_length(v_erros, 1), 0),
            nullif(array_to_string(v_erros, ' | '), ''),
            jsonb_build_object('dispositivos', v_disp, 'plantas', v_plantas, 'leituras', v_leituras, 'alarmes', v_alarmes));

    return jsonb_build_object('dispositivos', v_disp, 'plantas', v_plantas, 'leituras', v_leituras, 'alarmes', v_alarmes);
end $$;

revoke all on function public.fn_monitor_registrar(text, text, jsonb) from public;
grant execute on function public.fn_monitor_registrar(text, text, jsonb) to anon, authenticated;
