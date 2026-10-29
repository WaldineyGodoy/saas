# Adesão à Energia por Assinatura pelo WhatsApp

Data: 26/10/2026 · Estado: implementado em 26/10/2026 (ver `playbook/DESKCOMM.md` §8.4)
Contexto: `playbook/DESKCOMM.md` (§8.2 Bel/recepção, §8.3 base da Assinatura). Agente: Bia · Energia por Assinatura.

## 1. Objetivo

A Bia faz a adesão do cliente na própria conversa do WhatsApp: pede os dados um por vez, recebe a foto da conta
e do documento, e o CRM cria o assinante, gera o contrato e a Bia entrega o link de assinatura no chat.

Restrição que molda o desenho: o Deskcomm recusa ferramentas MCP externas de **escrita** durante o atendimento
(doc `servidor-mcp-externo.md` do Deskcomm). A Bia só grava no próprio card (`crm_update_lead`); quem cria o
assinante é a ponte do banco, com validação no servidor. O modelo nunca grava fora do card.

Fora do escopo: CNPJ, várias UCs e titular divergente (vão para humano); retenção/limpeza de dados sensíveis
(registrada como risco); CEP no chat (deixa de ser necessário: o endereço vem da conta).

## 2. Decisões

| Tema | Decisão |
|---|---|
| Arquitetura | Card como formulário + ponte orquestra (opção A). |
| Consentimento (LGPD) | O consentimento formal é o aceite do termo na assinatura eletrônica (Autentique). A Bia não pede aceite separado. |
| Caminho | Quando o cliente topa, a Bia começa a adesão no chat. O link do site só se o cliente preferir fazer sozinho, ou disser que vai pensar / volta depois: "Fico aguardando! Se preferir, pode continuar pelo {link}". |
| Link de assinatura | Entregue pela Bia na mesma conversa (lido por `b2w_status_adesao`). O e-mail com o contrato sai como hoje. Sem WhatsApp automático do CRM. |
| Dado inválido (CPF, e-mail, conta ilegível) | A Bia diz que está errado e pede de novo. Nada é criado com dado inválido. |
| Humano | Titular divergente, titular CNPJ, várias UCs, CPF já cadastrado, falha ao criar. O lead vai para a etapa nova **"Pendência de adesão"**; o humano valida e dá sequência. |
| Originador / indicador | Lead vindo de link de originador ou de assinante já tem `leads.originator_id` / `indicador_assinante_id` (ponte de rastreio, migration `20261020c`). A ponte mostra o originador no card (campo `originador`) e passa os dois para `fn_criar_assinante_publico`, que fecha a árvore de comissão como na adesão pelo site. |
| Vencimento | Dia 5. |
| Versão do aceite | `aceite_versao = 'whatsapp-v1'`. |

## 3. Conversa (Bia)

### 3.1 "O que preciso para aderir?"

Quando o cliente perguntar o que precisa para avançar, aderir, contratar ou como seguir, duas mensagens:

> Para fazer sua adesão, vou precisar de:
> • endereço do imóvel
> • número do cliente (está na conta de energia)
> • nome completo do titular da conta
> • CPF
> • e-mail e telefone para contato
> • foto do seu documento (RG ou CNH)
> • foto ou PDF da conta de energia mais recente
>
> A conta precisa estar no seu nome. Se estiver no nome de outra pessoa ou de empresa, me avisa que a equipe te orienta.
> Com tudo em mãos, gero o contrato e te envio para assinar aqui mesmo, pelo celular.

> Tá com os documentos fácil aí em mãos? Podemos seguir?

Depois, **um dado por vez**. O que a leitura da conta trouxer (endereço, número do cliente, titular) a Bia só
confirma, sem perguntar de novo.

### 3.2 Etapas (`adesao_etapa` no card)

