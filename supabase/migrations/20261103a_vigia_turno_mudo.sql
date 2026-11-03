-- Vigia do turno mudo (03/11/2026).
--
-- O modelo do agente às vezes encerra o turno sem chamar send_message; o motor
-- pede UMA correção e, se ela também sai muda, aceita como "silêncio deliberado"
-- (Deskcomm #2938) — o lead fica sem resposta e ninguém é avisado (o caso humano
-- só abre quando a saída é truncada). ~5% dos turnos de 30/10 a 03/11.
--
-- A cada 5 min, dentro da janela de envio (08h–22h, Brasília):
--   1. conversa aberta, agente ativo, sem trava humana, lead escreveu por último
--      há 5 min a 7 dias, e o último turno do agente depois dessa mensagem
--      terminou com 0 envios → reenfileira o turno UMA vez (por mensagem);
--   2. se o turno reenfileirado também sai mudo → etiqueta
--      `alerta:ia-sem-resposta` (vermelha) no contato, para a equipe assumir;
--   3. quando sai qualquer mensagem nossa depois do alerta, a etiqueta sai.
-- Mensagens de despedida curtas ("ok", "obrigado", 👍) não são reenfileiradas.

create table if not exists ponte_deskcomm.vigia_turno_mudo (
    inbound_message_id uuid primary key,
    conversation_id    uuid not null,
    contact_id         uuid not null,
    job_id             uuid,
    tentou_em          timestamptz not null default now(),
    alertou_em         timestamptz,
    resolvido_em       timestamptz
);

create or replace function ponte_deskcomm.fn_cor_da_etiqueta(p_tag text)
returns text language sql immutable as $$
  select case
    when p_tag = 'agente:humano'    then '#6f6f6f'
    when p_tag like 'agente:%'      then '#00655a'
    when p_tag like 'anuncio:%'     then '#ffb224'
    when p_tag like 'fu:%'          then '#ab4aba'
    when p_tag like 'alerta:%'      then '#e5484d'
    when p_tag = 'temp:gelado'      then '#0091ff'
    when p_tag = 'temp:frio'        then '#3e63dd'
    when p_tag = 'temp:morno'       then '#ffe629'
    when p_tag = 'temp:quente'      then '#ffb224'
    when p_tag = 'temp:fechando'    then '#cf3716'
  end
$$;

create or replace function ponte_deskcomm.fn_vigia_turno_mudo()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_tag constant text := 'alerta:ia-sem-resposta';
    v_hora int := extract(hour from now() at time zone 'America/Sao_Paulo');
    r record;
    v_job uuid;
    n_reenf int := 0;
    n_alerta int := 0;
    n_limpo int := 0;
