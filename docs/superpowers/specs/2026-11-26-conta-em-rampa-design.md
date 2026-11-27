# Conta em rampa: franquia e base do Start para consumo em crescimento

Data: 26/11/2026. Status: **proposta, aguarda aprovação do dono**. Nada aqui foi implementado.
Complementa a spec do Plano do Originador (`2026-11-10-plano-originador-design.md`, itens 2 a 4 e "Contrato comum").

## 1. O problema

A regra atual (mediana do histórico, zerados e meses sem leitura preenchidos com a mediana) assume consumo **estável**. Para uma conta que acabou de entrar em operação ela erra para baixo.

Caso real (UC 960.129.032-01, conta lida em 26/11/2026; histórico `4334, 869, 329 e 100`):

| Mês | kWh | Dias | kWh/dia | Equivale a 30 dias |
|---|---|---|---|---|
| mai/26 | 100 | 20 | 5,0 | 150 |
| jun/26 | 329 | 29 | 11,3 | 340 |
| jul/26 | 869 | 33 | 26,3 | 790 |
| ago/26 | 4.334 | 30 | 144,5 | 4.334 |

- Mediana = **599**; média = 1.408 (o app gravou a média por engano, PR 156); último ciclo = **4.334**.
- O consumo multiplicou ×2,3, ×2,3 e ×5,5: carga entrando em operação, não ruído.

Efeitos de usar 599 numa conta que já consome 4.334:
1. **Franquia**: cobre cerca de 14% do consumo real; o resto fica fora da compensação.
2. **Perfil mensal / ocupação da usina**: os 8 meses sem leitura são preenchidos com 599 (`origem = 'mediana'`), subestimando a ocupação.
3. **Base do Start** (`start_base_kwh`, congelada no cadastro e nunca reescrita): o teto do Start do parceiro fica em X × 599.

## 2. Escopo

Dentro: detectar o regime da conta, sugerir franquia, recalibrar a cada conta nova, preencher o perfil mensal e definir a base do Start enquanto a conta está em rampa.
Fora: contratos já assinados (franquia contratada só muda com aditivo), geração da usina, UCs de eletroposto, Conta Saldo (franquia ≤ 1 kWh continua ignorando o perfil).

## 3. Definições

Para cada mês `i` do histórico lido: `c_i = kwh_i / dias_i × 30` (consumo normalizado a 30 dias). Sem `dias`, `c_i = kwh_i`. Só entram meses com `kwh > 0`. `n` = quantidade desses meses; `c_ult` = o mais recente.

## 4. Detector de regime (função pura)

| Regime | Condição |
|---|---|
| `insuficiente` | `n < 2` |
| `em_rampa` | `n ≤ 6` **e** `c_ult ≥ 2 × mediana(c anteriores)` **e** `c_ult > 1,25 × c_penúltimo` |
| `em_queda` | `n ≥ 3` e `c_ult ≤ 0,5 × mediana(c anteriores)` |
| `estavel` | demais casos |

No caso real: anteriores `[150, 340, 790]`, mediana 340; `4.334 ≥ 680` e `4.334 > 790` → **em_rampa**.

`em_queda` não reduz nada sozinha: gera uma **sugestão** de redução (decisão 4) e alerta o time, que aplica ou não (redução automática de franquia pode derrubar a energia de quem está sendo atendido).

## 5. Franquia em rampa

```
F_rampa = arredondar( prudência × c_ult )
F_rampa = máx(F_rampa, mediana do histórico)           # nunca abaixo da regra atual
F_rampa = mín(F_rampa, teto físico)                     # se houver
```

- **Prudência = 80 %** (parâmetro; faixa 70 a 90 %). O último ciclo pode ter efeito pontual (acerto de ciclos, teste de carga); franquia acima do real ocupa a usina sem uso, abaixo deixa energia fora da compensação.
- **Teto físico (opcional)**: `kW × 730 h × fator de carga`, com kW de carga instalada / demanda contratada (grupo A, ou informada no cadastro) e fator de carga padrão 0,6. Quando existir o consumo declarado do cliente (lead / simulação), `F_rampa ≤ 1,5 × declarado`.
- **Não extrapolar tendência**: a regressão exponencial dos 4 pontos projeta cerca de 14 mil kWh/mês; o crescimento satura, e o limite é físico.
- Caso real: `0,8 × 4.334 = 3.467 kWh` (hoje: 1.408).

