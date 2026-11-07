-- Etiquetas do card na lista de conversas do Deskcomm (07/11/2026, pedido do dono).
--
-- A lista mostra só as DUAS primeiras etiquetas do contato. Antes: fu: e temp:.
-- Agora:
--   1ª  o INTERESSE (tag de assunto do Jev: "usinas de investimento",
--       "energia por assinatura"…; havendo várias, a do funil do card ativo, e as
--       outras vão para depois da temperatura);
--   2ª  a TEMPERATURA com a probabilidade, como no CRM: "morno 35%"
--       (antes "temp:morno"); pct de fechar em 30 dias, arredondado de 5 em 5,
--       porque o Deskcomm guarda cada etiqueta pelo nome exato;
--   depois a etiqueta de retomada SEM o prefixo ("bia:simulacao", antes
--       "fu:bia:simulacao"), os outros interesses, o agente: e as demais.
--
-- Sem prefixo, a ponte reconhece as suas etiquetas pelo formato:
--   eh_etiqueta_temp  ^(gelado|frio|morno|quente|fechando)( N%)?$  (e o temp: antigo)
--   eh_etiqueta_fu    ^<apelido>(:<grupo>)?$ com os apelidos de ponte_deskcomm.categorias
--                     (e o fu: antigo)
-- Os apelidos acompanham os nomes novos dos agentes (07/11): leo→luiza, davi→denise,
-- rafa→rafaela, sergio→simone, vinicius→viviane. Os fluxos de retomada disparam
-- pelo nome EXATO da etiqueta (trigger_config.params.segments), então os 29 fluxos,
-- as etiquetas dos contatos e o vocabulário de cores mudam juntos, nesta transação.

-- ── apelidos novos ─────────────────────────────────────────────────────────────
update ponte_deskcomm.categorias c
   set apelido = n.novo
  from (values ('leo','luiza'), ('davi','denise'), ('rafa','rafaela'),
               ('sergio','simone'), ('vinicius','viviane')) n(velho, novo)
 where c.apelido = n.velho;

-- ── reconhecer as etiquetas da ponte sem prefixo ────────────────────────────────
create or replace function ponte_deskcomm.eh_etiqueta_temp(p_tag text)
returns boolean language sql immutable as $$
  select p_tag like 'temp:%'
      or p_tag ~ '^(gelado|frio|morno|quente|fechando)( [0-9]{1,3}%)?$'
$$;

create or replace function ponte_deskcomm.eh_etiqueta_fu(p_tag text)
returns boolean language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select p_tag like 'fu:%'
      or exists (select 1 from ponte_deskcomm.categorias c
                  where p_tag = c.apelido or p_tag like c.apelido || ':%')
$$;

-- assunto (tags do jev-tags-assunto) → categoria do funil
create or replace function ponte_deskcomm.categoria_do_assunto(p_tag text)
returns text language sql immutable as $$
  select case p_tag
    when 'usinas de investimento' then 'usina_investimento'
    when 'cotas de usina'         then 'cotas'
    when 'energia por assinatura' then 'energia_assinatura'
    when 'arrendamento de areas'  then 'arrendamento'
    when 'gestão de energia'      then 'comercializadora'
    when 'parceiro power'         then 'parceiro'
  end
$$;

-- ── temperatura ────────────────────────────────────────────────────────────────
create or replace function ponte_deskcomm.fn_etiqueta_temp(p_faixa text, p_prob numeric)
returns text language sql immutable as $$
  select case
    when nullif(btrim(p_faixa), '') is null then null
    when p_prob is null then p_faixa
    else p_faixa || ' ' || greatest(0, least(100, round(p_prob * 20) * 5))::int || '%'
  end
$$;

create or replace function ponte_deskcomm.fn_temp_do_contato(p_contact uuid)
returns text language sql stable as $$
  select t from crm_leads l, unnest(l.tags) t
   where l.contact_id = p_contact and ponte_deskcomm.eh_etiqueta_temp(t)
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
     set tags = array_append(array(select t from unnest(coalesce(c.tags, '{}')) t
                                    where not ponte_deskcomm.eh_etiqueta_temp(t)), v_temp)
   where c.id = new.contact_id
     and not (v_temp = any(coalesce(c.tags, '{}')) and
              (select count(*) from unnest(coalesce(c.tags, '{}')) t where ponte_deskcomm.eh_etiqueta_temp(t)) = 1);
  return null;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_card_temp_para_contato', new.id, sqlstate, sqlerrm);
  return null;
