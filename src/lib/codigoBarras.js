/**
 * Valor embutido no código de barras de arrecadação (FEBRABAN).
 *
 * A linha digitável de 48 dígitos é o código de barras de 44 com um dígito
 * verificador por bloco. Removidos os DVs, as posições 5 a 15 carregam o valor
 * em centavos — é o número que o banco vai debitar, independentemente do que o
 * sistema achar que deve pagar.
 *
 * Serve como conferência gratuita contra erro de extração de PDF: se o valor da
 * conta não bate com o do código, alguma das duas leituras está errada e não se
 * paga nenhuma das duas.
 *
 * Devolve null quando não dá para afirmar nada (código ausente, tamanho
 * inesperado, ou boleto bancário — que começa com outro dígito e guarda o valor
 * em outra posição).
 */
export const valorDoCodigoDeBarras = (linhaDigitavel) => {
    const d = String(linhaDigitavel || '').replace(/\D/g, '');

    let barra = null;
    if (d.length === 48) barra = [0, 12, 24, 36].map((i) => d.substr(i, 11)).join('');
    else if (d.length === 44) barra = d;
    if (!barra || barra[0] !== '8') return null;

    const centavos = parseInt(barra.substr(4, 11), 10);
    return Number.isNaN(centavos) ? null : centavos / 100;
};
