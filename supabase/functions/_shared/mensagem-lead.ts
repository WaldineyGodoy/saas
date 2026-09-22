/**
 * Mensagens que o embaixador (papel `originator`) pode mandar ao proprio lead.
 *
 * Task 14 (22/09/2026): qualquer pessoa vira `originator` pelo cadastro
 * publico de embaixador. Com texto e destino livres, isso era um disparador
 * de WhatsApp pelo numero da B2W aberto ao publico. Agora o embaixador so
 * escolhe um destes modelos; o texto e montado aqui, no servidor
 * (lead-mensagem), e o telefone vem de `leads.phone`.
 *
 * Sem imports Deno para o Vitest e o front (LeadModal, previa) importarem.
 * Fonte 100% ASCII: acentos em \u escapes (um deploy anterior perdeu acentos).
 * Nada de promessa de valor (R$, %) nos textos.
 */

import { PAPEIS_INTERNOS } from './envio-portao.ts';

export type VarsMensagemLead = { nomeLead?: string | null; nomeOriginador?: string | null; link: string };

export const LIMITE_ENVIOS_DIA = 3;

/** Tipo gravado em crm_history.metadata.tipo e usado na contagem do limite. */
export const TIPO_HISTORICO = 'whatsapp_modelo';

export const MODELOS_LEAD: Record<string, { rotulo: string; texto: string }> = {
  convite: {
    rotulo: 'Convite',
    texto: '{saudacao} Aqui \u00e9 {nomeOriginador}, da B2W Energia. Veja quanto voc\u00ea economiza na conta de luz: {link}',
  },
  lembrete_simulacao: {
    rotulo: 'Lembrete da simula\u00e7\u00e3o',
    texto: '{saudacao} Aqui \u00e9 {nomeOriginador}, da B2W Energia. Sua simula\u00e7\u00e3o ficou pela metade. ' +
      'Leva s\u00f3 um minutinho para terminar: {link}',
  },
  retomar_adesao: {
    rotulo: 'Retomar a ades\u00e3o',
    texto: '{saudacao} Aqui \u00e9 {nomeOriginador}, da B2W Energia. Falta pouco para concluir a sua ades\u00e3o. ' +
      'Quando puder, continue por aqui: {link}',
  },
};

export const primeiroNome = (nome?: string | null) => (nome || '').trim().split(/\s+/)[0] || '';

export function montarMensagemLead(chave: string, vars: VarsMensagemLead): string | null {
  if (!Object.prototype.hasOwnProperty.call(MODELOS_LEAD, chave)) return null;
  const nomeLead = primeiroNome(vars.nomeLead);
  const saudacao = nomeLead ? `Oi, ${nomeLead}!` : 'Oi!';
  const nomeOriginador = primeiroNome(vars.nomeOriginador) || 'a equipe';
  return MODELOS_LEAD[chave].texto
    .replace('{saudacao}', saudacao)
    .replace('{nomeOriginador}', nomeOriginador)
    .replace('{link}', vars.link || '');
}

/**
 * Link de indicacao do embaixador: o encurtado quando existe; senao a URL
 * longa na raiz do site (a raiz le `name`/`id`; /convite/ redireciona para
 * la). `id` e o que atribui o lead ao embaixador.
 */
export function montarLinkIndicacao(o: { id: string; name?: string | null; short_url?: string | null }): string {
  if (o.short_url) return o.short_url;
  return `https://b2wenergia.com.br/?name=${encodeURIComponent(primeiroNome(o.name))}&id=${o.id}`;
}

/** Internos ja tem o envio normal (send-whatsapp); aqui so embaixador. */
export const PAPEIS_INTERNOS_LEAD = PAPEIS_INTERNOS;

/** Regra de lead-mensagem, pura. A ordem das checagens importa: papel antes
 *  de modelo, para quem nao pode usar nao sondar nada. */
export function decidirEnvioLead(e: {
  papel: string | null;
  userId: string | null;
  leadOriginatorId: string | null;
  modelo: string;
  enviosHoje: number;
  temTelefone: boolean;
}): { status: 200 | 400 | 401 | 403 | 429; erro?: string } {
  if (e.papel && PAPEIS_INTERNOS_LEAD.includes(e.papel)) {
    return { status: 403, erro: 'Usu\u00e1rio interno: use o envio normal (send-whatsapp), com texto livre.' };
  }
  if (e.papel !== 'originator' || !e.userId) return { status: 401, erro: 'Sess\u00e3o inv\u00e1lida ou sem permiss\u00e3o.' };
  if (!Object.prototype.hasOwnProperty.call(MODELOS_LEAD, e.modelo)) return { status: 400, erro: 'Modelo de mensagem inv\u00e1lido.' };
  if (!e.leadOriginatorId || e.leadOriginatorId !== e.userId) {
    return { status: 403, erro: 'Este lead n\u00e3o \u00e9 seu.' };
  }
  if (!e.temTelefone) return { status: 400, erro: 'Lead sem telefone cadastrado.' };
  if (e.enviosHoje >= LIMITE_ENVIOS_DIA) {
    return { status: 429, erro: `Limite de ${LIMITE_ENVIOS_DIA} mensagens por lead por dia atingido.` };
  }
  return { status: 200 };
}
