/**
 * "Tornar Parceiro Power": o assinante vira tambem embaixador (originador) com um
 * clique, sem redigitar os dados em Originadores.
 *
 * O que a ligacao entre os dois cadastros exige (lido em `handle_new_user`,
 * `fn_vincular_cadastros_do_login` e `OriginatorDashboard`):
 *   - o login liga os cadastros pelo E-MAIL, no instante em que e criado, e o papel
 *     segue a prioridade embaixador > assinante;
 *   - a area de embaixador procura o cadastro por `originators_v2.id = id do login`.
 * Entao: sem login ainda, o originador nasce com id proprio e o "Convidar para o
 * app" liga os dois; COM login ja criado, o originador precisa nascer com o MESMO
 * id do login, e o papel do login (assinante) tem de passar a embaixador.
 */
import { validateDocument, validatePhone, maskCpfCnpj } from './validators';
import { ehPapelAdmin } from './papeis';

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const normEmail = (v) => String(v ?? '').trim().toLowerCase();
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * O originador ja cadastrado para esta pessoa, ou null. Casa por e-mail, por CPF
 * (guardado ora mascarado, ora so com digitos) ou pelo id do login. Vazio nunca
 * casa com vazio: dois cadastros sem e-mail nao sao a mesma pessoa.
 */
export function procurarParceiro(originadores, assinante) {
    if (!Array.isArray(originadores) || !assinante) return null;
    const email = normEmail(assinante.email);
    const cpf = digitos(assinante.cpf_cnpj);
    const userId = assinante.user_id || null;

    return originadores.find((o) => {
        if (!o) return false;
        if (userId && o.id === userId) return true;
        if (email && normEmail(o.email) === email) return true;
        if (cpf.length >= 11 && digitos(o.cpf_cnpj) === cpf) return true;
        return false;
    }) || null;
}

/**
 * Cadastro de originador montado a partir do assinante, com os mesmos formatos
 * do modal de Originadores (CPF com mascara, telefone so com digitos, chave PIX
 * padrao igual ao documento, cargo inicial PPF). Plano nao vai: o gatilho do banco
 * coloca o Plano Padrao do Originador.
 *
 * `faltando` lista, de uma vez, tudo o que impede (mesmas regras do modal manual,
 * mais o e-mail, que aqui e obrigatorio porque e por ele que o login e ligado).
 */
export function dadosParaParceiroPower(assinante) {
    const a = assinante || {};
    const doc = digitos(a.cpf_cnpj);
    const nome = String(a.name ?? '').trim().replace(/\s+/g, ' ');
    const email = normEmail(a.email);
    const telefone = digitos(a.phone);

    const faltando = [];
    if (!nome) faltando.push('nome');
    if (!validateDocument(a.cpf_cnpj)) faltando.push('CPF/CNPJ válido');
    if (!EMAIL.test(email)) faltando.push('e-mail');
    if (!validatePhone(a.phone)) faltando.push('telefone com DDD e 9 dígitos');

    const documento = maskCpfCnpj(doc);
    const payload = {
        name: nome,
        cpf_cnpj: documento,
        email,
        phone: telefone,
        pix_key: documento,
        pix_key_type: doc.length === 14 ? 'cnpj' : 'cpf',
        cargo: 'ppf',
        address: {
            cep: a.cep || '',
            rua: a.rua || '',
            numero: a.numero || '',
            complemento: a.complemento || '',
            bairro: a.bairro || '',
            cidade: a.cidade || '',
            uf: a.uf || ''
        }
    };
    // Ja tem login: o originador usa o id dele, que e como a area de embaixador o acha.
    if (a.user_id) payload.id = a.user_id;

    return { ok: faltando.length === 0, faltando, payload };
}

/**
 * So o login de ASSINANTE passa a embaixador, e so por quem e admin: nunca mexe em
 * login de admin, fornecedor ou quem ja e embaixador, e coordenador nao altera
 * papel de ninguem.
 */
export const podeTrocarPapel = (perfilDoLogin, papelDeQuemClica) =>
    perfilDoLogin?.role === 'subscriber' && ehPapelAdmin(papelDeQuemClica);

/** Texto da confirmacao antes de criar, conforme a situacao do login. */
export function textoConfirmacaoParceiroPower({ nome, temLogin, vaiTrocarPapel }) {
    const base = `Cadastrar ${nome || 'este assinante'} como Parceiro Power?\n\n`
        + 'O cadastro entra com o cargo inicial Parceiro Power Free (PPF) e o Plano Padrão do Originador. '
        + 'A chave PIX padrão é o CPF/CNPJ do cadastro e pode ser alterada em Originadores.\n\n';

    if (!temLogin) {
        return base + 'Este cadastro ainda não tem acesso. Depois, clique em Convidar para o app: o acesso é criado já como Parceiro Power, ligado a este mesmo cadastro.';
    }
    if (vaiTrocarPapel) {
        return base + 'Este cadastro já tem acesso como assinante. O papel do login passa a Parceiro Power (área de embaixador no CRM); a assinatura segue no app.';
    }
    return base + 'Este cadastro já tem acesso como assinante, e o seu usuário não pode alterar papel. O cadastro será criado; peça a um administrador para trocar o papel do login em Configurações → Perfil de Usuários.';
}
