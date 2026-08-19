import { dataPorExtenso, gerarPdfBase64, paginarTexto, porExtenso } from './contratoBase';

/**
 * Termo de adesão do assinante — fonte única.
 *
 * Vivia dentro do SubscriberModal e só podia ser gerado por um admin
 * clicando num botão. A adesão pública agora gera o mesmo documento
 * sozinha, então o texto e o layout passaram a morar aqui: dois
 * geradores com dois contratos diferentes é o tipo de divergência que
 * ninguém percebe até um cliente assinar a versão errada.
 *
 * Versão 3.0 (19/08/2026) — consolidação jurídica. Mudanças que alteram
 * o que a Associação pode cobrar, e por isso não podem ser desfeitas sem
 * revisar o contrato do fornecedor junto:
 *
 *  - O foro aparecia duas vezes, com comarcas diferentes (Teófilo Otoni
 *    numa cláusula, domicílio do associado na outra). Ficou só o
 *    domicílio, que é o que o CDC impõe de qualquer forma.
 *  - LGPD também estava duplicada, em duas cláusulas distintas.
 *  - Não havia vencimento, meio de pagamento, multa nem juros: a régua
 *    de cobrança contava prazos a partir de um marco que o contrato não
 *    definia, e não havia base para cobrar encargo de quem atrasasse.
 *  - O desconto virou benefício por pontualidade sobre o valor cheio, em
 *    vez de "suspensão do desconto" por atraso de até 14 dias — que era
 *    penalidade de ~20% e cairia como multa disfarçada.
 *  - Realocação não está mais limitada ao "mesmo grupo econômico": as
 *    usinas são de proprietários distintos, e a redação antiga travava
 *    justamente o remanejamento dos 90 dias de saída de um fornecedor.
 */

export const DESCONTO_PADRAO = 20;
export const DIA_VENCIMENTO_PADRAO = 10;

const enderecoCompleto = (s) =>
    `${s?.rua || ''}, ${s?.numero || ''} ${s?.complemento || ''} - ${s?.bairro || ''}, ${s?.cidade || ''}/${s?.uf || ''}`;

/**
 * Rótulo da distribuidora usado no corpo do termo.
 *
 * As cláusulas 1, 9 e 17 tinham "COSERN" escrito na mão: todo assinante
 * de outra concessionária assinava um contrato citando a distribuidora
 * errada. Agora vem da UC. Sem UC identificada, o texto fica genérico —
 * um termo vago é ruim, mas um termo com o nome errado é pior.
 */
const rotuloDistribuidora = (distribuidora) =>
    (distribuidora || '').trim() || 'sua distribuidora local';

/**
 * Monta o corpo do termo a partir dos dados do assinante.
 *
 * @param subscriber    dados cadastrais do associado
 * @param distribuidora concessionária da UC (`consumer_units.concessionaria`)
 * @param opts.desconto        percentual da UC (`consumer_units.desconto_assinante`)
 * @param opts.diaVencimento   dia do boleto (UC ou `subscribers.consolidated_due_day`)
 */
