-- Monitoramento dos inversores: regras de alerta, versão 2 (06/11/2026).
--
-- O que muda em relação à 20261031b:
-- 1. Geração zero passa a ser medida pela ENERGIA DO DIA, não pela potência.
--    No primeiro ciclo real, a SAJ mandou powerNow = "0" em
--    getPlantStatisticsData com a usina gerando cerca de 28 kW (a energia do
--    dia subiu 2,31 kWh em 5 min). Pela regra antiga, isso viraria "usina sem
--    gerar" todo dia entre 10h e 14h. Agora a usina só está parada se a
--    energia do dia não sobe em 30 min.
-- 2. Inversor offline: a janela passa a ser das 08h às 18h, a pedido do dono.
--    Entre 17h e 18h só se avisa o que caiu ANTES das 17h, porque o inversor
--    desliga sozinho no pôr do sol e isso não é falha. Se ele cair depois das
--    17h e não voltar, o aviso sai às 08h do dia seguinte.
-- 3. Lembrete do offline: enquanto o inversor continua offline, são no
--    máximo 2 mensagens por dia (o aviso ou lembrete da manhã e mais um,
--    4 h depois no mínimo), sempre dentro da janela das 08h às 18h.
-- 4. Usina em manutenção: com usinas.alertas_pausados ligado, nada é enviado
--    aos números dessa usina. Os alertas continuam registrados. Quando a pausa
--    acaba, se o inversor ainda estiver offline, sai um lembrete no próximo
--    ciclo. Se ele já tiver voltado, não sai o "normalizado" de um aviso que
--    ninguém recebeu.

alter table public.usinas
    add column if not exists alertas_pausados boolean not null default false,
    add column if not exists alertas_pausados_em timestamptz;

comment on column public.usinas.alertas_pausados is
    'Usina em manutenção: o monitoramento não envia WhatsApp aos números da usina. Os alertas continuam registrados em monitor_alertas.';
comment on column public.usinas.alertas_pausados_em is
    'Quando a pausa de alertas foi ligada. É preenchido pelo gatilho trg_usina_alertas_pausa.';

create or replace function public.fn_usina_alertas_pausa()
returns trigger language plpgsql as $$
begin
    if new.alertas_pausados and (tg_op = 'INSERT' or not coalesce(old.alertas_pausados, false)) then
        new.alertas_pausados_em := now();
    elsif not new.alertas_pausados then
        new.alertas_pausados_em := null;
    end if;
    return new;
end $$;

drop trigger if exists trg_usina_alertas_pausa on public.usinas;
create trigger trg_usina_alertas_pausa
    before insert or update of alertas_pausados on public.usinas
    for each row execute function public.fn_usina_alertas_pausa();

-- Controle de envio de cada alerta. Só conta mensagem que de fato saiu para
-- algum número.
alter table public.monitor_alertas
    add column if not exists ultimo_aviso_em timestamptz,
    add column if not exists avisos_dia date,
    add column if not exists avisos_no_dia int not null default 0;

-- Nova assinatura (p_agora) para os testes simularem o relógio.
drop function if exists public.fn_monitor_enviar_alerta(uuid, text);

