import { baixarPdfContrato, dataPorExtenso, gerarPdfBase64, paginarTexto, paraNumero, percentualExtenso, rotuloDocumento } from './contratoBase';

/**
 * Termo de Confidencialidade e Não Divulgação (NDA), gerado no modal do
 * lead, aba Comunicados.
 *
 * O texto-base é o NDA do investidor Rodrigo Fischer (out/2026), que o
 * dono aprovou como modelo. Os modelos abaixo mudam só o papel da
 * contraparte e a finalidade; a estrutura das 9 cláusulas é a mesma, para
 * que o número de cada cláusula não mude de um modelo para outro (a 8.2
 * cita a 6.2).
 *
 * Não há multa prefixada de propósito (Cláusula 7.1): a escolha do dono
 * foi cessação da conduta e reparação dos prejuízos comprovados.
 */

export const TITULO_NDA = 'Termo de Confidencialidade e Não Divulgação';

export const MODELOS_NDA = {
    investidor: {
        rotulo: 'NDA — Investidor (aquisição de usinas)',
        papel: 'INVESTIDOR',
        subtitulo: 'Fase de diligências — avaliação de oportunidade de aquisição de usinas fotovoltaicas',
        preambulo: (P) => `Este Termo existe para que as duas partes conversem com liberdade: o ${P} precisa ver números, contratos e resultados reais para decidir, e a ASSOCIAÇÃO só pode mostrá-los com a segurança de que servirão a essa avaliação. Nada aqui obriga o ${P} a fechar negócio, a manter exclusividade ou a justificar uma desistência.`,
        considerando: (P) => `o ${P} manifestou interesse na aquisição de usinas fotovoltaicas de geração distribuída nos termos da oferta que lhe foi apresentada, e que a análise dessa oportunidade exige acesso a documentos, dados e minutas contratuais da ASSOCIAÇÃO e das sociedades a ela ligadas`,
        finalidade: 'à avaliação da oportunidade e à eventual negociação dos contratos correspondentes',
        interesse: 'adquirir usinas nos termos da oferta apresentada',
        naoConcorrenciaAnos: 2
    },
    parceiro: {
        rotulo: 'Termo de Confidencialidade — Parceiro comercial',
        papel: 'PARCEIRO',
        subtitulo: 'Avaliação de parceria comercial',
        preambulo: (P) => `Este Termo existe para que as duas partes conversem com liberdade: o ${P} precisa conhecer dados, processos e condições reais para avaliar a parceria, e a ASSOCIAÇÃO só pode mostrá-los com a segurança de que servirão a essa avaliação. Nada aqui obriga qualquer das partes a fechar negócio, a manter exclusividade ou a justificar uma desistência.`,
        considerando: (P) => `o ${P} e a ASSOCIAÇÃO avaliam a celebração de parceria comercial, e que essa avaliação exige o compartilhamento de documentos, dados e informações da ASSOCIAÇÃO e das sociedades a ela ligadas`,
        finalidade: 'à avaliação e à eventual negociação da parceria entre as PARTES',
        interesse: 'avaliar e, se for o caso, celebrar a parceria descrita na Finalidade',
        naoConcorrenciaAnos: 0
    },
    prestador: {
        rotulo: 'Termo de Confidencialidade — Prestador de serviço / colaborador',
        papel: 'PRESTADOR',
        subtitulo: 'Acesso a informações para prestação de serviços',
        preambulo: (P) => `Este Termo existe para que o ${P} possa trabalhar com as informações de que precisa, e para que a ASSOCIAÇÃO possa compartilhá-las com a segurança de que servirão apenas a esse trabalho.`,
        considerando: (P) => `o ${P} presta ou poderá prestar serviços à ASSOCIAÇÃO, e que essa atividade exige acesso a documentos, dados, sistemas e informações da ASSOCIAÇÃO, de seus associados e das sociedades a ela ligadas`,
        finalidade: 'à execução dos serviços contratados ou em negociação com a ASSOCIAÇÃO',
        interesse: 'prestar à ASSOCIAÇÃO os serviços descritos na Finalidade',
        naoConcorrenciaAnos: 0
    }
};

