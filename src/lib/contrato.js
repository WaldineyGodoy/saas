import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
/**
 * Contrato de adesão — fonte única.
 *
 * Vivia dentro do SubscriberModal e só podia ser gerado por um admin
 * clicando num botão. A adesão pública agora gera o mesmo documento
 * sozinha, então o texto, o layout e a rotina de PDF passaram a morar
 * aqui: dois geradores com dois contratos diferentes é o tipo de
 * divergência que ninguém percebe até um cliente assinar a versão errada.
 */

export const IDS_PAGINAS_CONTRATO = [
    'contract-page-1',
    'contract-page-2',
    'contract-page-3',
    'contract-page-4'
];

const enderecoCompleto = (s) =>
    `${s?.rua || ''}, ${s?.numero || ''} ${s?.complemento || ''} - ${s?.bairro || ''}, ${s?.cidade || ''}/${s?.uf || ''}`;

/**
 * Rótulo da distribuidora usado no corpo do termo.
 *
 * As cláusulas 1, 7 e 13 tinham "COSERN" escrito na mão: todo assinante
 * de outra concessionária assinava um contrato citando a distribuidora
 * errada. Agora vem da UC. Sem UC identificada, o texto fica genérico —
 * um termo vago é ruim, mas um termo com o nome errado é pior.
 */
const rotuloDistribuidora = (distribuidora) =>
    (distribuidora || '').trim() || 'sua distribuidora local';

/**
 * Monta o corpo do termo a partir dos dados do assinante.
 *
 * @param subscriber   dados cadastrais do associado
 * @param distribuidora concessionária da UC (`consumer_units.concessionaria`)
 */
export const montarTextoContrato = (subscriber, distribuidora) => {
    const fullAddress = enderecoCompleto(subscriber);
    const DIST = rotuloDistribuidora(distribuidora);

    return `ASSOCIAÇÃO DE USINAS B2W ENERGIA

(I). ASSOCIAÇÃO: ASSOCIAÇÃO DE USINAS B2W ENERGIA, associação de direito privado, CNPJ 64.561.352/0001-07 com sede na Praça Apolinario Barbosa, 86 – Centro, Caraí/MG, CEP 39800-000, neste ato representada na forma do seu Estatuto Social por seu presidente;

(II). ASSOCIADO: ${subscriber?.name || ''}, ${subscriber?.cpf_cnpj || ''}, ${fullAddress}

CLÁUSULA 1 – DO OBJETO
O presente Termo tem por objeto o ingresso do ASSOCIADO na ASSOCIAÇÃO DE USINAS B2W ENERGIA, para participação no modelo de geração compartilhada, com compensação de créditos de energia elétrica no Sistema de Compensação de Energia Elétrica (SCEE), nos termos da Lei nº 14.300/2022 e normas da ANEEL, junto à distribuidora ${DIST}.

CLÁUSULA 2 – DA NATUREZA DA OPERAÇÃO
O ASSOCIADO declara ciência de que não há venda direta de energia elétrica, mas sim a participação em sistema de geração compartilhada por meio de associação.

CLÁUSULA 3 – DA ECONOMIA E BENEFÍCIOS
O ASSOCIADO terá direito a descontos na fatura de energia elétrica, proporcionais à sua cota de participação na geração da associação.

CLÁUSULA 4 – DOS PRAZOS
A adesão tem prazo indeterminado, podendo ser rescindida por ambas as partes com aviso prévio de 90 dias.

CLÁUSULA 5 – DA PROTEÇÃO DE DADOS
As partes declaram conformidade com a Lei Geral de Proteção de Dados (LGPD).

CLÁUSULA 6 – DO FORO
Fica eleito o foro da comarca de Teófilo Otoni/MG para dirimir quaisquer dúvidas.

CLÁUSULA 7 – DA TRANSPARÊNCIA E DEMONSTRATIVO DE CÁLCULO
A Associação disponibilizará mensalmente demonstrativo através do seu aplicativo ou portal do cliente contendo:
(i) consumo total do período;
(ii) energia compensada em kWh;
(iii) valores cobrados pela ${DIST};
(iv) base de cálculo do desconto; e
(v) economia obtida, enviado por meio eletrônico.

CLÁUSULA 8 – DA INADIMPLÊNCIA
O inadimplemento acarretará:
(a) até 14 dias, suspensão do desconto no período;
(b) a partir de 30 dias, suspensão da compensação; e
(c) a partir de 60 dias, rescisão contratual e medidas de cobrança, sempre mediante comunicação prévia ao ASSOCIADO.

CLÁUSULA 9 – DO PRAZO
O presente Termo vige por prazo indeterminado, iniciando-se na data de confirmação da compensação pela distribuidora.

CLÁUSULA 10 – DA RESCISÃO PELO ASSOCIADO
O ASSOCIADO poderá solicitar desligamento mediante aviso prévio mínimo de 90 (noventa) dias ou 3 (três) ciclos de compensação, o que ocorrer por último.

CLÁUSULA 11 – DA RESCISÃO PELA ASSOCIAÇÃO
A Associação poderá rescindir o Termo em caso de descumprimento contratual, inviabilidade regulatória ou operacional, mediante comunicação prévia, ressalvadas hipóteses de urgência.

CLÁUSULA 12 – DA REALOCAÇÃO OPERACIONAL
A Associação poderá realocar o ASSOCIADO entre estruturas equivalentes de geração compartilhada do mesmo grupo econômico, desde que mantidas as condições comerciais, mediante comunicação prévia.

CLÁUSULA 13 – DA REPRESENTAÇÃO OPERACIONAL
O ASSOCIADO autoriza a Associação a representá-lo junto à ${DIST} exclusivamente para fins operacionais relacionados ao SCEE, durante a vigência deste Termo, vedado qualquer uso diverso.

CLÁUSULA 14 – DA AUSÊNCIA DE INVESTIMENTO
O ASSOCIADO declara ciência de que não realiza qualquer investimento financeiro em usinas ou ativos, inexistindo expectativa de retorno financeiro além do desconto na fatura.

CLÁUSULA 15 – DA PROTEÇÃO DE DADOS
Os dados pessoais serão tratados conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), exclusivamente para execução deste Termo.

CLÁUSULA 16 – DA RESPONSABILIDADE
A Associação não se responsabiliza por alterações tarifárias, regulatórias ou tributárias impostas por órgãos competentes, nem por falhas da distribuidora.

CLÁUSULA 17 – DO FORO
Fica eleito o foro do domicílio do ASSOCIADO, com renúncia a qualquer outro, por mais privilegiado que seja.

E, por estarem de acordo, as partes aderem eletronicamente ao presente Termo.

________________________________________
ASSOCIAÇÃO DE USINAS B2W ENERGIA
Presidente

________________________________________
Nome do associado : ${subscriber?.name || ''}
CNPJ/CPF : ${subscriber?.cpf_cnpj || ''}
Associado`;
};

