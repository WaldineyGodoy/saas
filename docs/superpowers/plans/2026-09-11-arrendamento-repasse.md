# Repasse de arrendamento — do reconhecimento ao pagamento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o arrendamento deixar de ser receita da B2W e virar o que é: dinheiro de terceiro que entra, fica registrado como obrigação e sai para o dono da terra pelo trilho que ele escolheu, com o razão fechando nos dois lados.

**Arquitetura:** o valor cobrado do fornecedor não muda e o repasse ao investidor não é tocado. O que muda é o destino do crédito, que passa a se ratear entre beneficiários. Cada beneficiário carrega seu próprio trilho de pagamento — PIX ou boleto — e uma mesma área pode misturar os dois. O passivo `2.1.5` é a obrigação; `arrendamento_pagamentos` é seu razão auxiliar, uma linha por beneficiário por competência. Usina em obra troca a origem do débito, nunca o caminho da saída.

**Tech Stack:** PostgreSQL 15 (Supabase `abbysvxnnhwvvzhftoms`), plpgsql, `pg_cron` 1.6.4, Deno/TypeScript nas Edge Functions, Asaas como PSP, React/Vite no CRM.

**Origem:** spec [`2026-09-11-arrendamento-repasse-arrendantes.md`](../specs/2026-09-11-arrendamento-repasse-arrendantes.md).

---

## Escopo

**Este plano entrega** o desenho completo de uma vez, por decisão do dono do produto em 11/09/2026: plano de contas, beneficiários com rateio, pagamentos por competência, reconhecimento nos dois regimes (operação e pré-operação), os dois trilhos de pagamento, as telas e o acerto dos R$ 2.400 de Bom Jesus I e II.

**Este plano NÃO entrega** o saneamento do desbalanço de R$ 10.694,81 do razão (spec §8). É problema anterior e independente, com decisão própria.

**Atenção de branch.** A Task 6 altera `fechar_producao`, cujas migrações **não estão na `main`**: vivem só no worktree de `impl/fechamento-mensal`, 20+ commits à frente e sem merge. Ela é a única task que roda lá. Escrever essa alteração na `main` produz uma migração que o merge sobrescreve.

---

## Global Constraints

Valem para toda task. Não se repetem em cada uma.

1. **Dado faltante propaga `NULL`, nunca vira zero.** Regra da casa. Nenhuma função nova contém `COALESCE(x, 0)` sobre insumo de cálculo. Rateio sem beneficiário cadastrado é ausência de dado, não repasse de zero.
2. **Nunca inserir em `ledger_entries` à mão.** Todo lançamento nasce de função ou gatilho. Os R$ 1.200 mal classificados são o exemplo do que o caminho manual produz.
3. **O passivo existe antes do pagamento.** Nenhum trilho de saída pode ser acionado para competência não reconhecida. `2.1.5` negativo é defeito, não estado.
4. **Todo lançamento leva `external_id`**, no padrão que `fechar_producao` já usa (`'arrendamento:' || <pagamento_id> || ':' || <etapa>`). Rodar duas vezes não duplica.
5. **Beneficiário `casa` nunca gera passivo nem entra em fila de pagamento.** Obrigação da B2W com ela mesma não se paga e não se extingue: fica para sempre.
6. **Dinheiro em duas casas.** No rateio, arredondar cada parcela e derivar a última por diferença, para as partes fecharem com o total em centavos.
7. **Trilhos são independentes.** A falha de um beneficiário nunca bloqueia, desfaz ou atrasa o pagamento de outro da mesma área ou competência.
8. **Toda função nova:** `SET search_path TO 'public'`, `REVOKE EXECUTE ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated, service_role`.
9. **Migrations via `apply_migration`; testes via `execute_sql`** no projeto `abbysvxnnhwvvzhftoms`. Teste que escreve roda em bloco `DO` e é desfeito.
10. **Nenhum registro novo em `financial_transfers` nem chamada real ao Asaas durante os testes.** Dinheiro de verdade só se move na Task 12, com confirmação explícita do dono.

---

## Task 1 — Plano de contas

**Objetivo:** criar as contas que faltam e corrigir o nome da que mente.

- [x] Criar `2.1.5 Arrendamento a Pagar` (liability), sob `2.1.0`.
- [x] Criar `4.2.0 Despesas Operacionais` (expense), sob `4.0.0`.
- [x] Criar `4.2.1 Arrendamento de Áreas (pré-operação)` (expense), sob `4.2.0`.
- [x] Renomear `3.1.4` de "Receita de Arrendamento B2W" para **"Receita de Intermediação de Arrendamento"**, porque passa a receber só a margem.
- [x] Registrar que o saldo de R$ 1.200 anterior a esta data é reclassificado na Task 12. *(Feito no cabeçalho da migração, não como `COMMENT`: o Postgres não tem comentário por linha, e pôr o aviso no nome da conta seria pior.)*