| Etapa | A Bia | Erro → |
|---|---|---|
| `aguardando_conta` | "Me manda uma foto (ou o PDF) da sua conta de luz mais recente, com todas as informações aparecendo." | `conta_ilegivel`: "Essa foto não ficou legível, pode mandar outra mais nítida?" · `sem_cobertura` / `abaixo_minimo`: mesmas regras da simulação. |
| `titular` | "A conta está no nome de {titular}. É você?" | Não → `titular_divergente` (pendência). Titular CNPJ → `titular_cnpj` (pendência). |
| `aguardando_cpf` | "Me passa seu CPF?" | `cpf_invalido`: "Esse CPF não está certo, pode conferir e mandar de novo?" · `cpf_diferente_conta` → pendência · `cpf_ja_cadastrado` → pendência. |
| `aguardando_email` | "Qual o seu e-mail? É por ele que chega a cópia do contrato." | `email_invalido`: pede de novo. |
| `aguardando_telefone` | "Posso usar este número do WhatsApp como telefone de contato?" (se não, pede o outro) | — |
| `aguardando_documento` | "Agora uma foto do seu RG ou CNH (frente)." | `documento_invalido` (não é imagem/PDF): pede de novo. |
| `revisao` | Resumo: nome, CPF mascarado, e-mail, telefone, endereço, número do cliente, desconto, vencimento dia 5. "Está tudo certo?" | Corrigiu um dado → volta à etapa daquele dado. |
| `confirmado` | "Perfeito! Estou gerando seu contrato…" e, quando `b2w_status_adesao` trouxer o link: "Pronto! É só abrir, conferir e assinar: {link}". | `erro` → pendência. |
| (assinado) | Agradece e dá o aviso do prazo (30 a 60 dias; até 2 contas proporcionais) — regra já publicada na Bia v6. | — |

Outras regras:
- Várias contas/UCs mencionadas ou enviadas → pendência (`varias_ucs`).
- Foto que chega fora de etapa fica guardada; na etapa certa a Bia pergunta se é aquela.
- Cliente para no meio: progresso salvo no card; ao voltar, a Bia retoma da etapa. Retorno só se agendado (regra de 26/10).
- Etapas do funil: "Contrato enviado" quando o link é entregue; "Fechou" na assinatura (já feito pelo `autentique-webhook`); "Pendência de adesão" nos casos de humano.

## 4. Dados

### 4.1 Card (campos do funil Energia por Assinatura, escopo negócio)

`adesao_etapa` (opções da §3.2), `adesao_cpf`, `adesao_email`, `adesao_telefone`, `adesao_titular_ok` (sim/não),
`adesao_revisao_ok` (sim/não), `originador` (texto, preenchido pela ponte; a Bia não escreve).

### 4.2 Tabela `ponte_deskcomm.adesoes` (uma por card)

`card_id` pk, `lead_id`, `conversation_id`, `contact_id`, `conta_message_id`, `documento_message_id`,
`conta_lida jsonb` (titular, documento_titular, numero_uc, endereço, cep, cidade, uf, ibge, tipo_ligacao,
consumo_medio_kwh, distribuidora), `erros text[]`, `status` (`coletando`, `pendencia`, `criando`,
`contrato_pronto`, `assinado`, `erro`), `subscriber_id`, `signature_link`, `criado_em`, `atualizado_em`.

### 4.3 Etapa nova no funil

"Pendência de adesão" entre "Negociação" e "Contrato enviado", `requires_human = true`, `avisar_na_central = true`.

## 5. Ponte

### 5.1 Gatilhos

- **Mensagem de entrada com mídia** (`messages.media_storage_path` preenchido) numa conversa cujo card está no
  funil da Assinatura com `adesao_etapa` em `aguardando_conta` / `aguardando_documento`: grava o id da mensagem
  no slot da etapa e chama `adesao-whatsapp` `{acao: 'conta' | 'documento', card}`.
- **Card mudou** (`adesao_cpf`, `adesao_email`, `adesao_telefone`, `adesao_titular_ok`, `adesao_etapa = 'confirmado'`):
  chama `adesao-whatsapp` `{acao: 'validar' | 'criar', card}`.
- **Originador:** ao criar ou atualizar o card de Energia por Assinatura, se o lead tem `originator_id`, grava o
  nome do originador em `custom_fields.originador` (só se vazio).
- Todos com `exception when others` → `ponte_deskcomm.erros`; nunca bloqueiam a gravação.

### 5.2 Edge Function `adesao-whatsapp`

