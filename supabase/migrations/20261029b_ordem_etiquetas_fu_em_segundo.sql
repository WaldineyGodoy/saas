-- Ordem das etiquetas do contato, v2 (29/10/2026).
--
-- A lista de conversas do Deskcomm mostra só as duas primeiras etiquetas. O dono
-- quer ver nelas o agente e o status no funil (fu:…): agente:, depois fu:, e o
-- resto (anuncio:… e as demais) no "+N". Substitui a ordem de 20261028f, que punha
-- o fu: por último.

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
     order by case when t like 'agente:%' then 0 when t like 'fu:%' then 1 else 2 end, i);
  if v_ordenadas is distinct from new.tags then
    new.tags := v_ordenadas;
  end if;
  return new;
end $$;

update contacts set tags = tags
 where cardinality(tags) > 1
   and tags is distinct from array(
     select t from unnest(tags) with ordinality as u(t, i)
      order by case when t like 'agente:%' then 0 when t like 'fu:%' then 1 else 2 end, i);
