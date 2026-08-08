# Spec — Fechamento mensal de usina e consolidação contábil

**Data:** 08/08/2026
**Produto:** CRM Aura (B2W Energia)
**Banco:** Supabase `abbysvxnnhwvvzhftoms`
**Status:** aprovado pelo dono do produto, pronto para virar plano de implementação

---

## 1. Problema

O fechamento mensal de usina — onde se lançam os custos fixos que a usina gera ao
fornecedor (manutenção, arrendamento, internet, água, energia, segurança e despesas
eventuais) — está implementado **três vezes**, em três lugares que não se conhecem.

| # | Implementação | Destino | Estado |
|---|---|---|---|
| 1 | `run_monthly_fixed_expenses()` | `ledger_entries` + `cashbook` | **ativa** — pg_cron, dia 1 às 00:05 |
| 2 | `BillingModal` → `BillingList` | `generation_production` | funcional |
| 3 | `PlantClosingModal` | `plant_closings` | **morta** — a tabela não existe |

Uma quarta implementação existe e está morta: a Edge Function `cron-monthly-expenses`
filtra `status = 'operacao'`, valor que não existe no enum `usina_status`. Ela nunca
retornou uma usina e nunca produziu efeito.

### 1.1 Consequências medidas em produção

**Os números já divergem.** Para 05/2026, serviços da UFV Bom Jesus:

```
generation_production   R$ 266,10   (Energia 110,20)
cashbook + ledger       R$ 265,69   (Energia 109,79)   ← lançado pelo cron em 01/08 00:05
```

**O custo de disponibilidade é digitado à mão e está defasado em um mês:**

| Mês | Conta real da UG | `custo_disponibilidade` lançado | Erro |
|---|---:|---:|---|
| 03/2026 | 110,20 | 102,00 | valor de outro mês |
| 04/2026 | 109,79 | 110,20 | é a conta de março |
| 05/2026 | 118,18 | 0 | não descontado |
| 06/2026 | 119,87 | 0 | não descontado |

Maio e junho somam **R$ 238,05** que o fornecedor deveria ter pago e a B2W absorveu.
Apenas nessa usina, apenas nesses dois meses.

**A fórmula de `total_despesas` mudou no meio do caminho:**

```
Fev, Mar/2026:   144,00 = disponibilidade 102,00 + serviços 42,00     ← inclui disponibilidade
Abr/2026:        266,10 = serviços 266,10                              ← não inclui
```

Mesma coluna, duas regras. Qualquer soma histórica está errada.

**A taxa de gestão da plataforma está zerada.** `usinas.gestao_percentual = 0` em 5 das
6 usinas. O trigger do split faz `COALESCE(gestao_percentual, 15)`, que só age em `NULL`
— nunca em `0`. O fallback de 15% jamais dispara. `generation_production.gestao_reais`
é `0` em 11 de 11 registros.

**`generation_production` tem duplicatas:** 4 linhas idênticas para 06/2026 e 2 para
05/2026, todas zeradas. Não há constraint de unicidade.

**`cashbook` e `ledger_entries` são dois livros que nunca batem.** O trigger
`handle_invoice_paid()` grava o valor **cheio** da fatura no cashbook; o
`handle_invoice_paid_ledger()` grava o **rateado** no razão. Nada reconcilia.
As 10 linhas do cashbook estão em `provisionado` — nenhuma foi liquidada.

**O cron não é idempotente.** Se rodar duas vezes no dia 1, duplica tudo. A Edge
Function morta *tinha* essa guarda; a função viva não tem.

**`reference_type` não é padronizado no razão:** coexistem `supplier` (23 linhas),
`SUPPLIER` (19) e `payout_supplier` (4). Qualquer agregação por tipo está errada.

**Trabalho começado e abandonado no trigger do split.** `handle_invoice_paid_ledger()`
declara `v_valor_b2w_manutencao` e `v_valor_b2w_arrendamento`, lê os dois de
`usinas.service_values`, e nunca os usa. São variáveis mortas — evidência de que a mesma
parcela quase passou a ser cobrada em dois lugares.

### 1.2 Incidente já contido (fora do escopo desta spec)

