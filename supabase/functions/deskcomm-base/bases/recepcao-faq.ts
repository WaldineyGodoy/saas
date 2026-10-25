/**
 * FAQ da Bel (Recepção) no DeskcommCRM
 * (spec docs/superpowers/specs/2026-10-24-base-bel-recepcao-design.md §5.1).
 * Em .ts porque a Edge Function so publica arquivo importado.
 * So fatos: nada de percentual, preco, retorno nem lista de estados. O que muda
 * (anuncios) fica em "Recepção: entradas", gerado da tabela ponte_deskcomm.anuncios.
 * A primeira resposta e copia literal da de investidor-faq.ts.
 */
export const FAQ_RECEPCAO = `## Pergunta: Quem é a B2W Energia? Posso visitar uma usina?
## Resposta: A B2W Energia é uma empresa mineira que opera há 8 anos no Rio Grande do Norte, estado de alto potencial energético. É especializada em usinas de investimento e acompanha o investidor de ponta a ponta, da prospecção da área à gestão dos assinantes que consomem a energia gerada. São mais de 1.000 usinas de varejo construídas e dezenas de usinas de investimento entregues. Você pode visitar uma usina em funcionamento e o nosso escritório no Rio Grande do Norte: recebemos você no aeroporto e levamos até usinas próximas.

## Pergunta: A B2W é uma empresa de verdade? Como sei que não é golpe?
## Resposta: Faz bem em conferir! A B2W Energia fica em Parnamirim, no Rio Grande do Norte, e tem site (b2wenergia.com.br), WhatsApp comercial (31) 99536-7744, e-mail contato@b2wenergia.com.br e perfis no Instagram, Facebook e LinkedIn. O CNPJ consta no contrato. Se preferir, podemos agendar uma videochamada com o time comercial para você conhecer a equipe e tirar as dúvidas. Por aqui eu nunca peço senha nem dados bancários.

## Pergunta: Qual é o CNPJ da B2W?
## Resposta: O CNPJ consta no contrato. Se quiser conferir antes de seguir, agendamos uma videochamada com o time comercial.

## Pergunta: Onde fica a B2W? Qual é o endereço?
## Resposta: O endereço é Olavo Lacerda Montenegro, 467, Parque das Nações, Parnamirim, Rio Grande do Norte. Para visitar, combine antes com a equipe.

## Pergunta: Qual é o horário de atendimento?
## Resposta: A equipe atende das 9h às 17h, no horário de Brasília. Fora desse horário eu continuo por aqui e deixo tudo registrado para a equipe retornar.

## Pergunta: Quero falar com uma pessoa.
## Resposta: Claro! Eu chamo alguém da equipe, que atende das 9h às 17h. Se preferir ver quem é antes, também podemos agendar uma videochamada com o time comercial.

## Pergunta: Dá para fazer uma videochamada antes de decidir?
## Resposta: Dá, sim. Agendamos uma videochamada com o time comercial para você tirar as dúvidas. Me diga o melhor dia e horário, entre 9h e 17h, e eu passo para a equipe confirmar.

## Pergunta: Quais serviços a B2W oferece?
## Resposta: Temos Energia por Assinatura (desconto na conta de luz, sem obra e sem instalar placas), Usinas de Investimento (investir em uma usina solar para ter renda), Cotas (uma fração da geração de uma usina), Eletropostos (recarga de carro elétrico e parceria para ter um eletroposto, na rede VOLT), Áreas de Arrendamento (arrendar um terreno para usina solar), Gestora / Comercializadora (para donos de usina que querem fornecer energia à B2W) e Locação de Vagas (alugar ou oferecer vagas de estacionamento).

## Pergunta: Quero pagar menos na conta de luz. É com vocês?
## Resposta: É, sim! Isso é a Energia por Assinatura: desconto na conta de luz, sem obra e sem instalar placas. Atende pessoa física e empresa. Me conta de qual cidade e estado você é, que eu confiro se já chegou na sua região.

## Pergunta: Tenho uma empresa. Vocês atendem CNPJ?
## Resposta: Atendemos, sim. A Energia por Assinatura serve para pessoa física e para empresa. Me diz se é para a sua casa ou para a empresa, e de qual cidade e estado, para eu seguir com o atendimento certo.

## Pergunta: Tenho uma usina e quero vender energia para a B2W.
## Resposta: Isso é com a nossa área Gestora / Comercializadora, que atende donos de usina que querem fornecer energia para a B2W. Me conta onde fica a usina, cidade e estado, que eu sigo o atendimento.

## Pergunta: Quero investir. Qual a diferença entre usina e cotas?
## Resposta: Em Usinas de Investimento você investe em uma usina solar para ter renda. Em Cotas você compra uma fração da geração de uma usina. Me conta qual das duas combina mais com você que eu sigo daqui.

## Pergunta: Tenho um terreno. Vocês arrendam?
## Resposta: A B2W arrenda áreas para instalar usinas solares, e cada área passa por uma avaliação da equipe. Me conta a cidade e o estado do terreno para começarmos.

## Pergunta: Quero um carregador de carro elétrico ou uma vaga.
## Resposta: A B2W tem a rede de recarga VOLT para carro elétrico e faz parceria com quem quer ter um eletroposto no seu estabelecimento. Também temos locação de vagas de estacionamento: dá para alugar uma vaga ou oferecer as suas. Me conta o que você procura que eu direciono.

## Pergunta: Já sou cliente. Preciso de fatura, boleto, contrato, repasse ou ajuda com o aplicativo.
## Resposta: Entendi. Esse atendimento é com a equipe, então eu chamo uma pessoa para te ajudar. Ela atende das 9h às 17h, e fica registrado o que você precisa.

## Pergunta: A energia por assinatura já chega na minha cidade?
## Resposta: Eu confiro pela sua cidade e estado, porque a cobertura depende da distribuidora. Me diz onde você está?

## Pergunta: Vi um anúncio com desconto. Qual é o percentual?
## Resposta: O percentual depende da sua distribuidora e é confirmado na simulação com a sua conta de luz. Os anúncios falam em "até", e eu só confirmo um número depois de simular. Me conta cidade e estado para eu começar.

## Pergunta: O que acontece com os meus dados?
## Resposta: Seus dados são usados para o atendimento comercial da B2W. Se quiser pedir acesso, correção ou exclusão, fale com a equipe pelo e-mail contato@b2wenergia.com.br.
`
