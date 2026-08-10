# Contexto: usinas, fornecedor e pagamentos

**Data:** 10/08/2026
**Para:** um agente sem contexto nenhum deste projeto.
**Tudo aqui foi medido contra o banco vivo nesta data.** Onde houver número, ele veio de consulta, não de memória. Verifique antes de tratar como verdade — o banco é vivo.

---

## 1. O que é o produto

**CRM Aura**, da B2W Energia. Gerencia usinas solares de geração distribuída no Rio Grande do Norte e a relação financeira entre três partes:

- **Fornecedor** (`suppliers`) — o investidor, dono do capital da usina. Recebe repasse mensal. Também chamado de "investidor" no plano de contas.
- **B2W / CRM Aura** — a plataforma. Cobra taxa de gestão e opera tudo.
- **Assinante** (`subscribers`) — o consumidor final, que tem uma ou mais unidades consumidoras e paga uma fatura mensal com desconto sobre a tarifa da concessionária.

A usina gera energia, injeta na rede, e os créditos compensam a conta de luz dos assinantes. O assinante paga à B2W menos do que pagaria à concessionária; a diferença entre o que ele paga e o que a energia custa é repartida entre as três partes.

**Stack:** React + Vite (frontend, publicado em `crm.b2wenergia.com.br` via GitHub Pages), Supabase (Postgres + Edge Functions em Deno), Asaas como meio de pagamento (boletos, PIX, transferências).

**Projeto Supabase:** `abbysvxnnhwvvzhftoms`
**Repositório:** `C:\Users\Godoy\Documents\HTML\WorkSpace 1 Antigravity`

---

## 2. Como trabalhar neste projeto

**Não existe banco local.** Nenhum. Todo trabalho de banco é feito direto no projeto de produção, via MCP do Supabase:

- consultas e testes → `execute_sql`
- DDL e funções → `apply_migration` (com `name` sem a extensão `.sql`)

Isso tem três consequências que mordem quem não sabe:

1. **Cada chamada de `execute_sql` abre uma sessão nova.** Um arquivo que use `pg_temp` só funciona se enviado inteiro numa chamada só.
2. **`execute_sql` não devolve linhas de `RAISE NOTICE`.** Ausência de erro significa que os blocos `DO` passaram. Para ver diagnóstico, rode a consulta equivalente com `SELECT`.
3. **Os testes usam dados vivos de produção como fixture.** Um teste pode passar hoje e falhar amanhã sem ninguém tocar em código. Já aconteceu.

**Testes são arquivos SQL** em `supabase/tests/*.test.sql`, executados colando o conteúdo. Todo teste que escreve usa este padrão de sandbox, que desfaz tudo — inclusive requisições enfileiradas pelo `pg_net`:

```sql
DO $$
BEGIN
    -- escritas e asserções
    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
END $$;
```

**Convenções que valem em todo código novo de banco:**

- `SET search_path TO 'public'`, `REVOKE EXECUTE ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated, service_role` em toda função. Trocar assinatura cria função nova aos olhos do Postgres, e ela nasce com `anon=X` pelo `ALTER DEFAULT PRIVILEGES` do Supabase.
- **Dado faltante propaga `NULL`, nunca vira zero.** `COALESCE(x, 0)` sobre insumo de cálculo é proibido.
- **Dinheiro em duas casas, arredondado dentro da função.** Onde há repartição, arredondar cada parcela e derivar a última por diferença, para as partes fecharem com o total em centavos.
- **`supabase-js` não lança em erro de banco** — devolve `{ data, error }`. Envolver em `try/catch` sem checar `error` engole a falha por construção. Isso já causou um incidente: um PIX real saiu e quatro escritas falharam em silêncio, com a tela mostrando "Pagamento realizado" em verde.

---

## 3. As seis usinas, medidas hoje

