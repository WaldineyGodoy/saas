import { dataPorExtenso, gerarPdfBase64, moeda, numeroBr, paginarTexto, paraNumero, percentualExtenso, porExtenso } from './contratoBase';

/**
 * Os três contratos que existem por USINA, e não por fornecedor: compra e
 * venda, arrendamento da área e O&M.
 *
 * A separação não é estética. Compra-se uma usina, arrenda-se uma área e
 * mantém-se uma usina — e o mesmo investidor tem várias. O Tobias já tem
 * três, com preços, áreas e cronogramas diferentes. Pendurar isto no
 * fornecedor daria "o" contrato de compra e venda de quem comprou três.
 *
 * O contrato de gestão continua no fornecedor porque é o oposto: um por
 * titular, listando todas as usinas no Anexo II.
 *
 * Estes textos são os modelos v2, revisados em 24/08/2026. Três pontos
 * conversam com os contratos da Associação e não se mexem sozinhos:
 *
 *  - a remuneração da Associação é declarada por inteiro (quatro parcelas,
 *    sobre faturas PAGAS), porque a versão antiga dizia "10% da receita
 *    gerada" e escondia as outras três;
 *  - o vocabulário é "gestão de créditos", nunca "comercialização" — o
 *    Termo de Adesão afirma que não há venda de energia, e comercializadora
 *    é agente regulado;
 *  - o risco de crédito é declarado aqui porque o Contrato de Gestão o
 *    atribui ao proprietário, e o investidor precisa saber antes de pagar.
 */

export const DEFAULTS_USINA = {
    // Compra e venda
    valorTotal: 0,
    parcela1: 0,
    parcela2: 0,
    parcela3: 0,
    prazoExecucao: 180,
    prazoExecucaoReduzido: 90,
    amperagem: 200,
    limiteReforco: 20000,
    valorOpcaoImovel: 0,
    multaAtrasoMes: 0.5,
    multaAtrasoTeto: 10,
    retencaoRescisao: 10,
    garantiaInstalacaoMeses: 12,
    // Remuneração da Associação, repetida aqui só para declaração
    percentualRecorrente: 10,
    taxaAdmin: 10,
    taxaRecuperacao: 8,
    // O&M
    qtdInversores: 1,
    // Comum
    foro: ''
};

const num = (valor, padrao = 0) => {
    const n = paraNumero(valor);
    return Number.isFinite(n) ? n : padrao;
};

const enderecoDe = (obj) => {
    const a = obj?.address || obj || {};
    const rua = a.logradouro || a.rua || '';
    const cidade = a.municipio || a.cidade || '';
    const partes = [
        [rua, a.numero].filter(Boolean).join(', '),
        a.complemento,
        a.bairro,
        [cidade, a.uf].filter(Boolean).join('/'),
        a.cep ? `CEP ${a.cep}` : ''
    ].filter(Boolean);
    return partes.join(' - ') || '_______________';
};

const cidadeUfDe = (obj) => {
    const a = obj?.address || obj || {};
    return `${a.municipio || a.cidade || 'Natal'}/${a.uf || 'RN'}`;
};

const ou = (valor, alternativa = '_______________') => {
    const v = String(valor ?? '').trim();
    return v || alternativa;
};

/** Qualificação da B2W Projetos, idêntica nos três instrumentos. */
const B2W_PROJETOS = 'B2W PROJETOS & SOLUÇÕES SOLARES LTDA, CNPJ 34.999.115/0002-34, com sede na Av. Olavo Lacerda Montenegro, 467, Lj 6, Parque das Nações, Parnamirim/RN, CEP 59158-400';

const qualificaInvestidor = (supplier) =>
    `${ou(supplier?.name)}, CNPJ/CPF ${ou(supplier?.cnpj)}, com sede/endereço em ${enderecoDe(supplier)}, neste ato representada por ${ou(supplier?.legal_partner_name)}, CPF ${ou(supplier?.legal_partner_cpf)}`;

// ============================================================
// 1. COMPRA E VENDA
// ============================================================

