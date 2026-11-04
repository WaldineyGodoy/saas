-- Nomes padronizados das etapas nos prompts dos 8 agentes (03/11/2026).
-- Acompanha supabase/migrations/20261103e_padroniza_etapas_status.sql: os agentes
-- movem o card pelo NOME da etapa (crm_move_lead_stage), então o prompt precisa
-- citar o nome novo. Cirúrgico sobre a VERSÃO PUBLICADA. Idempotente.

do $$
declare
    v_org      uuid := (select id from organizations order by created_at limit 1);
    a          record;
    v_versao   uuid;
    v_prompt   text;
    de text[] := array['Simulação / Proposta enviada', 'Reunião Agendada/Apresentação', 'Não fechou',
                       'Contrato enviado', 'Reunião agendada', 'Novo contato', 'Sem resposta',
                       'Entendendo a necessidade', 'Já respondi'];
    para text[] := array['Simulação', 'Reunião Agendada', 'Negócio Perdido',
                         'Contrato Enviado', 'Reunião Agendada', 'Sem Interação', 'Aguardando resposta',
                         'Qualificando', 'Qualificando'];
    i int;
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
    loop
        v_prompt := a.system_prompt;
        for i in 1 .. array_length(de, 1) loop
            v_prompt := replace(v_prompt, de[i], para[i]);
        end loop;
        if v_prompt = a.system_prompt then
            raise notice '% já está atualizado', a.name;
            continue;
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
                                   'previous_version_id', a.published_version_id, 'origem', 'regra_nomes_das_etapas'));
    end loop;
end $$;