export const DEFAULTS_NDA = {
    modelo: 'investidor',
    nacionalidade: 'brasileiro(a)',
    nascimento: '',
    representante: '',
    representanteCpf: '',
    prazoSigiloAnos: 5,
    naoConcorrenciaAnos: 2,
    devolucaoDias: 30,
    foro: 'Natal, Estado do Rio Grande do Norte',
    cidade: 'Natal/RN'
};

const lacuna = (v, alt = '_______________') => String(v ?? '').trim() || alt;

const extenso = (n) => `${n} (${percentualExtenso(n)})`;

const inteiro = (valor, padrao) => {
    const n = paraNumero(valor);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : padrao;
};

/** Cidade/UF do lead, para "residente e domiciliado em". */
const localDoLead = (lead) => {
    const cidade = lead?.cidade || lead?.address?.cidade || lead?.address?.municipio || '';
    const uf = lead?.uf || lead?.address?.uf || '';
    return [cidade, uf].filter(Boolean).join('/');
};

const qualificaContraparte = (lead, p, papel) => {
    const nome = lacuna(lead?.name).toUpperCase();
    const doc = lead?.cpf_cnpj || '';
    const email = lead?.email ? `, e-mail ${lead.email}` : '';
    const local = lacuna(localDoLead(lead));

    if (rotuloDocumento(doc) === 'CNPJ') {
        return `${nome}, pessoa jurídica de direito privado, CNPJ ${lacuna(doc)}, com sede em ${local}${email}, neste ato representada por ${lacuna(p.representante)}, CPF ${lacuna(p.representanteCpf)} (${papel})`;
    }
    const nascimento = String(p.nascimento || '').trim() ? `, nascido(a) em ${p.nascimento}` : '';
    return `${nome}, ${lacuna(p.nacionalidade, 'brasileiro(a)')}${nascimento}, CPF ${lacuna(doc)}, residente e domiciliado(a) em ${local}${email} (${papel})`;
};

/**
 * Texto completo do NDA.
 *
 * @param lead  linha de `leads`
 * @param opts  campos do painel; o que faltar usa DEFAULTS_NDA e o modelo
 */