| usina | status | modalidade | kWp | fornecedor | UGs | beneficiárias |
|---|---|---|---:|---|---:|---:|
| UFV Bom Jesus | gerando | auto_consumo_remoto | 100,80 | TOBIAS BERTUSSI | 1 | 14 |
| Novo Leblon | gerando | geracao_compartilhada | 8,75 | B2W PROJETOS & SOLUCOES SOLARES | 1 | 1 |
| UFV NILTON COSTA | em_conexao | gd2 | 23,40 | NILTON COSTA | 1 | 1 |
| UFV São José do Seridó | em_conexao | geracao_compartilhada | 34,16 | SOLLARECO ENERGIA | 1 | 0 |
| UFV Bom Jesus II | manutencao | gd2 | 102,24 | TOBIAS BERTUSSI | 0 | 0 |
| UFV - Potengi - SPP | manutencao | auto_consumo_remoto | 100,82 | TOBIAS BERTUSSI | 0 | 0 |

**Só a UFV Bom Jesus tem operação real.** As outras estão em conexão, manutenção, ou com uma beneficiária só. Qualquer teste ou validação que precise de dado significativo usa Bom Jesus.

**`TOBIAS BERTUSSI tem três usinas.`** Isso importa mais do que parece — ver a seção de pagamentos.

`gestao_percentual` é 10 em todas. `service_values` (o contrato de custos mensais) só está preenchido na Bom Jesus: `{"Água": 76, "Energia": 109.79, "Internet": 79.9, "Arrendamento": 600, "Manutenção": 0}`. As outras cinco têm `{}`.

---

## 4. O modelo de dados

```
suppliers (fornecedor/investidor)
    └── usinas
            └── consumer_units (UCs)          ← tipo_unidade: 'geradora' | 'beneficiaria'
                    └── invoices              ← UNIQUE (uc_id, mes_referencia)
subscribers (assinante)
    └── consumer_units                        ← via subscriber_id
```

**A UC geradora** é a própria usina do ponto de vista da concessionária. Ela tem conta de luz — o "custo de disponibilidade", que o fornecedor paga. É `tipo_unidade = 'geradora'`, uma por usina.

**As UCs beneficiárias** são as dos assinantes, que recebem os créditos. `tipo_unidade = 'beneficiaria'`.

**`invoices`** serve para as duas: para a beneficiária é a fatura que o assinante paga (`valor_a_pagar`, `status` do enum `fatura_status`); para a geradora é a conta de luz da usina (`valor_concessionaria`, `energy_bill_status` que é **texto livre**, não enum).

Colunas de `invoices` que importam no cálculo: `consumo_compensado` (kWh), `te_apurado`, `tusd_apurado`, `fio_b_apurado` (tarifas extraídas da conta), `valor_concessionaria`, `linha_digitavel`, `energy_bill_status`.

**`generation_production`** é o fechamento mensal: um registro por `(usina_id, mes_referencia)`, com `UNIQUE`. Enum `production_status`: `em_producao` → `fechado` → `liquidado`. Hoje tem 11 linhas.

**`ledger_entries` + `ledger_accounts`** são o razão em partidas dobradas. `cashbook` é uma **view** sobre o razão (deixou de ser tabela em 09/08/2026); as 10 linhas antigas estão em `cashbook_legado`.

**Plano de contas relevante:**

| código | nome | tipo |
|---|---|---|
| 1.1.1.01 | Banco Asaas | asset |
| 2.1.1 | Repasse para o Investidor | liability |
| 2.1.2 | Comissões a Pagar | liability |
| 2.1.3.01 | Repasse Concessionária | liability |
| 2.1.4 | Despesas Operacionais Usina | liability |
| 3.1.1 | Taxa de Gestão B2W | income |
| 3.1.3 | Receita de Manutenção B2W | income |
| 3.1.4 | Receita de Arrendamento B2W | income |
| 4.1.1 | Taxas Bancárias (Asaas) | expense |

