/**
 * Extração dos campos da conta a partir do PDF.
 *
 * Este módulo NÃO conhece portal nenhum e NÃO fala com o banco: recebe o
 * arquivo, devolve os campos da conta e diz se eles conferem.
 *
 * A leitura do PDF é feita pela Edge Function `parse-invoice` — a mesma que a
 * tela de upload manual usa. Existir um extrator só evita que o robô e a tela
 * discordem sobre o valor da mesma conta.
 *
 * Divisão de responsabilidade: aqui só entram FATOS IMPRESSOS NA CONTA
 * (consumo, compensação, leitura, CIP, linha digitável). Os campos derivados
 * do contrato do assinante — `valor_a_pagar`, `consumo_reais`, `tarifa_minima`,
 * `economia_reais` — são do estágio de faturamento e não se escrevem aqui.
 */

const fs = require('fs');

/** Tolerância de centavos ao comparar dois valores da mesma conta. */
const TOLERANCIA = 0.01;

/**
 * Valor embutido no código de barras de arrecadação (padrão FEBRABAN).
 *
 * A linha digitável tem 48 dígitos: 4 blocos de 12, cada um com um DV no fim.
 * Removidos os DVs sobram os 44 dígitos do código de barras, e as posições
 * 5 a 15 são o valor em centavos — escrito pela própria concessionária.
 *
 * É a única conferência do valor que não depende do nosso regex.
 */
function valorDoCodigoDeBarras(linhaDigitavel) {
    const d = String(linhaDigitavel || '').replace(/\D/g, '');

    let barra = null;
    if (d.length === 48) barra = [0, 12, 24, 36].map(i => d.substr(i, 11)).join('');
    else if (d.length === 44) barra = d;
    if (!barra || barra[0] !== '8') return null;

    const centavos = parseInt(barra.substr(4, 11), 10);
    return Number.isNaN(centavos) ? null : centavos / 100;
}

/** Chama a `parse-invoice` e devolve os campos crus que ela extraiu do PDF. */
async function lerPdf(pdfBuffer, { supabaseUrl, supabaseKey }) {
    const res = await fetch(`${supabaseUrl}/functions/v1/parse-invoice`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ pdfBase64: pdfBuffer.toString('base64') }),
    });

    const corpo = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`parse-invoice HTTP ${res.status}: ${corpo?.error || 'sem detalhe'}`);
    if (!corpo || corpo.error) throw new Error(`parse-invoice: ${corpo?.error || 'resposta vazia'}`);
    return corpo;
}

/**
 * Confere a extração contra duas fontes independentes: o valor que o portal
 * mostrou na lista e o valor gravado no código de barras do próprio PDF.
 *
 * Divergiu, o número extraído está errado em algum lugar — e faturar em cima
 * dele cobraria o valor errado do assinante. Devolve os motivos, não decide.
 */
function conferir(campos, { valorPortal, refAlvo }) {
    const problemas = [];
    const totalPdf = Number(campos.valor_a_pagar) || 0;

    if (totalPdf <= 0) {
        problemas.push('total nao encontrado no PDF');
    }

    if (valorPortal != null && Number(valorPortal) > 0 && totalPdf > 0) {
        const diff = Math.abs(totalPdf - Number(valorPortal));
        if (diff > TOLERANCIA) {
            problemas.push(`portal R$ ${Number(valorPortal).toFixed(2)} != PDF R$ ${totalPdf.toFixed(2)}`);
        }
    }

    const valorBarras = valorDoCodigoDeBarras(campos.linha_digitavel);
    if (valorBarras == null) {
        problemas.push('codigo de barras ausente ou ilegivel');
    } else if (totalPdf > 0 && Math.abs(valorBarras - totalPdf) > TOLERANCIA) {
        problemas.push(`codigo de barras R$ ${valorBarras.toFixed(2)} != PDF R$ ${totalPdf.toFixed(2)}`);
    }

    // refAlvo chega como MM/AAAA; a parse-invoice devolve AAAA-MM.
    if (refAlvo && campos.mes_referencia) {
        const [mm, aaaa] = String(refAlvo).split('/');
        const esperado = `${aaaa}-${mm}`;
        if (campos.mes_referencia !== esperado) {
            problemas.push(`mes de referencia ${campos.mes_referencia} != alvo ${esperado}`);
        }
    }

    if (!campos.data_leitura) {
        problemas.push('data de leitura ausente');
    }

    return { ok: problemas.length === 0, problemas, valorBarras, totalPdf };
}

const numero = (v) => (v == null || v === '' ? 0 : Number(v) || 0);

/**
 * Converte a saída da parse-invoice nas colunas de `invoices`.
 * Só fatos da conta — nada que dependa do contrato do assinante.
 */
function paraInvoice(campos) {
    return {
        consumo_kwh: numero(campos.consumo_kwh),
        consumo_compensado: numero(campos.consumo_compensado),
        energia_injetada: numero(campos.energia_injetada),
        saldo_kwh: numero(campos.saldo_kwh),
        iluminacao_publica: numero(campos.iluminacao_publica),
        outros_lancamentos: numero(campos.outros_lancamentos),
        parcelamento: numero(campos.parcelamento),
        data_leitura: campos.data_leitura || null,
        data_leitura_anterior: campos.data_leitura_anterior || null,
        vencimento_concessionaria: campos.vencimento || null,
        linha_digitavel: campos.linha_digitavel || null,
    };
}

/**
 * Lê o PDF, confere e devolve o que gravar na fatura.
 *
 * Conferiu -> reading_status 'success' (card verde, pronto para faturar).
 * Divergiu  -> reading_status 'error' com o motivo, e os campos vão junto:
 *              quem revisa precisa ver os números que causaram a divergência.
 */
async function extrairFatura(pdfBuffer, { supabaseUrl, supabaseKey, valorPortal, refAlvo }) {
    const campos = await lerPdf(pdfBuffer, { supabaseUrl, supabaseKey });
    const veredito = conferir(campos, { valorPortal, refAlvo });

    return {
        campos,
        veredito,
        colunas: {
            ...paraInvoice(campos),
            reading_status: veredito.ok ? 'success' : 'error',
            reading_error: veredito.ok
                ? null
                : `[CONFERIR] ${veredito.problemas.join('; ')}`,
        },
    };
}

/** Atalho para quando o PDF ainda está em disco (caminho do download). */
async function extrairDoArquivo(caminho, opcoes) {
    return extrairFatura(fs.readFileSync(caminho), opcoes);
}

module.exports = {
    TOLERANCIA,
    valorDoCodigoDeBarras,
    conferir,
    paraInvoice,
    extrairFatura,
    extrairDoArquivo,
};
