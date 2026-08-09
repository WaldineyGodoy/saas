# Achados do núcleo tarifário que condicionam o plano do fechamento

**Data:** 08/08/2026
**Origem:** execução do plano [`2026-08-08-nucleo-calculo-tarifario.md`](../plans/2026-08-08-nucleo-calculo-tarifario.md) e sua revisão final.
**Para:** quem escrever o plano seguinte — o fechamento mensal de usina.

Este documento existe porque o ledger da execução vive num diretório descartável. Os
itens abaixo foram deliberadamente **não corrigidos** naquele plano, com decisão
registrada, e cada um muda o que o plano do fechamento precisa fazer.

---

## 1. 🔴 Existe um trigger em produção que contradiz a decisão 10 da spec

**Confirmado em produção em 08/08/2026:**

```
Concessionaria → trg_sync_concessionaria_changes → sync_tariffs_to_entities   (tgenabled = 'O')
```

A função faz:

```sql
UPDATE public.consumer_units
   SET te = NEW."TE", tusd = NEW."TUSD",
       tarifa_concessionaria = NEW."Tarifa Concessionaria",
       desconto_assinante = CASE ... END
 WHERE upper(concessionaria)        = upper(NEW."Concessionaria")
   AND upper(address->>'cidade')    = upper(NEW."Município")
   AND upper(address->>'uf')        = upper(NEW."UF");
```

A spec §5.6 estabelece, em negrito, que **a tarifa cadastrada nunca substitui a conta**.
O banco faz o oposto: a referência escreve no cadastro.

### Consequências

**a) `fn_auditar_tarifa` compara a referência consigo mesma.** Para qualquer UC cujo
`te`/`tusd` veio do sync, a auditoria devolve `divergente: false` trivialmente. A régua
está aferida pelo próprio objeto que deveria medir.

**b) O faturamento histórico não é reproduzível.** `fn_faturamento_mensal_usina` é
`STABLE` e recalcula a partir de cadastro mutável, sem snapshot da tarifa usada. Uma
importação de `Concessionaria` amanhã muda o faturamento de meses já fechados — e o
critério de aceite da spec §8 ("divergência de um centavo reprova") deixa de ser
verificável de forma estável.

**c) As UCs com tarifa zerada não são descuido — são consequência determinística da
chave de junção.** Medido na UFV Bom Jesus:

| UC | cidade | uf | casa com a referência | te |
|---|---|---|---|---:|
| 7030004021 | *(vazio)* | *(vazio)* | ❌ | 0 |
| 7030004129 | *(vazio)* | *(vazio)* | ❌ | 0 |
| 7030839166 | São Gonçalo do Amarante | RN | ❌ | 0 |
| *(11 outras)* | Natal / Tibau do Sul / Parnamirim | RN | ✅ | 0,39033 |

Toda UC cujo endereço não bate por `município + UF` fica com tarifa zero para sempre, e
o faturamento dela desaparece do total. Preencher as duas à mão (item 3b da migração da
spec) corrige o sintoma **até a próxima importação de `Concessionaria`**.

**Decisão pendente do dono:** manter o sync e abandonar a decisão 10, ou desarmar o
trigger e alimentar a tarifa exclusivamente pela extração da conta. Não dá para ter os
dois.

---

## 2. A validação da Task 6 está reprovando, e é o dado que está errado

```
calculado    R$ 4.896,59
registrado   R$ 5.833,18
desvio       16,06%   (tolerância 2%)
```

Nove das onze UCs batem centavo a centavo. As duas zeradas explicam o desvio inteiro:
`4.896,59 + 999,44 = 5.896,03` vs `5.833,18` = **1,08%**, dentro da tolerância.

A tolerância **não foi relaxada** — relaxá-la seria calibrar o teste para aceitar o erro
que ele encontrou. Quando o item 3b da migração for aplicado, o teste passa a verde
sozinho. Registre isso, para o próximo executor não achar que alguém mexeu no teste.

---

## 3. A propagação de `NULL` não sobrevive à agregação

A Global Constraint do plano anterior estabelece que dado faltante propaga `NULL` e
nunca vira zero. As quatro funções de cálculo cumprem. **A agregação desfaz.**

**a) `SUM()` ignora `NULL` por definição.** Uma fatura paga cujo insumo tarifário falte
produz `fn_tarifa_fornecedor(...) = NULL`, e `NULL * consumo = NULL`. O `SUM` descarta a
linha. Efeito prático idêntico a um `COALESCE(x, 0)` por linha — exatamente o padrão
proibido. Em produção nada sinaliza; o diagnóstico existe só no arquivo de teste.

**b) `COALESCE(i.consumo_compensado, 0)`** dentro da própria `fn_faturamento_mensal_usina`
é o padrão proibido, literal. E o bloco de diagnóstico conta tarifa `NULL` e tarifa zero,
mas **não conta `consumo_compensado NULL`** — o caso não aparece nem onde seria visível.

**c) `COALESCE(SUM(...), 0)`** torna "nenhuma fatura no mês" indistinguível de "faturou
zero".

**d) `GREATEST(..., 0)`** em `fn_tarifa_fornecedor` reintroduz o zero silencioso por outra
porta: trava em zero quando o Fio B supera a tarifa líquida, indistinguível de uma tarifa
legitimamente zero.

**O que o plano do fechamento precisa fazer:** trocar o retorno `numeric` de
`fn_faturamento_mensal_usina` por algo que carregue a contagem de faturas descartadas, ou
falhar quando houver alguma. Somar em silêncio o que sobrou é o comportamento que a
Global Constraint existe para impedir.

---

