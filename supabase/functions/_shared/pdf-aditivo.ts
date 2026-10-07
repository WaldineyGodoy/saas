import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

/**
 * PDF do termo aditivo, montado no servidor (pdf-lib): o pedido vem do app,
 * sem CRM no meio para gerar no navegador como nos outros contratos.
 * Termo nas primeiras paginas, procuracao na ultima; cada uma com a linha de
 * assinatura na altura onde a Autentique carimba (ASSINATURA_Y_PCT).
 */
const A4 = { w: 595.28, h: 841.89 }
const MARGEM = 56
const CORPO = 10.5
const ENTRELINHA = 14.5
// Area da assinatura: a Autentique posiciona pelo percentual da pagina (y do topo).
export const ASSINATURA_Y_PCT = 82
const LIMITE_TEXTO = A4.h * (1 - 0.72) // texto da ultima pagina termina acima de 72%

const quebrar = (texto: string, fonte: PDFFont, tamanho: number, largura: number) => {
    const linhas: string[] = []
    let atual = ''
    for (const palavra of texto.split(/\s+/)) {
        const tentativa = atual ? `${atual} ${palavra}` : palavra
        if (fonte.widthOfTextAtSize(tentativa, tamanho) > largura && atual) {
            linhas.push(atual)
            atual = palavra
        } else {
            atual = tentativa
        }
    }
    if (atual) linhas.push(atual)
    return linhas
}

export const montarPdf = async (titulo: string, paragrafos: string[], tituloProc: string, paragrafosProc: string[], assinante: string) => {
    const pdf = await PDFDocument.create()
    const normal = await pdf.embedFont(StandardFonts.Helvetica)
    const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)
    const largura = A4.w - 2 * MARGEM

    let pagina: PDFPage = pdf.addPage([A4.w, A4.h])
    let y = A4.h - MARGEM
    const novaPagina = () => { pagina = pdf.addPage([A4.w, A4.h]); y = A4.h - MARGEM }

    const escrever = (texto: string, fonte: PDFFont, tamanho: number, centro = false) => {
        for (const linha of quebrar(texto, fonte, tamanho, largura)) {
            if (y < MARGEM + ENTRELINHA) novaPagina()
            const x = centro ? (A4.w - fonte.widthOfTextAtSize(linha, tamanho)) / 2 : MARGEM
            pagina.drawText(linha, { x, y, size: tamanho, font: fonte, color: rgb(0.1, 0.1, 0.15) })
            y -= tamanho === CORPO ? ENTRELINHA : tamanho + 5
        }
    }

    const assinatura = () => {
        // Linha e rotulo logo abaixo do ponto onde a Autentique carimba.
        const yLinha = A4.h * (1 - (ASSINATURA_Y_PCT + 5) / 100)
        pagina.drawLine({ start: { x: A4.w / 2 - 120, y: yLinha }, end: { x: A4.w / 2 + 120, y: yLinha }, thickness: 0.7, color: rgb(0.3, 0.3, 0.35) })
        const rotulo = `ASSOCIADO: ${assinante}`
        pagina.drawText(rotulo, { x: (A4.w - normal.widthOfTextAtSize(rotulo, 9)) / 2, y: yLinha - 12, size: 9, font: normal })
    }

    // Termo
    escrever(titulo, negrito, 12, true)
    y -= 8
    for (const p of paragrafos) {
        const ehClausula = /^CL[ÁA]USULA \d+/.test(p)
        if (ehClausula) y -= 4
        escrever(p, ehClausula ? negrito : normal, CORPO)
        y -= ehClausula ? 0 : 5
    }
    if (y < LIMITE_TEXTO) novaPagina()
    assinatura()
    const paginasTermo = pdf.getPageCount()

    // Procuracao
    novaPagina()
    escrever(tituloProc, negrito, 12, true)
    y -= 10
    for (const p of paragrafosProc) { escrever(p, normal, CORPO); y -= 6 }
    assinatura()

    return { base64: encodeBase64(await pdf.save()), paginasTermo, paginaProcuracao: pdf.getPageCount() }
}

