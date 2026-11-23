/**
 * Chamada de rede da leitura de documento de identificação. As regras de
 * preenchimento estão em `documentoIdentidade.js` (sem Supabase, testáveis).
 */
import { supabase } from './supabase';
import { reduzirFoto } from './energyBillImage';
import { lerErroFuncao } from './onboarding';

const LADO_MAXIMO = 2000;   // px por pagina; acima disso a leitura nao melhora
const PAGINAS_MAXIMAS = 2;  // frente e verso em paginas separadas

/**
 * PDF de documento vira IMAGEM no navegador antes de ir para leitura.
 *
 * Nao se manda o PDF ao servidor: o conversor de texto dele so enxerga a camada
 * de texto, e a CNH Digital (e RG escaneado) traz os dados do titular como
 * imagem, com texto so no rodape ("Documento assinado com certificado
 * digital..."). Renderizada, a leitura enxerga o que a pessoa ve na tela.
 * Ate duas paginas, empilhadas, para frente e verso em paginas separadas.
 */
export async function pdfParaImagem(arquivo) {
    const pdfjsLib = await import('pdfjs-dist');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
    }
    const pdf = await pdfjsLib.getDocument({ data: await arquivo.arrayBuffer() }).promise;

    const paginas = [];
    for (let n = 1; n <= Math.min(pdf.numPages, PAGINAS_MAXIMAS); n++) {
        const pagina = await pdf.getPage(n);
        const base = pagina.getViewport({ scale: 1 });
        const viewport = pagina.getViewport({ scale: Math.min(3, LADO_MAXIMO / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pagina.render({ canvasContext: ctx, canvas, viewport }).promise;
        paginas.push(canvas);
    }
    if (!paginas.length) throw new Error('O PDF está vazio.');
    if (paginas.length === 1) return paginas[0].toDataURL('image/jpeg', 0.85);

    const junto = document.createElement('canvas');
    junto.width = Math.max(...paginas.map((c) => c.width));
    junto.height = paginas.reduce((soma, c) => soma + c.height, 0);
    const ctx = junto.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, junto.width, junto.height);
    let y = 0;
    for (const c of paginas) { ctx.drawImage(c, 0, y); y += c.height; }
    return junto.toDataURL('image/jpeg', 0.85);
}

/**
 * Envia a foto ou o PDF do documento para leitura e devolve
 * `{ tipoDocumento, nome, cpf, cpfLido, nascimento, observacoes }`.
 * Foto é reduzida antes (celular manda 4000px+ e vários MB); PDF é renderizado
 * como imagem no navegador.
 */
export async function lerDocumentoIdentidade(arquivo) {
    const ehPdf = arquivo.type === 'application/pdf';
    // Sempre vai uma imagem: foto reduzida, ou o PDF renderizado (ver pdfParaImagem).
    const imageBase64 = ehPdf ? await pdfParaImagem(arquivo) : await reduzirFoto(arquivo);
    const { data, error } = await supabase.functions.invoke('ler-documento-identidade', {
        body: { imageBase64, mediaType: 'image/jpeg' },
    });
    // functions.invoke devolve o erro em `error`, nao lanca; a mensagem util vem no corpo.
    if (error || !data?.ok) {
        let mensagem = data?.error;
        if (!mensagem && error) mensagem = (await lerErroFuncao(error))?.mensagem;
        throw new Error(mensagem || 'Falha ao ler o documento.');
    }
    return data.dados;
}
