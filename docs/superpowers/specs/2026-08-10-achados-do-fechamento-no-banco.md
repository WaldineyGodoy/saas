# Achados do fechamento no banco: o que o operador e o próximo plano precisam saber

**Data:** 10/08/2026
**Origem:** execução do plano [`2026-08-09-fechamento-mensal-no-banco.md`](../plans/2026-08-09-fechamento-mensal-no-banco.md), 11 tasks mais uma rodada de correção, e a revisão final da branch inteira.
**Para:** quem for rodar o primeiro fechamento real, e quem escrever o plano da tela unificada.

Este documento existe pelo mesmo motivo que o [anterior](2026-08-08-achados-para-o-plano-do-fechamento.md): o ledger da execução vive num diretório descartável, e há coisas aqui que ninguém deveria redescobrir com dinheiro real.

---

## 1. 🔴 Antes do primeiro fechamento real

Quatro coisas travam o go-live. Nenhuma trava o merge — o SQL está correto para meses novos — mas todas as quatro precisam de resposta antes de alguém apertar "fechar" em produção.

### a) `repasse_status` nunca sai de `enfileirado`

O `CHECK` da coluna aceita `pago` e `erro`, e **nada no sistema escreve esses valores**. Do lado do boleto existe `confirmar_pagamento_ug`, chamada pela Edge Function depois da resposta do Asaas. Do lado do PIX não existe equivalente: `transfer-asaas-pix` não devolve nada ao banco, e o `asaas-webhook` atualiza `financial_transfers` sem propagar para `generation_production`.

Consequência prática: **`enfileirado` não significa que o dinheiro saiu.** Todo repasse fica nesse estado, tenha dado certo ou não. Até existir a função de confirmação, cada repasse precisa ser conferido no extrato do Asaas à mão.

Criar a função sozinha não resolve — ela nasceria sem chamador. Fechar o ciclo exige mexer no `asaas-webhook`, que é webhook de pagamento vivo, e isso merece frente própria.

**Medido em 10/08/2026, e a frente é menor do que parece:** o `asaas-webhook` **já recebe e classifica** os eventos de transferência (`index.ts:64-80`) — `TRANSFER_DONE` e `TRANSFER_CONFIRMED` viram `completed`, `TRANSFER_FAILED` e `TRANSFER_REVERSED` viram `failed`, `TRANSFER_PENDING` vira `pending` — e já atualiza `financial_transfers` por `asaas_transfer_id`. O mecanismo existe; ele só não propaga para `generation_production`.

Faltam três coisas, e a primeira é a única com decisão de desenho:

1. **Saber qual transferência pertence a qual fechamento.** `transfer-asaas-pix` grava `financial_transfers` com `destination_id = supplier_id` e nada mais — e um fornecedor tem três usinas, que é a mesma ambiguidade que já obrigou a guarda de 3 minutos em `liquidar_producao`. Precisa de um vínculo explícito: passar uma referência no corpo do POST que `transfer-asaas-pix` persista, ou uma coluna nova em `financial_transfers`.
2. **A RPC `confirmar_repasse(uuid, boolean, jsonb)`**, espelho de `confirmar_pagamento_ug`, que já existe, funciona, e tem as guardas certas para copiar.
3. **Poucas linhas no webhook**, chamando a RPC depois do update que ele já faz.

### b) `transfer-asaas-pix` não tem autenticação

`verify_jwt = false` no `config.toml` e nenhuma verificação no código. Ela aceita `pixKey` e `value` do corpo da requisição. A única barreira é a trava antifraude de 2 minutos por destino — e quem chama escolhe o destino.

Era débito tolerável enquanto ninguém dependia dela. Esta branch a coloca no caminho do repasse mensal.

### c) O primeiro repasse de cada usina precisa de conferência humana

`saldo_receber` mudou de base: passou a ser tarifa do fornecedor × kWh compensado (decisão 11 da spec), quando antes era rateio por valor de fatura. Medido em 04/2026 da UFV Bom Jesus, isso é **2,5×** o que o sistema antigo registrava — R$ 6.650,32 contra R$ 2.655,84.

O número novo é o do contrato e casa com 05/2026 dentro de 1%. Mas ninguém reconciliou o modelo novo contra o caixa efetivamente recebido, e não existe teto nem checagem de sanidade. Confira a ordem de grandeza antes de liquidar.

A divergência entre o faturamento por kWh e o razão por valor é assunto da **frente do split**, e vai persistir até ela acontecer: `saldo_receber` e o saldo da conta `2.1.1` não vão bater.

### d) Não liquide duas usinas do mesmo fornecedor em sequência

`transfer-asaas-pix` recusa transferência para o mesmo destino dentro de 2 minutos. **TOBIAS BERTUSSI tem três usinas** — UFV Bom Jesus, UFV Bom Jesus II e UFV - Potengi - SPP.

