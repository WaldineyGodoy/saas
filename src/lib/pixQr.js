/**
 * Busca de QR Codes numa página renderizada. Sem dependência de navegador
 * além do canvas, para poder ser testado em Node com @napi-rs/canvas.
 */
import jsQR from 'jsqr';

export const ehPix = (texto) => typeof texto === 'string'
    && texto.startsWith('000201')
    && /br\.gov\.bcb\.pix/i.test(texto);

// jsQR devolve um código por imagem. Procura na página inteira e depois em
// recortes sobrepostos, para achar o segundo QR quando o primeiro encontrado
// é o da nota fiscal.
export function lerQrsDoCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const W = canvas.width;
    const H = canvas.height;
    const achados = [];

    const tentar = (x, y, w, h) => {
        const img = ctx.getImageData(x, y, w, h);
        const r = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (r?.data) achados.push(r.data);
        return r?.data;
    };

    const primeiro = tentar(0, 0, W, H);
    if (ehPix(primeiro)) return achados;

    const n = 3;
    const tw = Math.ceil(W / n * 1.5);
    const th = Math.ceil(H / n * 1.5);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const x = Math.min(Math.floor((W / n) * j), W - Math.min(tw, W));
            const y = Math.min(Math.floor((H / n) * i), H - Math.min(th, H));
            const achado = tentar(x, y, Math.min(tw, W), Math.min(th, H));
            if (ehPix(achado)) return achados;
        }
    }
    return achados;
}
