-- Grava os vinculos UC -> usina de uma vez, so com a diferenca.
--
-- Antes o modal da usina fazia "desvincula todas" e depois "vincula uma a
-- uma" em paralelo, ignorando o erro de cada chamada. Em 27/09/2026 isso
-- desvinculou 3 beneficiarias da UFV Bom Jesus II: a limpeza tirou tambem a
-- UG, e a trava de autoconsumo remoto (fn_uc_modalidade_e_titularidade)
-- recusou as beneficiarias que chegaram antes dela. A tela disse "sucesso".
--
-- Mesmo sem erro, o limpa-e-regrava passava toda UC por em_ativacao e de
-- volta: handle_uc_usina_link promovia aguardando_conexao e
-- em_transf_titularidade para ativo so porque alguem salvou a lista.
--
-- Aqui:
--   * tudo numa transacao so: falhou uma, nada muda;
--   * UC que ja estava na usina so tem a prioridade ajustada, sem passar
--     pelo desvinculo (o status dela nao e tocado);
--   * UG vincula antes das beneficiarias;
--   * UC vinculada a OUTRA usina e recusada, em vez de trocada em silencio.
--
-- SECURITY INVOKER de proposito: vale o mesmo RLS do update direto que o
-- modal fazia.

create or replace function public.fn_salvar_vinculos_usina(
    p_usina_id uuid,
    p_uc_ids   uuid[]
)
returns void
language plpgsql
set search_path = public
as $$
declare
    v_ids       uuid[] := coalesce(p_uc_ids, array[]::uuid[]);
    v_faltando  int;
    v_outra     text;
    r           record;
begin
    -- Serializa dois salvamentos da mesma usina.
    perform 1 from usinas where id = p_usina_id for update;
    if not found then
        raise exception 'Usina % nao encontrada.', p_usina_id;
    end if;

    if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
        raise exception 'Lista de UCs com item repetido.';
    end if;

    select count(*) into v_faltando
      from unnest(v_ids) x
     where not exists (select 1 from consumer_units c where c.id = x);
    if v_faltando > 0 then
        raise exception '% UC(s) da lista nao existem mais. Reabra a usina e tente de novo.', v_faltando;
    end if;

    select string_agg(c.numero_uc || ' (' || u.name || ')', ', ')
      into v_outra
      from consumer_units c
      join usinas u on u.id = c.usina_id
     where c.id = any(v_ids)
       and c.usina_id <> p_usina_id;
    if v_outra is not null then
        raise exception using
            errcode = 'check_violation',
            message = format('UC ja vinculada a outra usina: %s.', v_outra),
            hint    = 'Desvincule na outra usina antes. A tela pode estar desatualizada: reabra a usina.';
    end if;

    -- 1. Sai so quem foi removido da lista.
    update consumer_units
       set usina_id = null, prioridade = null
     where usina_id = p_usina_id
       and id <> all(v_ids);

    -- 2. Entra/reordena, UG primeiro. Linha que ja esta certa nao e escrita.
    for r in
        select o.id, o.pos
          from unnest(v_ids) with ordinality o(id, pos)
          join consumer_units c on c.id = o.id
         order by (c.tipo_unidade::text = 'geradora') desc, o.pos
    loop
        update consumer_units
           set usina_id = p_usina_id, prioridade = r.pos
         where id = r.id
           and (usina_id is distinct from p_usina_id or prioridade is distinct from r.pos::int);
    end loop;
end;
$$;

revoke all on function public.fn_salvar_vinculos_usina(uuid, uuid[]) from public, anon;
grant execute on function public.fn_salvar_vinculos_usina(uuid, uuid[]) to authenticated;
