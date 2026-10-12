import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'npm:pdf-lib@1.17.1'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'
// Texto e paginação: os MESMOS do CRM e da página pública (fonte única).
import { identificadorDocumento } from './contrato-texto.js'
import { TITULO_ADESAO, folhasTermoAdesao, textoTermoAdesao } from './termo-adesao.js'

/**
 * Termo de adesão montado no servidor (adesão pelo app, 11/10/2026).
 *
 * Mesmo texto, mesmas folhas e mesma procuração que a página pública gera no
 * navegador (ContratoAdesao + FolhaContrato + html2canvas), desenhados com
 * pdf-lib: o app não tem DOM para capturar. Cada folha do texto vira uma
 * página A4; a procuração é a última. A assinatura da Autentique cai no fim
 * do termo e na procuração (x 50%, y 82%), como no envio pelo site.
 */

const MM = 2.8346
const A4 = { w: 210 * MM, h: 297 * MM }
const BORDA = 4 * MM
const PADDING = 20 * MM
const X0 = BORDA + PADDING
const LARGURA = A4.w - 2 * X0
const TOPO = A4.h - BORDA - PADDING
const LOGO_ALTURA = 25 * MM
const RODAPE_Y = BORDA + PADDING - 4 * MM
const BASE_CORPO = RODAPE_Y + 10 * MM // texto termina acima do rodapé
const CORPO = 10
const ENTRELINHA = CORPO * 1.5

export type AssinanteContrato = {
  name?: string | null; cpf_cnpj?: string | null; email?: string | null; phone?: string | null
  rua?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null
  cidade?: string | null; uf?: string | null; cep?: string | null
  representante_nome?: string | null; representante_cpf?: string | null; consolidated_due_day?: number | null
}
export type UcContrato = {
  numero_uc: string; concessionaria?: string | null; desconto_assinante?: number | string | null
  dia_vencimento?: number | null; cidade?: string | null; uf?: string | null
}
export type Marca = { company_name?: string | null; primary_color?: string | null; logo_url?: string | null }

const corDe = (hex?: string | null): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return rgb(0, 0.2, 0.4)
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}
const AZUL_TITULO = rgb(0, 0.2, 0.4) // #003366 do tituloContrato
const TINTA = rgb(0.118, 0.161, 0.231) // #1e293b
const CINZA = rgb(0.58, 0.64, 0.72) // #94a3b8

/** As fontes padrão do PDF só têm WinAnsi: troca o que não existe nela. */
const TROCAS: Record<string, string> = { '→': '->', '≤': '<=', '≥': '>=', '•': '-', ' ': ' ', ' ': ' ', ' ': ' ' }
const seguro = (fonte: PDFFont, texto: string) => {
  const aceitos = new Set(fonte.getCharacterSet())
  let s = ''
  for (const ch of texto.normalize('NFC')) {
    const t = TROCAS[ch] ?? ch
    for (const c of t) s += aceitos.has(c.codePointAt(0)!) ? c : '?'
  }
  return s
}

const quebrar = (texto: string, fonte: PDFFont, tamanho: number, largura: number) => {
  const linhas: string[] = []
  let atual = ''
  for (const palavra of texto.split(/ +/)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra
    if (atual && fonte.widthOfTextAtSize(tentativa, tamanho) > largura) {
      linhas.push(atual)
      atual = palavra
    } else {
      atual = tentativa
    }
  }
  linhas.push(atual)
  return linhas
}

/** Linha justificada (text-align: justify): espaço extra entre as palavras. */
const linhaJustificada = (pagina: PDFPage, linha: string, y: number, fonte: PDFFont, justificar: boolean) => {
  const palavras = linha.split(' ')
  if (!justificar || palavras.length < 2) {
    pagina.drawText(linha, { x: X0, y, size: CORPO, font: fonte, color: TINTA })
    return
  }
  const larguraPalavras = palavras.reduce((s, p) => s + fonte.widthOfTextAtSize(p, CORPO), 0)
  const espaco = (LARGURA - larguraPalavras) / (palavras.length - 1)
  let x = X0
  for (const p of palavras) {
    pagina.drawText(p, { x, y, size: CORPO, font: fonte, color: TINTA })
    x += fonte.widthOfTextAtSize(p, CORPO) + espaco
  }
}

type LinhaCorpo = { texto: string; justificar: boolean }

/** Linhas renderizadas de uma folha (pre-wrap): cada quebra do texto conta. */
const linhasDaFolha = (folha: string, fonte: PDFFont): LinhaCorpo[] => {
  const out: LinhaCorpo[] = []
  for (const paragrafo of folha.replace(/\s+$/, '').split('\n')) {
    const ls = quebrar(seguro(fonte, paragrafo), fonte, CORPO, LARGURA)
    ls.forEach((l, i) => out.push({ texto: l, justificar: i < ls.length - 1 }))
  }
  return out
}

