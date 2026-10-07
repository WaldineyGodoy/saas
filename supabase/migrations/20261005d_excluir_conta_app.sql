-- Excluir conta pelo app (exigencia da Apple para app com login).
--
-- Decisao do dono (05/10/2026), opcao (b): apaga o LOGIN e abre um pedido de
-- cancelamento da assinatura para a equipe. Contrato, UCs, faturas e
-- historico continuam (sao obrigacao contratual e fiscal; o cancelamento
-- segue o rito do contrato, pela equipe).
--
-- Fluxo: Edge Function excluir-conta-app (sessao do usuario)
--   -> fn_excluir_conta_app(uid): protocolo para a equipe + desvincula o login
--      de tudo que aponta para ele (FKs sem ON DELETE)
--   -> auth.admin.deleteUser(uid) (profiles cai em cascata)

create or replace function public.fn_excluir_conta_app(p_uid uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_papel text;
    v_sub record;
    v_sup record;
    v_protocolos int := 0;
begin
    select role::text into v_papel from profiles where id = p_uid;

    -- Equipe interna nao se exclui pelo app: perderia o acesso ao CRM.
    if v_papel in ('super_admin', 'admin', 'manager', 'coordinator') then
        return jsonb_build_object('ok', false, 'motivo', 'papel_interno');
    end if;
    -- Tabela legada com profile_id obrigatorio: so a equipe resolve.
    if exists (select 1 from originators where user_id = p_uid or profile_id = p_uid) then
        return jsonb_build_object('ok', false, 'motivo', 'originador_legado');
    end if;

    -- Assinante: pedido de cancelamento da assinatura para a equipe.
    for v_sub in
        select id, name from subscribers where user_id = p_uid or profile_id = p_uid
    loop
        insert into protocols (title, description, linked_entity_type, linked_entity_id)
        values ('Cancelamento de assinatura pedido pelo app',
                format('%s excluiu a conta no app B2W Energia e pediu o cancelamento da assinatura. '
                       'Tratar conforme o contrato (aviso previo, faturas em aberto, saida do rateio).', coalesce(v_sub.name, 'O assinante')),
                'assinante', v_sub.id);
        insert into crm_history (entity_type, entity_id, content, metadata)
        values ('subscriber', v_sub.id,
                'Conta do app excluida pelo assinante. Pedido de cancelamento da assinatura aberto em Protocolos.',
                jsonb_build_object('origem', 'fn_excluir_conta_app'));
        v_protocolos := v_protocolos + 1;
    end loop;

    -- Fornecedor: so registra; o contrato da usina segue com a equipe.
    for v_sup in
        select id, name from suppliers where user_id = p_uid or profile_id = p_uid
    loop
        insert into protocols (title, description, linked_entity_type, linked_entity_id)
        values ('Exclusao de conta no app (fornecedor)',
                format('%s excluiu a conta no app B2W Energia. Os contratos das usinas continuam; confirmar com o fornecedor.', coalesce(v_sup.name, 'O fornecedor')),
                'supplier', v_sup.id);
        insert into crm_history (entity_type, entity_id, content, metadata)
        values ('supplier', v_sup.id, 'Conta do app excluida pelo fornecedor.',
                jsonb_build_object('origem', 'fn_excluir_conta_app'));
        v_protocolos := v_protocolos + 1;
    end loop;

    -- Desvincula o login (FKs sem ON DELETE impediriam apagar o usuario).
    update subscribers set user_id = null where user_id = p_uid;
    update subscribers set profile_id = null where profile_id = p_uid;
    update suppliers set user_id = null where user_id = p_uid;
    update suppliers set profile_id = null where profile_id = p_uid;
    update crm_history set created_by = null where created_by = p_uid;
    update entity_history set created_by = null where created_by = p_uid;
    update consumer_units set updated_by = null where updated_by = p_uid;
    update financial_transfers set requested_by = null where requested_by = p_uid;
    update notification_triggers set created_by = null where created_by = p_uid;
    update lead_appointments set created_by = null where created_by = p_uid;
    update dispensas_ciclo set criado_por = null where criado_por = p_uid;
    update protocols set created_by = null where created_by = p_uid;
    update commissions set profile_id = null where profile_id = p_uid;
    update standalone_usinas set owner_id = null where owner_id = p_uid;
    update profiles set superior_id = null where superior_id = p_uid;

    return jsonb_build_object('ok', true, 'protocolos', v_protocolos);
end;
$$;

revoke all on function public.fn_excluir_conta_app(uuid) from public, anon, authenticated;
grant execute on function public.fn_excluir_conta_app(uuid) to service_role;
