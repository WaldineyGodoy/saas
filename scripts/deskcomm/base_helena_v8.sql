-- Helena (Gestora / Comercializadora) v8: condicoes comerciais, setup opcional e aceite
-- (spec docs/superpowers/specs/2026-11-05-helena-v8-condicoes-design.md §4).
--
-- Rodar DEPOIS da migration 20261105a_gestora_setup_reais e da sincronizacao da deskcomm-base.
--
-- CIRURGICO sobre a VERSAO PUBLICADA (persona e bloco "Base da Gestora" da v7 preservados):
-- troca quatro trechos exatos. Idempotente: pula se o prompt ja tem "Aceite das condicoes:".
-- Publica por fn_publish_ai_agent_version, a mesma funcao da tela.

do $$
declare
    v_org     uuid;
    v_agente  uuid;
    v_atual   uuid;
    v_versao  uuid := gen_random_uuid();
    v_prompt  text;

    v_marca   constant text := 'Aceite das condições:';

    v_a1 constant text := 'Explique a fórmula; só cite a taxa de gestão e o desconto se o fornecedor perguntar, dizendo que o especialista confirma o plano e o valor da usina dele. Fio B: explique o que é, sem dar percentual.';
    v_b1 constant text := 'Explique a fórmula. Fio B: explique o que é, sem dar percentual.';

    v_a2 constant text := 'Setup, carência e prazo: antes de passar ao especialista, deixe claro que há custo de setup, carência dos pagamentos ao dono e prazo até o primeiro repasse. Cite os valores só se estiverem em "Gestora: planos vigentes"; se não estiverem definidos, diga que o especialista confirma e leve esse ponto no motivo da passagem.';
    v_b2 constant text := $r$Condições comerciais: com os dados básicos da usina (responsável, empresa e CNPJ, cidade e estado, distribuidora, potência, situação), apresente as condições do plano vigente em "Gestora: planos vigentes" (taxa de gestão, desconto do assinante, repasse mensal no dia do plano e prazo até o primeiro repasse, que é a carência dos pagamentos ao dono) e pergunte se o fornecedor aceita.
Setup: é opcional; apresente as duas opções, com o valor do plano. A usina que paga o setup tem prioridade na captação de assinantes: o valor financia campanhas de marketing e tráfego pago exclusivos para captar clientes para ela. Quem opta por não pagar fica em segunda prioridade: os assinantes vão primeiro para a usina prioritária e o excedente da captação vai para a segunda.
Diga sempre que o especialista confirma o plano e o valor da usina dele. O que a base disser "ainda não definido" você não estima.$r$;

    v_a3 constant text := 'Não afirme taxa de recuperação, retenção na rescisão, multas, valor do Fio B, documentos exigidos, prazo de implantação nem exclusividade: isso é do especialista. Passe para o especialista (crm_request_human_handoff) assim que tiver os dados básicos: responsável, empresa e CNPJ, cidade e estado, distribuidora, potência, situação e contato.';
    v_b3 constant text := $r$Dados da usina e histórico: a cada dado que o fornecedor informar (responsável, empresa, CNPJ, cidade e estado, distribuidora, potência, situação, prazo de entrega, volume, contrato já existente, contato), confirme numa frase curta o que entendeu, com o valor (por exemplo: "Anotei: usina de 500 kWp em Mossoró/RN, operando"). É isso que fica no resumo da IA e no histórico do lead. Antes do aceite, NÃO grave esses dados no negócio (crm_update_lead); só cidade e uf, como na abertura.
Aceite das condições: quando o fornecedor aceitar as condições e disser se opta pelo setup, registre no negócio (crm_update_lead, em custom_fields) os dados da usina, a opção de setup (com_setup ou sem_setup) e o aceite. Peça o cadastro de fornecedor passando para a equipe (crm_request_human_handoff) com o motivo "cadastro de fornecedor" e a ficha completa. Diga ao fornecedor que a equipe fará o cadastro e que ele receberá o link do contrato para dar sequência à adesão da usina. Não peça senha nem dados bancários.
Não afirme taxa de recuperação, retenção na rescisão, multas, valor do Fio B, documentos exigidos, prazo de implantação nem exclusividade: isso é do especialista. Se o fornecedor pedir condição diferente da do plano ou tiver dúvida que a base não responde, passe para o especialista.$r$;

    v_a4 constant text := 'Dados completos → "Reunião Agendada" (passe para humano marcar com o especialista).';
    v_b4 constant text := 'Fornecedor que prefere falar com o especialista antes de aceitar → "Reunião Agendada" (passe para humano marcar). Aceite das condições → siga o fluxo de aceite e cadastro abaixo, sem mover de etapa (a equipe move).';
begin
    select organization_id, agent_id into v_org, v_agente
      from public.ponte_deskcomm_agente_da_categoria('comercializadora');
    if v_agente is null then raise exception 'Helena nao encontrada'; end if;

    select published_version_id into v_atual from ai_agents where id = v_agente;
    select system_prompt into v_prompt from ai_agent_versions where id = v_atual;

    if position(v_marca in v_prompt) > 0 then
        raise notice 'Helena ja esta na v8 (aceite das condicoes); nada a fazer';
        return;
    end if;
    if position(v_a1 in v_prompt) = 0 or position(v_a2 in v_prompt) = 0
       or position(v_a3 in v_prompt) = 0 or position(v_a4 in v_prompt) = 0 then
        raise exception 'trechos da v7 da Helena nao encontrados no prompt publicado';
    end if;
    v_prompt := replace(replace(replace(replace(v_prompt, v_a1, v_b1), v_a2, v_b2), v_a3, v_b3), v_a4, v_b4);

    insert into ai_agent_versions (
        id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
        tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
        history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
        created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
        cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
        knowledge_source_ids, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms)
    select v_versao, v.organization_id, v.agent_id,
           (select max(version_number) + 1 from ai_agent_versions where agent_id = v_agente),
           v_prompt, v.provider, v.model, v.credential_id,
           (select array_agg(distinct t) from unnest(v.tool_ids || array['crm_search_knowledge',
                'crm_update_lead', 'crm_request_human_handoff']) t),
           v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
           v.history_message_window, v.history_token_window, v.handoff_keywords, true, 'draft',
           a.created_by, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
           v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
           v.knowledge_source_ids, v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
      from ai_agent_versions v join ai_agents a on a.id = v.agent_id
     where v.id = v_atual;

    perform * from fn_publish_ai_agent_version(v_org, v_agente, v_versao);

    insert into event_log (organization_id, event_type, entity_kind, payload)
    values (v_org, 'ai_agent.published', 'ai_agent',
            jsonb_build_object('agent_id', v_agente, 'version_id', v_versao, 'previous_version_id', v_atual,
                               'origem', 'base_helena_v8'));
end $$;