Autenticação `x-ponte-token` (como `deskcomm-ponte`).
- `conta`: baixa a mídia do storage do Deskcomm, lê com o leitor de `parse-invoice-image` (extraído para
  `_shared/leitura-conta.ts`, usado pelas duas funções), grava `conta_lida`; checa cobertura e mínimo
  (`b2w_mcp_simular_assinatura`), titular pessoa física.
- `documento`: confere tipo (imagem/PDF) e tamanho com as regras do `onboarding-documentos`.
- `validar`: dígitos do CPF; CPF × documento do titular da conta (quando a conta mostrar); CPF já existente em
  `subscribers`; formato do e-mail.
- `criar` (idempotente por card): `fn_criar_assinante_publico` com nome do titular, CPF, e-mail, telefone,
  endereço/IBGE da conta, `p_lead_id`, `p_originator_id` e `p_indicador_assinante_id` do lead, UC da conta,
  `p_dia_vencimento = 5`, `p_aceite_versao = 'whatsapp-v1'`; copia conta e documento para `documentos-assinante`
  e registra em `subscriber_documents` (mesmas regras do site); gera o contrato pelo caminho do
  `onboarding-finalizar` (`gerar_no_servidor`), **sem** o WhatsApp automático (só e-mail); grava
  `signature_link`, `status = 'contrato_pronto'`.

### 5.3 Ferramenta `b2w_status_adesao` (servidor `b2w-mcp`, leitura)

Sem argumentos; card achado pelo telefone do cabeçalho `X-Deskcomm-Contato-Telefone`. Devolve:
`etapa`, `status`, `conta` (titular, endereço, número do cliente, consumo, economia estimada), `cpf_mascarado`,
`erros[]`, `faltando[]`, `link_assinatura`, `assinado`. Nunca devolve CPF completo nem dado de outro contato.

### 5.4 Agente

Script cirúrgico sobre a versão publicada da Bia (preserva a persona, como `ajuste_bia_fechamento.sql`): §3 no
roteiro e `mcp_externo:leitura:b2w_status_adesao` em `tool_ids`.

## 6. Erros

| Situação | Comportamento |
|---|---|
| Conta ilegível / não é conta | Pede outra foto. |
| Sem cobertura / abaixo de 150 kWh | Para e explica (regras da simulação). |
| CPF ou e-mail inválido | Pede de novo; nada é criado. |
| Titular divergente, CNPJ, várias UCs, CPF já cadastrado | Pendência de adesão + humano com o motivo. |
| Mídia fora de etapa | Guardada; a Bia confirma na etapa certa. |
| Falha ao criar assinante ou contrato | `status = 'erro'`, `ponte_deskcomm.erros`, pendência + humano; nova tentativa não duplica. |
| Deskcomm mudou o armazenamento de mídia | `erros` com o motivo; checklist pós-atualização no playbook. |

## 7. Testes

1. Vitest: validação de CPF e e-mail; mapeamento `conta_lida` → parâmetros de `fn_criar_assinante_publico`
   (inclui originador e indicador); atribuição de mídia pela etapa; montagem do status com CPF mascarado;
   `b2w_status_adesao` usa só o telefone do cabeçalho.
2. SQL em transação desfeita: card fictício por todas as etapas até criar o assinante (com originador); casos de
   divergência, CNPJ e CPF duplicado.
3. Ensaio da `adesao-whatsapp` com uma conta real anonimizada, sem gerar contrato.
4. Conversa de teste no WhatsApp (número de teste) até o link de assinatura, sem assinar; o assinante de teste é
   apagado depois.

## 8. Riscos

- **Dados sensíveis no Deskcomm:** CPF, documento e endereço ficam no histórico e no card. Definir regra de
  retenção (limpar `adesao_cpf` e afins do card depois da adesão fechada).
- **Leitura da conta por modelo com visão** pode errar a UC: a revisão (etapa `revisao`) e a assinatura confirmam.
- **Termo de adesão** desatualizado (titularidade, Fio B, bandeira, vencimento): em revisão com o jurídico.
- **Acoplamento ao Deskcomm** (`messages.media_storage_path`, bucket de mídia): conferência no checklist.
- **Repositório público:** nenhum dado de cliente em commit, PR ou arquivo de teste (usar dados fictícios).
