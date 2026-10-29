-- Dois ajustes nos agentes do Deskcomm (26/10/2026), a partir de um atendimento
-- da Bia em que a cliente tinha duas contas e pediu para ver "à noite":
--
-- 1. Bia: várias contas. A Bia somou as duas contas numa simulação só; cada
--    unidade adere separadamente e a menor ficava abaixo do mínimo de 150 kWh.
--    Agora: uma simulação por conta, soma só das que atingem o mínimo.
-- 2. Todos os agentes: retorno. A Bia prometeu "te escrevo mais tarde" sem
--    agendar nada, e "à noite" fica fora da janela de envio (dias úteis,
--    08:15-17:00). Agora: só prometer retorno agendado (schedule_followup) e
--    dentro da janela; senão, ficar à disposição.
--
-- Cirúrgico sobre a versão publicada de cada agente (preserva a persona).
-- Idempotente: agente sem nada a trocar é pulado.

do $$
declare
    v_org     uuid := (select id from organizations order by created_at limit 1);
    a         record;
    v_versao  uuid;
    v_prompt  text;

    v_retorno_antigo constant text := 'agende o retorno (schedule_followup) com data e hora absolutas no horário de Brasília e confirme numa frase ("Combinado, te escrevo dia 30!"). Se ele não disser quando, pergunte o dia. Não insista antes da data.';
    v_retorno_novo constant text := 'agende o retorno (schedule_followup) com data e hora absolutas no horário de Brasília e confirme numa frase ("Combinado, te escrevo dia 30!"). Se ele não disser quando, pergunte o dia. Não insista antes da data. O retorno só sai em dias úteis, das 08:15 às 17:00: se o cliente pedir fora disso ("à noite", "no domingo"), proponha o horário possível mais próximo ("Posso te chamar amanhã às 9h?"). Só diga que vai escrever depois se o agendamento deu certo; se não der, diga apenas que fica à disposição quando ele quiser continuar.';

    v_passo3_antigo constant text := '3. Simulação: no MESMO turno, busque "simulação desconto assinatura" na base e chame b2w_simular_assinatura (cidade, uf e consumo_kwh ou valor_conta_reais). Se o consumo veio convertido de reais, grave o consumo_kwh devolvido.';
    v_passo3_novo constant text := '3. Simulação: no MESMO turno, busque "simulação desconto assinatura" na base e chame b2w_simular_assinatura (cidade, uf e consumo_kwh ou valor_conta_reais). Se o consumo veio convertido de reais, grave o consumo_kwh devolvido. Se o cliente tiver mais de uma conta (mais de uma unidade consumidora), nunca some as contas numa simulação só: chame b2w_simular_assinatura uma vez para cada conta, diga a economia de cada uma e o total só das que atingem o mínimo. Conta abaixo de 150 kWh fica de fora: avise com leveza que nela a economia não compensa.';
begin
    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
    loop
        v_prompt := a.system_prompt;
        if position(v_retorno_novo in v_prompt) = 0 then
            v_prompt := replace(v_prompt, v_retorno_antigo, v_retorno_novo);
        end if;
        if position(v_passo3_novo in v_prompt) = 0 then
            v_prompt := replace(v_prompt, v_passo3_antigo, v_passo3_novo);
        end if;

        if v_prompt = a.system_prompt then
            raise notice '% sem alteração', a.name;
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
                                   'previous_version_id', a.published_version_id, 'origem', 'ajuste_contas_e_retorno'));
    end loop;
end $$;
