/**
 * Eletropostos — regras puras da tela (sem React, sem Supabase).
 * Spec: docs/superpowers/specs/2026-09-29-eletropostos-cadastro-design.md
 *
 * Quem decide de verdade e o banco (migracao 20260929a): UC unica, plano so
 * de eletroposto e soma dos fornecedores <= 100. Isto aqui so evita mandar
 * ao banco o que ele vai recusar e traduz o que ele recusou.
 */

export const STATUS_ELETROPOSTO = [
    { status: 'pre_operacao', label: 'Pré-Operação', color: '#6d28d9', bg: '#ede9fe' },
    { status: 'em_instalacao', label: 'Em Instalação', color: '#9a3412', bg: '#ffedd5' },
    { status: 'operando', label: 'Operando', color: '#166534', bg: '#dcfce7' },
    { status: 'manutencao', label: 'Manutenção', color: '#991b1b', bg: '#fee2e2' },
    { status: 'inativo', label: 'Inativo', color: '#64748b', bg: '#f1f5f9' },
    { status: 'cancelado', label: 'Cancelado', color: '#94a3b8', bg: '#f1f5f9' },
];

export const TIPOS_RECARGA = [
    { value: 'AC', label: 'AC' },
    { value: 'DC', label: 'DC' },
    { value: 'AC_DC', label: 'AC e DC' },
];

export const statusConfig = (status) =>
    STATUS_ELETROPOSTO.find(s => s.status === status) || STATUS_ELETROPOSTO[0];

// A usina nunca e gravada no eletroposto: vem da UC.
export const usinaDoEletroposto = (eletroposto) => eletroposto?.consumer_unit?.usina || null;

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

// O numero da UC e gravado com pontuacao (2.100.615.032-02) e costuma ser
// digitado sem ela: com 3 digitos ou mais, compara tambem so os digitos.
export const casaBusca = (termo, valores) => {
    const t = String(termo ?? '').trim().toLowerCase();
    if (!t) return true;
    const digitos = soDigitos(t);
    return valores.some(v => {
        const s = String(v ?? '').toLowerCase();
        return s.includes(t) || (digitos.length >= 3 && soDigitos(s).includes(digitos));
    });
};

export const filtrarEletropostos = (lista, filtros = {}) => {
    const { busca = '', status = '', usinaId = '', supplierId = '', originatorId = '' } = filtros;

    return (lista || []).filter(e => {
        if (status && e.status !== status) return false;
        if (usinaId && usinaDoEletroposto(e)?.id !== usinaId) return false;
        if (supplierId && !(e.fornecedores || []).some(f => f.supplier_id === supplierId)) return false;
        if (originatorId && e.originator_id !== originatorId) return false;
        return casaBusca(busca, [e.nome, e.consumer_unit?.numero_uc, e.endereco?.cidade]);
    });
};

// Duas casas, como a coluna numeric(5,2): 33,33 + 33,33 + 33,34 = 100.
export const somaPercentuais = (fornecedores) =>
    Math.round(
        (fornecedores || [])
            .filter(f => f.ativo !== false)
            .reduce((acc, f) => acc + (Number(f.percentual) || 0), 0) * 100
    ) / 100;

export const validarFornecedores = (fornecedores) => {
    const lista = fornecedores || [];
    const vistos = new Set();

    for (const f of lista) {
        if (!f.supplier_id) return 'Escolha o fornecedor em todas as linhas.';
        if (vistos.has(f.supplier_id)) return 'O mesmo fornecedor aparece duas vezes.';
        vistos.add(f.supplier_id);

        const p = f.percentual === '' || f.percentual === null ? NaN : Number(f.percentual);
        if (!(p > 0 && p <= 100)) return 'Cada percentual precisa ser maior que 0 e no máximo 100.';
    }

    const soma = somaPercentuais(lista);
    if (soma > 100) return `A soma dos percentuais passa de 100% (${soma}%).`;
    return null;
};

export const paraPayloadFornecedores = (fornecedores) =>
    (fornecedores || []).map(f => ({
        supplier_id: f.supplier_id,
        percentual: Number(f.percentual),
        ativo: f.ativo !== false,
    }));

const numeroOuNulo = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const textoOuNulo = (v) => {
    const t = String(v ?? '').trim();
    return t === '' ? null : t;
};

export const montarPayloadEletroposto = (form) => ({
    nome: form.nome.trim(),
    status: form.status,
    plano_id: form.plano_id || null,
    originator_id: form.originator_id || null,
    tarifa_investidor_kwh: numeroOuNulo(form.tarifa_investidor_kwh),
    consumer_unit_id: form.consumer_unit_id || null,
    endereco: {
        cep: form.cep, rua: form.rua, numero: form.numero, bairro: form.bairro,
        cidade: form.cidade, uf: form.uf, ibge: form.ibge,
    },
    qtd_carregadores: numeroOuNulo(form.qtd_carregadores),
    potencia_kw: numeroOuNulo(form.potencia_kw),
    tipo_recarga: form.tipo_recarga || null,
    fabricante: textoOuNulo(form.fabricante),
    modelo: textoOuNulo(form.modelo),
    observacoes: textoOuNulo(form.observacoes),
});

export const mensagemErroEletroposto = (error) => {
    if (!error) return 'Erro desconhecido.';
    if (error.code === '23505' && String(error.message).includes('consumer_unit_id')) {
        return 'Essa UC já está ligada a outro eletroposto.';
    }
    return error.message || 'Erro desconhecido.';
};
