import { CRM_URL } from './env';

/** Mesma URL canonica de `src/lib/assinanteConnect.js` (CRM web). Se divergir,
 *  o mesmo assinante passa a ter dois links e a indicacao se perde. */
export const LANDING_RAIZ = 'https://b2wenergia.com.br/';

/** Politica de privacidade (exigida pelas lojas; link no login e em "Mais"). */
export const PRIVACIDADE_URL = 'https://b2wenergia.com.br/politica-de-privacidade/';

const primeiro = (nome?: string | null) => (nome || '').trim().replace(/\s+/g, ' ').split(' ')[0] || '';

/** Link longo do site. Sempre o site, nunca o link curto: o curto passa a
 *  apontar para o webapp, e a opção "continuar pelo site" voltaria para ele. */
export const linkSiteIndicacao = (id: string, nome?: string | null) =>
  `${LANDING_RAIZ}?indicador=${id}&name=${encodeURIComponent(primeiro(nome))}`;

/** Convite do originador no site (comissão no lead). Mesmo formato de
 *  `buildConviteUrl` em src/lib/originador.js, que a landing /convite/ lê. */
export const linkSiteConvite = (id: string, nome?: string | null) =>
  `${LANDING_RAIZ}convite/?name=${encodeURIComponent(primeiro(nome))}&id=${id}`;

export const linkIndicacao = (sub?: { id: string; name: string; short_url: string | null } | null) => {
  if (!sub?.id) return '';
  if (sub.short_url) return sub.short_url;
  return linkSiteIndicacao(sub.id, sub.name);
};

export const STATUS_PODE_INDICAR = ['contrato_assinado', 'ativo', 'ativo_inadimplente'];

export const textoIndicacao = (nome: string | undefined, link: string) => {
  if (!link) return '';
  const n = primeiro(nome);
  return `${n ? `Oi! Aqui é ${n}.` : 'Oi!'} Eu economizo na conta de luz com a B2W Energia, sem obra e sem instalar nada. `
    + `Faça sua simulação e assine pelo meu link: ${link}`;
};

/** Link do Parceiro Power: o curto do encurtador (o que ele já divulga) ou,
 *  enquanto ele não sai, a rota do webapp, que aceita convite de parceiro. */
export const linkParceiro = (o?: { id: string; short_url: string | null } | null) =>
  !o?.id ? '' : o.short_url || `https://apps.b2wenergia.com.br/i/${o.id}`;

export const textoConviteParceiro = (nome: string | undefined | null, link: string) => {
  if (!link) return '';
  const n = primeiro(nome);
  return `${n ? `Oi! Aqui é ${n}, parceiro da B2W Energia.` : 'Oi!'} Você pode economizar na conta de luz com energia limpa, `
    + `sem obra e sem instalar nada. Faça sua simulação e assine pelo meu link: ${link}`;
};

/** Mensagem do parceiro para o cliente assinar o contrato da adesão
 *  assistida (o link é o da Autentique, em nome do cliente). */
export const textoContratoCliente = (cliente: string | undefined | null, link: string) => {
  if (!link) return '';
  const n = primeiro(cliente);
  return `${n ? `Oi, ${n}!` : 'Oi!'} Sua adesão à energia por assinatura da B2W Energia está pronta. `
    + `Falta só você assinar o contrato, pelo celular: ${link}`;
};

/** wa.me para um celular do banco (DDD + número, sem o 55). */
export const whatsappPara = (celular: string | null | undefined, texto: string) => {
  const d = String(celular ?? '').replace(/\D/g, '');
  return `https://wa.me/${d.length >= 10 ? `55${d}` : ''}?text=${encodeURIComponent(texto)}`;
};

/** QR do carregador: `https://crm.b2wenergia.com.br/recarga?posto=<uuid>&conector=<n>`.
 *  Aceita tambem so o UUID do posto (ID digitado a mao). */
export const parseQrRecarga = (raw: string): { posto: string; conector: string } | null => {
  const txt = raw.trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(txt)) return { posto: txt, conector: '1' };
  try {
    const u = new URL(txt);
    const posto = u.searchParams.get('posto');
    if (!posto || !uuid.test(posto)) return null;
    const conector = u.searchParams.get('conector') || '1';
    return { posto, conector: /^\d+$/.test(conector) ? conector : '1' };
  } catch {
    return null;
  }
};

export const urlCheckoutRecarga = (posto: string, conector: string) =>
  `${CRM_URL}/recarga?posto=${encodeURIComponent(posto)}&conector=${encodeURIComponent(conector)}`;
