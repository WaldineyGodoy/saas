-- Rastreio do anuncio de origem (spec 2026-10-24-base-bel-recepcao-design.md §4).
--
-- O dado do anuncio chega no contato numa ATUALIZACAO de source_metadata, depois
-- da criacao; por isso o gatilho e AFTER INSERT OR UPDATE OF source_metadata.
-- O lead da B2W recebe o anuncio por gatilho em ponte_deskcomm.vinculos (cobre as
-- duas ordens: anuncio antes ou depois do lead) sem tocar em fn_card_para_lead.
-- Tudo falha aberto: erro vai para ponte_deskcomm.erros e o atendimento segue.

create table if not exists ponte_deskcomm.anuncios (
  ad_id             text primary key,
  slug              text not null unique,
  nome              text not null,
  titulo            text,
  corpo             text,
  url_origem        text,
  plataformas       text[] not null default '{}',
  publico           text not null default 'nao_definido'
                      check (publico in ('pf', 'pj', 'ambos', 'nao_definido')),
  categoria         text not null default 'energia_assinatura'
                      references ponte_deskcomm.categorias(slug),
  promessa          text,
  ativo             boolean not null default true,
  visto_primeiro_em timestamptz not null default now(),
  constraint anuncios_slug_formato check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$')
);
grant all on ponte_deskcomm.anuncios to service_role;

-- A plataforma real do anuncio. source_metadata->>'ad_platform' vale sempre 'meta_ads';
-- quem diz instagram/facebook e ad_raw.sourceApp, que as vezes vem vazio, e ai a URL.
create or replace function ponte_deskcomm.plataforma_do_anuncio(p_meta jsonb) returns text
language sql immutable
as $$
  select coalesce(
    nullif(p_meta->'ad_raw'->>'sourceApp', ''),
    case when p_meta->>'ad_source_url' ilike '%instagram.com%' then 'instagram'
         when p_meta->>'ad_source_url' ~* '(fb\.me|facebook\.com)' then 'facebook' end)
$$;

-- Copia o anuncio do contato para o(s) lead(s) vinculado(s), sem apagar o que ja
-- existe em qualificacao.deskcomm (origem, indicado_por, lista_espera...).
create or replace function ponte_deskcomm.copiar_anuncio_para_lead(p_contact uuid) returns void
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
declare
  v_ad record;
begin
  select a.ad_id, a.slug, a.titulo,
         ponte_deskcomm.plataforma_do_anuncio(c.source_metadata) as plataforma,
         c.source_metadata->>'ad_captured_at' as em
    into v_ad
    from contacts c
    join ponte_deskcomm.anuncios a on a.ad_id = c.source_metadata->>'ad_id'
   where c.id = p_contact and c.source = 'meta_ads';
  if not found then return; end if;

  update leads l
     set qualificacao = jsonb_set(
           coalesce(l.qualificacao, '{}'::jsonb),
           '{deskcomm}',
           coalesce(l.qualificacao->'deskcomm', '{}'::jsonb)
             || jsonb_build_object('anuncio', jsonb_build_object(
                  'ad_id', v_ad.ad_id, 'slug', v_ad.slug, 'titulo', v_ad.titulo,
                  'plataforma', v_ad.plataforma, 'em', v_ad.em)),
           true)
    from ponte_deskcomm.vinculos v
   where v.contact_id = p_contact and l.id = v.b2w_lead_id;
end $$;

-- Contato -> registra o anuncio, poe a etiqueta anuncio:<slug> e copia para o lead.
create or replace function ponte_deskcomm.fn_contato_anuncio() returns trigger
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
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

  insert into ponte_deskcomm.anuncios (ad_id, slug, nome, titulo, corpo, url_origem, plataformas)
  values (v_ad_id, 'anuncio-' || right(v_ad_id, 8),
          coalesce(nullif(new.source_metadata->>'ad_title', ''), 'Anúncio ' || right(v_ad_id, 8)),
          new.source_metadata->>'ad_title', new.source_metadata->>'ad_body',
          new.source_metadata->>'ad_source_url',
          case when v_plat is null then '{}'::text[] else array[v_plat] end)
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
end $$;

drop trigger if exists trg_ponte_contato_anuncio on public.contacts;
create trigger trg_ponte_contato_anuncio
  after insert or update of source_metadata on public.contacts
  for each row execute function ponte_deskcomm.fn_contato_anuncio();

-- Lead criado depois do anuncio: o vinculo novo dispara a copia.
create or replace function ponte_deskcomm.fn_vinculo_anuncio() returns trigger
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
begin
  perform ponte_deskcomm.copiar_anuncio_para_lead(new.contact_id);
  return null;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_vinculo_anuncio', new.deskcomm_lead_id, sqlstate, sqlerrm);
  return null;
end $$;