`PlantClosingModal.handlePayout` disparava um PIX real via `transfer-asaas-pix` e, em
seguida, tentava registrar a liquidação em quatro escritas que falhavam todas em
silêncio (`plant_closings` inexistente, `status: 'liquidado'` e filtro `'paga'`
inexistentes no enum `fatura_status`, `invoices.ano_referencia` inexistente, e nenhuma
delas checando o retorno `{ error }` do supabase-js). A tela exibia
*"Pagamento realizado e despesas liquidadas!"* em verde, sempre.

A trava contra pagamento duplicado nunca engatava: ela lia `formData.status` de
`plant_closings`, que retornava sempre vazio.

Verificado que **nunca disparou em produção**: zero linhas em `cashbook` com
`origin_type = 'plant_closing'`, zero `invoices` em `'liquidado'`, e as 4 linhas de
`financial_transfers` são todas `destination_type = 'supplier'` (este fluxo gravaria
`'usina'`).

**Desarmado em 08/08/2026** — o botão não é mais renderizado e `handlePayout` retorna
cedo com mensagem explicativa. O código original foi mantido inalcançável, com
comentário registrando o motivo.

---

## 2. Decisões tomadas

| # | Decisão | Quem decidiu |
|---|---|---|
| 1 | Fundir as duas telas de fechamento numa só | dono do produto |
| 2 | Base visual e estrutural: `PlantClosingModal` | dono do produto, com a condição explícita de **não impactar a gestão de pagamentos e recebíveis** |
| 3 | O cron passa a criar o **rascunho** do mês em vez de lançar direto no razão | dono do produto |
| 4 | `custo_disponibilidade` **entra** em `total_despesas` — é descontado do fornecedor | dono do produto |
| 5 | Descontar a disponibilidade implica **pagar a concessionária** e marcar a conta da UG como paga — os três são o mesmo ato | dono do produto |
| 6 | Correção de disponibilidade vale **só daqui pra frente**; histórico não é recalculado | dono do produto |
| 7 | Lançamento de serviços: itens fixos do contrato pré-preenchidos **+ linhas livres** para eventuais | dono do produto |

### 2.1 Registro de divergência técnica

A decisão 2 foi mantida após eu apresentar evidência contrária. A comparação campo a
campo mostra que `BillingModal` é estruturalmente mais correto: seus nomes batem 1:1 com
`generation_production`, seu status inicial (`em_producao`) é válido no enum, e seu mês
está no formato da coluna. O `PlantClosingModal` usa `status: 'rascunho'` — valor
inexistente no enum `production_status` — e quebra o mês em `ref_month` + `ref_year` como
texto, que é a origem direta do filtro quebrado `.ilike('mes_referencia', '%08%')`.

O dono do produto reafirmou a escolha condicionando-a a não haver impacto em pagamentos
e recebíveis. **Essa condição é o critério de aceite da seção 8** e o risco concreto está
inteiro no mapa de renomeação (seção 5.2).

---

## 3. Arquitetura: uma tabela por camada

```
usinas.service_values      CONTRATO     quanto custa por mês. Só muda com o contrato.
generation_production      FECHAMENTO   um registro por (usina, mês). Editável enquanto aberto.
ledger_entries             RAZÃO        partida dobrada. Imutável. Só recebe mês fechado.
cashbook                   VIEW         deixa de ser tabela; passa a ler o razão por usina.
```

A raiz de todos os problemas da seção 1 é a ausência dessa separação: hoje contrato,
fechamento e razão se misturam, e cada implementação escreve onde quer.

### 3.1 Mudanças de schema

| # | Mudança | Motivo |
|---|---|---|
| 1 | `UNIQUE (usina_id, mes_referencia)` em `generation_production` | elimina as duplicatas e dá idempotência de graça ao cron |
| 2 | Nova coluna `despesas_eventuais` (jsonb) | não há hoje onde lançar despesa eventual; `service_details` é espelho do contrato, não do mês |
| 3 | `cashbook` vira view sobre `ledger_entries` | elimina o segundo livro e a divergência entre valor cheio e rateado |
| 4 | `usinas.gestao_percentual` → `NOT NULL DEFAULT 15` + backfill dos zeros | o `COALESCE(x, 15)` nunca dispara porque o campo é `0`, não `NULL` |
| 5 | Padronizar `ledger_entries.reference_type` (`SUPPLIER` → `supplier`) | agregação por tipo está quebrada |
| 6 | Descartar a migration `20260130_create_plant_closings.sql` | se aplicada, restaura a segunda tabela de fechamento |

