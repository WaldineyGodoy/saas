/**
 * FAQ do Agente Assinatura no DeskcommCRM
 * (spec docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md §4.1).
 * Em .ts porque a Edge Function so publica arquivo importado.
 * Numeros que mudam (desconto, tarifa, credito de indicacao) ficam na Fonte B,
 * gerada do CRM: aqui so regra.
 */
export const FAQ_ASSINATURA = `## Pergunta: Como funciona a energia por assinatura?
## Resposta: A B2W tem usinas solares ligadas à Associação de Usinas B2W Energia, no modelo de geração compartilhada da Lei 14.300. A energia gerada vira crédito na sua unidade consumidora, e você paga a energia compensada com desconto. Sem obra e sem instalar placas.

## Pergunta: Qual é o desconto?
## Resposta: É o percentual do plano vigente da sua distribuidora (veja "Assinatura: cobertura, desconto e indicação"). Vale sobre a energia compensada, com o Fio B incluído.

## Pergunta: O que fica sem desconto?
## Resposta: A iluminação pública e, quando o consumo não chega a cobri-lo, o custo mínimo da distribuidora: 30 kWh (monofásico), 50 kWh (bifásico) ou 100 kWh (trifásico).

## Pergunta: E a bandeira tarifária?
## Resposta: Na energia por assinatura a bandeira não é cobrada. Em bandeira amarela ou vermelha, a economia que você percebe na conta fica maior.

## Pergunta: Como é calculada a economia?
## Resposta: Consumo mensal × tarifa da distribuidora × percentual de desconto. É uma estimativa: o valor exato sai da sua conta de energia.

## Pergunta: Em quanto tempo começa o desconto?
## Resposta: Em 30 a 60 dias (1 a 2 ciclos). Podem vir até 2 contas proporcionais sem desconto: uma ainda no seu nome, até a troca de titularidade, e outra já no nome da Associação, enquanto a distribuidora processa a lista de rateio.

## Pergunta: Precisa ter vaga?
## Resposta: Sim. Com vaga numa usina que já gera, a adesão é imediata. Com vaga só numa usina em pré-operação, você assina agora e o desconto começa quando ela entrar em operação. Sem vaga, você entra na fila de espera e a equipe avisa quando abrir.

## Pergunta: A conta muda de nome?
## Resposta: Sim. A unidade consumidora passa para o nome da Associação, que representa você na distribuidora. O imóvel e o consumo continuam seus.

## Pergunta: Como eu pago?
## Resposta: Um único boleto ou PIX da B2W por mês, que já inclui o que é devido à distribuidora: a B2W quita a conta da concessionária. Ele chega por e-mail ou WhatsApp com 5 dias de antecedência, e a 2ª via sai pelo app.

## Pergunta: Qual o vencimento?
## Resposta: Todo dia 5.

## Pergunta: E se eu atrasar?
## Resposta: Aquela fatura sai pelo valor cheio, sem o desconto, com multa de 2%, juros de 1% ao mês e correção pelo IPCA. O desconto volta no ciclo seguinte. Com 30 dias de atraso a unidade sai do rateio; com 45, o débito pode ir a protesto; com 60, o contrato é rescindido.

## Pergunta: Tem fidelidade? Como cancelo?
## Resposta: Não há fidelidade nem multa. Para sair, avise com 90 dias ou 3 ciclos de compensação, o que vier por último.

## Pergunta: E se a usina gerar menos?
## Resposta: No ciclo sem compensação você paga o valor normal da distribuidora, sem desconto e sem nenhum custo extra.

## Pergunta: Vou mudar ou vender o imóvel. O que faço?
## Resposta: Avise a B2W com 30 dias de antecedência.

## Pergunta: Como faço a adesão?
## Resposta: Pelo link: CEP e consumo, documento com foto e a conta de energia de cada unidade; se for empresa, também o contrato social. A assinatura é eletrônica e o link vale 30 dias. Dá para aderir com várias unidades.

## Pergunta: Como funciona a indicação?
## Resposta: Depois de assinar você ganha link e QR code próprios. Cada indicado que assina gera um cashback mensal abatido na sua fatura (percentual e valor em "Assinatura: cobertura, desconto e indicação"), enquanto vocês dois estiverem ativos e em dia. O crédito abate primeiro a fatura mais próxima; o que sobrar no ciclo é descartado. A campanha vale para indicados atendidos pela mesma distribuidora (concessionária) que a sua.

## Pergunta: Posso indicar alguém de outro estado ou de outra distribuidora?
## Resposta: A campanha de indicação vale para adesões dentro da mesma distribuidora (concessionária) que atende a sua conta. Quem é atendido por outra distribuidora, por exemplo em outro estado, não gera cashback pelo seu link.

## Pergunta: Onde ficam as usinas? De qual usina vem a minha energia?
## Resposta: Temos algumas usinas próprias e também administramos usinas de investidores, espalhadas por diversos municípios do estado. Não dá para dizer de qual usina virá a sua energia: isso depende da taxa de ocupação das usinas, verificada no momento da adesão.

## Pergunta: É um investimento?
## Resposta: Não. O benefício é o desconto na conta. Para quem quer renda, a B2W tem as Usinas de Investimento.

## Pergunta: Quem é a B2W Energia? Posso visitar uma usina?
## Resposta: A B2W Energia é uma empresa mineira que opera há 8 anos no Rio Grande do Norte, estado de alto potencial energético. É especializada em usinas de investimento e acompanha o investidor de ponta a ponta, da prospecção da área à gestão dos assinantes que consomem a energia gerada. São mais de 1.000 usinas de varejo construídas e dezenas de usinas de investimento entregues. Você pode visitar uma usina em funcionamento e o nosso escritório no Rio Grande do Norte: recebemos você no aeroporto e levamos até usinas próximas.
`