## 4. O desconto por assinante existe no banco e é ignorado

`consumer_units.desconto_assinante` é preenchido (pelo trigger do item 1) e está em escala
percentual (`20`, não `0,20`). `fn_faturamento_mensal_usina` não o lê: aplica
`p_desconto_pct DEFAULT 20` achatado sobre todas as UCs da usina.

A validação de produção passou porque a UFV Bom Jesus é homogênea em 20%. **Ela não prova
nada sobre uma usina com descontos mistos.**

Inconsistência interna da função: três insumos (TE, TUSD, Fio B) usam precedência
conta → cadastro; o quarto usa constante. O correto seria
`COALESCE(i.desconto_assinante, cu.desconto_assinante, p_desconto_pct)`.

---

## 5. O fechamento do split não sobrevive ao arredondamento

Nenhuma das cinco funções arredonda. Para as três que devolvem R$/kWh, correto. Para
`fn_split_tarifa` e `fn_faturamento_mensal_usina`, que devolvem reais, a saída final ficou
órfã — e é aí que a garantia do residual morre:

```
total = 0,55 ;  pct 3 / 10 / 5
crm        0,0165 → 0,02
gestora    0,0550 → 0,06
originador 0,0275 → 0,03
fornecedor 0,4510 → 0,45
                    ──────
soma das partes     0,56   ≠  round(total) = 0,55
```

Um centavo criado do nada. O `COMMENT` da função promete que *"o fornecedor recebe o
residual, garantindo que as partes fechem com o total"* — verdade em precisão plena,
**falsa em centavos**, que é a unidade em que o dinheiro sai.

**Correção para o plano do split:** arredondar dentro da função —
`crm/gestora/originador = round(..., 2)` e `fornecedor = round(total, 2)` menos as três
arredondadas.

---

## 6. Percentuais somando mais de 100 deixam o fornecedor negativo

`fn_split_tarifa` não impede. Hoje não há caller, então o risco só materializa quando o
plano do split a chamar. O mesmo vale para percentual negativo e para energia compensada
negativa.

**Decisão pendente do dono:** falhar, travar em zero, ou permitir.

---

## 7. O controle de privilégio não é durável

As cinco funções têm `REVOKE EXECUTE ... FROM PUBLIC, anon`, o que fecha as duas vias de
exposição deste projeto. Mas **`CREATE OR REPLACE` preserva a ACL, enquanto mudar a
assinatura cria uma função nova** — que nasce com `anon=X` vindo do
`ALTER DEFAULT PRIVILEGES` do Supabase. Acrescentar um parâmetro reabre o buraco em
silêncio.

O fix de raiz seria:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

Tem blast radius sobre o projeto inteiro e é decisão do dono. Merece frente própria.

**Contexto:** estas cinco são as únicas funções com `REVOKE` em todo o
`supabase/migrations/`, contra 13 arquivos com `SECURITY DEFINER` sem revogação nenhuma.

---

## 8. Itens menores, registrados

- `fn_auditar_tarifa` não distingue "não auditado" de "auditado e OK": insumo nulo,
  referência ausente ou tolerância nula produzem `divergente: false` com `campos: []`.
  Falta um `auditados[]` no retorno.
- `SELECT ... FROM "Concessionaria" WHERE "Cod. Ibge" = p_ibge LIMIT 1` sem `ORDER BY`:
  se houver mais de uma linha por IBGE, a escolha depende da ordem física.
- O ramo `fio_b` de `fn_auditar_tarifa` tem zero cobertura de teste — é um dos três ramos
  idênticos onde morava o defeito do array malformado. Falta também teste de fronteira
  (4,9% não diverge / 5,1% diverge).
- `abs(p_te - v_ref.te) / v_ref.te * 100` é a única divisão do conjunto que pode gerar
  dízima. Reescrever como `abs(diff) * 100 > p_tolerancia_pct * v_ref.te` elimina a
  divisão e vira aritmética exata.
- Nenhuma função é `STRICT` nem `PARALLEL SAFE`. `STRICT` expressaria o contrato de `NULL`
  declarativamente e dispensaria o `CASE` manual — justamente a construção onde um defeito
  se escondeu.
- `i.status::text = 'pago'` impede uso de índice em `status`. O cast é redundante.
- `invoices` tem agora três representações sobrepostas de tarifa: `tarifa_concessionaria` +
  `desconto_assinante` (antigas, escritas pelo trigger) e `te_apurado` + `tusd_apurado`
  (novas). Nada marca as antigas como superadas.
- `invoices.fio_b_apurado` não é preenchida por `fn_fio_b_apurado` — são dois caminhos
  para o mesmo conceito, sem ligação. Como a função é `IMMUTABLE`, a coluna pode ser
  `GENERATED ALWAYS AS (public.fn_fio_b_apurado(tusd_consumo_unit, tusd_compensado_unit)) STORED`.
- `apuracao_colunas.test.sql` verifica existência de coluna, não tipo.

---

## 9. O código morto do PIX ainda está no arquivo

`PlantClosingModal.handlePayout` foi desarmado com um `return` cedo, mas o corpo original
continua abaixo, inalcançável, dentro de um `eslint-disable no-unreachable` — incluindo a
chamada real a `transfer-asaas-pix`. Entre esse `return` e um PIX real existem: um merge
conflict mal resolvido, um "vou reativar só para testar", ou um refactor que remove
early-returns.

**Recomendação da revisão final:** apagar o corpo. Ele está inteiro no git
(`git show cbc6e66^:src/components/PlantClosingModal.jsx`) e descrito em prosa na spec
§1.2, que é documentação melhor do que o próprio código.
