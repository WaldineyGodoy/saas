# Playbook DeskcommCRM — atendimento inteligente integrado ao CRM B2W

Desenho do atendimento por WhatsApp no DeskcommCRM, com leads, tags e status sincronizados com o CRM da B2W, o Jev categorizando e medindo a temperatura, e um agente de IA por linha de negócio.

Escrito em 19/10/2026, a partir do código público do Deskcomm (`melgarafael/DeskcommCRM`, `main` @ `0f1d333`) e do banco de produção (`abbysvxnnhwvvzhftoms`), lido sem alterar nada.

---

## 1. Como o Deskcomm funciona (o que importa aqui)

| Peça | Onde mora | Para que serve aqui |
|---|---|---|
| **Inbox WhatsApp** | WAHA (`channel_sessions`, `conversations`, `messages`) | 1 número conectado (`WORKING`). Toda mensagem nova vira um evento em `event_log`, que um worker processa. |
| **Turno do agente** | `workers/` → `runAgentTurn` | Mensagem entra → **roteador** escolhe o agente → agente responde (RAG + ferramentas MCP) → guardrails → envio. |
| **Roteador de intenção** | `ai_routers` + `ai_router_members` | Cada **intenção** aponta para um **agente** e, desde a migration 0542, para um **funil + etapa**: o card vai junto para o funil do produto. |
| **Jev** | `organizations.settings.jev` | Modelo da TypeSafe que **não escreve**: devolve escolha / nota / sim-não com **probabilidade calibrada**. Já tem a tarefa "roteador" pronta e pode usar a **chave OpenRouter que já está cadastrada** (origem `openrouter`, modelo `typesafe/jev-1.13`). |
| **Funis e cards** | `crm_pipelines`, `crm_stages`, `crm_leads` | Kanban. Um contato pode ter **um card por funil de produto**. |
| **Score do card** | `crm_lead_scores` (frio / morno / quente) | Calculado por **fórmula** (compromissos, objeções, BANT, recência), não por modelo. A ponte não mexe nele. |
| **MCP** | `/api/mcp` (Bearer `dsk_…`) | Porta para outro sistema mover card, criar lead, pôr tag etc. com auditoria. É por ela que a B2W fala com o Deskcomm. |

**Estado atual da instalação:** 1 organização, 1 agente (`Bel`, `deepseek/deepseek-v4-flash` via OpenRouter, modo automático), **nenhum roteador**, 1 funil genérico ("Clientes", 8 etapas), 5 contatos e 5 cards, Jev desligado.

### O achado que define o desenho

**O Deskcomm e o CRM da B2W estão no mesmo projeto Supabase.** As tabelas do Deskcomm (`crm_leads`, `contacts`…) e as da B2W (`leads`, `subscribers`…) convivem em `public`. Então a ponte não precisa de webhook nem de fila externa no sentido Deskcomm → B2W: um gatilho no próprio banco resolve, na mesma transação.

Isso também traz dois cuidados:
- O `baseline.sql` do Deskcomm recria as tabelas dele a cada atualização. Por isso tudo da ponte fica num schema próprio, `ponte_deskcomm`.
- Mudar a etapa de um card direto no banco **não** dispara o follow-up nem as automações do Deskcomm (`lead.stage_changed` é emitido pelo código, não por gatilho). Então, no sentido B2W → Deskcomm, a ponte usa a API (MCP).

---

## 2. O modelo

```
WhatsApp ──► Deskcomm
              │
              ├─ Funil "Recepção" (entrada) ── agente Bel (triagem)
              │
              ├─ Roteador (Jev decide, IA de sempre cobre)
              │     intenção ─► agente especialista + funil do produto
              │
              ├─ 7 funis de produto, 1 agente cada
              │
              └─ card criado/movido ──(gatilho no banco)──► leads B2W
                                                              tag da categoria
                                                              status da etapa
              ◄──(fila + MCP)── status mudado no CRM B2W

  jev-temperatura (a cada 10 min) ─► leads.qualificacao.jev
                                     + tag temp:<faixa> no card
```

### 2.1 Categorias: tag B2W ↔ funil ↔ agente

As tags já existem no CRM (`src/lib/tagHelpers.js`). Cada categoria vira um **funil de produto** no Deskcomm, com **um agente**.

