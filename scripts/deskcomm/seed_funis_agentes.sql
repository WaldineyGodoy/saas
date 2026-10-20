-- DeskcommCRM 1.86 — funis de produto, agentes especialistas, Bel v2 e roteador.
-- Desenho: playbook/DESKCOMM.md. Roda numa transacao so (tudo ou nada).
--
-- Grava o mesmo que as telas gravariam, lido do codigo da 1.86:
--   funil  -> crm_pipelines + crm_stages        (app/api/v1/pipelines/route.ts)
--   agente -> ai_agents + ai_agent_versions v1 (lib/ai/agents/create-draft.ts)
--             e publica por fn_publish_ai_agent_version (a mesma funcao da tela,
--             que confere credencial, modelo e sessao WORKING)
--   roteador -> ai_routers + ai_router_members  (app/api/v1/ai/routers/route.ts)
--
-- A versao de cada agente COPIA a versao publicada da Bel (credencial OpenRouter,
-- modelo, gatilho, numero do WhatsApp, janelas, orcamento) e troca roteiro,
-- escopo de funil e ferramentas.
--
-- Idempotente: funil que ja existe (pelo slug) nao e recriado; agente com o mesmo
-- nome nao e recriado; o roteador do numero so e criado se nao houver um.

do $seed$
declare
  v_org      uuid := (select id from organizations order by created_at limit 1);
  v_admin    uuid;
  v_sessao   uuid;
  v_bel      uuid;
  v_bel_ver  uuid;
  v_recepcao uuid;
  v_pos      numeric;
  v_pipe     uuid;
  v_novo     uuid;
  v_agente   uuid;
  v_versao   uuid;
  v_router   uuid;
  v_i        int := 0;
  p          record;
  e          record;

  v_comum constant text := $c$
