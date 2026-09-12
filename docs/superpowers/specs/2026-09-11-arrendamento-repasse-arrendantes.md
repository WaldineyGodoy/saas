# Spec — Repasse de arrendamento aos arrendantes

**Data:** 11/09/2026
**Produto:** CRM Aura (B2W Energia)
**Banco:** Supabase `abbysvxnnhwvvzhftoms`
**Status:** decisões do dono do produto tomadas; pronto para virar plano de implementação

---

## 1. Problema

A B2W cobra arrendamento do fornecedor e precisa repassar ao dono da terra. **A cobrança
existe. O repasse não existe em lugar nenhum do sistema.**

Não é um defeito de tela. Faltam as quatro peças inteiras:

| Peça | Estado |
|---|---|
| Conta contábil para a obrigação com o arrendante | não existe |
| Conta de despesa para o caso pré-operação | não existe |
| Forma de pagar o arrendante (chave PIX ou boleto) | não existe campo |
| Rota de saída no gatilho de transferência | cai em conta sintética |

### 1.1 O que existe hoje

A cobrança nasce em `usinas.service_values->>'Arrendamento'`, um campo JSON. No dia 1 o
cron `monthly_expenses` copia esse número para o rascunho do mês em
`generation_production.arrendamento`. O lançamento no razão só acontece em
`fechar_producao`, que debita o fornecedor em `2.1.1` e credita **`3.1.4 Receita de
Arrendamento B2W`**.

O cadastro da área é outra coisa, paralela: `leased_areas`, criada em 31/08/2026, com o
arrendante gravado em linha (`arrendante_nome`, `arrendante_doc`, `arrendante_endereco`).
Ela alimenta o contrato de arrendamento e nada mais. Não conversa com a cobrança.

### 1.2 Os três erros estruturais

**(a) Arrendamento não é receita da B2W.** A conta `3.1.4` é de receita e recebe 100% do
valor cobrado. Mas o dinheiro não é da B2W: ela arrecada para repassar. Sem um passivo,
o PIX ao arrendante não tem contrapartida para debitar. Saldo hoje em `3.1.4`:
**R$ 1.200,00**, que o razão afirma ser lucro e não é.

**(b) Um arrendante por área, gravado na própria linha.** Não cabe o caso de dois
beneficiários, nem o caso da imobiliária que recebe no lugar do proprietário.

**(c) O roteador manda o desconhecido para conta-título.** `handle_transfer_ledger()`
decide a conta pelo `destination_type`: `supplier`/`usina` → `2.1.1`, `originator` →
`2.1.2`, **qualquer outro valor → `2.1.0`**, que é conta sintética. Um PIX a arrendante
hoje aterrissa ali.

### 1.3 Redundância a aposentar

`leased_areas.supplier_id` é escrito e lido **apenas pela própria tela de configurações**.
Nenhuma outra parte do sistema o consome. O vínculo real é `usinas.leased_area_id`.

Derivar é melhor do que cadastrar: a FK permite duas usinas apontarem para a mesma área,
e nesse caso "qual o fornecedor desta área" deixa de ter resposta única. O caminho usina
→ área sempre tem resposta; o inverso não.

---

## 2. Decisões do dono do produto

| # | Decisão | Data |
|---|---|---|
| 1 | Fornecedor é derivado via `usinas.leased_area_id`; `leased_areas.supplier_id` é aposentado | 11/09/2026 |
| 2 | Arrendamento pago **antes da operação é custo da B2W**, não adiantamento recuperável | 11/09/2026 |
| 3 | A margem de intermediação existe, e a B2W entra como **beneficiário do rateio**, não como arrendante do contrato | 11/09/2026 |
| 4 | Nas áreas Vista Bom Jesus I e II a margem é **zero**: 100% ao arrendante | 11/09/2026 |
| 5 | Agosto/2026 da Bom Jesus II entra como **pré-operação** | 11/09/2026 |

### 2.1 Consequência da decisão 2

Durante a obra não há fornecedor sendo cobrado, logo **não há margem sendo ganha**. O que
a B2W desembolsa é a parte do arrendante, não o `valor_aluguel` inteiro. A linha da casa
não produz lançamento enquanto não houver receita.

### 2.2 Consequência da decisão 3

**Beneficiário do pagamento não é arrendante do contrato.** A B2W é a arrendatária. Se
entrar como arrendante, o gerador em `src/lib/contratosUsina.js` a coloca na cláusula de
qualificação e no bloco de assinatura — quatro pontos leem `arrendante_nome` direto — e o
documento passa a ter a mesma empresa nos dois polos.

O mesmo vale para a imobiliária: ela recebe o dinheiro, o proprietário assina o contrato.

