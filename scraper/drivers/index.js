/**
 * Registro de drivers de portal de concessionária.
 *
 * Cada driver encapsula um portal inteiro: URL, fluxo de login, navegação,
 * seletores e download. O scraper.js só conhece este contrato — nunca a
 * mecânica de um portal específico.
 *
 * PARA ADICIONAR UMA CONCESSIONÁRIA:
 *   1. Crie drivers/<nome>.js implementando o mesmo contrato (use
 *      neoenergia.js como referência do que precisa existir).
 *   2. Importe e adicione ao array DRIVERS abaixo.
 *
 * A escolha do driver é feita pelo valor de consumer_units.concessionaria,
 * casado contra matchConcessionaria (mesmo padrão do ilike do Postgres).
 * Quando existir mais de um driver e o cadastro estabilizar, este array é o
 * candidato natural a virar tabela de configuração no banco.
 */

const neoenergia = require('./neoenergia');

const DRIVERS = [
    neoenergia,
];

/** "Neoenergia%" -> /^Neoenergia.*$/i  (equivalente ao ilike do Postgres) */
function padraoParaRegex(padrao) {
    const escapado = padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + escapado.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
}

/** Retorna o driver responsável por uma concessionária, ou null. */
function resolverDriver(concessionaria) {
    if (!concessionaria) return null;
    return DRIVERS.find(d => padraoParaRegex(d.matchConcessionaria).test(concessionaria)) || null;
}

module.exports = { DRIVERS, resolverDriver };
