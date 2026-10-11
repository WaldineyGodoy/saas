import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * Mecânica compartilhada pelos dois contratos (assinante e fornecedor).
 *
 * Antes só existia o termo do assinante, com uma lista fixa de quatro IDs
 * de página. O contrato do fornecedor é maior e o do assinante cresceu:
 * uma lista fixa significa página faltando no PDF quando o texto passa do
 * previsto — e ninguém percebe, porque o PDF continua sendo gerado.
 * Aqui a paginação é por conteúdo e a captura varre o DOM.
 */

/** Marca usada pelos componentes de contrato em cada folha renderizada. */
export const ATRIBUTO_PAGINA = 'data-contract-page';

// Texto (extenso, datas, paginação...): fonte única com as Edge Functions.
export {
    porExtenso,
    extensoReais,
    percentualExtenso,
    numeroBr,
    valorEmReais,
    rotuloDocumento,
    qualificaParte,
    dataPorExtenso,
    moeda,
    paraNumero,
    identificadorDocumento,
    paginarTexto,
    semTituloRepetido,
} from '../../supabase/functions/_shared/contrato-texto.js';

/**
 * Captura todas as folhas marcadas com `data-contract-page` e devolve o
 * PDF em base64.
 *
 * A altura de cada folha é respeitada: uma página que cresceu além do A4
 * entra no PDF como página mais alta em vez de ser cortada no meio.
 *
 * @param seletor permite gerar o PDF de um contrato específico quando dois
 *                estiverem montados ao mesmo tempo (ex.: `[data-contract="fornecedor"]`)
 */
const montarPdfContrato = async (seletor) => {
    // Dá tempo de o React montar as páginas e o logo carregar.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const elementos = Array.from(document.querySelectorAll(seletor));
    if (elementos.length === 0) {
        throw new Error('Nenhuma página do contrato foi encontrada no DOM.');
    }

    const pdf = new jsPDF('p', 'mm', 'a4');
    const larguraPagina = 210;
    const alturaA4 = 297;
    let capturadas = 0;

    for (const elemento of elementos) {
        const canvas = await html2canvas(elemento, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff'
        });

        const altura = (canvas.height * larguraPagina) / canvas.width;
        if (capturadas > 0) pdf.addPage([larguraPagina, Math.max(altura, alturaA4)]);
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, larguraPagina, altura, undefined, 'FAST');
        capturadas++;
    }

    if (capturadas === 0) throw new Error('Nenhuma página do contrato pôde ser capturada.');

    return pdf;
};

/** O PDF em base64, do jeito que a Autentique recebe. */
export const gerarPdfBase64 = async (seletor = `[${ATRIBUTO_PAGINA}]`) =>
    (await montarPdfContrato(seletor)).output('datauristring').split(',')[1];

/**
 * O mesmo PDF, salvo no computador de quem clicou.
 *
 * É o caminho da minuta para análise prévia: o contrato ainda não vai à
 * assinatura, mas o arquivo já pode ser lido e comentado pela outra parte.
 */
export const baixarPdfContrato = async (seletor, nomeArquivo) => {
    const pdf = await montarPdfContrato(seletor);
    pdf.save(nomeArquivo);
};

/** Estilos das folhas. Ficam aqui, e não no componente, porque o
 *  react-refresh exige que um módulo de componente exporte só componentes. */
export const corpoContrato = { whiteSpace: 'pre-wrap', fontSize: '10pt', lineHeight: '1.5', textAlign: 'justify' };

export const tituloContrato = { fontSize: '20px', textAlign: 'center', marginBottom: '10mm', fontWeight: 'bold', textTransform: 'uppercase', color: '#003366' };
