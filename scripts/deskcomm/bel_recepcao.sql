-- Bel v3 + abertura comum nos 7 especialistas + membro "suporte" no roteador
-- (spec docs/superpowers/specs/2026-10-20-bel-recepcao-design.md §5 e §9).
--
-- Pré-requisitos:
--   1. migration 20261020c_bel_recepcao.sql (RPCs do b2w-mcp, ponte dos campos);
--   2. scripts/deskcomm/campos_funis.sql (campos declarados nos funis);
--   3. Edge Function b2w-mcp publicada e cadastrada no Deskcomm como servidor
--      MCP externo (Configurações › Servidor MCP externo: endereço + chave
--      B2W_MCP_TOKEN). Sem o cadastro as ferramentas b2w_* não carregam e o
--      agente segue sem elas ("vou confirmar com a equipe").
--
-- O que faz (idempotente: só publica versão nova quando o prompt muda):
--   - troca o bloco "## Regras de todo atendimento" (até "## Conhecimento
--     geral", se houver) pelo bloco novo com a Abertura, nos 8 agentes;
--   - Bel ganha o roteiro de recepção novo e divisão de mensagens desligada;
--   - todos ganham as ferramentas mcp_externo:leitura:b2w_concessionaria e
--     b2w_identificar_contato, e ai_agents.config.mcp_externo_no_atendimento,
--     para o Deskcomm mandar o telefone do contato no cabeçalho;
--   - roteador ganha o membro "suporte" (cliente ativo com fatura/boleto/
--     contrato), atendido pela Bel com passagem a humano até existir o
--     Agente Suporte.
--
-- O bloco v_comum abaixo é o MESMO de scripts/deskcomm/base_investidor.sql.
-- Mudou um, mude o outro.

do $$
declare
    v_org     uuid := (select id from organizations order by created_at limit 1);
    v_router  uuid;
    a         record;
    v_versao  uuid;
    v_prompt  text;
    v_resto   text;
    v_pos     int;
    v_tools   text[];

    v_ferramentas constant text[] := array[
        'mcp_externo:leitura:b2w_concessionaria',
        'mcp_externo:leitura:b2w_identificar_contato'];

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

    v_bel constant text := $b$Você é a Bel, assistente virtual da B2W Energia, e faz a Recepção do WhatsApp. Seu trabalho é acolher, saber quem é a pessoa e descobrir o que ela procura. Quando o produto ficar claro, o especialista daquele produto assume a conversa automaticamente — não diga que vai "transferir"; apenas siga.

Na sua primeira resposta, chame b2w_identificar_contato e escolha a abertura:
- tipo cliente_ativo: "Oi, {primeiro_nome}! Vi que você já é nossa cliente 😊 Em que posso ajudar?" Não diga qual produto ela tem. Se o assunto for fatura, boleto, contrato, repasse ou aplicativo, passe para humano (crm_request_human_handoff) com o motivo "suporte".
- tipo lead_retorno: "Oi, tudo bem? Vamos continuar?" e retome de onde parou, sem repetir o que já foi respondido.
- tipo novo, ou se a ferramenta não responder: "Oi, tudo bem? Bom dia! Em que posso ajudar?" (troque por "Boa tarde" ou "Boa noite" conforme o horário de Brasília).

Depois da resposta do cliente, siga a Abertura (nome, cidade, estado). Com nome, cidade e estado, se o produto ainda não estiver claro, pergunte: "Me conta, {nome}: você quer economizar na conta de luz ou investir conosco?" Não mande lista de produtos. Só fale das outras linhas (eletropostos, arrendamento de área, cotas, gestão/comercializadora, locação de vagas) se o cliente puxar o assunto.

Quem não é cliente nem lead — propaganda, oferta de serviço ou produto para a B2W, currículo ou vaga de emprego, engano de número: responda uma única vez "Obrigada pelo contato! Este canal é para atendimento comercial da B2W Energia.", marque o contato com a tag nao_lead (crm_manage_tags, alvo contact) e não continue a conversa.

Formato: uma única mensagem por resposta, curta, sem listas numeradas.

As linhas de negócio da B2W Energia (para você entender o cliente, não para listar):
- Energia por Assinatura: desconto na conta de luz, sem obra e sem instalar placas.
- Usinas de Investimento: investir em usina solar para ter renda.
- Cotas: comprar uma fração de uma usina de investimento.
- Eletropostos: recarga de carro elétrico e parceria para ter um eletroposto (rede VOLT).
- Áreas de Arrendamento: arrendar um terreno para usina solar.
- Gestora / Comercializadora: donos de usina que querem fornecer energia para a B2W. Não atende quem quer desconto na conta de luz (pessoa física ou empresa): isso é Energia por Assinatura.
- Locação de Vagas: alugar ou oferecer vagas de estacionamento.
$b$;
begin
    if v_org is null then raise exception 'sem organizacao'; end if;

    for a in
        select ag.id, ag.name, ag.created_by, ag.published_version_id, v.system_prompt, v.tool_ids
          from ai_agents ag join ai_agent_versions v on v.id = ag.published_version_id
         where ag.organization_id = v_org and ag.archived_at is null
           and (ag.name = 'Bel' or ag.name like 'Agente %')
    loop
        -- Conhecimento geral (só a Bel tem) fica depois das regras.
        v_pos := position(E'\n## Conhecimento geral' in a.system_prompt);
        v_resto := case when v_pos > 0 then substr(a.system_prompt, v_pos) else '' end;

        if a.name = 'Bel' then
            v_prompt := v_bel || v_comum || v_resto;
        else
            v_pos := position(E'\n## Regras de todo atendimento' in a.system_prompt);
            if v_pos = 0 then
                raise notice '% sem bloco de regras; prompt mantido, só a abertura acrescentada', a.name;
                v_prompt := a.system_prompt || v_comum;
            else
                v_prompt := substr(a.system_prompt, 1, v_pos - 1) || v_comum || v_resto;
            end if;
        end if;

        select array_agg(distinct t) into v_tools
          from unnest(a.tool_ids || v_ferramentas
                      || array['crm_get_lead', 'crm_update_lead', 'crm_propose_contact_field', 'crm_manage_tags']) t;

        update ai_agents set config = coalesce(config, '{}'::jsonb) || '{"mcp_externo_no_atendimento": true}'
         where id = a.id and coalesce((config->>'mcp_externo_no_atendimento')::boolean, false) = false;

        if v_prompt = a.system_prompt and v_tools @> a.tool_ids and a.tool_ids @> v_tools
           and (a.name <> 'Bel' or (select not split_messages from ai_agent_versions where id = a.published_version_id)) then
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
               v_prompt, v.provider, v.model, v.credential_id, v_tools,
               v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
               v.history_message_window, v.history_token_window, v.handoff_keywords, true, 'draft',
               a.created_by, v.followup, v.multimodal_input, v.video_frames_enabled,
               case when a.name = 'Bel' then false else v.split_messages end, v.split_max_chars,
               v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
               v.knowledge_source_ids, v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
          from ai_agent_versions v where v.id = a.published_version_id;

        perform * from fn_publish_ai_agent_version(v_org, a.id, v_versao);

        insert into event_log (organization_id, event_type, entity_kind, payload)
        values (v_org, 'ai_agent.published', 'ai_agent',
                jsonb_build_object('agent_id', a.id, 'version_id', v_versao,
                                   'previous_version_id', a.published_version_id, 'origem', 'bel_recepcao'));
    end loop;

    -- Roteador: membro "suporte" atendido pela Bel (passa a humano).
    select r.id into v_router from ai_routers r where r.organization_id = v_org and r.name = 'Roteador B2W';
    if v_router is not null and not exists (
        select 1 from ai_router_members where router_id = v_router and intent_name = 'Suporte ao cliente') then
        insert into ai_router_members (organization_id, router_id, agent_id, intent_name, intent_description,
                                       examples, position)
        values (v_org, v_router, (select id from ai_agents where organization_id = v_org and name = 'Bel' and archived_at is null),
                'Suporte ao cliente',
                'Já é cliente da B2W (assinante, investidor ou parceiro) e fala de fatura, boleto, segunda via, contrato, repasse ou aplicativo.',
                array['minha fatura veio errada', 'preciso da segunda via do boleto', 'quando cai o repasse da usina?',
                      'não consigo entrar no aplicativo', 'quero cancelar meu contrato'],
                -- Sem funil de destino: o card não muda de funil por ser suporte.
                (select coalesce(max(position), 0) + 1 from ai_router_members where router_id = v_router));
    end if;
end $$;
