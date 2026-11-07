-- Lead com menos de 3 mensagens entra GELADO (07/11/2026, regra do dono).
--
-- Antes, com 1 ou 2 mensagens do cliente o lead ficava fora da fila do Jev e o
-- card mostrava o interesse sem temperatura. Agora entra na fila desde a 1ª
-- mensagem; a jev-temperatura grava a faixa "gelado" com a probabilidade do Jev
-- ("gelado 10%") enquanto o cliente tiver menos de 3 mensagens, e na 3ª a fila o
-- reavalia com a faixa do próprio Jev.
--
-- A fila passa a devolver mensagens_cliente (a conversa inteira do contato).
-- Muda o tipo de retorno, por isso drop + create.

drop function if exists public.ponte_deskcomm_para_avaliar(integer);

create function public.ponte_deskcomm_para_avaliar(p_limite integer default 25)
returns table(deskcomm_lead_id uuid, b2w_lead_id uuid, contact_id uuid, organization_id uuid,
              categoria text, categoria_nome text, etapa text, ultima_entrada timestamptz,
              mensagens_cliente integer)
language sql
stable security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
  select v.deskcomm_lead_id, v.b2w_lead_id, v.contact_id, v.organization_id,
         v.categoria, cat.nome, st.name, conv.ultima, msgs.n
    from ponte_deskcomm.vinculos v
    join crm_leads cl on cl.id = v.deskcomm_lead_id and cl.status = 'open'
    join leads l on l.id = v.b2w_lead_id
    join ponte_deskcomm.categorias cat on cat.slug = v.categoria and cat.tag_b2w is not null
    left join crm_stages st on st.id = cl.stage_id
    join lateral (
      select max(c.last_inbound_at) as ultima from conversations c
       where c.contact_id = v.contact_id and c.organization_id = v.organization_id
    ) conv on conv.ultima is not null
    join lateral (
      select count(*)::int as n from messages m
       where m.contact_id = v.contact_id and m.organization_id = v.organization_id
         and m.direction = 'inbound'
    ) msgs on msgs.n >= 1
   where conv.ultima > coalesce((l.qualificacao->'jev'->>'avaliado_em')::timestamptz, '-infinity')
   order by conv.ultima desc
   limit greatest(1, least(p_limite, 100))
$$;

revoke all on function public.ponte_deskcomm_para_avaliar(integer) from public, anon, authenticated;
grant execute on function public.ponte_deskcomm_para_avaliar(integer) to service_role;