/** Quebra o termo em 3 páginas usando as cláusulas 7 e 14 como cortes. */
export const dividirEmPaginas = (texto) => {
    if (!texto) return ['', '', ''];

    const c7 = texto.match(/CLÁUSULA\s+7/i);
    const c14 = texto.match(/CLÁUSULA\s+14/i);
    const i7 = c7 ? c7.index : -1;
    const i14 = c14 ? c14.index : -1;

    if (i7 !== -1 && i14 !== -1 && i14 > i7) {
        return [texto.substring(0, i7), texto.substring(i7, i14), texto.substring(i14)];
    }
    if (i7 !== -1) {
        return [texto.substring(0, i7), texto.substring(i7), ''];
    }
    return [texto, '', ''];
};

/**
 * Captura as páginas montadas e devolve o PDF em base64.
 * Lança se nenhuma página estiver no DOM — sem isso o Autentique recebia
 * um documento vazio e ninguém percebia até o cliente abrir o link.
 */
export const gerarPdfContratoBase64 = async () => {
    // Dá tempo de o React montar as páginas e o logo carregar.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const pdf = new jsPDF('p', 'mm', 'a4');
    const larguraPagina = 210;
    let capturadas = 0;

    for (const id of IDS_PAGINAS_CONTRATO) {
        const elemento = document.getElementById(id);
        if (!elemento) {
            console.warn(`Página ${id} não encontrada no DOM.`);
            continue;
        }

        const canvas = await html2canvas(elemento, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff'
        });

        const altura = (canvas.height * larguraPagina) / canvas.width;
        if (capturadas > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, larguraPagina, altura, undefined, 'FAST');
        capturadas++;
    }

    if (capturadas === 0) throw new Error('Nenhuma página do contrato pôde ser capturada.');

    return pdf.output('datauristring').split(',')[1];
};