drop trigger if exists trg_ponte_vinculo_anuncio on ponte_deskcomm.vinculos;
create trigger trg_ponte_vinculo_anuncio
  after insert on ponte_deskcomm.vinculos
  for each row execute function ponte_deskcomm.fn_vinculo_anuncio();

-- O dono troca o slug provisorio por um nome de verdade: contatos e leads acompanham.
create or replace function ponte_deskcomm.fn_anuncio_renomeado() returns trigger
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
begin
  if new.slug is distinct from old.slug then
    update contacts set tags = array_replace(tags, 'anuncio:' || old.slug, 'anuncio:' || new.slug)
     where ('anuncio:' || old.slug) = any(tags);
    update leads set qualificacao = jsonb_set(qualificacao, '{deskcomm,anuncio,slug}', to_jsonb(new.slug))
     where qualificacao #>> '{deskcomm,anuncio,ad_id}' = new.ad_id;
  end if;
  return null;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('fn_anuncio_renomeado', null, sqlstate, sqlerrm);
  return null;
end $$;

drop trigger if exists trg_ponte_anuncio_renomeado on ponte_deskcomm.anuncios;
create trigger trg_ponte_anuncio_renomeado
  after update of slug on ponte_deskcomm.anuncios
  for each row execute function ponte_deskcomm.fn_anuncio_renomeado();

-- Mudou um anuncio (nome, promessa...): a deskcomm-base regera o documento de entradas.
-- Fora da lista de colunas de proposito: so ha regeracao quando algo editorial muda.
drop trigger if exists trg_ponte_anuncios_base on ponte_deskcomm.anuncios;
create trigger trg_ponte_anuncios_base
  after insert or update of nome, slug, titulo, publico, categoria, promessa, ativo, plataformas
  on ponte_deskcomm.anuncios
  for each statement execute function ponte_deskcomm.fn_assinatura_para_base();

-- Leitura para a Edge Function deskcomm-base (service role).
create or replace function public.ponte_deskcomm_anuncios_entradas()
returns table (slug text, nome text, titulo text, plataformas text[], publico text,
               categoria_nome text, promessa text)
language sql stable security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
  select a.slug, a.nome, a.titulo, a.plataformas, a.publico, c.nome, a.promessa
    from ponte_deskcomm.anuncios a
    join ponte_deskcomm.categorias c on c.slug = a.categoria
   where a.ativo
   order by a.visto_primeiro_em, a.slug
$$;
revoke execute on function public.ponte_deskcomm_anuncios_entradas() from public, anon, authenticated;
grant  execute on function public.ponte_deskcomm_anuncios_entradas() to service_role;

-- As duas fontes novas da Bel: a deskcomm-base so ATUALIZA estas linhas.
insert into ponte_deskcomm.fontes_base (chave)
values ('recepcao_faq'), ('recepcao_entradas')
on conflict (chave) do nothing;

-- Relatorio para o dono avaliar cada anuncio (acesso so pela service role).
create or replace view ponte_deskcomm.v_leads_por_anuncio as
select a.slug, a.nome, a.publico, c.nome as produto, a.promessa,
       count(distinct ct.id)                                                         as contatos,
       count(distinct l.id)                                                          as leads,
       count(distinct l.id) filter (where l.status = 'sem_interacao')                as sem_interacao,
       count(distinct l.id) filter (where l.status = 'simulacao')                    as simulacao,
       count(distinct l.id) filter (where l.status = 'negociacao')                   as negociacao,
       count(distinct l.id) filter (where l.status = 'reuniao_agendada')             as reuniao_agendada,
       count(distinct l.id) filter (where l.status = 'contrato_enviado')             as contrato_enviado,
       count(distinct l.id) filter (where l.status in ('ativacao', 'ativo', 'pago')) as fechados,
       count(distinct l.id) filter (where l.status = 'negocio_perdido')              as perdidos,
       count(distinct l.id) filter (where l.qualificacao #>> '{jev,temperatura}' in ('quente', 'fechando')) as quentes,
       round(avg((l.qualificacao #>> '{jev,probabilidade_fechamento_30d}')::numeric), 3) as prob_fechar_30d_media,
       min(ct.created_at)                                                            as primeiro_contato,
       max(ct.created_at)                                                            as ultimo_contato
  from ponte_deskcomm.anuncios a
  join ponte_deskcomm.categorias c on c.slug = a.categoria
  left join contacts ct on ('anuncio:' || a.slug) = any(ct.tags)
  left join ponte_deskcomm.vinculos v on v.contact_id = ct.id
  left join leads l on l.id = v.b2w_lead_id
 group by a.slug, a.nome, a.publico, c.nome, a.promessa, a.visto_primeiro_em
 order by a.visto_primeiro_em;
grant select on ponte_deskcomm.v_leads_por_anuncio to service_role;
