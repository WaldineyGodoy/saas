-- Card da lista de conversas com fu: e temp: (29/10/2026).
--
-- A lista do Deskcomm mostra só as duas primeiras etiquetas do CONTATO. O dono quer
-- ali o status no funil (fu:…) e o termômetro do Jev (temp:…); o agente, o anúncio e
-- as demais ficam no "+N" e na ficha do contato.
--
-- 1. O temp: era gravado só no card do funil (crm_leads.tags, pela jev-temperatura).
--    trg_ponte_card_temp_para_contato copia para o contato a temperatura do card
--    atualizado por último, trocando a anterior (um temp: por contato).
-- 2. Ordem: fu:, temp:, agente:, demais. Substitui 20261029b.
-- 4. Correção do fn_mensagem_agente (20261028e): "select tags" era ambíguo (contacts e
--    conversations têm tags) e o gatilho caía no exception desde 29/10 08:00, sem
--    atualizar o agente:. O envio nunca foi afetado. Recalcula o agente: de todos.
-- 3. Cores (paleta do Deskcomm): temp gelado azul-claro, frio índigo, morno amarelo,
--    quente âmbar, fechando vermelho. Para o agente não repetir o índigo do frio,
--    agente:<nome> passa a verde-água e agente:humano a cinza; o anúncio fica âmbar
--    (só aparece no +N e na ficha).

create or replace function ponte_deskcomm.fn_cor_da_etiqueta(p_tag text)
returns text
language sql
immutable
as $$
  select case
    when p_tag = 'agente:humano'    then '#6f6f6f'
    when p_tag like 'agente:%'      then '#00655a'
    when p_tag like 'anuncio:%'     then '#ffb224'
    when p_tag like 'fu:%'          then '#ab4aba'
    when p_tag = 'temp:gelado'      then '#0091ff'
    when p_tag = 'temp:frio'        then '#3e63dd'
    when p_tag = 'temp:morno'       then '#ffe629'
    when p_tag = 'temp:quente'      then '#ffb224'
    when p_tag = 'temp:fechando'    then '#cf3716'
  end
$$;

-- cores novas do agente: troca a que a rotina tinha posto (azul/verde-água antigos);
-- cor escolhida à mão (outro valor) continua
update organizations o
   set settings = jsonb_set(o.settings, '{tags}', (
         select jsonb_agg(case
                  when e ->> 'tag' like 'agente:%' and e ->> 'cor' in ('#3e63dd', '#00655a')
                  then jsonb_set(e, '{cor}', to_jsonb(ponte_deskcomm.fn_cor_da_etiqueta(e ->> 'tag')))
                  else e end)
           from jsonb_array_elements(o.settings -> 'tags') e))
 where jsonb_typeof(o.settings -> 'tags') = 'array';

create or replace function ponte_deskcomm.fn_ordem_das_etiquetas()
returns trigger
language plpgsql
as $$
declare
  v_ordenadas text[];
begin
  if new.tags is null or cardinality(new.tags) < 2 then return new; end if;
  v_ordenadas := array(
    select t from unnest(new.tags) with ordinality as u(t, i)
     order by case when t like 'fu:%' then 0 when t like 'temp:%' then 1 when t like 'agente:%' then 2 else 3 end, i);
  if v_ordenadas is distinct from new.tags then
    new.tags := v_ordenadas;
  end if;
  return new;
end $$;

-- temp: do card -> contato
create or replace function ponte_deskcomm.fn_temp_do_contato(p_contact uuid)
returns text
language sql
stable
as $$
  select t from crm_leads l, unnest(l.tags) t
   where l.contact_id = p_contact and t like 'temp:%'
   order by (l.status = 'open') desc, l.updated_at desc nulls last
   limit 1
$$;

create or replace function ponte_deskcomm.fn_card_temp_para_contato()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
  v_temp text;
