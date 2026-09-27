# Levantamento — Base de Cálculo e Efeito da Gestão a 10%

Task 1 do plano "Split de Pagamentos". Somente leitura (SELECT). Projeto `abbysvxnnhwvvzhftoms`.

Motor hoje (`handle_invoice_paid_ledger`, lido via `pg_get_functiondef`):
`base_calculo = valor_a_pagar - valor_concessionaria`; comissão do originador = `base × split_commission` (`originators_v2`); gestão B2W = `base × gestao_percentual/100 − comissão_recorrente` (zerada se negativa e `base > 0`); investidor = residual.

## (a) 10 faturas pagas reais — UCs não-geradoras

kWh usado: **`consumo_compensado`** (energia efetivamente compensada no ciclo), não `consumo_kwh` bruto. Motivo: quando `consumo_compensado = 0` a `base` também é 0 mesmo com `consumo_kwh` alto (mês sem compensação) — usar `consumo_kwh` superestimaria a fórmula nesses meses. Fórmula do Plano: `kwh_compensado × (tarifa − fio_b − tarifa×desconto%)` (bate com o exemplo do Plano: `1,032−0,2128−1,032×0,20=0,6128`; exemplo da Cosern do brief usa 15%: `1,03−0,213−1,03×0,15=0,6625`).

| UC | Mês | kWh cons. | kWh comp. | Valor a pagar | Valor conc. | **Base (R$)** | Tarifa | Fio B | Desc% | Fórmula (R$) | Dif (R$) | Dif % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 7030004129 | 05/26 | 1144 | 1144 | 1080,55 | 473,28 | 607,27 | 1,032 | 0,2128 | 20 | 701,04 | 93,77 | 15,44% |
| 7030004129 | 06/26 | 1055 | 1055 | 996,72 | 448,90 | 547,82 | 1,032 | 0,2128 | 20 | 646,50 | 98,68 | 18,01% |
| 7030004129 | 07/26 | 917 | 917 | 866,35 | 314,38 | 551,97 | 1,032 | 0,2128 | 20 | 561,94 | 9,97 | 1,81% |
| 7030003955 | 05/26 | 2499 | 2499 | 2387,63 | 836,71 | 1550,92 | 1,032 | 0,2128 | 20 | 1531,39 | -19,53 | -1,26% |
| 7030003955 | 06/26 | 2556 | 2556 | 2414,84 | 849,32 | 1565,52 | 1,032 | 0,2128 | 20 | 1566,53 | 1,01 | 0,06% |
| 7030003955 | 07/26 | 2550 | 2550 | 2409,18 | 875,55 | 1533,63 | 1,032 | 0,2128 | 20 | 1562,64 | 29,01 | 1,89% |
| 7030004455 | 07/26 | 310 | 263 | 303,75 | 139,47 | 164,28 | 1,032 | 0,2128 | 20 | 161,17 | -3,11 | -1,90% |
| 7030004579 | 07/26 | 217 | 146 | 231,61 | 129,50 | 102,11 | 1,032 | 0,2128 | 20 | 89,47 | -12,64 | -12,38% |
| 7030004366 | 07/26 | 820 | 820 | 777,50 | 275,70 | 501,80 | 1,032 | 0,2128 | 20 | 502,50 | 0,70 | 0,14% |
| 7030839166 | 08/26 | 4948 | 4948 | 4792,81 | 1764,91 | 3027,90 | 1,032 | **0,0000** | 20 | 4085,00 | 1057,10 | **34,92%** |

Todas as UCs são Neoenergia Cosern (`Fio B` padrão de referência = 0,2128). A linha 7030839166 tem `Fio B` cadastrado como 0 na UC (deveria ser 0,2128) — é o pior caso e mostra que `valor_concessionaria` real embute Fio B mesmo quando o cadastro da UC está zerado.

## (b) Veredito — BLOCKED

- Divergência média (|dif%|, 10 amostras): **8,78%**
- Divergência máxima: **34,92%** (UC 7030839166, 08/2026)
- Mesmo excluindo o caso de Fio B cadastrado errado (linha 10) e os meses com compensação parcial (linhas 7-8, efeito de franquia), a UC 7030004129 sozinha varia 1,81% a 18,01% mês a mês com o **mesmo** Fio B e tarifa cadastrados — ou seja, `valor_concessionaria` carrega algo (bandeira tarifária, impostos apurados, correção, taxas da concessionária) que a fórmula tarifa−fio_b−desconto não captura.

