# Abatimento do crédito de indicação (Assinante Connect)

Branch `app-v1.3` · 05/10/2026 · Substitui o §5 de `docs/superpowers/specs/2026-09-22-indicacao-split-design.md` e a Task 7 de `docs/superpowers/plans/2026-09-27-split-de-pagamentos.md`.

## Decisões do dono (05/10/2026)

1. Quem indicou ganha também sobre as UCs que o indicado acrescentar depois, inclusive pelo app.
2. O crédito é da **pessoa**. Com várias UCs, o abatimento vai primeiro na fatura de **vencimento mais próximo**. Em empate de vencimento, vai primeiro na de **maior valor**.
3. Transbordo: zerada uma fatura, o restante segue para a próxima, na mesma ordem.
4. O que sobrar depois de todas as faturas do ciclo é **descartado**, não acumula.

## Estado real em produção (levantado em 05/10/2026)

- **O item 1 já funciona.** `fn_participantes_recompensa` procura o indicador primeiro em `subscribers.indicador_assinante_id` (a pessoa). `consumer_units.indicado_por_uc_id` é só o caminho alternativo. Uma UC nova do indicado, criada pelo app, já entra no split com o Assinante Connect.
- **O crédito já nasce.** Quando a fatura do indicado é paga, `handle_invoice_paid_ledger` lança o valor do Connect na conta **2.1.6 Créditos de Indicação a Assinantes**, com sinal negativo (passivo), `reference_type='subscriber'` e `reference_id` igual ao indicador. Hoje existem **0 lançamentos**, porque nenhum assinante ativo foi indicado e pagou.
- **O consumo não existe.** Não há tabela `creditos_indicacao`, nem abatimento na fatura, nem descarte. O saldo ficaria parado na 2.1.6.
- **Emissão:**
  - o `emissor` (pg_cron) lê `fn_fila_emissao_faturas`, que agrupa **por assinante e por ciclo** (`mes_referencia`) e só libera o ciclo com todas as UCs prontas;
  - em seguida chama `create-asaas-charge`, que soma `valor_a_pagar` das faturas e cria **uma** cobrança, consolidada ou não;
  - a emissão pela tela usa a mesma `create-asaas-charge`.
- **A conta a receber (1.1.2) fecha pelo caixa.** No pagamento: `conta_receber = gestão + beneficiários + fornecedor − caixa_líquido`. A base da recompensa é a energia compensada, não o caixa. Por isso o abatimento não muda o split, nem do indicador nem de ninguém.

## O ciclo

O ciclo do indicador é o conjunto de faturas que sai numa mesma emissão: assinante + `mes_referencia`, o mesmo agrupamento da fila. O abatimento acontece **no momento da emissão**, antes de criar a cobrança no Asaas. Nessa hora todas as faturas do ciclo já estão prontas, então a ordem por vencimento e por valor é aplicada de verdade, e não na ordem em que cada UC foi lida.

O saldo disponível é o que estava na 2.1.6 até aquele instante. Crédito que nasce depois da emissão fica para o próximo ciclo. Ele só é descartado se sobrar depois de abater o ciclo seguinte.

## Modelo

### Tabela `creditos_indicacao_uso` (o extrato)

Uma linha por movimento: `id`, `subscriber_id`, `invoice_id` (nulo no descarte), `ciclo`, `tipo` (`abatimento` | `descarte` | `estorno`), `valor`, `ordem` (posição da fatura na fila do ciclo), `criado_em`, `transaction_id`.

- RLS: o assinante lê as próprias linhas, papel interno lê tudo, ninguém escreve pelo cliente.
- Ela é a fonte do extrato da V1.1.

### Coluna `invoices.abatimento_indicacao numeric not null default 0`

- `valor_a_pagar` passa a ser o calculado menos o abatimento, nunca negativo.
- `fn_calcular_fatura` subtrai o abatimento ao recalcular. Sem isso, um recálculo depois de uma falha no Asaas apagaria o abatimento em silêncio.

