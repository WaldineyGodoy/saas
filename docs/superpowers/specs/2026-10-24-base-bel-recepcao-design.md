# Base de conhecimento da Bel (Recepção) e rastreio do anúncio de origem

Data: 24/10/2026 · Estado: desenho aprovado em 24/10/2026, ainda não implementado
Contexto: `playbook/DESKCOMM.md` (§8.1 Investidor, §8.2 Bel, §8.3 Assinatura, §8.4 Cotas). Quinta base por agente.
Spec do comportamento da Bel: `2026-10-20-bel-recepcao-design.md` (a conduta já está no roteiro; esta base guarda **fatos**).

## 1. Objetivo

Dar à Bel os fatos de que ela precisa antes de o produto ficar claro: quem é a B2W, como o cliente confirma que é
real, como falar com uma pessoa, o que cada linha faz em uma frase e o que significa cada porta de entrada. Junto,
fazer o Deskcomm **saber de qual anúncio** veio cada contato, para a Bel abrir a conversa pelo que o cliente viu e
para o dono avaliar cada campanha (hoje há três: PF, CNPJ e Plano Connect).

Fora do escopo (cada um com o próprio brainstorming):
- Bases do Eletroposto, Arrendamento, Gestora/Comercializadora e Vagas.
- Coluna ou filtro "anúncio" na tela do CRM (a primeira versão grava o dado e entrega uma consulta pronta).
- As regras do Plano Connect na base da Assinatura (entram quando o dono as passar).

## 2. O que a medição mostrou (24/10/2026)

- **10 contatos vieram da Meta, de 2 anúncios:** "Sua conta de luz até 20% menor" (9 contatos; Instagram e Facebook;
  texto fala da conta Cosern) e "Faturamento alto pede eficiência energética" (1 contato; "até 20% para CNPJ").
  O terceiro anúncio, Plano Connect 15%, entrou no ar depois.
- **A Bel só vê `source = meta_ads`.** `crm_get_contact` devolve `source`, `tags` e datas, mas não `source_metadata`,
  onde ficam `ad_id`, `ad_title`, `ad_body`, `ad_platform`, `ad_source_url`.
- **O dado do anúncio chega depois da criação do contato**, numa atualização de `source_metadata` (nos 10 contatos,
  `created_at` ≠ `updated_at`). Um gatilho só de INSERT não pegaria.
- **O anúncio de CNPJ atrai muita pessoa física.** A Bel não pode presumir CNPJ.
- **O primeiro contato de cada um dos dois anúncios passou pela Bel** (agente ativo da conversa), como o spec da Recepção previu.
- **O site publica telefone (31) 99536-7744, e-mail, Instagram, Facebook e LinkedIn.** Não publica razão social,
  CNPJ, endereço, horário nem a Associação. O cadastro da organização no Deskcomm também não tem CNPJ.
- **O site lista 8 estados (SP, RN, RJ, PR, MT, MS, MG, GO), mas `planos_distribuidoras` tem um único plano, o da Neoenergia Cosern**
  (conferido em 24/10/2026). A cobertura real é a que `b2w_concessionaria` devolve. A base não repete a lista do site.
