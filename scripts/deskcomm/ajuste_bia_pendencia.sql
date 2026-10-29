-- Pendência de adesão na Bia (Energia por Assinatura), 26/10/2026.
-- No primeiro teste real a Bia avisou o cliente da pendência mas não moveu o
-- negócio para "Pendência de adesão". Troca a linha de pendências do passo 5
-- (ajuste_bia_adesao.sql) por uma com a ordem das ações explícita.
-- Cirúrgico sobre a versão publicada (preserva a persona). Idempotente.

do $$
declare
    v_org     uuid := (select id from organizations order by created_at limit 1);
    a         record;
    v_versao  uuid := gen_random_uuid();
    v_antiga  constant text := '- Pendências (titular_divergente, titular_cnpj, cpf_diferente_conta, cpf_ja_cadastrado, falha_criacao) ou o cliente mencionar mais de uma conta/unidade: mova o negócio para "Pendência de adesão" (crm_move_lead_stage), passe para humano (crm_request_human_handoff) com o motivo e diga que a equipe vai dar sequência.';
    v_nova    constant text := '- Pendências (titular_divergente, titular_cnpj, cpf_diferente_conta, cpf_ja_cadastrado, falha_criacao) ou o cliente mencionar mais de uma conta/unidade: no MESMO turno e nesta ordem, (1) mova o negócio para a etapa "Pendência de adesão" com crm_move_lead_stage — obrigatório, nunca pule; (2) passe para humano com crm_request_human_handoff informando o código da pendência; (3) só então diga ao cliente que a equipe vai dar sequência, sem citar um motivo diferente do código (cpf_ja_cadastrado = "seu CPF já tem um cadastro com a gente", titular_* = titularidade da conta).';
begin
    select ag.id, ag.created_by, ag.published_version_id, v.system_prompt into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name = 'Bia · Energia por Assinatura';
    if a.id is null then raise exception 'Bia nao encontrada'; end if;

    if position('nunca pule' in a.system_prompt) > 0 then
        raise notice 'Bia já está com a ordem da pendência'; return;
    end if;
    if position(v_antiga in a.system_prompt) = 0 then
        raise exception 'Linha de pendências não encontrada no prompt da Bia: nada alterado';
    end if;

    insert into ai_agent_versions (
        id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
        tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
        history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
        created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
        cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
        knowledge_source_ids, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms)
    select v_versao, v.organization_id, v.agent_id,
           (select max(version_number) + 1 from ai_agent_versions where agent_id = a.id),
           replace(a.system_prompt, v_antiga, v_nova), v.provider, v.model, v.credential_id,
           v.tool_ids, v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
           v.history_message_window, v.history_token_window, v.handoff_keywords, v.handoff_tool_enabled, 'draft',
           a.created_by, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
           v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
           v.knowledge_source_ids, v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
      from ai_agent_versions v where v.id = a.published_version_id;

    perform * from fn_publish_ai_agent_version(v_org, a.id, v_versao);

    insert into event_log (organization_id, event_type, entity_kind, payload)
    values (v_org, 'ai_agent.published', 'ai_agent',
            jsonb_build_object('agent_id', a.id, 'version_id', v_versao,
                               'previous_version_id', a.published_version_id, 'origem', 'ajuste_bia_pendencia'));
end $$;
