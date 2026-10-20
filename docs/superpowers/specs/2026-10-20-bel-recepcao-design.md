# Bel, a recepção do WhatsApp — triagem para os agentes especialistas

Data: 20/10/2026 · Estado: implementado em 20/10/2026 (ver `playbook/DESKCOMM.md` §8.2)
Contexto: `playbook/DESKCOMM.md` (integração DeskcommCRM ↔ CRM B2W). Base anterior: `2026-10-19-base-agente-investidor-design.md`.

## 1. Objetivo

Fazer a Bel receber bem quem chama no WhatsApp: reconhecer cliente e lead que voltou, colher nome, cidade e
estado, descobrir a concessionária, entender o produto sem despejar lista e deixar os dados gravados no card
do Deskcomm e no lead da B2W. Junto, consertar o rastreio de indicação e origem, que hoje se perde no site.

Fora do escopo (projetos seguintes):
- Agente Suporte (fatura, boleto, contrato, repasse). Até ele existir, a saída "suporte" cai em humano.
- Bases dos demais especialistas.

## 2. O que aconteceu hoje (20/10/2026)

**Contato do botão do site (09:45).** Cliente: "Olá! Vim pelo site da B2W Energia." A Bel respondeu em 75 s
com três mensagens: saudação, "me conta qual dessas opções te interessa" e a lista dos 7 produtos, com os itens
3 e 6 quebrados pela divisão automática de 200 caracteres. Não perguntou nome nem cidade e ignorou a pista de
origem. O cliente não respondeu. A ponte funcionou: card na Recepção e lead B2W em Sem Interação.

**Contato do simulador (Bay Morais, 09:54).** A mensagem pronta do simulador foi direto ao Agente Assinatura
(o roteador classifica a 1ª mensagem). O atendimento foi bom, mas: o consumo (414 kWh, da conta enviada), a
concessionária e a cidade não foram gravados, e "quem me indicou foi o Maurício" não virou indicador. Causas:
1. Nenhum funil declara campos (`crm_pipelines.settings.fields`), e o `crm_update_lead` do Deskcomm só grava
   campos declarados.
2. A ponte só copia tag e status para o lead da B2W.
3. O site não lê `?indicador=` (ver §6).

## 3. Decisões

| Tema | Decisão |
|---|---|
| Abertura sem pista | "Oi, tudo bem? Bom dia! Em que posso ajudar?" (bom dia / boa tarde / boa noite pela hora de Brasília) |
| Dados | Depois da resposta: "Claro! Me diz qual o seu nome?" → "{nome}, você está falando de qual cidade?" → "De qual estado, {nome}?" → consulta a concessionária |
| Produto não claro | "Me conta, {nome}: você quer economizar na conta de luz ou investir conosco?" (sem lista de 7) |
| Botão genérico do site | Mais provável Energia por Assinatura (o roteador decide pela mensagem pronta) |
| Cliente com cadastro ativo | "Oi, {nome}! Vi que você já é nossa cliente 😊 Em que posso ajudar?" (não diz qual produto: pode ser assinante, investidor, originador) |
| Assunto de suporte | Saída "suporte" no roteador; humano até existir o Agente Suporte |
| Lead que voltou | "Oi, tudo bem? Vamos continuar?" e retoma sem repetir perguntas |
| Fora da Cosern ou cidade fora da tabela | Avisa que a assinatura ainda não chegou à região, grava lista de espera e oferece Usinas de Investimento e Cotas |
| Origem em Energia por Assinatura | Se não houver indicação conhecida: "Me conta, onde viu nossa oferta. Foi Instagram, Google, Facebook ou foi alguém que nos indicou?" |
| Spam, fornecedor, candidato, engano | Uma resposta: "Obrigada pelo contato! Este canal é para atendimento comercial da B2W Energia." Marca não-lead; não cria lead |
| Formato | Uma mensagem por resposta; divisão automática desligada na Bel; sem listas numeradas |
| Tempo de resposta | ~75 s é aceitável (parece humano); não mexer |
| Termômetro (Jev) | Só no especialista: card em funil de produto e ≥ 3 mensagens do cliente na conversa |

## 4. Como o Deskcomm passa a conversa (restrição que molda o desenho)

`lib/agent-engine/agent/resolve-turn-agent.ts`: o roteador classifica **toda** mensagem do cliente. A Bel é o
`fallback`, não membro, então não é "sticky": quando o cliente diz "quero desconto", o Agente Assinatura assume
no mesmo turno. Por isso o roteiro de dados não pode morar só na Bel: ele vai para as **regras comuns** de
todos os agentes (abordagem 1, escolhida). A Bel fica com o que só ela vê: saudação, cliente ativo, lead que
voltou, não-lead e a pergunta de produto quando a resposta é vaga.