- **A linha Gestora/Comercializadora atende fornecedores** (donos de usina), não assinantes. Corrigido em
  24/10/2026 (PR saas#53); esta base descreve a linha assim.

## 3. Decisões

| Tema | Decisão |
|---|---|
| Papel da base | Institucional + triagem + mapa de entradas. Sem resumo de produto com números: os agentes de produto têm a própria base e duplicar faria os números divergirem |
| Identificação do anúncio | Etiqueta `anuncio:<slug>` no contato, no estilo das `fu:` já usadas. A tabela de anúncios é a fonte do nome e da promessa |
| Anúncio novo | Entra sozinho, com nome provisório; o dono dá o nome e a promessa depois. O Connect não precisa ser cadastrado antes |
| Produto de um anúncio | Hoje todos vendem Energia por Assinatura; a coluna `categoria` da tabela permite anúncio de outro produto no futuro |
| PF ou empresa | A Bel pergunta e nunca presume, mesmo no anúncio de CNPJ. Os dois casos seguem para a Bia |
| "Até 20%" e "15%" | Nunca dito como valor garantido. O percentual do cliente sai da simulação (Assinatura) |
| Cobertura | Só o que `b2w_concessionaria` responder. Nunca a lista de estados do site |
| Falha do rastreio | Falha aberta: erro no gatilho vai para a tabela de erros e o atendimento segue |
| Lead no CRM da B2W | O anúncio vai para `leads.qualificacao.deskcomm.anuncio`; as tags de produto não mudam |

## 4. Peça A — rastreio do anúncio (ponte)

### 4.1 Dados

Tabela `ponte_deskcomm.anuncios`:

| Coluna | Uso |
|---|---|
| `ad_id` (PK) | `source_metadata->>'ad_id'` |
| `slug` (único) | provisório `anuncio-<6 últimos dígitos do ad_id>`; o dono troca (ex.: `conta-pf-20`) |
| `nome` | nome legível, para o dono |
| `titulo`, `corpo` | copiados do anúncio na primeira vez |
| `plataformas` | `instagram`, `facebook` (união das vistas) |
| `publico` | `pf`, `pj`, `ambos` ou `nao_definido` |
| `categoria` | FK para `categorias(slug)`; padrão `energia_assinatura` |
| `promessa` | frase curta do que o anúncio diz, escrita pelo dono |
| `ativo`, `visto_primeiro_em`, `visto_ultimo_em` | controle |

Escrita só pela service role, como as demais tabelas da ponte.

### 4.2 Gatilho

`AFTER INSERT OR UPDATE OF source_metadata` em `contacts`, para `source = 'meta_ads'` e `ad_id` presente, ignorando
contato pessoal, anonimizado ou bloqueado:
1. upsert em `anuncios` (cria com slug provisório; atualiza plataformas e `visto_ultimo_em`);
2. acrescenta `anuncio:<slug>` a `contacts.tags` se ainda não houver;
3. se o contato já tem lead vinculado, grava o anúncio no lead (§4.3).

O UPDATE de `tags` não toca `source_metadata`, então não reentra no gatilho. Uma segunda etiqueta de anúncio no
mesmo contato (quem clica em outro anúncio depois) é acrescentada; a mais recente vale para a abertura.

### 4.3 Lead

A função que cria o lead a partir do card (`fn_card_para_lead`) passa a copiar o anúncio do contato para
`leads.qualificacao.deskcomm.anuncio = {ad_id, slug, titulo, plataforma, em}`, preservando o que já existe em
`qualificacao.deskcomm` (origem, indicado_por, lista_espera). A ordem dos eventos varia (o contato pode ganhar o
anúncio antes ou depois do lead), por isso o §4.2 item 3 e esta cópia existem juntos. Mexer na função é **estender**
a definição vigente em produção, não substituí-la: ela mudou desde a primeira migration.

### 4.4 Relatório

`ponte_deskcomm.v_leads_por_anuncio`: por anúncio, contatos, leads, leads por status do CRM e por temperatura do Jev.
Acesso só por SQL com a service role; é o que o dono usa para avaliar o Connect.

### 4.5 Retroativo

Os 10 contatos já existentes passam pelo mesmo caminho (um `UPDATE` sem mudança de dados dispara o gatilho de
atualização), verificado antes em transação desfeita.

## 5. Peça B — a base

Mesmo mecanismo das outras: Edge Function `deskcomm-base` (textos em `bases/`, documentos montados em `montar.ts`),
fontes ligadas à Bel e ids em `ponte_deskcomm.fontes_base`.

### 5.1 "Recepção — Perguntas e respostas" (faq, cerca de 15 itens)

`supabase/functions/deskcomm-base/bases/recepcao-faq.ts`. Assuntos, sem preço, desconto nem retorno:
1. Quem é a B2W Energia e o que é a Associação de Usinas B2W Energia (mesma redação da base da Assinatura).
2. "É golpe? Como sei que é a B2W?" — canais oficiais (site, telefone, e-mail, redes) e o que a B2W nunca pede
   (senha, dados bancários por mensagem).
3. Como falar com uma pessoa e em que horário.
4. O que cada uma das 7 linhas faz, em uma frase (a Gestora/Comercializadora como fornecedora de energia).
5. O que a B2W não atende (propaganda, currículo, engano) e a resposta padrão.
6. Quem já é cliente: como pedir fatura, boleto, contrato, repasse e app (vai para humano até existir o Agente Suporte).
7. Cobertura: a Bel consulta a cidade; não afirma estados.
8. Como o contato foi cadastrado e o que acontece com os dados (LGPD, em uma resposta curta).

### 5.2 "Recepção: entradas" (documento, gerado)

Montado por `montarEntradas` a partir de `anuncios` mais texto fixo, e regerado quando a tabela muda (mesmo
gatilho das bases de usinas e planos). Seções:
- **Anúncios:** uma entrada por anúncio ativo (etiqueta, plataforma, público, promessa, produto) e como abrir.
- **Site:** as cinco mensagens prontas dos botões ("Vim pelo site…", "Quero assinar e começar a economizar", "Tenho uma
  dúvida sobre a energia solar por assinatura…") e o simulador ("Simulei no site… Quero assinar", com distribuidora,
  consumo e economia na própria mensagem).
- **Indicação e origem:** códigos `IND-xxxxxxxx`, `IG`, `GG`, `FB` do spec da Recepção §6.
- **App:** quem não conseguiu cadastrar pelo link vai para humano com o motivo "cadastro no app".
- **Mensagem genérica de anúncio** ("Olá! Posso ter mais informações sobre isso?"): sem etiqueta, trata como interesse
  em desconto na conta de luz e pergunta pessoa física ou empresa.
- **Cliente já cadastrado:** abertura de cliente, sem dizer o produto.

### 5.3 Regras de uso (no roteiro, não na base)

Com etiqueta `anuncio:*`, a Bel consulta "Recepção: entradas" (`crm_search_knowledge`), não pergunta o que o cliente
procura, confirma pessoa física ou empresa e segue a abertura comum (nome, cidade, estado). Sem etiqueta, nada muda.

## 6. Peça C — roteiro da Bel (versão 7)

Alteração cirúrgica sobre a versão publicada, no molde de `scripts/deskcomm/regra_ja_tem_solar.sql`: os prompts de
produção têm a seção de persona que os scripts `base_*.sql` não têm. O script (`scripts/deskcomm/base_bel.sql`)
insere a regra do §5.3 depois da abertura, anexa as duas fontes à versão e publica por `fn_publish_ai_agent_version`.
Idempotente: pula se a versão já tem a regra e as duas fontes.

## 7. Mudanças

| # | Peça | Arquivo |
|---|---|---|
| 1 | Tabela, gatilho, extensão de `fn_card_para_lead`, relatório | `supabase/migrations/20261024a_anuncios_ponte.sql` |
| 2 | Perguntas e respostas | `supabase/functions/deskcomm-base/bases/recepcao-faq.ts` |
| 3 | Documento gerado, categoria `triagem`, duas fontes novas | `deskcomm-base/montar.ts`, `deskcomm-base/index.ts` |
| 4 | Gatilho que regera o documento quando `anuncios` muda | mesma migration |
| 5 | Bel v7 | `scripts/deskcomm/base_bel.sql` |
| 6 | Playbook §8.5 e este spec | `playbook/DESKCOMM.md`, este arquivo |

## 8. Verificação

- Gatilho nos 10 contatos reais dentro de transação desfeita: etiquetas, linhas em `anuncios`, lead com o anúncio, e
  nenhum erro em `ponte_deskcomm.erros`. Confirmar que os gatilhos existentes de `contacts` (anonimização, colunas de
  cliente, trava de conversa) não reagem ao UPDATE de `tags`.
- Os dois sentidos da ordem (anúncio antes do lead, lead antes do anúncio) com contato de teste desfeito no fim.
- Fontes indexadas (`status = ready`, chunks > 0) e `crm_search_knowledge` achando as respostas de "é golpe?",
  "falar com uma pessoa" e "mensagem do simulador".
- A trava de promessas só aceita número provado por fonte: a base não traz percentual de desconto, então o teste é
  que a Bel não cita "20%" nem "15%" em resposta a "quanto é o desconto?".
- Teste real com anúncio: quando chegar o próximo lead do Connect. Registrado como pendente, não como feito.

## 9. Dados que dependem do dono (a base só os usa depois de confirmados)

| Dado | Situação |
|---|---|
| Telefone, e-mail, Instagram, Facebook, LinkedIn | Publicados no site |
| Razão social e CNPJ da B2W e da Associação | Não constam no site nem no cadastro |
| Endereço e cidade-sede | Não constam |
| Horário do atendimento humano (fuso da organização: America/Recife) | Não consta |
| Como o cliente confirma que é real, além do site | A definir com o dono |
| Nome, público e promessa de cada anúncio, inclusive o Connect | A preencher na tabela `anuncios` |
| Regras do Plano Connect (15%) | Projeto da base da Assinatura |
| Cobertura real em estados | Divergência site × plano vigente; resolver antes de qualquer afirmação |

Item sem confirmação não entra no texto da base: a pergunta correspondente responde "vou confirmar com a equipe".