export const montarTextoNda = (lead, opts = {}, data = new Date()) => {
    const p = { ...DEFAULTS_NDA, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && v !== null && v !== '')) };
    const m = MODELOS_NDA[p.modelo] || MODELOS_NDA.investidor;
    const P = m.papel;

    const sigilo = inteiro(p.prazoSigiloAnos, DEFAULTS_NDA.prazoSigiloAnos) || DEFAULTS_NDA.prazoSigiloAnos;
    const naoConcorrencia = inteiro(p.naoConcorrenciaAnos, m.naoConcorrenciaAnos);
    const devolucao = inteiro(p.devolucaoDias, DEFAULTS_NDA.devolucaoDias) || DEFAULTS_NDA.devolucaoDias;
    const doc = lead?.cpf_cnpj || '';
    const rotuloDoc = rotuloDocumento(doc) === 'CNPJ' ? 'CNPJ' : 'CPF';

    // Com prazo zero a cláusula 5 perde a declaração de não concorrência,
    // mas continua existindo: as demais cláusulas não mudam de número.
    const clausula5 = naoConcorrencia > 0
        ? `5. INTERESSE E NÃO CONCORRÊNCIA
5.1. O ${P} declara que seu interesse é ${m.interesse}, e que não tem a intenção de constituir, sozinho ou com terceiros, empresa ou associação destinada a concorrer diretamente com a ASSOCIAÇÃO na gestão de créditos de energia em geração distribuída, em todo o território nacional, pelos ${extenso(naoConcorrencia)} ${naoConcorrencia === 1 ? 'ano seguinte' : 'anos seguintes'} a esta data. Alterando-se esse propósito, comunicará a ASSOCIAÇÃO por escrito, podendo qualquer das PARTES encerrar as tratativas sem ônus.
5.2. Este Termo não restringe o direito do ${P} de atuar no setor de energia, de investir em geração distribuída ou de adquirir usinas de terceiros. O que se veda, em qualquer cenário, é o uso da informação recebida para construir ou favorecer atividade concorrente.`
        : `5. LIBERDADE DE ATUAÇÃO
5.1. Este Termo não restringe o direito do ${P} de atuar no setor de energia, de investir em geração distribuída ou de contratar com terceiros. O que se veda, em qualquer cenário, é o uso da informação recebida para construir ou favorecer atividade concorrente.`;

    return `${TITULO_NDA.toUpperCase()}
${m.subtitulo}

${m.preambulo(P)}

ASSOCIAÇÃO DE USINAS B2W ENERGIA, associação de direito privado, CNPJ 64.561.352/0001-07, com sede na Praça Apolinário Barbosa, nº 86, 1º andar, Centro, Caraí/MG, CEP 39.810-000, telefone (84) 98177-0208, e-mail waldineygodoy@gmail.com, neste ato representada na forma de seu Estatuto Social (ASSOCIAÇÃO); e ${qualificaContraparte(lead, p, P)}, em conjunto PARTES, celebram este Termo, considerando que ${m.considerando(P)}.

1. FINALIDADE
1.1. As informações reveladas pela ASSOCIAÇÃO — antes ou depois desta data — destinam-se exclusivamente ${m.finalidade} (Finalidade).
1.2. As mesmas regras protegem, com os papéis invertidos, as informações que o ${P} revelar à ASSOCIAÇÃO.

2. O QUE É CONFIDENCIAL
2.1. É confidencial tudo o que for revelado em razão da Finalidade, esteja ou não marcado como tal: minutas, contratos e condições comerciais; projetos, pareceres de acesso, dados de geração, desempenho e custos; informações financeiras, societárias e de resultado; a metodologia, os processos e o modelo de negócio da ASSOCIAÇÃO e do grupo a que pertence; a identidade e as condições praticadas com associados, consumidores, proprietários de usinas, investidores e fornecedores; e o próprio fato de existirem estas tratativas.
2.2. Não é confidencial o que já era público, o que o ${P} já conhecia por meio legítimo, o que vier de terceiro sem dever de sigilo ou o que ele desenvolver de forma independente. A revelação exigida por lei ou por ordem judicial não viola este Termo, devendo a PARTE, quando puder, avisar a outra antes e limitar-se ao estritamente exigido.

3. COMO A INFORMAÇÃO PODE SER USADA
3.1. O ${P} usará a informação apenas para a Finalidade, com o cuidado que dedica às suas próprias informações sigilosas.
3.2. Sem autorização escrita, não reproduzirá, publicará, cederá nem compartilhará os documentos com terceiros; não empregará a informação para replicar a metodologia ou o modelo de negócio da ASSOCIAÇÃO, nem para deles fazer engenharia reversa; e não a utilizará para prospectar ou aliciar associados, consumidores, proprietários de usinas, investidores, fornecedores ou colaboradores da ASSOCIAÇÃO.
3.3. Nada neste Termo transfere ao ${P} propriedade, licença ou uso sobre a informação, que permanece da ASSOCIAÇÃO.

4. COM QUEM ELE PODE COMPARTILHAR
4.1. O ${P} pode compartilhar o necessário com seus advogados, contadores, auditores e consultores; com seus sócios e demais pessoas que participem da decisão; e com intervenientes necessários à execução do eventual contrato, como instituições financeiras, seguradoras e responsáveis técnicos.
4.2. Em qualquer caso, informará ao destinatário a natureza sigilosa do material e responderá pelo cumprimento deste Termo por quem tiver acesso por seu intermédio.

${clausula5}

6. LIBERDADE DAS PARTES E DEVOLUÇÃO DO MATERIAL
6.1. Este Termo não obriga ninguém a contratar, a manter exclusividade ou a prosseguir nas tratativas, e as minutas compartilhadas são documentos de trabalho, que só vinculam depois de assinados.
6.2. Encerradas as tratativas sem contrato, o ${P} devolverá ou eliminará o material recebido em até ${extenso(devolucao)} dias da solicitação escrita, ressalvadas as cópias que deva conservar por obrigação legal ou rotina de backup, que seguem protegidas enquanto existirem.

7. USO INDEVIDO
7.1. Havendo uso da informação para finalidade diversa da Finalidade, ou utilização fraudulenta dos documentos, a PARTE prejudicada poderá pleitear judicialmente a cessação imediata da conduta, inclusive em caráter liminar, e a reparação integral dos prejuízos comprovados, na forma dos arts. 186, 187 e 927 do Código Civil. Não se estipula multa prefixada.
7.2. Condutas dessa natureza podem ainda configurar concorrência desleal (art. 195 da Lei nº 9.279/1996) e ilícito penal (arts. 153 e 154 do Código Penal, entre outros). A enunciação dessas consequências é esclarecedora e não presume má-fé de nenhuma das PARTES.

8. PRAZO, DADOS PESSOAIS E DISPOSIÇÕES GERAIS
8.1. O sigilo é devido por ${extenso(sigilo)} ${sigilo === 1 ? 'ano contado' : 'anos contados'} do encerramento das tratativas ou da assinatura do contrato definitivo, o que ocorrer primeiro; celebrado o contrato, prevalecem as cláusulas de confidencialidade nele previstas.
8.2. Os dados pessoais serão tratados apenas para a Finalidade, conforme a Lei nº 13.709/2018 (LGPD), e eliminados no prazo da cláusula 6.2, ressalvada a conservação exigida por lei ou necessária ao exercício regular de direitos.
8.3. Este Termo não cria vínculo societário, associativo, de parceria ou empregatício; só se altera por escrito; a nulidade de uma cláusula não afeta as demais; e as PARTES admitem a assinatura eletrônica, na forma da MP nº 2.200-2/2001 e da Lei nº 14.063/2020.

9. FORO
9.1. As PARTES buscarão solução amigável por 30 (trinta) dias contados da comunicação escrita da divergência. Frustrada a composição, fica eleito o foro da Comarca de ${lacuna(p.foro)}, com renúncia a qualquer outro.

E, por estarem justas e contratadas, as PARTES assinam este Termo em 2 (duas) vias de igual teor, na presença de 2 (duas) testemunhas.

${lacuna(p.cidade)}, ${dataPorExtenso(data)}.


____________________________________________
ASSOCIAÇÃO DE USINAS B2W ENERGIA
CNPJ 64.561.352/0001-07


____________________________________________
${lacuna(lead?.name).toUpperCase()}
${rotuloDoc} ${lacuna(doc)}


____________________________________________
Testemunha 1 — CPF: ____________________


____________________________________________
Testemunha 2 — CPF: ____________________`;
};

// Cabeçalho de cláusula do NDA: "1. FINALIDADE", "5. INTERESSE E NÃO CONCORRÊNCIA".
const CABECALHO_NDA = /^\d+\. [A-ZÀ-Ú][A-ZÀ-Ú ,]+$/gm;

export const dividirEmPaginasNda = (texto) => paginarTexto(texto, 32, CABECALHO_NDA);

export const gerarPdfNdaBase64 = () => gerarPdfBase64('[data-contract="nda"]');

export const baixarPdfNda = (nomeArquivo) => baixarPdfContrato('[data-contract="nda"]', nomeArquivo);