**Não faz parte desta spec:** criar tabela nova de fechamento, alterar `invoices`, ou
mexer no cálculo do split em `handle_invoice_paid_ledger()`.

---

## 4. Fluxo do mês

O enum `production_status` já tem os três estados corretos: `em_producao`, `fechado`,
`liquidado`. O que falta é amarrar o que acontece em cada transição.

```
   dia 1, pg_cron
        │  cria o RASCUNHO do mês (em_producao), pré-preenchido:
        │    · manutenção, arrendamento, serviços  ← usinas.service_values
        │    · custo_disponibilidade               ← conta da UG do mês (NÃO digitado)
        ▼
   EM_PRODUCAO ──── operador ajusta: eventuais, manutenção extra, correções
        │
        │  FECHAR — uma transação, tudo ou nada:
        │    1. grava as partidas em ledger_entries (débito fornecedor / crédito receita)
        │    2. paga o boleto da concessionária          → pay-asaas-bill
        │    3. marca a conta da UG energy_bill_status = 'pago'
        ▼
     FECHADO ──── conferido, imutável, saldo_receber calculado
        │
        │  LIQUIDAR — uma transação:
        │    4. PIX ao fornecedor                        → transfer-asaas-pix
        │    5. baixa do passivo 2.1.1 no razão
        ▼
    LIQUIDADO
```

### 4.1 O custo de disponibilidade deixa de ser digitado

É a conta de energia real da UG. Origem canônica:

```
consumer_units WHERE tipo_unidade = 'geradora' AND usina_id = <usina>
   → invoices WHERE uc_id = <UC da UG> AND mes_referencia = <mês do fechamento>
      → valor_concessionaria
```

Errar o mês passa a ser impossível. O campo é read-only na tela, com link para a conta
de origem.

### 4.2 Casos que o fluxo precisa bloquear, não ignorar

Os dados atuais já contêm os três:

| Situação | Exemplo real | Comportamento |
|---|---|---|
| UG sem nenhuma conta | UFV NILTON COSTA | **bloqueia o fechamento** com "conta da UG ausente". Não assume zero |
| Conta sem `linha_digitavel` | UFV Bom Jesus 07/2026, São José do Seridó 07/2026 | avisa, permite fechar registrando pagamento manual da concessionária |
| Status contraditório | linhas com `status='cancelado'` e `energy_bill_status='pago'`; um `'atrasada'` onde o resto usa `'atrasado'` | saneamento antes da migração (seção 7) |

O comportamento atual — assumir zero silenciosamente — é exatamente o que produziu os
R$ 238,05 não cobrados.

---

## 5. A tela unificada

### 5.1 Composição

```
BASE:  PlantClosingModal    (layout e organização visual — decisão 2)
  +    renomeação completa dos campos para casar com generation_production
  +    taxa_gestao_percentual                        (único ganho real da tela atual)
  +    NOVO: itens de serviço do contrato, editáveis → service_details
  +    NOVO: linhas livres de despesa eventual       → despesas_eventuais
  +    custo_disponibilidade READ-ONLY, com link para a conta da UG
  +    seção fechar/liquidar reconstruída sobre RPC transacional
```

**Nenhuma das duas telas atuais faz o que o operador descreve.** Ambas têm um único campo
`servicos` (um total). O detalhe por item existe em `generation_production.service_details`
— `{"Água":76, "Energia":110.2, "Internet":79.9, "Segurança":0}` — e **nenhuma tela permite
editá-lo**. Despesa eventual não tem onde ir. A tela resultante faz mais do que qualquer
uma das duas faz hoje.

### 5.2 Mapa de renomeação

Aqui está concentrado o risco da condição da decisão 2.