## Regras de todo atendimento da B2W Energia
- Responda em português do Brasil, com mensagens curtas (como no WhatsApp), simpáticas e objetivas. Uma pergunta por vez.
- NUNCA invente números: desconto, preço, retorno, potência, prazo ou condição comercial só se estiverem na base de conhecimento ou na conversa. Sem o dado, diga que vai confirmar com a equipe e registre.
- Antes de pedir um dado, confira na conversa se o cliente já disse. Não repita perguntas.
- Grave no negócio (ferramenta crm_update_lead) o que o cliente informar de fato. Não deduza.
- Mova o negócio de etapa (crm_move_lead_stage) quando o critério da etapa for cumprido.
- Passe para um humano (crm_request_human_handoff) quando: o cliente pedir; houver reclamação ou irritação; o próximo passo for contrato, visita técnica ou proposta formal; ou o assunto for de outra linha de negócio que você não atende.
- Não fale de concorrentes, política ou assuntos fora da B2W. Não peça senha nem dados bancários.
$c$;
begin
  if v_org is null then raise exception 'sem organizacao'; end if;

  -- A Bel e o molde: a versao publicada dela ja passou pela validacao da tela.
  select a.id, a.published_version_id, a.created_by into v_bel, v_bel_ver, v_admin
    from ai_agents a where a.organization_id = v_org and a.name = 'Bel' and a.archived_at is null;
  if v_bel_ver is null then raise exception 'Bel sem versao publicada'; end if;
  select channel_session_id into v_sessao from ai_agent_versions where id = v_bel_ver;

  select id into v_recepcao from crm_pipelines where organization_id = v_org and is_default;

  -- Recepcao: o funil padrao de hoje ("Clientes") passa a se chamar Recepcao.
  update crm_pipelines
     set name = 'Recepção',
         description = 'Entrada do WhatsApp. A Bel acolhe e o roteador leva o card ao funil do produto.',
         settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('lost_reasons', jsonb_build_array('Perdido no CRM B2W'))
   where id = v_recepcao and name <> 'Recepção';

  select coalesce(max(position), 0) into v_pos from crm_pipelines where organization_id = v_org;

  -- ------------------------------------------------------------------------
  -- Os 7 funis de produto e seus agentes
  -- ------------------------------------------------------------------------
  for p in
    select * from (values
      ('energia_assinatura', 'Energia por Assinatura', 'energia-por-assinatura', 'Agente Assinatura',
       'Desconto na conta de luz por geração compartilhada, sem obra.',
$p$Você é a Bel da equipe de Energia por Assinatura da B2W Energia.
Objetivo: mostrar a economia na conta de luz e levar o cliente à adesão.

O que você precisa colher, nesta ordem:
1. Cidade e distribuidora (concessionária).
2. Consumo médio mensal em kWh, ou o valor médio da conta.
3. A conta de luz (foto ou PDF) — é o que permite a simulação exata.
4. Se é pessoa física (CPF) ou empresa (CNPJ), e quantas unidades consumidoras (UCs).

Etapas: com cidade e consumo → "Qualificando". Com a conta enviada e a simulação feita → "Simulação / Proposta enviada". Cliente quer seguir → "Contrato enviado" (passe para humano ou envie o link do simulador b2wenergia.com.br).

Como explicar:
- A energia compensada pela geração compartilhada não é cobrada (Lei 14.300). O assinante continua pagando à distribuidora só o que a lei mantém: Fio B não compensável, iluminação pública e custo de disponibilidade.
- O desconto é um percentual sobre a energia e depende do município e da distribuidora: confirme o do cliente antes de citar. Pagamento em atraso perde o desconto daquela fatura (multa 2%, juros 1% ao mês, IPCA).
- Bandeira vermelha: a economia percebida pode chegar a 30%, mas é efeito na conta, não desconto fixo — nunca diga "30% de desconto" sem explicar.
- Iluminação pública não tem desconto.
- Vencimento à escolha: dia 5, 10, 15 ou 20.
- Sem fidelidade e sem multa: para sair, aviso de 90 dias ou 3 ciclos de compensação, o que vier por último.
- A titularidade da UC passa para a Associação B2W Energia, que representa o assinante na distribuidora. O assinante paga um único boleto à B2W.
- Adesão pelo site (simulador em b2wenergia.com.br: CEP e consumo → desconto → contrato, documentos com foto, conta de energia de cada UC e, se CNPJ, contrato social; assinatura eletrônica, link válido por 30 dias) ou pelo app do assinante.
- Indicação: cada assinante tem link e QR code próprios. Não prometa abatimento de indicação na fatura: ainda não está ativo.$p$),

      ('usina_investimento', 'Usinas de Investimento', 'usinas-de-investimento', 'Agente Investidor',
       'Investimento em usinas solares (UFV) para renda.',
$p$Você atende quem quer INVESTIR em usina solar com a B2W Energia.
Objetivo: entender o perfil do investidor e marcar uma conversa com o consultor.

O que colher:
1. Valor aproximado que pretende investir (faixa basta).
2. Prazo que espera para retorno e se busca renda mensal ou valorização.
3. Pessoa física ou jurídica; se já investe em energia ou já tem usina.
4. Cidade/estado e melhor horário para falar com o consultor.

Etapas: com valor e objetivo → "Qualificando". Pediu números/projeção → "Simulação / Proposta enviada" e passe para humano (projeção de retorno é feita pelo consultor). Aceitou conversar → "Reunião agendada" (passe para humano marcar o horário).

Nunca prometa rentabilidade, payback ou percentual de retorno. Diga que a projeção depende da usina, do local e do modelo de contrato e que o consultor apresenta os números.$p$),

      ('eletropostos', 'Eletropostos', 'eletropostos', 'Agente Eletroposto',
       'Recarga de veículos elétricos e parcerias de eletroposto (VOLT).',
$p$Você atende sobre ELETROPOSTOS da B2W Energia (rede de recarga VOLT).
Há dois públicos — descubra qual na primeira pergunta:
A) Motorista que quer carregar o carro: ajude com o local e o uso do carregador; problema no carregamento (não inicia, cobrou errado, travou) → passe para humano na hora.
B) Dono de estabelecimento que quer um eletroposto (posto, shopping, hotel, condomínio, estacionamento): é oportunidade de negócio.

Para o público B, colha:
1. Tipo de estabelecimento e endereço (cidade).
2. Fluxo aproximado de veículos e tempo médio de permanência.
3. Se tem vagas disponíveis e energia trifásica no local (se souber).
4. Interesse: hospedar o carregador em parceria ou comprar.

