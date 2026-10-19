import { baixarPdfContrato, dataPorExtenso, gerarPdfBase64, moeda, numeroBr, paginarTexto, paraNumero, percentualExtenso, porExtenso, qualificaParte, rotuloDocumento } from './contratoBase';

/**
 * Contrato de Originação e Indicação de Negócios — o instrumento firmado
 * com o parceiro que traz assinantes, eletropostos e usinas.
 *
 * Três decisões moldam o texto e explicam por que ele não se parece com
 * um contrato de comissão de venda comum:
 *
 *  - **A remuneração não vive aqui.** Os percentuais mudam por cargo, por
 *    plano e por negociação (`originators_v2.split_commission`,
 *    `planos_assinatura_energia.recorrente_config`, `planos_usina`). O
 *    contrato fixa o MECANISMO — base de cálculo, fato gerador, níveis,
 *    cortes, piso — e manda os números para o Anexo I, gerado do cadastro.
 *    Escrever "4%" no corpo criaria uma terceira fonte de verdade, e a
 *    primeira a divergir das outras duas. Ver a memória
 *    crm-comissao-duas-fontes.
 *  - **O fato gerador é a compensação bancária, não a venda.** É o que a
 *    regra 6.1 do playbook determina e o que o motor do razão faz: sem
 *    pagamento compensado do consumidor não há split. Sem isso escrito, o
 *    parceiro cobra na assinatura e a B2W paga comissão de fatura que não
 *    entrou.
 *  - **A recorrência cessa no desligamento** (decisão do dono,
 *    19/10/2026), e não há exclusividade. São as duas escolhas que
 *    diferenciam este contrato do modelo de carteira vitalícia.
 */

export const TITULO_ORIGINADOR = 'Contrato de Originação e Indicação de Negócios';

/** As três frentes de originação. A marcada entra no objeto do contrato. */
export const MODALIDADES_ORIGINACAO = [
    {
        chave: 'assinantes',
        rotulo: 'Assinantes de energia',
        resumo: 'consumidores que aderem aos planos de energia por assinatura'
    },
    {
        chave: 'eletropostos',
        rotulo: 'Eletropostos',
        resumo: 'pontos de recarga de veículos elétricos aderentes aos planos de eletroposto'
    },
    {
        chave: 'usinas',
        rotulo: 'Usinas (investidores)',
        resumo: 'investidores que adquirem central geradora fotovoltaica'
    }
];

export const DEFAULTS_ORIGINADOR = {
    assinantes: true,
    eletropostos: false,
    usinas: false,
    avisoPrevioDias: 30,
    prazoPagamentoDias: 15,
    naoAliciamentoMeses: 12,
    prazoEstornoMeses: 6,
    foro: 'Caraí/MG'
};

const B2W_ASSOCIACAO = 'ASSOCIAÇÃO DE USINAS B2W ENERGIA, associação de direito privado, CNPJ 64.561.352/0001-07, com sede na Praça Apolinário Barbosa, 86, 1º andar – Centro, Caraí/MG, CEP 39810-000, neste ato representada na forma do seu Estatuto Social por seu presidente';

const CARGOS = {
    ppf: 'Parceiro Power Free (PPF)',
    ppp: 'Parceiro Power Premium (PPP)',
    ppe: 'Parceiro Power Embaixador (PPE)',
    lider: 'Líder'
};