Um campo `tipo` na linha do beneficiário governa três coisas:

| `tipo` | Crédito vai para | Entra na fila de pagamento | Aparece no contrato |
|---|---|---|---|
| `terceiro` | passivo `2.1.5` | sim | sim, como ARRENDANTE |
| `intermediario` | passivo `2.1.5` | sim | não (recebe, não arrenda) |
| `casa` | receita `3.1.4` | **nunca** | não |

Se a linha da casa gerar passivo, nasce uma obrigação da B2W com ela mesma, que nunca
será paga e engorda o passivo para sempre. É a mesma doença dos R$ 10.694,81 que não
fecham no razão hoje.

---

## 3. Arquitetura

Três eventos econômicos distintos, **um único trilho de pagamento**.

### 3.1 Reconhecer (usina em operação)

O débito no fornecedor não muda: `2.1.1` continua recebendo o valor cheio, então o
repasse ao investidor é idêntico ao de hoje. O que muda é o crédito, que passa a se
dividir conforme o rateio dos beneficiários.

```
2.1.1  Repasse para o Investidor      + valor cheio      (débito, inalterado)
2.1.5  Arrendamento a Pagar           − soma dos terceiros e intermediários
3.1.4  Receita de Intermediação       − parte da casa
```

`3.1.4` deve ser renomeada de "Receita de Arrendamento B2W" para **"Receita de
Intermediação de Arrendamento"**, porque passa a receber só a margem.

### 3.2 Reconhecer (usina fora de operação)

Não há fornecedor a debitar. O débito vira despesa da própria B2W, e o crédito vai para o
**mesmo** passivo:

```
4.2.1  Arrendamento de Áreas (pré-operação)   + parte dos terceiros
2.1.5  Arrendamento a Pagar                   − parte dos terceiros
```

`4.2.1` é conta nova, de despesa. Requer o grupo `4.2.0 Despesas Operacionais`, que
também não existe.

### 3.3 Pagar (idêntico nos dois casos)

Este é o ponto central da arquitetura: **não se constrói um segundo caminho de pagamento
para a usina em construção.** Constrói-se uma segunda origem de débito. A saída é a mesma.

```
2.1.5     Arrendamento a Pagar   + valor pago
1.1.1.01  Banco Asaas            − valor pago
```

---

## 4. Modelo de dados

### 4.1 `leased_area_beneficiaries` (nova)

Uma linha por beneficiário. Área com um único dono é o caso de uma linha, sem exceção no
código.

| Campo | Observação |
|---|---|
| `leased_area_id` | FK |
| `nome`, `doc` | quem recebe |
| `tipo` | `terceiro` \| `intermediario` \| `casa` (ver 2.2) |
| `assina_contrato` | `terceiro` sim; demais não |
| `rateio_tipo` | `percentual` \| `fixo` |
| `rateio_valor` | |
| `forma_pagamento` | `pix` \| `boleto` — **por beneficiário, não por área** |
| `pix_key`, `pix_key_type` | só quando `pix` |
| `ativo` | |

**O trilho é do beneficiário.** Uma mesma área pode ter um arrendante recebendo por PIX e
outro por boleto da imobiliária. Não é caso de exceção: é o arranjo normal quando a terra
tem dois donos e só um delegou a cobrança. Consequências que o plano precisa tratar:

- **Pagamento parcial é estado legítimo, não erro.** Uma competência pode estar paga para
  um beneficiário e pendente para o outro. A tela mostra por beneficiário; "a área foi
  paga" não é uma pergunta que o sistema responde.
- **Os dois trilhos têm tempos diferentes.** O PIX confirma em segundos; o boleto no Asaas
  é agendado e confirma depois. Um não pode esperar o outro.
- **O boleto tem dependência externa.** Não se paga antes da linha digitável chegar da
  imobiliária, e ela chega a cada competência. Daí o status `aguardando_boleto` em 4.2.

Migração de dados: o arrendante gravado em linha em `leased_areas` vira a primeira linha
desta tabela, `tipo = 'terceiro'`, `assina_contrato = true`. As colunas
`repasse_tipo`/`repasse_valor` do pai são aposentadas junto com `supplier_id`.

**Aritmética do rateio**, nesta ordem, para não perder centavo:

1. Resolver os valores fixos primeiro.
2. Aplicar os percentuais sobre o que sobrar.
3. Designar um beneficiário para receber o resíduo do arredondamento.

A soma tem que bater com o total ao centavo, sempre. Invariante: com a casa ocupando uma
linha, o rateio soma **exatamente** 100%, e não "até 100% com o resto implícito".

### 4.2 `arrendamento_pagamentos` (nova)

