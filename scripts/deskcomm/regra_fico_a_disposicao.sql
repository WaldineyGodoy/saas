-- "Fico à disposição" só depois da despedida do cliente (30/10/2026, regra do dono).
--
-- Caso real de 30/10/2026: lead engajada (oito perguntas, queria construir no
-- próprio terreno) disse "estou pesquisando e levantando possibilidades"; o agente
-- respondeu "Fico à disposição pra te ajudar com qualquer dúvida...", que soou como
-- despedida, e ela agradeceu e saiu. O próximo passo do roteiro (orçamento com o
-- consultor) nunca foi oferecido.
--
-- Regra do dono, para todos os agentes: a frase de disponibilidade só depois que o
-- cliente se despedir ou encerrar a conversa (ou na última tentativa de retomada).
-- Complemento: "estou pesquisando" não é despedida — o agente oferece o próximo passo.
-- Cirúrgico sobre a VERSÃO PUBLICADA, como regra_ja_tem_solar.sql. Idempotente.

do $$
declare
    v_org      uuid := (select id from organizations order by created_at limit 1);
    a          record;
    v_versao   uuid;
    v_prompt   text;

    v_ancora constant text :=
        '- Não fale de concorrentes, política ou assuntos fora da B2W. Não peça senha nem dados bancários.';
    v_regra constant text :=
        E'\n- "Fico à disposição" (ou parecidas: "qualquer dúvida é só chamar", "quando quiser continuar") só depois que o cliente se despedir ou encerrar a conversa, ou na última tentativa de retomada. Antes disso, nunca: soa como dispensa. Termine cada resposta com uma pergunta ou um próximo passo concreto.'
        || E'\n- "Estou pesquisando", "estou vendo possibilidades" ou "vou pensar" não é despedida: valide em uma frase e ofereça o próximo passo do seu roteiro (simulação, orçamento ou conversa com o consultor por aqui mesmo, página da usina).';
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
    loop
        if position('"Fico à disposição" (ou parecidas' in a.system_prompt) > 0 then
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
                                   'previous_version_id', a.published_version_id, 'origem', 'regra_fico_a_disposicao'));
    end loop;
end $$;
