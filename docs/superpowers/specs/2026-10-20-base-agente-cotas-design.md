# Base de conhecimento do Agente Cotas (cotas de usina)

Data: 20/10/2026 · Estado: implementado em 20/10/2026 (ver `playbook/DESKCOMM.md` §8.4)
Contexto: `playbook/DESKCOMM.md` (§8.1 Investidor, §8.2 Bel, §8.3 Assinatura). Terceira base por produto.

## 1. Objetivo

Dar ao Agente Cotas (funil "Cotas" no Deskcomm) o conhecimento para explicar a cota de usina, informar o preço e as
cotas livres de cada usina, responder as dúvidas frequentes e levar o cliente ao consultor para fechar — sem inventar
e sem prometer rentabilidade.

Fora do escopo (projetos seguintes, cada um com seu brainstorming):
- **Cadastro de cotistas por usina** (quem comprou cada cota). Até lá, as cotas vendidas são um contador manual.
- **Divisão do repasse por cota no motor de split.** Hoje o split paga um único fornecedor por usina.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Arquitetura | Igual ao Investidor: prompt = comportamento; base = fatos (FAQ fixo + documento gerado do CRM). Sem ferramenta MCP nova: o documento se atualiza por gatilho. |
| Divisão | Toda usina de cotas tem **10 cotas**. |
| Preço da cota | Preço da usina (`valor_investido`) ÷ 10 + **10%** de taxa. Ex.: usina de R$ 300.000 → cota de R$ 33.000. |
| Taxa de 10% | Cobre a estruturação jurídica da associação dos cotistas e a gestão da divisão do repasse. Fixa hoje; pode ser revista no futuro. |
| Retorno | A cota recebe 1/10 do repasse líquido da usina. Projeção **entre 1,8% e 2% ao mês, a depender do mês de geração**, antes de impostos. Mesma ressalva do Investidor. Payback, TIR e rentabilidade ano a ano só com o consultor. |
| Recebimento | A associação dos cotistas **já está formada**: quem compra se associa e recebe um **título de propriedade da cota**. A associação recebe o repasse da B2W e transfere a parte de cada cotista. Tributação: orientar com o contador. |
| Abater a conta | A cota é investimento (renda). Para ter desconto, o cotista faz uma adesão separada como assinante, com o imóvel na área da mesma distribuidora. |
| Pagamento | Somente à vista. Sem parcelamento e sem financiamento. |
| Fechamento | Link da página da usina + humano (consultor), motivo "fechar cota". |
| Revenda | A cota é transferível: a B2W ajuda a achar comprador, e a associação transfere o título ao novo cotista. |
| Fatos que valem igual ao Investidor (proporcionais) | Custos mensais descontados do repasse antes da divisão; ~90 dias para começar a receber; Fio B na projeção; inadimplência e fila de espera; garantias; visita. |
| Proibido | "garantido", "risco zero", "blindado", "100% seguro"; parcelamento ou financiamento; multa ou retenção; preço que não esteja no documento; nome de cotista. |

## 3. Comportamento do agente (nova versão do prompt)

Mantém o bloco comum (`## Regras de todo atendimento` + `## Abertura`, de `scripts/deskcomm/bel_recepcao.sql`) e troca o
bloco próprio pelo roteiro:

1. **Interesse:** valor que pretende investir ou quantas cotas; pessoa física ou empresa.
2. **Modelo em até 3 frases:** a usina é dividida em 10 cotas; quem compra se associa à associação dos cotistas (já
   formada) e recebe o título de propriedade da cota; a associação recebe o repasse da B2W e divide entre os cotistas,
   1/10 do repasse líquido para cada cota.
3. **Oferta:** consulta "Usinas com cotas"; envia o preço da cota e o link da usina com cota livre.
4. **Números**, sempre com a ressalva "projeção, não garantia: varia com a geração anual, a tarifa da concessionária e o
   estágio da obra; antes de impostos": preço da cota (do documento) e projeção entre 1,8% e 2% ao mês, a depender do mês
   de geração.
5. **Fechamento:** com valor e usina definidos, `crm_request_human_handoff` "fechar cota". Somente à vista.

Desvios:

| Situação | Ação |
|---|---|
| Quer investir o valor de uma usina inteira ou mais | Explica que dá para comprar a usina inteira; handoff "quer usina inteira — funil Usinas de Investimento". |
| Quer abater a própria conta | Explica que a cota é investimento; desconto = adesão separada como assinante, imóvel na área da mesma distribuidora. |
| Nenhuma usina com cota livre | "O consultor avisa quando abrir a próxima"; grava `lista_espera = true`; handoff. |
| Tributação | "A associação repassa a cada cotista; a tributação é orientada pelo contador." |

