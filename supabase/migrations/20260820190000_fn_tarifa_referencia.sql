-- Tarifa de referencia da tabela Concessionaria, resolvida sem depender do
-- municipio casar.
--
-- O problema: a UC so recebia tarifa pelo lookup de CEP -> Cod. Ibge. Se o
-- municipio nao estivesse na tabela, a UC ficava com tarifa ZERO para sempre
-- e o campo na tela e somente leitura, sem como corrigir pela interface.
-- No RN a tabela tem 143 dos 167 municipios; Sao Goncalo do Amarante e um dos
-- 24 que faltam, e e onde mora a UC 7030839166.
--
-- O detalhe que resolve: a tarifa da Cosern e IDENTICA nos 143 municipios do
-- RN (TE 0,39033 + TUSD 0,64164 = 1,032). Casar por municipio e precisao
-- falsa; o que identifica a tarifa e a distribuidora e o estado.
--
-- Ordem de resolucao:
--   1. Cod. Ibge, quando existir a linha do municipio;
--   2. concessionaria + UF, exigindo valor unico ou tomando a moda.
-- A coluna `origem` diz por qual caminho veio, para a tela poder mostrar.
--
-- Esta funcao NAO grava nada. A gravacao continua sendo decisao de quem edita
-- a UC -- o trigger que sincronizava sozinho foi removido em 08/08/2026 de
-- proposito, porque tornava o faturamento historico irreproduzivel.

create or replace function public.fn_tarifa_referencia(
    p_concessionaria text,
    p_uf text default null,
    p_ibge text default null
) returns table (
    te numeric,
    tusd numeric,
    tarifa_concessionaria numeric,
    fio_b numeric,
    desconto_assinante numeric,
    origem text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_municipio text;
    v_linhas int;
    v_distintos int;
begin
    -- 1. Municipio exato, quando a linha existir.
    if p_ibge is not null and length(trim(p_ibge)) > 0 then
        select c."TE", c."TUSD", c."Tarifa Concessionaria", c."Fio B", c."Desconto Assinante", c."Município"
          into te, tusd, tarifa_concessionaria, fio_b, desconto_assinante, v_municipio
          from public."Concessionaria" c
         where trim(c."Cod. Ibge") = trim(p_ibge)
         limit 1;

        if found and coalesce(tarifa_concessionaria, 0) > 0 then
            origem := format('municipio %s', v_municipio);
            return next;
            return;
        end if;
    end if;

    -- 2. Concessionaria (+ UF quando informada). Valor unico no grupo e o caso
    --    normal; havendo divergencia, usa a moda e avisa na origem.
    if p_concessionaria is null or length(trim(p_concessionaria)) = 0 then
        return;
    end if;

    select count(*), count(distinct c."Tarifa Concessionaria")
      into v_linhas, v_distintos
      from public."Concessionaria" c
     where upper(trim(c."Concessionaria")) = upper(trim(p_concessionaria))
       and (p_uf is null or length(trim(p_uf)) = 0 or upper(trim(c."UF")) = upper(trim(p_uf)))
       and coalesce(c."Tarifa Concessionaria", 0) > 0;

    if v_linhas = 0 then
        return;
    end if;

    select mode() within group (order by c."TE"),
           mode() within group (order by c."TUSD"),
           mode() within group (order by c."Tarifa Concessionaria"),
           mode() within group (order by c."Fio B"),
           mode() within group (order by c."Desconto Assinante")
      into te, tusd, tarifa_concessionaria, fio_b, desconto_assinante
      from public."Concessionaria" c
     where upper(trim(c."Concessionaria")) = upper(trim(p_concessionaria))
       and (p_uf is null or length(trim(p_uf)) = 0 or upper(trim(c."UF")) = upper(trim(p_uf)))
       and coalesce(c."Tarifa Concessionaria", 0) > 0;

    origem := case
        when v_distintos = 1 then format('%s/%s (valor unico em %s municipios)', trim(p_concessionaria), coalesce(nullif(trim(p_uf), ''), '?'), v_linhas)
        else format('%s/%s (ATENCAO: %s valores distintos em %s municipios, usando o mais frequente)', trim(p_concessionaria), coalesce(nullif(trim(p_uf), ''), '?'), v_distintos, v_linhas)
    end;
    return next;
end;
$$;

comment on function public.fn_tarifa_referencia(text, text, text) is
    'Tarifa de referencia da tabela Concessionaria. Resolve por Cod. Ibge e, na falta, por concessionaria + UF -- assim um municipio ausente da tabela nao deixa a UC com tarifa zero. Nao grava nada.';

revoke all on function public.fn_tarifa_referencia(text, text, text) from public, anon;
grant execute on function public.fn_tarifa_referencia(text, text, text) to authenticated, service_role;

-- Correcao pontual das 3 UCs ativas que estavam fora da referencia:
--   7030839166  0        -> 1,032   (municipio ausente da tabela)
--   7030004021  0,0099   -> 1,032   (te+tusd ja somavam 1,032; a coluna e que estava com lixo)
--   7030004129  0,9864   -> 1,032   (idem, valor velho)
-- Faturas ja emitidas guardam seus proprios valores e nao sao afetadas.
with alvo as (
  select cu.id, r.te, r.tusd, r.tarifa_concessionaria
    from public.consumer_units cu
    cross join lateral public.fn_tarifa_referencia(cu.concessionaria, cu.address->>'uf', cu.address->>'ibge') r
   where cu.status in ('ativo', 'em_atraso', 'em_transf_titularidade')
     and coalesce(cu.tarifa_concessionaria, 0) <> r.tarifa_concessionaria
)
update public.consumer_units cu
   set tarifa_concessionaria = a.tarifa_concessionaria,
       te = a.te,
       tusd = a.tusd,
       updated_at = now()
  from alvo a
 where cu.id = a.id;
