# Base de conhecimento do Agente Investidor (Usinas de Investimento)

Data: 19/10/2026 · Estado: implementado em 20/10/2026 (ver `playbook/DESKCOMM.md` §8.1)
Contexto: `playbook/DESKCOMM.md` (integração DeskcommCRM ↔ CRM B2W). Primeira das bases por produto.

## 1. Objetivo

Dar ao Agente Investidor (funil "Usinas de Investimento" no Deskcomm) o conhecimento para explicar o
produto, responder as dúvidas frequentes, oferecer as usinas disponíveis e levar o lead à reunião com o
consultor — sem inventar e sem prometer rentabilidade.

Fora do escopo (projetos seguintes):
- Lista de cotistas por usina (`usina_fornecedores`, aba "Vínculos de Fornecedor") e cotas disponíveis.
- Divisão do repasse mensal entre cotistas (split por cota).
- Bases dos outros agentes (Cotas, Assinatura, Eletroposto etc.).

## 2. Decisões

| Tema | Decisão |
|---|---|
| Números na conversa | Pode citar: preço a partir de R$ 290 mil, ~2% a.m., gestão de 10%. Sempre com a ressalva fixa. |
| Ressalva fixa | "Projeção, não garantia: varia com a geração anual, a tarifa da concessionária e o estágio da obra no momento do aporte. Os ~2% são antes do Simples Nacional." |
| Payback, TIR, rentabilidade ano a ano | Só com o consultor, mesmo que a página da usina mostre. |
| Proibido dizer | "garantido", "risco zero", "blindado", "100% seguro"; multa/retenção de rescisão; que o arrendamento é averbado na matrícula. |
| Material da usina | O agente envia o link da página da usina (`usinas.short_url`, página b2winvest.com.br). |
| Abaixo de R$ 290 mil | Explica a cota (a partir de R$ 35 mil = 1/10 da usina) e passa para humano com o motivo "quer cota — mover para o funil Cotas". O Deskcomm não tem ferramenta para trocar o funil, e o roteador mantém o agente da conversa (sticky). |
| Usina de terceiro querendo só gestão (14%) | Passa para humano com o motivo "gestão de usina de terceiro — funil Gestora/Comercializadora". |
| Fora da base | "Vou confirmar com o consultor" + handoff humano. Nunca inventa. |
| Arquitetura | Híbrida com sincronização automática (opção 3): prompt = comportamento; base = fatos. |

Por que os fatos ficam na base e não no prompt: o Deskcomm tem uma trava de promessas
(`lib/agent-engine/guardrails/promise/evidencias-comerciais.ts`) que só aceita afirmação comercial
provada por fonte do tipo `faq`, `documento` ou `catalogo` do agente. Número só no prompt pode ser barrado.

## 3. Comportamento do agente (nova versão do prompt)

Roteiro:
1. Entender o interesse: usina inteira ou valor menor; PF ou empresa; cidade.
2. Explicar o modelo em 3 frases: o investidor compra a usina; ela aluga os equipamentos a uma associação
   (Lei 14.300); os assinantes pagam a energia com desconto e o investidor recebe o repasse mensal.
3. Oferecer usinas: consulta "Usinas à venda" e envia o link da usina que combina com o lead.
4. Qualificar: valor do aporte, prazo, forma de pagamento (à vista, parcelado, financiamento).
5. Levar à reunião: com valor e interesse → handoff humano para agendar. Oferecer a visita
   (busca no aeroporto de Natal, usinas próximas e escritório no RN).

Etapas do funil:

| Situação | Etapa |
|---|---|
| Informou valor e interesse | Qualificando |
| Recebeu o link da usina | Simulação / Proposta enviada |
| Aceitou reunião ou visita | Reunião agendada (handoff humano) |

O prompt mantém as regras comuns já publicadas (`scripts/deskcomm/seed_funis_agentes.sql`) e acrescenta as
regras da seção 2.

## 4. Conteúdo da base

### 4.1 Fonte A — "Investidor — Perguntas e respostas" (tipo `faq`, estática)