export const montarCompraVenda = ({ usina, supplier, area } = {}, opts = {}) => {
    const p = { ...DEFAULTS_USINA, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && v !== null && v !== '')) };

    const potencia = num(usina?.potencia_kwp);
    const modulos = num(usina?.qtd_modulos);
    const potModulo = num(usina?.potencia_modulos_w);
    const potInversor = num(usina?.potencia_inversor_w);
    const valorTotal = num(p.valorTotal) || num(usina?.valor_investido);
    const prazo = num(p.prazoExecucao, 180);
    const prazoReduzido = num(p.prazoExecucaoReduzido, 90);
    const foro = ou(p.foro || area?.comarca || cidadeUfDe(usina), cidadeUfDe(usina));
    const distribuidora = ou(usina?.concessionaria, 'a distribuidora local');
    const areaM2 = num(area?.area_m2);
    const aluguel = num(area?.valor_aluguel);

    const proprietario = area?.arrendante_nome
        ? `${area.arrendante_nome}, CPF/CNPJ ${ou(area.arrendante_doc)}`
        : '_______________, CPF/CNPJ _______________';

    return `CONTRATO DE COMPRA E VENDA DE USINA FOTOVOLTAICA E PRESTAÇÃO DE SERVIÇOS DE IMPLANTAÇÃO

(I). CONTRATADA: ${B2W_PROJETOS}, neste ato representada na forma de seu contrato social ("CONTRATADA" ou "B2W PROJETOS");

(II). CONTRATANTE: ${qualificaInvestidor(supplier)} ("CONTRATANTE" ou "INVESTIDOR");

(III). INTERVENIENTE ANUENTE: ${proprietario}, proprietário da área descrita na Cláusula 14, que comparece exclusivamente para os fins das Cláusulas 14 e 15.

CAPÍTULO I — OBJETO E DEFINIÇÕES

CLÁUSULA 1 – DO OBJETO
1.1. Constitui objeto deste Contrato o desenvolvimento, a incorporação, a engenharia, o fornecimento de equipamentos, a construção e o comissionamento da central geradora fotovoltaica de geração distribuída denominada ${ou(usina?.name, 'a ser designada')}, com potência instalada de ${numeroBr(potencia)} kWp, destinada à exploração econômica pelo INVESTIDOR.
1.2. A usina será implantada em estrutura de solo, em área de ${areaM2 ? `${numeroBr(areaM2)} m²` : '_______ m²'}, objeto do contrato de arrendamento referido na Cláusula 14, que integra este instrumento como Anexo II.

CLÁUSULA 2 – DAS DEFINIÇÕES
Para os fins deste Contrato:
(a) INVESTIDOR ou CONTRATANTE — a sociedade qualificada no preâmbulo, titular da usina;
(b) B2W PROJETOS ou CONTRATADA — a executora da implantação;
(c) ASSOCIAÇÃO — Associação de Usinas B2W Energia, CNPJ 64.561.352/0001-07, entidade que presta, mediante contratação facultativa e autônoma, a gestão dos créditos de energia;
(d) GRUPO B2W — o conjunto formado pela CONTRATADA, pela ASSOCIAÇÃO e demais sociedades sob controle comum;
(e) CONTRATO DE GESTÃO — o Contrato de Administração e Gestão de Créditos Energéticos celebrado entre o INVESTIDOR e a ASSOCIAÇÃO, se contratado;
(f) DISTRIBUIDORA — ${distribuidora}.

CAPÍTULO II — A USINA

CLÁUSULA 3 – DAS CARACTERÍSTICAS TÉCNICAS
3.1. A usina será composta por: potência instalada total de ${numeroBr(potencia)} kWp; ${modulos ? `${modulos} (${porExtenso(modulos)})` : '_____'} módulos fotovoltaicos${potModulo ? ` de ${numeroBr(potModulo)} W` : ''}; inversor(es) ${usina?.fabricante_inversor ? `${usina.fabricante_inversor} ` : ''}totalizando ${potInversor ? `${numeroBr(potInversor / 1000)} kW` : '_____ kW'}; estrutura metálica de solo em aço; sistema de cabeamento CC e CA, proteção elétrica e aterramento; e sistema de monitoramento remoto.
3.2. Havendo indisponibilidade dos módulos especificados no mercado nacional, a CONTRATADA poderá utilizar módulos de potência unitária diversa, desde que mantidas a potência total instalada e a garantia de fábrica em condições não inferiores, comunicando previamente o INVESTIDOR.

CLÁUSULA 4 – DA INFRAESTRUTURA E DAS OBRAS
4.1. O empreendimento inclui: terraplanagem básica, estrutura metálica de solo, instalação dos módulos e do inversor, padrão de entrada elétrica de ${num(p.amperagem, 200)}A, abrigo técnico, cercamento da área, sistema de câmeras (CFTV), infraestrutura de cabeamento e eletrodutos e sistema completo de aterramento.
4.2. Não estão incluídos, salvo previsão expressa em aditivo: obras de reforço de rede exigidas pela DISTRIBUIDORA, remoção de rocha, contenção de talude, drenagem especial e licenças ambientais que a área venha a exigir.

CAPÍTULO III — PREÇO, PRAZO E ENTREGA

CLÁUSULA 5 – DO VALOR
5.1. O valor total do empreendimento é de R$ ${moeda(valorTotal)}, compreendendo equipamentos, engenharia, desenvolvimento do projeto, obras civis, implantação e comissionamento.

CLÁUSULA 6 – DA FORMA DE PAGAMENTO
6.1. O pagamento será realizado conforme marcos:
(a) R$ ${moeda(num(p.parcela1))} na assinatura deste Contrato;
(b) R$ ${moeda(num(p.parcela2))} na entrega dos equipamentos no local da obra, comprovada por nota fiscal e romaneio;
(c) R$ ${moeda(num(p.parcela3))} na conclusão da montagem e solicitação de vistoria à DISTRIBUIDORA.
6.2. Cada parcela vence em até 5 (cinco) dias do atingimento do respectivo marco, comunicado por escrito com a documentação comprobatória.
6.3. O atraso no pagamento sujeita o INVESTIDOR a multa de 2% (dois por cento), juros de 1% (um por cento) ao mês e correção pelo IPCA, e suspende automaticamente os prazos da Cláusula 7 enquanto perdurar.

CLÁUSULA 7 – DO PRAZO DE EXECUÇÃO
7.1. O prazo de implantação é de até ${prazo} (${porExtenso(prazo)}) dias contados do pagamento da primeira parcela, considerados os prazos regulatórios e operacionais junto à DISTRIBUIDORA.
7.2. Havendo parecer de acesso já emitido ou em estágio avançado, o prazo reduz-se a até ${prazoReduzido} (${porExtenso(prazoReduzido)}) dias, mediante confirmação por escrito.
7.3. Não correm contra a CONTRATADA os períodos de: (i) análise da DISTRIBUIDORA, desde que a documentação tenha sido protocolada tempestivamente; (ii) atraso do INVESTIDOR em pagamento ou entrega de documento; (iii) caso fortuito, força maior, embargo administrativo ou judicial da obra.

CLÁUSULA 8 – DO ATRASO E DO INADIMPLEMENTO DA CONTRATADA
8.1. Ultrapassado o prazo da Cláusula 7 por causa imputável à CONTRATADA, incidirá multa de ${numeroBr(num(p.multaAtrasoMes, 0.5))}% do valor do Contrato por mês de atraso, limitada a ${numeroBr(num(p.multaAtrasoTeto, 10))}% (${percentualExtenso(num(p.multaAtrasoTeto, 10))} por cento), abatida do saldo devedor ou restituída.
8.2. Persistindo o atraso por mais de 90 (noventa) dias, o INVESTIDOR poderá rescindir o Contrato sem incidência da retenção da Cláusula 22, com restituição dos valores aportados, deduzidos os custos comprovadamente incorridos e os equipamentos já adquiridos, que lhe serão entregues.

CLÁUSULA 9 – DO PARECER DE ACESSO
9.1. Cabe à CONTRATADA elaborar, protocolar e conduzir a Solicitação de Acesso junto à DISTRIBUIDORA, respondendo pelas exigências documentais e técnicas do projeto.
9.2. Havendo indeferimento não sanável, ou exigência de obras de reforço de rede cujo custo exceda R$ ${moeda(num(p.limiteReforco))}, qualquer das Partes poderá rescindir este Contrato sem ônus, restituindo-se ao INVESTIDOR os valores aportados, deduzidos os custos comprovadamente incorridos.
9.3. Excedido o limite e havendo interesse do INVESTIDOR em prosseguir, o custo do reforço correrá por sua conta, mediante aditivo.

CAPÍTULO IV — TITULARIDADE E EXPLORAÇÃO

CLÁUSULA 10 – DA SOCIEDADE DE PROPÓSITO ESPECÍFICO
10.1. A usina será de titularidade de Sociedade de Propósito Específico com 100% (cem por cento) de participação do INVESTIDOR.
10.2. Estando a SPE já constituída na data de assinatura, ela figura como CONTRATANTE, conforme preâmbulo.
10.3. Não estando constituída, o INVESTIDOR obriga-se a constituí-la até a conclusão da obra, assumindo pessoalmente, até lá, as obrigações deste Contrato, que serão automaticamente sub-rogadas à SPE mediante termo de adesão.

CLÁUSULA 11 – DA DESTINAÇÃO DA ENERGIA
11.1. A energia gerada poderá ser destinada, a critério exclusivo do INVESTIDOR, a geração compartilhada, autoconsumo remoto ou outra modalidade admitida pela Lei nº 14.300/2022.
11.2. A ASSOCIAÇÃO oferece o serviço de gestão dos créditos de energia. A contratação é facultativa, não condiciona este Contrato e pode ser dispensada sem qualquer ônus ou alteração de preço.
11.3. Optando o INVESTIDOR pela contratação, a relação será regida pelo Contrato de Administração e Gestão de Créditos Energéticos, celebrado diretamente com a ASSOCIAÇÃO.

CLÁUSULA 12 – DA REMUNERAÇÃO DA ASSOCIAÇÃO E DO REPASSE
12.1. Contratada a gestão, a remuneração da ASSOCIAÇÃO é a prevista no Contrato de Gestão e compreende, cumulativamente:
(a) Remuneração Inicial — 100% (cem por cento) do valor integral da primeira fatura, devida apenas quanto a consumidores captados pela ASSOCIAÇÃO ou seus corretores;
(b) Remuneração Recorrente — ${numeroBr(num(p.percentualRecorrente, 10))}% sobre as faturas efetivamente pagas pelos consumidores;
(c) Taxa de Administração — R$ ${moeda(num(p.taxaAdmin, 10))} por consumidor ativo por mês;
(d) Taxa de Recuperação de Crédito — ${numeroBr(num(p.taxaRecuperacao, 8))}% sobre o principal recuperado de fatura paga após 30 (trinta) dias do vencimento.
12.2. O INVESTIDOR declara ter recebido e lido o Contrato de Gestão, que integra este instrumento como Anexo I, antes da assinatura.
12.3. O repasse observará o regime do Contrato de Gestão: ocorre somente após a compensação financeira dos pagamentos dos consumidores, encerrado o ciclo de apuração. Energia gerada, energia compensada na DISTRIBUIDORA e boleto emitido não constituem, isolada ou conjuntamente, fato gerador de repasse.

CLÁUSULA 13 – DOS CUSTOS OPERACIONAIS
13.1. São de responsabilidade do INVESTIDOR: contabilidade e obrigações acessórias da SPE, tributos incidentes sobre sua receita e emissão dos documentos fiscais.
13.2. Os encargos da DISTRIBUIDORA relativos à unidade geradora — custo de disponibilidade, demanda contratada, TUSD-G e a parcela não compensável da TUSD Fio B — são de responsabilidade do INVESTIDOR e, contratada a gestão, serão pagos pela ASSOCIAÇÃO por conta e ordem do INVESTIDOR e deduzidos do repasse, na forma da cláusula de deduções do Contrato de Gestão, mediante demonstrativo acompanhado da fatura e do comprovante de pagamento.

CAPÍTULO V — ÁREA, O&M E SEGURO

CLÁUSULA 14 – DO ARRENDAMENTO DA ÁREA
14.1. A usina será instalada em área de ${areaM2 ? `${numeroBr(areaM2)} m²` : '_______ m²'} objeto de Contrato de Arrendamento celebrado entre o INVESTIDOR e o INTERVENIENTE ANUENTE, que integra este instrumento como Anexo II.
14.2. Valor do arrendamento: R$ ${moeda(aluguel)} mensais, reajustados anualmente na forma do respectivo contrato. Prazo: 10 (dez) anos, renovável por igual período.
14.3. O INVESTIDOR declara ter recebido e lido o Contrato de Arrendamento, inclusive suas cláusulas de multa rescisória, de vigência em caso de alienação e de propriedade da usina, antes da assinatura deste.
14.4. Declaração de parte relacionada. O INVESTIDOR declara ciência de que a área é de propriedade de sócio ou pessoa ligada ao GRUPO B2W, e que as condições praticadas correspondem a valores de mercado para a região e finalidade.

CLÁUSULA 15 – DA OPÇÃO DE COMPRA DO IMÓVEL
15.1. O INTERVENIENTE ANUENTE, na qualidade de proprietário, outorga ao INVESTIDOR opção de compra da área descrita na Cláusula 14, pelo preço de R$ ${moeda(num(p.valorOpcaoImovel))}, exercível em até 12 (doze) meses da assinatura deste Contrato, mediante notificação escrita.
15.2. Findo o prazo sem exercício, nova alienação dependerá de acordo entre proprietário e INVESTIDOR.

CLÁUSULA 16 – DA OPERAÇÃO E MANUTENÇÃO
16.1. A CONTRATADA oferece serviços de operação e manutenção da usina, de contratação facultativa, regidos por Contrato de Administração e Manutenção (O&M) próprio, com prazo inicial de 12 (doze) meses.
16.2. O INVESTIDOR pode contratar terceiro ou executar por conta própria a manutenção, hipótese em que apresentará plano de manutenção compatível com as exigências de garantia dos fabricantes.

CLÁUSULA 17 – DO SEGURO
17.1. A CONTRATADA contratará, em nome e por conta do INVESTIDOR, apólice de seguro da usina pelo período inicial de 12 (doze) meses, com cobertura mínima para roubo, furto, incêndio e vendaval, entregando cópia da apólice.
17.2. A renovação após esse período é de responsabilidade do INVESTIDOR, que deverá manter a usina segurada durante toda a vigência do arrendamento e comprovar a renovação quando solicitado.

CAPÍTULO VI — GARANTIAS, RISCOS E TRANSFERÊNCIA

CLÁUSULA 18 – DA GARANTIA DOS EQUIPAMENTOS E DA INSTALAÇÃO
18.1. Os equipamentos têm a garantia dos respectivos fabricantes, cujos termos serão entregues ao INVESTIDOR no comissionamento.
18.2. A CONTRATADA garante os serviços de instalação e montagem pelo prazo de ${num(p.garantiaInstalacaoMeses, 12)} (${porExtenso(num(p.garantiaInstalacaoMeses, 12))}) meses contados do comissionamento, respondendo por vícios de execução nesse período.

CLÁUSULA 19 – DOS RISCOS DO INVESTIMENTO
19.1. O INVESTIDOR declara ciência de que o empreendimento envolve riscos inerentes à geração distribuída, incluindo:
(a) variação da geração por condições climáticas e de irradiância;
(b) alterações regulatórias, notadamente a incidência escalonada da TUSD Fio B (Lei nº 14.300/2022) e mudanças de enquadramento;
(c) condições de mercado e de ocupação da capacidade de rateio;
(d) o risco de crédito dos consumidores, que, nos termos do Contrato de Gestão, é integral e exclusivo do titular da usina, não respondendo a ASSOCIAÇÃO pelo adimplemento das faturas nem garantindo volume de compensação, rentabilidade ou ocupação.
19.2. Nenhuma projeção, simulação ou estimativa de retorno eventualmente apresentada constitui garantia de resultado.

CLÁUSULA 20 – DA TRANSFERÊNCIA DA USINA
20.1. O INVESTIDOR poderá vender, transferir, dar em garantia ou transmitir por herança a usina ou as quotas da SPE.
20.2. A alienação fica condicionada à assunção pelo adquirente dos contratos acessórios vigentes — Contrato de Gestão, Contrato de Arrendamento e O&M, conforme aplicável — mediante termo de sub-rogação firmado antes da transferência.
20.3. Recusando-se o adquirente a assumir qualquer dos contratos acessórios, a alienação poderá ocorrer, ficando o INVESTIDOR obrigado a denunciar o respectivo contrato na forma nele prevista, respeitados prazos de aviso prévio e de transição.

CLÁUSULA 21 – DO DIREITO DE PREFERÊNCIA
21.1. Em caso de alienação da usina ou das quotas da SPE a terceiro, a B2W PROJETOS terá direito de preferência, em igualdade de condições.
21.2. O INVESTIDOR notificará por escrito, com a proposta de terceiro, e a CONTRATADA terá 30 (trinta) dias para exercer. Decorrido o prazo em silêncio, a preferência é tida por não exercida e a alienação segue livre.

CLÁUSULA 22 – DA RESCISÃO
22.1. Por iniciativa do INVESTIDOR, sem justa causa: antes da aquisição de equipamentos, retenção de ${numeroBr(num(p.retencaoRescisao, 10))}% do valor aportado, a título de projeto e engenharia executados; após a aquisição de equipamentos, reembolso dos custos comprovadamente incorridos, mais ${numeroBr(num(p.retencaoRescisao, 10))}% sobre o saldo restituível, sendo os equipamentos adquiridos entregues ao INVESTIDOR.
22.2. Por iniciativa da CONTRATADA, sem justa causa: restituição integral dos valores aportados, corrigidos pelo IPCA, acrescida de multa de ${numeroBr(num(p.retencaoRescisao, 10))}% (${percentualExtenso(num(p.retencaoRescisao, 10))} por cento).
22.3. Por descumprimento: a parte prejudicada notificará a infratora para sanar em 15 (quinze) dias; persistindo, o contrato poderá ser rescindido de pleno direito, sem prejuízo de perdas e danos comprovados.
22.4. Aplica-se a Cláusula 8.2 quando a rescisão decorrer de atraso da CONTRATADA.

CAPÍTULO VII — DISPOSIÇÕES GERAIS

CLÁUSULA 23 – DA CONFIDENCIALIDADE E DA PROTEÇÃO DE DADOS
23.1. As Partes obrigam-se a manter sigilo sobre condições comerciais, dados técnicos e informações de clientes a que tiverem acesso.
23.2. O tratamento de dados pessoais observará a Lei nº 13.709/2018, restrito às finalidades deste Contrato e dos contratos acessórios.

CLÁUSULA 24 – DA INDEPENDÊNCIA DAS PARTES E DOS CONTRATOS
24.1. Este Contrato não cria sociedade, consórcio, mandato ou vínculo empregatício entre as Partes, nem responsabilidade solidária por obrigações uma da outra.
24.2. Este Contrato é autônomo em relação aos contratos de gestão, de arrendamento e de O&M. O inadimplemento ou a rescisão de qualquer deles não autoriza, por si, a suspensão, a compensação ou a retenção de obrigações deste Contrato, por nenhuma das Partes.

CLÁUSULA 25 – DA ASSINATURA ELETRÔNICA
25.1. As Partes reconhecem a validade da assinatura eletrônica, nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020, aceitando como prova os registros de auditoria da plataforma utilizada.

CLÁUSULA 26 – DOS ANEXOS
Integram este Contrato: Anexo I — Contrato de Administração e Gestão de Créditos Energéticos, se contratado; Anexo II — Contrato de Arrendamento de Área; Anexo III — Contrato de O&M, se contratado; Anexo IV — Memorial descritivo e cronograma físico; Anexo V — Procuração para representação junto à DISTRIBUIDORA.

CLÁUSULA 27 – DO FORO
27.1. Fica eleito o foro da comarca de ${foro}, com renúncia a qualquer outro, por mais privilegiado que seja.

${cidadeUfDe(usina)}, ${dataPorExtenso()}.

________________________________________
${ou(supplier?.name)}
CNPJ/CPF ${ou(supplier?.cnpj)} — Contratante

________________________________________
B2W PROJETOS & SOLUÇÕES SOLARES LTDA
CNPJ 34.999.115/0002-34 — Contratada

________________________________________
${area?.arrendante_nome || '_______________'}
CPF/CNPJ ${ou(area?.arrendante_doc)} — Interveniente Anuente

TESTEMUNHAS:

1. ______________________________  Nome: __________________  CPF: ______________

2. ______________________________  Nome: __________________  CPF: ______________

ANEXO V — PROCURAÇÃO PARA REPRESENTAÇÃO JUNTO À DISTRIBUIDORA
${ou(supplier?.name)}, CNPJ/CPF ${ou(supplier?.cnpj)}, autoriza o acesso ao portal de Geração Distribuída da ${distribuidora} e à rede de agências presenciais, para solicitar serviços e acessar informações necessárias à prestação dos serviços contratados, ao preposto abaixo:
- Preposto: ${ou(p.prepostoNome)} — CPF ${ou(p.prepostoCpf)}
- Perfil: ( X ) consultor  (   ) projetista
- Tipo: ( X ) completo  (   ) restrito
- Validade: ( X ) indeterminado, revogável a qualquer tempo mediante comunicação escrita

________________________________________
${ou(supplier?.name)} — CNPJ/CPF ${ou(supplier?.cnpj)}`;
};