begin
    -- 3. limpa alertas já respondidos (vale também fora da janela)
    for r in
        select v.inbound_message_id, v.contact_id
          from ponte_deskcomm.vigia_turno_mudo v
         where v.alertou_em is not null and v.resolvido_em is null
           and exists (select 1 from messages o
                        where o.conversation_id = v.conversation_id
                          and o.direction = 'outbound' and o.created_at > v.alertou_em)
    loop
        update ponte_deskcomm.vigia_turno_mudo set resolvido_em = now()
         where inbound_message_id = r.inbound_message_id;
        update contacts set tags = array_remove(tags, v_tag)
         where id = r.contact_id and v_tag = any(tags)
           and not exists (select 1 from ponte_deskcomm.vigia_turno_mudo v2
                            where v2.contact_id = r.contact_id and v2.alertou_em is not null
                              and v2.resolvido_em is null);
        n_limpo := n_limpo + 1;
    end loop;

    if v_hora < 8 or v_hora >= 22 then
        return jsonb_build_object('fora_da_janela', true, 'limpos', n_limpo);
    end if;

    for r in
        with ult as (
            select c.id conv, c.organization_id org, c.contact_id, c.channel_session_id,
                   m.id msg, m.created_at msg_em, coalesce(m.body, m.media_derived_text) txt
              from conversations c
              join contacts ct on ct.id = c.contact_id
              join lateral (
                    select * from messages m
                     where m.conversation_id = c.id and m.direction = 'inbound'
                     order by m.created_at desc limit 1) m on true
             where c.status = 'open' and not c.is_group
               and c.active_ai_agent_id is not null
               and coalesce(c.bot_silenced_until, '-infinity') < now()
               and not coalesce(c.contato_trava_humano, false)
               and not ct.force_human and not ct.ai_opt_out and not ct.is_blocked
               and m.created_at < now() - interval '5 minutes'
               and m.created_at > now() - interval '7 days'
               and not exists (select 1 from messages o
                                where o.conversation_id = c.id and o.direction = 'outbound'
                                  and o.created_at > m.created_at)
               and not exists (select 1 from job_queue j
                                where j.contact_id = c.contact_id
                                  and j.status in ('pending', 'running'))
        )
        select u.*, t.created_at turno_em,
               v.inbound_message_id ja_tentou, v.tentou_em, v.alertou_em, v.resolvido_em
          from ult u
          join lateral (
                select t.* from agent_turn_traces t
                 where t.conversation_id = u.conv and not t.is_dry_run
                 order by t.created_at desc limit 1) t on true
          left join ponte_deskcomm.vigia_turno_mudo v on v.inbound_message_id = u.msg
         where t.created_at > u.msg_em
           and t.status = 'completed' and t.messages_sent = 0
    loop
        if r.ja_tentou is null then
            -- despedida curta não é pergunta: não reenfileira
            if r.txt is not null and (
                   r.txt ~* '^\s*(ok|okay|blz|beleza|valeu|obrigad[oa]s?|tchau|at[eé] mais|show|top|certo|combinado)\W*$'
                or length(regexp_replace(r.txt, '[[:alnum:]]', '', 'g')) = length(r.txt)) then
                continue;
            end if;
            insert into job_queue (organization_id, contact_id, kind, payload)
            select r.org, r.contact_id, 'inbound_turn',
                   jsonb_build_object(
                       'conversation_id', r.conv,
                       'contact_id', r.contact_id,
                       'channel_session_id', r.channel_session_id,
                       'inbound_message_id', r.msg,
                       'crm_event_id', coalesce(
                           (select j.payload->>'crm_event_id' from job_queue j
                             where j.contact_id = r.contact_id and j.kind = 'inbound_turn'
                               and j.payload->>'conversation_id' = r.conv::text
                               and j.payload ? 'crm_event_id'
                             order by j.created_at desc limit 1),
                           gen_random_uuid()::text),
                       'origem', 'vigia_turno_mudo')
            returning id into v_job;
            insert into ponte_deskcomm.vigia_turno_mudo
                   (inbound_message_id, conversation_id, contact_id, job_id)
            values (r.msg, r.conv, r.contact_id, v_job);
            n_reenf := n_reenf + 1;
        elsif r.alertou_em is null and r.resolvido_em is null and r.turno_em > r.tentou_em then
            update contacts set tags = array_append(tags, v_tag)
             where id = r.contact_id and not (v_tag = any(coalesce(tags, '{}')));
            update ponte_deskcomm.vigia_turno_mudo set alertou_em = now()
             where inbound_message_id = r.msg;
            n_alerta := n_alerta + 1;
        end if;
    end loop;

    return jsonb_build_object('reenfileirados', n_reenf, 'alertados', n_alerta, 'limpos', n_limpo);
end;
$$;

revoke all on function ponte_deskcomm.fn_vigia_turno_mudo() from public, anon, authenticated;

select cron.unschedule('ponte-deskcomm-vigia-mudo')
 where exists (select 1 from cron.job where jobname = 'ponte-deskcomm-vigia-mudo');
select cron.schedule('ponte-deskcomm-vigia-mudo', '*/5 * * * *',
                     $$select ponte_deskcomm.fn_vigia_turno_mudo()$$);
