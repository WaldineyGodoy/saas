-- Português do Brasil reforçado (8 agentes) e Leo sem humano para cotas (30/10/2026).
--
-- Caso real de 29/10/2026: o lead pediu o "menor valor"; o Leo explicou a cota, deu o
-- preço com "Hoy hay cotas..." e "quedo à disposição" (espanhol) e passou para humano,
-- que não respondeu. Duas causas:
--   1. o modelo de conversa (deepseek) escapa para o espanhol; a regra "Responda em
--      português do Brasil" sozinha não segurou — agora ela nomeia o espanhol;
--   2. a regra antiga do Leo mandava passar para humano quem quer cota, de antes de
--      existir o Davi. O roteador troca para o Davi quando o cliente fala de cota, então
--      o Leo explica a cota e segue a conversa, sem humano.
-- Cirúrgico sobre a VERSÃO PUBLICADA, como regra_ja_tem_solar.sql. Idempotente.

do $$
declare
    v_org      uuid := (select id from organizations order by created_at limit 1);
    a          record;
    v_versao   uuid;
    v_prompt   text;

    c_pt_antigo constant text :=
        '- Responda em português do Brasil, com mensagens curtas (como no WhatsApp), simpáticas e objetivas. Uma pergunta por vez.';
    c_pt_novo constant text :=
        '- Responda em português do Brasil, com mensagens curtas (como no WhatsApp), simpáticas e objetivas. Uma pergunta por vez. '
        'Escreva sempre em português do Brasil, mesmo que algum texto da base ou do cliente venha em outra língua; nunca use palavras em espanhol ("hoy", "quedo", "usted", "gracias", "pero").';
    c_leo_antigo constant text :=
        '- Quer investir menos que uma usina inteira: explique a cota (preço da usina dividido por 10, mais 10%; valores em "Usinas com cotas") e passe para humano com o motivo "quer cota — mover para o funil Cotas".';
    c_leo_novo constant text :=
        '- Quer investir menos que uma usina inteira: explique a cota (preço da usina dividido por 10, mais 10%; valor e link em "Usinas com cotas") e pergunte se ele quer seguir com a cota. Não passe para humano por isso: na resposta dele, o especialista em cotas assume a conversa.';
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
    loop
        v_prompt := a.system_prompt;
        if position('nunca use palavras em espanhol' in v_prompt) = 0 then
            v_prompt := replace(v_prompt, c_pt_antigo, c_pt_novo);
        end if;
        v_prompt := replace(v_prompt, c_leo_antigo, c_leo_novo);

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
                                   'previous_version_id', a.published_version_id, 'origem', 'regra_portugues_e_leo_cotas'));
    end loop;
end $$;