export const montarTextoContrato = (subscriber, distribuidora, opts = {}) => {
    const fullAddress = enderecoCompleto(subscriber);
    const DIST = rotuloDistribuidora(distribuidora);

    const desconto = Number(opts.desconto) > 0 ? Number(opts.desconto) : DESCONTO_PADRAO;
    const diaVencimento = Number(opts.diaVencimento) > 0 ? Number(opts.diaVencimento) : DIA_VENCIMENTO_PADRAO;
    const cidadeUf = `${subscriber?.cidade || 'Natal'}/${subscriber?.uf || 'RN'}`;

    return `TERMO DE INGRESSO E ADESÃO À ASSOCIAÇÃO DE GERAÇÃO COMPARTILHADA

(I). ASSOCIAÇÃO: ASSOCIAÇÃO DE USINAS B2W ENERGIA, associação de direito privado, CNPJ 64.561.352/0001-07, com sede na Praça Apolinário Barbosa, 86 – Centro, Caraí/MG, CEP 39800-000, neste ato representada na forma do seu Estatuto Social por seu presidente ("ASSOCIAÇÃO");

(II). ASSOCIADO: ${subscriber?.name || ''}, CPF/CNPJ ${subscriber?.cpf_cnpj || ''}, residente e domiciliado à ${fullAddress} ("ASSOCIADO").

CLÁUSULA 1 – DO OBJETO
O presente Termo tem por objeto o ingresso do ASSOCIADO na ASSOCIAÇÃO DE USINAS B2W ENERGIA, para participação no modelo de geração compartilhada, com compensação de créditos de energia elétrica no Sistema de Compensação de Energia Elétrica (SCEE), nos termos da Lei nº 14.300/2022 e das normas da ANEEL, junto à distribuidora ${DIST}.

CLÁUSULA 2 – DA NATUREZA DA OPERAÇÃO
O ASSOCIADO declara ciência de que não há venda direta de energia elétrica, mas sim compensação de créditos de energia gerados por centrais geradoras vinculadas à ASSOCIAÇÃO, utilizados para abatimento parcial do consumo da unidade consumidora indicada.

CLÁUSULA 3 – DO INGRESSO E ELEGIBILIDADE
O ingresso está condicionado à análise técnica, cadastral e regulatória da unidade consumidora, incluindo classe tarifária, histórico de consumo e aceite da distribuidora. A compensação somente se iniciará após a confirmação formal de elegibilidade.

CLÁUSULA 4 – DA EXCLUSIVIDADE REGULATÓRIA
Durante a vigência deste Termo, o ASSOCIADO compromete-se a não participar simultaneamente de outra associação, cooperativa ou consórcio de geração compartilhada para a mesma unidade consumidora, por exigência regulatória.

CLÁUSULA 5 – DA CONTRIBUIÇÃO ASSOCIATIVA
5.1. O ASSOCIADO pagará contribuição mensal proporcional à quantidade de energia efetivamente compensada em sua unidade consumidora no ciclo, destinada à manutenção, operação e gestão da geração compartilhada.
5.2. O valor cheio da contribuição corresponde ao montante que o ASSOCIADO pagaria à distribuidora pela mesma energia, considerando todas as componentes da Tarifa de Aplicação e os tributos incidentes, sem qualquer abatimento.
5.3. Não havendo compensação no ciclo, nada será cobrado no período.

CLÁUSULA 6 – DO DESCONTO POR PAGAMENTO PONTUAL
6.1. A ASSOCIAÇÃO concede ao ASSOCIADO desconto de ${desconto}% (${porExtenso(desconto)} por cento) sobre o valor cheio da contribuição definido na Cláusula 5.2, condicionado ao pagamento até a data de vencimento.
6.2. O desconto constitui benefício concedido pela pontualidade, e não redução do preço contratado. Efetuado o pagamento após o vencimento, é devido o valor cheio da contribuição, equivalente à tarifa da distribuidora sem abatimento, sem que isso configure penalidade, multa ou sanção.
6.3. O boleto ou instrumento de cobrança indicará, de forma destacada, o valor cheio, o valor com desconto e a data limite para fruição do desconto, na forma do art. 46 do Código de Defesa do Consumidor.
6.4. O desconto é restabelecido automaticamente no ciclo seguinte à regularização, sem necessidade de requerimento.

CLÁUSULA 7 – DO FATURAMENTO E DO PAGAMENTO
7.1. A contribuição será cobrada mensalmente mediante boleto bancário ou PIX emitido pela ASSOCIAÇÃO, disponibilizado por meio eletrônico com antecedência mínima de 5 (cinco) dias da data de vencimento.
7.2. O vencimento ocorrerá todo dia ${diaVencimento} de cada mês, referente ao ciclo de compensação imediatamente anterior.
7.3. O não recebimento do boleto não exime o ASSOCIADO do pagamento, cabendo-lhe solicitar a 2ª via pelos canais de atendimento da ASSOCIAÇÃO até a data de vencimento.
7.4. O ASSOCIADO autoriza expressamente o envio de faturas, avisos de vencimento, demonstrativos e comunicações de cobrança por e-mail, SMS e WhatsApp, nos contatos por ele informados, obrigando-se a mantê-los atualizados.

CLÁUSULA 8 – DA BASE DE CÁLCULO E DOS ENCARGOS NÃO COMPENSÁVEIS
8.1. O desconto incide exclusivamente sobre as componentes tarifárias efetivamente compensadas no ciclo, conforme apurado na fatura emitida pela distribuidora, documento que prevalece sobre qualquer outro relatório, portal ou estimativa em caso de divergência.
8.2. O ASSOCIADO declara ciência expressa de que permanecem integralmente devidos à distribuidora, sem qualquer desconto: (i) o custo de disponibilidade / consumo mínimo da unidade consumidora, conforme a classe de ligação; (ii) a parcela da TUSD Fio B não compensável, na forma da Lei nº 14.300/2022; (iii) a contribuição de iluminação pública; (iv) bandeiras tarifárias, multas, juros e demais encargos de responsabilidade do titular da unidade consumidora.
8.3. Integra este Termo, como Anexo I – Exemplo de Cálculo, demonstração numérica ilustrativa da apuração do desconto, de caráter exemplificativo e não vinculante quanto a valores.

CLÁUSULA 9 – DA TRANSPARÊNCIA E DEMONSTRATIVO DE CÁLCULO
A ASSOCIAÇÃO disponibilizará mensalmente demonstrativo, através do seu aplicativo ou portal do cliente, contendo:
(i) consumo total do período;
(ii) energia compensada em kWh;
(iii) valores cobrados pela ${DIST};
(iv) base de cálculo do desconto; e
(v) economia obtida, enviado por meio eletrônico.

CLÁUSULA 10 – DA MORA E DA INADIMPLÊNCIA
10.1. O pagamento após o vencimento sujeita o ASSOCIADO, além da perda do desconto prevista na Cláusula 6, a multa moratória de 2% (dois por cento), juros de mora de 1% (um por cento) ao mês, pro rata die, e correção monetária pelo IPCA/IBGE.
10.2. Persistindo o inadimplemento, aplicam-se, mediante comunicação prévia:
(a) a partir de 30 (trinta) dias, protocolo do pedido de exclusão da unidade consumidora do rateio junto à distribuidora, produzindo efeitos no primeiro ciclo subsequente ao processamento pela distribuidora, o que o ASSOCIADO expressamente reconhece não estar sob controle da ASSOCIAÇÃO;
(b) a partir de 45 (quarenta e cinco) dias, inscrição do débito em órgãos de proteção ao crédito e protesto do título, mediante notificação prévia na forma da lei;
(c) a partir de 60 (sessenta) dias, rescisão do presente Termo e adoção das medidas judiciais cabíveis.
10.3. A energia efetivamente compensada na unidade consumidora até a exclusão do rateio permanece integralmente devida, ainda que a rescisão já tenha ocorrido.
10.4. As despesas de cobrança extrajudicial e judicial, incluindo custas, emolumentos e honorários advocatícios, correrão por conta do ASSOCIADO inadimplente, na forma do art. 395 do Código Civil.

CLÁUSULA 11 – DO PRAZO
O presente Termo vige por prazo indeterminado, iniciando-se na data de confirmação da compensação pela distribuidora.

CLÁUSULA 12 – DA RESCISÃO PELO ASSOCIADO
O ASSOCIADO poderá solicitar desligamento mediante aviso prévio mínimo de 90 (noventa) dias ou 3 (três) ciclos de compensação, o que ocorrer por último, sem multa rescisória.

CLÁUSULA 13 – DA RESCISÃO PELA ASSOCIAÇÃO
A ASSOCIAÇÃO poderá rescindir o Termo em caso de descumprimento contratual, inviabilidade regulatória ou operacional, mediante comunicação prévia, ressalvadas hipóteses de urgência.

CLÁUSULA 14 – DA REVISÃO DO PERCENTUAL DE DESCONTO
14.1. Alteração legal, regulatória ou tributária que modifique de forma relevante a economicidade do arranjo — notadamente a incidência escalonada da TUSD Fio B, mudança de enquadramento GD I / GD II ou alteração no tratamento tributário da compensação — autoriza a ASSOCIAÇÃO a propor a revisão do percentual de desconto, mediante comunicação com 60 (sessenta) dias de antecedência.
14.2. Discordando da revisão, o ASSOCIADO poderá rescindir este Termo sem qualquer ônus, multa ou aviso prévio, bastando manifestação até a data de entrada em vigor da alteração. O silêncio implica aceitação.

CLÁUSULA 15 – DA REALOCAÇÃO OPERACIONAL
A ASSOCIAÇÃO poderá realocar o ASSOCIADO entre quaisquer centrais geradoras a ela vinculadas, próprias ou de terceiros, desde que mantidas as condições comerciais, mediante comunicação prévia.

CLÁUSULA 16 – DA UNIDADE CONSUMIDORA E DA TITULARIDADE
16.1. O ASSOCIADO declara ser o titular da unidade consumidora indicada perante a distribuidora, ou estar por ela regularmente autorizado.
16.2. O ASSOCIADO obriga-se a comunicar à ASSOCIAÇÃO, com antecedência mínima de 30 (trinta) dias, qualquer alteração de titularidade, desocupação do imóvel, pedido de desligamento ou mudança de classe tarifária da unidade consumidora.
16.3. A ausência de comunicação torna o ASSOCIADO responsável pelos valores correspondentes à energia compensada até a efetiva exclusão do rateio.

CLÁUSULA 17 – DA REPRESENTAÇÃO OPERACIONAL
O ASSOCIADO autoriza a ASSOCIAÇÃO a representá-lo junto à ${DIST} exclusivamente para fins operacionais relacionados ao SCEE, durante a vigência deste Termo, vedado qualquer uso diverso.

CLÁUSULA 18 – DA AUSÊNCIA DE INVESTIMENTO
O ASSOCIADO declara ciência de que não realiza qualquer investimento financeiro em usinas ou ativos, inexistindo expectativa de retorno financeiro além do desconto na fatura.

CLÁUSULA 19 – DOS LIMITES DA OBRIGAÇÃO DA ASSOCIAÇÃO
19.1. A ASSOCIAÇÃO não garante volume, percentual ou continuidade de compensação, obrigando-se apenas a alocar ao ASSOCIADO participação no rateio da energia efetivamente gerada e injetada pelas centrais geradoras a ela vinculadas.
19.2. A ASSOCIAÇÃO não responde por redução, interrupção ou cessação de geração decorrente de manutenção, sinistro, caso fortuito, força maior, restrição operativa da distribuidora ou desligamento de central geradora, hipóteses em que não haverá compensação e, consequentemente, não haverá contribuição devida no período.
19.3. Ocorrendo redução relevante e duradoura da geração disponível, a ASSOCIAÇÃO envidará melhores esforços para realocar o ASSOCIADO na forma da Cláusula 15, não sendo devida indenização pelo período sem compensação.
19.4. A ASSOCIAÇÃO não se responsabiliza por alterações tarifárias, regulatórias ou tributárias impostas por órgãos competentes, nem por falhas da distribuidora.

CLÁUSULA 20 – DA PROTEÇÃO DE DADOS
Os dados pessoais serão tratados conforme a Lei nº 13.709/2018 (LGPD), para as finalidades de execução deste Termo, faturamento, cobrança extrajudicial e judicial, prevenção à fraude, cumprimento de obrigações legais e regulatórias e representação junto à distribuidora, sendo autorizado o compartilhamento com a central geradora à qual o ASSOCIADO estiver rateado, com prestadores de serviço de pagamento e cobrança e com órgãos de proteção ao crédito, observados os arts. 7º, V, e 10 da LGPD.

CLÁUSULA 21 – DA ASSINATURA ELETRÔNICA
As Partes reconhecem a validade da assinatura eletrônica deste Termo, nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020, aceitando como prova hábil os registros de auditoria da plataforma utilizada, incluindo data, hora, IP e endereço eletrônico de aceite.

CLÁUSULA 22 – DO FORO
Fica eleito o foro do domicílio do ASSOCIADO, com renúncia a qualquer outro, por mais privilegiado que seja.

ANEXO I – EXEMPLO DE CÁLCULO
Exemplo ilustrativo, considerando desconto de ${desconto}% e energia compensada de 500 kWh a uma Tarifa de Aplicação de R$ 1,00/kWh com tributos:
- Valor cheio da contribuição (Cláusula 5.2): R$ 500,00
- Desconto por pagamento até o vencimento (${desconto}%): R$ ${(500 * desconto / 100).toFixed(2).replace('.', ',')}
- Valor a pagar até o dia ${diaVencimento}: R$ ${(500 - 500 * desconto / 100).toFixed(2).replace('.', ',')}
- Valor a pagar após o vencimento: R$ 500,00, acrescido de multa de 2% e juros de 1% ao mês
Permanecem devidos diretamente à distribuidora, sem desconto: custo de disponibilidade, TUSD Fio B não compensável, iluminação pública e bandeiras tarifárias.

E, por estarem de acordo, as partes aderem eletronicamente ao presente Termo.

${cidadeUf}, ${dataPorExtenso()}.

________________________________________
ASSOCIAÇÃO DE USINAS B2W ENERGIA
Presidente

________________________________________
Nome do associado : ${subscriber?.name || ''}
CNPJ/CPF : ${subscriber?.cpf_cnpj || ''}
Associado`;
};

/** Quebra o termo em folhas A4 respeitando o início de cada cláusula. */
export const dividirEmPaginas = (texto) => paginarTexto(texto);

/**
 * Captura as páginas montadas e devolve o PDF em base64.
 * Lança se nenhuma página estiver no DOM — sem isso o Autentique recebia
 * um documento vazio e ninguém percebia até o cliente abrir o link.
 */
export const gerarPdfContratoBase64 = () => gerarPdfBase64('[data-contract="adesao"]');