### `fn_aplicar_credito_indicacao(p_subscriber uuid, p_invoice_ids uuid[]) returns jsonb`

Função SECURITY DEFINER, restrita a `service_role` e papel interno.

1. Trava o assinante com `pg_advisory_xact_lock`: duas emissões simultâneas não gastam o mesmo saldo.
2. É **idempotente**: se alguma fatura do conjunto já tem `abatimento_indicacao > 0`, devolve o que já foi aplicado e não mexe em nada.
3. Calcula o saldo como `−soma(2.1.6)` do assinante. Se for zero, retorna sem alterar nada.
4. Ordena as faturas por `vencimento asc, valor_a_pagar desc, id`, aplicando cada uma das regras de desempate na ordem.
5. Abate em cada fatura até zerá-la e passa o restante para a próxima (transbordo).
6. Grava o razão, numa transação por ciclo:
   - **Abatimento:** `+x` na 2.1.6 (baixa a obrigação com o indicador) e `−x` na 1.1.2 do indicador. Quando a fatura for paga, o caixa menor gera `+x` na 1.1.2, e as duas pernas se anulam.
   - **Descarte do que sobrou:** `+sobra` na 2.1.6 e `−sobra` na receita da B2W. A conta nova proposta é **3.1.5 Créditos de Indicação Não Utilizados**, para não misturar com a taxa de gestão.
7. Devolve `{saldo_inicial, aplicado, descartado, por_fatura:[...]}`.

### `create-asaas-charge`

- Antes de somar `totalValue`, chama a função com as faturas do ciclo e relê `valor_a_pagar`.
- Se **o ciclo inteiro zerar**: não cria a cobrança no Asaas. As faturas vão para `pago`, quitadas por crédito. O gatilho do razão roda normalmente, com caixa zero.
- O `emissor` confere a soma **antes** de chamar a `create-asaas-charge`, então a checagem dele não muda.

### Cancelamento

Se a cobrança for cancelada (`cancel-asaas-charge`) ou a fatura for para `cancelado`, o abatimento volta ao saldo:
- uma linha `estorno` na tabela;
- `−x` na 2.1.6 e `+x` na 1.1.2;
- `abatimento_indicacao` volta a 0.

O descarte daquele ciclo **não** é desfeito.

## Pontos a decidir antes de implementar

- **Mínimo do Asaas.** O boleto mínimo no Asaas é R$ 5,00. Se depois do abatimento o ciclo ficar entre R$ 0,01 e R$ 4,99, a proposta é reduzir o abatimento para o boleto sair com R$ 5,00. A diferença fica no saldo para o próximo ciclo, como exceção à regra de descarte, porque o cliente não deixou de usar o crédito.
- **Conta do descarte:** criar a 3.1.5, como proposto acima, ou lançar na 3.1.1 (Taxa de Gestão)?

## Testes

Blocos SQL em transação com rollback, no padrão `supabase/tests/*.test.sql`:

- crédito menor que a primeira fatura;
- crédito que zera a primeira e transborda para a segunda;
- empate de vencimento (a de maior valor primeiro);
- sobra descartada, com o lançamento na conta de receita;
- ciclo inteiro zerado, que vira `pago` sem cobrança;
- chamada repetida, que não abate duas vezes;
- duas emissões em paralelo, que não gastam o saldo duas vezes;
- cancelamento, que estorna e devolve ao saldo;
- assinante sem saldo, cuja fatura não muda;
- razão balanceado (soma zero por `transaction_id`) e 1.1.2 zerada depois do pagamento.

## Na tela (depois do motor)

- **CRM:**
  - na fatura, uma linha "Crédito de indicação −R$ x";
  - no modal do assinante, o saldo e os movimentos.
- **App:**
  - na fatura, a mesma linha;
  - na tela Home Connect, o saldo disponível.
  - O extrato completo fica para a V1.1, como já decidido.
