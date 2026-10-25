-- Leo (Usinas de Investimento) v7: construcao sob medida
-- (spec docs/superpowers/specs/2026-10-25-base-leo-construcao-design.md §6).
--
-- Rodar DEPOIS da primeira execucao da Edge Function deskcomm-base com a fonte construcao_faq
-- (grava o id em ponte_deskcomm.fontes_base).
--
-- CIRURGICO sobre a VERSAO PUBLICADA (persona preservada): insere a regra antes do bloco
-- "Desvios:" e anexa a fonte. Idempotente: pula se o prompt ja tem a regra e a versao ja le a fonte.
-- Publica por fn_publish_ai_agent_version, a mesma funcao da tela.

do $$
declare
    v_org     uuid;
    v_agente  uuid;
    v_atual   uuid;
    v_versao  uuid := gen_random_uuid();
    v_fonte   uuid;
    v_prompt  text;
    v_ok      boolean;

    v_ancora constant text := E'Desvios:\n';
    v_marca  constant text := 'Construção sob medida: quem chega da Helena';
    v_regra  constant text := $r$Construção sob medida: quem chega da Helena (dono de projeto de usina solar ainda no papel) ou diz que quer construir a própria usina é atendido por aqui. Busque "Construção — Perguntas e respostas" (crm_search_knowledge) e apresente as duas opções: construir a usina do dono com a B2W, que cuida de tudo (projeto, homologação, obra e conexão) e a usina continua sendo dele; ou comprar uma usina da B2W já em construção ("Usinas à venda"). Destaque as vantagens: experiência comprovada da B2W; a usina já nasce com assinantes e gestão da B2W; acompanhamento da obra pelo app do investidor e custos iniciais (seguro e manutenção inclusos no primeiro ano, contador da abertura da empresa por conta da B2W). Nunca informe valor de obra: o orçamento depende do projeto e é feito pelo consultor. O dono precisa ter recursos para a obra (à vista, parcelado ou financiamento, como na base); terreno e projeto o consultor avalia caso a caso. Com o interesse definido, passe para o consultor (crm_request_human_handoff) com o motivo "construção sob medida".$r$ || E'\n\n';
begin
    select organization_id, agent_id into v_org, v_agente
      from public.ponte_deskcomm_agente_da_categoria('usina_investimento');
    if v_agente is null then raise exception 'Leo nao encontrado'; end if;

    select knowledge_source_id into v_fonte
      from ponte_deskcomm.fontes_base where chave = 'construcao_faq';
    if v_fonte is null then
        raise exception 'Fonte ainda nao criada: rode a Edge Function deskcomm-base primeiro';
    end if;

    select published_version_id into v_atual from ai_agents where id = v_agente;
    select system_prompt into v_prompt from ai_agent_versions where id = v_atual;

    if position(v_marca in v_prompt) = 0 then
        if position(v_ancora in v_prompt) = 0 then
            raise exception 'ancora do Leo nao encontrada no prompt publicado';
        end if;
        v_prompt := replace(v_prompt, v_ancora, v_regra || v_ancora);
    end if;

    select v.system_prompt = v_prompt and v.knowledge_source_ids @> array[v_fonte] into v_ok
      from ai_agent_versions v where v.id = v_atual;
    if v_ok then
        raise notice 'Leo ja esta com a regra de construcao e a fonte; nada a fazer';
        return;
    end if;

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
                'crm_get_contact', 'crm_request_human_handoff']) t),
           v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
           v.history_message_window, v.history_token_window, v.handoff_keywords, true, 'draft',
           a.created_by, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
           v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
           (select array_agg(distinct s) from unnest(coalesce(v.knowledge_source_ids, '{}') || array[v_fonte]) s),
           v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
      from ai_agent_versions v join ai_agents a on a.id = v.agent_id
     where v.id = v_atual;

    perform * from fn_publish_ai_agent_version(v_org, v_agente, v_versao);

    insert into event_log (organization_id, event_type, entity_kind, payload)
    values (v_org, 'ai_agent.published', 'ai_agent',
            jsonb_build_object('agent_id', v_agente, 'version_id', v_versao, 'previous_version_id', v_atual,
                               'origem', 'base_leo_construcao'));
end $$;
