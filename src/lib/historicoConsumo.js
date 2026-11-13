// Perfil de consumo da UC (12 meses do calendário), para PRÉ-VISUALIZAÇÃO.
// A fonte da verdade é o banco: fn_gravar_historico_consumo grava
// consumer_units.historico_consumo / consumo_mediano_kwh / start_base_kwh com
// a mesma regra daqui (spec 2026-11-10-plano-originador, "Contrato comum").
//
// Formato do perfil:
//   { "01": { kwh: 980, ref: "2026-01", origem: "cadastro" }, ..., "12": {...} }
// origem: 'cadastro' (lido no upload), 'conta' (sobrescrito por conta nova),
//         'mediana' (mês zerado/ausente preenchido), 'franquia' (backfill sem dado).

export const MESES_CALENDARIO = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export const ORIGENS_HISTORICO = {
    cadastro: 'Lido no cadastro',
    conta: 'Atualizado pela conta',
    mediana: 'Preenchido pela mediana',
    franquia: 'Preenchido pela franquia',
};

const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

// Mediana dos kWh > 0. Aceita números ou objetos { kwh }. Sem consumo: null.
export const medianaKwh = (lista) => {
    const valores = (Array.isArray(lista) ? lista : [])
        .map(item => numero(item && typeof item === 'object' ? item.kwh : item))
        .filter(v => v !== null && v > 0)
        .sort((a, b) => a - b);
    if (valores.length === 0) return null;
    const meio = Math.floor(valores.length / 2);
    return valores.length % 2 ? valores[meio] : (valores[meio - 1] + valores[meio]) / 2;
};

// 'AAAA-MM' válido -> { ref, mes } ; senão null.
const refValida = (mes) => {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(mes || '').trim());
    return m ? { ref: `${m[1]}-${m[2]}`, mes: m[2] } : null;
};

// Histórico do leitor da conta ([{ mes: 'AAAA-MM', kwh, dias }]) -> perfil.
// Por mês do calendário vale a leitura mais recente; a mediana é tirada dos
// meses do perfil com consumo; zerados e ausentes recebem a mediana.
export const montarPerfil = (historicoDoLeitor, origem = 'cadastro') => {
    const porMes = {};
    for (const item of Array.isArray(historicoDoLeitor) ? historicoDoLeitor : []) {
        const r = refValida(item?.mes);
        if (!r) continue;
        const kwh = numero(item.kwh);
        const atual = porMes[r.mes];
        if (!atual || r.ref > atual.ref) porMes[r.mes] = { kwh: kwh !== null && kwh > 0 ? kwh : 0, ref: r.ref, origem };
    }

    const mediana = medianaKwh(Object.values(porMes));
    if (mediana === null) return porMes; // nada com consumo: não há com o que preencher

    const perfil = {};
    for (const mes of MESES_CALENDARIO) {
        const lido = porMes[mes];
        perfil[mes] = lido && lido.kwh > 0
            ? lido
            : { kwh: mediana, ref: lido?.ref ?? null, origem: 'mediana' };
    }
    return perfil;
};

// Mediana de um perfil já montado (o que o banco grava em consumo_mediano_kwh).
export const medianaDoPerfil = (perfil) => medianaKwh(Object.values(perfil || {}));

// Perfil -> 12 linhas em ordem de calendário, para tabela/gráfico.
// Mês sem dado vem com kwh null e origem null.
export const perfilParaLista = (perfil) => MESES_CALENDARIO.map((mes, i) => {
    const item = perfil && typeof perfil === 'object' ? perfil[mes] : null;
    const kwh = numero(item?.kwh);
    return {
        mes,
        nome: NOMES[i],
        kwh,
        ref: item?.ref || null,
        origem: item?.origem || null,
    };
});

// Perfil tem algum mês com dado?
export const perfilTemDados = (perfil) => perfilParaLista(perfil).some(l => l.kwh !== null);

// Coluna/RPC ainda não criadas no banco (migração do Plano do Originador em
// curso): 42703 = coluna inexistente; 42883 = função inexistente;
// PGRST202/PGRST204 = função/coluna fora do cache do PostgREST.
export const ehErroBancoDesatualizado = (error) => {
    if (!error) return false;
    if (['42703', '42883', 'PGRST202', 'PGRST204'].includes(error.code)) return true;
    return /does not exist|could not find the (function|.*column)/i.test(error.message || '');
};

// Grava na UC o histórico lido da conta (fn_gravar_historico_consumo). O
// cliente supabase entra por parâmetro para este arquivo seguir testável.
// Nunca lança: devolve { ok, data } ou { ok: false, error, semBanco }.
export const gravarHistoricoConsumo = async (supabase, ucId, historico, origem = 'cadastro') => {
    if (!ucId || !Array.isArray(historico) || historico.length === 0) return { ok: false, vazio: true };
    try {
        const { data, error } = await supabase.rpc('fn_gravar_historico_consumo', {
            p_uc: ucId, p_historico: historico, p_origem: origem,
        });
        if (error) return { ok: false, error, semBanco: ehErroBancoDesatualizado(error) };
        return { ok: true, data };
    } catch (error) {
        return { ok: false, error, semBanco: ehErroBancoDesatualizado(error) };
    }
};
