-- Prioridade do rateio por franquia (regra do dono, 19/10/2026) e nome da conta na TT.
--
-- 1) Regra: prioridade 1 = UG. Depois os ASSINANTES em ordem decrescente de
--    franquia (a soma das franquias das UCs dele na usina; empate pela maior
--    UC), e dentro de cada assinante as UCs em ordem decrescente de franquia.
--    Ex. Bom Jesus II: Green Park (4.000, 2.600, 1.400, 1.200, 500), depois
--    Harmony (1.748), depois Paulo Vitor (250).
--    Até aqui a TT punha a UC nova no fim da fila (max + 1).
--
-- 2) fn_concluir_tt gravava o nome do cessionário em titular_conta. Esse campo
--    é o NOME DA CONTA no CRM ("Green Park BL 86"), não o titular; o titular
--    vive em titular_fatura_id. As duas UCs da Bom Jesus II apareciam como
--    "Bennaya", a titular da UG, em vez do condomínio e da Harmony.

-- ------------------------------------------------------------ reordenação
create or replace function public.fn_reordenar_prioridade_usina(p_usina_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    with base as (
        select c.id, c.tipo_unidade, c.subscriber_id, c.numero_uc,
               coalesce(c.franquia, 0) as f,
               -- Só as UCs que entram na lista contam para ordenar o assinante.
               (c.tipo_unidade = 'geradora'
                or c.status::text in ('ativo', 'em_atraso', 'aguardando_conexao')) as elegivel
          from consumer_units c
         where c.usina_id = p_usina_id
    ), assinante as (
        select subscriber_id, sum(f) as total, max(f) as maior
          from base where elegivel group by subscriber_id
    ), ordem as (
        select b.id,
               row_number() over (
                   order by (b.tipo_unidade = 'geradora') desc,
                            b.elegivel desc,
                            a.total desc nulls last, a.maior desc nulls last, b.subscriber_id,
                            b.f desc, b.numero_uc) as rn
          from base b
          left join assinante a on a.subscriber_id is not distinct from b.subscriber_id
    )
    update consumer_units c
       set prioridade = o.rn
      from ordem o
     where c.id = o.id
       and c.prioridade is distinct from o.rn;
end;
$$;

revoke all on function public.fn_reordenar_prioridade_usina(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ conclusão da TT
create or replace function public.fn_concluir_tt(
    p_tt_id          uuid,
    p_numero_uc_novo text default null,
    p_data           date default current_date
)
returns uuid  -- id da UC sombra do cedente
language plpgsql
security definer
set search_path = public
as $$
declare
    r          uc_transferencias_titularidade%rowtype;
    v_uc       consumer_units%rowtype;
    v_novo     text := nullif(btrim(coalesce(p_numero_uc_novo, '')), '');
    v_sombra   uuid;
    v_card     uuid;
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;

    select * into r from uc_transferencias_titularidade where id = p_tt_id for update;
    if not found then raise exception 'TT nao encontrada.'; end if;
    if r.status in ('concluida','recusada','cancelada') then
        raise exception 'TT ja encerrada (%).', r.status;
    end if;

    select * into v_uc from consumer_units where id = r.uc_id for update;
    if v_uc.usina_id is not null then
        raise exception 'A UC ja esta vinculada a uma usina; a TT nao pode concluir.';
    end if;

    insert into consumer_units
        (subscriber_id, numero_uc, titular_fatura_id, titular_conta, concessionaria,
         tipo_ligacao, tipo_unidade, address, dia_vencimento, dia_leitura,
         plano_assinatura_id, status, franquia, data_desligamento, desligamento_origem,
         acompanhar_conta_ate, usina_id)
    values
        (v_uc.subscriber_id, r.numero_uc_origem, r.cedente_id, v_uc.titular_conta, v_uc.concessionaria,
         v_uc.tipo_ligacao, v_uc.tipo_unidade, v_uc.address, v_uc.dia_vencimento, v_uc.dia_leitura,
         v_uc.plano_assinatura_id, 'desligado_por_tt', 0, p_data, 'concessionaria',
         p_data + 90, null)
    returning id into v_sombra;

    -- titular_conta (o nome da conta) fica como estava; muda só o titular.
    update consumer_units
       set numero_uc               = coalesce(v_novo, numero_uc),
           titular_fatura_id       = r.cessionario_id,
           numero_uc_anterior      = r.numero_uc_origem,
           titular_anterior_id     = r.cedente_id,
           data_troca_titularidade = p_data,
           status                  = 'aguardando_conexao'
     where id = v_uc.id;

    update consumer_units
       set usina_id = r.usina_destino_id, usina_destino_id = null
     where id = v_uc.id;

    perform fn_reordenar_prioridade_usina(r.usina_destino_id);

    update uc_transferencias_titularidade
       set status = 'concluida', numero_uc_destino = coalesce(v_novo, v_uc.numero_uc),
           data_conclusao = p_data, concluida_em = now(), atualizado_em = now(), erro = null
     where id = r.id;

    perform fn_tt_evento(r.id, 'concluida', jsonb_build_object(
        'numero_uc_origem', r.numero_uc_origem,
        'numero_uc_destino', coalesce(v_novo, v_uc.numero_uc),
        'uc_sombra_id', v_sombra));

    v_card := fn_gerar_lista_rateio_interno(r.usina_destino_id, 'tt');
    if v_card is not null then
        update uc_transferencias_titularidade set rateio_list_id = v_card where id = r.id;
        perform fn_tt_evento(r.id, 'lista_rateio', jsonb_build_object('rateio_id', v_card));
    else
        perform fn_tt_evento(r.id, 'lista_rateio_pendente',
            jsonb_build_object('motivo', 'Ja ha lista em processamento na distribuidora; o card novo nasce quando ela fechar.'));
    end if;

    return v_sombra;
end;
$$;