## 5. Comportamento

### 5.1 Bel (nova versão publicada)

Na primeira mensagem, chama `b2w_identificar_contato` com o telefone do contato e escolhe a abertura:
- `cliente_ativo` → abertura de cliente; suporte vai para humano (crm_request_human_handoff, motivo "suporte").
- `lead_retorno` → "Oi, tudo bem? Vamos continuar?".
- `novo` → abertura sem pista.
- Mensagem que é propaganda, oferta de serviço, currículo ou engano → resposta de não-lead e tag `nao_lead`
  (crm_manage_tags). Não continua a conversa.

Depois, segue a abertura comum (§5.2). Mensagem única, sem lista.

### 5.2 Abertura comum (regras de todos os 8 agentes)

1. Confere o que já sabe (conversa, card, contato, resultado de `b2w_identificar_contato`). Nunca repete pergunta.
2. Sem nome → "Claro! Me diz qual o seu nome?" e grava no contato (crm_propose_contact_field).
3. Sem cidade → "{nome}, você está falando de qual cidade?".
4. Sem UF → "De qual estado, {nome}?".
5. Chama `b2w_concessionaria(cidade, uf)` e grava cidade, UF e concessionária no card (crm_update_lead).
6. Energia por Assinatura e `atende_assinatura = false` (ou cidade não encontrada) → mensagem de fora da área,
   `lista_espera = true`, oferece Usinas de Investimento e Cotas.
7. Energia por Assinatura sem `indicado_por`/`origem` → pergunta de origem; grava `origem` e, se citar alguém,
   `indicado_por`.
8. Consumo informado ou lido da conta → grava `consumo_kwh`.
9. Uma pergunta por mensagem. Ferramenta `b2w_*` indisponível → "vou confirmar a cobertura com a equipe" e segue.

## 6. Rastreio de indicação e origem

Hoje o link de indicação do assinante (`assinante-short-url`) leva a `https://b2wenergia.com.br/?indicador=<id>&name=…`,
mas a home atual (repo `WaldineyGodoy/paginas`, branch `Home`, publicada pela Hostinger) não lê `indicador` nem
`utm_source`. O WhatsApp não repassa a URL, só o texto pronto.

- **Site:** ao abrir com `indicador` (uuid) ou `utm_source`, guarda em `sessionStorage` e acrescenta ao texto de
  todos os links `wa.me` um código: `(cód. IND-<8 primeiros hex do id>)` para indicação; `(cód. IG)`,
  `(cód. GG)`, `(cód. FB)` para `utm_source` instagram/google/facebook. Indicação vence campanha. O formulário
  (`fn_registrar_lead_publico`) passa a enviar o indicador (o plano confirma a chave aceita em `p_dados`).
- **Ponte:** na 1ª mensagem recebida da conversa, lê o código. `IND-xxxxxxxx` → procura assinante
  (`subscribers`) e originador (`originators_v2`) cujo id começa com o prefixo; exatamente um → grava
  `leads.indicador_assinante_id` (assinante) ou a referência do originador em `leads.qualificacao`, e no card
  `indicado_por` e `origem = indicacao`. Zero ou mais de um → não grava. `IG/GG/FB` → `origem`.
- **Agente:** com `indicado_por` ou `origem` preenchidos, não faz a pergunta de origem.

## 7. Dados

### 7.1 Campos declarados nos 8 funis (`crm_pipelines.settings.fields`)

`cidade` (texto), `uf` (texto, 2), `concessionaria` (texto), `consumo_kwh` (número), `origem` (opções:
instagram, google, facebook, indicacao, site, outro), `indicado_por` (texto), `lista_espera` (sim/não).
Escopo `negocio` (padrão): o valor fica no card, e o clone do roteador copia `custom_fields`
(`lib/leads/clonar-para-funil.ts`, `montaPayloadDoClone`). A concessionária é preenchida pelo banco a partir de
cidade + UF (gatilho antes de gravar o card), não pelo agente. O rastreio do site fica em
`contacts.custom_fields.ponte_rastreio` porque o card nasce segundos depois da primeira mensagem.

### 7.2 Ponte, ida dos dados (card → lead B2W)

Gatilho em `crm_leads` (UPDATE de `custom_fields`) e em `contacts` (nome) para cards vinculados: copia
`cidade`, `uf`, `concessionaria`, `consumo_kwh` e `name` só onde o lead está vazio; `origem`, `indicado_por`
e `lista_espera` vão para `leads.qualificacao.deskcomm`. Nunca sobrescreve valor preenchido.

### 7.3 Não-lead

