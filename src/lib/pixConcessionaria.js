/**
 * Pagamento da conta de energia pelo QR Code "PAGUE COM PIX" da própria conta.
 *
 * A Cosern não imprime o Pix copia e cola em texto, só o QR. Então o navegador
 * baixa o PDF da conta, desenha cada página e procura os QR Codes; a conta tem
 * dois (o da NF3e, que é um link, e o do Pix), e fica o que for Pix.
 *
 * Quem decide se paga é a Edge Function pagar-conta-pix: ela confere o código
 * contra o valor do banco, o código de barras da fatura e o CNPJ do recebedor.
 * O que se faz aqui é só achar o código e mostrar ao usuário o que a Asaas leu.
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { getSecurePdfUrl } from './pdfHelper';
import { ehPix, lerQrsDoCanvas } from './pixQr';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Lê o Pix copia e cola do PDF da conta guardado em `concessionaria_pdf_url`.
 * Devolve o payload, ou lança erro com mensagem para o usuário.
 */
export async function extrairPixDaConta(supabase, pdfPath) {
    if (!pdfPath) throw new Error('Esta fatura não tem o PDF da conta anexado.');

    const url = await getSecurePdfUrl(supabase, pdfPath);
    if (!url) throw new Error('Não foi possível abrir o PDF da conta.');

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Falha ao baixar o PDF da conta (${resp.status}).`);
    const dados = new Uint8Array(await resp.arrayBuffer());

    const pdf = await pdfjsLib.getDocument({ data: dados }).promise;
    try {
        for (let p = 1; p <= pdf.numPages; p++) {
            const pagina = await pdf.getPage(p);
            const viewport = pagina.getViewport({ scale: 3 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            await pagina.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

            const pix = lerQrsDoCanvas(canvas).find(ehPix);
            if (pix) return pix;
        }
    } finally {
        pdf.destroy();
    }
    throw new Error('Não encontrei o QR Code "PAGUE COM PIX" no PDF da conta.');
}

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ESTADOS_SEM_CONCLUSAO = ['AWAITING_CRITICAL_ACTION_AUTHORIZATION'];
const ESTADOS_RECUSADOS = ['REFUSED', 'CANCELLED'];

/**
 * Fluxo completo: lê o QR, pede à função para conferir, mostra ao usuário o
 * recebedor e o valor que a Asaas leu, e paga se ele confirmar.
 *
 * Devolve:
 *   { cancelado: true }                    — usuário desistiu
 *   { pago: true, transacao }              — Asaas aceitou; pode marcar a conta como paga
 *   { pago: false, pendente: true, transacao } — aceita, mas aguardando autorização no app da Asaas
 * Lança Error nos demais casos.
 */
export async function pagarContaPorPix({ supabase, invoice, showConfirm }) {
    const payload = await extrairPixDaConta(supabase, invoice.concessionaria_pdf_url);

    const chamar = async (modo) => {
        const { data, error } = await supabase.functions.invoke('pagar-conta-pix', {
            body: { invoiceId: invoice.id, payload, modo },
        });
        if (error) {
            let msg = error.message;
            try { msg = (await error.context?.json())?.error || msg; } catch { /* mantém a genérica */ }
            throw new Error(msg);
        }
        if (!data?.success) throw new Error(data?.error || 'Falha ao processar o Pix.');
        return data;
    };

    const conferido = await chamar('conferir');
    const r = conferido.resumo;

    const ok = await showConfirm(
        `Pagar ${dinheiro(r.valor)} por Pix a ${r.recebedor}`
        + `${r.cnpj ? ` (CNPJ ${r.cnpj})` : ''}`
        + `${r.instituicao ? `, via ${r.instituicao}` : ''}`
        + `${r.uc ? `, conta da UC ${r.uc}` : ''}?`
        + `${r.ambiente === 'sandbox' ? ' [AMBIENTE SANDBOX]' : ''}`
        + ' O Pix é debitado na hora e não pode ser cancelado.',
        'Confirmar pagamento por Pix',
        'Pagar com Pix',
        'Cancelar'
    );
    if (!ok) return { cancelado: true };

    const pago = await chamar('pagar');
    const t = pago.transacao || {};

    if (ESTADOS_RECUSADOS.includes(t.status)) {
        throw new Error(`A Asaas recusou o Pix${t.refusalReason ? `: ${t.refusalReason}` : '.'}`);
    }
    if (ESTADOS_SEM_CONCLUSAO.includes(t.status)) {
        return { pago: false, pendente: true, transacao: t, valor: r.valor };
    }
    return { pago: true, transacao: t, valor: r.valor };
}
