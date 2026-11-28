// Regime de consumo da UC (conta em rampa). ESPELHO PURO de fn_regime_consumo
// (supabase/migrations/20261127a_conta_em_rampa.sql): serve à pré-visualização
// na tela; quem grava é o banco. Mesmas fixtures nos dois testes.
// Spec: docs/superpowers/specs/2026-11-26-conta-em-rampa-design.md

export const PARAMETROS_RAMPA = { prudencia: 0.8, razao: 2, janela: 6, queda: 0.5, banda: 1.25 };

const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const mediana = (valores) => {
    const v = [...valores].sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// Leitura do leitor da conta -> série por mês do CALENDÁRIO (vale a mais
// recente), só kWh > 0, ordenada por referência, com consumo a 30 dias.
const serie = (historico) => {
    const porMes = {};
    for (const item of Array.isArray(historico) ? historico : []) {
        const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(item?.mes || ''));
        const kwh = numero(item?.kwh);
        if (!m || kwh === null || kwh <= 0) continue;
        const dias = numero(item?.dias);
        const atual = porMes[m[2]];
        if (!atual || item.mes > atual.ref) {
            porMes[m[2]] = { ref: item.mes, kwh, c: dias && dias > 0 ? (kwh / dias) * 30 : kwh };
        }
    }
    return Object.values(porMes).sort((a, b) => (a.ref < b.ref ? -1 : 1));
};

export function classificarRegime(historico, params = PARAMETROS_RAMPA) {
    const s = serie(historico);
    const n = s.length;
    const vazio = { regime: 'insuficiente', n, cUlt: null, medianaAnteriores: null, franquiaRampa: null, franquiaJanela: null };
    if (n < 2) return vazio;

    const c = s.map((x) => x.c);
    const cUlt = c[n - 1];
    const cPen = c[n - 2];
    const medAnt = mediana(c.slice(0, n - 1));
    const medPerfil = mediana(s.map((x) => x.kwh));

    let regime = 'estavel';
    if (n <= params.janela && cUlt >= params.razao * medAnt && cUlt > params.banda * cPen) regime = 'em_rampa';
    else if (n >= 3 && cUlt <= params.queda * medAnt) regime = 'em_queda';

    return {
        regime,
        n,
        cUlt,
        medianaAnteriores: medAnt,
        franquiaRampa: Math.round(Math.max(params.prudencia * cUlt, medPerfil)),
        franquiaJanela: n >= 3 ? Math.round(mediana(c.slice(-3))) : null,
    };
}
