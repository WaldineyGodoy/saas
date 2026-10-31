-- ============================================================================
-- Alertas de WhatsApp do monitoramento dos inversores
--
-- Quem recebe e o que recebe e configurado NA USINA (modal -> Tecnico ->
-- Alertas): `usinas.alertas_whatsapp` (numeros, so digitos com DDD) e
-- `usinas.alertas_tipos` (quais alertas). Tipos:
--
--   offline      inversor sem comunicar 30+ min entre 07h e 17h. A noite o
--                inversor desliga sozinho, entao fora desse horario nao alerta.
--   alarme       alarme novo da SAJ de nivel importante ou urgente; avisa de
--                novo quando a SAJ o da por encerrado.
--   geracao_zero inversor online mas sem gerar entre 10h e 14h por 30+ min
--                (disjuntor, string, protecao).
--   robo_parado  o saj-monitor ficou 40+ min sem uma coleta com dados. Nao e
--                de uma usina so: vai para todas as usinas que marcaram o tipo.
--
-- Um alerta aberto nao se repete (indice unico por tipo+chave enquanto
-- aberto): problema que dura o dia inteiro gera UMA mensagem, e a de
-- normalizado quando passa. Horarios sempre no fuso das usinas
-- (America/Fortaleza).
--
-- So avalia dado fresco (robo reportou nos ultimos 40 min). Robo parado nao e
-- "inversor offline": sem dado novo, nao se sabe o estado -- quem cobre isso e
-- o tipo robo_parado.
--
-- O envio usa o caminho que ja existe: linha `pending` em notification_logs ->
-- trg_dispatch_notification -> send-whatsapp (Evolution) com o segredo interno.
-- ============================================================================

-- Marca de inversor com API de monitoramento conectada. So para essas o modal
-- mostra o bloco Alertas: sem API nao chega dado, e alerta configurado nunca
-- dispararia. Hoje so a SAJ (Elekeeper Open Platform, robo saj-monitor).
alter table public.inverter_brands
    add column if not exists api_monitoramento boolean not null default false;
update public.inverter_brands set api_monitoramento = true where lower(name) = 'saj';

alter table public.usinas
    add column if not exists alertas_whatsapp text[] not null default '{}',
    add column if not exists alertas_tipos    text[] not null default '{offline}';

comment on column public.usinas.alertas_whatsapp is
    'WhatsApp (so digitos, DDD + numero) que recebem os alertas do monitoramento dos inversores.';
comment on column public.usinas.alertas_tipos is
    'Alertas ligados: offline, alarme, geracao_zero, robo_parado. Ver 20261031b_monitor_alertas.sql.';

alter table public.monitor_dispositivos add column if not exists offline_desde timestamptz;
alter table public.monitor_plantas      add column if not exists alertar boolean not null default true;

create table if not exists public.monitor_alertas (
    id          uuid primary key default gen_random_uuid(),
    tipo        text not null,                 -- offline | alarme | geracao_zero | robo_parado
    fabricante  text not null,
    chave       text not null,                 -- device_sn, plant_id, alarme ou nome do robo
    plant_id    text,
    usina_id    uuid references public.usinas(id) on delete set null,
    aberto_em   timestamptz not null default now(),
    desde       timestamptz,                   -- quando o problema comecou
    fechado_em  timestamptz,
    detalhe     jsonb not null default '{}'::jsonb
);
create unique index if not exists monitor_alertas_um_aberto
    on public.monitor_alertas (tipo, fabricante, chave) where fechado_em is null;

alter table public.monitor_alertas enable row level security;
drop policy if exists monitor_alertas_select on public.monitor_alertas;
create policy monitor_alertas_select on public.monitor_alertas
    for select using (fn_papel_interno() or (plant_id is not null and fn_monitor_ve_planta(fabricante, plant_id)));

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
-- Envio: uma linha pending por numero da usina que marcou o tipo do alerta.
-- Alerta sem usina (robo_parado) vai a todas as usinas que marcaram o tipo.
create or replace function public.fn_monitor_enviar_alerta(p_alerta_id uuid, p_texto text)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
    v_alerta monitor_alertas;
    v_n int;