// ============================================================
// 2. ARRENDAMENTO
// ============================================================

export const montarArrendamento = ({ usina, supplier, area } = {}, opts = {}) => {
    const p = { ...DEFAULTS_USINA, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && v !== null && v !== '')) };

    const areaM2 = num(area?.area_m2);
    const aluguel = num(area?.valor_aluguel);
    const dia = num(area?.dia_pagamento, 5);
    const indice = ou(area?.indice_reajuste, 'IPCA');
    const comarca = ou(area?.comarca || p.foro || cidadeUfDe(area), cidadeUfDe(area));

    return `CONTRATO DE ARRENDAMENTO DE ÁREA PARA GERAÇÃO DISTRIBUÍDA

(I). ARRENDANTE: ${ou(area?.arrendante_nome)}, CPF/CNPJ ${ou(area?.arrendante_doc)}, residente/sediado em ${enderecoDe({ address: area?.arrendante_endereco })};

(II). ARRENDATÁRIO: ${qualificaInvestidor(supplier)}.

CLÁUSULA 1 – DO OBJETO
1.1. O ARRENDANTE arrenda ao ARRENDATÁRIO área de ${areaM2 ? `${numeroBr(areaM2)} m²` : '_______ m²'}, integrante do imóvel matriculado sob o nº ${ou(area?.matricula)} no ${ou(area?.cartorio)}, situado em ${enderecoDe({ address: area?.endereco })}${area?.coordenadas ? `, coordenadas ${area.coordenadas}` : ''}.
1.2. A área é entregue nua, sem benfeitorias, e destina-se exclusivamente à instalação, operação e manutenção da central geradora fotovoltaica ${ou(usina?.name, 'do ARRENDATÁRIO')} em geração distribuída.
1.3. Integra este contrato, como Anexo I, a certidão de matrícula atualizada do imóvel, com a delimitação da área arrendada.

CLÁUSULA 2 – DO PRAZO
2.1. O prazo é de 10 (dez) anos contados da assinatura.
2.2. Ao término, renova-se automaticamente por mais 10 (dez) anos, salvo oposição escrita de qualquer das Partes com antecedência mínima de 90 (noventa) dias.

CLÁUSULA 3 – DO VALOR E DO REAJUSTE
3.1. O valor mensal é de R$ ${moeda(aluguel)}, pago até o dia ${dia} (${porExtenso(dia)}) de cada mês, referente ao mês anterior de utilização${area?.mes_inicio ? `, com início em ${area.mes_inicio}` : ''}.
3.2. O valor será corrigido anualmente, na data de aniversário do início do pagamento, pela variação acumulada do ${indice}, ou, na sua extinção, por índice que o substitua.
3.3. O atraso no pagamento sujeita o ARRENDATÁRIO a multa de 2% (dois por cento), juros de 1% (um por cento) ao mês e correção monetária.

CLÁUSULA 4 – DA PROPRIEDADE DA USINA
4.1. A central geradora fotovoltaica, suas estruturas de fixação, módulos, inversores, cabeamento, abrigo técnico, cercamento, sistema de monitoramento e demais equipamentos são e permanecem bens móveis de propriedade exclusiva do ARRENDATÁRIO, não se incorporando ao imóvel a qualquer título.
4.2. As benfeitorias necessárias ou úteis eventualmente realizadas na área — excluída a usina e seus componentes, na forma do item 4.1 — não serão indenizáveis, incorporando-se ao imóvel.
4.3. Ao término do contrato, o ARRENDATÁRIO poderá remover a usina no prazo de 90 (noventa) dias, restituindo a área em condições de uso, ressalvado o desgaste natural.
4.4. O ARRENDANTE declara que a usina não integra a garantia de quaisquer obrigações suas, e obriga-se a apresentar este contrato em caso de constrição judicial que a atinja.

CLÁUSULA 5 – DAS OBRIGAÇÕES DO ARRENDANTE
5.1. São obrigações do ARRENDANTE:
(a) entregar a área livre e desembaraçada de ônus, gravames e ocupantes;
(b) garantir o uso pacífico da área durante toda a vigência;
(c) prestar as informações e documentos necessários à instalação e operação da usina, inclusive para licenciamento e para a solicitação de acesso à distribuidora;
(d) não praticar, nem permitir que terceiros pratiquem, atos que causem sombreamento, obstrução de acesso ou interferência na geração;
(e) comunicar de imediato qualquer ação, penhora, desapropriação ou oneração que recaia sobre o imóvel;
(f) manter em dia os tributos e encargos incidentes sobre a propriedade do imóvel, notadamente ITR/IPTU.

CLÁUSULA 6 – DAS OBRIGAÇÕES DO ARRENDATÁRIO
6.1. São obrigações do ARRENDATÁRIO:
(a) utilizar a área exclusivamente para a finalidade da Cláusula 1;
(b) pagar o arrendamento nos prazos ajustados;
(c) manter a área em bom estado de conservação e limpeza, respondendo por danos que causar;
(d) obter as licenças, alvarás e autorizações necessárias, arcando com os respectivos custos;
(e) manter a usina segurada durante toda a vigência, com cobertura mínima para incêndio, danos elétricos, vendaval e responsabilidade civil, comprovando a apólice quando solicitado;
(f) restituir a área ao término, observado o prazo de remoção da Cláusula 4.3.

CLÁUSULA 7 – DO ACESSO E DA PASSAGEM
7.1. Fica constituída, a título gratuito e pelo prazo deste contrato, servidão de acesso de pessoas e veículos à área arrendada, pelas vias internas do imóvel, para fins de construção, operação, manutenção, vigilância e remoção da usina.
7.2. Fica igualmente constituída servidão de passagem para cabos, eletrodutos, aterramento e demais infraestruturas de conexão, desde a área arrendada até o ponto de entrega da distribuidora.
7.3. As servidões acompanham o imóvel e obrigam eventuais adquirentes, na forma da Cláusula 8.

CLÁUSULA 8 – DA VIGÊNCIA EM CASO DE ALIENAÇÃO E DA AVERBAÇÃO
8.1. Em caso de alienação do imóvel a qualquer título, este contrato permanece em vigor e obriga o adquirente, que se sub-roga em todos os direitos e obrigações do ARRENDANTE.
8.2. O ARRENDANTE obriga-se a averbar este contrato na matrícula do imóvel em até 30 (trinta) dias da assinatura, arcando com os emolumentos, e a fazer constar a cláusula de vigência em qualquer instrumento de alienação, promessa ou oneração.
8.3. O ARRENDATÁRIO tem direito de preferência na aquisição do imóvel, em igualdade de condições com terceiros, exercível em 30 (trinta) dias contados do recebimento da proposta por escrito.
8.4. Descumprido o dever de averbação e sobrevindo alienação que resulte em desocupação, aplica-se ao ARRENDANTE a indenização da Cláusula 9.2.

CLÁUSULA 9 – DA RESCISÃO E DAS PERDAS E DANOS
9.1. Rescisão antecipada sem justa causa pelo ARRENDATÁRIO: multa equivalente a 12 (doze) alugueres vigentes na data da rescisão, observado o aviso prévio de 90 (noventa) dias.
9.2. Rescisão antecipada sem justa causa pelo ARRENDANTE, ou desocupação por descumprimento das Cláusulas 5 ou 8: além da multa de 12 (doze) alugueres, o ARRENDANTE indenizará o ARRENDATÁRIO pelo valor residual da usina, apurado por depreciação linear em 25 (vinte e cinco) anos sobre o valor de aquisição, acrescido dos custos comprovados de desmontagem, remoção e reinstalação.
9.3. Rescisão por descumprimento: a parte prejudicada notificará a infratora para sanar em 15 (quinze) dias; persistindo, o contrato poderá ser rescindido de pleno direito, sem prejuízo das perdas e danos comprovados.
9.4. Extinção sem ônus: o contrato extingue-se sem multa para qualquer das Partes em caso de (i) indeferimento definitivo do acesso pela distribuidora, (ii) desapropriação da área, (iii) sinistro que inviabilize a operação e não seja coberto por seguro, ou (iv) impossibilidade regulatória superveniente.

CLÁUSULA 10 – DA DESAPROPRIAÇÃO
10.1. Sobrevindo desapropriação total ou parcial que inviabilize a operação, o contrato extingue-se sem multa, cabendo a cada Parte a indenização correspondente ao seu respectivo bem: ao ARRENDANTE pelo imóvel, ao ARRENDATÁRIO pela usina e pelos custos de remoção.

CLÁUSULA 11 – DA CESSÃO
11.1. O ARRENDATÁRIO poderá ceder este contrato ao adquirente da usina ou das quotas da SPE, mediante comunicação escrita ao ARRENDANTE, permanecendo íntegras as demais condições.

CLÁUSULA 12 – DA PROTEÇÃO DE DADOS E DA ASSINATURA ELETRÔNICA
12.1. O tratamento de dados pessoais observará a Lei nº 13.709/2018, restrito às finalidades deste contrato.
12.2. As Partes reconhecem a validade da assinatura eletrônica, nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020.

CLÁUSULA 13 – DO FORO
13.1. Fica eleito o foro da comarca da situação do imóvel, ${comarca}, com renúncia a qualquer outro.

${cidadeUfDe(area)}, ${dataPorExtenso()}.

________________________________________
${ou(area?.arrendante_nome)}
CPF/CNPJ ${ou(area?.arrendante_doc)} — Arrendante

________________________________________
${ou(supplier?.name)}
CNPJ/CPF ${ou(supplier?.cnpj)} — Arrendatário

TESTEMUNHAS:

1. ______________________________  Nome: __________________  CPF: ______________

2. ______________________________  Nome: __________________  CPF: ______________

ANEXO I — Certidão de matrícula atualizada do imóvel, com delimitação da área arrendada.`;
};

