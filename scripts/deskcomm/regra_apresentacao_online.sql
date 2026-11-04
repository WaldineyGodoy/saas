-- Regra "não existe dossiê; existe apresentação on-line" em todos os agentes do Deskcomm (04/11/2026).
--
-- Decisão do dono: a B2W não envia dossiê. O que existe é uma apresentação on-line do
-- projeto, em reunião com o time comercial, só para leads qualificados. O texto de
-- alguns anúncios da Meta ainda diz "receba o dossiê" e a Bel passou a oferecê-lo
-- (caso real de 31/10/2026, anúncio de Usinas de Investimento).
--
-- Cirúrgico sobre a VERSÃO PUBLICADA de cada agente (modelo: regra_ja_tem_solar.sql):
-- insere a regra logo depois da linha âncora do bloco comum.
-- Idempotente: agente que já tem a regra é pulado.
-- Publica por fn_publish_ai_agent_version, como os outros scripts.

do $$
declare
    v_org      uuid := (select id from organizations order by created_at limit 1);
    a          record;
    v_versao   uuid;
    v_prompt   text;

    v_ancora constant text :=
        '- Não fale de concorrentes, política ou assuntos fora da B2W. Não peça senha nem dados bancários.';
    v_marca constant text := '- Dossiê e material:';
    v_regra constant text :=
        E'\n- Dossiê e material: a B2W não envia dossiê, proposta nem material por mensagem, mesmo que o anúncio diga "receba o dossiê". O que existe é uma apresentação on-line do projeto, em reunião com o time comercial, só para leads qualificados. Nunca prometa dossiê nem diga que a equipe vai enviar material. Só ofereça a apresentação on-line depois de entender o perfil do cliente, como possibilidade, e passe para humano se ele aceitar. Se o cliente pedir o dossiê, explique isso com naturalidade e siga com as perguntas do atendimento.';
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
    loop
        if position(v_marca in a.system_prompt) > 0 then
            raise notice '% já está atualizado', a.name;
            continue;
        end if;
        if position(v_ancora in a.system_prompt) = 0 then
            raise notice '% sem a linha âncora do bloco comum; pulado', a.name;
            continue;
        end if;
        v_prompt := replace(a.system_prompt, v_ancora, v_ancora || v_regra);

        v_versao := gen_random_uuid();
        insert into ai_agent_versions (
            id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
            tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
            history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
            created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
            cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
            knowledge_source_ids, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms)
        select v_versao, v.organization_id, v.agent_id,
               (select max(version_number) + 1 from ai_agent_versions where agent_id = a.id),
               v_prompt, v.provider, v.model, v.credential_id, v.tool_ids,
               v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
               v.history_message_window, v.history_token_window, v.handoff_keywords, v.handoff_tool_enabled, 'draft',
               a.created_by, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
               v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
               v.knowledge_source_ids, v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
          from ai_agent_versions v where v.id = a.published_version_id;

        perform * from fn_publish_ai_agent_version(v_org, a.id, v_versao);

        insert into event_log (organization_id, event_type, entity_kind, payload)
        values (v_org, 'ai_agent.published', 'ai_agent',
                jsonb_build_object('agent_id', a.id, 'version_id', v_versao,
                                   'previous_version_id', a.published_version_id, 'origem', 'regra_apresentacao_online'));
    end loop;
end $$;