begin
    select * into v_alerta from monitor_alertas where id = p_alerta_id;
    insert into notification_logs (entity_type, entity_id, channel, recipient, subject, body, status, metadata)
    -- entity_id e obrigatorio: no robo_parado (sem usina) fica a usina de quem recebe.
    -- Inversor sem usina ligada no CRM nao tem destinatario: so o robo_parado e geral.
    select 'usina', n.usina_id, 'whatsapp', n.numero, 'Monitoramento de usina', p_texto, 'pending',
           jsonb_build_object('origem', 'monitor', 'tipo', v_alerta.tipo, 'alerta_id', p_alerta_id)
    from (
        select distinct on (t.numero) t.numero, u.id as usina_id
        from usinas u, unnest(u.alertas_whatsapp) as t(numero)
        where v_alerta.tipo = any(u.alertas_tipos)
          and (u.id = v_alerta.usina_id or v_alerta.tipo = 'robo_parado')
          and length(regexp_replace(t.numero, '\D', '', 'g')) >= 10
        order by t.numero, u.name
    ) n;
    get diagnostics v_n = row_count;
    return v_n;
end $$;

create or replace function public.fn_monitor_hora(p_ts timestamptz, p_agora timestamptz)
returns text
language sql stable
as $$
    select to_char(p_ts at time zone 'America/Fortaleza',
                   case when (p_ts at time zone 'America/Fortaleza')::date = (p_agora at time zone 'America/Fortaleza')::date
                        then 'HH24:MI' else 'DD/MM "às" HH24:MI' end);
$$;

create or replace function public.fn_monitor_duracao(p_dur interval)
returns text
language sql stable
as $$
    select case when p_dur >= interval '1 day' then extract(day from p_dur)::int || 'd ' else '' end
           || to_char(p_dur, 'FMHH24"h"MI');
$$;

-- ---------------------------------------------------------------------------
-- Avaliacao (pg_cron a cada 10 min). p_agora existe para teste.
create or replace function public.fn_monitor_avaliar_alertas(p_agora timestamptz default now())
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
    v_hora   time := (p_agora at time zone 'America/Fortaleza')::time;
    v_fresco timestamptz := p_agora - interval '40 minutes';
    r        record;
    v_id     uuid;
    v_ultima timestamptz;
    v_abertos int := 0;
    v_fechados int := 0;
