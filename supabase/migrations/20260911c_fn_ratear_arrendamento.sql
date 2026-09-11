-- Task 3 do plano 2026-09-11-arrendamento-repasse.
--
-- A aritmetica do rateio num lugar so'. Quem chama (reconhecimento, tela,
-- relatorio) nao recalcula: pergunta.
--
-- Ordem obrigatoria, e ela importa: fixos primeiro, percentuais sobre o que
-- sobrar. Aplicar percentual sobre o total e depois somar o fixo estoura o
-- aluguel. O residuo de centavo vai para um beneficiario designado, senao
-- duas divisoes arredondadas produzem centavo que nao vai para ninguem.
--
-- A funcao recusa em vez de assumir. Rateio que nao fecha com o aluguel e'
-- cadastro errado, e descobrir isso na hora de pagar e' tarde.

create or replace function public.fn_ratear_arrendamento(
    p_leased_area_id uuid,
    p_valor          numeric
)
returns table (beneficiary_id uuid, tipo text, valor numeric)
language plpgsql
stable
set search_path to 'public'
as $$
declare
    v_soma_fixo  numeric;
    v_soma_pct   numeric;
    v_resto      numeric;
    v_ativos     integer;
    v_residuo_id uuid;
begin
    if p_valor is null then
        raise exception 'fn_ratear_arrendamento: aluguel nulo nao rateia (area %). Dado faltante nao vira zero.', p_leased_area_id;
    end if;

    select count(*) into v_ativos
      from leased_area_beneficiaries
     where leased_area_id = p_leased_area_id and ativo;

    if v_ativos = 0 then
        raise exception 'Area % nao tem beneficiario ativo: sem quem receber, nao ha rateio', p_leased_area_id;
    end if;

    -- O coalesce aqui nao viola a regra de "faltante nao vira zero":
    -- rateio_valor e' NOT NULL, e o filter pode simplesmente nao casar linha
    -- nenhuma. Ausencia de parcela fixa e' zero de fato, nao dado perdido.
    select coalesce(sum(rateio_valor) filter (where rateio_tipo = 'fixo'), 0),
           coalesce(sum(rateio_valor) filter (where rateio_tipo = 'percentual'), 0)
      into v_soma_fixo, v_soma_pct
      from leased_area_beneficiaries
     where leased_area_id = p_leased_area_id and ativo;

    if v_soma_fixo > p_valor then
        raise exception 'Rateio da area %: parcelas fixas somam % e o aluguel e apenas %', p_leased_area_id, v_soma_fixo, p_valor;
    end if;

    v_resto := p_valor - v_soma_fixo;

    if v_soma_pct > 0 and round(v_soma_pct, 6) <> 100 then
        raise exception 'Rateio da area %: percentuais somam %, e precisam somar exatamente 100', p_leased_area_id, v_soma_pct;
    end if;

    -- Sem percentual e com sobra, a diferenca nao teria destino. Com a casa
    -- ocupando uma linha do rateio, a soma fecha em 100 sempre -- margem
    -- implicita e' justamente o que esta funcao existe para eliminar.
    if v_soma_pct = 0 and v_resto <> 0 then
        raise exception 'Rateio da area %: sobram % sem destino depois das parcelas fixas', p_leased_area_id, v_resto;
    end if;

    -- Quem absorve o centavo. O dono da terra mais antigo, porque a casa e a
    -- imobiliaria recebem valor combinado e o proprietario recebe o que
    -- sobrou do combinado.
    -- Alias obrigatorio: os parametros de saida (tipo, valor) colidem com as
    -- colunas da tabela, e o plpgsql resolve a favor da variavel.
    select b.id into v_residuo_id
      from leased_area_beneficiaries b
     where b.leased_area_id = p_leased_area_id and b.ativo and b.tipo = 'terceiro'
     order by b.created_at, b.id
     limit 1;

    if v_residuo_id is null then
        raise exception 'Area % nao tem beneficiario do tipo terceiro: nao existe dono da terra para receber o residuo', p_leased_area_id;
    end if;

    return query
    with base as (
        select b.id, b.tipo,
               case when b.rateio_tipo = 'fixo'
                    then round(b.rateio_valor, 2)
                    else round(v_resto * b.rateio_valor / 100.0, 2)
               end as valor
          from leased_area_beneficiaries b
         where b.leased_area_id = p_leased_area_id and b.ativo
    ),
    total as (select sum(base.valor) as alocado from base)
    select base.id,
           base.tipo,
           base.valor + case when base.id = v_residuo_id
                             then p_valor - (select total.alocado from total)
                             else 0 end
      from base;
end;
$$;

revoke execute on function public.fn_ratear_arrendamento(uuid, numeric) from public, anon;
grant  execute on function public.fn_ratear_arrendamento(uuid, numeric) to authenticated, service_role;
