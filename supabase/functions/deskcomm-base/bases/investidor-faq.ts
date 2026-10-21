/**
 * FAQ do Agente Investidor (spec 2026-10-19-base-agente-investidor-design.md §4.1),
 * no formato "## Pergunta:" / "## Resposta:" que a tela do Deskcomm aceita.
 * Fica em .ts porque a Edge Function so empacota arquivos importados.
 * Mudar o FAQ = editar aqui e publicar a deskcomm-base de novo.
 */
export const FAQ_INVESTIDOR = `## Pergunta: Como funciona o investimento em usina solar com a B2W Energia?
## Resposta: Você compra uma usina solar de cerca de 100 kWp com inversor de 75 kW. Esse porte fica no limite da microgeração e por isso a usina não paga demanda contratada. Ela é GD2, de autoconsumo remoto, e aluga os equipamentos a uma associação, estrutura prevista na Lei 14.300, que permite a locação de equipamentos a associações, cooperativas e consórcios. Os assinantes da associação consomem a energia com desconto na conta de luz, e você recebe o repasse mensal.

## Pergunta: Quanto custa uma usina de investimento?
## Resposta: A partir de R$ 290.000. O valor depende do estágio da obra e da previsão de entrega: quanto antes você entra, menor o preço. Também é possível comprar cotas de uma usina, pelo preço da usina dividido por 10, mais 10%.

## Pergunta: Qual é o retorno do investimento? Quanto rende por mês?
## Resposta: A projeção é de cerca de 2% ao mês, antes do Simples Nacional. É uma projeção, não garantia: varia com a geração anual da usina, a tarifa da concessionária e o estágio da obra no momento do aporte. Payback e rentabilidade detalhada são apresentados pelo consultor em uma reunião.

## Pergunta: De onde vem a receita do investidor?
## Resposta: A receita é lastreada na tarifa da concessionária. A conta é a geração da usina multiplicada pela tarifa de energia; desse valor saem o desconto oferecido ao assinante, o Fio B e a gestão da B2W (10% para usinas construídas pela B2W). O que sobra é a tarifa do investidor, que é a fonte da receita e da rentabilidade.

## Pergunta: E se o assinante não pagar a conta?
## Resposta: O repasse ao investidor acontece depois que os assinantes pagam, ao fim de cada ciclo. A cobrança dos inadimplentes é feita pela B2W. A usina entra em operação com a geração distribuída entre assinantes com crédito aprovado, e existe fila de espera: quando um assinante sai, outro é colocado no lugar em até 30 dias.

## Pergunta: Quais são os custos mensais da usina?
## Resposta: No primeiro ano, seguro e manutenção estão inclusos. O custo fixo da usina (arrendamento da área, internet, água e energia do local) fica em torno de R$ 866 por mês e é descontado do repasse. A partir do 13º mês entram a manutenção, de R$ 300 por mês, e o seguro, de R$ 2.500 por ano, também descontados do repasse. Esses valores são da usina de referência e podem variar de uma usina para outra.

## Pergunta: Posso vender a usina depois? Como saio do investimento?
## Resposta: Sim. A usina é um ativo seu e pode ser vendida. A B2W ajuda a encontrar o comprador, e os contratos de gestão e de arrendamento são transferidos ao novo dono.

## Pergunta: Não tenho o valor de uma usina inteira. Dá para comprar só uma parte?
## Resposta: Sim, por cotas: o preço da usina dividido por 10, mais 10% de taxa, que cobre a estruturação jurídica da associação e a gestão da divisão do repasse. Os valores por usina estão em "Usinas com cotas". Um consultor de cotas continua o atendimento com você.

## Pergunta: Como é o pagamento? Dá para parcelar ou financiar?
## Resposta: O pagamento pode ser parcelado, e o número de aportes depende do estágio da obra. Aceitamos financiamento bancário para usinas na fase de obras civis ou anterior, porque as notas fiscais dos equipamentos precisam sair em nome do investidor. Quanto antes você entra, menor o preço e maior a facilidade de pagamento.

## Pergunta: Quando começo a receber?
## Resposta: Em média 90 dias depois que a usina começa a gerar: 30 dias de geração, 30 de compensação dos créditos e 30 para o faturamento ao assinante. Depois disso, o repasse é mensal. Pelo app do investidor você acompanha o cronograma da obra antes da geração, a geração depois da conexão e, com a usina gerando, o extrato de recebíveis.

## Pergunta: E o Fio B? A rentabilidade cai com o tempo?
## Resposta: O Fio B sobe gradualmente até 2029, como prevê a Lei 14.300, e isso já está considerado na projeção. O reajuste anual da tarifa de energia neutraliza parte desse impacto. A projeção ano a ano é apresentada pelo consultor.

## Pergunta: Como fica o imposto? Posso investir como pessoa física?
## Resposta: O repasse é feito sempre para uma empresa. Ao adquirir a usina, constituímos uma SPE ou um MEI, conforme o caso e com a orientação do contador, e os honorários do contador para a abertura ficam por conta da B2W. A tributação é pelo Simples Nacional.

## Pergunta: De quem é o terreno da usina?
## Resposta: A usina fica em uma área arrendada, com contrato de arrendamento em nome do investidor, e o valor do arrendamento é descontado do repasse. Em algumas usinas é possível comprar a área, mas nem toda área está disponível para venda: é caso a caso, e o consultor confirma para a usina que você escolher.

## Pergunta: Que garantias tenho dos equipamentos e da obra?
## Resposta: A instalação tem 12 meses de garantia da B2W. O inversor tem 5 anos de garantia. Os módulos têm 12 anos de garantia contra defeito e 20 anos de garantia de performance (degradação).

## Pergunta: Quem é a B2W Energia? Posso visitar uma usina?
## Resposta: A B2W Energia é uma empresa mineira que opera há 8 anos no Rio Grande do Norte, estado de alto potencial energético. É especializada em usinas de investimento e acompanha o investidor de ponta a ponta, da prospecção da área à gestão dos assinantes que consomem a energia gerada. São mais de 1.000 usinas de varejo construídas e dezenas de usinas de investimento entregues. Você pode visitar uma usina em funcionamento e o nosso escritório no Rio Grande do Norte: recebemos você no aeroporto e levamos até usinas próximas.
`