| Categoria (slug da ponte) | Tag no CRM B2W | Funil no Deskcomm | Agente |
|---|---|---|---|
| `energia_assinatura` | `#Energia por Assinatura` | Energia por Assinatura | **Agente Assinatura** |
| `usina_investimento` | `#Investidor` | Usinas de Investimento | **Agente Investidor** |
| `eletropostos` | `#Eletropostos` | Eletropostos | **Agente Eletroposto** |
| `cotas` | `#Cotas` | Cotas | **Agente Cotas** |
| `arrendamento` | `#Arrendamento de area` | Áreas de Arrendamento | **Agente Arrendamento** |
| `comercializadora` | `#Comercializadora` | Gestora / Comercializadora | **Agente Mercado Livre** |
| `vagas` | `#Locação de Vagas` | Locação de Vagas | **Agente Vagas** |
| — (entrada) | — | **Recepção** | **Bel** (já existe) |

`#Consorcio`, `#Financiamento` e `#Embaixador` ficaram de fora: não estavam na sua lista. Para incluir, é uma linha em `ponte_deskcomm.categorias` mais um funil e um agente.

### 2.2 Etapas dos funis de produto (iguais nos 7)

Os nomes casam com o status da B2W pela tabela `ponte_deskcomm.etapa_status`, que compara pelo nome da etapa. Por isso o vínculo sobrevive a recriar funis.

| # | Etapa no Deskcomm | Status no CRM B2W | Probabilidade da etapa (`win_probability`) |
|---|---|---|---|
| 1 | Novo contato | `simulacao` | 5 |
| 2 | Qualificando | `simulacao` | 15 |
| 3 | Simulação / Proposta enviada | `simulacao` | 30 |
| 4 | Negociação | `negociacao` | 50 |
| 5 | Reunião agendada | `reuniao_agendada` | 60 |
| 6 | Contrato enviado | `contrato_enviado` | 80 |
| 7 | Fechou *(ganho)* | `ativacao` | 100 |
| 8 | Não fechou *(perda)* | `negocio_perdido` | 0 |
| 9 | Sem resposta | `sem_interacao` | 5 |

Na volta (B2W → Deskcomm), `ativacao`, `ativo` e `pago` levam o card a "Fechou", e `negocio_perdido` leva a "Não fechou" com o motivo `Perdido no CRM B2W`. Esse motivo precisa entrar em `settings.lost_reasons` de cada funil (passo 4).

---

## 3. O Jev: duas funções

### 3.1 Categorizar (roteador) — recurso nativo, só configuração

A tarefa **roteador** do Jev escolhe a intenção (`choice`) com probabilidade. No modo **sob demanda** ele decide primeiro, e a IA de sempre (o modelo do agente, via OpenRouter) só é chamada se ele falhar, não achar intenção ou ficar abaixo da confiança mínima. Cada decisão fica em `jev_router_decisions`. Em **IA › Execuções › Roteamento** dá para revisar à mão se ele acertou.

Hoje o Jev só recebe a **mensagem atual**, sem o histórico. Isso é decisão do Deskcomm por LGPD. Por isso a categoria é decidida no roteador e **conferida** pela `jev-temperatura`, que lê a conversa inteira. Quando as duas divergem, a função conta e grava `categoria_jev` ao lado de `categoria_funil`.

### 3.2 Temperatura e probabilidade de fechamento — Edge Function `jev-temperatura`

A cada 10 minutos, para cada card aberto e vinculado que recebeu mensagem do cliente desde a última avaliação, a função manda ao Jev as últimas 16 mensagens. Antes de enviar, ela mascara CPF, CNPJ, e-mail, telefone e números longos. As quatro perguntas vão numa chamada só:

| Pergunta | Tipo | Resposta gravada |
|---|---|---|
| `temperatura` | `score`, 5 níveis: **Gelado · Frio · Morno · Quente · Fechando** | faixa + nota 0–1 + confiança |
| `fecha_30d` | `noul` (sim/não) | **probabilidade de fechar em 30 dias** (0–1) |
| `proximo_passo` | `choice` | qualificar · enviar_simulacao · tirar_duvida · agendar_reuniao · enviar_contrato · passar_para_humano · aguardar |
| `categoria` | `choice` (as 7 + "nenhuma") | confere o roteador |

