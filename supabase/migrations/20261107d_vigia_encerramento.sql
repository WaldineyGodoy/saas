-- Vigia do encerramento esquecido (07/11/2026, pedido do dono).
--
-- A regra dos agentes manda, quando o cliente recusa ou se despede, agradecer E mover
-- o negócio para "Negócio Perdido" no mesmo turno — é isso que fecha a conversa no
-- Deskcomm e leva o lead a Negócio Perdido no CRM. O modelo às vezes só agradece
-- (casos de 04 a 07/11: "Ok! Um abraço!", "Não obrigado", "Agora não…"), a conversa
-- fica aberta, e quando o cliente responde a retomada é cancelada sem encerrar.
--
-- A Edge Function `jev-encerramento` (cron a cada 30 min) lê as conversas abertas em
-- que a ÚLTIMA mensagem é do agente de IA e o cliente está calado há mais de 1 hora,
-- e pergunta ao Jev se o atendimento terminou sem negócio. Com probabilidade >= 0,8
-- (e sem retorno combinado), encerra como o agente deveria: card para a etapa de
-- perdido do funil (motivo requested_by_customer) e conversa fechada.
--
-- Fica de fora: conversa com humano, contato nao_lead, retorno agendado pelo agente
-- (cron_jobs sem followup_enrollment_id) e conversa já lida sem mensagem nova.

create table if not exists ponte_deskcomm.vigia_encerramento (
  conversation_id uuid primary key,
  contact_id      uuid,
  lido_ate        timestamptz,
  probabilidade   numeric,
  retorno_combinado numeric,
  decisao         text,          -- 'encerrada' | 'mantida' | 'erro'
  avaliado_em     timestamptz,
  tentativas      integer not null default 0,
  ultimo_erro     text,
  criado_em       timestamptz not null default now()
);

