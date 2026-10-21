-- =====================================================================
-- Base do Agente Assinatura (spec docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md)
--   1. b2w_mcp_simular_assinatura: a conta do simulador do site + vaga + link.
--   2. ponte_deskcomm_assinatura_cobertura: dados da Fonte B.
--   3. Chaves assinatura_faq e assinatura_cobertura em ponte_deskcomm.fontes_base.
--   4. Gatilhos: plano, ligação plano-distribuidora ou tarifa mudou ->
--      deskcomm-base regenera a Fonte B (o cron de hora em hora é a rede).
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. Simulação
-- ---------------------------------------------------------------------------
create or replace function public.b2w_mcp_simular_assinatura(
    p_cidade text, p_uf text, p_consumo_kwh numeric, p_valor_reais numeric, p_telefone text)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_conc     text;
    v_tarifa   numeric;
    v_desc     numeric;
    v_kwh      numeric;
    v_conv     boolean := false;
    v_vaga     text;
    v_prev     date;
    v_tel      text := ponte_deskcomm.fn_telefone(p_telefone);
    v_lead     record;
    v_link     text := 'https://b2wenergia.com.br/';
begin
    select btrim(c."Concessionaria"), c."Tarifa Concessionaria"
      into v_conc, v_tarifa
      from "Concessionaria" c
     where ponte_deskcomm.fn_sem_acento(c."Município") = ponte_deskcomm.fn_sem_acento(p_cidade)
       and upper(btrim(c."UF")) = ponte_deskcomm.fn_uf(p_uf)
     limit 1;

    if v_conc is null or not exists (select 1 from planos_distribuidoras pd where pd.concessionaria = v_conc) then
        return jsonb_build_object('atende', false, 'concessionaria', v_conc, 'desconto_pct', null,
                                  'link_adesao', v_link);
    end if;

    v_desc := public.fn_desconto_plano_vigente(v_conc);

    if p_consumo_kwh is not null and p_consumo_kwh > 0 then
        v_kwh := p_consumo_kwh;
    elsif p_valor_reais is not null and p_valor_reais > 0 and v_tarifa > 0 then
        v_kwh := round(p_valor_reais / v_tarifa);
        v_conv := true;
    end if;

    -- Vaga: livre = geração estimada - franquias das UCs que ocupam a usina.
    if v_kwh is not null then
        with livre as (
            select u.status::text as status, u.previsao_entrega,
                   u.geracao_estimada_kwh - coalesce((
                       select sum(cu.franquia) from consumer_units cu
                        where cu.usina_id = u.id
                          and cu.status::text not in ('cancelado', 'cancelado_inadimplente', 'desconectado', 'desligado_por_tt')
                   ), 0) as kwh
              from usinas u
             where u.concessionaria = v_conc and u.geracao_estimada_kwh is not null
        )
        select case
                 when exists (select 1 from livre where status = 'gerando' and kwh >= v_kwh) then 'imediata'
                 when exists (select 1 from livre where status in ('pre_operacao', 'em_conexao') and kwh >= v_kwh) then 'pre_operacao'
                 else 'fila' end,
               (select min(previsao_entrega) from livre
                 where status in ('pre_operacao', 'em_conexao') and kwh >= v_kwh)
          into v_vaga, v_prev;
        if v_vaga <> 'pre_operacao' then v_prev := null; end if;
    end if;

    -- Link de adesão com a indicação do lead deste telefone.
    if v_tel is not null then
        select l.indicador_assinante_id, l.originator_id into v_lead
          from leads l
         where ponte_deskcomm.fn_telefone(l.phone) = v_tel and l.arquivado_em is null
         order by l.updated_at desc nulls last limit 1;
        if v_lead.indicador_assinante_id is not null then
            v_link := v_link || '?indicador=' || v_lead.indicador_assinante_id;
        elsif v_lead.originator_id is not null then
            v_link := v_link || '?id=' || v_lead.originator_id;
        end if;
    end if;

    return jsonb_build_object(
        'atende', true,
        'concessionaria', v_conc,
        'desconto_pct', v_desc,
        'tarifa', v_tarifa,
        'consumo_kwh', v_kwh,
        'consumo_convertido', v_conv,
        'economia_mensal', case when v_kwh is not null and v_desc is not null
                                then round(v_kwh * v_tarifa * v_desc / 100, 2) end,
        'economia_anual', case when v_kwh is not null and v_desc is not null
                               then round(v_kwh * v_tarifa * v_desc / 100 * 12, 2) end,
        'atinge_minimo', case when v_kwh is not null then v_kwh >= 150 end,
        'vaga', v_vaga,
        'previsao_operacao', v_prev,
        'link_adesao', v_link);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Fonte B
-- ---------------------------------------------------------------------------
create or replace function public.ponte_deskcomm_assinatura_cobertura()
returns table(concessionaria text, ufs text, desconto_pct numeric, tarifa numeric, credito_indicacao_100kwh numeric)
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
                 / 100, 2)
      from planos_distribuidoras d
      join planos_assinatura_energia p on p.id = d.plano_id and p.ativo and p.status = 'ativo'
     where public.fn_desconto_plano_vigente(d.concessionaria) is not null
     order by d.concessionaria
$$;

revoke all on function public.b2w_mcp_simular_assinatura(text, text, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_assinatura_cobertura() from public, anon, authenticated;
grant execute on function public.b2w_mcp_simular_assinatura(text, text, numeric, numeric, text) to service_role;
grant execute on function public.ponte_deskcomm_assinatura_cobertura() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Chaves da base: ponte_deskcomm_fonte_base_marcar só faz UPDATE.
-- ---------------------------------------------------------------------------
insert into ponte_deskcomm.fontes_base (chave) values ('assinatura_faq'), ('assinatura_cobertura')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Gatilhos (por instrução: a tabela de tarifas tem milhares de linhas)
-- ---------------------------------------------------------------------------
create or replace function ponte_deskcomm.fn_assinatura_para_base()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    perform ponte_deskcomm.fn_chamar_funcao('deskcomm-base', '{}'::jsonb);
    return null;
exception when others then
    -- Falha aqui nunca bloqueia a gravação; o cron corrige.
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('fn_assinatura_para_base', null, sqlstate, sqlerrm);
    return null;
end
$$;

drop trigger if exists trg_ponte_planos_assinatura_base on public.planos_assinatura_energia;
create trigger trg_ponte_planos_assinatura_base
    after insert or delete or update of desconto_assinante, ativo, status, recorrente_config
    on public.planos_assinatura_energia
    for each statement execute function ponte_deskcomm.fn_assinatura_para_base();

drop trigger if exists trg_ponte_planos_distribuidoras_base on public.planos_distribuidoras;
create trigger trg_ponte_planos_distribuidoras_base
    after insert or delete or update on public.planos_distribuidoras
    for each statement execute function ponte_deskcomm.fn_assinatura_para_base();

drop trigger if exists trg_ponte_tarifa_base on public."Concessionaria";
create trigger trg_ponte_tarifa_base
    after update of "Tarifa Concessionaria", "Concessionaria", "UF" on public."Concessionaria"
    for each statement execute function ponte_deskcomm.fn_assinatura_para_base();
