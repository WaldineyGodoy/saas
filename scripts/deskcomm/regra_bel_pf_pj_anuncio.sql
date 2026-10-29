-- Bel: pessoa física ou empresa só em anúncio de Energia por Assinatura (28/10/2026).
--
-- Caso real de 28/10/2026: lead do anúncio "R$ 300 mil: imóvel ou usina solar?"
-- (investimento) e a Bel abriu perguntando "você seria pessoa física ou empresa?".
-- O dono: nesse momento não importa, é usina de investimento. A pergunta só muda a
-- conversa na Energia por Assinatura.
--
-- Cirúrgico sobre a VERSÃO PUBLICADA da Bel (a persona "## Quem você é" não existe
-- em bel_recepcao.sql/base_bel.sql; regenerar por eles apagaria isso), no mesmo
-- formato de regra_ja_tem_solar.sql. Idempotente: sem a frase antiga, não faz nada.
-- Par do documento "Recepção: entradas" (deskcomm-base/montar.ts, mesma regra).

do $$
declare
    v_org      uuid := (select id from organizations order by created_at limit 1);
    a          record;
    v_versao   uuid;
    v_prompt   text;

    v_antiga constant text :=
        'Confirme se é pessoa física ou empresa: nunca presuma, mesmo no anúncio de CNPJ.';
    v_nova constant text :=
        'Só em anúncio de Energia por Assinatura confirme se é pessoa física ou empresa: nunca presuma, mesmo no anúncio de CNPJ. '
        'Em anúncio de outro produto (Usinas de Investimento, Cotas e os demais), não pergunte se é pessoa física ou empresa: '
        'o produto já está claro, abra falando do anúncio e siga.';
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
      into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name like 'Bel%';
    if not found then raise exception 'Bel não encontrada'; end if;

    if position(v_antiga in a.system_prompt) = 0 then
        raise notice 'Bel já está atualizada (frase antiga ausente)';
        return;
    end if;
    v_prompt := replace(a.system_prompt, v_antiga, v_nova);

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
                               'previous_version_id', a.published_version_id, 'origem', 'regra_bel_pf_pj_anuncio'));
end $$;