create or replace function public.fn_monitor_enviar_alerta(p_alerta_id uuid, p_texto text, p_agora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_alerta monitor_alertas; v_n int; v_dia date := (p_agora at time zone 'America/Fortaleza')::date;
begin
    select * into v_alerta from monitor_alertas where id = p_alerta_id;
    insert into notification_logs (entity_type, entity_id, channel, recipient, subject, body, status, metadata)
    select 'usina', n.usina_id, 'whatsapp', n.numero, 'Monitoramento de usina', p_texto, 'pending',
           jsonb_build_object('origem', 'monitor', 'tipo', v_alerta.tipo, 'alerta_id', p_alerta_id)
    from (select distinct on (t.numero) t.numero, u.id as usina_id
          from usinas u, unnest(u.alertas_whatsapp) as t(numero)
          where v_alerta.tipo = any(u.alertas_tipos)
            and (u.id = v_alerta.usina_id or v_alerta.tipo = 'robo_parado')
            and (not u.alertas_pausados or v_alerta.tipo = 'robo_parado')
            and length(regexp_replace(t.numero, '\D', '', 'g')) >= 10
          order by t.numero, u.name) n;
    get diagnostics v_n = row_count;
    if v_n > 0 then
        update monitor_alertas
           set ultimo_aviso_em = p_agora,
               avisos_no_dia = case when avisos_dia = v_dia then avisos_no_dia + 1 else 1 end,
               avisos_dia = v_dia
         where id = p_alerta_id;
    end if;
    return v_n;
end $function$;

revoke all on function public.fn_monitor_enviar_alerta(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.fn_monitor_avaliar_alertas(p_agora timestamp with time zone default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_hora time := (p_agora at time zone 'America/Fortaleza')::time;
    v_dia date := (p_agora at time zone 'America/Fortaleza')::date;
    v_fresco timestamptz := p_agora - interval '40 minutes';
    v_janela boolean := v_hora >= time '08:00' and v_hora < time '18:00';
    r record; v_id uuid; v_ultima timestamptz; v_abertos int := 0; v_fechados int := 0; v_lembretes int := 0;
begin
    -- Inversor offline: abre o alerta.
    if v_janela then
        for r in
            select d.*, coalesce(u.name, p.nome, d.plant_nome, d.plant_id) as usina_nome, u.id as usina_id, p.energia_hoje_kwh
            from monitor_dispositivos d
            left join usinas u on d.device_sn = any(u.inversores_sn)
            left join monitor_plantas p on p.fabricante = d.fabricante and p.plant_id = d.plant_id
            where not d.online
              and d.offline_desde <= p_agora - interval '30 minutes'
              and d.visto_em >= v_fresco
              and coalesce(p.alertar, true)
              -- Pôr do sol: depois das 17h, só o que caiu antes das 17h de hoje.
              and (v_hora < time '17:00'
                   or d.offline_desde < ((v_dia + time '17:00') at time zone 'America/Fortaleza'))
              and not exists (select 1 from monitor_alertas a where a.tipo = 'offline' and a.fabricante = d.fabricante and a.chave = d.device_sn and a.fechado_em is null)
        loop
            insert into monitor_alertas (tipo, fabricante, chave, plant_id, usina_id, aberto_em, desde, detalhe)
            values ('offline', r.fabricante, r.device_sn, r.plant_id, r.usina_id, p_agora, r.offline_desde, jsonb_build_object('modelo', r.modelo, 'usina', r.usina_nome)) returning id into v_id;
            perform fn_monitor_enviar_alerta(v_id, '⚠️ *Inversor offline* — ' || r.usina_nome || E'\n' || 'Inversor ' || coalesce(r.modelo || ' ', '') || '(' || r.device_sn || ') sem comunicar desde ' || fn_monitor_hora(r.offline_desde, p_agora) || '.'
                || coalesce(E'\nGeração registrada hoje: ' || trim(to_char(r.energia_hoje_kwh, 'FM999G990D0')) || ' kWh.', '') || E'\nVerificar energia/comunicação no local.', p_agora);
            v_abertos := v_abertos + 1;
        end loop;

        -- Lembrete: inversor ainda offline. No máximo 2 por dia, com 4 h entre eles.
        for r in
            select a.*, d.offline_desde
            from monitor_alertas a
            join monitor_dispositivos d on d.fabricante = a.fabricante and d.device_sn = a.chave
            where a.tipo = 'offline' and a.fechado_em is null and not d.online
              and a.aberto_em < p_agora
              and (a.avisos_dia is distinct from v_dia or a.avisos_no_dia < 2)
              and (a.ultimo_aviso_em is null
                   or (a.avisos_dia is distinct from v_dia)
                   or a.ultimo_aviso_em <= p_agora - interval '4 hours')
        loop
            if fn_monitor_enviar_alerta(r.id, '⏰ *Inversor continua offline* — ' || coalesce(r.detalhe->>'usina', r.plant_id) || E'\n'
                || 'Inversor ' || coalesce((r.detalhe->>'modelo') || ' ', '') || '(' || r.chave || ') sem comunicar desde ' || fn_monitor_hora(coalesce(r.offline_desde, r.desde), p_agora)
                || ' (há ' || fn_monitor_duracao(p_agora - coalesce(r.offline_desde, r.desde, r.aberto_em)) || ').'
                || E'\nVerificar energia/comunicação no local.', p_agora) > 0 then
                v_lembretes := v_lembretes + 1;
            end if;
        end loop;
    end if;

    -- Inversor offline: fecha quando volta a comunicar. Só avisa se alguém recebeu o alerta.
    for r in select a.*, d.visto_em from monitor_alertas a join monitor_dispositivos d on d.fabricante = a.fabricante and d.device_sn = a.chave
             where a.tipo = 'offline' and a.fechado_em is null and d.online loop
        update monitor_alertas set fechado_em = p_agora where id = r.id;
        if r.ultimo_aviso_em is not null then
            perform fn_monitor_enviar_alerta(r.id, '✅ *Inversor normalizado* — ' || coalesce(r.detalhe->>'usina', r.plant_id) || E'\n' || 'Inversor ' || r.chave || ' voltou a comunicar às ' || to_char(r.visto_em at time zone 'America/Fortaleza', 'HH24:MI') || ' (ficou ' || fn_monitor_duracao(p_agora - coalesce(r.desde, r.aberto_em)) || ' offline).', p_agora);
        end if;
        v_fechados := v_fechados + 1;
    end loop;

    -- Alarme do inversor (sem mudança de regra).
    for r in
        select al.*, coalesce(u.name, p.nome, al.plant_id) as usina_nome, u.id as usina_id, al.device_sn || ':' || al.codigo || ':' || to_char(al.inicio at time zone 'UTC', 'YYYYMMDDHH24MISS') as chave
        from monitor_alarmes al left join usinas u on al.device_sn = any(u.inversores_sn) left join monitor_plantas p on p.fabricante = al.fabricante and p.plant_id = al.plant_id
        where al.estado = 1 and coalesce(al.nivel, 2) >= 2 and al.visto_em >= v_fresco and coalesce(p.alertar, true)
          and not exists (select 1 from monitor_alertas a where a.tipo = 'alarme' and a.fabricante = al.fabricante and a.chave = al.device_sn || ':' || al.codigo || ':' || to_char(al.inicio at time zone 'UTC', 'YYYYMMDDHH24MISS'))
    loop
        insert into monitor_alertas (tipo, fabricante, chave, plant_id, usina_id, aberto_em, desde, detalhe)
        values ('alarme', r.fabricante, r.chave, r.plant_id, r.usina_id, p_agora, r.inicio, jsonb_build_object('usina', r.usina_nome, 'device_sn', r.device_sn, 'codigo', r.codigo, 'nome', r.nome)) returning id into v_id;
        perform fn_monitor_enviar_alerta(v_id, '🚨 *Alarme no inversor* — ' || r.usina_nome || E'\n' || coalesce(r.nome, 'Alarme') || ' (código ' || r.codigo || ', ' || case r.nivel when 3 then 'urgente' else 'importante' end || ')' || E'\nInversor ' || r.device_sn || ', desde ' || fn_monitor_hora(r.inicio, p_agora) || '.', p_agora);
        v_abertos := v_abertos + 1;
    end loop;
    for r in select a.* from monitor_alertas a join monitor_alarmes al on al.fabricante = a.fabricante and a.chave = al.device_sn || ':' || al.codigo || ':' || to_char(al.inicio at time zone 'UTC', 'YYYYMMDDHH24MISS') where a.tipo = 'alarme' and a.fechado_em is null and al.estado = 4 loop
        update monitor_alertas set fechado_em = p_agora where id = r.id;
        if r.ultimo_aviso_em is not null then
            perform fn_monitor_enviar_alerta(r.id, '✅ *Alarme encerrado* — ' || coalesce(r.detalhe->>'usina', r.plant_id) || E'\n' || coalesce(r.detalhe->>'nome', 'Alarme') || ' no inversor ' || (r.detalhe->>'device_sn') || ' (durou ' || fn_monitor_duracao(p_agora - coalesce(r.desde, r.aberto_em)) || ').', p_agora);
        end if;
        v_fechados := v_fechados + 1;
    end loop;

    -- Geração zero: das 10h às 14h, inversor online e energia do dia parada há 30 min.
    -- Exige ao menos 2 leituras com 20 min ou mais de distância entre elas.
    if v_hora >= time '10:00' and v_hora < time '14:00' then
        for r in
            select p.*, coalesce(u.name, p.nome, p.plant_id) as usina_nome
            from monitor_plantas p left join usinas u on u.id = p.usina_id
            join lateral (
                select count(*) as n, max(l.lido_em) - min(l.lido_em) as janela,
                       max(l.energia_hoje_kwh) - min(l.energia_hoje_kwh) as subiu,
                       bool_or(coalesce(l.potencia_atual, 0) > 0) as teve_potencia
                from monitor_leituras l
                where l.fabricante = p.fabricante and l.plant_id = p.plant_id and l.lido_em >= p_agora - interval '30 minutes'
            ) x on true
            where p.alertar and p.coletado_em >= v_fresco
              and exists (select 1 from monitor_dispositivos d where d.fabricante = p.fabricante and d.plant_id = p.plant_id and d.online)
              and x.n >= 2 and x.janela >= interval '20 minutes'
              and coalesce(x.subiu, 0) <= 0 and not coalesce(x.teve_potencia, false)
              and not exists (select 1 from monitor_alertas a where a.tipo = 'geracao_zero' and a.fabricante = p.fabricante and a.chave = p.plant_id and a.fechado_em is null)
        loop
            insert into monitor_alertas (tipo, fabricante, chave, plant_id, usina_id, aberto_em, desde, detalhe)
            values ('geracao_zero', r.fabricante, r.plant_id, r.plant_id, r.usina_id, p_agora, p_agora - interval '30 minutes', jsonb_build_object('usina', r.usina_nome, 'energia_hoje_kwh', r.energia_hoje_kwh)) returning id into v_id;
            perform fn_monitor_enviar_alerta(v_id, '🔌 *Usina sem gerar* — ' || r.usina_nome || E'\n' || 'Inversor comunicando, mas a geração do dia está parada em ' || coalesce(trim(to_char(r.energia_hoje_kwh, 'FM999G990D0')) || ' kWh', '—') || ' há 30 min em pleno sol.' || E'\nVerificar disjuntores, strings e proteções.', p_agora);
            v_abertos := v_abertos + 1;
        end loop;
    end if;
    -- Fecha quando a energia do dia voltar a subir (ou se o dia virou).
    for r in
        select a.*, p.energia_hoje_kwh as energia_agora
        from monitor_alertas a join monitor_plantas p on p.fabricante = a.fabricante and p.plant_id = a.chave
        where a.tipo = 'geracao_zero' and a.fechado_em is null
          and (coalesce(p.energia_hoje_kwh, 0) > coalesce((a.detalhe->>'energia_hoje_kwh')::numeric, 0)
               or (a.aberto_em at time zone 'America/Fortaleza')::date < v_dia)
    loop
        update monitor_alertas set fechado_em = p_agora where id = r.id;
        if r.ultimo_aviso_em is not null and (r.aberto_em at time zone 'America/Fortaleza')::date = v_dia then
            perform fn_monitor_enviar_alerta(r.id, '✅ *Geração retomada* — ' || coalesce(r.detalhe->>'usina', r.plant_id) || E'\n' || 'A usina voltou a gerar (ficou ' || fn_monitor_duracao(p_agora - coalesce(r.desde, r.aberto_em)) || ' parada).', p_agora);
        end if;
        v_fechados := v_fechados + 1;
    end loop;

    -- Robô parado (sem mudança de regra).
    select max(iniciado_em) into v_ultima from robo_execucoes where robo = 'monitor-saj' and sucesso > 0;
    if v_ultima is not null and v_ultima < v_fresco and not exists (select 1 from monitor_alertas where tipo = 'robo_parado' and chave = 'monitor-saj' and fechado_em is null) then
        insert into monitor_alertas (tipo, fabricante, chave, aberto_em, desde, detalhe)
        values ('robo_parado', 'SAJ', 'monitor-saj', p_agora, v_ultima, jsonb_build_object('ultimo_erro', (select erro from robo_execucoes where robo = 'monitor-saj' order by iniciado_em desc limit 1))) returning id into v_id;
        perform fn_monitor_enviar_alerta(v_id, '🛑 *Monitoramento parado*' || E'\n' || 'O robô saj-monitor não traz dados das usinas desde ' || fn_monitor_hora(v_ultima, p_agora) || '.'
            || coalesce(E'\nÚltimo erro: ' || left((select erro from robo_execucoes where robo = 'monitor-saj' order by iniciado_em desc limit 1), 200), '')
            || E'\nEnquanto isso os outros alertas ficam sem dados. Verificar o serviço saj-monitor no EasyPanel.', p_agora);
        v_abertos := v_abertos + 1;
    elsif v_ultima >= v_fresco then
        for r in select * from monitor_alertas where tipo = 'robo_parado' and chave = 'monitor-saj' and fechado_em is null loop
            update monitor_alertas set fechado_em = p_agora where id = r.id;
            if r.ultimo_aviso_em is not null then
                perform fn_monitor_enviar_alerta(r.id, '✅ *Monitoramento retomado*' || E'\n' || 'O robô saj-monitor voltou a trazer dados (ficou ' || fn_monitor_duracao(p_agora - r.desde) || ' sem dados).', p_agora);
            end if;
            v_fechados := v_fechados + 1;
        end loop;
    end if;

    return jsonb_build_object('abertos', v_abertos, 'fechados', v_fechados, 'lembretes', v_lembretes, 'hora_local', v_hora::text);
end $function$;

revoke all on function public.fn_monitor_avaliar_alertas(timestamptz) from public, anon, authenticated;
