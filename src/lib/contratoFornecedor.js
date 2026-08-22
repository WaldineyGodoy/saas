import { dataPorExtenso, gerarPdfBase64, moeda, numeroBr, paginarTexto, paraNumero, percentualExtenso } from './contratoBase';

/**
 * Contrato de Administração e Gestão de Créditos Energéticos — o
 * instrumento firmado com o proprietário da usina.
 *
 * Espelha o gerador do assinante (src/lib/contrato.js) de propósito: são
 * dois lados do mesmo negócio e as cláusulas conversam entre si. Três
 * pares não podem ser alterados isoladamente, sob pena de a Associação
 * assumir um risco que este contrato acabou de atribuir ao proprietário:
 *
 *  - Cláusula 6 daqui (risco de crédito é do CONTRATANTE) só se sustenta
 *    porque a Cláusula 19 do termo do assinante não promete volume de
 *    compensação.
 *  - Cláusula 7.5 daqui (diferencial de desconto vai para o CONTRATANTE)
 *    depende da Cláusula 6 do termo, que trata o desconto como benefício
 *    por pontualidade sobre o valor cheio.
 *  - Cláusula 13.2 daqui (90 dias para transferir os consumidores) só é
 *    executável porque a Cláusula 15 do termo permite realocar o
 *    associado entre usinas de proprietários distintos.
 */

export const DEFAULTS_FORNECEDOR = {
    desconto: 20,
    percentualRecorrente: 10,
    taxaAdmin: 10,
    diaCorte: 5,
    diaRepasse: 15,
    taxaRecuperacao: 8,
    // Prazos pós-rescisão da Cláusula 13.2. Eram texto fixo; viraram campo
    // porque entram em negociação contrato a contrato.
    prazoTransferencia: 90,
    prazoHonorarios: 180,
    foro: 'Caraí/MG'
};

const enderecoSupplier = (s) => {
    const a = s?.address || {};
    const rua = a.logradouro || a.rua || '';
    const cidade = a.municipio || a.cidade || '';
    return `${rua}, ${a.numero || ''} ${a.complemento || ''} - ${a.bairro || ''}, ${cidade}/${a.uf || ''}, CEP ${a.cep || ''}`;
};

/** Anexo II: uma linha por usina vinculada ao fornecedor. */
const tabelaUsinas = (usinas = []) => {
    if (!usinas.length) {
        return 'Nenhuma central geradora vinculada no momento da emissão deste Contrato. A inclusão de centrais far-se-á por aditivo ou por registro no sistema de gestão da GESTORA.';
    }
    return usinas.map((u, i) => {
        const a = u.address || {};
        const local = `${a.municipio || a.cidade || ''}/${a.uf || ''}`;
        return `${i + 1}. ${u.name || 'Central geradora'} — UC geradora ${u.unidade_geradora || 'a informar'} — ${u.potencia_kwp || 'a informar'} kWp — ${u.concessionaria || 'distribuidora a informar'} — ${local} — modalidade ${u.modalidade_gd || 'a informar'}`;
    }).join('\n');
};

/**
 * Monta o corpo do contrato do fornecedor.
 *
 * @param supplier  registro de `suppliers`
 * @param usinas    centrais geradoras vinculadas (`usinas`)
 * @param opts      condições comerciais; o que não vier usa DEFAULTS_FORNECEDOR
 */