`liquidar_producao` ganhou guarda para isso: recusa o segundo repasse ao mesmo fornecedor dentro de 3 minutos, falhando alto em vez de deixar o Asaas descartar em silêncio. Mas a guarda consulta `financial_transfers`, e essa linha só nasce depois do round-trip ao Asaas — então dois cliques separados por poucos segundos ainda passam pelas duas. A guarda cobre o caso realista (operador liquidando usina após usina), não a corrida.

---

## 2. Fechar é irreversível, e não existe caminho de volta

O enum `production_status` tem `em_producao`, `fechado`, `liquidado`. Não existe `reabrir_producao` nem equivalente.

Se o Asaas recusar o boleto, o mês fica em `fechado` com `pagamento_ug_status = 'erro'`, e daí:

- `liquidar_producao` recusa (exige `pago` ou `manual`);
- `fechar_producao` recusa (exige `em_producao`);
- `confirmar_pagamento_ug` recusa (exige `enfileirado`).

**Estado terminal.** E a recuperação manual também está bloqueada: `ledger_entries.external_id` é `UNIQUE`, então reexecutar `fechar_producao` depois de um reset de status à mão levanta `unique_violation` — teria que apagar partidas do razão antes.

Boleto recusado é evento ordinário, não excepcional. Isto vai acontecer.

Duas linhas já estão nesse formato em produção: 02/2026 e 03/2026 estão `fechado` com `pagamento_ug_status` NULL, e não há função que as mova.

---

## 3. O faturamento fechado é o do rascunho, mas a validação é ao vivo

`fechar_producao` chama `fn_faturamento_detalhado` só para checar `descartadas > 0`. Todo o dinheiro sai de `generation_production.faturamento_mensal`, congelado quando o cron rodou — dia 1, 00:05.

Uma fatura paga entre o rascunho e o fechamento **passa na validação e não entra no repasse**. Sem aviso, sem contagem.

Existe correção: `run_monthly_fixed_expenses(DATE '<mês>')` com data explícita refresca `faturamento_mensal` enquanto o mês está `em_producao`. **Rode isso imediatamente antes de fechar.** O fechamento não faz sozinho e não avisa.

---

## 4. As linhas herdadas foram corrigidas, mas o mecanismo que as quebrou continua

O `ON CONFLICT` de `run_monthly_fixed_expenses` não toca `manutencao`, `arrendamento` e `service_details`, para preservar edição do operador. As 8 linhas `em_producao` que existiam vieram do fluxo antigo com esses campos zerados e com `Energia` dentro de `service_details` — a migration `20260810a_backfill_contrato_rascunhos.sql` as repopulou.

**Ela não é reexecutável:** rodar de novo sobrescreve edição do operador pelo contrato. Está avisado no cabeçalho, mas é comentário, não guarda.

E a guarda que impede o sintoma voltar é a de `fechar_producao`, que recusa `service_details ? 'Energia'`. Se alguém acrescentar `Energia` a `service_values` de novo, o rascunho volta a nascer errado — a guarda pega no fechamento, não na criação.

---

## 5. Para o plano da tela unificada

**Quatro pontos vivos escrevem contra `plant_closings`, tabela que não existe** — e a migration `20260809g_aposentadorias.sql` agora aborta se ela voltar. A caracterização precisa importa, porque só um deles é o defeito que originou toda esta frente:

| ponto | comportamento |
|---|---|
| `PlantClosingModal.jsx:106` | **silencioso de verdade** — `error` desestruturado e nunca lido; o formulário abre vazio sem aviso |
| `PlantClosingModal.jsx:250/252` | `result.error` é checado na 256, mostra alerta vermelho |
| `PlantClosingsHistoryModal.jsx:25` | checa e faz `console.error`; lista vazia sem alerta |

A tela nova consome as RPCs, e o contrato delas mudou em relação ao que o plano original previa:

- `fechar_producao(p_id uuid, p_pagamento_manual boolean DEFAULT false)` devolve `jsonb` com `ok`, `transaction_id`, `total_despesas`, `saldo_receber`, `pagamento_ug`. Recusa com exceção em oito situações — mês não `em_producao`, conta da UG ausente, fatura paga descartada, `total_despesas` NULL, `Energia` em `service_details`, conta já paga sem `p_pagamento_manual`, conta sem linha digitável sem `p_pagamento_manual`.
- `liquidar_producao(p_id uuid)` devolve `jsonb` com `ok`, `valor`, `destino`, `razao`. **Não tem `transaction_id`** — ela não lança no razão, porque o trigger `tr_transfer_ledger` já lança a mesma partida quando o PIX completa.

A tela precisa mostrar essas recusas como orientação, não como erro genérico. Cada uma tem ação correspondente do operador, e a mensagem já diz qual.

---

## 6. A suíte de testes depende de dados vivos de produção