Arquivo: `supabase/functions/deskcomm-base/bases/investidor-faq.ts`, no formato `## Pergunta:` /
`## Resposta:` aceito pelo Deskcomm. Fica em `.ts` (texto exportado) porque a Edge Function só empacota
arquivos importados: um `.md` lido com `Deno.readTextFile` não é publicado. Conteúdo aprovado:

1. **Como funciona o investimento em usina?** Você compra uma usina solar de cerca de 100 kWp com inversor
   de 75 kW, no limite da microgeração, o que a isenta de demanda contratada. Ela é GD2, de autoconsumo
   remoto, e aluga os equipamentos a uma associação, estrutura prevista na Lei 14.300. Os assinantes da
   associação consomem a energia com desconto, e você recebe o repasse mensal.
2. **Quanto custa?** A partir de R$ 290.000, conforme o estágio da obra e a previsão de entrega.
3. **Qual o retorno?** A projeção é de cerca de 2% ao mês, antes do Simples Nacional. Projeção, não
   garantia: varia com a geração anual, a tarifa da concessionária e o estágio da obra no momento do aporte.
   Payback e rentabilidade detalhada são apresentados pelo consultor em reunião.
4. **De onde vem a receita?** Geração × tarifa da concessionária, menos o desconto dado ao assinante, o Fio B
   e a gestão B2W (10% para usinas construídas pela B2W). O resultado é a tarifa do investidor, fonte da
   receita.
5. **E se o assinante não pagar?** O repasse acontece depois que os assinantes pagam, ao fim de cada ciclo.
   A B2W cobra os inadimplentes. A usina entra em operação com a geração distribuída entre assinantes com
   crédito aprovado, e há fila de espera: quem sai é substituído em até 30 dias.
6. **Quais são os custos mensais?** No primeiro ano, seguro e manutenção estão inclusos, e o custo fixo
   (arrendamento da área, internet, água e energia do local) fica em torno de R$ 866/mês, descontado do
   repasse. A partir do 13º mês entram a manutenção (R$ 300/mês) e o seguro (R$ 2.500/ano), também
   descontados do repasse. Valores da usina de referência; podem variar por usina.
7. **Posso vender a usina?** Sim. A usina é um ativo seu. A B2W ajuda a encontrar o comprador, e os
   contratos de gestão e de arrendamento são transferidos ao novo dono.
8. **Dá para comprar só uma parte?** Sim, por cotas: a partir de R$ 35.000, equivalente a 1/10 da usina.
   (O agente passa para humano, para mover ao funil Cotas.)
9. **Como é o pagamento?** Pode ser parcelado; o número de aportes depende do estágio da obra. Aceitamos
   financiamento bancário para usinas na fase de obras civis ou anterior, porque as notas fiscais dos
   equipamentos precisam sair em nome do investidor. Quanto antes você entra, menor o preço e maior a
   facilidade de pagamento.
10. **Quando começo a receber?** Cerca de 90 dias depois que a usina começa a gerar: 30 de geração, 30 de
    compensação e 30 de faturamento ao assinante. Depois, o repasse é mensal. Pelo app você acompanha o
    cronograma da obra, depois a geração e, com a usina gerando, o extrato de recebíveis.
11. **E o Fio B? A rentabilidade cai?** O Fio B sobe até 2029, como prevê a Lei 14.300, e isso já está na
    projeção. O reajuste anual da tarifa de energia compensa parte desse impacto. A projeção ano a ano é
    apresentada pelo consultor.
12. **Como fica o imposto?** O repasse é feito sempre a uma empresa. Ao comprar a usina, abrimos uma SPE ou
    um MEI, conforme o caso e com orientação do contador; os honorários da abertura ficam por conta da B2W.
    A tributação é pelo Simples Nacional.
13. **De quem é o terreno?** A usina fica numa área arrendada, com contrato de arrendamento em nome do
    investidor, cujo valor sai do repasse. Em algumas usinas é possível comprar a área, mas nem toda área
    está à venda: é caso a caso, e o consultor confirma.