begin
  if new.contact_id is null then return null; end if;
  v_temp := ponte_deskcomm.fn_temp_do_contato(new.contact_id);
  if v_temp is null then return null; end if;
  update contacts c
     set tags = array_append(array(select t from unnest(coalesce(c.tags, '{}')) t where t not like 'temp:%'), v_temp)
   where c.id = new.contact_id
     and not (v_temp = any(coalesce(c.tags, '{}')) and
              (select count(*) from unnest(coalesce(c.tags, '{}')) t where t like 'temp:%') = 1);
  return null;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_card_temp_para_contato', new.id, sqlstate, sqlerrm);
  return null;
end $$;

drop trigger if exists trg_ponte_card_temp_para_contato on public.crm_leads;
create trigger trg_ponte_card_temp_para_contato
  after insert or update of tags on public.crm_leads
  for each row
  when (new.contact_id is not null)
  execute function ponte_deskcomm.fn_card_temp_para_contato();

-- contatos que já existem: temp: do card e ordem nova
update contacts c
   set tags = array_append(array(select t from unnest(coalesce(c.tags, '{}')) t where t not like 'temp:%'),
                           ponte_deskcomm.fn_temp_do_contato(c.id))
 where ponte_deskcomm.fn_temp_do_contato(c.id) is not null;

update contacts set tags = tags
 where cardinality(tags) > 1
   and tags is distinct from array(
     select t from unnest(tags) with ordinality as u(t, i)
      order by case when t like 'fu:%' then 0 when t like 'temp:%' then 1 when t like 'agente:%' then 2 else 3 end, i);

-- 4. fn_mensagem_agente com c.tags
create or replace function ponte_deskcomm.fn_mensagem_agente()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $fn$
declare
  v_ator    text := nullif(new.metadata->>'ai_actor_id', '');
  v_rotulo  text;
  v_tags    text[];
begin
  if new.sent_via = 'user' then
    v_rotulo := 'humano';
  elsif v_ator ~ '^[0-9a-f-]{36}$' then
    select ponte_deskcomm.fn_rotulo_do_agente(a.name) into v_rotulo
      from ai_agents a
     where a.id = coalesce((select r.agent_id from ai_agent_runs r where r.id = v_ator::uuid), v_ator::uuid);
  end if;
  if v_rotulo is null then return null; end if;

  select c.tags into v_tags from contacts c
    join conversations v on v.contact_id = c.id
   where v.id = new.conversation_id;
  if not found or ('agente:' || v_rotulo) = any(coalesce(v_tags, '{}')) then return null; end if;

  update contacts c
     set tags = array_append(
                  array(select t from unnest(coalesce(c.tags, '{}')) t where t not like 'agente:%'),
                  'agente:' || v_rotulo)
    from conversations v
   where v.id = new.conversation_id and c.id = v.contact_id;
  return null;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_mensagem_agente', new.id, sqlstate, sqlerrm);
  return null;
end $fn$;

with ultima as (
  select distinct on (v.contact_id) v.contact_id, m.sent_via, m.metadata->>'ai_actor_id' as ator
    from messages m join conversations v on v.id = m.conversation_id
   where m.direction = 'outbound' and m.sent_via in ('ai', 'user')
   order by v.contact_id, m.created_at desc
), rotulo as (
  select u.contact_id,
         case when u.sent_via = 'user' then 'humano'
              else (select ponte_deskcomm.fn_rotulo_do_agente(a.name) from ai_agents a
                     where u.ator ~ '^[0-9a-f-]{36}$'
                       and a.id = coalesce((select r.agent_id from ai_agent_runs r where r.id = u.ator::uuid), u.ator::uuid))
         end as rotulo
    from ultima u
)
update contacts c
   set tags = array_append(array(select t from unnest(coalesce(c.tags, '{}')) t where t not like 'agente:%'), 'agente:' || r.rotulo)
  from rotulo r
 where r.contact_id = c.id and r.rotulo is not null
   and not (('agente:' || r.rotulo) = any(coalesce(c.tags, '{}')));

select ponte_deskcomm.colorir_etiquetas();
