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

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZ_A_DEZENOVE = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];

const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
    'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/**
 * Escreve um inteiro de 0 a 999 por extenso.
 *
 * O contrato precisa do número em algarismo e por extenso — quando os
 * dois divergem, prevalece o extenso (art. 12 da Lei do Cheque por
 * analogia, e é o que a jurisprudência aplica a contratos). Gerar o
 * extenso a partir do mesmo número elimina a divergência na origem.
 *
 * Ia só até 100, o que bastava para percentuais. Os prazos da Cláusula 13
 * passam disso: 180 caía em DEZENAS[18] e o contrato sairia com
 * "180 (undefined) dias".
 */
export const porExtenso = (n) => {
    const v = Math.round(Number(n) || 0);
    if (v <= 0) return 'zero';
    if (v === 100) return 'cem';

    if (v > 100) {
        const c = Math.floor(v / 100);
        const resto = v % 100;
        if (c >= 1 && c <= 9) {
            return resto === 0 ? CENTENAS[c] : `${CENTENAS[c]} e ${porExtenso(resto)}`;
        }
        return String(v);
    }

    if (v < 10) return UNIDADES[v];
    if (v < 20) return DEZ_A_DEZENOVE[v - 10];
    const d = Math.floor(v / 10);
    const u = v % 10;
    return u === 0 ? DEZENAS[d] : `${DEZENAS[d]} e ${UNIDADES[u]}`;
};

/**
 * Percentual por extenso, inclusive quebrado.
 *
 * `porExtenso` sozinho arredonda: 12,5 virava "treze", e o contrato saía
 * com "12.5% (treze por cento)" — algarismo e extenso discordando. Num
 * contrato prevalece o extenso, então uma taxa de 12,5% seria lida como
 * 13%. Aqui 12,5 vira "doze vírgula cinco".
 */
export const percentualExtenso = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    if (Number.isInteger(v)) return porExtenso(v);

    const [inteira, decimal] = String(v).split('.');
    const casas = decimal.split('').map(d => porExtenso(Number(d))).join(' ');
    return `${porExtenso(Number(inteira))} vírgula ${casas}`;
};

/** Número no formato daqui: 12.5 -> "12,5", 20 -> "20". */
export const numeroBr = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const dataPorExtenso = (data = new Date()) =>
    `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}`;