14. **Que garantias tenho?** Instalação: 12 meses (B2W). Inversor: 5 anos. Módulos: 12 anos contra defeito
    e 20 anos de garantia de performance (degradação).
15. **Quem é a B2W? Posso visitar?** A B2W Energia é uma empresa mineira que opera há 8 anos no Rio Grande
    do Norte, estado de alto potencial energético. É especializada em usinas de investimento e acompanha o
    investidor de ponta a ponta, da prospecção da área à gestão dos assinantes. São mais de 1.000 usinas de
    varejo construídas e dezenas de usinas de investimento entregues. Você pode visitar uma usina em
    funcionamento e o escritório no RN: buscamos no aeroporto e levamos às usinas próximas.

Observação para o contador (não vai para a base): o limite do MEI é R$ 81 mil/ano, e uma usina inteira
fatura cerca de R$ 88,7 mil/ano; confirmar também se locação de equipamentos é atividade permitida ao MEI.

### 4.2 Fonte B — "Usinas à venda" (tipo `documento`, gerada do CRM)

Uma seção por usina com `a_venda = true` e status diferente de `cancelada`, ordenada pela previsão de
entrega:

```
## UFV Santa Maria — Santa Maria/RN
Estágio: em construção · Previsão de entrega: dez/2026
Potência: 102,24 kWp · inversor 75 kW · GD2 autoconsumo remoto
Preço: a partir de R$ 330.000
Modelo de venda: Integral
Página da usina: https://link.b2wenergia.com.br/ufvsantamariausina
```

Origem dos campos: nome, cidade/UF (`address`), status → estágio, `previsao_entrega`, `potencia_kwp`,
`potencia_inversor_w`, `modalidade_gd` + `modalidade`, `valor_investido`, `modelo_venda`, `short_url`.
Campo vazio sai como "a confirmar com o consultor".

Sem nenhuma usina à venda, o documento traz uma única linha: "No momento não há usina disponível; o
consultor avisa quando a próxima abrir."

Nunca entram: CPF/CNPJ, dono (`supplier_id`), credenciais do portal, UCs, endereço completo.

A linha de cotas disponíveis entra no projeto dos cotistas.

## 5. Mudanças

### 5.1 CRM B2W

- Migration: em `usinas`, `a_venda boolean not null default false`, `previsao_entrega date`,
  `modelo_venda text not null default 'integral' check (modelo_venda in ('integral','cotas'))`.
- `src/components/PowerPlantModal.jsx`, aba **Contratos**: campos "À venda", "Previsão de entrega" e
  "Modelo de venda"; incluir no payload de gravação.

### 5.2 Ponte (`ponte_deskcomm`)

- Tabela `fontes_base (chave text pk, knowledge_source_id uuid, ultimo_hash text, sincronizado_em timestamptz)`,
  chaves `investidor_faq` e `usinas_a_venda`.
- RPC `ponte_deskcomm_usinas_a_venda()` (só `service_role`): devolve as usinas da seção 4.2 já sem dados
  pessoais.
- Gatilho `trg_ponte_usinas_base`, AFTER INSERT/UPDATE (das colunas da seção 4.2)/DELETE em `usinas`, que
  chama `fn_chamar_funcao('deskcomm-base', '{}')`, com o mesmo `exception when others` → `erros` da ponte
  de leads: falha nunca bloqueia a gravação da usina.
- Cron `ponte-deskcomm-base` de hora em hora, como rede de segurança.

### 5.3 Edge Function `deskcomm-base`