Onde grava:
- **CRM B2W:** `leads.qualificacao.jev = { temperatura, temperatura_score, probabilidade_fechamento_30d, proximo_passo, categoria_jev, avaliado_em, … }`.
- **Deskcomm:** a tag `temp:gelado|frio|morno|quente|fechando` no card, para filtrar o kanban.

O score nativo do Deskcomm (fórmula frio/morno/quente) continua como está. Os dois ficam lado a lado, de propósito: a fórmula explica o porquê, e o Jev vê o que a fórmula não lê no texto.

Custo: o fornecedor publica US$ 0,042 por milhão de tokens de entrada, com saída gratuita. Com 16 mensagens (~1.500 tokens), são milhares de avaliações por centavo de dólar. Isso é afirmação do fornecedor e não foi medido aqui.

---

## 4. Agentes especialistas — roteiro de cada um

Todos seguem a mesma regra: **números (desconto, preço, retorno, potência) só da base de conhecimento** (RAG do agente). Sem a base, o agente diz que vai confirmar com a equipe. Cada agente tem escopo **só no próprio funil** e passa para humano quando o cliente pede, reclama ou quando o próximo passo é contrato.

| Agente | Objetivo | O que precisa coletar | Leva o card até |
|---|---|---|---|
| **Bel (Recepção)** | Acolher e descobrir o interesse em 1–2 perguntas | nome, cidade, o que procura | o roteador transfere |
| **Assinatura** | Mostrar a economia na conta de luz | **foto/PDF da conta de luz**, concessionária, consumo médio (kWh), titular (CPF/CNPJ) | Simulação → Contrato enviado |
| **Investidor** | Apresentar usinas como investimento | valor que pretende investir, prazo, perfil (PF/PJ), se já tem usina | Reunião agendada |
| **Eletroposto** | Recarga e parceria de eletropostos (marca VOLT) | é motorista ou dono de local? endereço, tipo de estabelecimento, fluxo de veículos | Reunião / Proposta |
| **Cotas** | Venda de cotas de usina | quantidade ou valor, objetivo (abater conta ou renda) | Simulação → Contrato |
| **Arrendamento** | Captar áreas para usina | localização (cidade/coordenada), tamanho (ha), distância da rede, documentação do imóvel | Reunião agendada |
| **Mercado Livre** | Gestão e comercialização para empresas | CNPJ, demanda contratada, consumo mensal, distribuidora, se já está no mercado livre | Reunião agendada |
| **Vagas** | Locação de vagas de estacionamento | quer alugar ou oferecer? local, quantidade, com ou sem recarga | Proposta |

### 4.1 Intenções do roteador (descrição + exemplos)

Cada intenção aponta para o agente e para o funil/etapa "Novo contato" do produto.

| Intenção | Descrição | Exemplos de frase do cliente |
|---|---|---|
| Energia por Assinatura | Desconto na conta de luz sem obra | "quero economizar na conta de luz", "vi o anúncio do desconto na energia", "como funciona a energia solar sem instalar placa?" |
| Usinas de Investimento | Investir em usina solar | "quero investir em usina", "qual o retorno de uma usina solar?", "tenho um dinheiro parado e quero renda" |
| Eletropostos | Recarga de carro elétrico / parceria | "onde carrego meu carro elétrico?", "quero colocar um carregador no meu posto", "parceria de eletroposto" |
| Cotas | Comprar fração de usina | "quero comprar cotas", "dá pra ter uma parte de uma usina?" |
| Áreas de Arrendamento | Arrendar terreno | "tenho um terreno e quero arrendar", "vocês alugam área para usina?" |
| Gestora / Comercializadora | Mercado livre, gestão de energia | "sou empresa e quero ir pro mercado livre", "gestão de energia para indústria" |
| Locação de Vagas | Alugar vaga | "quero alugar uma vaga", "tenho vagas para locar" |

Fallback do roteador: **Bel**, que segura o card na Recepção até a intenção ficar clara.

---

## 5. Ativação — passo a passo