**Não dá para escolher sozinho. Pergunta para o dono:**

> Para o "base de cálculo líquida" do Plano de Recompensas, o motor deve continuar usando `valor_a_pagar − valor_concessionaria` (o que a fatura realmente apurou, incluindo bandeira/impostos/ajustes), ou deve passar a usar `consumo_compensado × (tarifa − fio_b − tarifa×desconto%)` (fórmula fixa do Plano)? Nos dados reais essas duas contas divergem em média 8,8% e até 34,9% por fatura — não é arredondamento. Se for a fórmula fixa, o cadastro de Fio B de pelo menos 4 UCs ativas (Cosern, hoje zerado) precisa ser corrigido antes, senão a gestão da B2W fica sistematicamente superestimada nelas.

Task 2 não deve prosseguir até essa resposta.

## (c) Efeito de trocar a gestão para 10% (últimos 3 meses de faturas pagas: 06, 07 e 08/2026)

Gestão bruta = `base × gestao_percentual/100` (sem descontar comissão de originador — ela é igual nos dois cenários e não afeta o delta).

| Usina | Gestão atual | UCs ativas hoje | Faturas pagas (3m) | Base total 3m (R$) | Gestão atual (R$) | Gestão a 10% (R$) | Delta (R$) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Novo Leblon | 10% | 0 | 1 | 212,99 | 21,30 | 21,30 | 0,00 |
| UFV Bom Jesus | 10% | 12 | 14 | 11.667,28 | 1.166,73 | 1.166,73 | 0,00 |
| UFV Bom Jesus II | 10% | 4 | 8 | -31,69 | -3,17 | -3,17 | 0,00 |
| **TOTAL** | — | **16** | **23** | **11.848,58** | **1.184,86** | **1.184,86** | **0,00** |

**Nenhum efeito monetário.** As 3 usinas com faturamento pago nos últimos 3 meses já operam com `gestao_percentual = 10`. As outras 7 usinas cadastradas (Ana Paola de Moura, Potengi-SPP, Nilton Costa, São José do Seridó — já em 10%; Santa Maria, São Vicente, São Vicente II — em 0%) têm 0 UCs ativas e nenhuma fatura paga no período: sem efeito hoje, mas se São Vicente/Santa Maria/São Vicente II (0%) ativarem UCs no futuro, a troca para 10% passará a valer e reduzirá a receita de gestão delas (delta negativo).

Novo Leblon aparece com 1 fatura paga mas 0 UCs ativas hoje: a UC que gerou essa fatura mudou de status depois do pagamento.

## (d) O que quebraria o motor novo

- **9 UCs sem `usina_id`** — todas `cancelado`/`cancelado_inadimplente`/`desconectado` (Neoenergia Cosern: 7030043183, 701xxxxxx, 7008122266, 7024034601, 7029990055, 7030765391, 7030765324, 7030839085, 7030839328). Não afetam faturamento corrente, mas um reprocessamento retroativo com `JOIN usinas` obrigatório quebra nessas linhas.
- **4 UCs ativas com `Fio B = 0`** cadastrado (deveria ser ~0,2128, padrão Cosern B1): `1.979.411.032-86`, `7030839166`, `2.317.540.032-10`, `2.236.346.032-16`. Se o motor novo adotar a fórmula fixa do item (b), essas UCs terão gestão/comissão superestimada em ~35% até o cadastro ser corrigido.
- **1 fatura paga com `valor_a_pagar = 0`** e `valor_concessionaria = 31,69` (UC `1.979.411.032-86`, 07/2026) → base negativa de -31,69. O motor atual já lança o repasse ao investidor negativo nesse caso; confirmar se o motor novo deve manter esse comportamento ou tratar como erro de leitura.
- **Usinas sem `gestao_percentual`:** 0 (nenhuma nula).
- **UCs ativas sem tarifa cadastrada:** 0. **UCs ativas com `fio_b` nulo:** 0 (mas 4 com valor zerado, ver acima).
