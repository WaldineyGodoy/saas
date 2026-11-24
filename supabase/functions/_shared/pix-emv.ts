/**
 * Leitura do "Pix copia e cola" (BR Code, padrão EMV-MPM do Banco Central).
 *
 * O payload é uma sequência de campos ID(2) + TAMANHO(2) + VALOR. Os que
 * interessam ao pagamento de conta de concessionária:
 *   26 → conta do recebedor (subcampo 00 = "br.gov.bcb.pix", 01 = chave)
 *   54 → valor (ausente quando o QR deixa o valor em aberto)
 *   59 → nome do recebedor
 *   62 → dados adicionais (subcampo 05 = txid)
 *   63 → CRC16-CCITT de tudo o que vem antes, incluindo "6304"
 *
 * Módulo puro, sem Deno nem rede, para ser testado fora da Edge Function.
 */

export type PixEmv = {
    payload: string
    chave: string | null
    url: string | null
    valor: number | null
    nomeRecebedor: string | null
    cidade: string | null
    txid: string | null
}

function campos(texto: string): Map<string, string> | null {
    const mapa = new Map<string, string>()
    let i = 0
    while (i < texto.length) {
        if (i + 4 > texto.length) return null
        const id = texto.slice(i, i + 2)
        const tam = Number(texto.slice(i + 2, i + 4))
        if (!/^\d{2}$/.test(id) || !Number.isInteger(tam)) return null
        const valor = texto.slice(i + 4, i + 4 + tam)
        if (valor.length !== tam) return null
        mapa.set(id, valor)
        i += 4 + tam
    }
    return mapa
}

export function crc16(texto: string): string {
    let crc = 0xffff
    for (let i = 0; i < texto.length; i++) {
        crc ^= texto.charCodeAt(i) << 8
        for (let b = 0; b < 8; b++) {
            crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Devolve o payload decomposto, ou um motivo de recusa em texto.
 * Recusa: formato quebrado, CRC errado (QR mal lido ou adulterado), ou um
 * código que não é Pix.
 */
export function lerPixEmv(bruto: string): { ok: true; pix: PixEmv } | { ok: false; erro: string } {
    const payload = String(bruto ?? '').trim()

    if (!payload.startsWith('000201')) {
        return { ok: false, erro: 'O código lido não é um Pix copia e cola.' }
    }

    const posCrc = payload.lastIndexOf('6304')
    if (posCrc < 0 || posCrc + 8 !== payload.length) {
        return { ok: false, erro: 'Código Pix sem CRC no final.' }
    }
    const crcInformado = payload.slice(posCrc + 4).toUpperCase()
    const crcCalculado = crc16(payload.slice(0, posCrc + 4))
    if (crcInformado !== crcCalculado) {
        return { ok: false, erro: 'O CRC do código Pix não confere: QR mal lido ou alterado.' }
    }

    const raiz = campos(payload)
    if (!raiz) return { ok: false, erro: 'Código Pix com estrutura inválida.' }

    const conta = raiz.get('26')
    const sub = conta ? campos(conta) : null
    if (!sub || sub.get('00')?.toLowerCase() !== 'br.gov.bcb.pix') {
        return { ok: false, erro: 'O código não identifica uma conta Pix (br.gov.bcb.pix).' }
    }

    const adicionais = raiz.get('62')
    const subAd = adicionais ? campos(adicionais) : null

    const valorTxt = raiz.get('54')
    const valor = valorTxt != null && /^\d+(\.\d{1,2})?$/.test(valorTxt) ? Number(valorTxt) : null

    return {
        ok: true,
        pix: {
            payload,
            chave: sub.get('01') ?? null,
            url: sub.get('25') ?? null,
            valor,
            nomeRecebedor: raiz.get('59') ?? null,
            cidade: raiz.get('60') ?? null,
            txid: subAd?.get('05') ?? null,
        },
    }
}

/** Código de barras de 44 dígitos a partir da linha digitável de arrecadação (48). */
export function codigoDeBarras(linhaDigitavel: string | null | undefined): string | null {
    const d = String(linhaDigitavel ?? '').replace(/\D/g, '')
    if (d.length === 48) return [0, 12, 24, 36].map((i) => d.substr(i, 11)).join('')
    if (d.length === 44) return d
    return null
}

/**
 * A Neoenergia põe no txid do QR um trecho do código de barras da própria
 * conta ("CODBAR" + dígitos). Quando o txid tem esse formato, os dígitos têm de
 * aparecer no código de barras da fatura que se está pagando — é o que amarra o
 * QR àquela conta, e não à de outra UC ou de outro mês.
 *
 * Devolve null quando não há como conferir (txid em outro formato ou fatura
 * sem linha digitável); true/false quando há.
 */
export function txidBateComCodigoDeBarras(txid: string | null, linhaDigitavel: string | null): boolean | null {
    const m = /^CODBAR(\d{6,})$/i.exec(String(txid ?? ''))
    if (!m) return null
    const barra = codigoDeBarras(linhaDigitavel)
    if (!barra) return null
    return barra.includes(m[1])
}
