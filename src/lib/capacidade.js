/**
 * Regra de capacidade (franquia ocupada x geração) da usina.
 *
 * Cópia da regra do WorkSpace 2 (src/lib/capacidade.js, testada lá): a área do
 * investidor e este painel precisam mostrar o mesmo número. Se a regra mudar,
 * mude nos dois. Diferença: aqui 'desligado_por_tt' também devolve a franquia.
 */

/**
 * Franquia é capacidade contratada, então fica ocupada desde o vínculo —
 * inclusive enquanto a UC aguarda conexão, e inclusive com o assinante em atraso
 * (a UC segue conectada e compensando; quem está atrasado é o pagamento).
 * Só estes estados devolvem a capacidade para a usina.
 */
export const STATUS_LIBERAM_FRANQUIA = new Set([
    'desconectado', 'cancelado', 'cancelado_inadimplente', 'desligado_por_tt',
]);

export const ocupaFranquia = (uc) => !STATUS_LIBERAM_FRANQUIA.has(uc?.status);

const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * A UC geradora consome no próprio medidor; esse consumo sai da geração ANTES do
 * rateio (lado da oferta) e não entra no comprometido das beneficiárias.
 *
 * @returns {{ geracao: number|null, autoconsumoUG: number, disponivel: number|null,
 *   comprometido: number, livre: number|null, ocupacao: number|null }}
 *   livre < 0 é sobrecarga (overbook); ocupacao é null quando disponivel <= 0.
 */
export function calcularCapacidade({ ucs = [], geracao = null } = {}) {
    const ativas = (ucs || []).filter(ocupaFranquia);

    const autoconsumoUG = ativas
        .filter((uc) => uc.tipo_unidade === 'geradora')
        .reduce((acc, uc) => acc + numero(uc.franquia), 0);
    const comprometido = ativas
        .filter((uc) => uc.tipo_unidade !== 'geradora')
        .reduce((acc, uc) => acc + numero(uc.franquia), 0);

    const bruta = (geracao === null || geracao === undefined || geracao === ''
        || !Number.isFinite(Number(geracao)))
        ? null : Number(geracao);

    const disponivel = bruta === null ? null : bruta - autoconsumoUG;
    const livre = disponivel === null ? null : disponivel - comprometido;
    const ocupacao = (disponivel === null || disponivel <= 0)
        ? null : (comprometido / disponivel) * 100;

    return { geracao: bruta, autoconsumoUG, disponivel, comprometido, livre, ocupacao };
}

/**
 * Leitura de tela: Ocupado = consumo da UG + franquias das beneficiárias, para que
 * Ocupado + Disponível feche na geração estimada. A conta de livre é a mesma de
 * calcularCapacidade (a UG não é somada duas vezes).
 */
export function ocupacaoDaGeracao(cap) {
    const ocupado = cap.autoconsumoUG + cap.comprometido;
    const pct = cap.geracao > 0 ? (ocupado / cap.geracao) * 100 : (ocupado > 0 ? 100 : 0);
    return { ocupado, pct };
}

/* ------------------------------------------------------------------------- *
 * Versão MENSAL (revisão de 12/11/2026, itens 7 e 8 da spec do Plano do
 * Originador): a franquia passa a ser um perfil de 12 meses
 * (`consumer_units.historico_consumo`, por mês do CALENDÁRIO) comparado mês a
 * mês com a geração estimada da usina naquele mês
 * (`fn_geracao_estimada_mensal`). Overbook vira "em quais meses", não um número.
 *
 * Mesma regra de quem ocupa da leitura única (ocupaFranquia, UG fora do
 * comprometido). Com perfil = 12 × franquia e geração plana, cada mês dá
 * exatamente o mesmo número que calcularCapacidade.
 * ------------------------------------------------------------------------- */

export const MESES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
export const ROTULOS_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** '1', 1, '01', '2026-01' → '01'. Inválido → null. */
export function chaveMes(mes) {
    if (mes === null || mes === undefined || mes === '') return null;
    const s = String(mes);
    const n = Number(/^\d{4}-\d{2}/.test(s) ? s.slice(5, 7) : s);
    return Number.isInteger(n) && n >= 1 && n <= 12 ? String(n).padStart(2, '0') : null;
}

/**
 * Conta Saldo (ex.: "B2W - Conta Saldo") não tem franquia contratada: é depósito
 * da sobra de crédito, cadastrada com franquia de 1 kWh. O perfil dela (consumo
 * medido de algumas centenas de kWh) NÃO pode passar a ocupar a usina, então
 * beneficiária com franquia <= 1 ignora o perfil e fica com a franquia.
 * A UG não entra aqui: o consumo medido dela é autoconsumo de verdade.
 */