end $$;

-- ── retomada (fu) ──────────────────────────────────────────────────────────────
create or replace function ponte_deskcomm.etiqueta_fu(p_contact uuid)
returns text
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
    with cards as (
        select l.tags, s.slug, c.entrada, c.apelido, l.created_at
          from crm_leads l
          join crm_stages s on s.id = l.stage_id
          join ponte_deskcomm.categorias c on c.pipeline_id = l.pipeline_id and c.ativa
         where l.contact_id = p_contact
    ), ativo as (
        select * from cards order by entrada asc, created_at desc limit 1
    )
    select case
        when exists (select 1 from contacts where id = p_contact and 'nao_lead' = any(tags)) then null
        when a.tags @> array['retomada_esgotada'] then null
        when ponte_deskcomm.grupo_fu_da_etapa(a.slug, a.entrada) is null then null
        when a.entrada then a.apelido
        else a.apelido || ':' || ponte_deskcomm.grupo_fu_da_etapa(a.slug, a.entrada)
    end
      from ativo a
$$;

create or replace function ponte_deskcomm.aplicar_etiqueta_fu(p_contact uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_nova  text := ponte_deskcomm.etiqueta_fu(p_contact);
    v_tags  text[];
    v_final text[];
begin
    select coalesce(tags, '{}') into v_tags from contacts where id = p_contact;
    if not found then return; end if;
    v_final := array(select t from unnest(v_tags) t where not ponte_deskcomm.eh_etiqueta_fu(t));
    if v_nova is not null then v_final := v_final || v_nova; end if;
    if v_final is distinct from v_tags then
        update contacts set tags = v_final where id = p_contact;
    end if;
end $$;

-- ── ordem: interesse, temperatura, retomada, agente, demais ────────────────────
create or replace function ponte_deskcomm.fn_ordem_das_etiquetas()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
  v_ordenadas text[];
  v_cat       text;
begin
  if new.tags is null or cardinality(new.tags) < 2 then return new; end if;
  -- funil do card ativo (o mesmo critério da etiqueta de retomada)
  select c.slug into v_cat
    from crm_leads l join ponte_deskcomm.categorias c on c.pipeline_id = l.pipeline_id and c.ativa
   where l.contact_id = new.id
   order by c.entrada asc, l.created_at desc
   limit 1;
  -- Só UM interesse vai na frente (o do funil do card ativo; sem ele, o primeiro):
  -- com dois interesses, a temperatura sairia da lista. Os outros vêm depois dela.
  v_ordenadas := array(
    with u as (
      select t, i, ponte_deskcomm.categoria_do_assunto(t) as cat
        from unnest(new.tags) with ordinality as x(t, i)
    ), principal as (
      select i from u where cat is not null
       order by (cat = v_cat) desc nulls last, i limit 1
    )
    select u.t from u
     order by case
                when u.i = (select i from principal)     then 0
                when ponte_deskcomm.eh_etiqueta_temp(u.t) then 1
                when ponte_deskcomm.eh_etiqueta_fu(u.t)   then 2
                when u.cat is not null                    then 3
                when u.t like 'agente:%'                  then 4
                else 5
              end, u.i);
  if v_ordenadas is distinct from new.tags then
    new.tags := v_ordenadas;
  end if;
  return new;
end $$;

-- ── cores ──────────────────────────────────────────────────────────────────────
create or replace function ponte_deskcomm.fn_cor_da_etiqueta(p_tag text)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when p_tag = 'agente:humano'                        then '#6f6f6f'
    when p_tag like 'agente:%'                          then '#00655a'
    when p_tag like 'anuncio:%'                         then '#ffb224'
    when p_tag like 'alerta:%'                          then '#e5484d'
    when p_tag ~ '^(temp:)?gelado( |$)'                 then '#0091ff'
    when p_tag ~ '^(temp:)?frio( |$)'                   then '#3e63dd'
    when p_tag ~ '^(temp:)?morno( |$)'                  then '#ffe629'
    when p_tag ~ '^(temp:)?quente( |$)'                 then '#ffb224'
    when p_tag ~ '^(temp:)?fechando( |$)'               then '#cf3716'
    when ponte_deskcomm.eh_etiqueta_fu(p_tag)           then '#ab4aba'
  end
$$;

-- ── dados: fluxos, cards e contatos no formato novo ────────────────────────────
create or replace function pg_temp.fu_novo(p_tag text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(regexp_replace(p_tag, '^fu:', ''),
                   '^leo(:|$)', 'luiza\1'),
                 '^davi(:|$)', 'denise\1'),
               '^rafa(:|$)', 'rafaela\1'),
             '^sergio(:|$)', 'simone\1'),
           '^vinicius(:|$)', 'viviane\1')