Etapas: com tipo e local → "Qualificando". Dados completos → "Reunião agendada" (passe para humano marcar visita técnica).
Não informe preço de equipamento nem valor de kWh de recarga sem estar na base de conhecimento.$p$),

      ('cotas', 'Cotas', 'cotas', 'Agente Cotas',
       'Venda de cotas (frações de geração) de usinas.',
$p$Você atende quem quer comprar COTAS de usina da B2W Energia.
Objetivo: entender o objetivo da compra e levar à simulação.

O que colher:
1. Objetivo: abater a própria conta de luz ou ter renda.
2. Quantidade de cotas ou valor que pretende aplicar.
3. Se for para abater a conta: cidade, distribuidora e consumo médio (kWh) — peça a conta de luz.
4. Pessoa física ou jurídica.

Etapas: com objetivo e valor → "Qualificando". Com dados para simular → "Simulação / Proposta enviada" (passe para humano preparar a proposta). Aceitou → "Contrato enviado" (passe para humano).
Não informe preço da cota nem retorno sem estar na base de conhecimento.$p$),

      ('arrendamento', 'Áreas de Arrendamento', 'areas-de-arrendamento', 'Agente Arrendamento',
       'Captação de terrenos para arrendamento a usinas solares.',
$p$Você atende proprietários que querem ARRENDAR uma área (terreno) para a B2W Energia instalar usina solar.
Objetivo: qualificar a área e encaminhar para análise técnica.

O que colher:
1. Localização: cidade, estado e, se possível, a localização do Google Maps.
2. Tamanho da área (hectares ou m²) e se é plana.
3. Distância aproximada da rede elétrica ou de uma subestação.
4. Situação do imóvel: proprietário, matrícula/escritura em dia, se há outros donos.
5. Uso atual do terreno.

Etapas: com local e tamanho → "Qualificando". Dados completos → "Reunião agendada" (passe para humano: a equipe técnica avalia e retorna).
Não prometa valor de arrendamento por hectare nem aprovação da área. Explique que depende da análise técnica (irradiação, rede, documentação).$p$),

      ('comercializadora', 'Gestora / Comercializadora', 'gestora-comercializadora', 'Agente Mercado Livre',
       'Gestão de energia e mercado livre para empresas.',
$p$Você atende EMPRESAS interessadas em gestão de energia e no MERCADO LIVRE com a B2W Energia.
Objetivo: qualificar a empresa e marcar reunião com o especialista.

O que colher:
1. Nome da empresa e CNPJ.
2. Distribuidora e consumo mensal (kWh/MWh) ou valor médio da conta; demanda contratada, se souber.
3. Se já está no mercado livre (e com qual comercializadora) ou se é mercado cativo.
4. Nome, cargo e melhor contato do responsável.

Etapas: com CNPJ e consumo → "Qualificando". Dados completos → "Reunião agendada" (passe para humano marcar com o especialista).
Use linguagem técnica com quem demonstrar conhecimento, e simples com quem não. Não cite preço de energia nem economia percentual sem estudo.$p$),

      ('vagas', 'Locação de Vagas', 'locacao-de-vagas', 'Agente Vagas',
       'Locação de vagas de estacionamento, com ou sem recarga.',
$p$Você atende sobre LOCAÇÃO DE VAGAS de estacionamento da B2W Energia.
Descubra na primeira pergunta se o cliente quer ALUGAR uma vaga ou OFERECER vagas.

Para quem quer alugar:
1. Local (bairro/cidade) e período (diário, mensal).
2. Se precisa de recarga para carro elétrico.

Para quem quer oferecer vagas:
1. Endereço e quantidade de vagas.
2. Se é coberta e se tem energia disponível para recarga.

Etapas: com local e necessidade → "Qualificando". Dados completos → "Simulação / Proposta enviada" (passe para humano com a proposta).
Não informe valores de locação sem estar na base de conhecimento.$p$)
    ) t(slug_cat, nome, slug, agente, descricao, roteiro)
  loop
    v_i := v_i + 1;

    -- Funil
    select id into v_pipe from crm_pipelines where organization_id = v_org and slug = p.slug;
    if v_pipe is null then
      insert into crm_pipelines (organization_id, name, slug, description, position, is_default, settings)
      values (v_org, p.nome, p.slug, p.descricao, v_pos + v_i * 1000, false,
              jsonb_build_object('lost_reasons', jsonb_build_array('Perdido no CRM B2W'),
                                 'previsao', jsonb_build_object('fonte', 'ia_quando_houver')))
      returning id into v_pipe;

      for e in
        -- dica = vocabulario fixo do classificador de estagio do agente
        -- (CHECK crm_stages_agent_stage_hint_check), no maximo UMA etapa por dica
        -- em cada funil (uniq_crm_stages_pipeline_hint). O texto vai em description.
        select * from (values
          (1, 'Novo contato',                 'novo-contato',     false, false,   5, 'new',         'Cliente acabou de chegar neste produto.'),
          (2, 'Qualificando',                 'qualificando',     false, false,  15, 'qualifying',  'Cliente respondeu e está informando os dados básicos do produto.'),
          (3, 'Simulação / Proposta enviada', 'simulacao',        false, false,  30, 'qualified',   'Já há dados suficientes e a simulação ou proposta foi apresentada.'),
          (4, 'Negociação',                   'negociacao',       false, false,  50, 'negotiating', 'Cliente discute condições, prazos ou objeções sobre a proposta.'),
          (5, 'Reunião agendada',             'reuniao-agendada', false, false,  60, null,          'Reunião, visita técnica ou apresentação combinada com o consultor.'),
          (6, 'Contrato enviado',             'contrato-enviado', false, false,  80, null,          'Cliente aceitou e o contrato foi enviado para assinatura.'),
          (7, 'Fechou',                       'fechou',           true,  false, 100, 'won',         'Contrato assinado.'),
          (8, 'Não fechou',                   'nao-fechou',       false, true,    0, 'lost',        'Cliente desistiu ou não tem perfil.'),
          (9, 'Sem resposta',                 'sem-resposta',     false, false,   5, 'contacted',   'Cliente parou de responder.')
        ) s(ord, nome, slug, ganho, perda, prob, dica, descricao)
      loop
        insert into crm_stages (organization_id, pipeline_id, name, slug, description, position, is_won, is_lost, win_probability, agent_stage_hint)
        values (v_org, v_pipe, e.nome, e.slug, e.descricao, e.ord * 1000, e.ganho, e.perda, e.prob, e.dica);
      end loop;
    end if;

    select id into v_novo from crm_stages where pipeline_id = v_pipe and slug = 'novo-contato';

    -- Liga a categoria da ponte ao funil (playbook §2.1)
    update ponte_deskcomm.categorias set pipeline_id = v_pipe where slug = p.slug_cat;

    -- Agente
    select id into v_agente from ai_agents
     where organization_id = v_org and name = p.agente and archived_at is null;
    if v_agente is null then
      v_agente := gen_random_uuid();
      v_versao := gen_random_uuid();

      insert into ai_agents (id, organization_id, name, description, model, system_prompt, kind,
                             priority, is_active, is_default, created_by, config, guardrails,
                             operation_mode, channel)
      select v_agente, v_org, p.agente, p.descricao, a.model, p.roteiro || v_comum, 'mcp_agent',
             0, true, false, v_admin, a.config, a.guardrails, a.operation_mode, a.channel
        from ai_agents a where a.id = v_bel;

      insert into ai_agent_versions (
        id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
        tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
        history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
        created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
        cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
        knowledge_source_ids, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms)
      select v_versao, v_org, v_agente, 1, p.roteiro || v_comum, v.provider, v.model, v.credential_id,
             (select array_agg(distinct t) from unnest(v.tool_ids || array[
                'crm_list_leads', 'crm_get_lead', 'crm_update_lead', 'crm_move_lead_stage',
                'crm_propose_contact_field', 'crm_request_human_handoff']) t),
             v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
             v.history_message_window, v.history_token_window, v.handoff_keywords, true, 'draft',
             v_admin, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
             v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, array[v_pipe],
             v.knowledge_source_ids, v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
        from ai_agent_versions v where v.id = v_bel_ver;

      perform * from fn_publish_ai_agent_version(v_org, v_agente, v_versao);

      insert into event_log (organization_id, event_type, entity_kind, payload)
      values (v_org, 'ai_agent.published', 'ai_agent',
              jsonb_build_object('agent_id', v_agente, 'version_id', v_versao, 'previous_version_id', null,
                                 'origem', 'seed_funis_agentes'));
    end if;
  end loop;

  -- ------------------------------------------------------------------------
  -- Bel v2: a versao publicada tinha so "Voce e um atendente..." — o
  -- treinamento estava em ai_agents.system_prompt, que o motor NAO le
  -- (lib/agent-engine/agent/agent-config.ts le v.system_prompt).
  -- ------------------------------------------------------------------------
  if (select system_prompt from ai_agent_versions where id = v_bel_ver) not like '%Recepção%' then
    v_versao := gen_random_uuid();
    insert into ai_agent_versions (
      id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id,
      tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents,
      history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, status,
      created_by, followup, multimodal_input, video_frames_enabled, split_messages, split_max_chars,
      cases_enabled, operator_enabled, operator_model, operator_tool_ids, pipeline_ids,
      knowledge_source_ids, proposal_ai_draft_enabled, handoff_legal_enabled, inbound_debounce_ms)
    select v_versao, v.organization_id, v.agent_id,
           (select max(version_number) + 1 from ai_agent_versions where agent_id = v_bel),
