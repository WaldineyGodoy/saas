/**
 * Licença anual do originador (dono, 13/11/2026; migração 20261113a).
 *
 * - O PREÇO fica no Plano do Originador, por cargo: `licenca_config`
 *   {"lider", "ppe", "ppp", "ppf"} em R$. 0 = cargo isento naquele plano.
 * - Voucher (por plano): isenção, % ou R$ de desconto. No modal do
 *   originador a equipe só digita o código.
 * - Vence 1 ano depois do pagamento (`licenca_paga_em`). Sem pagamento ou
 *   vencida, o parceiro recebe como PPF ("como Free até pagar").
 *
 * O banco deriva tudo por gatilho; este módulo espelha a regra para a tela
 * mostrar o resultado antes de salvar.
 */
import { CARGOS_ORIGINADOR, ROTULO_CARGO } from './planoOriginador';

export const LICENCA_VAZIA = { lider: 0, ppe: 0, ppp: 0, ppf: 0 };

export const TIPOS_VOUCHER = [
    { valor: 'isencao', rotulo: 'Isenção (100%)' },
    { valor: 'percentual', rotulo: 'Desconto em %' },
    { valor: 'valor', rotulo: 'Desconto em R$' }
];

export const ROTULO_STATUS_LICENCA = {
    isenta: 'Isenta',
    pendente: 'Aguardando pagamento',
    ativa: 'Ativa',
    vencida: 'Vencida'
};

const num = (v) => {
    if (v === null || v === undefined || v === '') return NaN;
    return Number(String(v).replace(',', '.'));
};

const arred = (v) => Math.round(v * 100) / 100;

/** {"lider", "ppe", "ppp", "ppf"} com número >= 0 (ausente/inválido vira 0). */
export const normalizarLicencaConfig = (cfg) =>
    Object.fromEntries(CARGOS_ORIGINADOR.map(c => {
        const n = num(cfg?.[c]);
        return [c, Number.isFinite(n) && n > 0 ? arred(n) : 0];
    }));

export const validarLicencaConfig = (cfg) => {
    const erros = [];
    for (const c of CARGOS_ORIGINADOR) {
        const bruto = cfg?.[c];
        if (bruto === '' || bruto === null || bruto === undefined) continue;
        const n = num(bruto);
        if (!Number.isFinite(n) || n < 0) erros.push(`Licença de ${ROTULO_CARGO[c]}: informe um valor em R$ (0 = isento).`);
    }
    return erros;
};

/** Preço anual da licença do cargo no plano (0 = isento). */
export const precoLicenca = (plano, cargo) => normalizarLicencaConfig(plano?.licenca_config)[cargo] || 0;

/** Desconto do voucher sobre o preço (nunca maior que o preço). */
export const descontoVoucher = (preco, voucher) => {
    if (!voucher || !(preco > 0)) return 0;
    const v = num(voucher.valor);
    let d = 0;
    if (voucher.tipo === 'isencao') d = preco;
    else if (voucher.tipo === 'percentual') d = arred(preco * (Number.isFinite(v) ? v : 0) / 100);
    else d = Number.isFinite(v) ? v : 0;
    return Math.min(Math.max(d, 0), preco);
};

/** "2026-11-13" -> Date local (sem fuso). */
const lerData = (iso) => {
    if (!iso) return null;
    const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!a || !m || !d) return null;
    return new Date(a, m - 1, d);
};

const paraIso = (dt) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

/** Vencimento = pagamento + 1 ano (29/02 vira 28/02, como o Postgres). */
export const vencimentoLicenca = (pagaEm) => {
    const dt = lerData(pagaEm);
    if (!dt) return null;
    const alvo = new Date(dt.getFullYear() + 1, dt.getMonth(), dt.getDate());
    if (alvo.getMonth() !== dt.getMonth()) alvo.setDate(0);
    return paraIso(alvo);
};

/**
 * A licença como o banco vai gravar, mais a situação HOJE (o status gravado
 * só muda quando a linha é escrita; a tela e o motor olham a data).
 *   { preco, desconto, valor, pagaEm, vencimento, status, emDia }
 */
