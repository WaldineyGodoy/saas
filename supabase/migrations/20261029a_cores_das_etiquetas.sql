-- Cores das etiquetas da ponte no Deskcomm (29/10/2026).
--
-- O Deskcomm guarda a cor de cada etiqueta em organizations.settings.tags, uma
-- entrada {tag, cor} por NOME EXATO (fn_vocabulario_de_tags_operar, ação
-- definir_cor). As etiquetas que a ponte cria mudam de nome o tempo todo
-- (agente:leo, fu:bia:simulacao, anuncio:44050337-investimento...), então cada
-- nova nasceria sem cor. Esta rotina dá a cor da FAMÍLIA a toda etiqueta da ponte
-- que ainda não tem cor, e o cron repete a cada 10 minutos para as novas.
--
-- Cores da paleta do próprio Deskcomm (lib/tags/cor-da-etiqueta.ts), que já tem o
-- contraste do texto medido:
--   agente:<nome>  #3e63dd azul
--   agente:humano  #00655a verde-água (destaca o que está com a equipe)
--   anuncio:…      #ffb224 âmbar
--   fu:…           #ab4aba roxo
-- Cor escolhida na tela pelo dono é respeitada: só recebe cor a etiqueta sem cor.

create or replace function ponte_deskcomm.fn_cor_da_etiqueta(p_tag text)
returns text
language sql
immutable
as $$
  select case
    when p_tag = 'agente:humano'   then '#00655a'
    when p_tag like 'agente:%'     then '#3e63dd'
    when p_tag like 'anuncio:%'    then '#ffb224'
    when p_tag like 'fu:%'         then '#ab4aba'
  end
$$;

create or replace function ponte_deskcomm.colorir_etiquetas()
returns integer
language plpgsql
security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
  o        record;
  v_lista  jsonb;
  v_novas  jsonb;
  v_total  integer := 0;
begin
  for o in select id, settings from organizations loop
    v_lista := case when jsonb_typeof(o.settings -> 'tags') = 'array' then o.settings -> 'tags' else '[]'::jsonb end;

    -- etiquetas da ponte em uso nesta organização e sem cor no vocabulário
    with em_uso as (
      select distinct t from (
        select unnest(tags) t from contacts      where organization_id = o.id
        union all select unnest(tags) from conversations where organization_id = o.id
        union all select unnest(tags) from crm_leads     where organization_id = o.id
      ) s
      where ponte_deskcomm.fn_cor_da_etiqueta(t) is not null
    ), com_cor as (
      select lower(btrim(coalesce(e ->> 'tag', e #>> '{}'))) as chave
        from jsonb_array_elements(v_lista) e
       where nullif(e ->> 'cor', '') is not null
    )
    select coalesce(jsonb_agg(jsonb_build_object('tag', u.t, 'cor', ponte_deskcomm.fn_cor_da_etiqueta(u.t)) order by u.t), '[]'::jsonb)
      into v_novas
      from em_uso u
     where lower(u.t) not in (select chave from com_cor);

    if jsonb_array_length(v_novas) = 0 then continue; end if;

    -- tira a entrada sem cor da mesma etiqueta (string ou objeto) e acrescenta a colorida
    update organizations org
       set settings = jsonb_set(coalesce(org.settings, '{}'::jsonb), '{tags}',
             coalesce((select jsonb_agg(e) from jsonb_array_elements(
                         case when jsonb_typeof(org.settings -> 'tags') = 'array' then org.settings -> 'tags' else '[]'::jsonb end) e
                        where lower(btrim(coalesce(e ->> 'tag', e #>> '{}')))
                              not in (select lower(n ->> 'tag') from jsonb_array_elements(v_novas) n)), '[]'::jsonb)
             || v_novas, true)
     where org.id = o.id;

    v_total := v_total + jsonb_array_length(v_novas);
  end loop;
  return v_total;
exception when others then
  insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
  values ('colorir_etiquetas', null, sqlstate, sqlerrm);
  return -1;
end $$;

select cron.unschedule('ponte-deskcomm-cores') where exists (select 1 from cron.job where jobname = 'ponte-deskcomm-cores');
select cron.schedule('ponte-deskcomm-cores', '5-59/10 * * * *', $$select ponte_deskcomm.colorir_etiquetas()$$);

select ponte_deskcomm.colorir_etiquetas();
