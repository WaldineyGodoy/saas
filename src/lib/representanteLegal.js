/**
 * Representante legal do assinante pessoa juridica (CNPJ).
 *
 * O termo qualifica a empresa como "neste ato representada por <nome>, CPF
 * <cpf>" so quando `subscribers.representante_nome` existe; sem ele, a empresa
 * sai qualificada como pessoa fisica ("residente e domiciliado"). A adesao
 * publica ja exige os dois; o modal do CRM nao tinha onde preencher, entao todo
 * CNPJ cadastrado por la (11 em 19/11/2026) saia com o termo errado.
 *
 * O CPF e gravado so com digitos, o mesmo formato de `fn_criar_assinante_publico`.
 */
import { validateCpf, maskCpfCnpj } from './validators';
import { nomeProprio } from '../../supabase/functions/_shared/consulta-cpf.ts';

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const aparar = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

export const documentoEhCnpj = (doc) => digitos(doc).length === 14;

/**
 * Mensagem de erro ao salvar, ou null. Os dois campos em branco PODEM ser
 * salvos: o cadastro nao pode ficar refem de um dado que a equipe ainda nao
 * tem, e quem barra o termo errado e o contrato (aviso que trava o envio).
 * Preenchido pela metade ou com CPF invalido, nao: isso e dado ruim gravado.
 */
export function validarRepresentante({ cpf_cnpj, representante_nome, representante_cpf } = {}) {
    if (!documentoEhCnpj(cpf_cnpj)) return null;
    const nome = aparar(representante_nome);
    const cpf = digitos(representante_cpf);
    if (!nome && !cpf) return null;
    if (!nome || !cpf) return 'Informe nome e CPF do representante legal (ou deixe os dois em branco).';
    if (!validateCpf(cpf)) return 'CPF do representante legal inválido.';
    if (nome.split(' ').length < 2) return 'Informe o nome completo do representante legal.';
    return null;
}

/** O que vai para `subscribers`. Pessoa fisica limpa os dois campos. */
export function representanteParaGravar({ cpf_cnpj, representante_nome, representante_cpf } = {}) {
    if (!documentoEhCnpj(cpf_cnpj)) return { representante_nome: null, representante_cpf: null };
    return {
        representante_nome: aparar(representante_nome) || null,
        representante_cpf: digitos(representante_cpf) || null
    };
}

/**
 * O assinante como o termo deve enxergar: o gravado, com o representante do
 * formulario por cima (para a minuta refletir o que a equipe acabou de digitar,
 * sem exigir salvar e reabrir). Formulario em branco nao apaga o gravado.
 * O CPF sai mascarado no texto do contrato, nao como digitos soltos.
 */
export function representanteParaContrato(assinante, formulario = {}) {
    const base = assinante || formulario || {};
    const nome = aparar(formulario?.representante_nome) || aparar(base.representante_nome);
    const cpf = digitos(formulario?.representante_cpf) || digitos(base.representante_cpf);
    return {
        ...base,
        representante_nome: nome || null,
        representante_cpf: cpf ? maskCpfCnpj(cpf) : null
    };
}

// ---------------------------------------------------------------------------
// Representante a partir do quadro de socios (QSA) da consulta de CNPJ
// ---------------------------------------------------------------------------

const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * O CPF dos socios vem MASCARADO pela Receita, em qualquer fonte (cnpj.ws entrega
 * `***454978**`, a CPFHub `***.456.789-**`): so os 6 digitos do meio ficam
 * visiveis. O CPF completo nao existe nessas bases, entao ele nunca e preenchido
 * sozinho: serve de dica e de conferencia do que a equipe digita.
 * Devolve `***.454.978-**`, ou vazio se nao for um CPF mascarado.
 */
export function formatarCpfMascarado(valor) {
    const c = String(valor ?? '').replace(/[.\-\s]/g, '');
    if (!/^[*\d]{11}$/.test(c) || !/\*/.test(c)) return '';
    return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9, 11)}`;
}

/**
 * Confere o CPF digitado com os 6 digitos do meio que a Receita mostra.
 * true/false quando da para comparar; null quando nao (CPF incompleto ou sem
 * mascara da Receita) -- nunca um falso alarme.
 */
export function cpfConfereComReceita(cpfDigitado, mascarado) {
    const d = digitos(cpfDigitado);
    const m = formatarCpfMascarado(mascarado);
    if (d.length !== 11 || !m) return null;
    return d.slice(3, 9) === m.replace(/\D/g, '');
}

/**
 * Quem assina pela empresa, a partir de `socios` da consulta de CNPJ (cnpj.ws).
 *
 *  - so pessoa fisica (precisa de CPF);
 *  - o socio-administrador, o primeiro da lista se houver mais de um;
 *  - sem administrador, so se houver UM socio pessoa fisica;
 *  - com varios socios e nenhum administrador, nao chuta: devolve null.
 *
 * O codigo antigo (`legal_partner`) pegava sempre o primeiro socio, mesmo quando
 * outro era o administrador. Na MULTI TV (23/11/2026) os dois coincidem; so esta
 * funcao garante o administrador quando nao coincidirem.
 */
export function escolherRepresentante(socios) {
    if (!Array.isArray(socios)) return null;

    const pessoas = socios.filter((s) =>
        s && aparar(s.nome) && semAcento(s.tipo || 'pessoa fisica').includes('fisica'));
    if (pessoas.length === 0) return null;

    const qualificacao = (s) => aparar(s.qualificacao_socio?.descricao ?? s.qualificacao_socio ?? '');
    const escolhido = pessoas.find((s) => semAcento(qualificacao(s)).includes('administrador'))
        || (pessoas.length === 1 ? pessoas[0] : null);
    if (!escolhido) return null;

    return {
        nome: nomeProprio(escolhido.nome),
        cpfMascarado: formatarCpfMascarado(escolhido.cpf_cnpj_socio),
        qualificacao: qualificacao(escolhido)
    };
}
