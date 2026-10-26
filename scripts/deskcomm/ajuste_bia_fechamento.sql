-- Ajuste do fechamento da Bia (Energia por Assinatura), 26/10/2026.
--
-- Atendimento de 26/10/2026: a Bia deu a estimativa, emendou o prazo de
-- 30-60 dias e as contas proporcionais, mandou o link e "ficou com alguma
-- dúvida?" — soou como dispensar o lead, e não citou o cashback de indicação.
-- Decisão do dono:
--   - depois da estimativa, citar os 2% de cashback das indicações e convidar:
--     "Você está com a conta em mãos? Vamos fazer a sua adesão? É bem rápido,
--     leva menos de 10 minutos";
--   - link só quando o cliente topar, e a Bia conduz a adesão até o fim;
--   - prazo do desconto e contas proporcionais só depois da assinatura (aviso)
--     ou se o cliente perguntar. Nunca na primeira abordagem.
--
-- Cirúrgico sobre a versão publicada (preserva a persona). Idempotente.
-- O "2%" precisa estar na base (Fonte B, migration 20261026a + deskcomm-base).

do $$
declare
    v_org     uuid := (select id from organizations order by created_at limit 1);
    a         record;
    v_versao  uuid := gen_random_uuid();
    v_prompt  text;

    v_imed_antiga constant text := '- vaga = imediata: diga a economia estimada por mês e por ano ("é uma estimativa; o valor exato sai da sua conta"), que o desconto começa em 30 a 60 dias e que podem vir até 2 contas proporcionais sem desconto durante a troca de titularidade e o rateio. Envie o link_adesao.';
    v_imed_nova constant text := '- vaga = imediata: numa mensagem, diga a economia estimada por mês e por ano ("é uma estimativa; o valor exato sai da sua conta") e o cashback de indicação, com o percentual da base (ex.: "E depois de assinar, cada pessoa que você indicar e aderir te dá 2% de cashback, abatido na sua fatura 😉"). Em seguida, convide para a adesão: "Você está com a conta em mãos? Vamos fazer a sua adesão? É bem rápido, leva menos de 10 minutos." Aqui não fale do prazo do desconto nem das contas proporcionais, e ainda não envie o link.';

    v_pre_antiga constant text := '- vaga = pre_operacao: diga a estimativa e que o cliente assina agora e o desconto começa quando a usina entrar em operação (cite a previsão, se vier). Envie o link_adesao.';
    v_pre_nova constant text := '- vaga = pre_operacao: diga a estimativa e o cashback de indicação, como no caso acima, e que o cliente assina agora e o desconto começa quando a usina entrar em operação (cite a previsão, se vier). Em seguida, convide para a adesão com a mesma frase. Ainda não envie o link.';

    v_passo5_antigo constant text := '5. Depois do link, tire as dúvidas da adesão (documentos com foto, conta de cada unidade, contrato social se for empresa, assinatura eletrônica, link válido por 30 dias, várias unidades). Passe para humano só se o cliente pedir, reclamar ou travar. A adesão pelo link não é contrato montado pela equipe: aqui ela não exige humano.';
    v_passo5_novo constant text := E'5. Adesão: quando o cliente topar, envie o link_adesao e conduza a adesão passo a passo, uma etapa por mensagem (CEP e consumo, documento com foto, conta de energia de cada unidade, contrato social se for empresa, assinatura eletrônica; o link vale 30 dias; dá para incluir várias unidades). Não encerre com "ficou com alguma dúvida?": pergunte em que etapa ele está e ajude a concluir. Se ele não puder agora, combine o melhor momento para retomar. Passe para humano só se o cliente pedir, reclamar ou travar. A adesão pelo link não é contrato montado pela equipe: aqui ela não exige humano.\n6. Prazo do desconto (começa em 30 a 60 dias; podem vir até 2 contas proporcionais sem desconto durante a troca de titularidade e o rateio): informe só depois que o cliente concluir a assinatura, como aviso, ou se ele perguntar quando o desconto começa. Nunca na primeira abordagem.';
begin
    select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt into a
      from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
     where ag.organization_id = v_org and ag.archived_at is null and ag.name = 'Bia · Energia por Assinatura';
    if a.id is null then raise exception 'Bia nao encontrada'; end if;

    v_prompt := replace(replace(replace(a.system_prompt,
                    v_imed_antiga, v_imed_nova), v_pre_antiga, v_pre_nova), v_passo5_antigo, v_passo5_novo);

    if v_prompt = a.system_prompt then
        if position('Vamos fazer a sua adesão?' in a.system_prompt) > 0 then
            raise notice 'Bia já está atualizada'; return;
        end if;
        raise exception 'Trechos antigos não encontrados no prompt da Bia: nada alterado';
    end if;
    if position(v_imed_nova in v_prompt) = 0 or position(v_pre_nova in v_prompt) = 0
       or position('6. Prazo do desconto' in v_prompt) = 0 then
        raise exception 'Substituição parcial no prompt da Bia: nada alterado';
    end if;

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
                               'previous_version_id', a.published_version_id, 'origem', 'ajuste_bia_fechamento'));
end $$;
