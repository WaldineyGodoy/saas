-- Anúncios com categoria deduzida e nome legível + etiqueta do agente no contato (28/10/2026).
--
-- 1. Categoria do anúncio. fn_contato_anuncio cadastrava todo anúncio novo com a
--    categoria padrão da tabela (energia_assinatura), e ninguém ajustava depois: os
--    três anúncios de investimento ("R$ 300 mil: imóvel ou usina solar?", "R$ 330 mil:
--    imóvel ou fonte de renda?" e "Usina nova em fase de acabamento") ficaram como
--    Assinatura, e a Bel tratou o lead do anúncio de R$ 300 mil como assinatura
--    (perguntou pessoa física ou empresa). Agora a categoria sai do texto do anúncio
--    (fn_categoria_do_anuncio); sem pista, fica em triagem (Recepção).
--
-- 2. Nome do anúncio. O slug era 'anuncio-' + 8 últimos dígitos do ad_id, e a
--    etiqueta saía 'anuncio:anuncio-44050337'. Agora é '<8 dígitos>-<categoria>':
--    'anuncio:44050337-investimento'. O slug é recalculado sempre que a categoria
--    muda (trg_ponte_anuncio_slug), e o gatilho que já existia
--    (trg_ponte_anuncio_renomeado) troca a etiqueta nos contatos e o slug gravado
--    nos leads do CRM. A base da Bel ("Recepção: entradas") é regerada pelo
--    trg_ponte_anuncios_base.
--
-- 3. Etiqueta do agente. A tela do Deskcomm escreve só "IA" no balão, embora a
--    mensagem guarde o agente em metadata.ai_actor_id. O gatilho trg_ponte_mensagem_agente
--    mantém no contato UMA etiqueta 'agente:<nome>' (bel, bia, leo, davi, rafa,
--    sergio, helena, vinicius) com o último agente que respondeu, ou 'agente:humano'
--    quando quem respondeu foi a equipe pelo inbox. Ela aparece na lista e no chat,
--    como as etiquetas fu: e anuncio:.

-- ─── 1 e 2: categoria e slug ──────────────────────────────────────────────────

create or replace function ponte_deskcomm.fn_categoria_do_anuncio(p_titulo text, p_corpo text, p_nome text)
returns text
language sql
immutable
as $$
  select case
    when x ~ '\mcotas?\M'                               then 'cotas'
    when x ~ 'eletroposto|carro el[eé]tric|recarga'      then 'eletropostos'
    when x ~ 'arrend|terreno'                            then 'arrendamento'
    when x ~ '\mvagas?\M'                                then 'vagas'
    -- "energia por assinatura" pode citar renda/investimento no corpo: vence antes
    when x ~ 'assinatura|conta de luz'                   then 'energia_assinatura'
    when x ~ 'invest|renda|rentabil|patrim'              then 'usina_investimento'
    when x ~ 'desconto|fatura|econom|efici'              then 'energia_assinatura'
    when x ~ 'usina|kwp'                                 then 'usina_investimento'
    else 'triagem'
  end
  from (select lower(coalesce(p_titulo, '') || ' ' || coalesce(p_corpo, '') || ' ' || coalesce(p_nome, '')) as x) t
$$;

-- Rótulo curto da categoria no nome do anúncio (e na etiqueta do contato).
create or replace function ponte_deskcomm.fn_rotulo_da_categoria(p_categoria text)
returns text
language sql
immutable
as $$
  select case p_categoria
    when 'energia_assinatura' then 'assinatura'
    when 'usina_investimento' then 'investimento'
    when 'comercializadora'   then 'gestora'
    when 'triagem'            then 'adefinir'
    else p_categoria
  end
$$;

create or replace function ponte_deskcomm.fn_anuncio_slug()
returns trigger
language plpgsql
as $$
begin
  new.slug := right(new.ad_id, 8) || '-' || ponte_deskcomm.fn_rotulo_da_categoria(new.categoria);
  return new;
end $$;

drop trigger if exists trg_ponte_anuncio_slug on ponte_deskcomm.anuncios;
create trigger trg_ponte_anuncio_slug
  before insert or update of categoria on ponte_deskcomm.anuncios
  for each row execute function ponte_deskcomm.fn_anuncio_slug();

-- "after update OF slug" só dispara quando o slug está no SET; o slug agora muda
-- pelo gatilho acima quando a CATEGORIA muda. fn_anuncio_renomeado já compara
-- old.slug com new.slug, então basta disparar em qualquer update.
drop trigger if exists trg_ponte_anuncio_renomeado on ponte_deskcomm.anuncios;
create trigger trg_ponte_anuncio_renomeado
  after update on ponte_deskcomm.anuncios
  for each row execute function ponte_deskcomm.fn_anuncio_renomeado();

alter table ponte_deskcomm.anuncios alter column categoria set default 'triagem';

create or replace function ponte_deskcomm.fn_contato_anuncio()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $function$
declare
  v_ad_id text := nullif(new.source_metadata->>'ad_id', '');
  v_plat  text := ponte_deskcomm.plataforma_do_anuncio(new.source_metadata);
  v_slug  text;
begin
  if new.source is distinct from 'meta_ads' or v_ad_id is null then return null; end if;
  if coalesce(new.is_personal, false) or coalesce(new.is_anonymized, false)
     or coalesce(new.is_blocked, false) then
    return null;
  end if;

  -- o slug sai de trg_ponte_anuncio_slug; o valor aqui é só para o insert valer
  insert into ponte_deskcomm.anuncios (ad_id, slug, nome, titulo, corpo, url_origem, plataformas, categoria)
  values (v_ad_id, right(v_ad_id, 8),
          coalesce(nullif(new.source_metadata->>'ad_title', ''), 'Anúncio ' || right(v_ad_id, 8)),
          new.source_metadata->>'ad_title', new.source_metadata->>'ad_body',
          new.source_metadata->>'ad_source_url',
          case when v_plat is null then '{}'::text[] else array[v_plat] end,
          ponte_deskcomm.fn_categoria_do_anuncio(new.source_metadata->>'ad_title',
                                                 new.source_metadata->>'ad_body', null))
  on conflict (ad_id) do update
     set plataformas = (select array_agg(distinct p order by p)
                          from unnest(ponte_deskcomm.anuncios.plataformas || excluded.plataformas) p)
   where not (ponte_deskcomm.anuncios.plataformas @> excluded.plataformas);

  select slug into v_slug from ponte_deskcomm.anuncios where ad_id = v_ad_id;

  if not (('anuncio:' || v_slug) = any(coalesce(new.tags, '{}'))) then
    update contacts set tags = array_append(coalesce(tags, '{}'), 'anuncio:' || v_slug)
     where id = new.id;
  end if;

  perform ponte_deskcomm.copiar_anuncio_para_lead(new.id);
  return null;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_contato_anuncio', new.id, sqlstate, sqlerrm);
  return null;
end $function$;

-- Anúncios já cadastrados: categoria pelo texto e slug novo (o gatilho de
-- renomeação troca as etiquetas e o slug nos leads).
update ponte_deskcomm.anuncios
   set categoria = ponte_deskcomm.fn_categoria_do_anuncio(titulo, corpo, nome);

-- ─── 3: etiqueta do agente ────────────────────────────────────────────────────

-- 'Sérgio · Áreas de Arrendamento' -> 'sergio'
create or replace function ponte_deskcomm.fn_rotulo_do_agente(p_nome text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(
           translate(lower(btrim(split_part(coalesce(p_nome, ''), '·', 1))),
                     'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
           '[^a-z0-9]+', '', 'g'), '')
$$;

create or replace function ponte_deskcomm.fn_mensagem_agente()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
  v_ator    text := nullif(new.metadata->>'ai_actor_id', '');
  v_rotulo  text;
  v_tags    text[];
begin
  if new.sent_via = 'user' then
    v_rotulo := 'humano';
  elsif v_ator ~ '^[0-9a-f-]{36}$' then
    -- ai_actor_id é o agente (API de mensagens) ou a execução (finalize do runtime)
    select ponte_deskcomm.fn_rotulo_do_agente(a.name) into v_rotulo
      from ai_agents a
     where a.id = coalesce((select r.agent_id from ai_agent_runs r where r.id = v_ator::uuid), v_ator::uuid);
  end if;
  if v_rotulo is null then return null; end if;

  select tags into v_tags from contacts c
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
end $$;

drop trigger if exists trg_ponte_mensagem_agente on public.messages;
create trigger trg_ponte_mensagem_agente
  after insert on public.messages
  for each row
  when (new.direction = 'outbound' and new.sent_via in ('ai', 'user'))
  execute function ponte_deskcomm.fn_mensagem_agente();

-- Conversas que já existem: etiqueta com quem respondeu por último.
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
   set tags = array_append(
                array(select t from unnest(coalesce(c.tags, '{}')) t where t not like 'agente:%'),
                'agente:' || r.rotulo)
  from rotulo r
 where r.contact_id = c.id and r.rotulo is not null
   and not (('agente:' || r.rotulo) = any(coalesce(c.tags, '{}')));
