-- Bel (Recepção) v7: base de conhecimento e regra de anúncio
-- (spec docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md §5.3 e §6).
--
-- Rodar DEPOIS da primeira execução da Edge Function deskcomm-base com as fontes da
-- Recepção (grava os ids em ponte_deskcomm.fontes_base).
--
-- CIRÚRGICO sobre a VERSÃO PUBLICADA: o prompt de produção tem a seção de persona
-- ("## Quem você é"); regenerar pelo bel_recepcao.sql a apagaria. O script insere a
-- regra antes do parágrafo "Quem não é cliente nem lead —" e anexa as duas fontes.
-- Idempotente: pula se o prompt já tem a regra e a versão já lê as duas fontes.
-- Publica por fn_publish_ai_agent_version, a mesma função da tela.

do $$
declare
    v_org     uuid;
    v_agente  uuid;
    v_atual   uuid;
    v_versao  uuid := gen_random_uuid();
    v_fontes  uuid[];
    v_prompt  text;
    v_ok      boolean;

    v_ancora constant text := 'Quem não é cliente nem lead —';
    v_marca  constant text := 'Anúncio e entradas: consulte as etiquetas do contato';
    v_regra  constant text := $r$Anúncio e entradas: consulte as etiquetas do contato (crm_get_contact). Com etiqueta anuncio:…, o contato clicou em um anúncio (se houver mais de uma, vale a última): busque "entradas anúncios" na base (crm_search_knowledge) para saber o que o anúncio ofereceu e abra falando disso, sem perguntar o que a pessoa procura. Confirme se é pessoa física ou empresa: nunca presuma, mesmo no anúncio de CNPJ. Contato de anúncio sem etiqueta (source meta_ads) é interesse em desconto na conta de luz. Nunca repita um percentual do anúncio como valor garantido: o percentual do cliente sai da simulação. Para dúvidas sobre quem é a B2W, endereço, horário, CNPJ e canais, busque na base antes de responder. Se o cliente pedir uma videochamada ou quiser confirmar que a B2W é real, ofereça a videochamada com o time comercial e passe para humano (crm_request_human_handoff) com o motivo "videochamada". Quem não conseguiu se cadastrar pelo app: humano, motivo "cadastro no app".$r$ || E'\n\n';
begin
    select organization_id, agent_id into v_org, v_agente
      from public.ponte_deskcomm_agente_da_categoria('triagem');
    if v_agente is null then raise exception 'Bel nao encontrada'; end if;

    select array_agg(knowledge_source_id order by chave) into v_fontes
      from ponte_deskcomm.fontes_base
     where chave in ('recepcao_faq', 'recepcao_entradas') and knowledge_source_id is not null;
    if coalesce(array_length(v_fontes, 1), 0) < 2 then
        raise exception 'Fontes ainda nao criadas: rode a Edge Function deskcomm-base primeiro';
    end if;

    select published_version_id into v_atual from ai_agents where id = v_agente;
    select system_prompt into v_prompt from ai_agent_versions where id = v_atual;

    if position(v_marca in v_prompt) = 0 then
        if position(v_ancora in v_prompt) = 0 then
            raise exception 'ancora da Bel nao encontrada no prompt publicado';
        end if;
        v_prompt := replace(v_prompt, v_ancora, v_regra || v_ancora);
    end if;

    select v.system_prompt = v_prompt and v.knowledge_source_ids @> v_fontes into v_ok
      from ai_agent_versions v where v.id = v_atual;
    if v_ok then
        raise notice 'Bel ja esta com a regra de anuncio e as fontes; nada a fazer';
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
           (select array_agg(distinct s) from unnest(coalesce(v.knowledge_source_ids, '{}') || v_fontes) s),
           v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
      from ai_agent_versions v join ai_agents a on a.id = v.agent_id
     where v.id = v_atual;

    perform * from fn_publish_ai_agent_version(v_org, v_agente, v_versao);

    insert into event_log (organization_id, event_type, entity_kind, payload)
    values (v_org, 'ai_agent.published', 'ai_agent',
            jsonb_build_object('agent_id', v_agente, 'version_id', v_versao, 'previous_version_id', v_atual,
                               'origem', 'base_bel'));
end $$;
