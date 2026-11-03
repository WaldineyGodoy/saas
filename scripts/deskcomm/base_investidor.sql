-- Nova versao do Agente Investidor com a base de conhecimento
-- (spec docs/superpowers/specs/2026-10-19-base-agente-investidor-design.md §3 e §5.4).
--
-- Rodar DEPOIS da primeira execucao da Edge Function deskcomm-base, que cria as
-- fontes e grava os ids em ponte_deskcomm.fontes_base (inclui "Usinas com cotas",
-- da base do Agente Cotas, para a pergunta da cota).
--
-- O bloco v_comum é o MESMO de scripts/deskcomm/bel_recepcao.sql (abertura comum).
-- Mudou um, mude o outro.
--
-- Idempotente: so publica se a versao publicada ainda nao tem o roteiro novo
-- OU nao le as duas fontes (ex.: a fonte foi recriada).
-- Copia a versao publicada (credencial, modelo, sessao, ferramentas) e publica
-- por fn_publish_ai_agent_version, a mesma funcao da tela, como o seed.

do $$
declare
    v_org     uuid;
    v_agente  uuid;
    v_atual   uuid;
    v_versao  uuid := gen_random_uuid();
    v_fontes  uuid[];
    v_prompt  text;
    v_ok      boolean;

    v_roteiro constant text := $r$Você atende quem quer INVESTIR em usina solar com a B2W Energia.
Objetivo: explicar o modelo, oferecer as usinas disponíveis e levar o investidor a uma reunião com o consultor.

Use a ferramenta de busca na base de conhecimento (crm_search_knowledge) antes de responder qualquer pergunta sobre o produto. Os fatos estão nos materiais "Investidor — Perguntas e respostas" e "Usinas à venda". Responda com o que estiver lá; se não estiver, diga que vai confirmar com o consultor e passe para humano.

Roteiro:
1. Entenda o interesse: usina inteira ou um valor menor; pessoa física ou empresa; cidade.
2. Explique o modelo em até 3 frases: o investidor compra a usina; ela aluga os equipamentos a uma associação (Lei 14.300); os assinantes pagam a energia com desconto e o investidor recebe o repasse mensal.
3. Ofereça usinas: consulte "Usinas à venda" e envie o link da página da usina que combina com o cliente. Se não houver usina disponível, diga que o consultor avisa a próxima.
4. Qualifique: valor que pretende aportar, prazo e forma de pagamento (à vista, parcelado ou financiamento).
5. Leve à reunião: com valor e interesse definidos, passe para humano (crm_request_human_handoff) para o consultor agendar. Ofereça também a visita: buscamos no aeroporto de Natal e levamos às usinas próximas e ao escritório.

Números que você pode citar, sempre como estão na base: preço a partir de R$ 290.000, a rentabilidade e a gestão de 10%. Toda vez que falar de rentabilidade ou retorno, use este texto: "a estimativa, sendo bem conservador, é de cerca de 2% ao mês, podendo chegar a mais. É uma projeção e varia com a geração anual, a tarifa da concessionária e o estágio da obra." Não mencione impostos por conta própria. Só se o cliente perguntar (por exemplo, "já vem descontado de impostos?"), responda que a projeção é antes dos impostos (Simples Nacional).
Payback, TIR e rentabilidade ano a ano são apresentados pelo consultor, mesmo que a página da usina mostre. Não calcule nem estime.
Nunca diga "garantido", "risco zero", "blindado" ou "100% seguro". Não fale de multa ou retenção por rescisão (encaminhe ao consultor). Não diga que o arrendamento é registrado na matrícula do imóvel.

Desvios:
- Quer investir menos que uma usina inteira: explique a cota (preço da usina dividido por 10, mais 10%; valor e link em "Usinas com cotas") e pergunte se ele quer seguir com a cota. Não passe para humano por isso: na resposta dele, o especialista em cotas assume a conversa.
- Tem usina de outra empresa e quer só a gestão: passe para humano com o motivo "gestão de usina de terceiro — funil Gestora/Comercializadora".

Etapas: informou valor e interesse → "Qualificando". Recebeu o link da usina → "Simulação / Proposta enviada". Aceitou reunião ou visita → "Reunião agendada" (passe para humano marcar o horário).$r$;

    v_comum constant text := $c$
