/**
 * Link do contrato que o CLIENTE recebe.
 *
 * O link certo leva a pagina de termos (b2wenergia.com.br/contrato/), que mostra
 * o resumo das clausulas e tem o botao de assinar, e so dali o cliente vai para
 * a Autentique. E o que a adesao publica sempre fez (onboarding-finalizar,
 * `urlTermos` + `keywordTermos`). O botao "Gerar e Enviar" do CRM, mais antigo,
 * encurtava o link da Autentique puro: o cliente caia direto na assinatura, sem
 * ver o resumo (caso MULTI TV, 19/11/2026: link.../assinaturae22887430 ->
 * assina.ae/...), e a mensagem ainda mandava a pagina de resumo SEPARADA, sem
 * os parametros que a preenchem.
 *
 * A URL e a palavra-chave vem do MESMO modulo do servidor, para o CRM e a adesao
 * nao produzirem dois formatos.
 */
import { urlTermos, keywordTermos } from '../../supabase/functions/_shared/onboarding-regras.ts';
import { descontoDaUc } from './contratoUcs';

export { keywordTermos };

export const PAGINA_TERMOS = 'https://www.b2wenergia.com.br/contrato/';

/**
 * Pagina de termos preenchida para este contrato. Leva so nome, concessionaria
 * e desconto: nunca CPF/CNPJ nem endereco, porque o link circula em WhatsApp e
 * e-mail. O desconto segue a regra do termo (UC primeiro, depois o plano) e some
 * da URL quando nao ha um de verdade.
 */
export function urlTermosDoContrato({ linkAssinatura, nome, uc }) {
    return urlTermos(PAGINA_TERMOS, {
        link: linkAssinatura,
        nome: nome || '',
        concessionaria: uc?.concessionaria || '',
        desconto: descontoDaUc(uc)
    });
}

/** O link da Autentique que vai dentro da pagina: o curto, se existe. */
export const linkDeAssinaturaDaSig = (sig) => sig?.short_url || sig?.autentique_url || null;

/**
 * Mensagem do CRM (WhatsApp e e-mail) com um unico link, o da pagina de termos.
 * Antes ela trazia o link da Autentique E, no fim, a pagina generica de resumo.
 */
export const textoLinkContratoCrm = (nome, link) =>
    `Olá ${nome}, bem vindo a B2W Energia. ⚡\n\n`
    + `A partir de agora vc começa a economizar na sua conta de energia 💰\n\n`
    + `Por favor, assine digitalmente para darmos prosseguimento à ativação da sua conta ✍️\n\n`
    + `Entenda os termos do contrato e assine por aqui: 📄\n\n${link}`;
