# Base do Leo: construção sob medida

Data: 25/10/2026. Método: brainstorming com o dono, um passo por vez. Complementa a base do Investidor (`2026-10-19-base-agente-investidor-design.md`), que só trata da compra de usina.

## 1. Problema

A Helena (Gestora, `2026-10-25-base-helena-gestora-design.md`) passou a oferecer o Leo ao dono de projeto de usina solar ainda no papel, "que tem uma proposta especial para fazer a construção". O Leo não tinha nada na base sobre construir a usina de quem já tem o projeto.

## 2. Decisões do dono

| Tema | Decisão |
|---|---|
| Público | Os dois casos: dono de terreno/projeto que quer a B2W construindo, e quem quer a usina construída do zero. |
| Argumento | Vantagens de construir com a B2W, que tem expertise, ou comprar uma usina nossa já em construção. |
| Vantagens a destacar | Experiência comprovada; a usina já nasce com assinantes e gestão da B2W; acompanhamento da obra e custos iniciais. (Garantias ficam na base do Investidor.) |
| Proposta especial | A B2W cuida de tudo: projeto, homologação, obra e conexão. |
| Custo da obra | Nenhum valor; orçamento pelo consultor. |
| Requisito | Recursos para a obra. Terreno e projeto: o consultor avalia caso a caso. |

## 3. Fora de escopo

Valor de referência de obra, documentos exigidos, prazos de execução. O Leo nunca estima esses pontos.

## 4. Base de conhecimento

Fonte nova, **"Construção — Perguntas e respostas"** (`bases/construcao-faq.ts`, 9 itens): a B2W constrói e cuida de tudo; vantagens; construir a minha ou comprar uma em construção; custo (orçamento do consultor); o que preciso ter; quem gerencia; quando começo a receber; acompanhar a obra; já tenho terreno. Os únicos números (8 anos, mais de 1.000 usinas de varejo, gestão de 10%, 90 dias) são cópia literal de `investidor-faq.ts`, que o Leo já lê, então a trava de promessas os aceita. Sem valor de obra, sem retorno, sem R$.

FAQ estático: sem migration de dados nem gatilho. A migration `20261025b_leo_construcao.sql` só cria a linha em `ponte_deskcomm.fontes_base`.

## 5. Leo v7 (`scripts/deskcomm/base_leo_construcao.sql`)

Alteração cirúrgica sobre a versão publicada (persona preservada): insere o bloco "Construção sob medida" antes de "Desvios:" e anexa a fonte. O bloco manda buscar a base, apresentar as duas opções, destacar as três vantagens, nunca informar valor de obra e passar ao consultor com o motivo "construção sob medida".

O trecho existente do Leo "tem usina de outra empresa e quer só a gestão → funil Gestora/Comercializadora" continua correto: é o modelo da Helena.

## 6. Verificação

`npx vitest run tests/deskcomm-base.test.ts` (50 passando): FAQ com 9+ itens, números só os da base do Investidor, sem R$/kWp, a B2W cuida de tudo, vantagens, as duas opções, custo é orçamento, sem palavras proibidas ao Leo. Ensaio do script em transação desfeita antes de publicar.

## 7. Pendências

Teste real da passagem Helena → Leo; valor de referência de obra, se o dono quiser que o Leo cite algum.
