-- Economia estimada sem a frase repetida na Bia (Energia por Assinatura), 07/11/2026.
-- O roteiro mandava emendar "é uma estimativa; o valor exato sai da sua conta"
-- depois da economia, e a Bia repetia isso em toda simulação, inclusive no
-- áudio ("a economia estimada fica em torno de... É uma estimativa, viu? O
-- valor exato sai da sua conta."). "Estimada" já diz que é estimativa.
-- Cirúrgico sobre a versão publicada (preserva a persona). Idempotente.

do $$
declare
    v_org     uuid := (select id from organizations order by created_at limit 1);
    a         record;
    v_versao  uuid := gen_random_uuid();
    v_antiga  constant text := 'diga a economia estimada por mês e por ano ("é uma estimativa; o valor exato sai da sua conta") e o cashback de indicação';
    v_nova    constant text := 'diga a economia estimada por mês e por ano, sem emendar "é uma estimativa" nem "o valor exato sai da sua conta" ("estimada" já diz isso; ex.: "a economia estimada fica em torno de R$ X por mês, quase R$ Y por ano"), e o cashback de indicação';
begin
    select ag.id, ag.created_by, ag.published_version_id, v.system_prompt into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name = 'Bia · Energia por Assinatura';
    if a.id is null then raise exception 'Bia nao encontrada'; end if;

    if position('sem emendar "é uma estimativa"' in a.system_prompt) > 0 then
        raise notice 'Bia já está sem a frase repetida'; return;
    end if;
    if position(v_antiga in a.system_prompt) = 0 then
        raise exception 'Trecho da economia estimada não encontrado no prompt da Bia: nada alterado';
    end if;

    insert into ai_agent_versions (
        id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
        tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
        history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
        created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
        cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
        knowledge_source_ids, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms,
        voz_enabled, voz_quando, reply_min_interval_ms, skill_names, image_vision_enabled)
    select v_versao, v.organization_id, v.agent_id,
           (select max(version_number) + 1 from ai_agent_versions where agent_id = a.id),
           replace(a.system_prompt, v_antiga, v_nova), v.provider, v.model, v.credential_id,
           v.tool_ids, v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
           v.history_message_window, v.history_token_window, v.handoff_keywords, v.handoff_tool_enabled, 'draft',
           a.created_by, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
           v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
           v.knowledge_source_ids, v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms,
           v.voz_enabled, v.voz_quando, v.reply_min_interval_ms, v.skill_names, v.image_vision_enabled
      from ai_agent_versions v where v.id = a.published_version_id;

    perform * from fn_publish_ai_agent_version(v_org, a.id, v_versao);

    insert into event_log (organization_id, event_type, entity_kind, payload)
    values (v_org, 'ai_agent.published', 'ai_agent',
            jsonb_build_object('agent_id', a.id, 'version_id', v_versao,
                               'previous_version_id', a.published_version_id, 'origem', 'ajuste_bia_estimativa_sem_repeticao'));
end $$;