// ============================================================
// 3. O&M
// ============================================================

export const montarOM = ({ usina, supplier, servicoOM } = {}, opts = {}) => {
    const p = { ...DEFAULTS_USINA, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && v !== null && v !== '')) };
    const v = servicoOM || {};

    const modulos = num(usina?.qtd_modulos);
    const inversores = num(p.qtdInversores, 1);
    const porModulo = num(v.valorModulo);
    const porInversor = num(v.valorInversor);
    const mensal = modulos * porModulo + inversores * porInversor;
    const prazoMeses = num(v.prazoMeses, 12);
    const foro = ou(p.foro || cidadeUfDe(usina), cidadeUfDe(usina));

    return `CONTRATO DE ADMINISTRAÇÃO E MANUTENÇÃO DE USINA FOTOVOLTAICA (O&M)

(I). CONTRATANTE: ${qualificaInvestidor(supplier)};

(II). CONTRATADA: ${B2W_PROJETOS}.

CLÁUSULA 1 – DO OBJETO
1.1. Prestação de serviços de administração e manutenção da central geradora fotovoltaica ${ou(usina?.name)}, de titularidade da CONTRATANTE, com ${numeroBr(num(usina?.potencia_kwp))} kWp, composta por ${modulos || '_____'} módulos e ${inversores} inversor(es), situada em ${enderecoDe(usina)}, com o objetivo de preservar o funcionamento, a eficiência e a longevidade do sistema.

CLÁUSULA 2 – DO ESCOPO DOS SERVIÇOS
2.1. Os serviços compreendem:
(a) manutenção preventiva ${ou(v.periodicidadePreventiva, 'trimestral')}, com análise e medição de parâmetros elétricos e operacionais, inspeção de estrutura, conexões, aterramento e dispositivos de proteção;
(b) limpeza da área e roçagem, evitando vegetação que sombreie os módulos ou dificulte acesso e segurança;
(c) limpeza dos módulos com periodicidade ${ou(v.periodicidadeLimpeza, 'semestral')};
(d) acompanhamento remoto da geração por meio do sistema de monitoramento;
(e) acionamento e acompanhamento de garantias junto a fabricantes ou representantes, para reparo ou substituição de componentes defeituosos;
(f) acionamento e acompanhamento de sinistros junto às seguradoras;
(g) representação junto à distribuidora para solicitação de reparos na rede que afetem a operação, e acompanhamento das providências.
2.2. Não estão incluídos nos serviços, salvo aditivo: manutenção corretiva, peças de reposição, mão de obra de substituição de equipamentos, adequações exigidas por alteração normativa, reparo de danos por caso fortuito, força maior, vandalismo ou terceiros, e obras civis.
2.3. Os serviços não incluídos serão previamente orçados e executados somente mediante aprovação escrita da CONTRATANTE.

CLÁUSULA 3 – DO ATENDIMENTO
3.1. Identificada, pelo monitoramento ou por comunicação da CONTRATANTE, falha que reduza ou interrompa a geração, a CONTRATADA iniciará a apuração em até ${num(v.prazoApuracaoHoras, 24)} (${porExtenso(num(v.prazoApuracaoHoras, 24))}) horas úteis e informará o diagnóstico e o plano de ação em até ${num(v.prazoDiagnosticoDias, 5)} (${porExtenso(num(v.prazoDiagnosticoDias, 5))}) dias úteis.
3.2. Os prazos referem-se à atuação da CONTRATADA e não abrangem o tempo de resposta de fabricantes, seguradoras ou da distribuidora.

CLÁUSULA 4 – DO RELATÓRIO MENSAL
4.1. A CONTRATADA disponibilizará à CONTRATANTE, mensalmente, relatório contendo: energia gerada no período, disponibilidade do sistema, ocorrências registradas, manutenções executadas e pendências.
4.2. O relatório será fornecido em formato que permita conciliação com os registros da distribuidora e com o fechamento mensal da gestão de créditos, quando contratada.

CLÁUSULA 5 – DO VALOR E DA FORMA DE PAGAMENTO
5.1. O valor mensal é composto por: (a) R$ ${moeda(porModulo)} por módulo fotovoltaico instalado; e (b) R$ ${moeda(porInversor)} por inversor instalado.
5.2. Na data de assinatura, o valor mensal totaliza R$ ${moeda(mensal)}.
5.3. A cobrança será emitida até o dia 5 (cinco) de cada mês, referente aos serviços do mês anterior.
5.4. O valor será corrigido anualmente, na data de aniversário do contrato, pela variação acumulada do ${ou(v.indiceReajuste, 'IPCA')}, ou índice que o substitua.
5.5. O atraso sujeita a CONTRATANTE a multa de 2% (dois por cento), juros de 1% (um por cento) ao mês e correção monetária.

CLÁUSULA 6 – DO ACESSO À USINA
6.1. A CONTRATANTE assegurará à CONTRATADA e a seus prepostos o acesso à usina para execução dos serviços, respondendo pela obtenção das autorizações necessárias junto ao proprietário da área ou ao condomínio.
6.2. Impedido o acesso por causa não imputável à CONTRATADA, suspendem-se os prazos da Cláusula 3 e afasta-se sua responsabilidade pelos efeitos da não execução no período.

CLÁUSULA 7 – DA ISENÇÃO POR LUCROS CESSANTES
7.1. A CONTRATADA não responde por lucros cessantes nem por danos indiretos decorrentes de paralisação temporária da geração, seja por processo de garantia, sinistro, reparo na rede da distribuidora ou qualquer interrupção não causada por dolo ou culpa exclusiva sua.
7.2. A CONTRATADA empregará todos os esforços razoáveis para minimizar o tempo de inatividade e restabelecer a geração com diligência e presteza.

CLÁUSULA 8 – DA RESPONSABILIDADE DA CONTRATADA
8.1. A CONTRATADA responde pelos danos que causar à usina por dolo ou culpa na execução dos serviços, limitada sua responsabilidade, salvo dolo, ao valor equivalente a 12 (doze) mensalidades vigentes.
8.2. A CONTRATADA manterá seus profissionais habilitados e observará as normas técnicas e de segurança aplicáveis, respondendo pelos encargos trabalhistas e previdenciários de sua equipe, sem vínculo com a CONTRATANTE.

CLÁUSULA 9 – DO PRAZO
9.1. Vigência de ${prazoMeses} (${porExtenso(prazoMeses)}) meses contados da assinatura, renovável automaticamente por iguais períodos, salvo manifestação escrita de qualquer das Partes com antecedência mínima de 30 (trinta) dias do término.

CLÁUSULA 10 – DA RESCISÃO
10.1. Qualquer das Partes poderá rescindir no vencimento, com aviso prévio escrito de 30 (trinta) dias, sem multa, desde que não haja pendências financeiras ou de serviços em aberto.
10.2. A rescisão antes do término do período inicial, sem justa causa, sujeita a parte que lhe der causa ao pagamento de 3 (três) mensalidades vigentes.
10.3. Em caso de descumprimento, a parte prejudicada notificará a infratora para sanar em 15 (quinze) dias; persistindo, o contrato poderá ser rescindido de pleno direito, sem prejuízo das perdas e danos comprovados.
10.4. Rescindido o contrato, a CONTRATADA entregará à CONTRATANTE, em até 15 (quinze) dias, os acessos ao sistema de monitoramento, o histórico de geração e o relatório de pendências.

CLÁUSULA 11 – DA CESSÃO E DA INDEPENDÊNCIA
11.1. Alienada a usina ou as quotas da SPE, este contrato poderá ser cedido ao adquirente mediante comunicação escrita, permanecendo íntegras as demais condições.
11.2. Este contrato é autônomo em relação aos contratos de compra e venda, de arrendamento e de gestão de créditos. O inadimplemento ou a rescisão de qualquer deles não autoriza, por si, a suspensão, a compensação ou a retenção de obrigações deste contrato.

CLÁUSULA 12 – DA PROTEÇÃO DE DADOS E DA ASSINATURA ELETRÔNICA
12.1. O tratamento de dados pessoais observará a Lei nº 13.709/2018, restrito às finalidades deste contrato.
12.2. As Partes reconhecem a validade da assinatura eletrônica, nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020.

CLÁUSULA 13 – DO FORO
13.1. Fica eleito o foro da comarca de ${foro}, com renúncia a qualquer outro.

${cidadeUfDe(usina)}, ${dataPorExtenso()}.

________________________________________
${ou(supplier?.name)}
CNPJ/CPF ${ou(supplier?.cnpj)} — Contratante

________________________________________
B2W PROJETOS & SOLUÇÕES SOLARES LTDA
CNPJ 34.999.115/0002-34 — Contratada

TESTEMUNHAS:

1. ______________________________  Nome: __________________  CPF: ______________

2. ______________________________  Nome: __________________  CPF: ______________`;
};

// ============================================================
// Registro dos três, para a tela não repetir switch/case
// ============================================================

export const CONTRATOS_USINA = [
    { tipo: 'compra_venda', rotulo: 'Compra e Venda', titulo: 'Contrato de Compra e Venda de Usina Fotovoltaica e Prestação de Serviços de Implantação', montar: montarCompraVenda },
    { tipo: 'arrendamento', rotulo: 'Arrendamento', titulo: 'Contrato de Arrendamento de Área para Geração Distribuída', montar: montarArrendamento },
    { tipo: 'om', rotulo: 'O&M', titulo: 'Contrato de Administração e Manutenção de Usina Fotovoltaica', montar: montarOM }
];

export const dividirEmPaginasUsina = (texto) => paginarTexto(texto);

export const gerarPdfContratoUsinaBase64 = () => gerarPdfBase64('[data-contract="usina"]');