export const resumoLicenca = ({ plano, cargo, voucher = null, pagaEm = null, hoje = new Date() }) => {
    const preco = precoLicenca(plano, cargo);
    if (!(preco > 0)) {
        return { preco: 0, desconto: 0, valor: 0, pagaEm: pagaEm || null, vencimento: vencimentoLicenca(pagaEm), status: 'isenta', emDia: true };
    }
    const desconto = descontoVoucher(preco, voucher);
    const valor = arred(Math.max(preco - desconto, 0));
    const hojeIso = paraIso(hoje);
    // Voucher que zera o valor: a licença começa no dia em que ele entrou.
    const pago = pagaEm || (valor === 0 ? hojeIso : null);
    if (!pago) return { preco, desconto, valor, pagaEm: null, vencimento: null, status: 'pendente', emDia: false };
    const vencimento = vencimentoLicenca(pago);
    const emDia = vencimento >= hojeIso;
    return { preco, desconto, valor, pagaEm: pago, vencimento, status: emDia ? 'ativa' : 'vencida', emDia };
};

/** Por que o voucher não serve (ou null). Espelha o gatilho do banco. */
export const problemaVoucher = (voucher, { planoId, cargo, usos = 0, hoje = new Date() }) => {
    if (!voucher) return 'Voucher não encontrado.';
    if (!voucher.ativo) return `Voucher ${voucher.codigo} está inativo.`;
    if (planoId && voucher.plano_originador_id !== planoId) return `Voucher ${voucher.codigo} não pertence ao Plano do Originador deste parceiro.`;
    if (voucher.validade && String(voucher.validade).slice(0, 10) < paraIso(hoje)) return `Voucher ${voucher.codigo} venceu.`;
    if (Array.isArray(voucher.cargos) && voucher.cargos.length && !voucher.cargos.includes(cargo)) return `Voucher ${voucher.codigo} não vale para ${ROTULO_CARGO[cargo] || cargo}.`;
    if (voucher.limite_usos && usos >= voucher.limite_usos) return `Voucher ${voucher.codigo} já atingiu o limite de ${voucher.limite_usos} uso(s).`;
    return null;
};

/** Código como o banco compara: sem espaços nas pontas, maiúsculo. */
export const normalizarCodigo = (codigo) => String(codigo ?? '').trim().toUpperCase();

/** Erros do formulário de voucher; lista vazia = pode gravar. */
export const validarVoucher = (v) => {
    const erros = [];
    if (!normalizarCodigo(v.codigo)) erros.push('Informe o código do voucher.');
    else if (!/^[A-Z0-9_-]{3,40}$/.test(normalizarCodigo(v.codigo))) erros.push('Código: 3 a 40 letras, números, "-" ou "_".');
    if (!TIPOS_VOUCHER.some(t => t.valor === v.tipo)) erros.push('Escolha o tipo do voucher.');
    if (v.tipo !== 'isencao') {
        const n = num(v.valor);
        if (!Number.isFinite(n) || n <= 0) erros.push('Informe o valor do desconto.');
        else if (v.tipo === 'percentual' && n > 100) erros.push('Desconto em %: no máximo 100.');
    }
    if (v.limite_usos !== '' && v.limite_usos !== null && v.limite_usos !== undefined) {
        const n = Number(v.limite_usos);
        if (!Number.isInteger(n) || n < 1) erros.push('Limite de usos: número inteiro a partir de 1 (vazio = sem limite).');
    }
    return erros;
};

export const payloadVoucher = (v, planoId) => ({
    plano_originador_id: planoId,
    codigo: normalizarCodigo(v.codigo),
    tipo: v.tipo,
    valor: v.tipo === 'isencao' ? 0 : arred(num(v.valor)),
    validade: v.validade || null,
    limite_usos: v.limite_usos === '' || v.limite_usos === null || v.limite_usos === undefined ? null : Number(v.limite_usos),
    cargos: Array.isArray(v.cargos) && v.cargos.length && v.cargos.length < CARGOS_ORIGINADOR.length ? v.cargos : null,
    descricao: String(v.descricao ?? '').trim() || null,
    ativo: v.ativo !== false
});

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "Isenção", "50% de desconto", "R$ 100,00 de desconto". */
export const descreverVoucher = (v) => {
    if (!v) return '';
    if (v.tipo === 'isencao') return 'isenção total';
    if (v.tipo === 'percentual') return `${Number(v.valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% de desconto`;
    return `${reais(v.valor)} de desconto`;
};

/** "2026-11-13" -> "13/11/2026". */
export const dataBr = (iso) => {
    const dt = lerData(iso);
    return dt ? dt.toLocaleDateString('pt-BR') : '—';
};