Contato com tag `nao_lead`: a ponte não cria nem atualiza lead. Se o lead "Sem Interação" já existir e estiver
intocado (status `sem_interacao`, sem tag, sem edição desde a criação), é **arquivado** (`arquivado_em`, reversível
e sem esbarrar nas tabelas que apontam para o lead) e o vínculo é desfeito.

### 7.4 Termômetro

`ponte_deskcomm_para_avaliar` passa a exigir card em funil com categoria de produto (`tag_b2w` não nulo) e ≥ 3
mensagens recebidas do cliente na conversa.

## 8. Servidor MCP da B2W (`b2w-mcp`)

Edge Function nova, protocolo MCP (JSON-RPC `tools/list` e `tools/call`), registrada no Deskcomm como
servidor externo, ferramentas marcadas como leitura (`annotations.readOnlyHint` + escolha `leitura` no agente).
Autenticação por Bearer próprio guardado nos Secrets (`B2W_MCP_TOKEN`) e cadastrado no Deskcomm.

- `b2w_concessionaria({cidade, uf})` → `{encontrada, cidade, uf, concessionaria, atende_assinatura}`.
  Busca em `"Concessionaria"` ignorando acento e caixa; `atende_assinatura` = existe plano em
  `planos_distribuidoras` para a concessionária (hoje só Neoenergia Cosern).
- `b2w_identificar_contato({telefone})` → `{tipo: cliente_ativo | lead_retorno | novo, primeiro_nome}`.
  Telefone normalizado como `ponte_deskcomm.fn_telefone`. Cliente ativo = assinante, investidor ou originador
  com cadastro ativo (o plano fixa os status de cada tabela); lead = lead B2W existente. Não devolve CPF,
  endereço, valores nem ids.

## 9. Roteador

Novo membro "suporte" (intenção: já é cliente e fala de fatura, boleto, contrato, repasse, app) apontando para
a Bel com handoff a humano até existir o Agente Suporte. Demais membros iguais.

## 10. Mudanças

| # | Peça | Arquivo |
|---|---|---|
| 1 | Servidor MCP | `supabase/functions/b2w-mcp/` (+ testes) |
| 2 | Campos dos funis | `scripts/deskcomm/campos_funis.sql` |
| 3–6 | Ponte (dados, código, não-lead, termômetro) | `supabase/migrations/20261020c_bel_recepcao.sql` |
| 7 | Prompts (Bel v3, regras comuns nos 7 especialistas, ferramentas `b2w_*`, divisão desligada na Bel) | `scripts/deskcomm/bel_recepcao.sql` |
| 8 | Roteador (membro suporte) | idem |
| 9 | Site | PR em `WaldineyGodoy/paginas` (branch `Home`) |
| — | Documentação | `playbook/DESKCOMM.md` §8.2 |

Ordem: 1–2 → 3–6 → 7–8 → 9. Cada passo funciona sozinho.

## 11. Erros

| Situação | Comportamento |
|---|---|
| `b2w-mcp` fora do ar ou token inválido | Agente segue sem a informação ("vou confirmar com a equipe") |
| Código de rastreio inválido/ambíguo | Não grava; agente pergunta a origem |
| Gatilho da ponte falha | `exception when others` → `ponte_deskcomm.erros`; nunca bloqueia mensagem, card ou lead |
| Lead já editado no CRM | Ponte não sobrescreve |

## 12. Testes

- vitest: leitura do código de rastreio; normalização de cidade (acento, caixa, homônimo em outra UF,
  inexistente); classificação do contato; resposta MCP (`tools/list`, `tools/call`, token errado → 401).
- SQL: preenche só o vazio; não-lead apaga só lead intocado; termômetro ignora Recepção e < 3 mensagens;
  código `IND-` grava indicador com prefixo único e ignora ambíguo.
- WhatsApp: (1) "Oi" → saudação → nome → cidade → estado → pergunta de produto; (2) Santa Maria/RN → Cosern;
  (3) Belo Horizonte/MG → lista de espera + Investidor/Cotas; (4) link de indicação no site → `indicado_por`
  preenchido, sem pergunta de origem; (5) número de assinante ativo → abertura de cliente; (6) propaganda →
  uma resposta, nenhum lead.

## 13. Riscos

- A abertura comum nos 8 agentes exige republicar todos a cada mudança (script idempotente, como hoje).
- `b2w-mcp` expõe se um telefone é cliente: só devolve tipo e primeiro nome, só ao Deskcomm, com token.
- O site depende da Hostinger publicar o branch `Home`; o código só funciona depois do deploy do site.
- Prefixo de 8 hex pode colidir no futuro; colisão não grava (agente pergunta).