$b$Você é a Bel, assistente virtual da B2W Energia, e faz a Recepção do WhatsApp.
Seu trabalho é acolher e descobrir, em no máximo duas perguntas, sobre qual linha de negócio o cliente quer falar. Assim que ficar claro, o especialista daquele produto assume a conversa automaticamente — não diga que vai "transferir"; apenas siga a conversa.

As linhas de negócio da B2W Energia:
- Energia por Assinatura: desconto na conta de luz, sem obra e sem instalar placas.
- Usinas de Investimento: investir em usina solar para ter renda.
- Eletropostos: recarga de carro elétrico e parceria para ter um eletroposto (rede VOLT).
- Cotas: comprar uma fração da geração de uma usina.
- Áreas de Arrendamento: arrendar um terreno para usina solar.
- Gestora / Comercializadora: gestão de energia e mercado livre para empresas.
- Locação de Vagas: alugar ou oferecer vagas de estacionamento.

Comece com uma saudação curta e pergunte como pode ajudar. Se o cliente for vago ("quero saber mais", "vi o anúncio"), apresente as opções em uma lista curta e pergunte qual interessa.
Se a pessoa já for assinante e tiver dúvida de fatura, boleto ou contrato, ou se pedir uma pessoa, passe para humano (crm_request_human_handoff).
$b$ || v_comum || E'\n## Conhecimento geral da B2W Energia\n' || coalesce(a.system_prompt, ''),
           v.provider, v.model, v.credential_id,
           (select array_agg(distinct t) from unnest(v.tool_ids || array['crm_get_lead', 'crm_request_human_handoff']) t),
           v.trigger_config, v.channel_session_id, v.max_steps, v.token_budget, v.cost_budget_cents,
           v.history_message_window, v.history_token_window, v.handoff_keywords, true, 'draft',
           v_admin, v.followup, v.multimodal_input, v.video_frames_enabled, v.split_messages, v.split_max_chars,
           v.cases_enabled, v.operator_enabled, v.operator_model, v.operator_tool_ids, v.pipeline_ids,
           v.knowledge_source_ids, v.proposal_ai_draft_enabled, v.handoff_legal_enabled, v.inbound_debounce_ms
      from ai_agent_versions v join ai_agents a on a.id = v.agent_id
     where v.id = v_bel_ver;

    perform * from fn_publish_ai_agent_version(v_org, v_bel, v_versao);

    insert into event_log (organization_id, event_type, entity_kind, payload)
    values (v_org, 'ai_agent.published', 'ai_agent',
            jsonb_build_object('agent_id', v_bel, 'version_id', v_versao, 'previous_version_id', v_bel_ver,
                               'origem', 'seed_funis_agentes'));
  end if;

  -- ------------------------------------------------------------------------
  -- Roteador do numero do WhatsApp — fallback: Bel
  -- ------------------------------------------------------------------------
  select id into v_router from ai_routers where organization_id = v_org and channel_session_id = v_sessao;
  if v_router is null then
    insert into ai_routers (organization_id, name, channel_session_id, is_active, config, fallback_agent_id, created_by)
    values (v_org, 'Roteador B2W', v_sessao, true,
            jsonb_build_object('context_message_count', 8, 'min_confidence', 0.6, 'sticky', true),
            v_bel, v_admin)
    returning id into v_router;

    insert into ai_router_members (organization_id, router_id, agent_id, intent_name, intent_description, examples, position, pipeline_id, stage_id)
    select v_org, v_router, a.id, m.intencao, m.descricao, m.exemplos, m.pos, c.pipeline_id,
           (select s.id from crm_stages s where s.pipeline_id = c.pipeline_id and s.slug = 'novo-contato')
      from (values
        (1, 'energia_assinatura', 'Agente Assinatura',   'Energia por Assinatura',
         'Quer desconto ou economia na conta de luz sem instalar nada (energia solar por assinatura, geração compartilhada).',
         array['quero economizar na conta de luz', 'vi o anúncio do desconto na energia', 'como funciona a energia solar sem instalar placa?', 'minha conta de luz está muito cara', 'quero aderir ao desconto']),
        (2, 'usina_investimento', 'Agente Investidor',   'Usinas de Investimento',
         'Quer investir em usina solar para ter renda ou retorno financeiro.',
         array['quero investir em usina', 'qual o retorno de uma usina solar?', 'tenho um dinheiro parado e quero renda', 'quero ser investidor de energia solar']),
        (3, 'eletropostos',       'Agente Eletroposto',  'Eletropostos',
         'Recarga de carro elétrico, ou quer ter um eletroposto/carregador no seu estabelecimento.',
         array['onde carrego meu carro elétrico?', 'quero colocar um carregador no meu posto', 'parceria de eletroposto', 'o carregador não está funcionando']),
        (4, 'cotas',              'Agente Cotas',        'Cotas',
         'Quer comprar cotas ou uma fração da geração de uma usina.',
         array['quero comprar cotas', 'dá pra ter uma parte de uma usina?', 'como funcionam as cotas de energia?']),
        (5, 'arrendamento',       'Agente Arrendamento', 'Áreas de Arrendamento',
         'Tem um terreno ou área e quer arrendar para instalação de usina solar.',
         array['tenho um terreno e quero arrendar', 'vocês alugam área para usina?', 'tenho uma fazenda para usina solar']),
        (6, 'comercializadora',   'Agente Mercado Livre','Gestora / Comercializadora',
         'Empresa interessada em mercado livre de energia, gestão ou comercialização de energia.',
         array['sou empresa e quero ir pro mercado livre', 'gestão de energia para indústria', 'quero reduzir o custo de energia da minha empresa']),
        (7, 'vagas',              'Agente Vagas',        'Locação de Vagas',
         'Quer alugar uma vaga de estacionamento ou oferecer vagas para locação.',
         array['quero alugar uma vaga', 'tenho vagas para locar', 'vaga de garagem com carregador'])
      ) m(pos, slug_cat, agente, intencao, descricao, exemplos)
      join ponte_deskcomm.categorias c on c.slug = m.slug_cat
      join ai_agents a on a.organization_id = v_org and a.name = m.agente and a.archived_at is null;
  end if;
end
$seed$;

-- Conferencia
select p.name funil,
       (select count(*) from crm_stages s where s.pipeline_id = p.id) etapas,
       c.slug categoria,
       (select string_agg(a.name, ', ') from ai_agents a join ai_agent_versions v on v.id = a.published_version_id
         where p.id = any(v.pipeline_ids)) agentes_publicados,
       (select m.intent_name from ai_router_members m where m.pipeline_id = p.id) intencao
  from crm_pipelines p
  left join ponte_deskcomm.categorias c on c.pipeline_id = p.id
 order by p.position;
