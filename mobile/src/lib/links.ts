import { CRM_URL } from './env';

/** Mesma URL canonica de `src/lib/assinanteConnect.js` (CRM web). Se divergir,
 *  o mesmo assinante passa a ter dois links e a indicacao se perde. */
export const LANDING_RAIZ = 'https://b2wenergia.com.br/';

const primeiro = (nome?: string | null) => (nome || '').trim().replace(/\s+/g, ' ').split(' ')[0] || '';

export const linkIndicacao = (sub?: { id: string; name: string; short_url: string | null } | null) => {
  if (!sub?.id) return '';
  if (sub.short_url) return sub.short_url;
  return `${LANDING_RAIZ}?indicador=${sub.id}&name=${encodeURIComponent(primeiro(sub.name))}`;
};

export const STATUS_PODE_INDICAR = ['contrato_assinado', 'ativo', 'ativo_inadimplente'];

export const textoIndicacao = (nome: string | undefined, link: string) => {
  if (!link) return '';
  const n = primeiro(nome);
  return `${n ? `Oi! Aqui é ${n}.` : 'Oi!'} Eu economizo na conta de luz com a B2W Energia, sem obra e sem instalar nada. `
    + `Faça sua simulação e assine pelo meu link: ${link}`;
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
