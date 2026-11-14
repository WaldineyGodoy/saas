/**
 * Quando a tela oferece o boleto da licença (espelho da Edge Function
 * licenca-originador-cobranca, dono 14/11/2026):
 *  - só com licença cobrada (preço do cargo > 0) e valor a pagar > 0;
 *  - adesão: sem pagamento ou licença vencida;
 *  - renovação: licença em dia, liberada nos 30 dias antes do fim e com
 *    vencimento na data da renovação;
 *  - nunca com boleto em aberto.
 */
export const JANELA_RENOVACAO_DIAS = 30;

export const ROTULO_STATUS_BOLETO = {
    pendente: 'Aguardando pagamento',
    vencido: 'Vencido',
    pago: 'Pago',
    cancelado: 'Cancelado'
};

const paraIso = (dt) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

const diasAte = (deIso, ateIso) => {
    const [a1, m1, d1] = deIso.split('-').map(Number);
    const [a2, m2, d2] = String(ateIso).slice(0, 10).split('-').map(Number);
    return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
};

const br = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');

export const situacaoBoleto = ({ originator, cobrancas = [], hoje = new Date() }) => {
    const preco = Number(originator?.licenca_preco || 0);
    const valor = Number(originator?.licenca_valor || 0);
    if (cobrancas.some(c => c.status === 'pendente' || c.status === 'vencido')) {
        return { podeGerar: false, tipo: null, texto: 'Há um boleto em aberto.' };
    }
    if (!(preco > 0)) return { podeGerar: false, tipo: null, texto: 'Cargo isento neste plano: não há boleto.' };
    if (!(valor > 0)) return { podeGerar: false, tipo: null, texto: 'O voucher isenta toda a licença: não há boleto.' };

    const hojeIso = paraIso(hoje);
    const venc = originator?.licenca_vencimento;
    const emDia = !!originator?.licenca_paga_em && !!venc && String(venc).slice(0, 10) >= hojeIso;
    if (!emDia) {
        return { podeGerar: true, tipo: 'adesao', texto: 'Licença aguardando pagamento. O boleto vence em 3 dias e, pago, ativa a licença por 1 ano.' };
    }
    const faltam = diasAte(hojeIso, venc);
    if (faltam > JANELA_RENOVACAO_DIAS) {
        return { podeGerar: false, tipo: null, texto: `Licença em dia até ${br(venc)}. O boleto de renovação é liberado ${JANELA_RENOVACAO_DIAS} dias antes.` };
    }
    return { podeGerar: true, tipo: 'renovacao', texto: `Renovação: o boleto vence em ${br(venc)} (data da renovação). Pago antes, o novo ano começa no fim do atual.` };
};
