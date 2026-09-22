// Regras puras do onboarding p\u00fablico. Sem imports Deno: testadas pelo Vitest.
export const TIPOS_DOCUMENTO = ['identidade', 'conta_energia', 'contrato_social'] as const;
const MIMES: Record<string, 'pdf' | 'jpg' | 'png'> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const LIMITE_BYTES = 10 * 1024 * 1024;

export function validarArquivo(a: { mime: string; tamanho: number }): string | null {
  if (!MIMES[a.mime]) return 'Envie o arquivo em PDF, JPG ou PNG.';
  if (!(a.tamanho > 0) || a.tamanho > LIMITE_BYTES) return 'O arquivo deve ter at\u00e9 10 MB.';
  return null;
}
export const extensaoDoMime = (mime: string) => MIMES[mime];
export const caminhoDocumento = (sub: string, tipo: string, id: string, mime: string) => `${sub}/${tipo}/${id}.${extensaoDoMime(mime)}`;

// Metadados REAIS do objeto no Storage (nunca os declarados pelo cliente no
// corpo da requisicao). Sem isso, um chamador anonimo podia registrar
// mime/tamanho arbitrarios em subscriber_documents so declarando valores
// diferentes do arquivo que de fato subiu.
export function metadadosDoObjeto(meta: { mimetype?: string; size?: number } | null | undefined): { mime: string; tamanho: number } | { erro: string } {
  if (!meta || typeof meta.mimetype !== 'string' || typeof meta.size !== 'number') {
    return { erro: 'N\u00e3o foi poss\u00edvel confirmar o arquivo enviado.' };
  }
  const erro = validarArquivo({ mime: meta.mimetype, tamanho: meta.size });
  if (erro) return { erro };
  return { mime: meta.mimetype, tamanho: meta.size };
}

const ROTULO: Record<string, string> = {
  identidade: 'documento de identidade (CNH ou RG)',
  contrato_social: 'contrato social da empresa',
  conta_energia: 'conta de energia',
};
export function descreverFaltantes(f: { tipo: string; numero_uc: string | null }[]): string {
  return f.map(x => x.tipo === 'conta_energia' ? `${ROTULO.conta_energia} da UC ${x.numero_uc}` : ROTULO[x.tipo]).join(', ');
}

export function escolherLink(r: { signingLinkFound?: boolean; url?: string }) {
  if (!r?.signingLinkFound || !r.url) return { ok: false as const, motivo: 'A Autentique n\u00e3o devolveu o link de assinatura do signat\u00e1rio.' };
  return { ok: true as const, url: r.url };
}

export const keywordAdesao = (sub: string, _agora: Date) => {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes).map(b => chars[b % 36]).join('');
  return `adesao-${sub.replace(/-/g, '').slice(0, 8)}-${suffix}`;
};

export function urlTermos(base: string, p: { link: string; nome: string; concessionaria: string; desconto: number | null }) {
  const q = new URLSearchParams({ Linkdocontrato: p.link, nome: p.nome || '', concessionaria: p.concessionaria || '' });
  if (p.desconto) q.set('desconto', String(p.desconto));
  return `${base}?${q.toString()}`;
}

export const textoWhatsappContrato = (nome: string, url: string) =>
  `Ol\u00e1, ${nome}! \u26a1\n\nSua ades\u00e3o \u00e0 B2W Energia foi registrada. Falta s\u00f3 assinar o contrato \u2014 ` +
  `leva menos de 2 minutos e \u00e9 100% digital. \u270d\ufe0f\n\nEntenda os termos e assine aqui:\n${url}\n\n` +
  `Enviamos o mesmo link para o seu e-mail. Qualquer d\u00favida, \u00e9 s\u00f3 responder esta mensagem.`;

export const textoOriginador = (cliente: string) =>
  `\ud83d\ude80 Novo cliente pelo seu link!\n\n${cliente} concluiu a ades\u00e3o e recebeu o contrato para assinar.\nAcompanhe pelo CRM.`;
