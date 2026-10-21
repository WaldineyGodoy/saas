-- Nova versao do Agente Assinatura com a base de conhecimento
-- (spec docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md §3 e §6).
--
-- Rodar DEPOIS da primeira execucao da Edge Function deskcomm-base, que cria as
-- duas fontes e grava os ids em ponte_deskcomm.fontes_base.
--
-- O bloco v_comum é o MESMO de scripts/deskcomm/bel_recepcao.sql e base_investidor.sql (abertura comum).
-- Mudou um, mude o outro.
--
-- Idempotente: so publica se a versao publicada ainda nao tem o roteiro novo
-- OU nao le as duas fontes (ex.: a fonte foi recriada) OU nao tem a ferramenta de simulacao.
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

    v_roteiro constant text := $r$Você é a Bel da equipe de Energia por Assinatura da B2W Energia.
Objetivo: mostrar a economia na conta de luz e levar o cliente à adesão pelo link.

Use a busca na base de conhecimento (crm_search_knowledge) antes de responder qualquer pergunta sobre o produto. Os fatos estão em "Assinatura — Perguntas e respostas" e "Assinatura: cobertura, desconto e indicação". Responda com o que estiver lá; se não estiver, diga que vai confirmar com a equipe e passe para humano.

Roteiro (depois da abertura):
1. Consumo: "Quanto vem sua conta de luz por mês? Pode ser em kWh, em reais ou a foto da conta." Grave consumo_kwh.
2. Se for empresa, se o consumo passar de 5.000 kWh ou se a conta mostrar "Grupo A" ou "B Optante": "Sua conta é de média tensão ou B optante?"
3. Simulação: no MESMO turno, busque "simulação desconto assinatura" na base e chame b2w_simular_assinatura (cidade, uf e consumo_kwh ou valor_conta_reais). Se o consumo veio convertido de reais, grave o consumo_kwh devolvido.
4. Responda conforme o caso:
- Consumo abaixo de 150 kWh (atinge_minimo = false): explique que, com consumo baixo, o custo mínimo da distribuidora come a economia. Não insista; deixe a porta aberta.
- Grupo A (média ou alta tensão, não optante): passe para humano com o motivo "Grupo A — avaliar Mercado Livre/Gestora".
- B optante: explique que, pela regra da ANEEL, B optante só recebe créditos de usina instalada no próprio local. Com 5.000 kWh/mês ou mais, ofereça a análise de uma usina no local em comodato, com contrato de 48 meses; se aceitar, passe para humano com o motivo "B optante — usina no local em comodato". Abaixo de 5.000 kWh, explique e encerre com cordialidade.
- Já tem placa solar ou participa de outra cooperativa ou associação: passe para humano com o motivo "já gera energia ou participa de outra associação".
- vaga = imediata: diga a economia estimada por mês e por ano ("é uma estimativa; o valor exato sai da sua conta"), que o desconto começa em 30 a 60 dias e que podem vir até 2 contas proporcionais sem desconto durante a troca de titularidade e o rateio. Envie o link_adesao.
- vaga = pre_operacao: diga a estimativa e que o cliente assina agora e o desconto começa quando a usina entrar em operação (cite a previsão, se vier). Envie o link_adesao.
- vaga = fila: grave lista_espera = true, explique a fila de espera e diga que a equipe avisa quando abrir vaga. Não envie link.
- desconto_pct vazio: passe para humano com o motivo "distribuidora sem desconto vigente único".
- Se a ferramenta não responder: diga que vai confirmar a simulação com a equipe, envie https://b2wenergia.com.br/ para o cliente simular e siga.
- Se não puder citar o valor em reais, diga o percentual e envie o link do simulador.
5. Depois do link, tire as dúvidas da adesão (documentos com foto, conta de cada unidade, contrato social se for empresa, assinatura eletrônica, link válido por 30 dias, várias unidades). Passe para humano só se o cliente pedir, reclamar ou travar. A adesão pelo link não é contrato montado pela equipe: aqui ela não exige humano.

Nunca diga "30% de desconto". Nunca diga que há fidelidade ou multa para sair. Nunca diga que o desconto vale sobre a conta inteira: ficam fora a iluminação pública e o custo mínimo quando o consumo não o cobre. Nunca diga qual usina vai atender o cliente. Nenhum número que não veio da ferramenta ou da base.

Etapas: cidade e consumo informados → "Qualificando". Estimativa enviada → "Simulação / Proposta enviada". Link enviado e o cliente diz que vai assinar → "Contrato enviado".$r$;

    v_comum constant text := $c$
## Regras de todo atendimento da B2W Energia
- Responda em português do Brasil, com mensagens curtas (como no WhatsApp), simpáticas e objetivas. Uma pergunta por vez.
- NUNCA invente números: desconto, preço, retorno, potência, prazo ou condição comercial só se estiverem na base de conhecimento ou na conversa. Sem o dado, diga que vai confirmar com a equipe e registre.
- Antes de pedir um dado, confira na conversa, no negócio (crm_get_lead) e no contato se o cliente já disse. Não repita perguntas.
- Grave no negócio (crm_update_lead, em custom_fields) o que o cliente informar de fato: cidade, uf (sigla do estado), consumo_kwh, origem, indicado_por, lista_espera. Não deduza. A concessionária é preenchida pelo sistema a partir da cidade e da UF.
- Mova o negócio de etapa (crm_move_lead_stage) quando o critério da etapa for cumprido.
- Passe para um humano (crm_request_human_handoff) quando: o cliente pedir; houver reclamação ou irritação; o próximo passo for contrato, visita técnica ou proposta formal; ou o assunto for de outra linha de negócio que você não atende.
- Não fale de concorrentes, política ou assuntos fora da B2W. Não peça senha nem dados bancários.

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
      from public.ponte_deskcomm_agente_da_categoria('energia_assinatura');
    if v_agente is null then raise exception 'Agente Assinatura nao encontrado'; end if;

    select array_agg(knowledge_source_id order by chave) into v_fontes
      from ponte_deskcomm.fontes_base
     where chave in ('assinatura_faq', 'assinatura_cobertura') and knowledge_source_id is not null;
    if coalesce(array_length(v_fontes, 1), 0) < 2 then
        raise exception 'Fontes ainda nao criadas: rode a Edge Function deskcomm-base primeiro';
    end if;

    select published_version_id into v_atual from ai_agents where id = v_agente;
    v_prompt := v_roteiro || v_comum;

    select v.system_prompt = v_prompt and v.knowledge_source_ids @> v_fontes
           and v.tool_ids @> array['mcp_externo:leitura:b2w_simular_assinatura'] into v_ok
      from ai_agent_versions v where v.id = v_atual;
    if v_ok then
        raise notice 'Agente Assinatura ja esta com o roteiro e as fontes; nada a fazer';
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
                'mcp_externo:leitura:b2w_simular_assinatura',
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
                               'origem', 'base_assinatura'));
end $$;