| `PlantClosingModal` hoje | Passa a ser | Nota |
|---|---|---|
| `ref_month` + `ref_year` (texto) | `mes_referencia` (date) | origem do `.ilike('%08%')` quebrado |
| `closing_date` | `fechamento` | |
| `status: 'rascunho'` | `em_producao` | `'rascunho'` não existe no enum |
| `energia_gerada` | `geracao_mensal_kwh` | |
| `energia_compensada` | `energia_compensada` | sem mudança |
| `faturamento_mensal` | `faturamento_mensal` | sem mudança |
| `faturas_pagas_base` | `faturas_pagas` | |
| `custo_disponibilidade` | `custo_disponibilidade` | passa a read-only, derivado |
| `manutencao` | `manutencao` | sem mudança |
| `arrendamento` | `arrendamento` | sem mudança |
| `servicos_total` | `servicos` | |
| `taxa_gestao_percentual` | **mantido** | ganho real: percentual por mês |
| `taxa_gestao_valor` | `gestao_reais` | |
| `total_despesas` | `total_despesas` | fórmula fixada (seção 5.3) |
| `saldo_liquido` | `saldo_receber` | |
| — | `service_details` (jsonb) | novo na tela |
| — | `despesas_eventuais` (jsonb) | novo na tela e no schema |

### 5.3 Fórmulas fixadas

```
servicos        = soma(service_details) + soma(despesas_eventuais)
total_despesas  = custo_disponibilidade + manutencao + arrendamento + servicos
saldo_receber   = faturamento_mensal - total_despesas - gestao_reais
```

A inclusão de `custo_disponibilidade` em `total_despesas` segue a decisão 4 e a fórmula
de Fev/Mar. Abril diverge e permanece como está (decisão 6).

**`gestao_reais` — base de cálculo pendente de confirmação.** Não há fórmula
estabelecida no fechamento: `gestao_reais` é `0` em 11 de 11 registros, então os dados
não revelam a regra. O único precedente no sistema é o trigger do split, que trabalha
por fatura:

```sql
-- handle_invoice_paid_ledger()
v_base_calculo   := v_valor_total - v_valor_concessionaria;
v_valor_b2w_gestao := (v_base_calculo * (COALESCE(v_gestao_percentual,15)/100))
                      - v_comissao_recorrente;
```

Aplicado ao mês, isso daria
`gestao_reais = (faturamento_mensal - custo_disponibilidade) * taxa_gestao_percentual / 100`.
Duas perguntas ficam abertas e **devem ser respondidas antes da implementação**:

1. A base é o faturamento líquido da concessionária, como no trigger, ou o faturamento
   bruto?
2. A comissão recorrente do originador deve ser subtraída da gestão no fechamento, como
   o trigger faz por fatura? Se sim, há risco de dupla contagem entre o fechamento e o
   split — os dois debitam a mesma conta `2.1.1`.

Enquanto não confirmado, a implementação deve tratar a fórmula como parâmetro explícito
de uma única função, não replicá-la em dois lugares.

---

## 6. Erros e transação

### 6.1 A regra desce para o banco

`Fechar` e `Liquidar` viram RPCs `SECURITY DEFINER`, não sequências de chamadas no
navegador:

```
fechar_producao(p_id uuid)
liquidar_producao(p_id uuid)
```

Cada uma numa transação. Se qualquer passo falhar, nada acontece — **inclusive o PIX**.
É o inverso do que a tela morta fazia, e é a única forma de garantir a condição da
decisão 2: o impacto em recebíveis vem de meia operação ter sido aplicada.

Efeito colateral desejável: com a regra na RPC, o React e um futuro cliente MCP chamam o
mesmo contrato, e é o contrato que valida — não o cliente.

### 6.2 O padrão que escondeu tudo

`supabase-js` **não lança** em erro de banco: devolve `{ data, error }`. Envolver
`await supabase.from(...)` em `try/catch` sem checar `error` engole a falha por
construção, e o `catch` nunca dispara.

Foi assim que quatro escritas falharam em silêncio depois de um PIX real. O mesmo padrão
aparece em `ProtocolModal.jsx:658`, `SubscriberModal.jsx:409,436`,
`BatchInvoiceProcessor.jsx:570`, `StandaloneAccountModal.jsx:321` e
`PlantClosingsHistoryModal.jsx:30`.

**Regra da tela nova:** toda chamada desestrutura e checa `error`. Sem exceção.

---

## 7. Migração

Mínima, porque a decisão 6 dispensa recálculo retroativo.

1. **Sanear `generation_production`:** consolidar as 4 linhas de 06/2026 e as 2 de
   05/2026 (todas zeradas — manter a mais antiga, descartar as demais), depois aplicar
   `UNIQUE (usina_id, mes_referencia)`.
