-- Cidade sem estado na abertura dos agentes, 28/10/2026.
-- A abertura comum perguntava "De qual estado?" sempre que o cliente dizia só
-- a cidade, mesmo para cidade conhecida que só existe num estado. Com a
-- migration 20261028a, b2w_concessionaria aceita a cidade sem a UF e deduz o
-- estado pela lista do IBGE. Troca o passo 3 da abertura e abre a exceção no
-- "Não deduza" para a UF devolvida pela ferramenta.
-- Cirúrgico sobre a versão publicada de cada agente (preserva a persona).
-- Idempotente: pula quem já tem "uf_deduzida" no prompt.

do $$
declare
    v_org      uuid := (select id from organizations order by created_at limit 1);
    a          record;
    v_versao   uuid;
    v_prompt   text;
    v_passo    constant text := '3. Sem o estado: "De qual estado, {nome}?"';
    v_passo_n  constant text := '3. Com a cidade e sem o estado: não pergunte o estado antes de consultar. Chame b2w_concessionaria só com a cidade (sem uf) e:'
        || E'\n' || '   - uf_deduzida: a cidade só existe nesse estado. Grave cidade e a uf devolvida no negócio e siga, sem perguntar nem confirmar o estado.'
        || E'\n' || '   - ambigua com estado_provavel: confirme de forma natural, citando o estado (ex.: "Parnamirim do Rio Grande do Norte, né?", ajustando do/da ao estado).'
        || E'\n' || '   - ambigua sem estado_provavel, ou cidade_desconhecida: "De qual estado, {nome}?"';
    v_deduza   constant text := 'em custom_fields) o que o cliente informar de fato: cidade, uf (sigla do estado), consumo_kwh, origem, indicado_por, lista_espera. Não deduza.';
    v_deduza_n constant text := 'em custom_fields) o que o cliente informar de fato: cidade, uf (sigla do estado), consumo_kwh, origem, indicado_por, lista_espera. Não deduza; a única exceção é a uf devolvida pela b2w_concessionaria com uf_deduzida.';
    v_feitos   int := 0;
begin
    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
         order by ag.name
    loop
        if position('uf_deduzida' in a.system_prompt) > 0 then
            raise notice '%: já ajustado', a.name; continue;
        end if;
        if position(v_passo in a.system_prompt) = 0 or position(v_deduza in a.system_prompt) = 0 then
            raise notice '%: abertura comum não encontrada, nada alterado', a.name; continue;
        end if;

        v_prompt := replace(replace(a.system_prompt, v_passo, v_passo_n), v_deduza, v_deduza_n);
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
                                   'previous_version_id', a.published_version_id, 'origem', 'ajuste_cidade_sem_estado'));
        v_feitos := v_feitos + 1;
        raise notice '%: publicado', a.name;
    end loop;
    raise notice 'agentes ajustados: %', v_feitos;
end $$;
