/**
 * Dias uteis bancarios brasileiros.
 *
 * Nasceu de um caso concreto: em 03/09/2026 o seletor de vencimento do
 * consolidado sugeriu sozinho 07/09 — Independencia. O laco antigo so pulava
 * sabado e domingo, entao feriado passava batido e o boleto ia vencer num dia
 * sem compensacao bancaria.
 *
 * Aqui interessa o calendario BANCARIO, nao o civil: Carnaval e Corpus Christi
 * sao ponto facultativo e nao feriado nacional, mas o banco fecha, e boleto que
 * vence com banco fechado so compensa no dia seguinte.
 */

/**
 * Domingo de Pascoa pelo algoritmo de Meeus/Jones/Butcher (calendario
 * gregoriano). Ancora os quatro feriados moveis.
 */
const domingoDePascoa = (ano) => {
    const a = ano % 19;
    const b = Math.floor(ano / 100);
    const c = ano % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(ano, mes - 1, dia);
};

const chave = (data) =>
    `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;

const somarDias = (data, dias) => {
    const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
    d.setDate(d.getDate() + dias);
    return d;
};

const cacheFeriados = new Map();

/**
 * Feriados nacionais + ponto facultativo bancario de um ano, como Set de
 * 'YYYY-MM-DD'. Nao cobre feriado estadual nem municipal: em Natal/RN nao ha
 * data municipal que mova vencimento de boleto de forma relevante, e incluir
 * palpite seria pior que a omissao declarada.
 */
export const feriadosBancarios = (ano) => {
    if (cacheFeriados.has(ano)) return cacheFeriados.get(ano);

    const fixos = [
        [1, 1],   // Confraternizacao Universal
        [4, 21],  // Tiradentes
        [5, 1],   // Dia do Trabalho
        [9, 7],   // Independencia
        [10, 12], // Nossa Senhora Aparecida
        [11, 2],  // Finados
        [11, 15], // Proclamacao da Republica
        [11, 20], // Consciencia Negra (nacional desde a Lei 14.759/2023)
        [12, 25], // Natal
    ];

    const datas = fixos.map(([m, d]) => new Date(ano, m - 1, d));

    // Moveis, ancorados na Pascoa. Carnaval e Corpus Christi entram por
    // fechamento bancario, nao por lei federal.
    const pascoa = domingoDePascoa(ano);
    datas.push(somarDias(pascoa, -48)); // Carnaval (segunda)
    datas.push(somarDias(pascoa, -47)); // Carnaval (terca)
    datas.push(somarDias(pascoa, -2));  // Sexta-feira Santa
    datas.push(somarDias(pascoa, 60));  // Corpus Christi

    const set = new Set(datas.map(chave));
    cacheFeriados.set(ano, set);
    return set;
};

export const ehFimDeSemana = (data) => data.getDay() === 0 || data.getDay() === 6;

export const ehFeriado = (data) => feriadosBancarios(data.getFullYear()).has(chave(data));

export const ehDiaUtil = (data) => !ehFimDeSemana(data) && !ehFeriado(data);

/** Empurra para frente ate cair em dia util. Devolve a propria data se ja for. */
export const proximoDiaUtil = (data) => {
    let d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
    while (!ehDiaUtil(d)) d = somarDias(d, 1);
    return d;
};

/**
 * Proxima ocorrencia de um dia do mes que nao esteja antes de `minimo`.
 *
 * Mes curto nao vira mes seguinte: dia 31 em fevereiro vira o ultimo dia de
 * fevereiro. Vencimento configurado no fim do mes tem que continuar no fim do
 * mes, senao o boleto pula um ciclo inteiro.
 */
export const proximaOcorrenciaDoDia = (diaDoMes, minimo = new Date()) => {
    const base = new Date(minimo.getFullYear(), minimo.getMonth(), minimo.getDate());
    const noMes = (ano, mes) => {
        const ultimo = new Date(ano, mes + 1, 0).getDate();
        return new Date(ano, mes, Math.min(diaDoMes, ultimo));
    };

    let candidato = noMes(base.getFullYear(), base.getMonth());
    if (candidato < base) candidato = noMes(base.getFullYear(), base.getMonth() + 1);
    return candidato;
};