Etapas:

| Situação | Etapa |
|---|---|
| Informou valor e interesse | Qualificando |
| Recebeu preço e link | Simulação / Proposta enviada |
| Quer fechar | Contrato enviado (handoff ao consultor) |

## 4. Conteúdo da base

### 4.1 Fonte A — "Cotas — Perguntas e respostas" (tipo `faq`, estática)

Arquivo `supabase/functions/deskcomm-base/bases/cotas-faq.ts` (formato `## Pergunta:` / `## Resposta:`). Sem preços nem
cotas livres (ficam na Fonte B). 14 pares aprovados:

1. **O que é uma cota de usina?** É 1/10 de uma usina solar da B2W. Quem compra se associa à associação dos cotistas,
   que já está formada, e recebe um título de propriedade da cota. A associação recebe da B2W o repasse mensal da usina
   e divide igualmente entre os cotistas: cada cota recebe 1/10 do repasse líquido.
2. **Quanto custa uma cota?** O preço da usina dividido por 10, mais 10% de taxa, que cobre a estruturação jurídica da
   associação e a gestão da divisão do repasse. O valor de cada usina está em "Usinas com cotas".
3. **Qual o retorno?** A projeção é de 1,8% a 2% ao mês, a depender do mês de geração, antes de impostos. Projeção, não
   garantia: varia com a geração anual, a tarifa da concessionária e o estágio da obra. Payback e rentabilidade
   detalhada são apresentados pelo consultor.
4. **De onde vem a receita?** Os assinantes pagam a energia da usina com desconto. Desse valor saem o Fio B e a gestão
   da B2W; o que sobra é o repasse da usina, dividido entre os cotistas.
5. **Como eu recebo?** A associação dos cotistas recebe o repasse da B2W e transfere a parte de cada cotista, todo mês.
   A tributação é orientada pelo contador.
6. **Quais são os custos mensais?** Os custos da usina — arrendamento da área, internet, água e energia do local e, a
   partir do 13º mês, manutenção e seguro — são descontados do repasse antes da divisão. Cada cota arca com 1/10.
7. **Quando começo a receber?** Cerca de 90 dias depois que a usina começa a gerar: 30 de geração, 30 de compensação e
   30 de faturamento ao assinante. Depois, o repasse é mensal.
8. **E se o assinante não pagar?** O repasse acontece depois que os assinantes pagam. A B2W cobra os inadimplentes, e
   há fila de espera: quem sai é substituído em até 30 dias.
9. **E o Fio B?** Ele sobe até 2029, como prevê a Lei 14.300, e isso já está na projeção. A projeção ano a ano é
   apresentada pelo consultor.
10. **Como é o pagamento?** Somente à vista.
11. **Posso vender minha cota?** Sim. A B2W ajuda a encontrar o comprador, e a associação transfere o título da cota ao
    novo cotista.
12. **A cota dá desconto na minha conta de luz?** Não: a cota é investimento. Para ter desconto, você faz uma adesão
    separada como assinante da Energia por Assinatura, com o imóvel na área da mesma distribuidora.
13. **Que garantias tenho?** As mesmas da usina: instalação, 12 meses (B2W); inversor, 5 anos; módulos, 12 anos contra
    defeito e 20 anos de garantia de performance.
14. **Quem é a B2W Energia? Posso visitar uma usina?** Cópia literal da resposta de mesmo nome em
    `bases/investidor-faq.ts`.

### 4.2 Fonte B — "Usinas com cotas" (tipo `documento`, gerada do CRM)

Uma seção por usina com `a_venda = true`, `modelo_venda = 'cotas'`, status diferente de `cancelada` e
`cotas_vendidas < 10`, ordenadas pela previsão de entrega (sem data por último):

```
## UFV Santa Maria — Santa Maria/RN
Estágio: em obra (pré-operação) · Previsão de entrega: dez/2026
Preço da cota: R$ 34.650 (usina R$ 315.000 ÷ 10 + 10%)
Cotas livres: 7 de 10
Pagamento: somente à vista
Página da usina: https://link.b2wenergia.com.br/ufvsantamariausina
```