Não há banco local neste projeto, e isso foi decisão consciente. A consequência é que **um teste pode passar hoje e falhar amanhã sem ninguém tocar em código**, e a falha vai parecer defeito quando é o mundo mudando.

Aconteceu durante a execução: seis blocos de `fechar_producao.test.sql` quebraram quando a guarda de conta paga entrou, porque usavam a conta de 05/2026 como fixture e nunca declararam que dependiam dela não estar paga. Foram corrigidos tornando a dependência explícita — mas o padrão pode se repetir em qualquer bloco que leia estado real sem fabricá-lo.

Dois detalhes operacionais de quem for rodar a suíte:

- **`reproducao_042026.test.sql` e `rascunho_mensal.test.sql` usam funções `pg_temp`** e só rodam se o arquivo inteiro for enviado numa chamada só. `pg_temp` é schema de sessão, e cada `execute_sql` abre sessão nova. Um runner que fatie por statement derruba os dois com erro que parece defeito de teste.
- **`faturamento_mensal.test.sql` nunca compilou até 10/08/2026** — `RAISE` com dois literais `%%` e zero placeholders para três argumentos. Ele veio da branch do núcleo alegando validar a fórmula contra produção, e não validava nada. Corrigido, e a varredura confirmou que era o único da suíte. Vale a lição: um teste quebrado se parece com um teste que passa, se ninguém olhar a saída.

---

## 7. Itens menores, registrados

- **`faturamento_mensal.test.sql` vira tautologia** assim que o cron novo refrescar `generation_production.faturamento_mensal`. Hoje ele compara `fn_faturamento_mensal_usina` contra o valor gravado pelo **fluxo antigo** (modelo por valor), desvio 1,08%. Quando o cron novo gravar, os dois lados passam a ser a mesma fórmula e a tolerância de 2% deixa de assertar qualquer coisa.
- **O `cashbook` só lista contas `1.1.1.*`.** Um segundo banco (`1.1.1.02`) entra sozinho; uma conta a receber (`1.1.2`) não entra, e é correto que não entre. Mas o teste prova só a direção negativa — `la.code = '1.1.1.01'` passaria em todas as asserções.
- **`cashbook.transaction_date` é data de gravação, não de competência.** Um lançamento de julho gravado em agosto cai em agosto. Vira problema quando alguém agrupar por mês.
- **`ledger_entries` tem policy de `DELETE` e `UPDATE` para `authenticated` com `USING(true)`.** A arquitetura declara o razão imutável; ele não é. Pré-existente, e da mesma família das 21 tabelas com RLS `USING(true)` que a spec §9 já registrou.
- **`generation_production` também tem policy `ALL USING(true)`** para `authenticated`. É o que torna as guardas de reconciliação necessárias em vez de teóricas: `liquidar_producao` reconfere `saldo_receber` contra a fórmula, e `pagar-conta-ug` reconfere o valor contra a conta, justamente porque as colunas são editáveis por qualquer sessão autenticada.
- `pagamento_ug_invoice_id` é FK sem `ON DELETE` e sem índice.

---

## 8. O que a execução ensinou sobre o plano

Vinte e um defeitos graves foram encontrados durante a execução. **Dezoito estavam no plano** — o texto que os implementadores copiam verbatim — e não no trabalho deles.

Três padrões se repetiram, e vale procurá-los no próximo plano antes de executá-lo:

**a) Validar uma fonte e usar outra.** Apareceu três vezes, sempre em código que move dinheiro: a Edge Function pagava o valor do corpo da requisição em vez do valor da conta; `liquidar_producao` mandava por PIX a coluna `saldo_receber` sem reconferir contra a fórmula; `fechar_producao` chamava `fn_conta_ug` para validar e lançava a coluna `custo_disponibilidade`. As três foram corrigidas para reconferir.

**b) Asserção que compara a implementação consigo mesma.** Quatro tasks voltaram por isso. O caso mais instrutivo: a view `cashbook` era assertada contra `sum(abs(amount))` do razão — uma igualdade verdadeira por construção, que passaria com a view completamente errada. Um oráculo tem que vir de fora da coisa testada.

**c) Comentário afirmando causa não verificada.** Seis foram corrigidos. Um deles atribuía a um webhook uma mudança de dado que nunca aconteceu; outro prometia "aqui fica o registro no banco" sobre um objeto que não existe no banco. Comentário em arquivo de migração é documentação permanente.

E uma quarta coisa, que não é padrão de defeito mas de processo: **os quatro achados mais graves só apareceram quando alguém olhou o sistema inteiro contra os dados que já existiam.** Nenhum deles seria pego revisando task por task, porque nenhum estava errado isoladamente — a duplicação do lançamento do PIX, as linhas herdadas com contrato zerado, a conta já paga sendo repaga, e a view que era espelho do razão em vez de livro caixa.