**Convenção de sinal:** débito do passivo `2.1.1` é **positivo** (reduz o que se deve ao fornecedor); contrapartidas são **negativas**. Toda transação soma zero.

---

## 5. O modelo tarifário — a regra de negócio central

Validada contra produção em 08/08/2026. A repartição é **por kWh compensado**, não por valor de fatura.

```
Tarifa concessionária = TE + TUSD                          (da conta de energia)
Desconto assinante    = 20% da tarifa concessionária
Fio B                 = TUSD do consumo − TUSD compensado  (por conta)
                        ─────────────────────────────────
Tarifa Fornecedor     = tarifa − desconto − fio_b
```

Sobre a Tarifa Fornecedor incidem: **B2W 3%**, **Gestora 10%**, **Originador 5%** (comissão recorrente), e o **fornecedor fica com 82%**.

**Precedência, e isto é regra dura:** o que vale é o valor extraído da conta de energia. A tabela `Concessionaria` (5.241 linhas, por município e classe) é **régua de auditoria**, nunca fonte. Havia um trigger que escrevia a referência dentro do cadastro; foi desarmado em 08/08/2026 exatamente por contradizer isso.

**Funções que implementam o modelo** (todas em `supabase/migrations/20260808b_fn_tarifa_core.sql` e `20260809b_fn_fechamento_insumos.sql`):

| função | devolve | o que faz |
|---|---|---|
| `fn_fio_b_apurado(numeric, numeric)` | numeric | TUSD consumo − TUSD compensado |
| `fn_tarifa_fornecedor(te, tusd, desconto_pct, fio_b)` | numeric | a fórmula acima |
| `fn_split_tarifa(tarifa, kwh, pct_crm, pct_gestora, pct_originador)` | jsonb | reparte; recusa soma > 100 ou percentual negativo |
| `fn_auditar_tarifa(ibge, te, tusd, fio_b, tolerancia)` | jsonb | compara com a referência, não substitui |
| `fn_conta_ug(usina_id, mes)` | jsonb | acha a conta da UC geradora do mês; **nunca devolve zero**, devolve `ok=false` com motivo |
| `fn_faturamento_detalhado(usina_id, mes, desconto)` | jsonb | total + **quantas faturas descartou e por quê** |
| `fn_totais_fechamento(gp_id)` | jsonb | `servicos`, `total_despesas`, `gestao_reais`, `saldo_receber` |

**Divergência conhecida e não resolvida:** o razão reparte por valor de fatura (`handle_invoice_paid_ledger`), o fechamento reparte por kWh. Medido em 04/2026 da UFV Bom Jesus: **R$ 6.650,32 por kWh contra R$ 2.655,84 registrado por valor** — 2,5×. Reconciliar isso é a **frente do split**, e enquanto ela não acontecer `saldo_receber` e o saldo da conta `2.1.1` não vão bater.

---

## 6. O fluxo de pagamentos — o que existe hoje

### Entra dinheiro: o assinante paga a fatura

Trigger `tr_invoice_paid_ledger` → `handle_invoice_paid_ledger()`, quando `invoices.status` vira `pago`. Ele lança, **por fatura**: recebimento no banco, taxa do Asaas, provisão da conta de energia, comissão do originador, taxa de gestão B2W (`3.1.1`), e o crédito do investidor (`2.1.1`).

Base do cálculo dele: `valor_a_pagar − valor_concessionaria`. **Por valor, não por kWh** — é a origem da divergência da seção anterior.

### Sai dinheiro (1): a conta de luz da usina

Quem paga é a B2W, e desconta do fornecedor. Fluxo:

`fechar_producao(gp_id, p_pagamento_manual)` → valida tudo → lança as despesas no razão → marca a conta como `processing` → enfileira via `pg_net` um POST para a Edge Function **`pagar-conta-ug`** → ela chama o Asaas → chama de volta `confirmar_pagamento_ug(gp_id, ok, detalhe)`, que vira a conta para `pago` ou `erro`.

