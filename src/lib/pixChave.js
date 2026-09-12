/**
 * Coerência entre o TIPO e o VALOR da chave PIX.
 *
 * O Asaas recebe os dois em campos separados (`pixAddressKeyType` e
 * `pixAddressKey`). Um e-mail declarado como CPF ou é recusado na hora, ou,
 * no pior caso, resolve para uma conta que não é a pretendida. Foi o que
 * aconteceu no cadastro do arrendante da Vista Bom Jesus em 12/09/2026: tipo
 * CPF com um e-mail no valor, R$ 1.200 prestes a sair.
 *
 * Por isso a conferência bloqueia o salvamento em vez de avisar. Chave errada
 * não dá erro visível: dá dinheiro na conta de outra pessoa.
 */

const so = (v) => String(v ?? '').replace(/\D/g, '');

const FORMATOS = {
    CPF: {
        rotulo: 'CPF',
        valida: (v) => so(v).length === 11 && String(v).trim() === so(v),
        exemplo: '11 dígitos, só números'
    },
    CNPJ: {
        rotulo: 'CNPJ',
        valida: (v) => so(v).length === 14 && String(v).trim() === so(v),
        exemplo: '14 dígitos, só números'
    },
    EMAIL: {
        rotulo: 'E-mail',
        valida: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()),
        exemplo: 'nome@dominio.com'
    },
    TELEFONE: {
        // Com ou sem +55: o Asaas normaliza, mas 10 ou 11 dígitos é o piso.
        rotulo: 'Telefone',
        valida: (v) => [10, 11, 12, 13].includes(so(v).length),
        exemplo: 'DDD + número, com ou sem +55'
    },
    ALEATORIA: {
        rotulo: 'Aleatória',
        valida: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v).trim()),
        exemplo: 'as 36 posições geradas pelo banco'
    }
};

/** O que o valor PARECE ser, independentemente do que foi declarado. */
export function inferirTipo(valor) {
    const v = String(valor ?? '').trim();
    if (!v) return null;
    if (FORMATOS.EMAIL.valida(v)) return 'EMAIL';
    if (FORMATOS.ALEATORIA.valida(v)) return 'ALEATORIA';
    const d = so(v);
    if (d.length === 11 && v === d) return 'CPF';
    if (d.length === 14 && v === d) return 'CNPJ';
    if ([10, 12, 13].includes(d.length)) return 'TELEFONE';
    return null;
}

/**
 * Devolve `{ ok, erro }`. `erro` é a frase que a tela mostra, já dizendo o que
 * fazer — não só que está errado.
 */
export function conferirChavePix(tipo, valor) {
    const v = String(valor ?? '').trim();
    if (!v) return { ok: false, erro: 'Chave PIX em branco.' };

    const formato = FORMATOS[tipo];
    if (!formato) return { ok: false, erro: `Tipo de chave "${tipo}" não é reconhecido.` };

    if (formato.valida(v)) return { ok: true, erro: null };

    // Onze dígitos são CPF e telefone ao mesmo tempo, e o palpite não tem como
    // desempatar. Dizer só "parece CPF" mandaria de volta para o tipo errado
    // quando o valor é um celular, então o aviso oferece os dois.
    const d = so(v);
    if (d.length === 11 && v === d) {
        return {
            ok: false,
            erro: `A chave está declarada como ${formato.rotulo}, mas "${v}" tem 11 dígitos: `
                + 'é CPF ou Telefone. Escolha um dos dois no tipo.'
        };
    }

    const parece = inferirTipo(v);
    if (parece && parece !== tipo) {
        return {
            ok: false,
            erro: `A chave está declarada como ${formato.rotulo}, mas "${v}" parece ${FORMATOS[parece].rotulo}. `
                + `Troque o tipo para ${FORMATOS[parece].rotulo} ou corrija o valor.`
        };
    }

    return {
        ok: false,
        erro: `"${v}" não é um ${formato.rotulo} válido (${formato.exemplo}).`
    };
}
