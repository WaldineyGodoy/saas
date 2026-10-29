-- Ordem das etiquetas do contato (28/10/2026).
--
-- A lista de conversas do Deskcomm mostra só as duas primeiras etiquetas e esconde
-- o resto num "+N". O dono quer ver primeiro quem atende: agente:<nome> na frente,
-- depois anuncio:… e as demais, e fu:… por último. A ordem é mantida aqui, antes de
-- gravar, venha a etiqueta da ponte, do Deskcomm ou de um fluxo de retomada.
-- Dentro de cada grupo, a ordem em que as etiquetas chegaram é preservada.

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
     order by case when t like 'agente:%' then 0 when t like 'fu:%' then 2 else 1 end, i);
  if v_ordenadas is distinct from new.tags then
    new.tags := v_ordenadas;
  end if;
  return new;
end $$;

drop trigger if exists trg_ponte_ordem_das_etiquetas on public.contacts;
create trigger trg_ponte_ordem_das_etiquetas
  before insert or update of tags on public.contacts
  for each row execute function ponte_deskcomm.fn_ordem_das_etiquetas();

-- Contatos que já existem
update contacts set tags = tags
 where cardinality(tags) > 1
   and tags is distinct from array(
     select t from unnest(tags) with ordinality as u(t, i)
      order by case when t like 'agente:%' then 0 when t like 'fu:%' then 2 else 1 end, i);
