-- =====================================================================
-- Fonte B da Bia (Energia por Assinatura) passa a trazer o PERCENTUAL do
-- cashback de indicação, além do valor em R$ a cada 100 kWh (26/10/2026).
--
-- Por quê: a Bia deve citar "2% de cashback" ao apresentar a economia, e a
-- trava de promessas do Deskcomm só libera número que esteja na base.
-- O percentual vem do plano vigente (regras_multinivel.assinante_conect L1),
-- a mesma regra que fn_calcular_split_recompensa usa.
-- Muda o tipo de retorno: drop + create (só a deskcomm-base chama).
-- =====================================================================

drop function if exists public.ponte_deskcomm_assinatura_cobertura();

create function public.ponte_deskcomm_assinatura_cobertura()
returns table(concessionaria text, ufs text, desconto_pct numeric, tarifa numeric,
              credito_indicacao_100kwh numeric, pct_indicacao numeric)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select d.concessionaria,
           (select string_agg(distinct upper(btrim(c."UF")), ', ' order by upper(btrim(c."UF")))
              from "Concessionaria" c where btrim(c."Concessionaria") = d.concessionaria),
           public.fn_desconto_plano_vigente(d.concessionaria),
           (select max(c."Tarifa Concessionaria") from "Concessionaria" c
             where btrim(c."Concessionaria") = d.concessionaria),
           round((p.recorrente_config->'lastro_tarifario'->>'base_calculo_liquida')::numeric * 100
                 * coalesce((p.recorrente_config->'regras_multinivel'->'assinante_conect'->'niveis'->>'L1')::numeric, 0)
                 / 100, 2),
           coalesce((p.recorrente_config->'regras_multinivel'->'assinante_conect'->'niveis'->>'L1')::numeric, 0)
      from planos_distribuidoras d
      join planos_assinatura_energia p on p.id = d.plano_id and p.ativo and p.status = 'ativo'
     where public.fn_desconto_plano_vigente(d.concessionaria) is not null
     order by d.concessionaria
$$;

revoke all on function public.ponte_deskcomm_assinatura_cobertura() from public, anon, authenticated;
grant execute on function public.ponte_deskcomm_assinatura_cobertura() to service_role;
