/**
 * FAQ do Agente Cotas no DeskcommCRM
 * (spec docs/superpowers/specs/2026-10-20-base-agente-cotas-design.md §4.1).
 * Em .ts porque a Edge Function so publica arquivo importado.
 * Preco da cota e cotas livres ficam em "Usinas com cotas", gerado do CRM:
 * aqui so regra. A ultima resposta e copia literal da de investidor-faq.ts.
 */
export const FAQ_COTAS = `## Pergunta: O que é uma cota de usina?
## Resposta: É 1/10 de uma usina solar da B2W. Quem compra se associa à associação dos cotistas, que já está formada, e recebe um título de propriedade da cota. A associação recebe da B2W o repasse mensal da usina e divide igualmente entre os cotistas: cada cota recebe 1/10 do repasse líquido.

## Pergunta: Quanto custa uma cota?
## Resposta: O preço da usina dividido por 10, mais 10% de taxa, que cobre a estruturação jurídica da associação e a gestão da divisão do repasse. O valor de cada usina está em "Usinas com cotas".

## Pergunta: Qual o retorno da cota?
## Resposta: A projeção é a mesma da usina inteira: cerca de 2% ao mês. Projeção, não garantia: varia com a geração anual, a tarifa da concessionária e o estágio da obra. Payback e rentabilidade detalhada são apresentados pelo consultor.

## Pergunta: De onde vem a receita?
## Resposta: Os assinantes pagam a energia da usina com desconto. Desse valor saem o Fio B e a gestão da B2W; o que sobra é o repasse da usina, dividido entre os cotistas.

## Pergunta: Como eu recebo?
## Resposta: A associação dos cotistas recebe o repasse da B2W e transfere a parte de cada cotista, todo mês. A tributação é orientada pelo contador.

## Pergunta: O rendimento já vem descontado de impostos?
## Resposta: Não: a projeção de cerca de 2% ao mês é antes dos impostos (Simples Nacional). A associação repassa a parte de cada cotista, e a tributação é orientada pelo contador.

## Pergunta: Quais são os custos mensais?
## Resposta: Os custos da usina — arrendamento da área, internet, água e energia do local e, a partir do 13º mês, manutenção e seguro — são descontados do repasse antes da divisão. Cada cota arca com 1/10.

## Pergunta: Quando começo a receber?
## Resposta: Cerca de 90 dias depois que a usina começa a gerar: 30 de geração, 30 de compensação e 30 de faturamento ao assinante. Depois, o repasse é mensal.

## Pergunta: E se o assinante não pagar?
## Resposta: O repasse acontece depois que os assinantes pagam. A B2W cobra os inadimplentes, e há fila de espera: quem sai é substituído em até 30 dias.

## Pergunta: E o Fio B? A rentabilidade cai?
## Resposta: O Fio B sobe até 2029, como prevê a Lei 14.300, e isso já está na projeção. A projeção ano a ano é apresentada pelo consultor.

## Pergunta: Como é o pagamento da cota?
## Resposta: Somente à vista.

## Pergunta: Posso vender minha cota?
## Resposta: Sim. A B2W ajuda a encontrar o comprador, e a associação transfere o título da cota ao novo cotista.

## Pergunta: A cota dá desconto na minha conta de luz?
## Resposta: Não: a cota é investimento. Para ter desconto, você faz uma adesão separada como assinante da Energia por Assinatura, com o imóvel na área da mesma distribuidora.

## Pergunta: Que garantias tenho?
## Resposta: As mesmas da usina: instalação, 12 meses (B2W); inversor, 5 anos; módulos, 12 anos contra defeito e 20 anos de garantia de performance.

## Pergunta: Quem é a B2W Energia? Posso visitar uma usina?
## Resposta: A B2W Energia é uma empresa mineira que opera há 8 anos no Rio Grande do Norte, estado de alto potencial energético. É especializada em usinas de investimento e acompanha o investidor de ponta a ponta, da prospecção da área à gestão dos assinantes que consomem a energia gerada. São mais de 1.000 usinas de varejo construídas e dezenas de usinas de investimento entregues. Você pode visitar uma usina em funcionamento e o nosso escritório no Rio Grande do Norte: recebemos você no aeroporto e levamos até usinas próximas.
`