-- Fila
create or replace function public.ponte_deskcomm_conversas_para_encerrar(
  p_limite integer default 20,
  p_conversa uuid default null
)
returns table (conversation_id uuid, contact_id uuid, organization_id uuid, ultima_em timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select v.id, v.contact_id, v.organization_id, ult.created_at
    from conversations v
    join contacts ct on ct.id = v.contact_id
    join lateral (
      select m.created_at, m.direction, m.sent_via from messages m
       where m.conversation_id = v.id and m.revoked_at is null
       order by m.created_at desc limit 1
    ) ult on true
    left join ponte_deskcomm.vigia_encerramento g on g.conversation_id = v.id
   where v.status not in ('closed', 'resolved', 'archived')
     and coalesce(v.assignee_kind, '') <> 'user'
     and not coalesce(v.contato_trava_humano, false)
     and not ('nao_lead' = any (coalesce(ct.tags, '{}')))
     and ult.direction = 'outbound' and ult.sent_via = 'ai'
     and exists (select 1 from messages m where m.conversation_id = v.id and m.direction = 'inbound')
     and exists (select 1 from crm_leads l where l.contact_id = v.contact_id and l.status = 'open')
     and not exists (select 1 from cron_jobs j
                      where j.contact_id = v.contact_id and j.enabled and j.cancelled_at is null
                        and j.next_run_at > now()
                        and not (j.payload ? 'followup_enrollment_id'))
     and (
       (p_conversa is not null and v.id = p_conversa)
       or (p_conversa is null
           and ult.created_at < now() - interval '1 hour'
           and ult.created_at > now() - interval '14 days'
           and (g.conversation_id is null or g.lido_ate is null or ult.created_at > g.lido_ate)
           and coalesce(g.tentativas, 0) < 3)
     )
   order by ult.created_at desc
   limit greatest(1, least(coalesce(p_limite, 20), 50));
$$;

-- Encerrar (confere de novo antes: a conversa pode ter mudado entre a fila e o Jev)
create or replace function public.ponte_deskcomm_encerrar_conversa(
  p_conversa uuid, p_prob numeric, p_retorno numeric, p_lido_ate timestamptz
)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v record;
  c record;
  v_ult timestamptz;
begin
  select * into v from conversations where id = p_conversa;
  if not found then return 'sem_conversa'; end if;
  if v.status in ('closed', 'resolved', 'archived') then return 'ja_fechada'; end if;
  if coalesce(v.assignee_kind, '') = 'user' or coalesce(v.contato_trava_humano, false) then return 'com_humano'; end if;
  select max(created_at) into v_ult from messages where conversation_id = p_conversa and revoked_at is null;
  if v_ult is distinct from p_lido_ate then return 'mudou'; end if;

  update crm_leads l
     set stage_id = (select s.id from crm_stages s
                      where s.pipeline_id = l.pipeline_id and s.is_lost and not s.is_archived
                      order by s.position limit 1),
         status = 'lost', lost_reason = 'requested_by_customer',
         lost_from_stage_id = l.stage_id, closed_at = now(),
         stage_changed_at = now(), updated_at = now()
   where l.contact_id = v.contact_id and l.status = 'open'
     and exists (select 1 from crm_stages s where s.pipeline_id = l.pipeline_id and s.is_lost and not s.is_archived);

  for c in select id, organization_id from conversations
            where contact_id = v.contact_id and status not in ('closed', 'resolved', 'archived')
  loop
    perform fn_service_status(c.organization_id, c.id, 'closed');
  end loop;

  insert into ponte_deskcomm.vigia_encerramento as g
         (conversation_id, contact_id, lido_ate, probabilidade, retorno_combinado, decisao, avaliado_em, tentativas, ultimo_erro)
  values (p_conversa, v.contact_id, p_lido_ate, p_prob, p_retorno, 'encerrada', now(), 0, null)
  on conflict (conversation_id) do update
     set lido_ate = excluded.lido_ate, probabilidade = excluded.probabilidade,
         retorno_combinado = excluded.retorno_combinado, decisao = 'encerrada',
         avaliado_em = now(), tentativas = 0, ultimo_erro = null;
  return 'encerrada';
end;
$$;

-- Manter (o Jev disse que não terminou): não pergunta de novo até mensagem nova
create or replace function public.ponte_deskcomm_manter_conversa(
  p_conversa uuid, p_contato uuid, p_prob numeric, p_retorno numeric, p_lido_ate timestamptz
)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into ponte_deskcomm.vigia_encerramento as g
         (conversation_id, contact_id, lido_ate, probabilidade, retorno_combinado, decisao, avaliado_em, tentativas, ultimo_erro)
  values (p_conversa, p_contato, p_lido_ate, p_prob, p_retorno, 'mantida', now(), 0, null)
  on conflict (conversation_id) do update
     set lido_ate = excluded.lido_ate, probabilidade = excluded.probabilidade,
         retorno_combinado = excluded.retorno_combinado, decisao = 'mantida',
         avaliado_em = now(), tentativas = 0, ultimo_erro = null;
$$;

create or replace function public.ponte_deskcomm_falha_encerramento(p_conversa uuid, p_erro text)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into ponte_deskcomm.vigia_encerramento as g (conversation_id, tentativas, ultimo_erro, decisao)
  values (p_conversa, 1, left(p_erro, 500), 'erro')
  on conflict (conversation_id) do update
     set tentativas = g.tentativas + 1, ultimo_erro = excluded.ultimo_erro, decisao = 'erro';
$$;

revoke all on function public.ponte_deskcomm_conversas_para_encerrar(integer, uuid) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_encerrar_conversa(uuid, numeric, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_manter_conversa(uuid, uuid, numeric, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_falha_encerramento(uuid, text) from public, anon, authenticated;
grant execute on function public.ponte_deskcomm_conversas_para_encerrar(integer, uuid) to service_role;
grant execute on function public.ponte_deskcomm_encerrar_conversa(uuid, numeric, numeric, timestamptz) to service_role;
grant execute on function public.ponte_deskcomm_manter_conversa(uuid, uuid, numeric, numeric, timestamptz) to service_role;
grant execute on function public.ponte_deskcomm_falha_encerramento(uuid, text) to service_role;

select cron.unschedule('ponte-deskcomm-vigia-encerramento')
 where exists (select 1 from cron.job where jobname = 'ponte-deskcomm-vigia-encerramento');
select cron.schedule(
  'ponte-deskcomm-vigia-encerramento',
  '13,43 * * * *',
  $cron$ select ponte_deskcomm.fn_chamar_funcao('jev-encerramento', '{"limite":20}'::jsonb) $cron$
);
