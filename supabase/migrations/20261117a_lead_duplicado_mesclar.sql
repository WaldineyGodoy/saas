-- Lead duplicado: busca enquanto se digita + mesclagem.
--
-- Caso Kelia Mara de Sousa Pereira (17/11/2026): criaram um lead novo para quem
-- já tinha lead, com o mesmo telefone, e nada avisou. O modal do lead passa a
-- procurar, enquanto se digita, outro lead com o mesmo telefone, e-mail ou
-- CPF/CNPJ e a oferecer a mesclagem, mostrando os campos em conflito para o
-- usuário escolher qual valor prevalece.

-- Busca. SECURITY INVOKER de propósito: valem as políticas de `leads`, então o
-- originador só é avisado de duplicado entre os leads dele, e ninguém descobre
-- por aqui um lead que não poderia ver.
create or replace function public.fn_leads_duplicados(
    p_lead_id uuid,
    p_phone   text,
    p_email   text,
    p_cpf     text
) returns table (
    id            uuid,
    name          text,
    phone         text,
    email         text,
    cpf_cnpj      text,
    status        text,
    originator_id uuid,
    created_at    timestamptz,
    arquivado_em  timestamptz,
    chaves        text[]
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    with alvo as (
        select
            -- Telefone curto demais casaria por acaso; o 55 sai dos dois lados.
            case when length(public.fn_so_digitos(p_phone)) >= 10
                 then public.fn_telefone_br(p_phone) end                    as tel,
            nullif(lower(btrim(p_email)), '')                               as mail,
            case when length(public.fn_so_digitos(p_cpf)) in (11, 14)
                 then public.fn_so_digitos(p_cpf) end                       as doc
    )
    select l.id, l.name, l.phone, l.email, l.cpf_cnpj, l.status::text,
           l.originator_id, l.created_at, l.arquivado_em,
           array_remove(array[
               case when a.tel  is not null and public.fn_telefone_br(l.phone) = a.tel then 'telefone' end,
               case when a.mail is not null and lower(btrim(l.email)) = a.mail      then 'email' end,
               case when a.doc  is not null and public.fn_so_digitos(l.cpf_cnpj) = a.doc then 'cpf_cnpj' end
           ], null) as chaves
      from public.leads l, alvo a
     where (p_lead_id is null or l.id <> p_lead_id)
       and (   (a.tel  is not null and public.fn_telefone_br(l.phone) = a.tel)
            or (a.mail is not null and lower(btrim(l.email)) = a.mail)
            or (a.doc  is not null and public.fn_so_digitos(l.cpf_cnpj) = a.doc))
     order by l.created_at
     limit 5;
$$;

revoke all on function public.fn_leads_duplicados(uuid, text, text, text) from public, anon;
grant execute on function public.fn_leads_duplicados(uuid, text, text, text) to authenticated, service_role;


-- Mesclagem. `p_manter` fica; `p_remover` (opcional) some depois de passar
-- adiante tudo o que aponta para ele. `p_campos` traz o valor final que o
-- usuário escolheu para os campos de cadastro; o que não vier fica como está
-- no lead mantido.
--
-- Sem `p_remover`, é o caso do lead que ainda não foi salvo: os dados digitados
-- vão para o lead que já existia, e nenhum lead novo nasce.
--
-- SECURITY DEFINER porque precisa repontar tabelas que o usuário não edita
-- (ponte_deskcomm, assinaturas, histórico). A autorização é a mesma de editar
-- lead: papel interno, ou originador dono dos dois.
create or replace function public.fn_mesclar_leads(
    p_manter  uuid,
    p_remover uuid,
    p_campos  jsonb
) returns public.leads
language plpgsql
security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
declare
    v_manter  public.leads;
    v_remover public.leads;
    v_final   public.leads;
    v_uid     uuid := auth.uid();
    v_campos  jsonb := coalesce(p_campos, '{}'::jsonb);
begin
    if p_manter is null then
        raise exception 'Lead a manter não informado';
    end if;
    if p_remover = p_manter then
        raise exception 'Não dá para mesclar um lead com ele mesmo';
    end if;

    select * into v_manter from public.leads where id = p_manter for update;
    if not found then
        raise exception 'Lead % não encontrado', p_manter;
    end if;
    if p_remover is not null then
        select * into v_remover from public.leads where id = p_remover for update;
        if not found then
            raise exception 'Lead % não encontrado', p_remover;
        end if;
    end if;

    if not (public.fn_papel_interno()
            or (v_uid is not null
                and v_manter.originator_id = v_uid
                and (p_remover is null or v_remover.originator_id = v_uid))) then
        raise exception 'Sem permissão para mesclar estes leads';
    end if;

    -- Só campos de cadastro; id, datas de controle e vínculos não vêm de fora.
    v_campos := v_campos - array['id', 'created_at', 'updated_at', 'user_id',
                                 'retornos', 'ultima_visita_em', 'arquivado_em',
                                 'short_url', 'qualificacao', 'contract_terms',
                                 'address', 'calculated_discount'];
    v_final := jsonb_populate_record(v_manter, v_campos);

    if p_remover is not null then
        -- Duas contas de acesso não viram uma.
        if v_manter.user_id is not null and v_remover.user_id is not null
           and v_manter.user_id <> v_remover.user_id then
            raise exception 'Os dois leads têm login próprio; mescle pelo suporte';
        end if;
        v_final.user_id          := coalesce(v_manter.user_id, v_remover.user_id);
        v_final.created_at       := least(v_manter.created_at, v_remover.created_at);
        v_final.retornos         := coalesce(v_manter.retornos, 0) + coalesce(v_remover.retornos, 0);
        v_final.ultima_visita_em := greatest(v_manter.ultima_visita_em, v_remover.ultima_visita_em);
        v_final.short_url        := coalesce(v_manter.short_url, v_remover.short_url);
        v_final.contract_terms   := coalesce(v_manter.contract_terms, v_remover.contract_terms);
        v_final.qualificacao     := nullif(coalesce(v_remover.qualificacao, '{}'::jsonb)
                                           || coalesce(v_manter.qualificacao, '{}'::jsonb), '{}'::jsonb);
        -- Mescla deliberada: o lead resultante está em uso.
        v_final.arquivado_em     := case when v_manter.arquivado_em is not null
                                          and v_remover.arquivado_em is not null
                                         then v_manter.arquivado_em end;
        if not (v_campos ? 'tags') then
            v_final.tags := array(select distinct t
                                    from unnest(coalesce(v_manter.tags, '{}') || coalesce(v_remover.tags, '{}')) t);
        end if;
    end if;

    update public.leads set
        name                     = v_final.name,
        status                   = v_final.status,
        phone                    = v_final.phone,
        email                    = v_final.email,
        cpf_cnpj                 = v_final.cpf_cnpj,
        cep                      = v_final.cep,
        rua                      = v_final.rua,
        numero                   = v_final.numero,
        complemento              = v_final.complemento,
        bairro                   = v_final.bairro,
        cidade                   = v_final.cidade,
        uf                       = v_final.uf,
        concessionaria           = v_final.concessionaria,
        tarifa_concessionaria    = v_final.tarifa_concessionaria,
        consumo_kwh              = v_final.consumo_kwh,
        desconto_assinante       = v_final.desconto_assinante,
        originator_id            = v_final.originator_id,
        tags                     = v_final.tags,
        conta_lida               = v_final.conta_lida,
        plano_id                 = v_final.plano_id,
        indicador_assinante_id   = v_final.indicador_assinante_id,
        solicitante_assinante_id = v_final.solicitante_assinante_id,
        atendente                = v_final.atendente,
        user_id                  = v_final.user_id,
        created_at               = v_final.created_at,
        retornos                 = v_final.retornos,
        ultima_visita_em         = v_final.ultima_visita_em,
        short_url                = v_final.short_url,
        contract_terms           = v_final.contract_terms,
        qualificacao             = v_final.qualificacao,
        arquivado_em             = v_final.arquivado_em,
        updated_at               = now()
     where id = p_manter
    returning * into v_final;

    if p_remover is not null then
        -- Tudo o que aponta para o lead removido passa para o mantido.
        update public.subscribers          set lead_id = p_manter where lead_id = p_remover;
        update public.suppliers            set lead_id = p_manter where lead_id = p_remover;
        update public.lead_appointments    set lead_id = p_manter where lead_id = p_remover;
        update public.lead_visitas         set lead_id = p_manter where lead_id = p_remover;
        update public.lead_mensagens_envios set lead_id = p_manter where lead_id = p_remover;
        update public.signatures           set signer_id = p_manter
         where signer_type = 'lead' and signer_id = p_remover;
        update public.crm_history          set entity_id = p_manter
         where entity_type = 'lead' and entity_id = p_remover;
        update ponte_deskcomm.vinculos        set b2w_lead_id = p_manter where b2w_lead_id = p_remover;
        update ponte_deskcomm.adesoes         set b2w_lead_id = p_manter where b2w_lead_id = p_remover;
        update ponte_deskcomm.fila            set b2w_lead_id = p_manter where b2w_lead_id = p_remover;
        update ponte_deskcomm.resumo_passagem set b2w_lead_id = p_manter where b2w_lead_id = p_remover;
        insert into public.lead_visto (user_id, lead_id, visto_em)
        select user_id, p_manter, visto_em from public.lead_visto where lead_id = p_remover
        on conflict (user_id, lead_id) do nothing;

        delete from public.leads where id = p_remover;
    end if;

    -- O registro do lead removido fica no histórico do mantido: é por ele que
    -- se desfaz uma mescla feita por engano.
    insert into public.crm_history (entity_type, entity_id, content, metadata, created_by)
    values ('lead', p_manter,
            case when p_remover is null
                 then 'Dados de um cadastro novo incorporados a este lead (duplicado evitado)'
                 else 'Lead mesclado com ' || coalesce(v_remover.name, 'lead sem nome') end,
            jsonb_build_object('tipo', 'mescla_lead',
                               'lead_removido', case when p_remover is not null then to_jsonb(v_remover) end,
                               'lead_mantido_antes', to_jsonb(v_manter),
                               'campos_escolhidos', v_campos),
            v_uid);

    return v_final;
end;
$$;

revoke all on function public.fn_mesclar_leads(uuid, uuid, jsonb) from public, anon;
grant execute on function public.fn_mesclar_leads(uuid, uuid, jsonb) to authenticated, service_role;