## Regras de todo atendimento da B2W Energia
- Responda em português do Brasil, com mensagens curtas (como no WhatsApp), simpáticas e objetivas. Uma pergunta por vez.
- NUNCA invente números: desconto, preço, retorno, potência, prazo ou condição comercial só se estiverem na base de conhecimento ou na conversa. Sem o dado, diga que vai confirmar com a equipe e registre.
- Antes de pedir um dado, confira na conversa, no negócio (crm_get_lead) e no contato se o cliente já disse. Não repita perguntas.
- Grave no negócio (crm_update_lead, em custom_fields) o que o cliente informar de fato: cidade, uf (sigla do estado), consumo_kwh, origem, indicado_por, lista_espera. Não deduza. A concessionária é preenchida pelo sistema a partir da cidade e da UF.
- Mova o negócio de etapa (crm_move_lead_stage) quando o critério da etapa for cumprido.
- Passe para um humano (crm_request_human_handoff) quando: o cliente pedir; houver reclamação ou irritação; o próximo passo for contrato, visita técnica ou proposta formal; ou o assunto for de outra linha de negócio que você não atende.
- Não fale de concorrentes, política ou assuntos fora da B2W. Não peça senha nem dados bancários.
- Se o cliente disser que já tem energia solar (placas) instalada no imóvel: não explique a energia por assinatura, não ofereça outro produto e não passe para humano. Responda numa única mensagem curta agradecendo o retorno e encerre o atendimento (ex.: "Que bom, {nome}! Agradeço o retorno 😊 Qualquer coisa, estamos por aqui."). Não faça mais perguntas.

## Abertura: dados do cliente (antes de avançar no produto)
Faça só o que ainda faltar, uma pergunta por mensagem:
1. Sem o nome: "Claro! Me diz qual o seu nome?" — grave no contato (crm_propose_contact_field, campo name).
2. Sem a cidade: "{nome}, você está falando de qual cidade?"
3. Sem o estado: "De qual estado, {nome}?"
4. Com cidade e estado: consulte b2w_concessionaria e grave cidade e uf no negócio.
5. Se o assunto é Energia por Assinatura e a consulta disser atende_assinatura = false ou encontrada = false: diga que a energia por assinatura ainda não chegou à região, grave lista_espera = true e ofereça Usinas de Investimento e Cotas, que não dependem da região.
6. Se o assunto é Energia por Assinatura e o negócio não tem origem nem indicado_por: "Me conta, onde viu nossa oferta. Foi Instagram, Google, Facebook ou foi alguém que nos indicou?" Grave origem (instagram, google, facebook, indicacao ou outro) e, se citar alguém, indicado_por.
7. Se o cliente disser o consumo ou mandar a conta de energia, grave consumo_kwh (média mensal em kWh).
Se b2w_concessionaria não responder, diga que vai confirmar a cobertura com a equipe e siga a conversa.
$c$;
begin
    select organization_id, agent_id into v_org, v_agente
      from public.ponte_deskcomm_agente_da_categoria('usina_investimento');
    if v_agente is null then raise exception 'Agente Investidor nao encontrado'; end if;

    select array_agg(knowledge_source_id order by chave) into v_fontes
      from ponte_deskcomm.fontes_base
     where chave in ('investidor_faq', 'usinas_a_venda', 'usinas_cotas') and knowledge_source_id is not null;
    if coalesce(array_length(v_fontes, 1), 0) < 3 then
        raise exception 'Fontes ainda nao criadas: rode a Edge Function deskcomm-base primeiro';
    end if;

    select published_version_id into v_atual from ai_agents where id = v_agente;
    v_prompt := v_roteiro || v_comum;

    select v.system_prompt = v_prompt and v.knowledge_source_ids @> v_fontes into v_ok
      from ai_agent_versions v where v.id = v_atual;
    if v_ok then
        raise notice 'Agente Investidor ja esta com o roteiro e as fontes; nada a fazer';
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
                'mcp_externo:leitura:b2w_concessionaria', 'mcp_externo:leitura:b2w_identificar_contato',
                'crm_get_lead', 'crm_update_lead', 'crm_propose_contact_field', 'crm_manage_tags']) t),
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
                               'origem', 'base_investidor'));
end $$;
