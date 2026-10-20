-- A tabela "Concessionaria" tem siglas de UF com espaco sobrando ("RS ", "SP ",
-- "GO "...): b2w_mcp_concessionaria passa a comparar com btrim. Mesmo corpo da
-- versao corrigida em 20261020c_bel_recepcao.sql (aplicada antes da correcao).
create or replace function public.b2w_mcp_concessionaria(p_cidade text, p_uf text)
returns jsonb language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select coalesce(
        (select jsonb_build_object(
                    'encontrada', true, 'cidade', btrim(c."Município"), 'uf', btrim(c."UF"),
                    'concessionaria', btrim(c."Concessionaria"),
                    'atende_assinatura', exists (select 1 from planos_distribuidoras pd
                                                  where pd.concessionaria = btrim(c."Concessionaria")))
           from "Concessionaria" c
          where ponte_deskcomm.fn_sem_acento(c."Município") = ponte_deskcomm.fn_sem_acento(p_cidade)
            and upper(btrim(c."UF")) = ponte_deskcomm.fn_uf(p_uf)
          limit 1),
        jsonb_build_object('encontrada', false, 'cidade', p_cidade, 'uf', ponte_deskcomm.fn_uf(p_uf),
                           'concessionaria', null, 'atende_assinatura', false))
$$;
revoke all on function public.b2w_mcp_concessionaria(text, text) from public, anon, authenticated;
grant execute on function public.b2w_mcp_concessionaria(text, text) to service_role;