$$;

-- fluxos de retomada: segments ["fu:bia:inicio"] → ["bia:inicio"]
update followup_flow_pointers f
   set trigger_config = jsonb_set(f.trigger_config, '{params,segments}',
         (select jsonb_agg(to_jsonb(case when s like 'fu:%' then pg_temp.fu_novo(s) else s end))
            from jsonb_array_elements_text(f.trigger_config -> 'params' -> 'segments') s))
 where f.trigger_config -> 'params' -> 'segments' is not null
   and f.trigger_config::text like '%"fu:%';

-- cards: temp:<faixa> → "<faixa> N%" com a última avaliação do Jev
with novo as (
  select cl.id,
         ponte_deskcomm.fn_etiqueta_temp(l.qualificacao -> 'jev' ->> 'temperatura',
                                         (l.qualificacao -> 'jev' ->> 'probabilidade_fechamento_30d')::numeric) as etiqueta
    from ponte_deskcomm.vinculos v
    join crm_leads cl on cl.id = v.deskcomm_lead_id
    join leads l on l.id = v.b2w_lead_id
   where exists (select 1 from unnest(coalesce(cl.tags, '{}')) t where ponte_deskcomm.eh_etiqueta_temp(t))
     and l.qualificacao -> 'jev' ->> 'temperatura' is not null
)
update crm_leads cl
   set tags = array_append(array(select t from unnest(coalesce(cl.tags, '{}')) t
                                  where not ponte_deskcomm.eh_etiqueta_temp(t)), n.etiqueta)
  from novo n
 where cl.id = n.id and n.etiqueta is not null;

-- cards sem avaliação legível: só tira o prefixo
update crm_leads
   set tags = array(select case when t like 'temp:%' then substr(t, 6) else t end from unnest(tags) t)
 where exists (select 1 from unnest(coalesce(tags, '{}')) t where t like 'temp:%');

-- contatos: fu sem prefixo (apelido novo) e a temperatura do card
update contacts c
   set tags = array(select case when t like 'fu:%' then pg_temp.fu_novo(t) else t end
                      from unnest(c.tags) t
                     where not ponte_deskcomm.eh_etiqueta_temp(t))
              || coalesce(array[ponte_deskcomm.fn_temp_do_contato(c.id)], '{}')
 where exists (select 1 from unnest(coalesce(c.tags, '{}')) t
                where t like 'fu:%' or ponte_deskcomm.eh_etiqueta_temp(t));
update contacts set tags = array_remove(tags, null) where null = any(tags);

-- agente:<nome> com os nomes novos (o gatilho já gravaria na próxima mensagem)
update contacts c
   set tags = array(select case t when 'agente:leo' then 'agente:luiza' when 'agente:davi' then 'agente:denise'
                                  when 'agente:rafa' then 'agente:rafaela' when 'agente:sergio' then 'agente:simone'
                                  when 'agente:vinicius' then 'agente:viviane' else t end
                      from unnest(c.tags) t)
 where c.tags && array['agente:leo','agente:davi','agente:rafa','agente:sergio','agente:vinicius'];

-- todos os contatos na ordem nova (o gatilho BEFORE reordena ao tocar em tags)
update contacts set tags = tags where cardinality(tags) >= 2;

-- ── vocabulário: fora as entradas fu:/temp: velhas; cor nas novas ──────────────
update organizations o
   set settings = jsonb_set(o.settings, '{tags}', coalesce((
         select jsonb_agg(e)
           from jsonb_array_elements(o.settings -> 'tags') e
          where lower(btrim(coalesce(e ->> 'tag', e #>> '{}'))) not like 'fu:%'
            and lower(btrim(coalesce(e ->> 'tag', e #>> '{}'))) not like 'temp:%'), '[]'::jsonb))
 where jsonb_typeof(o.settings -> 'tags') = 'array';

select ponte_deskcomm.colorir_etiquetas();
