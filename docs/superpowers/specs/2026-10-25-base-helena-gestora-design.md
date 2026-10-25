# Base de conhecimento da Helena (Gestora / Comercializadora)

Data: 25/10/2026. Método: brainstorming com o dono, um passo por vez. Depende do PR saas#54 (Bel), de onde a branch parte.

## 1. Problema

A Helena (v6) atende donos de usina que querem fornecer energia à B2W, mas **não tinha base de conhecimento**: a única fonte ligada a ela era "Conversas anteriores", com 0 trechos. O roteiro só sabia perguntar e proibia falar de preço, volume e condição. Quem perguntava "como funciona?" ou "quanto eu recebo?" ficava sem resposta.

## 2. Decisões do dono

| Tema | Decisão |
|---|---|
| Modelo | A B2W **gerencia a usina em nome do dono** (operação, rateio, cobrança dos assinantes) e repassa o resultado. Não compra nem aluga a energia. |
| Fonte | Só solar. Outra fonte: agradecer e encerrar. |
| Situação | Operando, ou em construção **com prazo de entrega**. Projeto no papel fica de fora. |
| Potência | Sem limite. |
| Projeto no papel | A Helena pergunta se o dono quer falar com o **Leo (Usinas de Investimento)**, que tem uma proposta especial para construir. |
| Repasse | Sobre a energia **compensada**, não a injetada. São grandezas distintas, não complementares. Valor por kWh = tarifa da concessionária − desconto do assinante − Fio B − taxa de gestão. Pago todo dia 10. |
| Números | Vêm do plano de usina do CRM (`planos_usina`, status `ativo`): `percentual_recorrente` = taxa de gestão, `desconto_pct` = desconto do assinante, `dia_repasse`, `dia_corte` (data de fechamento da apuração das faturas pagas pelo assinante que entram no repasse do dia 10). Hoje: 12%, 15%, dia 10, corte dia 5. |
| Quando citar | Só se o fornecedor perguntar, com a ressalva de que o especialista confirma. Dia de repasse e de corte podem ser citados. |
| Setup, carência, prazo | Assunto obrigatório antes de passar ao especialista. Os dados **ainda não existem**: campos novos no plano, preenchidos depois pelo dono. |
| Passagem | Com os dados básicos da usina (responsável, empresa/CNPJ, cidade/UF, distribuidora, potência, situação, contato). |

## 3. O que a Helena NÃO afirma (vai ao especialista)

Taxa de recuperação, retenção na rescisão, multas, valor do Fio B, documentos exigidos, prazo de implantação, exclusividade. As colunas existem em `planos_usina` mas são do contrato de compra e venda; o dono não as liberou para a Helena.

## 4. Banco

Migration `20261025a_gestora_helena.sql`.

### 4.1 Campos novos em `planos_usina`
`setup_pct` (0–100), `setup_base` (texto: sobre o que incide), `carencia_dias`, `prazo_primeiro_repasse_dias`. Nascem vazios. O setup só é citado como número quando `setup_pct` **e** `setup_base` estão preenchidos (um percentual sem base de cálculo não informa nada).

`fn_planos_usina_trava` bloqueia mudança de valores do plano quando há usina vinculada, mas só para as colunas que ela lista. **As colunas novas não entram na trava**: continuam editáveis mesmo com usina vinculada. Se o dono quiser congelá-las, a trava precisa ser estendida (fora deste escopo).

### 4.2 Gatilho
`trg_ponte_planos_usina_base` (statement, insert/update/delete em `planos_usina`) chama `ponte_deskcomm.fn_assinatura_para_base()`, que aciona a `deskcomm-base`. Falha nunca bloqueia a gravação; o cron corrige.

### 4.3 Leitura
`public.ponte_deskcomm_gestora_planos()` (só `service_role`): planos com status `ativo`.

## 5. Base de conhecimento (Edge Function `deskcomm-base`)

1. **"Gestora — Perguntas e respostas"** (faq, `bases/gestora-faq.ts`): 14 perguntas, **nenhum número** (teste garante). Mecanismo, fontes aceitas, projeto no papel → Leo, compensada × injetada, fórmula, Fio B qualitativo, setup/carência/prazo, quem quer desconto na conta (Assinatura), próximos passos.
2. **"Gestora: planos vigentes"** (documento, `montarGestoraPlanos`): por plano ativo, taxa de gestão, desconto, dia de repasse, dia de corte, setup, carência e prazo. Campo vazio sai como "ainda não definido; o especialista confirma". Só os campos do contrato entram (taxa de recuperação, retenção e multas nunca).

Como os números vivem em fonte provada, a trava de promessas do Deskcomm os aceita; o FAQ não repete número para não ficar desatualizado.

## 6. Helena v7 (`scripts/deskcomm/base_helena.sql`)

Alteração cirúrgica sobre a versão publicada (a persona fica):
- Fonte solar: troca o item 3 do roteiro.
- Situação: operando ou em construção com prazo de entrega.
- Substitui a proibição genérica de condição comercial pelo bloco "Base da Gestora" (busca na base, regras acima).
- Anexa as duas fontes.
- Roteador: a intenção da Helena passa a "dono de usina solar em operação ou construção"; a do Leo ganha "dono de projeto de usina solar no papel que quer construir", para o roteador levar a conversa ao Leo quando o dono aceitar.

## 7. Pendências com o dono

- Preencher no plano: setup (% e base), carência, prazo até o primeiro repasse.
- **O Leo precisa ter a proposta de construção na base dele.** A base do Investidor (saas#38) não trata de construir a usina para o dono; o Leo hoje não saberia detalhar a "proposta especial".
- Não estão definidas a política para outras fontes que não solar além de encerrar, nem documentos exigidos.
- O plano `Plano Usina - Recorrencia Corretor` (ativo) tem plano de recompensas; o dono escolheu que ele seja o citado.

## 8. Verificação

Testes (`tests/deskcomm-base.test.ts`, 43 passando): FAQ sem número e sem temas proibidos, compensada ≠ injetada, fórmula, projeto no papel → Leo, setup sem base não vira número, campos fora do contrato não vazam, plano ausente. Ensaio da migration em transação desfeita, ensaio da Edge Function (`{"ensaio": true}`), verificação das fontes e do prompt publicado.