export const FRANQUIA_MAX_SEM_CONTRATO = 1;
export const semFranquiaContratada = (uc) =>
    uc?.tipo_unidade !== 'geradora' && numero(uc?.franquia) <= FRANQUIA_MAX_SEM_CONTRATO;

const kwhDoPerfil = (uc, chave) => {
    const perfil = uc?.historico_consumo;
    if (!perfil || typeof perfil !== 'object') return null;
    const item = perfil[chave];
    const v = (item && typeof item === 'object') ? item.kwh : item;
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

/** A UC tem perfil mensal utilizável (ao menos um mês com kWh)? */
export const temPerfilMensal = (uc) =>
    !semFranquiaContratada(uc) && MESES.some((m) => kwhDoPerfil(uc, m) !== null);

/**
 * kWh que a UC ocupa no mês do calendário `mes` ('01'..'12', 1..12 ou 'AAAA-MM'):
 * o perfil do mês, se houver; senão a franquia (o "12 × franquia" do backfill).
 * Não olha status: quem decide se ocupa é ocupaFranquia.
 */
export function franquiaDoMes(uc, mes) {
    const chave = chaveMes(mes);
    if (chave && !semFranquiaContratada(uc)) {
        const v = kwhDoPerfil(uc, chave);
        if (v !== null) return v;
    }
    return numero(uc?.franquia);
}

/**
 * Geração estimada mês a mês. `geracaoMensal` ({"01":kwh,...}, vindo da RPC) dá a
 * FORMA do ano; o nível vem de `geracaoEstimada` (média mensal da usina), para o
 * modal refletir a geração digitada e ainda não salva. Como a RPC distribui a
 * própria geracao_estimada_kwh, com o valor salvo o resultado é o da RPC.
 * Sem RPC (ou forma incompleta) → plana: a média em todos os meses.
 * Sem geração nenhuma → null.
 */
export function geracaoDoAno(geracaoMensal, geracaoEstimada) {
    const media = (geracaoEstimada === null || geracaoEstimada === undefined || geracaoEstimada === ''
        || !Number.isFinite(Number(geracaoEstimada))) ? null : Number(geracaoEstimada);

    const forma = {};
    let soma = 0;
    let validos = 0;
    if (geracaoMensal && typeof geracaoMensal === 'object') {
        for (const m of MESES) {
            const bruto = geracaoMensal[m];
            const n = Number(bruto);
            if (bruto !== null && bruto !== '' && Number.isFinite(n) && n >= 0) {
                forma[m] = n; soma += n; validos += 1;
            }
        }
    }
    const temForma = validos === 12 && soma > 0;

    if (!temForma) {
        if (media === null) return null;
        return Object.fromEntries(MESES.map((m) => [m, media]));
    }
    if (media === null) return forma;
    return Object.fromEntries(MESES.map((m) => [m, (media * 12 * forma[m]) / soma]));
}

/** A forma vinda da RPC é sazonal (12 meses válidos, não todos iguais)? */
export function geracaoEhSazonal(geracaoMensal) {
    const forma = geracaoDoAno(geracaoMensal, null);
    if (!forma) return false;
    const v = MESES.map((m) => forma[m]);
    return v.some((x) => Math.abs(x - v[0]) > 1e-9);
}

/**
 * Capacidade mês a mês da usina.
 *
 * @param {{ geracao_estimada_kwh?: number|string }|null} usina
 * @param {Array} ucs  UCs vinculadas (status, tipo_unidade, franquia, historico_consumo)
 * @param {Object|null} geracaoMensal  {"01":kwh,...,"12":kwh} da fn_geracao_estimada_mensal
 * @returns {Array<{ mes: string, rotulo: string, geracao: number|null, consumoUG: number,
 *   ocupado: number, disponivel: number|null, excedente: number, livre: number|null,
 *   pct: number|null, overbook: boolean }>}
 *   12 linhas. ocupado = franquias das beneficiárias no mês (sem a UG);
 *   livre = geracao − consumoUG − ocupado; disponivel = max(0, livre);
 *   excedente = max(0, −livre) (overbook); pct = (consumoUG + ocupado) / geracao,
 *   o mesmo de ocupacaoDaGeracao na leitura única.
 */
export function capacidadeMensal(usina, ucs = [], geracaoMensal = null) {
    const ativas = (ucs || []).filter(ocupaFranquia);
    const ug = ativas.filter((uc) => uc.tipo_unidade === 'geradora');
    const benef = ativas.filter((uc) => uc.tipo_unidade !== 'geradora');
    const ano = geracaoDoAno(geracaoMensal, usina?.geracao_estimada_kwh);

    return MESES.map((mes, i) => {
        const consumoUG = ug.reduce((acc, uc) => acc + franquiaDoMes(uc, mes), 0);
        const ocupado = benef.reduce((acc, uc) => acc + franquiaDoMes(uc, mes), 0);
        const geracao = ano ? ano[mes] : null;
        const livre = geracao === null ? null : geracao - consumoUG - ocupado;
        const total = consumoUG + ocupado;
        const pct = geracao === null ? null
            : geracao > 0 ? (total / geracao) * 100 : (total > 0 ? 100 : 0);
        return {
            mes,
            rotulo: ROTULOS_MES[i],
            geracao,
            consumoUG,
            ocupado,
            disponivel: livre === null ? null : Math.max(0, livre),
            excedente: livre === null ? 0 : Math.max(0, -livre),
            livre,
            pct,
            overbook: livre !== null && livre < 0,
        };
    });
}

/** O mês de menor folga (maior excedente, ou o mais apertado se nenhum estoura). */
export function piorMes(linhas = []) {
    const comGeracao = (linhas || []).filter((l) => l && l.livre !== null && l.livre !== undefined);
    if (!comGeracao.length) return null;
    return comGeracao.reduce((pior, l) => (l.livre < pior.livre ? l : pior));
}

/** Linha do mês do calendário de `data` (padrão: hoje). */
export function mesCorrente(linhas = [], data = new Date()) {
    const chave = String(data.getMonth() + 1).padStart(2, '0');
    return (linhas || []).find((l) => l?.mes === chave) || null;
}

/**
 * Resumo para alerta de tela.
 * @returns {{ linhas, pior, corrente, mesesEmExcedente: string[], temOverbook: boolean,
 *   ucsComPerfil: number, geracaoSazonal: boolean }}
 */
export function resumoCapacidadeMensal(usina, ucs = [], geracaoMensal = null, data = new Date()) {
    const linhas = capacidadeMensal(usina, ucs, geracaoMensal);
    const emExcedente = linhas.filter((l) => l.overbook);
    return {
        linhas,
        pior: piorMes(linhas),
        corrente: mesCorrente(linhas, data),
        mesesEmExcedente: emExcedente.map((l) => l.rotulo),
        temOverbook: emExcedente.length > 0,
        ucsComPerfil: (ucs || []).filter(ocupaFranquia).filter(temPerfilMensal).length,
        geracaoSazonal: geracaoEhSazonal(geracaoMensal),
    };
}

/* ------------------------------------------------------------------------- *
 * Leitura da RPC fn_geracao_estimada_mensal, com degradação: se a função ainda
 * não existe no banco (PGRST202 / 42883), marca indisponível para a sessão e
 * devolve null — a tela cai na geração plana sem repetir a chamada.
 * O client é parâmetro para este arquivo continuar puro (testável sem Supabase).
 * ------------------------------------------------------------------------- */
let rpcGeracaoMensalAusente = false;
const cacheGeracaoMensal = new Map();

const ehFuncaoAusente = (error) => {
    if (!error) return false;
    const code = String(error.code || '');
    return code === 'PGRST202' || code === '42883'
        || /could not find the function|does not exist/i.test(String(error.message || ''));
};

/** @returns {Promise<Object|null>} {"01":kwh,...} ou null (sem RPC, erro ou sem usina). */
export function carregarGeracaoMensal(client, usinaId) {
    if (!client || !usinaId || rpcGeracaoMensalAusente) return Promise.resolve(null);
    if (cacheGeracaoMensal.has(usinaId)) return cacheGeracaoMensal.get(usinaId);
    const pedido = (async () => {
        try {
            const { data, error } = await client.rpc('fn_geracao_estimada_mensal', { p_usina: usinaId });
            if (error) {
                if (ehFuncaoAusente(error)) rpcGeracaoMensalAusente = true;
                cacheGeracaoMensal.delete(usinaId);
                return null;
            }
            return data && typeof data === 'object' ? data : null;
        } catch {
            cacheGeracaoMensal.delete(usinaId);
            return null;
        }
    })();
    cacheGeracaoMensal.set(usinaId, pedido);
    return pedido;
}

/** Esquece o cache (ex.: depois de salvar a geração ou a cidade da usina). */
export function limparCacheGeracaoMensal(usinaId) {
    if (usinaId) cacheGeracaoMensal.delete(usinaId); else cacheGeracaoMensal.clear();
}