> **Estado em 19/10/2026 (noite)**
> - ✅ Migration `20261020a_ponte_deskcomm` **aplicada**: gatilhos e crons ativos.
> - ✅ Edge Functions `deskcomm-ponte` e `jev-temperatura` **publicadas** (v1).
> - ✅ Segredo `cron:ponte_token` criado no Vault, com valor gerado no banco.
> - ✅ Recepção = funil padrão "Clientes" (categoria `triagem`). Contato novo vira lead **Sem Interação**, que agora é a 1ª coluna do kanban (`LeadsList.jsx`, `LeadModal.jsx`; falta publicar o front).
> - ✅ Deskcomm atualizado para **1.86.0**.
> - ✅ **Funis, agentes e roteador criados** por `scripts/deskcomm/seed_funis_agentes.sql`, rodado em ensaio antes. O funil "Clientes" virou **Recepção**. Foram criados 7 funis de produto, com 9 etapas cada, e 7 agentes publicados pela função oficial (`fn_publish_ai_agent_version`), cada um com escopo só no próprio funil. O roteador "Roteador B2W" está ativo no número, com 7 intenções → funil/etapa "Novo contato", Bel de reserva, confiança mínima 0,6 e as últimas 8 mensagens como contexto. As categorias da ponte estão ligadas aos funis.
> - ✅ **Bel v2 publicada.** A v1 tinha só "Você é um atendente…": o treinamento estava em `ai_agents.system_prompt`, que o motor não lê (`agent-config.ts` usa `v.system_prompt`). A v2 traz o roteiro de Recepção e o treinamento da B2W.
> - ⏳ Falta: os Secrets `JEV_API_KEY` e `DESKCOMM_MCP_TOKEN`, que o usuário vai cadastrar (sem eles as funções respondem `*_nao_configurado`); ligar o Jev na tela (IA › Provedores › Jev: origem OpenRouter, aceite LGPD do administrador, tarefa Roteador em *observando*); e uma base de conhecimento por produto. Hoje todos usam só "Conversas anteriores", e só a Assinatura tem regras comerciais no roteiro.
>
> **Regras da Recepção:** a Recepção só **cria** lead que não existe, nunca altera um lead existente. O encerramento do card pela transferência do roteador (`moved_to_another_pipeline`) é ignorado. Lead já fechado (`ativacao`/`ativo`/`pago`) não é rebaixado por um card de outro produto; ele só ganha a tag nova.
>
> **Chaves:** as funções leem primeiro os **Secrets das Edge Functions** (painel do Supabase › Edge Functions › Secrets) e só depois `integrations_config`. A chave OpenRouter do banco está criptografada pelo Deskcomm, e os tokens `dsk_` existem só como hash. Por isso cada chave precisa ser colada uma vez no painel, por você.

A ordem abaixo evita card órfão.

