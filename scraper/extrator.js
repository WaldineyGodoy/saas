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
/**
 * Digito verificador de um bloco da linha digitavel de arrecadacao.
 *
 * O 3o digito do codigo diz qual modulo rege os DVs: 6 ou 7 -> modulo 10,
 * 8 ou 9 -> modulo 11. As contas da Cosern usam modulo 11.
 */
function dvBloco(base, modulo) {
    let soma = 0;
    if (modulo === 11) {
        let peso = 2;
        for (let i = base.length - 1; i >= 0; i--) {
            soma += Number(base[i]) * peso;
            peso = peso === 9 ? 2 : peso + 1;
        }
        const dv = 11 - (soma % 11);
        return (dv === 0 || dv === 10 || dv === 11) ? 0 : dv;
    }
    let peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
        let p = Number(base[i]) * peso;
        if (p > 9) p = Math.floor(p / 10) + (p % 10);
        soma += p;
        peso = peso === 2 ? 1 : 2;
    }
    const resto = soma % 10;
    return resto === 0 ? 0 : 10 - resto;
}

/**
 * O numero capturado é mesmo um código de arrecadação?
 *
 * Importa porque o regex que extrai a linha digitável pode ancorar num "8"
 * espúrio e trazer dígitos a mais na frente — foi o que aconteceu com a UC
 * 7030004455, que veio com "800" antes do código e produziu um valor de
 * R$ 387.000.001,03. Sem essa checagem, lixo capturado vira "os valores
 * divergem", e uma conta correta nasce marcada como problema.
 *
 * Os quatro blocos de 12 dígitos têm DV no último dígito. Se os quatro fecham,
 * o número é um código; se não fecham, não é.
 */
function codigoDeBarrasValido(linhaDigitavel) {
    const d = String(linhaDigitavel || '').replace(/\D/g, '');
    if (d.length !== 48) return false;

    const modulo = ['8', '9'].includes(d[2]) ? 11 : 10;
    for (let b = 0; b < 4; b++) {
        const bloco = d.substr(b * 12, 12);
        if (Number(bloco[11]) !== dvBloco(bloco.slice(0, 11), modulo)) return false;
    }
    return true;
}

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
    const avisos = [];
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

    // Codigo de barras: tres desfechos diferentes, e misturar os dois ultimos
    // faz conta correta nascer marcada como problema.
    //
    //   codigo valido e valor bate  -> a melhor confirmacao que existe
    //   codigo valido e valor NAO bate -> divergencia real, bloqueia
    //   codigo ausente ou ilegivel  -> aviso: nao da para confirmar por aqui,
    //                                  mas isso nao acusa a conta de nada
    let valorBarras = null;
    if (!campos.linha_digitavel) {
        avisos.push('codigo de barras nao encontrado no PDF');
    } else if (!codigoDeBarrasValido(campos.linha_digitavel)) {
        avisos.push('codigo de barras ilegivel (digito verificador nao fecha) - conferencia por ele nao foi possivel');
    } else {
        valorBarras = valorDoCodigoDeBarras(campos.linha_digitavel);
        if (valorBarras != null && totalPdf > 0 && Math.abs(valorBarras - totalPdf) > TOLERANCIA) {
            problemas.push(`codigo de barras R$ ${valorBarras.toFixed(2)} != PDF R$ ${totalPdf.toFixed(2)}`);
        }
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

    return { ok: problemas.length === 0, problemas, avisos, valorBarras, totalPdf };
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
            // Aviso nao derruba a conta: fica registrado para quem for olhar,
            // sem marcar como problema o que so nao pode ser confirmado.
            reading_error: veredito.problemas.length > 0
                ? `[CONFERIR] ${veredito.problemas.join('; ')}`
                : veredito.avisos.length > 0
                    ? `[AVISO] ${veredito.avisos.join('; ')}`
                    : null,
        },
    };
}

/** Atalho para quando o PDF ainda está em disco (caminho do download). */
async function extrairDoArquivo(caminho, opcoes) {
    return extrairFatura(fs.readFileSync(caminho), opcoes);
}

module.exports = {
    TOLERANCIA,
    codigoDeBarrasValido,
    valorDoCodigoDeBarras,
    conferir,
    paraInvoice,
    extrairFatura,
    extrairDoArquivo,
};