2. **Adicionar** `despesas_eventuais` (jsonb, default `{}`).
3. **`usinas.gestao_percentual`:** backfill dos `0` para `15`, depois
   `NOT NULL DEFAULT 15`.
4. **Padronizar** `ledger_entries.reference_type`: `SUPPLIER` → `supplier`.
5. **Sanear** `invoices.energy_bill_status`: `'atrasada'` → `'atrasado'`; revisar as
   linhas com `status = 'cancelado'` e `energy_bill_status = 'pago'`.
6. **`cashbook` → view.** Preservar as 10 linhas atuais numa tabela
   `cashbook_legado` antes de trocar.
7. **Aposentar** a Edge Function `cron-monthly-expenses` (morta) e a migration
   `20260130_create_plant_closings.sql` (nunca aplicada).
8. **Reescrever** `run_monthly_fixed_expenses()` para criar rascunho em
   `generation_production` em vez de lançar no razão.

**Sem** recálculo de `custo_disponibilidade` histórico.

---

## 8. Critério de aceite

O teste não é "compila".

**Teste principal — reprodução do mês liquidado.** Reproduzir 04/2026 da UFV Bom Jesus,
já em `liquidado`, pela tela nova em ambiente isolado. `total_despesas`, `saldo_receber`
e as partidas geradas no razão devem sair **idênticos** aos atuais. Divergência de um
centavo reprova a fusão.

**Testes complementares:**

| # | Verificação |
|---|---|
| 1 | Nenhum registro novo em `financial_transfers` durante os testes |
| 2 | Toda transação do razão fecha em zero |
| 3 | Fechar uma usina sem conta de UG é **bloqueado**, não assume zero |
| 4 | Rodar o cron duas vezes no mesmo mês não duplica (constraint) |
| 5 | Falha simulada no pagamento do boleto reverte o fechamento inteiro |
| 6 | Falha simulada no PIX reverte a liquidação inteira |
| 7 | `custo_disponibilidade` do rascunho bate com `valor_concessionaria` da conta da UG do mesmo mês |

---

## 9. Fora de escopo

- Recálculo retroativo de disponibilidade (decisão 6)
- O split de 5 vias em `handle_invoice_paid_ledger()` — frente própria
- A tabela `commissions`, inalcançável porque `generate_monthly_commissions` insere
  colunas inexistentes (`amount`, `percentage_applied`, `type`) e o valor `'pending'`,
  ausente do enum `comissao_status` — frente própria
- Unificação dos dois workspaces (Aura 2) — frente própria
- Multi-tenant e MCP — frentes próprias
- As 21 tabelas com RLS `USING(true)` para autenticados — frente de segurança

---

## 10. Riscos e incertezas

| # | Risco | Mitigação |
|---|---|---|
| 1 | A renomeação de 8 campos introduzir erro em valores financeiros | Teste principal da seção 8 — reprodução exata de um mês liquidado |
| 2 | `cashbook` virar view quebrar algum consumidor não mapeado | `cashbook_legado` preservado; levantar consumidores antes |
| 3 | Backfill de `gestao_percentual` para 15 cobrar do fornecedor algo não combinado | Confirmar o percentual de cada usina com o contrato antes de aplicar |
| 4 | Faturas de `geracao_compartilhada` nunca terem pagamento automático de concessionária | Herdado do `asaas-webhook:203-215`, que exige `auto_consumo_remoto`. Precisa ser tratado no `fechar_producao` |
| 5 | O trigger `handle_invoice_paid()` continuar gravando valor cheio enquanto o cashbook vira view | Aposentar o trigger junto com a troca |

**Incertezas registradas:**

- Origem das 19 linhas com `reference_type = 'SUPPLIER'` maiúsculo (−R$ 11.680,55,
  jun–jul/2026). Não localizada em nenhuma função SQL nem Edge Function. Possível script
  ad-hoc.
- Se o percentual de gestão correto é 15% para todas as usinas ou varia por contrato.
  Apenas `UFV Bom Jesus` tem valor não-zero (`10`).
- Se `handle_invoice_paid()` (cashbook, valor cheio) e `handle_invoice_paid_ledger()`
  (razão, rateado) coexistirem é desenho ou legado. Não há reconciliação entre as duas
  visões.