const enderecoOriginador = (o) => {
    const a = o?.address || {};
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

/** A data do banco (aaaa-mm-dd) no formato que se lê num contrato. */
const dataBr = (iso) => {
    if (!iso) return '__/__/____';
    const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
    return dia && mes && ano ? `${dia}/${mes}/${ano}` : String(iso);
};

/** Percentual que veio do cadastro; zero e ausente se dizem de formas diferentes. */
const pct = (valor) => {
    const n = paraNumero(valor);
    if (!Number.isFinite(n)) return '____%';
    return `${numeroBr(n)}% (${percentualExtenso(n)} por cento)`;
};

/**
 * Anexo I — o quadro que carrega os números.
 *
 * Sai do cadastro do originador, e não do texto, porque é o cadastro que o
 * motor do split lê na hora de pagar.
 */
const anexoCondicoes = (originador, lider, modalidades) => {
    const split = originador?.split_commission || {};
    const cargo = CARGOS[(originador?.cargo || 'ppf').toLowerCase()] || CARGOS.ppf;

    const linhas = [
        `Cargo na data de assinatura: ${cargo}.`,
        `Líder responsável: ${lider?.name ? `${lider.name}, ${rotuloDocumento(lider.cpf_cnpj)} ${lider.cpf_cnpj || '____'}` : 'não há Líder vinculado nesta data'}.`,
        `Modalidades contratadas: ${modalidades.map(m => m.rotulo).join('; ')}.`,
        `Bônus Start: ${pct(split.start)} da Base de Cálculo Líquida, nos termos da Cláusula 7.`,
        `Recorrência: ${pct(split.recurrent)} da Base de Cálculo Líquida, nos termos da Cláusula 8, observados os níveis e cortes da Tabela de Recompensas vigente.`,
        `Chave PIX para crédito: ${originador?.pix_key || '_______________'}${originador?.pix_key_type ? ` (tipo ${originador.pix_key_type})` : ''}.`,
        `Licença anual: ${originador?.licenca_valor ? `R$ ${moeda(paraNumero(originador.licenca_valor))}, com vencimento em ${dataBr(originador.licenca_vencimento)}` : 'não aplicável ao cargo nesta data'}.`,
        'Os percentuais deste Anexo são os registrados no sistema de gestão na data de emissão e podem ser revistos na forma da Cláusula 16.'
    ];

    return linhas.map((l, i) => `I.${i + 1}. ${l}`).join('\n');
};

/** Cláusula 9: uma subcláusula por frente contratada. */
const clausulasPorModalidade = (modalidades) => {
    const blocos = [];

    if (modalidades.some(m => m.chave === 'assinantes')) {
        blocos.push(`9.${blocos.length + 1}. Originação de Assinantes de energia. A Base de Cálculo Líquida é apurada, em cada fatura, pela energia efetivamente compensada na unidade consumidora, multiplicada pela tarifa da distribuidora deduzida da parcela não compensável da TUSD Fio B, e deduzido o desconto concedido ao assinante. Tarifa e Fio B são os impressos na fatura da distribuidora do período; na sua falta, os do cadastro da concessionária. Havendo energia compensada, a recompensa é devida ainda que a fatura do assinante resulte zerada ou negativa por outros débitos. A matriz de níveis, os cortes por nível e a participação do Assinante Conect são os da Tabela de Recompensas do plano a que a unidade consumidora estiver vinculada.`);
    }

    if (modalidades.some(m => m.chave === 'eletropostos')) {
        blocos.push(`9.${blocos.length + 1}. Originação de Eletropostos. O lastro é o plano de energia por assinatura vinculado ao eletroposto, já deduzido o Fio B, sobre o qual não há nova dedução a esse título. A Base de Cálculo Líquida é o lastro deduzido do desconto concedido ao eletroposto. Aplicam-se, no mais, as mesmas regras de níveis, cortes e condição de pagamento previstas neste Contrato.`);
    }

    if (modalidades.some(m => m.chave === 'usinas')) {
        blocos.push(`9.${blocos.length + 1}. Originação de Usinas. Considera-se originada pelo ORIGINADOR a usina cujo investidor tenha sido por ele apresentado e assim registrado no sistema de gestão antes da assinatura do contrato de compra e venda. A recompensa observa o Plano de Usina vinculado à central geradora, que define a participação do originador da usina e a do respectivo Líder, e é apurada sobre a mesma Base de Cálculo Líquida das faturas dos consumidores atendidos pela usina. A originação da usina dá-se perante B2W PROJETOS & SOLUÇÕES SOLARES LTDA, CNPJ 34.999.115/0002-34, sociedade do mesmo grupo econômico, e a ASSOCIAÇÃO responde pela apuração e pelo pagamento da recompensa na forma deste Contrato.`);
    }

    return blocos.join('\n');
};

/**
 * Monta o texto do contrato do originador.
 *
 * @param originador registro de `originators_v2` com endereço e split
 * @param lider      registro do Líder vinculado, se houver
 * @param opts       modalidades marcadas e prazos; o que faltar usa DEFAULTS_ORIGINADOR
 */
export const montarContratoOriginador = (originador, lider = null, opts = {}) => {
    const p = { ...DEFAULTS_ORIGINADOR, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && v !== null && v !== '')) };

    const modalidades = MODALIDADES_ORIGINACAO.filter(m => p[m.chave]);
    // Contrato sem nenhuma frente marcada não tem objeto. Em vez de sair
    // mudo, assume a frente de assinantes, que é a do cadastro padrão.
    const frentes = modalidades.length ? modalidades : [MODALIDADES_ORIGINACAO[0]];

    const numero = (valor, padrao) => {
        const n = paraNumero(valor);
        return Number.isFinite(n) && n > 0 ? n : padrao;
    };
    const aviso = numero(p.avisoPrevioDias, DEFAULTS_ORIGINADOR.avisoPrevioDias);
    const prazoPagamento = numero(p.prazoPagamentoDias, DEFAULTS_ORIGINADOR.prazoPagamentoDias);
    const naoAliciamento = numero(p.naoAliciamentoMeses, DEFAULTS_ORIGINADOR.naoAliciamentoMeses);
    const prazoEstorno = numero(p.prazoEstornoMeses, DEFAULTS_ORIGINADOR.prazoEstornoMeses);

    const a = originador?.address || {};
    const cidadeUf = `${a.municipio || a.cidade || 'Caraí'}/${a.uf || 'MG'}`;
    const foro = p.foro || DEFAULTS_ORIGINADOR.foro;

    const objetoFrentes = frentes
        .map((m, i) => `(${String.fromCharCode(97 + i)}) ${m.rotulo} — ${m.resumo}`)
        .join('; ');

    return `CONTRATO DE ORIGINAÇÃO E INDICAÇÃO DE NEGÓCIOS

(I). ASSOCIAÇÃO: ${B2W_ASSOCIACAO} ("ASSOCIAÇÃO" ou "B2W");

(II). ORIGINADOR: ${qualificaParte({ nome: originador?.name, doc: originador?.cpf_cnpj, endereco: enderecoOriginador(originador) })}${originador?.company_name ? `, atuando sob a denominação ${originador.company_name}` : ''} ("ORIGINADOR").

CAPÍTULO I — DO OBJETO E DA NATUREZA DO VÍNCULO

CLÁUSULA 1 – DO OBJETO
1.1. Constitui objeto deste Contrato a originação e a indicação de negócios, pelo ORIGINADOR à ASSOCIAÇÃO, nas seguintes frentes: ${objetoFrentes}.
1.2. A originação consiste em apresentar interessados, acompanhar a negociação e apoiar a formalização da adesão ou da contratação, sem assumir a execução do serviço contratado nem a gestão da relação com o consumidor, que permanecem com a ASSOCIAÇÃO e com as demais sociedades do grupo.
1.3. As frentes não contratadas nesta data podem ser acrescidas por simples registro no sistema de gestão, mediante concordância escrita de ambas as Partes, aplicando-se a elas, desde a inclusão, as regras deste Contrato.

CLÁUSULA 2 – DA NATUREZA DO VÍNCULO
2.1. O ORIGINADOR atua com autonomia, por conta própria, definindo livremente seus horários, métodos e meios de trabalho. Este Contrato não cria vínculo empregatício, societário, de representação comercial exclusiva, de franquia ou de consórcio entre as Partes, nem subordinação de qualquer espécie.
2.2. O ORIGINADOR não é empregado, preposto nem representante legal da ASSOCIAÇÃO, e responde por seus próprios tributos, encargos e despesas.
2.3. Cada Parte responde isoladamente por suas obrigações. Nenhuma Parte responde por obrigação assumida pela outra perante terceiros.

CLÁUSULA 3 – DA AUSÊNCIA DE EXCLUSIVIDADE
3.1. Não há exclusividade de parte a parte. O ORIGINADOR é livre para originar negócios para terceiros, inclusive concorrentes da ASSOCIAÇÃO, e a ASSOCIAÇÃO é livre para contratar quantos originadores entender necessários, em qualquer território.
3.2. A liberdade do item 3.1 não afasta as obrigações de confidencialidade da Cláusula 13 nem a vedação de aliciamento da Cláusula 14, que subsistem independentemente de exclusividade.
3.3. A ausência de exclusividade não gera, em nenhuma hipótese, direito a indenização, aviso prévio adicional, exclusividade territorial, reserva de clientela ou qualquer verba a esse título.

CLÁUSULA 4 – DOS LIMITES DE ATUAÇÃO
4.1. O ORIGINADOR não tem poderes para representar a ASSOCIAÇÃO, assinar contratos em seu nome, conceder descontos, prazos ou condições não previstos no material oficial, transigir, dar quitação ou assumir obrigações por ela.
4.2. É vedado ao ORIGINADOR receber, a qualquer título, valores de interessados, consumidores ou investidores. Todo pagamento é feito diretamente à ASSOCIAÇÃO ou à sociedade do grupo indicada no respectivo contrato.
4.3. O ORIGINADOR obriga-se a apresentar a oferta nos exatos termos do material oficial, sem prometer rentabilidade, economia, volume de compensação ou resultado que o material não assegure.

CAPÍTULO II — DA ORIGINAÇÃO E DA ATRIBUIÇÃO

CLÁUSULA 5 – DO REGISTRO E DA ATRIBUIÇÃO DO INDICADO
5.1. A atribuição de um indicado ao ORIGINADOR dá-se pelo registro no sistema de gestão da ASSOCIAÇÃO, por meio do link de indicação pessoal a ele fornecido ou por cadastro feito pela ASSOCIAÇÃO a seu pedido, sempre antes da adesão ou da contratação.
5.2. Prevalece o registro do sistema de gestão. Não há atribuição retroativa de indicado já cadastrado, já atendido ou que tenha chegado por outro canal, ainda que o ORIGINADOR demonstre contato anterior.
5.3. Havendo mais de um registro para o mesmo indicado, prevalece o primeiro em ordem cronológica.
5.4. O ORIGINADOR é responsável pela veracidade dos dados que informar e deve obter, do titular, o consentimento para o tratamento dos dados pessoais antes de cadastrá-lo.

CLÁUSULA 6 – DOS CARGOS E DA REDE
6.1. O ORIGINADOR é classificado em um dos cargos da Tabela de Recompensas vigente, registrado no Anexo I, que determina os percentuais e os níveis a que tem direito.
6.2. A progressão entre cargos observa os requisitos da Tabela de Recompensas, inclusive, quando for o caso, o pagamento de licença anual e o atingimento de rede mínima, e é registrada no sistema de gestão.
6.3. Estando a licença anual vencida na data da apuração, a recorrência do período fica suspensa e a parcela correspondente é absorvida pela ASSOCIAÇÃO, sem direito a recuperação retroativa após a regularização.
6.4. O ORIGINADOR vinculado a um Líder observa a estrutura registrada no sistema de gestão. A recompensa do Líder é devida por este Contrato na relação dele com a ASSOCIAÇÃO, e não constitui dedução nem obrigação do ORIGINADOR.

CAPÍTULO III — DA REMUNERAÇÃO

CLÁUSULA 7 – DO BÔNUS START
7.1. O Bônus Start é a recompensa de aquisição, devida sobre a Base de Cálculo Líquida das primeiras faturas elegíveis do indicado, no percentual do Anexo I e nos limites da Tabela de Recompensas do plano aplicável.
7.2. O Bônus Start é devido apenas no primeiro nível e não se cumula com a recorrência na mesma fatura, quando o plano assim dispuser.

CLÁUSULA 8 – DA RECORRÊNCIA
8.1. A Recorrência é a recompensa devida mês a mês sobre a Base de Cálculo Líquida das faturas dos indicados, no percentual do Anexo I, observados os níveis e os cortes da Tabela de Recompensas do plano aplicável.
8.2. Os níveis são contados em relação ao próprio ORIGINADOR, e não à profundidade da rede. Em cada fatura, cada cargo remunera no máximo um beneficiário.
8.3. A parcela que deixar de ser paga por corte de nível, por cadastro inativo, por licença vencida ou por qualquer outra supressão prevista na Tabela de Recompensas é absorvida pela ASSOCIAÇÃO, e não se transfere ao ORIGINADOR, ao Líder nem a terceiro.
8.4. Trava de margem. As recompensas deste Contrato, somadas às demais do mesmo negócio, não podem reduzir o resultado líquido do proprietário da usina abaixo do piso definido no plano. Atingido o piso, as parcelas são cortadas na ordem prevista na Tabela de Recompensas, até o restabelecimento do piso.
8.5. Base negativa. Resultando negativa a Base de Cálculo Líquida de determinada fatura, não há recompensa a pagar e também não há valor a devolver pelo ORIGINADOR.

CLÁUSULA 9 – DAS REGRAS POR FRENTE DE ORIGINAÇÃO
${clausulasPorModalidade(frentes)}

CLÁUSULA 10 – DO FATO GERADOR E DO PAGAMENTO
10.1. O fato gerador da recompensa é a compensação bancária do pagamento feito pelo indicado, e não a assinatura do contrato, a emissão da fatura ou a energia compensada na distribuidora.
10.2. Nenhuma recompensa é provisionada, adiantada ou antecipada antes da compensação referida no item 10.1. A inadimplência do indicado suspende de imediato as recompensas da respectiva fatura, que voltam a ser devidas se e quando o pagamento for compensado.
10.3. O crédito é feito preferencialmente por divisão automática do pagamento (split) no ato da compensação, na chave PIX indicada no Anexo I. Não havendo split, o pagamento é feito em até ${prazoPagamento} (${porExtenso(prazoPagamento)}) dias contados do fechamento do mês de apuração.
10.4. O ORIGINADOR pessoa jurídica emitirá documento fiscal correspondente. O ORIGINADOR pessoa física terá retidos na fonte os tributos e contribuições exigidos pela legislação.
10.5. O demonstrativo da apuração fica disponível ao ORIGINADOR no sistema de gestão. Divergências devem ser apontadas por escrito em até 90 (noventa) dias do crédito, findos os quais a apuração é tida por aceita.

CLÁUSULA 11 – DO ESTORNO
11.1. Cancelada a adesão, desfeito o negócio, confirmada fraude ou constatada irregularidade no cadastro do indicado em até ${prazoEstorno} (${porExtenso(prazoEstorno)}) meses do pagamento da recompensa, o valor correspondente será estornado.
11.2. O estorno é compensado nas recompensas seguintes. Não havendo recompensas suficientes em 90 (noventa) dias, o ORIGINADOR restituirá o saldo em 10 (dez) dias de notificação escrita.
11.3. O estorno por fraude não depende de prazo e não exclui as demais sanções deste Contrato nem a responsabilidade civil e penal.

CAPÍTULO IV — DAS OBRIGAÇÕES E DA CARTEIRA

CLÁUSULA 12 – DAS OBRIGAÇÕES DO ORIGINADOR
12.1. Apresentar-se sempre como parceiro autônomo, jamais como empregado, sócio ou representante legal da ASSOCIAÇÃO.
12.2. Utilizar marca, material de divulgação e peças de comunicação da ASSOCIAÇÃO apenas na forma e no período por ela autorizados, abstendo-se de criar peças, perfis, domínios ou anúncios que se apresentem como se fossem da ASSOCIAÇÃO.
12.3. Não praticar envio de mensagens não solicitadas em massa, captação enganosa, oferta casada ou qualquer prática vedada pela legislação de defesa do consumidor.
12.4. Prestar à ASSOCIAÇÃO as informações necessárias à apuração das recompensas e manter seu cadastro atualizado, inclusive a chave PIX.
12.5. Responder por perdas e danos a que der causa perante a ASSOCIAÇÃO ou terceiros, inclusive por informação falsa prestada a interessado.

CLÁUSULA 13 – DA CONFIDENCIALIDADE E DA PROTEÇÃO DE DADOS
13.1. São confidenciais, e não podem ser divulgados nem utilizados fora deste Contrato: tabelas de recompensa, condições comerciais, planos, minutas, metodologia, base de consumidores, dados de usinas e informações de desempenho.
13.2. O tratamento de dados pessoais observa a Lei nº 13.709/2018. O ORIGINADOR trata os dados dos indicados exclusivamente para a finalidade deste Contrato, na qualidade de operador, obrigando-se a não compartilhá-los com terceiros e a eliminá-los ao término deste Contrato.
13.3. As obrigações desta Cláusula subsistem por 5 (cinco) anos após o término deste Contrato.

CLÁUSULA 14 – DA CARTEIRA E DO NÃO ALICIAMENTO
14.1. A carteira de consumidores, eletropostos e investidores originados pertence à ASSOCIAÇÃO, independentemente de quem os tenha apresentado. O ORIGINADOR não adquire direito de retenção, cessão, penhor ou disposição sobre ela.
14.2. Durante a vigência e por ${naoAliciamento} (${porExtenso(naoAliciamento)}) meses após o término deste Contrato, o ORIGINADOR obriga-se a não aliciar, contatar com finalidade concorrente nem migrar para outro prestador os consumidores, eletropostos e investidores integrantes da carteira da ASSOCIAÇÃO a que tenha tido acesso.
14.3. A vedação do item 14.2 não impede o ORIGINADOR de atuar livremente no mercado, nos termos da Cláusula 3, com interessados que não integrem a carteira da ASSOCIAÇÃO.

CAPÍTULO V — DA VIGÊNCIA E DAS DISPOSIÇÕES FINAIS

CLÁUSULA 15 – DA VIGÊNCIA E DA RESCISÃO
15.1. Este Contrato vigora por prazo indeterminado a partir da assinatura.
15.2. Qualquer das Partes pode rescindi-lo imotivadamente, mediante aviso escrito com ${aviso} (${porExtenso(aviso)}) dias de antecedência.
15.3. A ASSOCIAÇÃO pode rescindi-lo de imediato, sem aviso prévio, em caso de fraude, informação falsa a interessado, uso indevido de dados ou de marca, aliciamento de carteira ou descumprimento das Cláusulas 4, 12, 13 e 14.
15.4. Encerramento da recorrência. Rescindido este Contrato por qualquer motivo, ou tornando-se inativo o cadastro do ORIGINADOR, cessa de imediato o direito à Recorrência sobre a carteira originada, inclusive quanto aos indicados que permanecerem ativos.
15.5. Permanecem devidas as recompensas cujo fato gerador — a compensação bancária prevista no item 10.1 — tenha ocorrido até a data do término, ainda que o crédito venha a ser processado depois.
15.6. A cessação da Recorrência não gera direito a indenização, aviso prévio adicional, compensação por carteira formada ou qualquer verba a esse título, o que as Partes expressamente ajustam.

CLÁUSULA 16 – DA ALTERAÇÃO DAS REGRAS DE RECOMPENSA
16.1. A ASSOCIAÇÃO pode rever a Tabela de Recompensas, os percentuais e as regras de nível, com aviso prévio de ${aviso} (${porExtenso(aviso)}) dias.
16.2. A revisão alcança apenas a produção futura. Os negócios já originados permanecem regidos pelas regras vigentes na data da respectiva ativação, que ficam registradas no sistema de gestão.
16.3. Discordando da revisão, o ORIGINADOR pode rescindir este Contrato na forma do item 15.2, observado o item 15.4.

CLÁUSULA 17 – DAS DISPOSIÇÕES GERAIS
17.1. A tolerância quanto ao descumprimento de qualquer obrigação não implica novação nem renúncia.
17.2. A nulidade de uma cláusula não contamina as demais.
17.3. Este Contrato não pode ser cedido pelo ORIGINADOR sem anuência escrita da ASSOCIAÇÃO.
17.4. As comunicações entre as Partes podem ser feitas por e-mail e pelo aplicativo de mensagens cadastrados, com os mesmos efeitos da forma escrita.
17.5. As Partes reconhecem a validade da assinatura eletrônica, nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020, aceitando como prova os registros de auditoria da plataforma utilizada.
17.6. Integra este Contrato o Anexo I — Quadro de Condições do ORIGINADOR, e, por referência, a Tabela de Recompensas vigente e o plano a que cada negócio originado estiver vinculado.

CLÁUSULA 18 – DO FORO
18.1. Fica eleito o foro da comarca de ${foro}, com renúncia a qualquer outro, por mais privilegiado que seja.

ANEXO I — QUADRO DE CONDIÇÕES DO ORIGINADOR

${anexoCondicoes(originador, lider, frentes)}

${cidadeUf}, ${dataPorExtenso()}.

________________________________________
${originador?.name || '_______________'}
${rotuloDocumento(originador?.cpf_cnpj)} ${originador?.cpf_cnpj || '_______________'} — Originador

________________________________________
ASSOCIAÇÃO DE USINAS B2W ENERGIA
CNPJ 64.561.352/0001-07 — Associação

TESTEMUNHAS:

1. ______________________________  Nome: __________________  CPF: ______________

2. ______________________________  Nome: __________________  CPF: ______________`;
};

export const dividirEmPaginasOriginador = (texto) => paginarTexto(texto);

export const gerarPdfContratoOriginadorBase64 = () => gerarPdfBase64('[data-contract="originador"]');

/** Baixa a minuta em PDF, para análise antes de mandar assinar. */
export const baixarPdfContratoOriginador = (nomeArquivo) =>
    baixarPdfContrato('[data-contract="originador"]', nomeArquivo);