Uma linha por beneficiário por competência. É o razão auxiliar do passivo `2.1.5`: é o
que responde "o Marcos recebeu julho?" sem garimpar lançamento contábil.

| Campo | Observação |
|---|---|
| `beneficiary_id`, `usina_id`, `competencia` | chave natural |
| `valor`, `vencimento` | |
| `origem` | `fornecedor` \| `b2w_pre_operacao` |
| `status` | `a_pagar` \| `aguardando_boleto` \| `enfileirado` \| `pago` \| `falhou` |
| `forma_pagamento` | herdada do beneficiário no momento do pagamento |
| `linha_digitavel` | **só quando boleto**, ver 4.3 |
| `financial_transfer_id` | quando PIX |
| `external_id` | idempotência, padrão de `fechar_producao` |

### 4.3 Por que a linha digitável não fica no cadastro

Chave PIX e boleto são naturezas diferentes de dado:

- A **chave PIX é permanente**. Cadastra uma vez, serve para sempre. Fica no beneficiário.
- O **boleto é do mês**. A linha digitável muda a cada competência e vale só para aquele
  pagamento. Fica na linha de `arrendamento_pagamentos`.

Guardar a linha digitável no cadastro da área significa sobrescrevê-la todo mês e perder
o registro do que foi efetivamente pago em julho quando se estiver pagando setembro.

**Trava de graça:** a linha digitável de boleto bancário carrega o valor e o fator de
vencimento dentro dela. Conferir os dois contra o esperado antes de mandar pagar protege
contra colar o boleto do mês errado ou de outro credor. O projeto já usa essa trava nas
contas de energia (ver memória `fatura-codigo-barras-valor`).

---

## 5. Motor de pagamento

### 5.1 PIX — estender, não criar

`transfer-asaas-pix` grava em `financial_transfers`, e o gatilho `tr_transfer_ledger`
lança no razão. Basta `handle_transfer_ledger()` conhecer
`destination_type = 'arrendante'` → conta `2.1.5`.

### 5.2 Boleto — o motor existe, falta o registro

`pay-asaas-bill` está em produção pagando as contas de concessionária. Recebe a linha
digitável, manda ao Asaas, exige perfil admin.

**Ressalva que o plano precisa tratar:** ela **não grava nada no banco**. Quem lança no
razão é a tela que chamou, por uma chamada de RPC separada logo depois
(`InvoiceSummaryModal.jsx:395`). Se o boleto for pago e essa segunda chamada falhar, o
dinheiro saiu e o razão não soube.

Para arrendamento, seguir o padrão do PIX: **o lançamento nasce de gatilho sobre a
mudança de status em `arrendamento_pagamentos`**, não da tela.

### 5.3 Regras operacionais

1. Nunca inserir em `ledger_entries` à mão. Os R$ 1.200 mal classificados mostram como um
   caminho manual deriva.
2. **O passivo tem que existir antes do PIX.** Se `2.1.5` ficar negativo, é sinal de que
   se pagou algo que nunca foi reconhecido.
3. Todo lançamento leva `external_id`, no padrão que `fechar_producao` já usa.

---

## 6. Caso concreto: os R$ 2.400 de Bom Jesus I e II

### 6.1 Situação encontrada

| Arrendante | Usina | Fornecedor | Devido | Razão reconhece |
|---|---|---|---:|---:|
| José Santiago | Bom Jesus I | Tobias Bertussi | R$ 1.200 | R$ 1.200, em conta errada |
| Marcos Santiago | Bom Jesus II | Tobias Bertussi | R$ 1.200 | R$ 0 |

Competências devidas: **Julho e Agosto/2026**, vencimentos 05/08 e 05/09, R$ 600 cada.

**Bom Jesus II nunca cobrou arrendamento de ninguém.** `service_values` está vazio, não há
lançamento, e o rascunho de agosto veio com `arrendamento` nulo. Ela só passou a gerar em
31/08/2026 — a UC geradora tem uma única fatura, referência agosto.

**Bom Jesus I tem deslocamento de um mês.** Os dois lançamentos existentes:

| Transação | Competência rotulada | Data do lançamento |
|---|---|---|
| `a023778f-8460-4fff-ab82-0a7985aa969b` | Junho/2026 | 09/07/2026 |
| `d1f4c4f6-b729-4967-8912-6e3fec43b8b1` | Julho/2026 | 01/08/2026 |

Junho foi cobrado indevidamente do Tobias; agosto nunca foi reconhecido. O total coincide
por acaso.

### 6.2 Lançamentos de acerto

**Transação A — Bom Jesus I (José Santiago), cobrado do fornecedor**

