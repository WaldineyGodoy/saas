-- Davi (Cotas): rentabilidade igual à da usina inteira e "sem cota livre" sem passar para humano (28/10/2026).
--
-- Caso real de 28/10/2026: a lead perguntou o valor da cota; não havia usina com cota
-- livre cadastrada, o Davi disse isso e, pela regra antiga, passou para humano. A IA
-- ficou calada e a pergunta seguinte ("Qto seria a rentabilidade?") ficou sem resposta.
-- O dono: a rentabilidade da cota segue a mesma previsão da usina inteira.
--
--   1. projeção "1,8% a 2% ao mês" -> "cerca de 2% ao mês, a mesma da usina inteira"
--      (mesmo texto do FAQ do Investidor; o FAQ das cotas muda junto em deskcomm-base);
--   2. sem cota livre: grava lista_espera e segue tirando dúvidas; humano só se o
--      cliente pedir.
--
-- Cirúrgico sobre a VERSÃO PUBLICADA (persona fora de base_cotas.sql), no formato de
-- regra_ja_tem_solar.sql. Idempotente: sem as frases antigas, não faz nada.

do $$
declare
    v_org      uuid := (select id from organizations order by created_at limit 1);
    a          record;
    v_versao   uuid;
    v_prompt   text;

    v_proj_antiga constant text := 'a projeção de 1,8% a 2% ao mês, a depender do mês de geração.';
    v_proj_nova   constant text := 'a projeção de cerca de 2% ao mês, a mesma da usina inteira, antes do Simples Nacional.';
    v_esp_antiga  constant text :=
        '- Nenhuma usina com cota livre: diga que o consultor avisa quando abrir a próxima, grave lista_espera = true e passe para humano.';
    v_esp_nova    constant text :=
        '- Nenhuma usina com cota livre: diga que o consultor avisa quando abrir a próxima e grave lista_espera = true. '
        'Não passe para humano por isso: continue tirando as dúvidas (modelo, rentabilidade, pagamento) e só passe para humano se o cliente pedir.';
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
      into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name like 'Davi%';
    if not found then raise exception 'Davi não encontrado'; end if;

    v_prompt := replace(replace(a.system_prompt, v_proj_antiga, v_proj_nova), v_esp_antiga, v_esp_nova);
    if v_prompt = a.system_prompt then
        raise notice 'Davi já está atualizado';
        return;
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
                               'previous_version_id', a.published_version_id, 'origem', 'regra_davi_rentabilidade_e_espera'));
end $$;