**Aceite:** as três contas existem, `3.1.4` mudou de nome, nenhum lançamento foi criado.

---

## Task 2 — `leased_area_beneficiaries`

**Objetivo:** tirar o arrendante da linha da área e dar a ele entidade própria, com trilho de pagamento.

- [x] Criar a tabela conforme spec §4.1, com `tipo` em (`terceiro`, `intermediario`, `casa`), `forma_pagamento` em (`pix`, `boleto`), `rateio_tipo` em (`percentual`, `fixo`).
- [x] `assina_contrato boolean not null default false`. Só `terceiro` nasce `true`.
- [x] RLS igual ao padrão de `leased_areas`: tudo para `authenticated`.
- [x] Constraint: `pix_key` e `pix_key_type` obrigatórios quando `forma_pagamento = 'pix'` **e** `tipo <> 'casa'`.
- [x] Migrar as três áreas existentes: o arrendante em linha vira a primeira linha, `tipo = 'terceiro'`, `assina_contrato = true`, rateio percentual 100.
- [x] Comentar `leased_areas.supplier_id`, `repasse_tipo` e `repasse_valor` como APOSENTADOS em 11/09/2026, no padrão usado em `suppliers.signature_link`. **Não dropar nesta task** — a tela ainda escreve neles até a Task 9.

**Aceite:** cada área tem exatamente um beneficiário `terceiro` a 100%; nenhuma linha de `casa` existe ainda; o `arrendante_nome` original continua íntegro para o contrato até a Task 11.

---

## Task 3 — `fn_ratear_arrendamento`

**Objetivo:** a aritmética do rateio num lugar só, com o resíduo de centavo endereçado.

- [x] Criar `fn_ratear_arrendamento(p_leased_area_id uuid, p_valor numeric)` devolvendo uma linha por beneficiário ativo com `beneficiary_id`, `tipo`, `valor`.
- [x] Ordem obrigatória: resolver os `fixo` primeiro; aplicar os `percentual` sobre o que sobrar; atribuir o resíduo ao beneficiário designado.
- [x] Designação do resíduo: o `terceiro` ativo mais antigo da área. Se não houver `terceiro`, a função levanta exceção — área sem dono da terra não rateia.
- [x] A soma das parcelas é igual a `p_valor` ao centavo. Assegurar isso na própria função, não no chamador.
- [x] Recusar com exceção: soma de percentuais acima de 100, soma de fixos acima de `p_valor`, área sem beneficiário ativo.
- [x] Teste em `supabase/tests/ratear_arrendamento.test.sql` cobrindo: um beneficiário a 100; dois a 50/50; um fixo mais um percentual; caso de resíduo (três a 1/3 de R$ 100); os três casos de recusa.

**Aceite:** o teste passa, e o caso do resíduo prova que R$ 100 divididos por três somam R$ 100,00 e não R$ 99,99.

---

## Task 4 — `arrendamento_pagamentos`

**Objetivo:** o razão auxiliar do passivo. É o que responde "o Marcos recebeu julho?".

- [x] Criar a tabela conforme spec §4.2, com `status` em (`a_pagar`, `aguardando_boleto`, `enfileirado`, `pago`, `falhou`) e `origem` em (`fornecedor`, `b2w_pre_operacao`).
- [x] Unique em (`beneficiary_id`, `usina_id`, `competencia`). É a chave natural e a trava contra reconhecimento duplicado.
- [x] `linha_digitavel` nulo quando `forma_pagamento = 'pix'`; `financial_transfer_id` nulo quando `boleto`.
- [x] Status inicial derivado: `boleto` nasce `aguardando_boleto`, `pix` nasce `a_pagar`.
- [x] RLS no padrão da casa.

**Aceite:** a tabela recusa duas linhas para o mesmo beneficiário na mesma competência da mesma usina.

---

## Task 5 — `fn_reconhecer_arrendamento`

**Objetivo:** transformar a competência em obrigação, escolhendo o regime pela situação da usina.

