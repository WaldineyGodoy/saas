-- Leo (Usinas de Investimento): não perguntar se é pessoa física ou empresa (03/11/2026).
--
-- Caso de 03/11/2026: o lead perguntou do retorno e o Leo, duas vezes, perguntou
-- "seria como pessoa física ou empresa?". O dono: CPF ou CNPJ não muda a
-- rentabilidade; só serve para fazer o contrato, e isso é passo do consultor.
--
--   1. o passo 1 do roteiro deixa de pedir "pessoa física ou empresa";
--   2. regra nova depois do passo 4: não perguntar CPF/CNPJ; se o cliente perguntar se
--      pode investir como pessoa física, responder pela base.
--
-- Cirúrgico sobre a VERSÃO PUBLICADA, no formato de regra_impostos_so_se_perguntar.sql.
-- Idempotente: sem a frase antiga, não faz nada.

do $$
declare
    v_org    uuid := (select id from organizations order by created_at limit 1);
    a        record;
    v_versao uuid;
    v_prompt text;

    v_passo1_antigo constant text := '1. Entenda o interesse: usina inteira ou um valor menor; pessoa física ou empresa; cidade.';
    v_passo1_novo   constant text := '1. Entenda o interesse: usina inteira ou um valor menor; cidade.';
    v_passo4        constant text := '4. Qualifique: valor que pretende aportar, prazo e forma de pagamento (à vista, parcelado ou financiamento).';
    v_regra         constant text :=
        'Não pergunte se o cliente é pessoa física ou empresa (CPF ou CNPJ): isso não muda a rentabilidade nem o retorno, '
        'só serve para o contrato, e o contrato é com o consultor. Se o cliente perguntar se pode investir como pessoa física, responda pela base.';
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
      into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name like 'Leo%';
    if not found then raise exception 'Leo não encontrado'; end if;

    if position(v_passo1_antigo in a.system_prompt) = 0 then
        raise notice 'Leo já está atualizado';
        return;
    end if;

    v_prompt := replace(a.system_prompt, v_passo1_antigo, v_passo1_novo);
    if position(v_regra in v_prompt) = 0 then
        if position(v_passo4 in v_prompt) = 0 then raise exception 'passo 4 do Leo não encontrado'; end if;
        v_prompt := replace(v_prompt, v_passo4, v_passo4 || E'\n' || v_regra);
    end if;

    v_versao := gen_random_uuid();
    insert into ai_agent_versions (
        id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
        tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
        history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
        created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
        cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
        knowledge_source_ids, provisioning_origin, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms)
    select v_versao, v.organization_id, v.agent_id,
           (select max(version_number) + 1 from ai_agent_versions where agent_id = a.id),
           v_prompt, v.provider, v.model, v.credential_id, v.tool_ids,
           v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
           v.history_message_window, v.history_token_window, v.handoff_keywords, v.handoff_tool_enabled, 'draft',
           a.created_by, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
           v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
           v.knowledge_source_ids, v.provisioning_origin, v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
      from ai_agent_versions v where v.id = a.published_version_id;

    perform * from fn_publish_ai_agent_version(v_org, a.id, v_versao);

    insert into event_log (organization_id, event_type, entity_kind, payload)
    values (v_org, 'ai_agent.published', 'ai_agent',
            jsonb_build_object('agent_id', a.id, 'version_id', v_versao,
                               'previous_version_id', a.published_version_id,
                               'origem', 'regra_leo_pf_pj_so_no_fechamento'));
end $$;
