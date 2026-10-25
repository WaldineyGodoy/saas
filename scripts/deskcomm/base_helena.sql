-- Helena (Gestora / Comercializadora) v7: base de conhecimento e regras do fornecedor
-- (spec docs/superpowers/specs/2026-10-25-base-helena-gestora-design.md §6).
--
-- Rodar DEPOIS da primeira execucao da Edge Function deskcomm-base com as fontes da Gestora
-- (grava os ids em ponte_deskcomm.fontes_base).
--
-- CIRURGICO sobre a VERSAO PUBLICADA: o prompt de producao tem a persona ("## Quem você é");
-- regenerar pelo seed a apagaria. O script troca tres trechos exatos do roteiro, anexa as duas
-- fontes e publica por fn_publish_ai_agent_version. Idempotente: pula se o prompt ja tem a
-- regra, a versao ja le as duas fontes e as intencoes do roteador ja estao atualizadas.
-- Tambem ajusta as intencoes do roteador da Helena e do Leo (projeto no papel -> Leo).

do $$
declare
    v_org     uuid;
    v_agente  uuid;
    v_leo     uuid;
    v_atual   uuid;
    v_versao  uuid := gen_random_uuid();
    v_fontes  uuid[];
    v_prompt  text;
    v_ok      boolean;

    v_marca   constant text := 'Base da Gestora: antes de responder';
    v_fonte_a constant text := '3. Tipo de fonte (solar, eólica, hídrica, biomassa…) e potência instalada.';
    v_fonte_b constant text := '3. Confirme que a usina é solar (outra fonte: veja a regra de fontes) e anote a potência instalada.';
    v_sit_a   constant text := '4. Situação: operando, em construção ou em projeto; e se a conexão à rede já está aprovada.';
    v_sit_b   constant text := '4. Situação: operando ou em construção (neste caso, o prazo de entrega); e se a conexão à rede já está aprovada.';
    v_proib_a constant text := 'Não informe preço de compra de energia, volume mínimo nem condição comercial: isso é combinado pelo especialista.';
    v_proib_b constant text := $r$Base da Gestora: antes de responder dúvida do fornecedor (como funciona, o que a B2W aceita, repasse, Fio B, setup, carência), busque na base (crm_search_knowledge). Taxa de gestão, desconto do assinante, dia de repasse e de corte, custo de setup, carência e prazo até o primeiro repasse estão em "Gestora: planos vigentes". Só cite número que esteja na base; o que a base disser "ainda não definido" você nunca estima.
Como funciona: a B2W gerencia a usina em nome do dono (operação, rateio e cobrança dos assinantes) e repassa o resultado. Não compra nem aluga a energia.
Fontes e situação: só usina solar, de qualquer potência, operando ou em construção com prazo de entrega. Outra fonte (eólica, hídrica, biomassa): agradeça com leveza e encerre, sem passar para humano.
Projeto no papel: não siga com este atendimento. Pergunte se a pessoa quer falar com o Leo, de Usinas de Investimento, que tem uma proposta especial para construir a usina. Se aceitar, diga que o Leo continua a conversa e não faça mais perguntas de qualificação.
Repasse: o dono recebe pela energia COMPENSADA (a que abateu a conta dos assinantes), não pela injetada (a que a usina envia à rede); são grandezas diferentes, nunca diga que uma complementa a outra. O valor por kWh é a tarifa líquida do gerador: tarifa da concessionária, menos o desconto do assinante, menos o Fio B, menos a taxa de gestão. Explique a fórmula; só cite a taxa de gestão e o desconto se o fornecedor perguntar, dizendo que o especialista confirma o plano e o valor da usina dele. Fio B: explique o que é, sem dar percentual.
Setup, carência e prazo: antes de passar ao especialista, deixe claro que há custo de setup, carência dos pagamentos ao dono e prazo até o primeiro repasse. Cite os valores só se estiverem em "Gestora: planos vigentes"; se não estiverem definidos, diga que o especialista confirma e leve esse ponto no motivo da passagem.
Não afirme taxa de recuperação, retenção na rescisão, multas, valor do Fio B, documentos exigidos, prazo de implantação nem exclusividade: isso é do especialista. Passe para o especialista (crm_request_human_handoff) assim que tiver os dados básicos: responsável, empresa e CNPJ, cidade e estado, distribuidora, potência, situação e contato.$r$;

    v_int_h   constant text := 'Dono de usina solar, em operação ou em construção, que quer que a B2W gerencie a geração e repasse o resultado (fornecer energia). Não é para quem quer desconto na conta de luz (isso é Energia por Assinatura) nem para quem quer comprar usina (Usinas de Investimento).';
    v_int_l   constant text := 'Quer investir em usina solar para ter renda ou retorno financeiro. Também o dono de um projeto de usina solar ainda no papel que quer construir.';
begin
    select organization_id, agent_id into v_org, v_agente
      from public.ponte_deskcomm_agente_da_categoria('comercializadora');
    if v_agente is null then raise exception 'Helena nao encontrada'; end if;
    select agent_id into v_leo from public.ponte_deskcomm_agente_da_categoria('usina_investimento');

    select array_agg(knowledge_source_id order by chave) into v_fontes
      from ponte_deskcomm.fontes_base
     where chave in ('gestora_faq', 'gestora_planos') and knowledge_source_id is not null;
    if coalesce(array_length(v_fontes, 1), 0) < 2 then
        raise exception 'Fontes ainda nao criadas: rode a Edge Function deskcomm-base primeiro';
    end if;

    -- Intencoes do roteador (idempotente: so grava se mudou).
    update ai_router_members set intent_description = v_int_h, updated_at = now()
     where organization_id = v_org and agent_id = v_agente and intent_description is distinct from v_int_h;
    if v_leo is not null then
        update ai_router_members set intent_description = v_int_l, updated_at = now()
         where organization_id = v_org and agent_id = v_leo and intent_description is distinct from v_int_l;
    end if;

    select published_version_id into v_atual from ai_agents where id = v_agente;
    select system_prompt into v_prompt from ai_agent_versions where id = v_atual;

    if position(v_marca in v_prompt) = 0 then
        if position(v_fonte_a in v_prompt) = 0 or position(v_sit_a in v_prompt) = 0 or position(v_proib_a in v_prompt) = 0 then
            raise exception 'trechos do roteiro da Helena nao encontrados no prompt publicado';
        end if;
        v_prompt := replace(replace(replace(v_prompt, v_fonte_a, v_fonte_b), v_sit_a, v_sit_b), v_proib_a, v_proib_b);
    end if;

    select v.system_prompt = v_prompt and v.knowledge_source_ids @> v_fontes into v_ok
      from ai_agent_versions v where v.id = v_atual;
    if v_ok then
        raise notice 'Helena ja esta com as regras da Gestora e as fontes; nada a fazer';
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
                               'origem', 'base_helena'));
end $$;