export async function montarPdfAdesao(sub: AssinanteContrato, ucs: UcContrato[], marca: Marca) {
  const pdf = await PDFDocument.create()
  const serif = await pdf.embedFont(StandardFonts.TimesRoman)
  const serifB = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const sans = await pdf.embedFont(StandardFonts.Helvetica)
  const sansB = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono = await pdf.embedFont(StandardFonts.Courier)
  const cor = corDe(marca.primary_color)

  let logo: PDFImage | null = null
  if (marca.logo_url) {
    try {
      const r = await fetch(marca.logo_url)
      const bytes = new Uint8Array(await r.arrayBuffer())
      const tipo = r.headers.get('content-type') || ''
      logo = tipo.includes('png') || marca.logo_url.toLowerCase().endsWith('.png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    } catch (e) {
      console.error('pdf-adesao: logo', e)
    }
  }

  const conteudo = textoTermoAdesao(sub, ucs)
  const identificador = identificadorDocumento(conteudo)
  const folhas: string[] = folhasTermoAdesao(conteudo)

  // Moldura, logo e título corrido: o "cabeçalho" do FolhaContrato.
  const cabecalho = (pagina: PDFPage, numero: number): number => {
    pagina.drawRectangle({ x: BORDA / 2, y: BORDA / 2, width: A4.w - BORDA, height: A4.h - BORDA, borderColor: cor, borderWidth: BORDA })
    let y = TOPO
    if (logo) {
      const escala = LOGO_ALTURA / logo.height
      const w = logo.width * escala
      pagina.drawImage(logo, { x: (A4.w - w) / 2, y: y - LOGO_ALTURA, width: w, height: LOGO_ALTURA })
    } else {
      const nome = seguro(sansB, marca.company_name || 'B2W ENERGIA')
      pagina.drawText(nome, { x: (A4.w - sansB.widthOfTextAtSize(nome, 21)) / 2, y: y - LOGO_ALTURA / 2 - 7, size: 21, font: sansB, color: cor })
    }
    y -= LOGO_ALTURA
    if (numero > 1) {
      const t = seguro(sansB, TITULO_ADESAO.toUpperCase())
      y -= 4 * MM
      pagina.drawText(t, { x: (A4.w - sansB.widthOfTextAtSize(t, 6.8)) / 2, y: y - 6, size: 6.8, font: sansB, color: cor })
      y -= 7
    }
    y -= 4 * MM
    pagina.drawLine({ start: { x: X0, y }, end: { x: A4.w - X0, y }, thickness: 1.4, color: cor, opacity: 0.25 })
    return y - 8 * MM
  }

  const rodape = (pagina: PDFPage, numero: number, total: number) => {
    pagina.drawLine({ start: { x: X0, y: RODAPE_Y + 9 }, end: { x: A4.w - X0, y: RODAPE_Y + 9 }, thickness: 0.6, color: rgb(0.886, 0.91, 0.941) })
    pagina.drawText('Documento gerado eletronicamente via CRM B2W Energia', { x: X0, y: RODAPE_Y, size: 6, font: sans, color: CINZA })
    const ref = `Ref. ${identificador}`
    pagina.drawText(ref, { x: (A4.w - mono.widthOfTextAtSize(ref, 6)) / 2, y: RODAPE_Y, size: 6, font: mono, color: CINZA })
    const pg = `Página ${numero} de ${total}`
    pagina.drawText(pg, { x: A4.w - X0 - sansB.widthOfTextAtSize(pg, 6), y: RODAPE_Y, size: 6, font: sansB, color: rgb(0.392, 0.455, 0.545) })
  }

  // Passo 1: quantas páginas físicas cada folha ocupa (uma folha que passa
  // do A4 continua na página seguinte, em vez de ser cortada).
  const TITULO_H1 = 'TERMO DE INGRESSO E ADESÃO À ASSOCIAÇÃO DE GERAÇÃO COMPARTILHADA'
  const tituloLinhas = quebrar(seguro(serifB, TITULO_H1), serifB, 15, LARGURA)
  const corpoPorFolha = folhas.map((f) => linhasDaFolha(f, serif))
  const yInicio1 = TOPO - LOGO_ALTURA - 4 * MM - 8 * MM
  const yInicioN = yInicio1 - 4 * MM - 7
  const cabem = (yInicio: number) => Math.floor((yInicio - BASE_CORPO) / ENTRELINHA)
  const paginas: { linhas: LinhaCorpo[]; titulo: boolean }[] = []
  corpoPorFolha.forEach((linhas, i) => {
    let resto = linhas
    let primeira = true
    while (primeira || resto.length) {
      const numero = paginas.length + 1
      const titulo = i === 0 && primeira
      const yIni = (numero === 1 ? yInicio1 : yInicioN) - (titulo ? tituloLinhas.length * 20 + 10 * MM : 0)
      const n = Math.max(1, cabem(yIni))
      paginas.push({ linhas: resto.slice(0, n), titulo })
      resto = resto.slice(n)
      primeira = false
    }
  })
  const paginasTermo = paginas.length
  const total = paginasTermo + 1

  // Passo 2: desenhar o termo.
  paginas.forEach((p, idx) => {
    const numero = idx + 1
    const pagina = pdf.addPage([A4.w, A4.h])
    let y = cabecalho(pagina, numero)
    if (p.titulo) {
      for (const l of tituloLinhas) {
        pagina.drawText(l, { x: (A4.w - serifB.widthOfTextAtSize(l, 15)) / 2, y: y - 15, size: 15, font: serifB, color: AZUL_TITULO })
        y -= 20
      }
      y -= 10 * MM
    }
    for (const l of p.linhas) {
      y -= ENTRELINHA
      linhaJustificada(pagina, l.texto, y + (ENTRELINHA - CORPO) / 2, serif, l.justificar)
    }
    rodape(pagina, numero, total)
  })

  // Procuração (última folha), como no ContratoAdesao.
  const pagina = pdf.addPage([A4.w, A4.h])
  let y = cabecalho(pagina, total)
  const tituloProc = 'PROCURAÇÃO PARA LIBERAÇÃO DE ACESSO'
  pagina.drawText(tituloProc, { x: (A4.w - serifB.widthOfTextAtSize(tituloProc, 15)) / 2, y: y - 15, size: 15, font: serifB, color: AZUL_TITULO })
  y -= 15 + 12 * MM
  const P = 11
  const paragrafo = (rotulo: string, texto: string) => {
    const linhas = quebrar(seguro(serif, `${rotulo} ${texto}`), serif, P, LARGURA)
    linhas.forEach((l, i) => {
      y -= P * 1.5
      if (i === 0) {
        const r = seguro(serifB, rotulo)
        pagina.drawText(r, { x: X0, y, size: P, font: serifB, color: TINTA })
        pagina.drawText(l.slice(rotulo.length), { x: X0 + serifB.widthOfTextAtSize(r, P), y, size: P, font: serif, color: TINTA })
      } else {
        pagina.drawText(l, { x: X0, y, size: P, font: serif, color: TINTA })
      }
    })
  }
  const end = `${sub.rua || ''}, nº ${sub.numero || ''}${sub.complemento ? ` - ${sub.complemento}` : ''}, ${sub.bairro || ''}, ${sub.cidade || ''}/${sub.uf || ''}, CEP ${sub.cep || ''}`
  paragrafo('OUTORGANTE:', `${sub.name || ''}, inscrito no CPF/CNPJ sob o nº ${sub.cpf_cnpj || ''}, residente e domiciliado à ${end}, doravante denominado "ASSOCIADO".`)
  y -= 8 * MM
  paragrafo('OUTORGADO:', `${marca.company_name || 'ASSOCIAÇÃO DE USINAS B2W ENERGIA'}, inscrito no CNPJ sob nº 64.561.352/0001-07, com sede na Praça Apolinario Barbosa, 86 – Centro, Caraí/MG, CEP 39800-000, doravante denominada "ASSOCIAÇÃO".`)
  y -= 10 * MM
  paragrafo('PODERES:', `Pelo presente instrumento, o OUTORGANTE nomeia o OUTORGADO seu procurador para o fim especial de representá-lo junto à concessionária ${ucs[0]?.concessionaria || 'local'}, podendo solicitar acesso a dados de consumo, histórico de faturamento e realizar o cadastro da Unidade Consumidora no Sistema de Compensação de Energia Elétrica (Geração Distribuída).`)

  // Quadro das UCs vinculadas.
  y -= 12 * MM
  const linhaTab = 10 * MM
  const altura = 6 * MM + 10 * MM + linhaTab * (ucs.length + 1)
  pagina.drawRectangle({ x: X0, y: y - altura, width: LARGURA, height: altura, color: rgb(0.973, 0.98, 0.988), borderColor: rgb(0.886, 0.91, 0.941), borderWidth: 0.8 })
  let ty = y - 6 * MM - 9
  pagina.drawText('UNIDADES CONSUMIDORAS VINCULADAS:', { x: X0 + 6 * MM, y: ty, size: 9, font: sansB, color: rgb(0.278, 0.333, 0.412) })
  const cols = [X0 + 6 * MM, X0 + 6 * MM + LARGURA * 0.32, X0 + 6 * MM + LARGURA * 0.64]
  ty -= linhaTab
  ;['Nº Unidade (UC)', 'Concessionária', 'Localidade'].forEach((h, i) => pagina.drawText(seguro(serifB, h), { x: cols[i], y: ty, size: 10, font: serifB, color: TINTA }))
  for (const u of ucs) {
    ty -= linhaTab
    pagina.drawText(seguro(serifB, u.numero_uc), { x: cols[0], y: ty, size: 10, font: serifB, color: TINTA })
    pagina.drawText(seguro(serif, u.concessionaria || ''), { x: cols[1], y: ty, size: 10, font: serif, color: TINTA })
    pagina.drawText(seguro(serif, `${u.cidade || ''}/${u.uf || ''}`), { x: cols[2], y: ty, size: 10, font: serif, color: TINTA })
  }
  const aviso = 'Documento gerado eletronicamente para fins de assinatura digital na plataforma Autentique.'
  pagina.drawText(aviso, { x: (A4.w - sans.widthOfTextAtSize(aviso, 7.5)) / 2, y: y - altura - 25 * MM, size: 7.5, font: sans, color: CINZA })
  rodape(pagina, total, total)

  return { base64: encodeBase64(await pdf.save()), paginasTermo }
}
