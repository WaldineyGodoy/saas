-- Conta completa na Bia (Energia por Assinatura), 28/10/2026.
-- A análise da conta precisa da conta inteira (foto da conta toda ou PDF).
-- Uma cliente mandou um recorte e a Bia só pediu "uma foto mais nítida".
-- Troca três frases: o pedido do consumo, o pedido da conta na adesão e a
-- resposta ao erro conta_ilegivel, que passa a explicar que recorte não serve.
-- Cirúrgico sobre a versão publicada (preserva a persona). Idempotente.

do $$
declare
    v_org     uuid := (select id from organizations order by created_at limit 1);
    a         record;
    v_versao  uuid := gen_random_uuid();
    v_prompt  text;
    v_consumo   constant text := 'Pode ser em kWh, em reais ou a foto da conta."';
    v_consumo_n constant text := 'Pode ser em kWh, em reais ou a foto da conta completa (a conta inteira ou o PDF)."';
    v_pedido    constant text := '("Me manda uma foto (ou o PDF) da sua conta de luz mais recente, com todas as informações aparecendo.")';
    v_pedido_n  constant text := '("Me manda uma foto da sua conta de luz mais recente inteira, com todas as informações aparecendo, ou o PDF. Recorte de uma parte da conta não serve.")';
    v_ilegivel   constant text := 'conta_ilegivel → "Essa foto não ficou legível, pode mandar outra mais nítida?"';
    v_ilegivel_n constant text := 'conta_ilegivel → "Não consegui ler a sua conta. Pra analisar eu preciso dela completa: uma foto da conta inteira, com todas as informações aparecendo, ou o PDF. Se você mandou só um pedaço (recorte), manda a conta toda, por favor."';
begin
    select ag.id, ag.created_by, ag.published_version_id, v.system_prompt into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name = 'Bia · Energia por Assinatura';
    if a.id is null then raise exception 'Bia nao encontrada'; end if;

    if position('Recorte de uma parte da conta não serve' in a.system_prompt) > 0 then
        raise notice 'Bia já pede a conta completa'; return;
    end if;
    if position(v_consumo in a.system_prompt) = 0 or position(v_pedido in a.system_prompt) = 0
       or position(v_ilegivel in a.system_prompt) = 0 then
        raise exception 'Frases da conta não encontradas no prompt da Bia: nada alterado';
    end if;
    v_prompt := replace(replace(replace(a.system_prompt, v_consumo, v_consumo_n), v_pedido, v_pedido_n), v_ilegivel, v_ilegivel_n);

    insert into ai_agent_versions (
        id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
        tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
        history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
        created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
        cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
        knowledge_source_ids, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms)
    select v_versao, v.organization_id, v.agent_id,
           (select max(version_number) + 1 from ai_agent_versions where agent_id = a.id),
           v_prompt, v.provider, v.model, v.credential_id,
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
                               'previous_version_id', a.published_version_id, 'origem', 'ajuste_bia_conta_completa'));
end $$;
