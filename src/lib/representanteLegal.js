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