`pagar-conta-ug` é fechada por segredo compartilhado (`integrations_config.service_name = 'fechamento_hook'`, header `x-fechamento-token`), porque o `pg_net` não tem JWT de usuário para oferecer e `pay-asaas-bill` exige admin.

### Sai dinheiro (2): o repasse ao fornecedor

`liquidar_producao(gp_id)` → valida → marca `liquidado` e `repasse_status = 'enfileirado'` → enfileira POST para **`transfer-asaas-pix`**.

**Ela NÃO lança no razão.** Quem lança é o trigger `tr_transfer_ledger` em `financial_transfers`, quando a transferência chega a `completed`. Isso é deliberado: lançar nos dois lugares dobrava todo repasse. Foi medido — havia 8 lançamentos `payout_supplier` para 4 transferências.

### O cron

`pg_cron` job 1, dia 1 às 00:05: `SELECT public.run_monthly_fixed_expenses()`. Ela **cria o rascunho** do mês anterior em `generation_production` — não lança mais no razão, como fazia antes.

Ela preenche a partir de `usinas.service_values`, **excluindo `Manutenção`, `Arrendamento` e `Energia`** de `service_details`, porque as três têm destino próprio — e `Energia` é a mesma coisa que `custo_disponibilidade`, que vem da conta real da UG.

---

## 7. 🔴 O que impede usar isso hoje

Quatro coisas. Nenhuma é defeito de código novo; todas são pontas soltas.

**a) `repasse_status` nunca sai de `enfileirado`.** O `CHECK` aceita `pago` e `erro`, e nada no sistema escreve esses valores. **`enfileirado` não significa que o PIX saiu.** Até isso mudar, cada repasse precisa de conferência no extrato do Asaas.

A frente é menor do que parece: o `asaas-webhook` **já recebe e classifica** os eventos `TRANSFER_DONE`, `TRANSFER_FAILED`, `TRANSFER_REVERSED`, `TRANSFER_PENDING` e já atualiza `financial_transfers`. Faltam três peças, e só a primeira tem decisão de desenho:

1. **vincular transferência a fechamento** — hoje `financial_transfers` guarda só `destination_id = supplier_id`, e TOBIAS BERTUSSI tem três usinas. Precisa de referência explícita.
2. a RPC `confirmar_repasse(uuid, boolean, jsonb)`, espelho de `confirmar_pagamento_ug`, que já existe e tem as guardas certas para copiar.
3. poucas linhas no webhook.

**b) `transfer-asaas-pix` não tem autenticação.** `verify_jwt = false` e nenhuma verificação no código; aceita `pixKey` e `value` do corpo. A única barreira é uma trava antifraude de 2 minutos por destino — e quem chama escolhe o destino.

**c) Fechar é irreversível.** Não existe `reabrir_producao`. Se o Asaas recusar o boleto, o mês fica `fechado` + `erro`, e as três RPCs recusam mexer nele. Pior: `ledger_entries.external_id` é `UNIQUE`, então reexecutar depois de resetar o status à mão levanta `unique_violation` — teria que apagar partidas do razão antes. Boleto recusado é evento ordinário; isto vai acontecer.

**d) O primeiro repasse de cada usina precisa de conferência humana.** `saldo_receber` mudou de base e ninguém reconciliou o modelo novo contra o caixa efetivamente recebido. Não há teto nem checagem de sanidade.

---

## 8. Armadilhas conhecidas

