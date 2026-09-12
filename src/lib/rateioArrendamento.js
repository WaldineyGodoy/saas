/**
 * Rateio do arrendamento entre os beneficiários de uma área.
 *
 * Espelho em JavaScript da `fn_ratear_arrendamento` do banco, para a tela
 * mostrar antes de salvar o que o banco vai calcular depois. Quem manda é o
 * banco: esta função existe para dar retorno imediato ao operador, nunca para
 * gravar valor.
 *
 * A ordem importa: fixos primeiro, percentuais sobre o que sobrar. Aplicar
 * percentual sobre o total e depois somar o fixo estoura o aluguel. O resíduo
 * de centavo vai para o primeiro `terceiro`, igual ao banco, senão duas
 * divisões arredondadas produzem centavo que não vai para ninguém.
 */

export const num = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};

export const dinheiro = (v) =>
    `R$ ${(num(v) ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const centavos = (n) => Math.round(n * 100) / 100;

export function ratear(aluguel, beneficiarios) {
    const base = num(aluguel) ?? 0;
    const ativos = (beneficiarios || []).filter(b => b.ativo !== false);

    const somaFixo = ativos.filter(b => b.rateio_tipo === 'fixo')
        .reduce((s, b) => s + (num(b.rateio_valor) ?? 0), 0);
    const somaPct = ativos.filter(b => b.rateio_tipo !== 'fixo')
        .reduce((s, b) => s + (num(b.rateio_valor) ?? 0), 0);

    const resto = base - somaFixo;
    const parcelas = ativos.map(b => ({
        ...b,
        valor: b.rateio_tipo === 'fixo'
            ? centavos(num(b.rateio_valor) ?? 0)
            : centavos(resto * ((num(b.rateio_valor) ?? 0) / 100))
    }));

    const alocado = parcelas.reduce((s, p) => s + p.valor, 0);
    const iResiduo = parcelas.findIndex(p => p.tipo === 'terceiro');
    if (iResiduo >= 0) {
        parcelas[iResiduo].valor = centavos(parcelas[iResiduo].valor + (base - alocado));
    }

    // As mesmas recusas da função do banco, ditas em português de operador.
    // Descobrir que o rateio não fecha na hora de pagar é tarde.
    const problemas = [];
    if (!ativos.length) {
        problemas.push('Nenhum beneficiário ativo: sem quem receber, não há repasse.');
    }
    if (ativos.length && !ativos.some(b => b.tipo === 'terceiro')) {
        problemas.push('Falta o dono da terra: alguém precisa ser do tipo arrendante.');
    }
    if (somaFixo > base + 0.005) {
        problemas.push(`As parcelas fixas somam ${dinheiro(somaFixo)} e o aluguel é ${dinheiro(base)}.`);
    }
    if (somaPct > 0 && Math.abs(somaPct - 100) > 0.0001) {
        problemas.push(`Os percentuais somam ${String(somaPct).replace('.', ',')}%, e precisam somar exatamente 100%.`);
    }
    if (somaPct === 0 && Math.abs(resto) > 0.005) {
        problemas.push(`Sobram ${dinheiro(resto)} sem destino depois das parcelas fixas.`);
    }
    if (ativos.some(b => !String(b.nome || '').trim())) {
        problemas.push('Há beneficiário sem nome.');
    }
    if (ativos.some(b => b.tipo !== 'casa' && !b.forma_pagamento)) {
        problemas.push('Há beneficiário sem forma de pagamento: ele não poderá ser pago.');
    }
    if (ativos.some(b => b.forma_pagamento === 'pix' && !String(b.pix_key || '').trim())) {
        problemas.push('Há beneficiário em PIX sem chave cadastrada.');
    }

    return { parcelas, somaFixo, somaPct, problemas, valido: problemas.length === 0 };
}

/** "2026-08-01" vira "08/2026". Competência é mês, nunca dia. */
export const competenciaLegivel = (d) => {
    if (!d) return '—';
    const [ano, mes] = String(d).split('-');
    return `${mes}/${ano}`;
};