```
2.1.1  − 600,00   Estorno arrendamento Junho/2026 (competência indevida)
2.1.1  + 600,00   Arrendamento Agosto/2026 (competência não reconhecida)
3.1.4  + 1.200,00 Reclassificação: arrendamento não é receita da B2W
2.1.5  −   600,00 Arrendamento a pagar — José Santiago, Julho/2026
2.1.5  −   600,00 Arrendamento a pagar — José Santiago, Agosto/2026
                  soma = 0
```

Efeito líquido no Tobias: **zero**. Ele já foi debitado em R$ 1.200 e continua debitado
em R$ 1.200, agora nos meses certos. Efeito em `3.1.4`: zera, porque a margem é zero
(decisão 4).

**Transação B — Bom Jesus II (Marcos Santiago), pré-operação**

```
4.2.1  +   600,00 Arrendamento pré-operação — Bom Jesus II, Julho/2026
4.2.1  +   600,00 Arrendamento pré-operação — Bom Jesus II, Agosto/2026
2.1.5  −   600,00 Arrendamento a pagar — Marcos Santiago, Julho/2026
2.1.5  −   600,00 Arrendamento a pagar — Marcos Santiago, Agosto/2026
                  soma = 0
```

**O Tobias não é tocado**, que é exatamente o efeito pretendido pela decisão 2.

**Transação C e D — os pagamentos**, R$ 1.200 cada, pelo trilho de 3.3. Ao final `2.1.5`
zera e o Banco Asaas vai de R$ 20.335,33 para R$ 17.935,33.

### 6.3 Pendências de cadastro antes de pagar

- Nenhum dos dois tem chave PIX ou boleto: o campo não existe ainda.
- `repasse_valor` está nulo nas duas áreas. Como é 100% ao arrendante, precisa ser
  percentual com valor 100, senão o rateio lê nulo e paga zero.
- "Marcos Santigo" está sem uma letra, e o campo alimenta o contrato.
- `Vista Bom Jesus - II` está sem `mes_inicio`.
- A partir de setembro/2026 a Bom Jesus II passa a cobrar do Tobias, e
  `usinas.service_values` precisa receber o valor — hoje está vazio.

---

## 7. Onde o código precisa entrar

**Atenção de branch.** `fechar_producao` está rodando em produção mas suas migrações
**não estão na `main`**: vivem só no worktree de `impl/fechamento-mensal`, que segue sem
merge, 20+ commits à frente. Uma migração escrita na `main` que altere essa função será
sobrescrita no merge.

| Parte | Onde |
|---|---|
| Contas novas (`2.1.5`, `4.2.0`, `4.2.1`) e renomeação de `3.1.4` | `main` (DDL isolado) |
| Tabelas novas e migração de dados | `main` |
| Rota `arrendante` em `handle_transfer_ledger()` | `main` (independente do fechamento) |
| Split do crédito em `fechar_producao` | **`impl/fechamento-mensal`** |
| Campos de pagamento na tela de área arrendada | `main` |

---

## 8. Risco de fundo

**O razão não fecha.** A soma de todas as contas dá **R$ −10.694,81** em vez de zero,
concentrada em lançamentos de uma perna só:

| Transação | Desbalanço | Descrição |
|---|---:|---|
| `a7003025` | −6.732,11 | Crédito de kWh compensados, 12218 kWh |
| `c23c0d22` | −5.276,09 | Crédito de kWh compensados, 9575 kWh |
| `8e4a53a6` | −1.668,76 | COND RESID MIRANTES GREEN PARK |
| `6f96b2e1` | −1.413,17 | GUANABARA AUTO DIESEL |

Montar um fluxo novo de dinheiro sobre um razão que já não fecha significa que, daqui a
seis meses, não será possível auditar o arrendamento separando erro novo do que já estava
torto. Não bloqueia esta spec, mas precisa de decisão própria.

---

## 9. Critérios de aceite

1. Um PIX ou boleto a arrendante nunca cai em conta sintética.
2. `2.1.5` zera quando todos os arrendantes de uma competência foram pagos, e **nunca
   fica negativo**.
3. `3.1.4` recebe apenas a margem; nas áreas de margem zero permanece em zero.
4. Usina em obra paga o arrendante sem tocar o `2.1.1` do fornecedor.
5. Uma área com dois beneficiários rateia somando o total ao centavo.
6. A B2W nunca aparece na cláusula de arrendante do contrato gerado, nem na fila de
   pagamento.
7. Rodar o reconhecimento duas vezes para a mesma competência não duplica lançamento
   (`external_id`).
8. Pagar boleto com valor divergente da linha digitável é recusado antes de chamar o Asaas.
9. Uma área com um beneficiário em PIX e outro em boleto paga os dois de forma
   independente: a falha ou o atraso de um não impede nem desfaz o outro.