## 6. Estado e recalibração

Novas colunas em `consumer_units`: `regime_consumo text` (`estavel | em_rampa | em_queda | insuficiente`), `regime_desde timestamptz`, `franquia_sugerida numeric`.

A cada conta nova (`fn_gravar_historico_consumo`, que já sobrescreve o mês do perfil com `origem = 'conta'`):
1. recalcula o regime e a franquia sugerida;
2. **não altera `franquia` vigente depois da assinatura do contrato**: grava `franquia_sugerida` e mostra no modal com botão "Aplicar" (a franquia consta no termo; mudar exige o aditivo). Antes da assinatura (UC em ativação sem contrato enviado), aplica sozinha;
3. trava de variação: sugestão fora de ±30 % da vigente gera alerta para o time.

**Saída da rampa**: `n ≥ 6` e os últimos 3 ciclos com `0,75 ≤ c_i / c_(i-1) ≤ 1,25`. A UC passa a `estavel`; a franquia sugerida volta a ser a **mediana dos ciclos da janela estável** (os 3+ últimos), não do histórico inteiro, que ainda carrega a subida.

## 7. Perfil mensal (ocupação da usina)

O perfil de 12 meses (`historico_consumo`) preenche meses ausentes ou zerados com a mediana (`origem = 'mediana'`). Em rampa, esses meses são preenchidos com `F_rampa` (**`origem = 'rampa'`**); meses com leitura real ficam como estão. Ao estabilizar, voltam a `mediana`. A tela de histórico ganha o rótulo "Preenchido pela rampa".

## 8. Base do Start (decisão do dono)

Regra atual (spec do Plano, item 4): a base é a mediana do upload, **congelada no cadastro**. Três opções para conta em rampa:

- **A. Manter** a mediana (599). Sem mudança de regra; o parceiro recebe Start limitado a X × 599 kWh de uma conta que consome 4.334.
- **B. Congelar só ao sair da rampa.** Enquanto isso o Start não paga (`uc_sem_consumo_base`), a recorrência segue. Atrasa a remuneração por meses.
- **C. Congelar já com `F_rampa` (recomendada).** Continua "congelada uma vez, no cadastro"; só muda o valor. O Start paga sobre kWh **efetivamente compensados** até o teto, então um teto maior só vale se o consumo se confirmar. Risco baixo.

## 9. Mudanças técnicas (quando aprovado)

- SQL: `fn_classificar_regime_consumo(jsonb)` IMMUTABLE; `fn_gravar_historico_consumo` passa a gravar regime, sugestão e preenchimento `rampa`; congelamento de `start_base_kwh` conforme a opção escolhida.
- JS: espelho em `src/lib/historicoConsumo.js` (mesma regra, testada); `contaParaUc` e os leitores do app/WhatsApp usam a sugestão em vez da mediana pura quando em rampa.
- UI: selo "Em rampa" no modal da UC e na lista; no bloco de histórico, "franquia sugerida × vigente" e botão Aplicar.
- Testes (node:test + SQL em transação descartada): caso real (`em_rampa`, F = 3.467, base C = 3.467); estável de 12 meses (mediana inalterada); `n = 1` (`insuficiente`); queda (`em_queda`, só alerta); `dias` ausente; saída da rampa; Conta Saldo ignorada.

## 10. Parâmetros (todos configuráveis, valores iniciais)

Janela de rampa `n ≤ 6`; razão de entrada 2×; prudência 80 %; fator de carga 0,6; trava ±30 %; estabilização 3 ciclos dentro de ±25 %.

## 11. Decisões do dono (26/11/2026)

1. Base do Start em rampa: **opção C** (congelar já com `F_rampa`).
2. Prudência de **80 %**: aprovada.
3. Depois do contrato assinado a franquia só é **sugerida** (botão Aplicar).
4. Conta `em_queda`: **sugere** redução (não só alerta). A sugestão segue a mesma regra do item 3: nada muda sozinho depois da assinatura.

Status: spec aprovada; falta o plano de implementação.
