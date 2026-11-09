-- Vigia de devolução ao agente (09/11/2026, pedido do dono).
--
-- Quando alguém da equipe assume uma conversa ("Assumir", atribuição, passagem
-- para humano), a IA fica calada SEM PRAZO e os follow-ups adiam de hora em hora
-- ("pessoa_no_comando"). Se a pessoa escreveu e o cliente não respondeu, ninguém
-- retoma o contato.
--
-- Regra do dono: devolve ao agente a conversa que está com uma pessoa quando a
-- ÚLTIMA mensagem da conversa foi do ATENDENTE (pessoa, não a IA), o cliente não
-- respondeu e isso faz 3 dias ou mais. Se o cliente escreveu por último, a
-- conversa fica com a pessoa: alguém precisa responder.
--
-- O Deskcomm tem um prazo de devolução pronto
-- (settings.routing.handoff_return_after_minutes), mas ele conta do último sinal
-- da equipe e não olha quem escreveu por último: devolveria também a conversa
-- em que o cliente está esperando resposta. Por isso ele continua desligado.
--
-- A devolução faz o que `devolverAtendimentoAoAgente` (lib/escalacao/retomada.ts)
-- faz, pelas mesmas funções do banco:
--   - não mexe em contato `ai_opt_out` (atendimento humano para sempre);
--   - solta `force_human`;
--   - solta o dono pela fn_conversation_assign(reason 'release');
--   - limpa o silêncio e a passagem, assignee_kind 'ai', status ai_handling;
--   - autoriza o contato para a IA (ai_authorized_at);
--   - fecha a passagem (fn_passagem_devolvida);
--   - emite ai.handoff_resolved (retoma o follow-up pausado).
-- Fica de fora o checkpoint de retomada e a atividade na linha do tempo, que são
-- só do código TypeScript. O registro fica em api_audit_log
-- (conversation.devolvida_ao_agente) e em ponte_deskcomm.vigia_devolucao.

create table if not exists ponte_deskcomm.vigia_devolucao (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null,
  contact_id      uuid,
  ultima_msg_em   timestamptz,
  resultado       text not null,
  detalhe         text,
  criado_em       timestamptz not null default now()
);

