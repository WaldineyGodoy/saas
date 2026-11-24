-- TT preventiva: a TT nao comeca se o CRM ja mostra conta de energia em atraso
-- do titular da UG (cessionario), da usina ou da propria UC. O portal da
-- concessionaria barra a TT por debito no CPF do cessionario; descobrir isso
-- so depois de o robo tentar custa uma rodada e deixa a UC em "Em Transf.".
--
-- Atraso, por regra do dono (24/11/2026), e so energy_bill_status:
--   inconsistente, contestada e atrasada. "Atrasada" nao e gravada hoje: a
--   conta vencida e nao paga fica como a_vencer com vencimento passado, entao
--   as duas formas contam. Parcelada NAO conta. inconsistente_pago e pago nao.
--
-- Se o CRM esta limpo e mesmo assim o portal barra por debito, a TT abre uma
-- AUDITORIA (colunas auditoria_* na propria TT): o CRM nao enxergou um debito
-- que existe, e o motivo precisa ser descoberto.

alter table public.uc_transferencias_titularidade
    add column if not exists auditoria_aberta_em timestamptz,
    add column if not exists auditoria_motivo text,
    add column if not exists auditoria_resolvida_em timestamptz,
    add column if not exists auditoria_nota text;

create or replace function public.fn_tt_contas_em_atraso(p_uc_id uuid, p_usina_id uuid)
returns table (
    origem text,
    uc_numero text,
    titular text,
    mes_referencia date,
    vencimento date,
    valor numeric,
    status text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
    v_tit_uc  uuid;
    v_tit_ug  uuid;
    v_doc_uc  text;
    v_doc_ug  text;
begin
    if not fn_tt_autorizado() then
        raise exception 'Sem permissao.';
    end if;

    select titular_fatura_id into v_tit_uc from consumer_units where id = p_uc_id;
    select titular_fatura_id into v_tit_ug
      from consumer_units
     where usina_id = p_usina_id and tipo_unidade = 'geradora'
     limit 1;

    select regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') into v_doc_uc from subscribers where id = v_tit_uc;
    select regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') into v_doc_ug from subscribers where id = v_tit_ug;

    return query
    select case when u.id = p_uc_id then 'UC da troca'
                when u.usina_id = p_usina_id then 'Usina'
                else 'Titular' end,
           u.numero_uc::text,
           s.name::text,
           i.mes_referencia::date,
           i.vencimento_concessionaria::date,
           i.valor_concessionaria::numeric,
           i.energy_bill_status::text
      from invoices i
      join consumer_units u on u.id = i.uc_id
      left join subscribers s on s.id = u.titular_fatura_id
     where (
              u.id = p_uc_id
           or u.usina_id = p_usina_id
           or (u.titular_fatura_id is not null and u.titular_fatura_id in (v_tit_uc, v_tit_ug))
           or (v_doc_ug <> '' and regexp_replace(coalesce(s.cpf_cnpj, ''), '\D', '', 'g') = v_doc_ug)
           or (v_doc_uc <> '' and regexp_replace(coalesce(s.cpf_cnpj, ''), '\D', '', 'g') = v_doc_uc)
           )
       and (
              i.energy_bill_status in ('inconsistente', 'contestada', 'atrasada', 'atrasado')
           or (i.energy_bill_status = 'a_vencer' and i.vencimento_concessionaria < current_date)
           )
     order by i.vencimento_concessionaria, u.numero_uc;
end;
$$;

grant execute on function public.fn_tt_contas_em_atraso(uuid, uuid) to authenticated;

-- fn_iniciar_tt: igual a anterior + a trava preventiva antes do INSERT.
create or replace function public.fn_iniciar_tt(p_uc_id uuid, p_usina_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_uc     consumer_units%rowtype;
    v_usina  usinas%rowtype;
    v_ug     consumer_units%rowtype;
    v_doc_a  text;
    v_doc_b  text;
    v_id     uuid;
    v_n      int;
    v_lista  text;
begin
    if not fn_tt_autorizado() then
        raise exception 'Sem permissao para iniciar troca de titularidade.';
    end if;

    select * into v_uc from consumer_units where id = p_uc_id for update;
    if not found then raise exception 'UC nao encontrada.'; end if;

    select * into v_usina from usinas where id = p_usina_id;
    if not found then raise exception 'Usina nao encontrada.'; end if;

    if v_usina.modalidade::text <> 'auto_consumo_remoto' then
        raise exception 'A usina % nao e de autoconsumo remoto: nao ha troca de titularidade a fazer, vincule a UC direto.', v_usina.name;
    end if;
    if coalesce(v_uc.tipo_unidade, '') = 'geradora' then
        raise exception 'A UC geradora nao passa por troca de titularidade para a propria usina.';
    end if;
    if v_uc.usina_id is not null then
        raise exception 'A UC ja esta vinculada a uma usina. Desvincule antes de iniciar a TT.';
    end if;
    if v_uc.titular_fatura_id is null then
        raise exception 'A UC % esta sem titular da conta de energia (o cedente). Informe-o antes de iniciar a TT.', v_uc.numero_uc;
    end if;
    if v_uc.numero_uc is null or btrim(v_uc.numero_uc) = '' then
        raise exception 'A UC esta sem numero.';
    end if;
    if v_uc.plano_assinatura_id is null then
        raise exception 'Escolha o plano de assinatura da UC antes de iniciar a TT (ela passa a Em Transf. de Titularidade).';
    end if;

    select * into v_ug
      from consumer_units
     where usina_id = p_usina_id and tipo_unidade = 'geradora'
     limit 1;
    if not found then
        raise exception 'A usina % nao tem unidade geradora cadastrada.', v_usina.name;
    end if;
    if v_ug.titular_fatura_id is null then
        raise exception 'A UG % da usina % esta sem titular da conta de energia.', v_ug.numero_uc, v_usina.name;
    end if;

    select regexp_replace(coalesce(cpf_cnpj,''), '\D', '', 'g') into v_doc_a from subscribers where id = v_uc.titular_fatura_id;
    select regexp_replace(coalesce(cpf_cnpj,''), '\D', '', 'g') into v_doc_b from subscribers where id = v_ug.titular_fatura_id;
    if v_uc.titular_fatura_id = v_ug.titular_fatura_id or (v_doc_a <> '' and v_doc_a = v_doc_b) then
        raise exception 'A UC ja esta no mesmo titular da UG: nao precisa de TT, vincule direto.';
    end if;

    -- Trava preventiva: conta em atraso no CRM barra antes de o robo tentar.
    select count(*),
           string_agg(format('UC %s (%s) %s, venc. %s, %s',
                             a.uc_numero, a.titular,
                             to_char(a.mes_referencia, 'MM/YYYY'),
                             to_char(a.vencimento, 'DD/MM/YYYY'), a.status),
                      '; ' order by a.vencimento)
      into v_n, v_lista
      from fn_tt_contas_em_atraso(p_uc_id, p_usina_id) a;
    if v_n > 0 then
        raise exception 'TT barrada: ha % conta(s) de energia em atraso no CRM para o titular da UG, a usina ou a UC. Regularize antes de iniciar. Contas: %', v_n, v_lista;
    end if;

    insert into uc_transferencias_titularidade
        (uc_id, usina_destino_id, ug_id, cedente_id, cessionario_id,
         numero_uc_origem, status_uc_anterior, criado_por)
    values
        (v_uc.id, p_usina_id, v_ug.id, v_uc.titular_fatura_id, v_ug.titular_fatura_id,
         v_uc.numero_uc, v_uc.status::text, auth.uid())
    returning id into v_id;

    update consumer_units
       set usina_destino_id = p_usina_id,
           status = 'em_transf_titularidade'
     where id = v_uc.id;

    perform fn_tt_evento(v_id, 'iniciada',
        jsonb_build_object('usina', v_usina.name, 'ug', v_ug.numero_uc, 'numero_uc_origem', v_uc.numero_uc));
    return v_id;
end;
$$;

-- fn_tt_registrar_debito: igual a anterior + auditoria quando o CRM nao tem
-- conta em atraso e o portal barrou mesmo assim.
create or replace function public.fn_tt_registrar_debito(p_tt_id uuid, p_valor numeric, p_detalhe text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_tt  uc_transferencias_titularidade%rowtype;
    v_n   int;
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;
    update uc_transferencias_titularidade
       set status = 'bloqueada_por_debito', debito_valor = p_valor, debito_detalhe = p_detalhe,
           debito_reportado_em = now(), atualizado_em = now()
     where id = p_tt_id and status in ('a_iniciar','em_execucao')
    returning * into v_tt;
    if not found then
        raise exception 'TT nao esta em um estado que aceite reportar debito.';
    end if;
    perform fn_tt_evento(p_tt_id, 'debito_reportado',
        jsonb_build_object('valor', p_valor, 'detalhe', p_detalhe));

    select count(*) into v_n from fn_tt_contas_em_atraso(v_tt.uc_id, v_tt.usina_destino_id);
    if v_n = 0 and v_tt.auditoria_aberta_em is null then
        update uc_transferencias_titularidade
           set auditoria_aberta_em = now(),
               auditoria_motivo = 'A concessionaria barrou a TT por debito, mas o CRM nao tem conta em atraso (inconsistente, contestada ou atrasada) do titular da UG, da usina ou da UC. Descobrir por que o CRM nao enxergou o debito.'
         where id = p_tt_id;
        perform fn_tt_evento(p_tt_id, 'auditoria_aberta',
            jsonb_build_object('detalhe', p_detalhe));
    end if;
end;
$$;

-- Encerra a auditoria com a conclusao (o que causou o debito e o que foi feito).
create or replace function public.fn_tt_auditoria_resolver(p_tt_id uuid, p_nota text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;
    if p_nota is null or btrim(p_nota) = '' then
        raise exception 'Descreva a conclusao da auditoria.';
    end if;
    update uc_transferencias_titularidade
       set auditoria_resolvida_em = now(), auditoria_nota = btrim(p_nota)
     where id = p_tt_id and auditoria_aberta_em is not null and auditoria_resolvida_em is null;
    if not found then
        raise exception 'Esta TT nao tem auditoria aberta.';
    end if;
    perform fn_tt_evento(p_tt_id, 'auditoria_resolvida', jsonb_build_object('nota', btrim(p_nota)));
end;
$$;

grant execute on function public.fn_tt_auditoria_resolver(uuid, text) to authenticated;