- **O faturamento fechado é o do rascunho, mas a validação é ao vivo.** `fechar_producao` valida faturas descartadas em tempo real, mas o dinheiro sai de `faturamento_mensal`, congelado quando o cron rodou. Fatura paga entre o rascunho e o fechamento passa na validação e não entra no repasse. **Rode `run_monthly_fixed_expenses(DATE '<mês>')` imediatamente antes de fechar.**
- **A migration de backfill `20260810a` não é reexecutável** — sobrescreve edição do operador pelo contrato.
- **`generation_production` e `ledger_entries` têm policy `ALL USING(true)`** para `authenticated`. O razão não é imutável na prática. É por isso que as RPCs reconferem valores em vez de confiar nas colunas.
- **`cashbook.transaction_date` é data de gravação, não de competência.** Um lançamento de julho gravado em agosto cai em agosto.
- **`cashbook` só lista contas `1.1.1.*`** (o banco). Não lista contrapartidas — quem quer a partida inteira lê `ledger_entries` por `transaction_id`.
- **`consumer_units` não tem coluna `classe`**, só `tipo_ligacao` (mono/bi/trifásico). Sem ela não dá para escolher entre as variantes `_B2`, `_B3` e `_A` da tabela de referência. Bloqueia a auditoria tarifária completa.
- **Quatro pontos vivos no frontend escrevem contra `plant_closings`**, tabela que não existe e cuja recriação a migration `20260809g` agora aborta. Só `PlantClosingModal.jsx:106` é silencioso de verdade; os outros mostram erro.

---

## 9. Estado do repositório

**Nada foi mesclado em `main`.** Três branches:

| branch | o quê | onde |
|---|---|---|
| `main` | parado em `a424ada`, igual ao remoto | worktree principal |
| `spec/fechamento-contabil` | a spec e os planos | worktree principal (checkout atual) |
| `impl/nucleo-tarifario` | as 5 funções tarifárias | `.claude/worktrees/nucleo-tarifario` |
| `impl/fechamento-mensal` | todo o fechamento, 87 commits sobre `main` | `.claude/worktrees/fechamento-mensal` |

`impl/fechamento-mensal` empilha em cima de `impl/nucleo-tarifario` — mesclar leva as duas.

**O merge foi segurado por decisão do dono**, porque o Antigravity faz commits em paralelo no mesmo repositório e um `main` que salta 87 commits pode confundir aquela automação. `.github/workflows/deploy.yml` republica `crm.b2wenergia.com.br` a cada push em `main`.

**As mudanças de banco já estão em produção.** Foram aplicadas uma a uma durante a execução. Mesclar organiza o repositório; não muda o comportamento do banco.

**Documentos que valem ler antes de mexer:**

- `docs/superpowers/specs/2026-08-08-fechamento-contabil-design.md` — a spec, com as 11 decisões do dono
- `docs/superpowers/specs/2026-08-10-achados-do-fechamento-no-banco.md` — os achados desta execução, com mais detalhe que este documento
- `docs/superpowers/plans/2026-08-09-fechamento-mensal-no-banco.md` — o plano executado, com o SQL de tudo

---

## 10. Como esta base costuma falhar

Vinte e um defeitos graves foram encontrados durante a última execução, e dezoito estavam no **plano**, não no código escrito a partir dele. Três padrões se repetiram, e vale procurá-los antes de confiar em qualquer coisa:

**Validar uma fonte e usar outra.** Apareceu três vezes, sempre em código que move dinheiro. A Edge Function pagava o valor do corpo da requisição em vez do valor da conta; `liquidar_producao` mandava por PIX a coluna sem reconferir contra a fórmula; `fechar_producao` chamava `fn_conta_ug` para validar e lançava a coluna. As três foram corrigidas para reconferir — e a coluna estava zerada nas oito linhas herdadas, então o boleto teria saído com valor 0.

**Asserção que compara a implementação consigo mesma.** Quatro tasks voltaram por isso. O caso mais instrutivo: a view `cashbook` era assertada contra `sum(abs(amount))` do razão — igualdade verdadeira por construção, que passaria com a view completamente errada.

**Comentário afirmando causa não verificada.** Seis foram corrigidos. Comentário em migration é documentação permanente.

E uma quarta, de processo: **os quatro achados mais graves só apareceram quando alguém olhou o sistema inteiro contra os dados que já existiam.** Nenhum estava errado isoladamente. Revisar peça por peça não os teria encontrado.
