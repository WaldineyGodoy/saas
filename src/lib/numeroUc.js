// Número da UC: o cadastro guarda SÓ DÍGITOS (dono, 23/10/2026).
//
// Com pontos, o número quebra a busca por dígitos e o portal da Cosern trunca
// o campo de código da UC em 15 caracteres sem avisar ("2.157.563.032-89" foi
// parar no cadastro e teve de ser acertado à mão em 19/10/2026). A tela pode
// mostrar o número pontuado, mas o que vai para o banco é o resultado de
// `soDigitosUc`.

export const soDigitosUc = (valor) => String(valor ?? '').replace(/\D/g, '');

/**
 * Exibição do padrão ANEEL de 12 dígitos: 2.015.420.032-17. Números antigos
 * (9–10 dígitos, ex. 7030765391) e qualquer outro tamanho saem só com dígitos.
 */
export function formatarNumeroUc(valor) {
    const d = soDigitosUc(valor);
    if (d.length !== 12) return d;
    return `${d[0]}.${d.slice(1, 4)}.${d.slice(4, 7)}.${d.slice(7, 10)}-${d.slice(10)}`;
}
