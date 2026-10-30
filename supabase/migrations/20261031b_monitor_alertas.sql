-- ============================================================================
-- Alertas de WhatsApp do monitoramento dos inversores
--
-- Primeiro alerta: INVERSOR OFFLINE DE DIA. A noite o inversor desliga sozinho
-- (e o datalogger com ele), entao offline so vira alerta entre 07h e 17h no
-- horario das usinas e depois de 30 min seguidos. Quando ele volta a comunicar,
-- sai a mensagem de normalizado. Um alerta aberto nao se repete: o inversor que
-- nao acordou hoje gera UMA mensagem, nao uma a cada 10 min.
--
-- O envio usa o caminho que ja existe: linha `pending` em notification_logs ->
-- trg_dispatch_notification -> send-whatsapp (Evolution) com o segredo interno.
--
-- So avalia inversor com leitura fresca (robo reportou nos ultimos 40 min).
-- Robo parado nao e "inversor offline": sem dado novo, nao se sabe o estado.
--
-- Quem recebe: monitor_alerta_contatos (ativo = true). Usina com
-- monitor_plantas.alertar = false fica muda (ex.: sistema de cliente que nao
-- se quer acompanhar).
-- ============================================================================

alter table public.monitor_dispositivos add column if not exists offline_desde timestamptz;
alter table public.monitor_plantas      add column if not exists alertar boolean not null default true;

create table if not exists public.monitor_alerta_contatos (
    id        uuid primary key default gen_random_uuid(),
    nome      text not null,
    telefone  text not null,
    ativo     boolean not null default true,
    criado_em timestamptz not null default now()
);

create table if not exists public.monitor_alertas (
    id          uuid primary key default gen_random_uuid(),
    tipo        text not null,                 -- 'offline'
    fabricante  text not null,
    chave       text not null,                 -- device_sn
    plant_id    text,
    usina_id    uuid references public.usinas(id) on delete set null,
    aberto_em   timestamptz not null default now(),
    desde       timestamptz,                   -- quando o problema comecou
    fechado_em  timestamptz,
    detalhe     jsonb not null default '{}'::jsonb
);
create unique index if not exists monitor_alertas_um_aberto
    on public.monitor_alertas (tipo, fabricante, chave) where fechado_em is null;

alter table public.monitor_alerta_contatos enable row level security;
alter table public.monitor_alertas         enable row level security;

drop policy if exists monitor_alerta_contatos_interno on public.monitor_alerta_contatos;
create policy monitor_alerta_contatos_interno on public.monitor_alerta_contatos
    for all using (fn_papel_interno()) with check (fn_papel_interno());

drop policy if exists monitor_alertas_select on public.monitor_alertas;
create policy monitor_alertas_select on public.monitor_alertas
    for select using (fn_monitor_ve_planta(fabricante, plant_id));

-- ---------------------------------------------------------------------------
-- offline_desde: o registro do robo passa a marcar quando o inversor caiu.
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

    insert into monitor_dispositivos as d (fabricante, device_sn, plant_id, plant_nome, modelo, online, alarme, visto_em, offline_desde)
    select p_fabricante, x->>'device_sn', x->>'plant_id', x->>'plant_nome', x->>'modelo',
           (x->>'online')::boolean, (x->>'alarme')::boolean, v_coletado,
           case when (x->>'online')::boolean then null else v_coletado end
    from jsonb_array_elements(coalesce(p_pacote->'dispositivos', '[]')) x
    where x->>'device_sn' is not null
    on conflict (fabricante, device_sn) do update set
        plant_id = excluded.plant_id, plant_nome = excluded.plant_nome, modelo = excluded.modelo,
        online = excluded.online, alarme = excluded.alarme, visto_em = excluded.visto_em,
        offline_desde = case when excluded.online then null else coalesce(d.offline_desde, excluded.visto_em) end;
    get diagnostics v_disp = row_count;

    insert into monitor_plantas as p (fabricante, plant_id, nome, potencia_atual, status_inversor,
        energia_hoje_kwh, energia_mes_kwh, energia_ano_kwh, energia_total_kwh, dados_em, coletado_em, dados)
    select p_fabricante, x->>'plant_id', x->>'nome', (x->>'potencia_atual')::numeric, (x->>'status_inversor')::int,
           (x->>'energia_hoje_kwh')::numeric, (x->>'energia_mes_kwh')::numeric, (x->>'energia_ano_kwh')::numeric,
           (x->>'energia_total_kwh')::numeric, (x->>'dados_em')::timestamptz, v_coletado, x->'dados'
    from jsonb_array_elements(coalesce(p_pacote->'plantas', '[]')) x
    where x->>'plant_id' is not null
    -- usina_id e alertar ficam como estao; campo que a SAJ nao mandou nao apaga o anterior
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