- [x] Criar `fn_reconhecer_arrendamento(p_usina_id uuid, p_competencia date, p_valor numeric, p_origem text)`.
- [x] Resolver a área por `usinas.leased_area_id`. Sem área vinculada, levanta exceção — cobrar arrendamento de dono desconhecido é o defeito que originou esta spec.
- [x] Chamar `fn_ratear_arrendamento` e gerar, por beneficiário, uma linha em `arrendamento_pagamentos` e o par de lançamentos.
- [x] Regime `fornecedor` (spec §3.1): crédito dos `terceiro` e `intermediario` em `2.1.5`; crédito da `casa` em `3.1.4`. O débito em `2.1.1` **não é responsabilidade desta função** — quem debita o fornecedor é `fechar_producao` (Task 6).
- [x] Regime `b2w_pre_operacao` (spec §3.2): débito em `4.2.1`, crédito em `2.1.5`, **somente as parcelas de `terceiro` e `intermediario`**. A linha da `casa` não produz lançamento: não há margem sendo ganha quando ninguém é cobrado.
- [x] `external_id` em todos os lançamentos. Chamar duas vezes é no-op.
- [x] Teste em `supabase/tests/reconhecer_arrendamento.test.sql`: regime fornecedor com margem; regime fornecedor sem margem; pré-operação (assere que `2.1.1` não foi tocada e que a `casa` não gerou linha); idempotência; usina sem área vinculada.

**Aceite:** o teste passa e cada transação gerada soma zero.

---

## Task 6 — Split do crédito em `fechar_producao`

> **Roda na branch `impl/fechamento-mensal`, não na `main`.**

**Objetivo:** o fechamento para de mandar o arrendamento inteiro para receita.

- [x] Substituir o crédito único em `3.1.4` por uma chamada a `fn_reconhecer_arrendamento` com `p_origem = 'fornecedor'`.
- [x] O débito em `2.1.1` continua com o valor cheio e inalterado. Conferir explicitamente no teste que o repasse ao investidor não mudou de valor.
- [x] Manter o `external_id` no padrão já existente (`'fechamento:' || p_id || ':arrendamento'`).
- [x] Atualizar `supabase/tests/fechar_producao.test.sql` com um caso de usina com área e beneficiário, e outro sem área (que deve bloquear o fechamento, não fechar com zero).

**Aceite:** fechar um mês com arrendamento credita `2.1.5` e não `3.1.4`, e o valor debitado do fornecedor é idêntico ao de antes da mudança.

---

## Task 7 — Trilho de saída

**Objetivo:** o PIX ao arrendante para de cair em conta sintética, e o lançamento nasce de gatilho.

- [x] Em `handle_transfer_ledger()`, acrescentar `destination_type = 'arrendante'` → conta `2.1.5`. Não mexer nas rotas existentes.
- [x] Conferir que o `ELSE` que hoje manda para `2.1.0` deixa de ser alcançável por arrendamento, e registrar em comentário que `2.1.0` é conta-título e receber lançamento ali é defeito.
- [x] Criar gatilho em `arrendamento_pagamentos` que, na transição para `pago`, lança o débito em `2.1.5` e o crédito em `1.1.1.01` — mesmo par para os dois trilhos (spec §3.3).
- [x] Evitar lançamento em dobro no caminho PIX: ou o gatilho de `financial_transfers` lança, ou o de `arrendamento_pagamentos` lança. **Escolher o de `arrendamento_pagamentos`** e fazer o caminho PIX marcar o pagamento como `pago` sem duplicar. Documentar a escolha no cabeçalho da migração.
- [x] Transição para `falhou` a partir de `pago` estorna, no padrão que `handle_transfer_ledger` já usa.
- [x] Teste cobrindo: pagamento por PIX; pagamento por boleto; estorno; e a asserção de que nenhum lançamento foi para `2.1.0`.

**Aceite:** o teste passa e `2.1.5` zera ao pagar todos os beneficiários de uma competência.

---

## Task 8 — Boleto com trava de valor

**Objetivo:** reaproveitar o motor que já existe e não pagar o boleto errado.

- [x] Criar `fn_validar_linha_digitavel(p_linha text, p_valor numeric, p_vencimento date)`: extrai valor e fator de vencimento da linha digitável de boleto bancário e compara com o esperado.
- [x] Tratar os dois formatos e recusar explicitamente o que não souber ler, em vez de aceitar por omissão.
- [x] Divergência de valor recusa. Divergência de vencimento avisa mas não bloqueia — imobiliária reemite boleto com vencimento novo e o valor é o que importa.
- [x] Ligar a validação **antes** de chamar `pay-asaas-bill`, de modo que linha inválida nunca chegue ao Asaas.
- [x] Ao contrário do fluxo da concessionária (`InvoiceSummaryModal.jsx:395`), **não lançar no razão pela tela**: o lançamento é do gatilho da Task 7. Registrar isso em comentário na função que dispara o pagamento.
- [x] Teste com linhas digitáveis sintéticas: valor certo, valor divergente, formato ilegível.

**Aceite:** boleto com valor divergente é recusado antes da chamada externa, e o teste prova que nenhuma requisição ao Asaas foi montada nesse caso.

---

## Task 9 — Tela da área arrendada

**Objetivo:** cadastrar beneficiário e forma de pagamento, que hoje não têm onde ir.

