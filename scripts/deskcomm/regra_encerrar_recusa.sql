-- Regra "cliente recusou: encerrar" em todos os agentes do Deskcomm (29/10/2026).
--
-- Caso real de 29/10/2026: a lead recusou a cota (fora do orçamento), o agente
-- agradeceu, mas não registrou a perda: a conversa ficou na lista, o CRM seguiu em
-- "Simulação" e uma retomada automática saiu horas depois. Regra do dono, para todos
-- os atendentes: conversa encerrada = conversa fechada + status de perdido no CRM.
--
-- O agente registra a recusa movendo o card para "Não fechou" (crm_move_lead_stage).
-- O resto é da ponte (migrations 20261029d/e, trg_ponte_card_perdido_encerra): fecha
-- a conversa, leva os outros cards do contato para "Não fechou" e o CRM para
-- "Negócio Perdido". O Deskcomm só aceita motivo da lista fixa
-- (fn_validate_lost_reason_required), por isso a regra dá os códigos.
--
-- A Bel não tinha crm_move_lead_stage: entra aqui, para registrar a recusa na Recepção.
-- Cirúrgico sobre a VERSÃO PUBLICADA, como regra_ja_tem_solar.sql. Idempotente.

do $$
declare
    v_org      uuid := (select id from organizations order by created_at limit 1);
    a          record;
    v_versao   uuid;
    v_prompt   text;
    v_tools    text[];

    v_ancora constant text :=
        '- Não fale de concorrentes, política ou assuntos fora da B2W. Não peça senha nem dados bancários.';
    v_regra constant text :=
        E'\n- Se o cliente recusar de vez (não tem interesse, achou caro, está fora do orçamento, "não, obrigado"): responda numa única mensagem curta, agradecendo e deixando a porta aberta, sem insistir, sem oferecer outro produto e sem fazer pergunta. Em seguida mova o negócio para a etapa "Não fechou" (crm_move_lead_stage) com o motivo price (preço ou orçamento), requested_by_customer (não quer ou desistiu) ou other. Isso fecha a conversa e registra a perda no CRM. Dúvida ou objeção ainda não é recusa: responda antes de encerrar.';
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt, v.tool_ids
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
    loop
        v_prompt := a.system_prompt;
        if position('Se o cliente recusar de vez' in v_prompt) = 0 then
            if position(v_ancora in v_prompt) = 0 then
                raise notice '% sem a linha âncora do bloco comum; pulado', a.name;
                continue;
            end if;
            v_prompt := replace(v_prompt, v_ancora, v_ancora || v_regra);
        end if;

        v_tools := case when 'crm_move_lead_stage' = any(coalesce(a.tool_ids, '{}'))
                        then a.tool_ids else array_append(coalesce(a.tool_ids, '{}'), 'crm_move_lead_stage') end;

        if v_prompt = a.system_prompt and v_tools = a.tool_ids then
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
               v_prompt, v.provider, v.model, v.credential_id, v_tools,
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
                                   'previous_version_id', a.published_version_id, 'origem', 'regra_encerrar_recusa'));
    end loop;
end $$;