-- ---------------------------------------------------------------------------
-- Envio: uma linha pending por contato ativo; o gatilho de notification_logs
-- chama o send-whatsapp.
create or replace function public.fn_monitor_enviar_alerta(p_alerta_id uuid, p_texto text)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
    v_usina uuid;
    v_n int;
begin
    select usina_id into v_usina from monitor_alertas where id = p_alerta_id;
    insert into notification_logs (entity_type, entity_id, channel, recipient, subject, body, status, metadata)
    select 'usina', v_usina, 'whatsapp', c.telefone, 'Monitoramento de usina', p_texto, 'pending',
           jsonb_build_object('origem', 'monitor', 'alerta_id', p_alerta_id)
    from monitor_alerta_contatos c
    where c.ativo;
    get diagnostics v_n = row_count;
    return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Avaliacao (pg_cron a cada 10 min). p_agora existe para teste.
create or replace function public.fn_monitor_avaliar_alertas(p_agora timestamptz default now())
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
    v_local   timestamp := p_agora at time zone 'America/Fortaleza';
    v_de_dia  boolean := v_local::time >= time '07:00' and v_local::time < time '17:00';
    r         record;
    v_id      uuid;
    v_abertos int := 0;
    v_fechados int := 0;
    v_nome    text;
    v_dur     interval;
begin
    -- abre: offline ha 30+ min, de dia, com leitura fresca, sem alerta aberto
    if v_de_dia then
        for r in
            select d.*, coalesce(u.name, p.nome, d.plant_nome, d.plant_id) as usina_nome, p.usina_id,
                   p.energia_hoje_kwh
            from monitor_dispositivos d
            left join monitor_plantas p on p.fabricante = d.fabricante and p.plant_id = d.plant_id
            left join usinas u on u.id = p.usina_id
            where not d.online
              and d.offline_desde <= p_agora - interval '30 minutes'
              and d.visto_em >= p_agora - interval '40 minutes'
              and coalesce(p.alertar, true)
              and not exists (select 1 from monitor_alertas a
                              where a.tipo = 'offline' and a.fabricante = d.fabricante
                                and a.chave = d.device_sn and a.fechado_em is null)
        loop
            insert into monitor_alertas (tipo, fabricante, chave, plant_id, usina_id, aberto_em, desde, detalhe)
            values ('offline', r.fabricante, r.device_sn, r.plant_id, r.usina_id, p_agora, r.offline_desde,
                    jsonb_build_object('modelo', r.modelo, 'usina', r.usina_nome))
            returning id into v_id;

            perform fn_monitor_enviar_alerta(v_id,
                '⚠️ *Inversor offline* — ' || r.usina_nome || E'\n'
                || 'Inversor ' || coalesce(r.modelo || ' ', '') || '(' || r.device_sn || ') sem comunicar desde '
                || to_char(r.offline_desde at time zone 'America/Fortaleza',
                           case when (r.offline_desde at time zone 'America/Fortaleza')::date = v_local::date
                                then 'HH24:MI' else 'DD/MM "às" HH24:MI' end)
                || '.' || coalesce(E'\nGeração registrada hoje: ' || trim(to_char(r.energia_hoje_kwh, 'FM999G990D0')) || ' kWh.', '')
                || E'\nVerificar energia/comunicação no local.');
            v_abertos := v_abertos + 1;
        end loop;
    end if;

    -- fecha: o inversor voltou a comunicar (a qualquer hora)
    for r in
        select a.*, d.visto_em
        from monitor_alertas a
        join monitor_dispositivos d on d.fabricante = a.fabricante and d.device_sn = a.chave
        where a.tipo = 'offline' and a.fechado_em is null and d.online
    loop
        update monitor_alertas set fechado_em = p_agora where id = r.id;
        v_nome := coalesce(r.detalhe->>'usina', r.plant_id);
        v_dur := p_agora - coalesce(r.desde, r.aberto_em);
        perform fn_monitor_enviar_alerta(r.id,
            '✅ *Inversor normalizado* — ' || v_nome || E'\n'
            || 'Inversor ' || r.chave || ' voltou a comunicar às '
            || to_char(r.visto_em at time zone 'America/Fortaleza', 'HH24:MI')
            || ' (ficou ' || case when v_dur >= interval '1 day' then extract(day from v_dur)::int || 'd ' else '' end
            || to_char(v_dur, 'FMHH24"h"MI') || ' offline).');
        v_fechados := v_fechados + 1;
    end loop;

    return jsonb_build_object('abertos', v_abertos, 'fechados', v_fechados, 'de_dia', v_de_dia);
end $$;

revoke all on function public.fn_monitor_enviar_alerta(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_monitor_avaliar_alertas(timestamptz) from public, anon, authenticated;

-- a cada 10 min, 4 min depois da coleta tipica do robo
select cron.unschedule('monitor-alertas') where exists (select 1 from cron.job where jobname = 'monitor-alertas');
select cron.schedule('monitor-alertas', '4-59/10 * * * *', $$select public.fn_monitor_avaliar_alertas()$$);
