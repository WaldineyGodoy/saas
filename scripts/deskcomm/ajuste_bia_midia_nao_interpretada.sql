-- Mídia que o sistema não conseguiu interpretar, na Bia (Energia por Assinatura), 10/11/2026.
-- Quando a transcrição de um áudio (ou a leitura de uma imagem) falha, o agente
-- recebe "[o cliente enviou uma mídia que não consegui interpretar]". Sem regra
-- para isso, a Bia generalizou e disse ao cliente que "não consegue ouvir
-- áudios", o que é falso: ela ouve e responde áudios normalmente.
-- Regra nova: dizer que não conseguiu ouvir AQUELE áudio (ou ver aquela
-- imagem/arquivo), pedir para reenviar ou escrever, e nunca dizer que não ouve
-- áudios ou não vê imagens.
-- Cirúrgico sobre a versão publicada (preserva a persona). Idempotente.
-- Copia as colunas novas da versão (voz, visão, skills).

do $$
declare
    v_org     uuid := (select id from organizations order by created_at limit 1);
    a         record;
    v_versao  uuid := gen_random_uuid();
    v_prompt  text;
    v_ancora  constant text := '## Quando a resposta sair como nota de voz';
    v_regra   constant text := '## Quando o sistema não conseguir interpretar uma mídia'
        || E'\n' || 'Você ouve áudios e vê imagens e PDFs normalmente. Às vezes um arquivo específico falha e, no lugar dele, aparece "[o cliente enviou uma mídia que não consegui interpretar]". Nesse caso:'
        || E'\n' || '- Diga que não conseguiu ouvir ESSE áudio (ou ver essa imagem/esse arquivo) e peça para mandar de novo ou escrever. Ex.: "Não consegui ouvir esse seu áudio 😕 Pode mandar de novo ou me escrever?"'
        || E'\n' || '- Nunca diga que não ouve áudios, que não consegue ouvir áudios por aqui ou que não vê imagens: não é verdade.'
        || E'\n' || '- Se a etapa era o envio da conta de luz, peça a conta de novo (foto da conta inteira ou o PDF).'
        || E'\n\n';
begin
    select ag.id, ag.created_by, ag.published_version_id, v.system_prompt into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name = 'Bia · Energia por Assinatura';
    if a.id is null then raise exception 'Bia nao encontrada'; end if;

    if position('## Quando o sistema não conseguir interpretar uma mídia' in a.system_prompt) > 0 then
        raise notice 'Bia já trata mídia não interpretada'; return;
    end if;
    if position(v_ancora in a.system_prompt) = 0 then
        raise exception 'Seção da nota de voz não encontrada no prompt da Bia: nada alterado';
    end if;
    v_prompt := replace(a.system_prompt, v_ancora, v_regra || v_ancora);

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
                               'previous_version_id', a.published_version_id, 'origem', 'ajuste_bia_midia_nao_interpretada'));
end $$;
