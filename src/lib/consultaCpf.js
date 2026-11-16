/**
 * Regras das telas para a consulta de CPF (Edge Function `consulta-cpf`).
 *
 * A consulta e paga e devolve dado pessoal, entao a ORDEM e a regra:
 *   1. a validacao interna (`validateCpf`, a mesma do cadastro) vem primeiro;
 *   2. CPF que ela rejeita NUNCA vira chamada: a pessoa e avisada na hora;
 *   3. so CPF valido, e diferente do ultimo consultado, vai ao servidor.
 *
 * O servidor repete a validacao (a funcao e alcancavel com a chave anon do
 * projeto); esta aqui existe para o erro aparecer sem esperar a rede e para
 * nao gastar nem a ida ao servidor.
 */
import { validateCpf } from './validators';

export const MSG_CPF_INVALIDO = 'CPF inválido. Confira os números digitados.';
export const MSG_CPF_INCOMPLETO = 'Documento incompleto. Confira os números digitados.';
const MSG_FALHA_GENERICA = 'Não foi possível consultar o CPF agora. Preencha os dados manualmente.';

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Decide o que fazer quando a pessoa sai do campo CPF/CNPJ.
 *
 * `ultimoConsultado` evita repetir a consulta ao sair do campo duas vezes com
 * o mesmo numero. `cpfOriginal` e o CPF com que o assinante ja estava gravado:
 * abrir um cadastro existente e passar pelo campo nao pode gastar consulta
 * nem sobrescrever um nome que a equipe corrigiu.
 *
 * Retorna:
 *   { acao: 'nada' }                    -> campo vazio ou CNPJ completo (outro fluxo)
 *   { acao: 'avisar', mensagem }        -> rejeitado pela validacao interna
 *   { acao: 'ignorar' }                 -> valido, mas nao precisa consultar
 *   { acao: 'consultar', cpf }          -> valido e novo
 */
export function avaliarCpfDigitado(valor, { ultimoConsultado, cpfOriginal } = {}) {
    const d = soDigitos(valor);
    if (!d) return { acao: 'nada' };
    if (d.length === 14) return { acao: 'nada' };
    if (d.length !== 11) return { acao: 'avisar', mensagem: MSG_CPF_INCOMPLETO };
    if (!validateCpf(d)) return { acao: 'avisar', mensagem: MSG_CPF_INVALIDO };
    if (d === soDigitos(ultimoConsultado) || d === soDigitos(cpfOriginal)) return { acao: 'ignorar' };
    return { acao: 'consultar', cpf: d };
}

/**
 * Converte a resposta da funcao no que entra no formulario.
 *
 * `patch` so leva o que a consulta de fato trouxe: nome vazio nao apaga o que
 * foi digitado, e o nascimento que nao veio (o publico nunca o recebe) mantem
 * o valor atual. `aviso` e o texto para mostrar quando nada foi preenchido.
 */
export function aplicarConsulta(form, resposta) {
    if (!resposta || typeof resposta !== 'object' || typeof resposta.ok !== 'boolean') {
        return { patch: {}, aviso: MSG_FALHA_GENERICA };
    }
    if (!resposta.ok) return { patch: {}, aviso: resposta.mensagem || MSG_FALHA_GENERICA };
    if (!resposta.encontrado) return { patch: {}, aviso: resposta.mensagem || MSG_FALHA_GENERICA };

    const patch = {};
    if (resposta.nome) {
        patch.name = resposta.nome;
        patch.data_nascimento = resposta.nascimento || form?.data_nascimento || '';
    }
    return { patch, aviso: null };
}
