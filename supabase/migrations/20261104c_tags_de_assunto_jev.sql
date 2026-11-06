-- Tags de ASSUNTO nos contatos do Deskcomm, decididas pelo Jev (04/11/2026).
--
-- O dono criou no Deskcomm as tags de produto (Arrendamento de areas, Cotas de
-- Usina, Energia por assinatura, Parceiro Power, Usinas de investimento e Gestão
-- de Energia) e pediu que as conversas sejam marcadas pelo assunto real. A Edge
-- Function `jev-tags-assunto` lê a conversa, pergunta ao Jev (uma pergunta `noul`
-- por tag, pode haver mais de uma) e acrescenta as tags em contacts.tags — a
-- caixa em que a equipe já marca à mão e que o filtro do funil lê.
--
-- Regras: só ACRESCENTA (nunca tira tag, nem a posta à mão); pula contato
-- `nao_lead`, anonimizado ou bloqueado; reclassifica quando chega mensagem nova
-- do cliente. O que foi acrescentado fica em ponte_deskcomm.tags_assunto, para
-- dá para desfazer.

create table if not exists ponte_deskcomm.tags_assunto (
  contact_id      uuid primary key,
  conversation_id uuid,
  tags_jev        text[] not null default '{}',
  adicionadas     text[] not null default '{}',
  probabilidades  jsonb,
  lido_ate        timestamptz,
  tentativas      integer not null default 0,
  ultimo_erro     text,
  gerado_em       timestamptz,
  criado_em       timestamptz not null default now()
);

-- Fila: contatos com mensagem do cliente posterior à última leitura.
create or replace function public.ponte_deskcomm_contatos_para_tag_assunto(
  p_limite integer default 20,
  p_contato uuid default null
)
returns table (contact_id uuid, organization_id uuid, conversation_id uuid,
               ultima_inbound timestamptz, tags text[])
language sql stable security definer
set search_path = public, pg_temp
as $$
  select ct.id, ct.organization_id, ult.conversation_id, ult.created_at, ct.tags
    from contacts ct
    join lateral (
      select m.conversation_id, m.created_at
        from messages m
       where m.contact_id = ct.id and m.direction = 'inbound'
       order by m.created_at desc limit 1
    ) ult on true
    left join ponte_deskcomm.tags_assunto t on t.contact_id = ct.id
   where coalesce(ct.is_anonymized, false) = false
     and coalesce(ct.is_blocked, false) = false
     and not ('nao_lead' = any (coalesce(ct.tags, '{}')))
     and (
       (p_contato is not null and ct.id = p_contato)
       or (p_contato is null
           and (t.contact_id is null or t.lido_ate is null or ult.created_at > t.lido_ate)
           and coalesce(t.tentativas, 0) < 3
           and ult.created_at < now() - interval '3 minutes')
     )
   order by ult.created_at desc
   limit greatest(1, least(coalesce(p_limite, 20), 50));
$$;

-- Grava: acrescenta as tags que faltam (minúsculas, como o Deskcomm guarda).
create or replace function public.ponte_deskcomm_gravar_tags_assunto(
  p_contato uuid,
  p_conversa uuid,
  p_tags text[],
  p_probs jsonb,
  p_lido_ate timestamptz
)
returns text[]
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_novas text[];
begin
  select coalesce(array_agg(distinct lower(btrim(t))), '{}') into v_novas
    from unnest(coalesce(p_tags, '{}')) t
   where btrim(t) <> ''
     and not (lower(btrim(t)) = any (coalesce((select tags from contacts where id = p_contato), '{}')));

  if cardinality(v_novas) > 0 then
    update contacts set tags = coalesce(tags, '{}') || v_novas where id = p_contato;
  end if;

  insert into ponte_deskcomm.tags_assunto as a
         (contact_id, conversation_id, tags_jev, adicionadas, probabilidades, lido_ate, gerado_em, tentativas, ultimo_erro)
  values (p_contato, p_conversa, coalesce(p_tags, '{}'), v_novas, p_probs, p_lido_ate, now(), 0, null)
  on conflict (contact_id) do update
     set conversation_id = excluded.conversation_id,
         tags_jev = excluded.tags_jev,
         adicionadas = (select array(select distinct x from unnest(a.adicionadas || excluded.adicionadas) x)),
         probabilidades = excluded.probabilidades,
         lido_ate = excluded.lido_ate,
         gerado_em = now(), tentativas = 0, ultimo_erro = null;

  return v_novas;
end;
$$;

create or replace function public.ponte_deskcomm_falha_tags_assunto(p_contato uuid, p_erro text)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into ponte_deskcomm.tags_assunto as a (contact_id, tentativas, ultimo_erro)
  values (p_contato, 1, left(p_erro, 500))
  on conflict (contact_id) do update
     set tentativas = a.tentativas + 1, ultimo_erro = excluded.ultimo_erro;
$$;

revoke all on function public.ponte_deskcomm_contatos_para_tag_assunto(integer, uuid) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_gravar_tags_assunto(uuid, uuid, text[], jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_falha_tags_assunto(uuid, text) from public, anon, authenticated;
grant execute on function public.ponte_deskcomm_contatos_para_tag_assunto(integer, uuid) to service_role;
grant execute on function public.ponte_deskcomm_gravar_tags_assunto(uuid, uuid, text[], jsonb, timestamptz) to service_role;
grant execute on function public.ponte_deskcomm_falha_tags_assunto(uuid, text) to service_role;

-- Mensagem nova do cliente: reclassifica a cada 10 min.
select cron.unschedule('ponte-deskcomm-tags-assunto')
 where exists (select 1 from cron.job where jobname = 'ponte-deskcomm-tags-assunto');
select cron.schedule(
  'ponte-deskcomm-tags-assunto',
  '*/10 * * * *',
  $cron$ select ponte_deskcomm.fn_chamar_funcao('jev-tags-assunto', '{"limite":20}'::jsonb) $cron$
);
