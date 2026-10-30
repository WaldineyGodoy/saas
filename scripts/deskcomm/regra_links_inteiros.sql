-- Links inteiros e aviso de acesso da página da usina, em todos os agentes (30/10/2026).
--
-- Caso real de 29/10/2026: o Leo escreveu o link certo da usina
-- (https://link.b2wenergia.com.br/usinaufvsantamar09ms) no fim de um parágrafo longo,
-- e o cliente recebeu "https://link." numa bolha e "b2wenergia. com. br/usina..."
-- na seguinte. Quem quebra é o Deskcomm: com split_messages ligado, parágrafo acima de
-- split_max_chars (200) é partido por frase, e splitSentences
-- (lib/agent-engine/agent/split-message.ts) trata todo "." como fim de frase, menos
-- entre dígitos. Parágrafo curto não é partido — então o link sozinho no próprio
-- parágrafo sai inteiro.
--
-- Regra do dono: a página da usina só abre para lead cadastrado e com o mesmo número
-- de WhatsApp do atendimento; o agente avisa isso ao mandar o link.
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
        E'\n- Links: escreva o link completo, começando com https://, sozinho num parágrafo próprio (linha em branco antes e depois), sem texto na mesma linha e sem espaço dentro dele. Se for a página de uma usina, avise numa frase curta que ela abre com este mesmo número de WhatsApp da nossa conversa.';
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
    loop
        if position('- Links: escreva o link completo' in a.system_prompt) > 0 then
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
                                   'previous_version_id', a.published_version_id, 'origem', 'regra_links_inteiros'));
    end loop;
end $$;