export const moeda = (valor) =>
    (Number(valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Lê um número digitado por gente daqui.
 *
 * `Number('17,5')` é NaN, e um `<input type="number">` nem deixa a vírgula
 * ser digitada: devolve string vazia e o campo parece recusar o valor. Os
 * campos de percentual do contrato são texto por isso, e a conversão mora
 * aqui.
 */
export const paraNumero = (valor) => {
    if (typeof valor === 'number') return valor;

    const texto = String(valor ?? '').trim();
    if (!texto) return NaN;

    // "17,5" e "1.234,56" vêm do teclado brasileiro; "17.5" vem de quem
    // digitou no teclado numérico ou colou de uma planilha em inglês.
    const normalizado = texto.includes(',')
        ? texto.replace(/\./g, '').replace(',', '.')
        : texto;

    const numero = Number(normalizado);
    return Number.isFinite(numero) ? numero : NaN;
};

/**
 * Código curto e determinístico do conteúdo do contrato.
 *
 * Vai no rodapé de todas as folhas. Serve para amarrar as páginas ao mesmo
 * documento: folha de outra versão do contrato carrega outro código, então
 * substituir ou remover página deixa rastro. É marcador de integridade, não
 * hash criptográfico — a prova da assinatura continua sendo a da Autentique.
 */
export const identificadorDocumento = (texto = '') => {
    const fnv = (semente) => {
        let h = semente;
        for (let i = 0; i < texto.length; i++) {
            h ^= texto.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(36).toUpperCase().padStart(7, '0');
    };
    return `${fnv(0x811c9dc5)}-${fnv(0x1000193)}`;
};

/** Caracteres que cabem numa linha justificada de 170mm em serif 11pt. */
const CARACTERES_POR_LINHA = 95;

/**
 * Altura de um trecho, contada em linhas renderizadas.
 *
 * Cada quebra de linha do texto consome pelo menos uma linha na folha,
 * mesmo quando tem três palavras — é isso que a contagem por caracteres
 * ignorava.
 */
const alturaEmLinhas = (trecho) =>
    trecho.split('\n').reduce((total, linha) => total + Math.max(1, Math.ceil(linha.length / CARACTERES_POR_LINHA)), 0);

/**
 * Quebra o texto em páginas cortando sempre no início de uma cláusula.
 *
 * O corte por índice fixo de cláusula que existia antes só funcionava para
 * um texto de tamanho conhecido. Aqui o limite é de caracteres e o corte
 * respeita o cabeçalho da cláusula, para nenhuma folha começar no meio de
 * uma frase.
 *
 * A medida é em LINHAS RENDERIZADAS, não em caracteres. Contar caracteres
 * parecia bastar até as folhas cheias de alíneas ("(a) ...", "(b) ...")
 * estourarem o A4 com metade do texto de uma folha de parágrafos corridos:
 * uma alínea curta ocupa uma linha inteira na mesma altura de uma linha
 * cheia. O limite de 30 e os 95 caracteres por linha foram medidos no
 * layout real (A4, margem de 20mm, serif 11pt, entrelinha 1.5).
 *
 * @param texto           corpo do contrato
 * @param linhasPorPagina linhas úteis por folha, já descontados logo e rodapé
 */
export const paginarTexto = (texto, linhasPorPagina = 30) => {
    if (!texto) return [''];

    // Cada bloco começa num cabeçalho de cláusula/capítulo, ou é o preâmbulo.
    const marcadores = [...texto.matchAll(/^(?:CLÁUSULA|CAPÍTULO|ANEXO)\b.*$/gim)];
    if (marcadores.length === 0) return [texto];

    const blocos = [];
    let cursor = 0;
    for (const m of marcadores) {
        if (m.index > cursor) blocos.push(texto.slice(cursor, m.index));
        cursor = m.index;
    }
    blocos.push(texto.slice(cursor));

    // Cláusula sozinha maior que a folha (a 5 e a 9 são) precisa ser
    // quebrada por linha, senão a folha cresce além do A4 e o PDF sai com
    // páginas de alturas diferentes no meio do contrato.
    const blocosCabiveis = blocos.flatMap(bloco => {
        if (alturaEmLinhas(bloco) <= linhasPorPagina) return [bloco];

        const pedacos = [];
        let pedaco = '';
        for (const linha of bloco.split('\n')) {
            if (pedaco && alturaEmLinhas(`${pedaco}\n${linha}`) > linhasPorPagina) {
                pedacos.push(pedaco);
                pedaco = '';
            }
            pedaco += (pedaco ? '\n' : '') + linha;
        }
        if (pedaco) pedacos.push(pedaco);
        return pedacos;
    });

    const paginas = [];
    let atual = '';
    for (const bloco of blocosCabiveis) {
        if (atual && alturaEmLinhas(atual + bloco) > linhasPorPagina) {
            paginas.push(atual);
            atual = bloco;
        } else {
            atual += bloco;
        }
    }
    if (atual.trim()) paginas.push(atual);

    return paginas.length ? paginas : [texto];
};

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
export const gerarPdfBase64 = async (seletor = `[${ATRIBUTO_PAGINA}]`) => {
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

    return pdf.output('datauristring').split(',')[1];
};

/** Estilos das folhas. Ficam aqui, e não no componente, porque o
 *  react-refresh exige que um módulo de componente exporte só componentes. */
export const corpoContrato = { whiteSpace: 'pre-wrap', fontSize: '11pt', lineHeight: '1.5', textAlign: 'justify' };

export const tituloContrato = { fontSize: '20px', textAlign: 'center', marginBottom: '10mm', fontWeight: 'bold', textTransform: 'uppercase', color: '#003366' };