- [x] Em `src/pages/settings/LeasedAreasSettings.jsx`, substituir os campos de arrendante único por uma lista de beneficiários.
- [x] Por beneficiário: nome, documento, tipo, se assina o contrato, rateio (tipo e valor), forma de pagamento e, quando PIX, chave e tipo de chave.
- [x] Remover o seletor "Fornecedor vinculado": ele é derivado de `usinas.leased_area_id` (spec §1.3).
- [x] Remover os campos `repasse_tipo`/`repasse_valor` do nível da área: quem rateia agora é o beneficiário.
- [x] Mostrar a soma do rateio em tempo real e impedir salvar fora de 100%.
- [x] Deixar explícito na tela que a forma de pagamento é por beneficiário: a mesma área pode ter um em PIX e outro em boleto.
- [x] Não há campo de linha digitável aqui. Boleto é do mês e mora na fila da Task 10.

**Aceite:** cadastrar dois beneficiários com trilhos diferentes na mesma área e salvar sem erro.

---

## Task 10 — Fila de pagamentos

**Objetivo:** ver e pagar o que se deve, por beneficiário e competência.

- [x] Tela nova listando `arrendamento_pagamentos` por competência, com usina, área, beneficiário, valor, vencimento, trilho e situação.
- [x] Pagamento por beneficiário, nunca por área: pagamento parcial é estado legítimo (spec §4.1).
- [x] Para `aguardando_boleto`, campo para colar a linha digitável, com a validação da Task 8 no submit.
- [x] Para `pix`, botão de pagar que usa a chave do cadastro.
- [x] Nunca oferecer pagamento para beneficiário `casa`.
- [x] Exibir o saldo de `2.1.5` por competência e destacar em vermelho se ficar negativo, que é defeito e não estado.

**Aceite:** a fila mostra os quatro pagamentos de Bom Jesus I e II e permite pagar cada um pelo seu trilho.

---

## Task 11 — Gerador de contrato

**Objetivo:** o contrato passa a conhecer mais de um arrendante e ignora quem não arrenda.

- [x] Em `src/lib/contratosUsina.js`, trocar as quatro leituras diretas de `arrendante_nome`/`arrendante_doc` por iteração sobre os beneficiários com `assina_contrato = true`.
- [x] Cláusula de qualificação e bloco de assinatura passam a repetir por arrendante.
- [x] Beneficiário `casa` e `intermediario` **nunca** aparecem: a B2W é arrendatária, e a imobiliária recebe sem arrendar (spec §2.2).
- [x] Conferir que um contrato de área com um único dono sai idêntico ao de hoje.

**Aceite:** contrato de área com dois donos traz os dois na qualificação e duas linhas de assinatura; contrato de área com um dono e uma imobiliária traz só o dono.

---

## Task 12 — Acerto dos R$ 2.400

> **Move dinheiro real. Só executar com confirmação explícita do dono do produto, item por item.**

**Objetivo:** pagar José Santiago e Marcos Santiago deixando o razão fechado.

- [ ] Corrigir o cadastro primeiro: rateio percentual 100 nas duas áreas; "Marcos Santigo" → "Marcos Santiago"; `mes_inicio` da Vista Bom Jesus II; chave PIX ou boleto de cada um.
- [ ] Lançar a Transação A (spec §6.2): estorno de Junho/2026, reconhecimento de Agosto/2026, reclassificação dos R$ 1.200 de `3.1.4` para `2.1.5`. Conferir que o efeito líquido em `2.1.1` é zero.
- [ ] Lançar a Transação B (spec §6.2): R$ 1.200 em `4.2.1` contra `2.1.5`, competências Julho e Agosto. Conferir que `2.1.1` não foi tocada.
- [ ] Conferir antes de pagar: `2.1.5` com saldo de exatamente R$ 2.400 e `3.1.4` zerada.
- [ ] Pagar os dois beneficiários pela fila da Task 10.
- [ ] Conferir depois: `2.1.5` zerada, Banco Asaas em R$ 17.935,33, e o saldo da conta no Asaas batendo com o razão.
- [ ] Preencher `service_values` da Bom Jesus II para a cobrança do Tobias começar em setembro/2026.

**Aceite:** os dois arrendantes receberam, `2.1.5` está zerada, e o desbalanço total do razão não piorou em relação aos R$ 10.694,81 de partida.

---

## Ordem e paralelismo

Tasks 1 a 5 são sequenciais: cada uma depende do schema da anterior.

Tasks 6, 7 e 8 podem correr em paralelo depois da 5. A 6 está em outra branch e não colide com as demais.

Tasks 9, 10 e 11 dependem da 2 e são independentes entre si.

Task 12 é a última e depende de todas.