export const montarTextoContratoFornecedor = (supplier, usinas = [], opts = {}) => {
    const p = { ...DEFAULTS_FORNECEDOR, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && v !== null && v !== '')) };

    // Campo vazio ou ilegível cai no padrão, em vez de imprimir NaN no
    // contrato. "17," no meio da digitação já vale 17.
    const numero = (valor, padrao) => {
        const n = paraNumero(valor);
        return Number.isFinite(n) ? n : padrao;
    };

    const desconto = numero(p.desconto, DEFAULTS_FORNECEDOR.desconto);
    const recorrente = numero(p.percentualRecorrente, DEFAULTS_FORNECEDOR.percentualRecorrente);
    const taxaAdmin = numero(p.taxaAdmin, DEFAULTS_FORNECEDOR.taxaAdmin);
    const recuperacao = numero(p.taxaRecuperacao, DEFAULTS_FORNECEDOR.taxaRecuperacao);
    const diaCorte = numero(p.diaCorte, DEFAULTS_FORNECEDOR.diaCorte);
    const diaRepasse = numero(p.diaRepasse, DEFAULTS_FORNECEDOR.diaRepasse);
    const prazoTransferencia = numero(p.prazoTransferencia, DEFAULTS_FORNECEDOR.prazoTransferencia);
    const prazoHonorarios = numero(p.prazoHonorarios, DEFAULTS_FORNECEDOR.prazoHonorarios);

    // A Cláusula 7.2.1 afirma que a fatura recuperada rende mais ao
    // CONTRATANTE do que a paga em dia. Isso é verdade enquanto o desconto
    // perdido pelo consumidor superar a taxa de recuperação, líquida da
    // recorrente — com 20% e 10% sobra folga, mas num desconto de 5% a
    // frase viraria uma declaração falsa dentro do contrato. Por isso é
    // calculada, não escrita à mão.
    const recuperadaRendeMais = desconto * (1 - recorrente / 100) >= recuperacao;
    const comparativoRecuperacao = recuperadaRendeMais
        ? ' Cumulada com a Remuneração Recorrente, o CONTRATANTE ainda assim recebe, na fatura recuperada, montante superior ao que receberia caso a mesma fatura tivesse sido paga pontualmente.'
        : '';

    const a = supplier?.address || {};
    const cidadeUf = `${a.municipio || a.cidade || 'Natal'}/${a.uf || 'RN'}`;
    const distribuidora = usinas[0]?.concessionaria || 'a distribuidora local';

    return `CONTRATO DE ADMINISTRAÇÃO E GESTÃO DE CRÉDITOS ENERGÉTICOS

(I). GESTORA: ASSOCIAÇÃO DE USINAS B2W ENERGIA, associação de direito privado, CNPJ 64.561.352/0001-07, com sede na Praça Apolinário Barbosa, 86 – Centro, Caraí/MG, CEP 39800-000, neste ato representada na forma do seu Estatuto Social por seu presidente ("GESTORA");

(II). CONTRATANTE: ${supplier?.name || ''}, CNPJ/CPF ${supplier?.cnpj || ''}, com sede/endereço em ${enderecoSupplier(supplier)}, neste ato representada por ${supplier?.legal_partner_name || '_______________'}, CPF ${supplier?.legal_partner_cpf || '_______________'}, proprietária da(s) central(is) geradora(s) descrita(s) no Anexo II ("CONTRATANTE").

CAPÍTULO I — DO OBJETO E DA NATUREZA

CLÁUSULA 1 – DO OBJETO
Constitui objeto deste Contrato a prestação, pela GESTORA, dos serviços de administração e gestão dos créditos de energia elétrica gerados pela(s) central(is) geradora(s) do CONTRATANTE, compreendendo: gestão do rateio, faturamento e emissão de cobrança aos consumidores, arrecadação, cobrança de inadimplentes, repasse dos valores recebidos e representação junto à distribuidora.

CLÁUSULA 2 – DA NATUREZA DA CONTRATAÇÃO E DA AUSÊNCIA DE GARANTIA
2.1. A GESTORA atua exclusivamente como gestora administrativa e intermediadora de pagamentos, na qualidade de mandatária, em nome e por conta do CONTRATANTE, nos termos dos arts. 653 e seguintes do Código Civil.
2.2. As obrigações da GESTORA relativas a faturamento, arrecadação, cobrança e repasse constituem obrigações de meio, e não de resultado. A GESTORA obriga-se a empregar diligência e os procedimentos previstos neste Contrato, sem garantir o resultado do recebimento.
2.3. A GESTORA não é, e em nenhuma hipótese poderá ser considerada, avalista, fiadora, garantidora, devedora solidária, coobrigada ou seguradora das obrigações assumidas pelos CONSUMIDORES, não respondendo, sob qualquer título, pelo adimplemento das faturas por eles devidas.
2.4. As Partes declaram, para os fins do art. 265 do Código Civil, que não há solidariedade entre a GESTORA e os CONSUMIDORES, tampouco entre a GESTORA e o CONTRATANTE, quanto a qualquer obrigação pecuniária dos CONSUMIDORES.
2.5. Os valores arrecadados dos CONSUMIDORES são recebidos pela GESTORA em caráter de mera intermediação, por conta e ordem do CONTRATANTE, não integrando receita própria da GESTORA, ressalvada a parcela correspondente à sua remuneração.
2.6. Nenhuma disposição deste Contrato poderá ser interpretada como garantia, pela GESTORA, de (i) rentabilidade, (ii) volume de energia compensada, (iii) ocupação integral da capacidade de rateio da usina, ou (iv) recebimento de qualquer fatura.

CAPÍTULO II — DOS SERVIÇOS

CLÁUSULA 3 – DOS SERVIÇOS PRESTADOS
3.1. Envio de faturas. A GESTORA enviará aos CONSUMIDORES tanto as faturas da distribuidora quanto as da ASSOCIAÇÃO.
3.2. Demonstrativo de energia compensada. A GESTORA enviará, por e-mail, o Demonstrativo de Energia Compensada em até 30 (trinta) dias úteis contados do recebimento da fatura de energia do CONSUMIDOR, com as informações de injeção em cada unidade consumidora.
3.3. Pós-venda. A partir da assinatura do Termo de Adesão e da procuração, a GESTORA iniciará a régua de comunicação com o CONSUMIDOR, informando-o de todas as etapas até o início do primeiro período de compensação.
3.4. Cobrança. A GESTORA executará o processo de cobrança dos CONSUMIDORES inadimplentes, na forma do Capítulo IV.

CLÁUSULA 4 – DAS OBRIGAÇÕES DO CONTRATANTE
4.1. Fornecer à GESTORA os dados de acesso ao portal da agência virtual da distribuidora e ao portal de Geração Distribuída para clientes corporativos.
4.2. Outorgar procuração para representação da unidade geradora e das unidades consumidoras nos canais de atendimento da distribuidora, on-line e presencial.
4.3. Manter a central geradora em operação regular, comunicando à GESTORA, com a maior antecedência possível, paradas programadas, sinistros ou restrições operativas.
4.4. Manter atualizados os dados cadastrais e bancários para repasse.

CAPÍTULO III — DA REMUNERAÇÃO

CLÁUSULA 5 – DA REMUNERAÇÃO DA GESTORA
5.1. A GESTORA fará jus a:
(a) Remuneração Inicial — 100% (cem por cento) do Valor Integral da Primeira Fatura da Associação, devida apenas quanto a CONSUMIDORES captados pela GESTORA ou por seus corretores;
(b) Remuneração Recorrente — ${numeroBr(recorrente)}% (${percentualExtenso(recorrente)} por cento) sobre as faturas da Associação pagas pelo CONSUMIDOR;
(c) Taxa de Administração — R$ ${moeda(taxaAdmin)} por CONSUMIDOR ativo, incluindo emissão e envio de boleto.
5.2. Definição de "captado pela GESTORA". Considera-se captado pela GESTORA o CONSUMIDOR cujo cadastro tenha sido originado por canal, link de indicação ou corretor da GESTORA, conforme registro do sistema de CRM da GESTORA na data da adesão.
5.3. Cálculo do Valor Integral da Primeira Fatura: Tarifa de Aplicação x (1 – Desconto %) x Volume de Energia Gerada x % Efetivamente Compensado.
5.4. Cálculo da Remuneração Recorrente: [Tarifa de Aplicação x (1 – Desconto %) x Volume de Energia Gerada x % Efetivamente Compensado, no período de apuração] x Percentual Recorrente.
5.5. Definições:
(a) Tarifa de Aplicação — todas as componentes da tarifa de energia elétrica, incluindo impostos e tributos cobrados pela distribuidora na área de concessão;
(b) Desconto — ${numeroBr(desconto)}% (${percentualExtenso(desconto)} por cento) aplicado sobre a Tarifa de Aplicação, praticado para a área de concessão, conforme Anexo I;
(c) % Efetivamente Compensado — apurado pela fatura da distribuidora da unidade consumidora referente ao ciclo, documento que prevalece sobre qualquer relatório, portal ou estimativa em caso de divergência.
5.6. Marcos de pagamento:
(a) a Remuneração Inicial será paga integralmente na primeira fatura do CONSUMIDOR ou, sendo esta parcial, distribuída entre a primeira e a segunda, de forma que o total corresponda ao Valor Integral da Primeira Fatura;
(b) a Remuneração Recorrente será paga mensalmente, a partir do mês subsequente ao segundo pagamento do CONSUMIDOR à ASSOCIAÇÃO.
5.7. A partir da assinatura do Termo de Adesão, via procuração em nome do CONSUMIDOR, e do envio do rateio pela GESTORA, a Remuneração Inicial é considerada apta para faturamento, independentemente de qualquer formalidade adicional.
5.8. A Taxa de Administração será reajustada anualmente pelo IPCA/IBGE, ou índice que o substitua, na data-base de assinatura deste Contrato.
5.9. A GESTORA terá direito à Remuneração enquanto houver parceria, nos termos deste Contrato.

CAPÍTULO IV — DA INADIMPLÊNCIA E DA COBRANÇA

CLÁUSULA 6 – DO RISCO DE INADIMPLÊNCIA
6.1. O risco de crédito dos CONSUMIDORES é integral e exclusivo do CONTRATANTE.
6.2. A GESTORA repassará ao CONTRATANTE exclusivamente os valores efetivamente recebidos e financeiramente compensados, na forma da Cláusula 9. A ausência de pagamento por qualquer CONSUMIDOR não gera para a GESTORA obrigação de antecipar, adiantar, cobrir, garantir ou indenizar o valor correspondente.
6.3. A energia injetada e efetivamente compensada em unidade consumidora de CONSUMIDOR inadimplente não gera direito de reembolso, ressarcimento ou indenização do CONTRATANTE contra a GESTORA.
6.4. Enquanto perdurar a inadimplência, a GESTORA não fará jus à Remuneração Recorrente daquele CONSUMIDOR. A Taxa de Administração permanece devida até o 60º (sexagésimo) dia contado do vencimento não pago, deixando de ser devida a partir de então. Quitado o débito, a Taxa volta a ser devida a partir do ciclo em que ocorrer a Compensação Financeira.
6.5. A GESTORA fica autorizada a excluir do rateio o CONSUMIDOR inadimplente há mais de 60 (sessenta) dias, comunicando o CONTRATANTE, e a envidar melhores esforços para sua substituição, sem que a vaga ociosa gere obrigação indenizatória à GESTORA.
6.6. Cabe exclusivamente ao CONTRATANTE, se assim desejar, contratar seguro de crédito ou instrumento equivalente de mitigação do risco de inadimplência.

CLÁUSULA 7 – DA COBRANÇA E DA TAXA DE RECUPERAÇÃO DE CRÉDITO
7.1. A GESTORA executará, como obrigação de meio, a cobrança administrativa e extrajudicial dos CONSUMIDORES inadimplentes, compreendida no escopo da Taxa de Administração, observada a seguinte régua mínima, contada do vencimento: D+1, aviso automático com 2ª via; D+5, novo aviso com boleto atualizado; D+15, contato ativo e oferta de acordo; D+30, notificação formal e pedido de exclusão do rateio; D+45, negativação e protesto, mediante autorização; D+60, rescisão e medidas judiciais.
7.2. Taxa de Recuperação de Crédito. Sobre todo valor principal recuperado de CONSUMIDOR cuja fatura tenha sido paga após 30 (trinta) dias do vencimento, a GESTORA fará jus a Taxa de Recuperação de Crédito de ${numeroBr(recuperacao)}% (${percentualExtenso(recuperacao)} por cento), retida do repasse, cumulável com a Remuneração Recorrente.
7.2.1. A Taxa de Recuperação de Crédito não onera o CONTRATANTE: incide sobre o valor cheio recebido em razão da perda, pelo CONSUMIDOR, do desconto por pagamento pontual previsto no Termo de Adesão, e não sobre a remuneração devida ao CONTRATANTE.${comparativoRecuperacao}
7.3. A Taxa de Recuperação de Crédito incide exclusivamente sobre valores efetivamente recuperados, não gerando crédito da GESTORA contra o CONTRATANTE em caso de não recuperação.
7.4. Encargos moratórios. A multa moratória de 2% (dois por cento), os juros de 1% (um por cento) ao mês e a correção monetária cobrados dos CONSUMIDORES são, uma vez recebidos, repassados integralmente ao CONTRATANTE.
7.5. Diferencial de desconto. Perdido pelo CONSUMIDOR o desconto por pagamento pontual previsto no Termo de Adesão, a diferença entre o valor cheio e o valor com desconto, quando efetivamente recebida, é repassada integralmente ao CONTRATANTE, sobre ela incidindo a Remuneração Recorrente.
7.6. Negativação em órgãos de proteção ao crédito, protesto de título e cobrança judicial dependem de prévia autorização escrita do CONTRATANTE.
7.7. As despesas de cobrança que excedam a via administrativa — custas, emolumentos de protesto, taxas de negativação, honorários advocatícios contratuais e sucumbenciais — correrão por conta exclusiva do CONTRATANTE, podendo ser deduzidas dos repasses mediante comprovação.
7.8. A execução da cobrança pela GESTORA não implica assunção da dívida, novação, sub-rogação ou garantia do crédito, permanecendo íntegra a Cláusula 2.3.

CLÁUSULA 8 – DO RELATÓRIO DE INADIMPLÊNCIA
A GESTORA disponibilizará mensalmente ao CONTRATANTE relatório de inadimplência por unidade consumidora, com valores, dias de atraso e providências adotadas.

CAPÍTULO V — DO CICLO DE APURAÇÃO E DOS REPASSES

CLÁUSULA 9 – DO CICLO DE APURAÇÃO E DOS REPASSES
9.1. Definições:
(a) Ciclo de Apuração — período de leitura da distribuidora ao qual se refere a energia compensada nas unidades consumidoras do rateio;
(b) Compensação Financeira — data em que o pagamento do CONSUMIDOR é efetivamente liquidado e disponibilizado, livre e desembaraçado, em conta de titularidade da GESTORA;
(c) Data de Corte — dia ${diaCorte} (${percentualExtenso(diaCorte)}) de cada mês;
(d) Valor de Repasse — total compensado financeiramente no ciclo, deduzidos: Remuneração Inicial, Remuneração Recorrente, Taxa de Administração, Taxa de Recuperação de Crédito, tributos retidos na fonte, tarifas bancárias e de meio de pagamento, estornos e ajustes de ciclos anteriores.
9.2. A GESTORA efetuará o repasse até o dia ${diaRepasse} (${percentualExtenso(diaRepasse)}) de cada mês, considerando exclusivamente os pagamentos com Compensação Financeira ocorrida até a Data de Corte. Pagamentos compensados após a Data de Corte integram o ciclo seguinte.
9.3. Nenhum repasse será devido antes da Compensação Financeira. Boleto emitido, fatura vencida, energia injetada ou energia compensada na distribuidora não constituem, isolada ou conjuntamente, fato gerador do repasse.
9.4. Junto ao repasse, a GESTORA enviará Demonstrativo de Repasse contendo, por unidade consumidora: energia injetada e efetivamente compensada, tarifa de aplicação, desconto, valor faturado, valor pago, data da compensação financeira e memória de todas as deduções.
9.5. Estornos, chargebacks, pagamentos em duplicidade, devoluções e cancelamentos serão deduzidos do repasse imediatamente subsequente; sendo insuficiente o saldo, o CONTRATANTE restituirá a diferença em 10 (dez) dias.
9.6. Sobre valores não recebidos dos CONSUMIDORES não incidem juros, correção ou encargos em favor do CONTRATANTE.
9.7. O repasse será feito exclusivamente em conta bancária de titularidade do CONTRATANTE, indicada por escrito. Alteração de conta somente produz efeitos após confirmação por dois canais distintos, correndo por conta do CONTRATANTE os prejuízos decorrentes de dados por ele informados de forma incorreta ou desatualizada.
9.8. O CONTRATANTE terá 10 (dez) dias contados do recebimento do Demonstrativo para impugná-lo de forma fundamentada; decorrido o prazo sem manifestação, o repasse será tido por líquido, certo e quitado.

CAPÍTULO VI — DISPOSIÇÕES GERAIS

CLÁUSULA 10 – DOS TRIBUTOS
Cada Parte é responsável pelo recolhimento de seus próprios tributos. A GESTORA emitirá documento fiscal referente à sua remuneração.

CLÁUSULA 11 – DA PROTEÇÃO DE DADOS E DAS CREDENCIAIS
11.1. As Partes obrigam-se ao cumprimento da Lei nº 13.709/2018 (LGPD).
11.2. As credenciais de acesso ao portal de Geração Distribuída e à agência virtual fornecidas pelo CONTRATANTE serão utilizadas exclusivamente para a execução deste Contrato, sob dever de sigilo, sendo inativadas ao seu término.

CLÁUSULA 12 – DO REEQUILÍBRIO REGULATÓRIO
Alteração legal ou regulatória que modifique de forma relevante a economicidade do arranjo — notadamente a incidência escalonada da TUSD Fio B nos termos da Lei nº 14.300/2022, mudanças de enquadramento GD I / GD II ou de tratamento tributário — autoriza qualquer das Partes a solicitar repactuação, em 30 (trinta) dias, mantidas as condições vigentes enquanto durar a negociação.

CLÁUSULA 13 – DO PRAZO E DA RESCISÃO
13.1. O presente Contrato vige por prazo indeterminado, sem multa rescisória para qualquer das Partes, bastando comunicado com 30 (trinta) dias de antecedência.
13.2. Comunicada a rescisão, a GESTORA reserva-se o direito de: (a) dispor de até ${prazoTransferencia} (${percentualExtenso(prazoTransferencia)}) dias para a transferência dos CONSUMIDORES vinculados à central geradora; (b) receber os honorários referentes à energia compensada no período anterior à data da rescisão, em até ${prazoHonorarios} (${percentualExtenso(prazoHonorarios)}) dias.
13.2.1. O prazo da alínea (a) destina-se à alocação dos CONSUMIDORES em outra central geradora, à sua comunicação prévia e ao processamento da alteração de rateio pela distribuidora, que produz efeito apenas no ciclo de leitura subsequente. Protege igualmente o CONSUMIDOR, que não pode ser retirado da compensação sem destino, e o CONTRATANTE, que não responde por reclamações decorrentes de desligamento abrupto.
13.2.2. O prazo da alínea (b) compõe-se do ciclo de faturamento e cobrança ordinária, correspondente ao prazo da alínea (a), somado ao período de recuperação de crédito dos CONSUMIDORES que se tornarem inadimplentes. Esgotado esse prazo, extinguem-se todos os vínculos entre as Partes decorrentes deste Contrato.
13.3. Durante os ${prazoTransferencia} (${percentualExtenso(prazoTransferencia)}) dias de transição permanecem integralmente vigentes as obrigações de faturamento, cobrança, repasse e remuneração previstas neste Contrato.
13.4. Encerrado o Contrato, os créditos de energia eventualmente gerados e ainda não compensados permanecem de titularidade do CONTRATANTE, que poderá alocá-los livremente a partir do encerramento do período de transição. A GESTORA prestará as informações e providências junto à distribuidora necessárias ao remanejamento do rateio, não lhe cabendo qualquer obrigação de aquisição, indenização ou pagamento pelos créditos não compensados.

CLÁUSULA 14 – DA ASSINATURA ELETRÔNICA
As Partes reconhecem a validade da assinatura eletrônica deste Contrato, nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020, aceitando como prova hábil os registros de auditoria da plataforma utilizada.

CLÁUSULA 15 – DO FORO
Fica eleito o foro da comarca de ${p.foro}, com renúncia a qualquer outro, por mais privilegiado que seja.

ANEXO I — CONDIÇÕES COMERCIAIS
- Desconto ao consumidor: ${numeroBr(desconto)}%
- Remuneração Recorrente: ${numeroBr(recorrente)}%
- Taxa de Administração: R$ ${moeda(taxaAdmin)} por consumidor ativo/mês
- Taxa de Recuperação de Crédito: ${numeroBr(recuperacao)}% sobre o principal recuperado após D+30
- Data de Corte: dia ${diaCorte}
- Data de Repasse: até o dia ${diaRepasse}

ANEXO II — CENTRAIS GERADORAS
${tabelaUsinas(usinas)}

ANEXO III — PROCURAÇÃO PARA LIBERAÇÃO DE ACESSO
Autorização de acesso ao portal de Geração Distribuída da ${distribuidora} e à rede de agências presenciais, em nome do CONTRATANTE, ao preposto indicado pela GESTORA.
- Preposto: ${p.prepostoNome || '_______________'} — CPF ${p.prepostoCpf || '_______________'}
- Perfil: ( X ) consultor  (   ) projetista
- Tipo: ( X ) completo  (   ) restrito
- Validade: ( X ) indeterminado, revogável a qualquer tempo mediante comunicação escrita

E, por estarem justas e contratadas, as Partes assinam eletronicamente o presente Contrato, na presença das testemunhas abaixo.

${cidadeUf}, ${dataPorExtenso()}.

________________________________________
ASSOCIAÇÃO DE USINAS B2W ENERGIA
CNPJ 64.561.352/0001-07 — Presidente

________________________________________
${supplier?.name || ''}
CNPJ/CPF ${supplier?.cnpj || ''} — Contratante

TESTEMUNHAS:

1. ______________________________  Nome: __________________  CPF: ______________

2. ______________________________  Nome: __________________  CPF: ______________`;
};

export const dividirEmPaginasFornecedor = (texto) => paginarTexto(texto);

export const gerarPdfContratoFornecedorBase64 = () => gerarPdfBase64('[data-contract="fornecedor"]');