begin
    -- ------------------------------------------------------------- offline
    if v_hora >= time '07:00' and v_hora < time '17:00' then
        for r in
            select d.*, coalesce(u.name, p.nome, d.plant_nome, d.plant_id) as usina_nome, p.usina_id, p.energia_hoje_kwh
            from monitor_dispositivos d
            left join monitor_plantas p on p.fabricante = d.fabricante and p.plant_id = d.plant_id
            left join usinas u on u.id = p.usina_id
            where not d.online
              and d.offline_desde <= p_agora - interval '30 minutes'
              and d.visto_em >= v_fresco
              and coalesce(p.alertar, true)
              and not exists (select 1 from monitor_alertas a where a.tipo = 'offline' and a.fabricante = d.fabricante
                                and a.chave = d.device_sn and a.fechado_em is null)
        loop
            insert into monitor_alertas (tipo, fabricante, chave, plant_id, usina_id, aberto_em, desde, detalhe)
            values ('offline', r.fabricante, r.device_sn, r.plant_id, r.usina_id, p_agora, r.offline_desde,
                    jsonb_build_object('modelo', r.modelo, 'usina', r.usina_nome))
            returning id into v_id;
            perform fn_monitor_enviar_alerta(v_id,
                '⚠️ *Inversor offline* — ' || r.usina_nome || E'\n'
                || 'Inversor ' || coalesce(r.modelo || ' ', '') || '(' || r.device_sn || ') sem comunicar desde '
                || fn_monitor_hora(r.offline_desde, p_agora) || '.'
                || coalesce(E'\nGeração registrada hoje: ' || trim(to_char(r.energia_hoje_kwh, 'FM999G990D0')) || ' kWh.', '')
                || E'\nVerificar energia/comunicação no local.');
            v_abertos := v_abertos + 1;
        end loop;
    end if;

    for r in
        select a.*, d.visto_em from monitor_alertas a
        join monitor_dispositivos d on d.fabricante = a.fabricante and d.device_sn = a.chave
        where a.tipo = 'offline' and a.fechado_em is null and d.online
    loop
        update monitor_alertas set fechado_em = p_agora where id = r.id;
        perform fn_monitor_enviar_alerta(r.id,
            '✅ *Inversor normalizado* — ' || coalesce(r.detalhe->>'usina', r.plant_id) || E'\n'
            || 'Inversor ' || r.chave || ' voltou a comunicar às ' || to_char(r.visto_em at time zone 'America/Fortaleza', 'HH24:MI')
            || ' (ficou ' || fn_monitor_duracao(p_agora - coalesce(r.desde, r.aberto_em)) || ' offline).');
        v_fechados := v_fechados + 1;
    end loop;

    -- -------------------------------------------------------------- alarme
    for r in
        select al.*, coalesce(u.name, p.nome, al.plant_id) as usina_nome, p.usina_id,
               al.device_sn || ':' || al.codigo || ':' || to_char(al.inicio at time zone 'UTC', 'YYYYMMDDHH24MISS') as chave
        from monitor_alarmes al
        left join monitor_plantas p on p.fabricante = al.fabricante and p.plant_id = al.plant_id
        left join usinas u on u.id = p.usina_id
        where al.estado = 1 and coalesce(al.nivel, 2) >= 2
          and al.visto_em >= v_fresco
          and coalesce(p.alertar, true)
          and not exists (select 1 from monitor_alertas a where a.tipo = 'alarme' and a.fabricante = al.fabricante
                            and a.chave = al.device_sn || ':' || al.codigo || ':' || to_char(al.inicio at time zone 'UTC', 'YYYYMMDDHH24MISS'))
    loop
        insert into monitor_alertas (tipo, fabricante, chave, plant_id, usina_id, aberto_em, desde, detalhe)
        values ('alarme', r.fabricante, r.chave, r.plant_id, r.usina_id, p_agora, r.inicio,
                jsonb_build_object('usina', r.usina_nome, 'device_sn', r.device_sn, 'codigo', r.codigo, 'nome', r.nome))
        returning id into v_id;
        perform fn_monitor_enviar_alerta(v_id,
            '🚨 *Alarme no inversor* — ' || r.usina_nome || E'\n'
            || coalesce(r.nome, 'Alarme') || ' (código ' || r.codigo || ', '
            || case r.nivel when 3 then 'urgente' else 'importante' end || ')'
            || E'\nInversor ' || r.device_sn || ', desde ' || fn_monitor_hora(r.inicio, p_agora) || '.');
        v_abertos := v_abertos + 1;
    end loop;

    for r in
        select a.* from monitor_alertas a
        join monitor_alarmes al on al.fabricante = a.fabricante
            and a.chave = al.device_sn || ':' || al.codigo || ':' || to_char(al.inicio at time zone 'UTC', 'YYYYMMDDHH24MISS')
        where a.tipo = 'alarme' and a.fechado_em is null and al.estado = 4
    loop
        update monitor_alertas set fechado_em = p_agora where id = r.id;
        perform fn_monitor_enviar_alerta(r.id,
            '✅ *Alarme encerrado* — ' || coalesce(r.detalhe->>'usina', r.plant_id) || E'\n'
            || coalesce(r.detalhe->>'nome', 'Alarme') || ' no inversor ' || (r.detalhe->>'device_sn')
            || ' (durou ' || fn_monitor_duracao(p_agora - coalesce(r.desde, r.aberto_em)) || ').');
        v_fechados := v_fechados + 1;
    end loop;

    -- -------------------------------------------------------- geracao_zero
    -- leituras dos ultimos 30 min: ao menos duas, todas a zero, inversor online
    if v_hora >= time '10:00' and v_hora < time '14:00' then
        for r in
            select p.*, coalesce(u.name, p.nome, p.plant_id) as usina_nome
            from monitor_plantas p
            left join usinas u on u.id = p.usina_id
            where p.alertar and p.coletado_em >= v_fresco
              and exists (select 1 from monitor_dispositivos d where d.fabricante = p.fabricante
                            and d.plant_id = p.plant_id and d.online)
              and (select count(*) from monitor_leituras l where l.fabricante = p.fabricante and l.plant_id = p.plant_id
                     and l.lido_em >= p_agora - interval '30 minutes') >= 2
              and not exists (select 1 from monitor_leituras l where l.fabricante = p.fabricante and l.plant_id = p.plant_id
                                and l.lido_em >= p_agora - interval '30 minutes' and coalesce(l.potencia_atual, 0) > 0)
              and not exists (select 1 from monitor_alertas a where a.tipo = 'geracao_zero' and a.fabricante = p.fabricante
                                and a.chave = p.plant_id and a.fechado_em is null)
        loop
            insert into monitor_alertas (tipo, fabricante, chave, plant_id, usina_id, aberto_em, desde, detalhe)
            values ('geracao_zero', r.fabricante, r.plant_id, r.plant_id, r.usina_id, p_agora,
                    p_agora - interval '30 minutes', jsonb_build_object('usina', r.usina_nome))
            returning id into v_id;
            perform fn_monitor_enviar_alerta(v_id,
                '🔌 *Usina sem gerar* — ' || r.usina_nome || E'\n'
                || 'Inversor comunicando, mas com potência zero há 30 min em pleno sol.'
                || E'\nVerificar disjuntores, strings e proteções.');
            v_abertos := v_abertos + 1;
        end loop;
    end if;

    for r in
        select a.* from monitor_alertas a
        join monitor_plantas p on p.fabricante = a.fabricante and p.plant_id = a.chave
        where a.tipo = 'geracao_zero' and a.fechado_em is null and coalesce(p.potencia_atual, 0) > 0
    loop
        update monitor_alertas set fechado_em = p_agora where id = r.id;
        perform fn_monitor_enviar_alerta(r.id,
            '✅ *Geração retomada* — ' || coalesce(r.detalhe->>'usina', r.plant_id) || E'\n'
            || 'A usina voltou a gerar (ficou ' || fn_monitor_duracao(p_agora - coalesce(r.desde, r.aberto_em)) || ' parada).');
        v_fechados := v_fechados + 1;
    end loop;

    -- --------------------------------------------------------- robo_parado
    -- ultima coleta COM dados; antes do primeiro deploy nao ha nenhuma e nada dispara
    select max(iniciado_em) into v_ultima from robo_execucoes where robo = 'monitor-saj' and sucesso > 0;
    if v_ultima is not null and v_ultima < v_fresco
       and not exists (select 1 from monitor_alertas where tipo = 'robo_parado' and chave = 'monitor-saj' and fechado_em is null) then
        insert into monitor_alertas (tipo, fabricante, chave, aberto_em, desde, detalhe)
        values ('robo_parado', 'SAJ', 'monitor-saj', p_agora, v_ultima,
                jsonb_build_object('ultimo_erro', (select erro from robo_execucoes where robo = 'monitor-saj'
                                                   order by iniciado_em desc limit 1)))
        returning id into v_id;
        perform fn_monitor_enviar_alerta(v_id,
            '🛑 *Monitoramento parado*' || E'\n'
            || 'O robô saj-monitor não traz dados das usinas desde ' || fn_monitor_hora(v_ultima, p_agora) || '.'
            || coalesce(E'\nÚltimo erro: ' || left((select erro from robo_execucoes where robo = 'monitor-saj'
                                                    order by iniciado_em desc limit 1), 200), '')
            || E'\nEnquanto isso os outros alertas ficam sem dados. Verificar o serviço saj-monitor no EasyPanel.');
        v_abertos := v_abertos + 1;
    elsif v_ultima >= v_fresco then
        for r in select * from monitor_alertas where tipo = 'robo_parado' and chave = 'monitor-saj' and fechado_em is null loop
            update monitor_alertas set fechado_em = p_agora where id = r.id;
            perform fn_monitor_enviar_alerta(r.id,
                '✅ *Monitoramento retomado*' || E'\n'
                || 'O robô saj-monitor voltou a trazer dados (ficou ' || fn_monitor_duracao(p_agora - r.desde) || ' sem dados).');
            v_fechados := v_fechados + 1;
        end loop;
    end if;

    return jsonb_build_object('abertos', v_abertos, 'fechados', v_fechados, 'hora_local', v_hora::text);
end $$;

revoke all on function public.fn_monitor_enviar_alerta(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_monitor_avaliar_alertas(timestamptz) from public, anon, authenticated;

-- a cada 10 min, 4 min depois da coleta tipica do robo
select cron.unschedule('monitor-alertas') where exists (select 1 from cron.job where jobname = 'monitor-alertas');
select cron.schedule('monitor-alertas', '4-59/10 * * * *', $$select public.fn_monitor_avaliar_alertas()$$);
