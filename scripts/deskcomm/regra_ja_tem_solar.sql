-- Regra "cliente já tem energia solar" em todos os agentes do Deskcomm (23/10/2026).
--
-- Decisão do dono: quem já tem energia solar instalada no imóvel não pode
-- aderir à Energia por Assinatura (restrição técnica interna). O agente só
-- agradece o retorno e encerra — sem explicar o produto, sem oferecer outro
-- e sem passar para humano. Caso real de 23/10/2026: a Bel insistiu
-- em explicar a assinatura.
--
-- Cirúrgico sobre a VERSÃO PUBLICADA de cada agente (os prompts de produção
-- têm seções de persona que os scripts base_*.sql não têm; regenerar por eles
-- apagaria isso):
--   1. insere v_regra logo depois da linha âncora do bloco comum;
--   2. na Bia (Energia por Assinatura), a linha "Já tem placa solar ou ... outra
--      cooperativa -> humano" passa a valer só para outra cooperativa.
-- Idempotente: agente que já tem a regra e não tem a linha antiga é pulado.
-- Publica por fn_publish_ai_agent_version, como os outros scripts.

do $$
declare
    v_org      uuid := (select id from organizations order by created_at limit 1);
    a          record;
    v_versao   uuid;
    v_prompt   text;

    v_ancora constant text :=
        '- Não fale de concorrentes, política ou assuntos fora da B2W. Não peça senha nem dados bancários.';
    v_regra constant text :=
        E'\n- Se o cliente disser que já tem energia solar (placas) instalada no imóvel: não explique a energia por assinatura, não ofereça outro produto e não passe para humano. Responda numa única mensagem curta agradecendo o retorno e encerre o atendimento (ex.: "Que bom, {nome}! Agradeço o retorno 😊 Qualquer coisa, estamos por aqui."). Não faça mais perguntas.';
    v_linha_antiga constant text :=
        '- Já tem placa solar ou participa de outra cooperativa ou associação: passe para humano com o motivo "já gera energia ou participa de outra associação".';
    v_linha_nova constant text :=
        '- Participa de outra cooperativa ou associação de energia: passe para humano com o motivo "participa de outra associação". (Quem já tem energia solar instalada segue a regra comum: agradecer e encerrar.)';
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
    loop
        v_prompt := replace(a.system_prompt, v_linha_antiga, v_linha_nova);
        if position('já tem energia solar (placas) instalada' in v_prompt) = 0 then
            if position(v_ancora in v_prompt) = 0 then
                raise notice '% sem a linha âncora do bloco comum; pulado', a.name;
                continue;
            end if;
            v_prompt := replace(v_prompt, v_ancora, v_ancora || v_regra);
        end if;

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
                                   'previous_version_id', a.published_version_id, 'origem', 'regra_ja_tem_solar'));
    end loop;
end $$;