| # | Passo | Onde | Quem |
|---|---|---|---|
| 1 | Revisar o acesso à VPS: a chave do host **mudou** (o SSH recusou por possível troca do servidor). Confirmar com o Antigravity/Contabo que a VPS foi reinstalada antes de aceitar a chave nova. | terminal | você |
| 2 | Atualizar o Deskcomm na VPS para uma versão com a **origem OpenRouter do Jev** (issue #2947, 15/10/2026) e o **roteador com funil** (migration 0542). Hoje `system_version` está vazio, então não dá para saber a versão pelo banco. | VPS | você / Antigravity |
| 3 | Criar o funil **Recepção** (entrada) e os **7 funis de produto** com as etapas da §2.2, marcando "Fechou" como ganho e "Não fechou" como perda. | Deskcomm › CRM › Funis | operador |
| 4 | Em cada funil de produto, incluir `Perdido no CRM B2W` nos motivos de perda. | Deskcomm › Funil › Configurações | operador |
| 5 | Criar os **7 agentes** (§4), cada um com escopo no próprio funil e base de conhecimento com preços, descontos e regras. Publicar a versão. | Deskcomm › IA › Agentes | operador |
| 6 | Criar o **roteador** no número do WhatsApp com as 7 intenções (§4.1), cada uma com funil + etapa "Novo contato". Fallback: Bel. | Deskcomm › IA › Roteadores | operador |
| 7 | Ligar o **Jev**: origem **OpenRouter** (usa a chave que já existe), aceite LGPD do administrador, tarefa **roteador** em *observando* por alguns dias, depois *decidindo* em modo **sob demanda**. | Deskcomm › IA › Provedores › Jev | administrador |
| 8 | Aplicar a migration `supabase/migrations/20261020a_ponte_deskcomm.sql`. | Supabase | eu, com sua aprovação |
| 9 | Preencher `ponte_deskcomm.categorias.pipeline_id` com o id de cada funil criado no passo 3. | SQL | eu |
| 10 | Criar no Vault o segredo `cron:ponte_token` (valor aleatório). `cron:anon_key` já existe. | Supabase › Vault | você |
| 11 | Em `integrations_config`: linha `deskcomm` (endpoint = URL do Deskcomm, api_key = token `dsk_…` com scope `mcp:write`) e linha `jev` (endpoint `https://openrouter.ai/api`, api_key = chave OpenRouter, `variables.model = "typesafe/jev-1.13"`). | Supabase | você (chaves não passam por mim) |
| 12 | Publicar as Edge Functions `deskcomm-ponte` e `jev-temperatura`. Rodar a `jev-temperatura` uma vez com `{"ensaio": true}` e conferir as notas antes de deixar gravar. | Supabase | eu |
| 13 | Teste de ponta a ponta com um número real: "Oi" → Recepção; "quero desconto na conta de luz" → card em Energia por Assinatura, lead na B2W com a tag; mudar o status no CRM → card anda no Deskcomm. | WhatsApp | você + eu |

### Validação já feita

A migration foi ensaiada no banco de produção **dentro de uma transação desfeita no fim** (`rollback`). Foram criados um funil de teste e um card para um contato existente, o card foi movido e o status do lead na B2W foi alterado. Resultado:
- o lead da B2W nasceu com a tag `#Energia por Assinatura`;
- o lead acompanhou a mudança do card para `negociacao`;
- a mudança de status no CRM entrou na fila de volta, e o movimento vindo do Deskcomm **não** entrou (o antiloop funciona);
- nenhum erro foi registrado.

Depois do ensaio, o banco foi conferido e voltou ao que era: sem schema, sem gatilho, sem funil de teste, os mesmos 30 leads.

As duas Edge Functions passaram só na checagem de sintaxe (esbuild). Não há Deno local, e elas não foram executadas.

---

## 6. Riscos e pontos em aberto

- **Mensagens duplicadas:** o gatilho `trg_notify_lead_status` dos leads da B2W dispara as regras da Central de Notificações. Hoje **não há regra para leads**. Se alguém criar uma ("status Negociação → manda WhatsApp"), o cliente recebe mensagem da Evolution **e** do agente do Deskcomm. Regras de lead devem ficar só no Deskcomm.
- **Dois números de WhatsApp:** a Evolution API (B2W) e o WAHA (Deskcomm) são canais separados. O cliente deve ver um número só para atendimento comercial.
- **Card na Recepção não sincroniza.** É de propósito: antes da categoria não há tag para pôr. Se o cliente some depois do "Oi", ele não aparece no CRM da B2W. Dá para criar uma categoria "Triagem" se você quiser ver esses contatos lá.
- **Telefone como chave:** o lead da B2W é achado pelo telefone normalizado (só dígitos, com 55). Os leads atuais têm 4 formatos diferentes. O casamento ignora o formato, mas um lead com telefone errado vira duplicado.
- **LGPD:** a conversa já vai para a OpenRouter no atendimento. O Jev é mais um suboperador (TypeSafe), e a `jev-temperatura` manda as últimas 16 mensagens mascaradas. Atualizar a política de privacidade antes do passo 12.
- **Tag `temp:` gravada direto no card:** não passa pela auditoria do Deskcomm. Se isso incomodar, a troca é usar a ferramenta MCP de tags na mesma função.
- **Jev em early access:** o fornecedor está na v0.01. A versão do modelo está fixada (`typesafe/jev-1.13`) para a régua não mudar sozinha; quando ela for aposentada, a chamada volta 400 e a função registra `jev_http_400`.

## 7. Arquivos

- `supabase/migrations/20261020a_ponte_deskcomm.sql` — schema `ponte_deskcomm`, categorias, mapeamento etapa ↔ status, vínculos, fila, gatilhos nos dois sentidos, RPCs restritas à service role, 2 crons.
- `supabase/functions/deskcomm-ponte/index.ts` — drena a fila e move o card pelo MCP do Deskcomm (`crm_move_lead_stage`).
- `supabase/functions/jev-temperatura/index.ts` — temperatura, probabilidade de fechamento, próximo passo e conferência de categoria pelo Jev.
- `supabase/migrations/20261020b_base_agente_investidor.sql` — campos de venda da usina, `ponte_deskcomm.fontes_base`, RPCs da base, gatilho em `usinas` e cron `ponte-deskcomm-base`.
- `supabase/functions/deskcomm-base/` — mantém a base do Agente Investidor no Deskcomm (FAQ em `bases/investidor-faq.ts`, montador em `montar.ts`).
- `scripts/deskcomm/base_investidor.sql` — publica a versão do Agente Investidor com o roteiro e as fontes.
- `supabase/migrations/20261020c_bel_recepcao.sql` (+ `20261020d`) — RPCs do b2w-mcp, campos do card → lead, rastreio, não-lead, termômetro só no especialista.
- `supabase/functions/b2w-mcp/` — servidor MCP da B2W (concessionária e identificação do contato).
- `scripts/deskcomm/campos_funis.sql` e `scripts/deskcomm/bel_recepcao.sql` — campos dos funis; Bel v3, abertura comum e membro suporte.
- `supabase/migrations/20261021a_base_agente_assinatura.sql` — simulação (b2w_mcp_simular_assinatura), cobertura da Fonte B e gatilhos de planos/tarifa.
- `supabase/functions/deskcomm-base/bases/assinatura-faq.ts` — FAQ do Agente Assinatura.
- `scripts/deskcomm/base_assinatura.sql` — publica a versão do Agente Assinatura com roteiro, fontes e a ferramenta de simulação.
- `supabase/migrations/20261021b_base_agente_cotas.sql` — `usinas.cotas_vendidas` (0 a 10), RPC das usinas com cotas, gatilho de usinas com a coluna nova.
- `supabase/functions/deskcomm-base/bases/cotas-faq.ts` — FAQ do Agente Cotas.
- `scripts/deskcomm/base_cotas.sql` — publica a versão do Agente Cotas com roteiro e fontes.

## 8. Bases de conhecimento por produto

Uma base por agente, desenhada com /brainstorming. Spec de cada uma em `docs/superpowers/specs/`.

### 8.1 Agente Investidor (Usinas de Investimento) — no ar desde 20/10/2026

Spec: `docs/superpowers/specs/2026-10-19-base-agente-investidor-design.md`.

- **Fontes no Deskcomm** (ligadas à versão 2 publicada do agente):
  - "Investidor — Perguntas e respostas" (faq, 15 pares);
  - "Usinas à venda" (documento, gerado das usinas com **À venda** marcado na aba Contratos do modal da usina).
- **Por que os números ficam na base:** a trava de promessas do Deskcomm só deixa passar afirmação comercial provada por fonte `faq`/`documento`.
- **Cadastrar usina à venda:** no CRM, aba Contratos da usina → marcar **À venda**, preencher **Previsão de entrega** e **Modelo de venda**; o preço vem de Valor Investido e o link, do link encurtado da usina. O gatilho atualiza a base em segundos; desmarque quando vender.
- **Mudar o FAQ:** editar `supabase/functions/deskcomm-base/bases/investidor-faq.ts`, rodar `npx vitest run tests/deskcomm-base.test.ts` (confere 15 pares e as palavras proibidas) e publicar a função (`npx supabase functions deploy deskcomm-base --project-ref abbysvxnnhwvvzhftoms`). O cron da hora seguinte, ou uma chamada manual, sincroniza.
- **Mudar o roteiro do agente:** editar `scripts/deskcomm/base_investidor.sql` e rodar no SQL Editor (publica nova versão; idempotente).
- **Chamada manual:** `select ponte_deskcomm.fn_chamar_funcao('deskcomm-base');` — com `'{"ensaio": true}'::jsonb` devolve os textos sem gravar (resposta em `net._http_response`).

**Checklist depois de atualizar o Deskcomm** (a função grava direto nas tabelas dele):
1. `select public.ponte_deskcomm_contrato_base();` deve voltar `{}`.
2. Ensaio da `deskcomm-base` com status 200.
3. Em `ai_knowledge_sources`, as duas fontes com `last_index_status = 'success'`.
4. Se algo falhar, a função não grava e registra em `ponte_deskcomm.erros`; a base anterior continua valendo.

Pendente (projetos seguintes): lista de cotistas por usina (aba Vínculos de Fornecedor) com cotas disponíveis, e divisão do repasse por cota.

### 8.2 Bel, a recepção — no ar desde 20/10/2026

Spec: `docs/superpowers/specs/2026-10-20-bel-recepcao-design.md`.

- **Abertura comum nos 8 agentes** (o roteador troca de agente na mesma mensagem em que o cliente diz o produto, então quem estiver atendendo pergunta o que faltar): nome → cidade → estado → `b2w_concessionaria`. Energia por Assinatura fora da Cosern = lista de espera + oferta de Investidor/Cotas. Sem indicação conhecida, pergunta onde viu a oferta.
- **Bel v3:** identifica o contato (`b2w_identificar_contato`: cliente ativo, lead que voltou ou novo), saudação sem lista de produtos, "economizar na conta de luz ou investir conosco?", não-lead com tag `nao_lead`. Divisão de mensagens desligada.
- **Servidor MCP `b2w-mcp`** (Edge Function, `verify_jwt` desligado, Bearer `B2W_MCP_TOKEN`). O telefone vem do cabeçalho `X-Deskcomm-Contato-Telefone`, nunca de argumento. Cadastro no Deskcomm: Configurações › Servidor MCP externo (endereço `https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/b2w-mcp` + a mesma chave). Os agentes já têm `ai_agents.config.mcp_externo_no_atendimento = true`.
- **Campos dos funis** (`scripts/deskcomm/campos_funis.sql`): cidade, uf, concessionaria, consumo_kwh, origem, indicado_por, lista_espera. A ponte (`20261020c_bel_recepcao.sql`) preenche a concessionária pela cidade/UF e copia tudo para o lead da B2W, só onde estiver vazio. Nome real do contato substitui o nome do WhatsApp no lead.
- **Rastreio do site** (PR em `WaldineyGodoy/paginas`): `(cód. IND-xxxxxxxx | IG | GG | FB)` no texto do WhatsApp; a ponte grava indicador e origem.
- **Não-lead:** tag `nao_lead` no contato arquiva o lead "Sem Interação" intocado e a ponte deixa de criar lead para ele.
- **Termômetro:** só em funil de produto, com 3+ mensagens do cliente desde que o card chegou ao funil.
- **Suporte:** membro "Suporte ao cliente" no roteador, atendido pela Bel com passagem a humano até existir o Agente Suporte.
- **Mudar a abertura:** o bloco `v_comum` é o mesmo em `scripts/deskcomm/bel_recepcao.sql` e `base_investidor.sql`; altere os dois e rode `bel_recepcao.sql` (idempotente).
- **Dado pendente:** a tabela `"Concessionaria"` está incompleta (ex.: São Gonçalo do Amarante/RN não está; RN tem 143 de 167 municípios). Cidade fora da tabela cai em "lista de espera".

- **Já tem energia solar (23/10/2026):** regra no bloco comum dos 8 agentes — quem já tem energia solar instalada não pode aderir (restrição técnica interna); o agente agradece o retorno e encerra, sem explicar o produto nem passar a humano. Aplicada por `scripts/deskcomm/regra_ja_tem_solar.sql` (cirúrgico sobre a versão publicada).
- **Atenção:** os prompts publicados têm seções de persona (Bel, Bia, Leo, Davi…) que os scripts `base_*.sql`, `bel_recepcao.sql` e `seed_funis_agentes.sql` não têm. Rodar um desses scripts de novo sobrescreve a persona. Para ajustar regra em produção, prefira alteração cirúrgica como a de `regra_ja_tem_solar.sql`.

### 8.3 Base do Agente Assinatura — no ar desde 20/10/2026

Spec: `docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md`.

- **Fontes:** "Assinatura — Perguntas e respostas" (faq, `bases/assinatura-faq.ts`, 18 pares) e "Assinatura: cobertura, desconto e indicação" (documento gerado por `ponte_deskcomm_assinatura_cobertura`: desconto do plano vigente, tarifa, fórmula, crédito de indicação). Regenerada por gatilho em `planos_assinatura_energia`, `planos_distribuidoras` e tarifa da `"Concessionaria"`, e pelo cron de hora em hora. A `deskcomm-base` sincroniza cada fonte com o agente da sua categoria.
- **Ferramenta `b2w_simular_assinatura`** (servidor `b2w-mcp`): mesma conta do simulador do site, vaga (imediata / pré-operação / fila) e link de adesão com o indicador do lead.
- **Vaga:** geração estimada da usina − franquias das UCs que a ocupam (todas menos canceladas, desconectadas e desligadas por TT). Usina sem `geracao_estimada_kwh` não conta; sem `previsao_entrega`, o agente não cita data.
- **Mudar o FAQ:** editar `bases/assinatura-faq.ts` e publicar `deskcomm-base`. **Mudar o roteiro:** editar `base_assinatura.sql` e rodar (idempotente).
- **Pendências:** termo de adesão diverge do roteiro (titularidade, Fio B, bandeira, vencimento dia 5) — revisar com o jurídico; UFV Bom Jesus com franquias acima da geração estimada; usinas em pré-operação sem previsão de entrega.

### 8.4 Base do Agente Cotas — no ar desde 20/10/2026

Spec: `docs/superpowers/specs/2026-10-20-base-agente-cotas-design.md`.

- **Fontes:** "Cotas — Perguntas e respostas" (faq, `bases/cotas-faq.ts`, 14 pares) e "Usinas com cotas" (documento gerado por `ponte_deskcomm_usinas_cotas`: usinas com "À venda" marcado, modelo "Cotas" e cota livre; preço da cota e cotas livres). O Agente Investidor também lê "Usinas com cotas" para a pergunta da cota.
- **Regras:** 10 cotas por usina; preço da cota = preço da usina ÷ 10 + 10% (estruturação da associação e gestão do repasse); projeção de 1,8% a 2% ao mês, a depender do mês de geração; somente à vista; associação dos cotistas já formada, título de propriedade da cota; revenda com a ajuda da B2W.
- **Ofertar uma usina em cotas:** na aba Contratos da usina, marcar "À venda", "Modelo de venda" = Cotas e manter "Cotas vendidas (de 10)" atualizado. O documento se atualiza pelo gatilho de usinas.
- **Pendências (projetos seguintes):** cadastro de cotistas por usina (substitui o contador manual) e divisão do repasse por cota no motor de split (hoje a associação divide fora do sistema).

### 8.5 Bel (Recepção): base de conhecimento e anúncio de origem (24/10/2026)

Spec `docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md`, plano `docs/superpowers/plans/2026-10-24-base-bel-recepcao.md`.

- **Rastreio do anúncio.** O contato que vem da Meta ganha a etiqueta `anuncio:<slug>`, e o anúncio é registrado em `ponte_deskcomm.anuncios` (nome provisório `anuncio-<8 últimos dígitos>`; o dono troca o slug, o nome, o público e a promessa, e contatos e leads acompanham). O lead da B2W recebe o anúncio em `qualificacao.deskcomm.anuncio`. Relatório: `select * from ponte_deskcomm.v_leads_por_anuncio;`.
- **Base da Bel.** Duas fontes: "Recepção — Perguntas e respostas" (18 itens, `bases/recepcao-faq.ts`) e "Recepção: entradas" (documento gerado da tabela de anúncios, regerado quando ela muda). Só fatos: sem percentual, preço nem lista de estados. Percentual de título de anúncio é mascarado.
- **Bel v7.** Regra de anúncio no roteiro: abre pelo que o anúncio ofereceu, pergunta pessoa física ou empresa, nunca repete percentual do anúncio como garantia, oferece videochamada com o time comercial e passa para humano com o motivo `videochamada`.
- **Dados do dono:** CNPJ "consta no contrato"; endereço Olavo Lacerda Montenegro, 467, Parque das Nações, Parnamirim/RN; equipe das 9h às 17h (Brasília), dias não informados.
- **Pendências:** nome, público e promessa de cada anúncio (inclusive o Plano Connect 15%); regras do Connect na base da Assinatura; razão social; dias de atendimento; cobertura real em estados (o site lista 8, o sistema tem plano só para a Cosern). `base_assinatura.sql` e `base_investidor.sql` ainda citam a Gestora como destino de repasse. Teste real com anúncio: quando chegar o próximo lead.
