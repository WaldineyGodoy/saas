-- Conta de luz no nome de outra pessoa na Bia (Energia por Assinatura), 09/11/2026.
-- Antes: conta no nome de parente ou terceiro virava pendência
-- (titular_divergente) e ia para humano. Decisão do dono: a Bia resolve sozinha
-- oferecendo o contrato no nome do titular da conta, com os dados e o
-- documento dele, e é ele quem assina. Conta de empresa (titular_cnpj) segue
-- como pendência.
-- Troca a observação da lista de documentos e a etapa "titular".
-- Cirúrgico sobre a versão publicada (preserva a persona). Idempotente.
-- Copia as colunas novas da versão (voz, visão, skills).

do $$
declare
    v_org     uuid := (select id from organizations order by created_at limit 1);
    a         record;
    v_versao  uuid := gen_random_uuid();
    v_prompt  text;
    v_lista   constant text := 'A conta precisa estar no seu nome. Se estiver no nome de outra pessoa ou de empresa, me avisa que a equipe te orienta.';
    v_lista_n constant text := 'A conta precisa estar no nome de quem assina o contrato. Se estiver no nome de outra pessoa, o contrato é feito no nome dela, com os dados e o documento dela, e é ela quem assina. Se for de empresa, me avisa que a equipe te orienta.';
    v_etapa   constant text := '- titular: "A conta está no nome de {titular}. É você?" Grave adesao_titular_ok (sim/não).';
    v_etapa_n constant text := '- titular: "A conta está no nome de {titular}. É você?" Se for, grave adesao_titular_ok = sim.'
        || E'\n' || '- Conta no nome de outra pessoa física (parente ou terceiro), nesta etapa ou em qualquer momento da conversa: não passe para humano. Diga: "A conta de luz precisa estar no nome de quem assina o contrato. Como ela está no nome do(a) {titular ou o parente que o cliente citou}, o contrato precisa ser feito no nome dele(a): vou precisar do CPF, do e-mail, do telefone e de uma foto do RG ou CNH dele(a), e é ele(a) quem assina o contrato pelo link que eu te enviar." e pergunte "Vamos seguir com o contrato no nome dele(a)?".'
        || E'\n' || '  - Se aceitar: grave adesao_titular_ok = sim e siga as etapas com os dados do titular da conta. CPF, e-mail, telefone e documento são do titular (nos pedidos, troque "seu" por "dele(a)"; o telefone do titular não é o desta conversa, então pergunte qual é). Na revisão, o nome é o do titular. Se a conta ainda não foi enviada, peça a conta normalmente.'
        || E'\n' || '  - Se não aceitar: não grave adesao_titular_ok = não. Diga que, quando a conta estiver no nome dele ou o titular puder assinar, é só chamar aqui que a gente faz a adesão, e encerre com cordialidade.';
begin
    select ag.id, ag.created_by, ag.published_version_id, v.system_prompt into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name = 'Bia · Energia por Assinatura';
    if a.id is null then raise exception 'Bia nao encontrada'; end if;

    if position('Vamos seguir com o contrato no nome dele(a)?' in a.system_prompt) > 0 then
        raise notice 'Bia já trata conta de terceiro'; return;
    end if;
    if position(v_lista in a.system_prompt) = 0 or position(v_etapa in a.system_prompt) = 0 then
        raise exception 'Trechos do titular não encontrados no prompt da Bia: nada alterado';
    end if;
    v_prompt := replace(replace(a.system_prompt, v_lista, v_lista_n), v_etapa, v_etapa_n);

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
           v_prompt, v.provider, v.model, v.credential_id,
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
                               'previous_version_id', a.published_version_id, 'origem', 'ajuste_bia_conta_de_terceiro'));
end $$;