- Autenticação: `x-ponte-token` conferido por `ponte_deskcomm_token_confere`, como na `deskcomm-ponte`.
- Organização e agente: lidos de `ponte_deskcomm.categorias` (`usina_investimento` → pipeline → agente).
- Para cada chave:
  1. Monta o texto (FAQ de bases/investidor-faq.ts; usinas da RPC) e calcula o hash. Hash igual ao último → não faz nada.
  2. Confere o contrato com o Deskcomm: bucket de conhecimento existe; `ai_knowledge_sources` tem
     `source_metadata`, `content_hash`, `status`; `ai_faq_items` existe; `emit_event` existe. Se algo
     falhar → registra em `erros`, não grava nada e devolve o motivo.
  3. Se a fonte não existir, cria-a (status `ready`, ativa, nome fixo).
  4. `documento`: grava um novo `.md` no bucket `ai-policy` (`<org>/base-<chave>-<hash>.md`), troca
     `source_metadata.blob_path` e apaga o arquivo anterior só depois da troca. **Não grava
     `content_hash`**: é o indexador que grava, e ele pula a fonte quando o hash já bate.
     `faq`: troca os itens de `ai_faq_items` da fonte numa única transação (RPC).
  5. Emite `knowledge_source.updated` (mesmo payload da rota do Deskcomm) e grava hash e data em
     `fontes_base`.
  6. Reenvio: o indexador descarta um segundo evento da mesma fonte dentro da janela de debounce. Por
     isso, mesmo com hash igual, se `last_indexed_at` da fonte for anterior a `sincronizado_em` (ou o
     status não for `success`), a função emite o evento de novo. O cron de hora em hora garante isso.
- `{"ensaio": true}`: devolve os textos e hashes sem gravar.
- Reproduz o que fazem `app/api/v1/ai/knowledge/sources/route.ts` e `.../[id]/reindex/route.ts` do
  Deskcomm 1.86.0; o plano confirma o nome do bucket e o payload do evento no código antes de implementar.

### 5.4 Agente

Script `scripts/deskcomm/base_investidor.sql` (idempotente): nova versão do Agente Investidor copiando a
versão publicada, com o prompt da seção 3 e `knowledge_source_ids` = as duas fontes; publicação via
`fn_publish_ai_agent_version` e registro `ai_agent.published` em `event_log`, como no seed.

### 5.5 Documentação

`playbook/DESKCOMM.md`: seção da base do Investidor, como mudar o FAQ, e o checklist pós-atualização do
Deskcomm (ensaio da `deskcomm-base` + conferir `last_index_status`).

## 6. Erros

| Situação | Comportamento |
|---|---|
| Deskcomm mudou o contrato (bucket, colunas, evento) | Não grava; `erros` com o motivo; a base anterior continua valendo. |
| Falha ao gravar o arquivo novo | A fonte continua apontando para o arquivo antigo. |
| Indexação falhou (`last_index_status` failed/sem_credencial) | Visível na tela de conhecimento do Deskcomm; o cron reenvia na próxima hora se o hash mudar. |
| Gatilho falhou | Não bloqueia a gravação da usina; o cron corrige. |

## 7. Testes

1. Ensaio: o texto traz a Santa Maria com o link certo e sem dado pessoal; o FAQ tem 15 pares.
2. Indexação: as duas fontes com `last_index_status = success` e `chunks_count > 0`.
   Teste automatizado (vitest) do montador de texto: usina sem link, campo vazio, nenhuma usina, cancelada,
   ordem por previsão, ausência de dados pessoais e leitura do FAQ (15 pares).
3. Conversa de teste no Deskcomm:
   - "qual o retorno?" → ~2% com a ressalva, sem bloqueio da trava de promessas;
   - "qual o payback?" → encaminha ao consultor;
   - "só tenho 50 mil" → oferece a cota e transfere para Cotas;
   - "tem usina disponível?" → envia o link da Santa Maria.
4. Gatilho: desmarcar "À venda" na Santa Maria → some do documento e o agente para de oferecê-la.

## 8. Riscos

- Acoplamento ao interior do Deskcomm (opção 3, escolhida): mitigado pela conferência do contrato antes de
  gravar e pelo checklist pós-atualização.
- Página da usina (b2winvest) usa termos absolutos ("risco zero", "blindagem 100%") e tem números
  inconsistentes (184.200 kWh / 1,32% a.m. contra 160.348 kWh / 2,24%). Fora deste escopo; recomenda-se
  revisar.
- Venda de usina como investimento com retorno anunciado: confirmar com o jurídico o enquadramento perante
  a CVM.
