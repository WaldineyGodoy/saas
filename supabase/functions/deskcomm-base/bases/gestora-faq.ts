/**
 * FAQ da Helena (Gestora / Comercializadora) no DeskcommCRM
 * (spec docs/superpowers/specs/2026-10-25-base-helena-gestora-design.md §5.1).
 * Em .ts porque a Edge Function so publica arquivo importado.
 * So mecanismo e regras: NENHUM numero aqui. Percentuais, dia de repasse, setup, carencia e
 * prazo vem do documento "Gestora: planos vigentes", gerado do plano de usina do CRM, para
 * nao ficarem desatualizados quando o plano mudar.
 */
export const FAQ_GESTORA = `## Pergunta: Como funciona a parceria com a B2W para quem tem usina?
## Resposta: A B2W gerencia a usina em nome do dono. Cuidamos da operação, do rateio da energia e da cobrança dos assinantes, e repassamos o resultado ao dono da usina. A B2W não compra nem aluga a energia: o dono continua sendo o dono da usina.

## Pergunta: Que tipo de usina a B2W aceita?
## Resposta: Usinas solares, de qualquer potência. A usina precisa estar operando ou em construção com prazo de entrega definido. Outras fontes (eólica, hídrica, biomassa) a B2W não atende.

## Pergunta: Minha usina ainda está só no projeto, no papel. Como fica?
## Resposta: Para usina que ainda está no papel, a B2W tem outro caminho: a área de Usinas de Investimento, com uma proposta especial para construir a usina. Posso te apresentar ao Leo, que cuida dessa área, se você quiser.

## Pergunta: Minha usina está em construção. Dá para entrar?
## Resposta: Dá, desde que haja um prazo de entrega. Me conta a previsão de conclusão e a cidade e o estado da obra que eu sigo com o atendimento.

## Pergunta: Como o dono recebe? Sobre qual energia é o repasse?
## Resposta: O repasse é sobre a energia compensada, e não sobre a injetada. Energia injetada é a que a usina envia para a rede da distribuidora. Energia compensada é a que de fato abate a conta de luz dos assinantes. São grandezas diferentes: o dono recebe pelos kWh compensados.

## Pergunta: Qual é o valor que o dono recebe por kWh compensado?
## Resposta: É a tarifa líquida do gerador: a tarifa da concessionária, menos o desconto dado ao assinante, menos o Fio B, menos a taxa de gestão. Os percentuais do plano vigente estão no documento "Gestora: planos vigentes". O valor exato para a sua usina é confirmado pelo especialista.

## Pergunta: O que é o Fio B?
## Resposta: É a parcela da tarifa de uso do sistema de distribuição que a distribuidora cobra sobre a energia compensada de geração distribuída. Ela é descontada no cálculo do repasse e muda conforme as regras do setor elétrico. O valor aplicável à sua usina é confirmado pelo especialista.

## Pergunta: Quando o dono recebe o repasse?
## Resposta: O repasse é mensal, em dia fixo definido no plano. O dia do repasse e o dia de corte estão no documento "Gestora: planos vigentes".

## Pergunta: Há custo de setup, carência ou prazo para começar a receber?
## Resposta: Sim, é importante saber antes de seguir. Há custo de setup, uma carência antes de os repasses começarem e um prazo até o primeiro repasse. Os valores vigentes estão no documento "Gestora: planos vigentes"; o que ainda não estiver definido ali, o especialista confirma. Eu nunca estimo esses valores.

## Pergunta: Qual é a taxa de gestão e o desconto do assinante?
## Resposta: Os percentuais do plano vigente estão no documento "Gestora: planos vigentes". Sempre vale lembrar que o especialista confirma o plano e o valor aplicáveis à sua usina.

## Pergunta: Quero desconto na minha conta de luz. Isso é aqui?
## Resposta: Esse atendimento é outro: Energia por Assinatura, para quem quer pagar menos na conta de luz, em casa ou na empresa. A Helena atende donos de usina que querem gerenciar a geração com a B2W. Posso te encaminhar para o atendimento certo.

## Pergunta: Qual é o próximo passo?
## Resposta: Eu colho os dados básicos da usina (responsável, empresa e CNPJ, cidade e estado, distribuidora, potência, situação e contato) e passo para o especialista, que conversa sobre o plano e as condições.

## Pergunta: Quais dados preciso ter em mãos?
## Resposta: O CNPJ da empresa dona da usina, a cidade e o estado da usina, a distribuidora a que está ligada, a potência instalada e a situação (operando, ou em construção com o prazo de entrega). O especialista pode pedir documentos depois.

## Pergunta: Posso vender a energia para a B2W a um preço fixo?
## Resposta: O modelo da B2W não é de compra de energia: é de gestão da usina, com repasse por kWh compensado. Condições comerciais específicas são conversadas com o especialista.
`