- Preço da cota = `round(valor_investido / 10 × 1,1)`. `valor_investido` vazio ou zero → "Preço da cota: a confirmar
  com o consultor".
- Demais campos vazios → "a confirmar com o consultor" (mesma regra de "Usinas à venda").
- Sem nenhuma usina: "No momento não há cota disponível; o consultor avisa quando a próxima abrir."
- Nunca entram: dono, cotistas, CPF/CNPJ, credenciais, UCs, endereço completo.

## 5. Mudanças

### 5.1 CRM

- Migration: `usinas.cotas_vendidas smallint not null default 0 check (cotas_vendidas between 0 and 10)`; RPC
  `ponte_deskcomm_usinas_cotas()` (só `service_role`) devolvendo nome, cidade/UF, status, previsão, `valor_investido`,
  `cotas_vendidas`, `short_url` das usinas da §4.2; recriar `trg_ponte_usinas_base` incluindo `cotas_vendidas` na lista de
  colunas (a condição da função do gatilho — usina que está ou estava à venda — continua a mesma e já cobre as cotas).
- `src/components/PowerPlantModal.jsx`, aba **Contratos**: campo "Cotas vendidas (de 10)" (número 0–10), visível
  quando "Modelo de venda" = Cotas; no estado inicial, na leitura da usina e no payload de gravação.

### 5.2 Base e agentes

- `deskcomm-base`: conteúdos `cotas_faq` (faq) e `usinas_cotas` (documento), categoria `cotas`; chaves semeadas em
  `ponte_deskcomm.fontes_base` pela migration; `montar.ts` ganha `montarUsinasCotas`.
- `bases/investidor-faq.ts`, pergunta "Dá para comprar só uma parte?": "Sim, por cotas: o preço da usina dividido por
  10, mais 10% de taxa (estruturação da associação e gestão do repasse). Os valores por usina estão em 'Usinas com
  cotas'." (sai o "a partir de R$ 35.000").
- `scripts/deskcomm/base_cotas.sql` (idempotente): versão nova do Agente Cotas com o roteiro da §3 e as fontes
  `cotas_faq` + `usinas_cotas`.
- `scripts/deskcomm/base_investidor.sql`: passa a incluir a fonte `usinas_cotas` (para a pergunta da cota); rodar de
  novo publica a versão nova do Investidor.
- `playbook/DESKCOMM.md`: §8.4.

## 6. Erros

| Situação | Comportamento |
|---|---|
| Nenhuma cota livre | Documento com o aviso; agente grava lista de espera e passa a humano. |
| `cotas_vendidas` > 10 ou < 0 | O banco recusa a gravação (check). |
| Usina sem preço | "Preço da cota: a confirmar com o consultor". |
| Falha de sincronização ou do gatilho | Como na `deskcomm-base`: não grava, registra em `erros`; o cron corrige. |
| Fonte recriada | Aviso para rodar `base_cotas.sql` (ou `base_investidor.sql`). |

## 7. Testes

1. Vitest:
   - `montarUsinasCotas`: usina de R$ 315.000 → "R$ 34.650"; 3 vendidas → "Cotas livres: 7 de 10"; esgotada,
     `integral` e cancelada ficam de fora; sem preço → "a confirmar com o consultor"; ordem por previsão; nenhum campo
     fora do contrato; lista vazia → aviso.
   - FAQ de Cotas com 14 pares, sem "parcel", "financiamento" como oferta, "garantid", "risco zero", "blindad".
   - FAQ do Investidor sem "35.000" e com "dividido por 10".
2. SQL em transação desfeita: a RPC devolve só usinas à venda em cotas com cota livre; `cotas_vendidas = 11` é recusado.
3. Ensaio e indexação das fontes `cotas_faq` e `usinas_cotas` (e reindexação do FAQ do Investidor).
4. Tela: com "Modelo de venda" = Cotas, o campo aparece e grava.
5. WhatsApp (depois de marcar uma usina como à venda em cotas): "quero comprar cota"; "qual o retorno da cota?"; "dá para
   parcelar?"; "a cota abate minha conta?"; "tenho 400 mil".

## 8. Riscos

- Contador manual: sem atualização, o agente oferece cota já vendida; o consultor corrige no fechamento. Resolve-se com
  o cadastro de cotistas.
- Divisão do repasse por cota não existe no motor de split: enquanto não existir, a associação divide fora do sistema.
- Hoje nenhuma usina está à venda em cotas: o agente responde "não há cota disponível" até alguma ser marcada.