-- Fila: conversas com pessoa no comando, última mensagem do atendente, sem resposta há 3 dias.
create or replace function public.ponte_deskcomm_conversas_para_devolver(p_dias integer default 3, p_limite integer default 50)
returns table (conversation_id uuid, organization_id uuid, contact_id uuid, ultima_em timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select v.id, v.organization_id, v.contact_id, ult.created_at
    from conversations v
    join contacts ct on ct.id = v.contact_id
    join lateral (
      select m.created_at, m.direction, m.sent_via from messages m
       where m.conversation_id = v.id and m.revoked_at is null
       order by m.created_at desc limit 1
    ) ult on true
   where v.status in ('open', 'pending', 'claimed', 'ai_handling')
     and (v.bot_silenced_until = 'infinity' or v.assignee_kind = 'user' or v.assigned_to_user_id is not null)
     and not coalesce(ct.ai_opt_out, false)
     and not coalesce(ct.is_anonymized, false)
     and ult.direction = 'outbound'
     and ult.sent_via in ('user', 'external_device')
     and ult.created_at < now() - make_interval(days => greatest(1, coalesce(p_dias, 3)))
   order by ult.created_at
   limit greatest(1, least(coalesce(p_limite, 50), 200));
$$;

create or replace function public.ponte_deskcomm_devolver_ao_agente(p_conversa uuid, p_dias integer default 3)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v record;
  ult record;
  v_status text;
begin
  select * into v from conversations where id = p_conversa for update;
  if not found then return 'sem_conversa'; end if;
  if v.status not in ('open', 'pending', 'claimed', 'ai_handling') then return 'status_nao_devolvivel'; end if;
  if not (v.bot_silenced_until = 'infinity' or v.assignee_kind = 'user' or v.assigned_to_user_id is not null) then
    return 'ja_com_o_agente';
  end if;

  -- Confere de novo: a conversa pode ter mudado entre a fila e aqui.
  select m.created_at, m.direction, m.sent_via into ult from messages m
   where m.conversation_id = v.id and m.revoked_at is null order by m.created_at desc limit 1;
  if ult is null or ult.direction <> 'outbound' or ult.sent_via not in ('user', 'external_device') then
    return 'ultima_nao_e_do_atendente';
  end if;
  if ult.created_at >= now() - make_interval(days => greatest(1, coalesce(p_dias, 3))) then
    return 'dentro_do_prazo';
  end if;

  if v.contact_id is not null then
    if exists (select 1 from contacts where id = v.contact_id and coalesce(ai_opt_out, false)) then
      return 'sempre_humano';
    end if;
    update contacts set force_human = false where id = v.contact_id and not coalesce(ai_opt_out, false);
  end if;

  if v.assigned_to_user_id is not null then
    perform fn_conversation_assign(v.organization_id, v.id, null, 'release', null, false, null, false);
  end if;

  v_status := case when v.status in ('open', 'pending', 'claimed', 'ai_handling') then 'ai_handling' else v.status end;
  update conversations
     set bot_silenced_until = null, last_handoff_at = null, last_handoff_reason = null,
         assignee_kind = 'ai', status = v_status, status_changed_at = now()
   where id = v.id and assigned_to_user_id is null;
  if not found then return 'dono_nao_soltou'; end if;

  if v.contact_id is not null then
    update contacts set ai_authorized_at = now(), ai_authorized_reason = 'automacao:devolucao_apos_prazo'
     where id = v.contact_id and not coalesce(ai_opt_out, false);
  end if;

  perform fn_passagem_devolvida(v.organization_id, v.id);

  perform emit_event('ai.handoff_resolved', 'conversation', v.id,
    jsonb_build_object('conversation_id', v.id, 'contact_id', v.contact_id, 'organization_id', v.organization_id),
    jsonb_build_object('source', 'ponte_deskcomm.vigia_devolucao'),
    v.organization_id);

  insert into api_audit_log (action, organization_id, resource_type, resource_id, metadata, bypassed_rls)
  values ('conversation.devolvida_ao_agente', v.organization_id, 'conversation', v.id,
          jsonb_build_object('regra', 'ultima mensagem do atendente sem resposta', 'dias', p_dias,
                             'ultima_mensagem_em', ult.created_at, 'origem', 'ponte_deskcomm.vigia_devolucao'),
          true);

  return 'devolvida';
end;
$$;

-- Rodada: devolve a fila inteira, registrando cada resultado.
create or replace function ponte_deskcomm.fn_rodar_vigia_devolucao(p_dias integer default 3)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  c record;
  r text;
  n integer := 0;
begin
  for c in select * from public.ponte_deskcomm_conversas_para_devolver(p_dias, 50) loop
    begin
      r := public.ponte_deskcomm_devolver_ao_agente(c.conversation_id, p_dias);
    exception when others then
      r := 'erro';
      insert into ponte_deskcomm.vigia_devolucao (conversation_id, contact_id, ultima_msg_em, resultado, detalhe)
      values (c.conversation_id, c.contact_id, c.ultima_em, r, left(sqlerrm, 500));
      continue;
    end;
    insert into ponte_deskcomm.vigia_devolucao (conversation_id, contact_id, ultima_msg_em, resultado)
    values (c.conversation_id, c.contact_id, c.ultima_em, r);
    if r = 'devolvida' then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.ponte_deskcomm_conversas_para_devolver(integer, integer) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_devolver_ao_agente(uuid, integer) from public, anon, authenticated;
revoke all on function ponte_deskcomm.fn_rodar_vigia_devolucao(integer) from public, anon, authenticated;
grant execute on function public.ponte_deskcomm_conversas_para_devolver(integer, integer) to service_role;
grant execute on function public.ponte_deskcomm_devolver_ao_agente(uuid, integer) to service_role;

select cron.unschedule('ponte-deskcomm-vigia-devolucao')
 where exists (select 1 from cron.job where jobname = 'ponte-deskcomm-vigia-devolucao');
select cron.schedule(
  'ponte-deskcomm-vigia-devolucao',
  '27 * * * *',
  $cron$ select ponte_deskcomm.fn_rodar_vigia_devolucao(3) $cron$
);
