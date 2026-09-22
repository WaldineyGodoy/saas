// Regras puras do onboarding público. Sem imports Deno: testadas pelo Vitest.
export const TIPOS_DOCUMENTO = ['identidade', 'conta_energia', 'contrato_social'] as const;
const MIMES: Record<string, 'pdf' | 'jpg' | 'png'> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const LIMITE_BYTES = 10 * 1024 * 1024;

export function validarArquivo(a: { mime: string; tamanho: number }): string | null {
  if (!MIMES[a.mime]) return 'Envie o arquivo em PDF, JPG ou PNG.';
  if (!(a.tamanho > 0) || a.tamanho > LIMITE_BYTES) return 'O arquivo deve ter até 10 MB.';
  return null;
}
export const extensaoDoMime = (mime: string) => MIMES[mime];
export const caminhoDocumento = (sub: string, tipo: string, id: string, mime: string) => `${sub}/${tipo}/${id}.${extensaoDoMime(mime)}`;

const ROTULO: Record<string, string> = {
  identidade: 'documento de identidade (CNH ou RG)',
  contrato_social: 'contrato social da empresa',
  conta_energia: 'conta de energia',
};
export function descreverFaltantes(f: { tipo: string; numero_uc: string | null }[]): string {
  return f.map(x => x.tipo === 'conta_energia' ? `${ROTULO.conta_energia} da UC ${x.numero_uc}` : ROTULO[x.tipo]).join(', ');
}

export function escolherLink(r: { signingLinkFound?: boolean; url?: string }) {
  if (!r?.signingLinkFound || !r.url) return { ok: false as const, motivo: 'A Autentique não devolveu o link de assinatura do signatário.' };
  return { ok: true as const, url: r.url };
}

export const keywordAdesao = (sub: string, agora: Date) =>
  `adesao-${sub.replace(/-/g, '').slice(0, 8)}-${Math.floor(agora.getTime() / 1000).toString(36).slice(-4).padStart(4, '0')}`;

export function urlTermos(base: string, p: { link: string; nome: string; concessionaria: string; desconto: number | null }) {
  const q = new URLSearchParams({ Linkdocontrato: p.link, nome: p.nome || '', concessionaria: p.concessionaria || '' });
  if (p.desconto) q.set('desconto', String(p.desconto));
  return `${base}?${q.toString()}`;
}

export const textoWhatsappContrato = (nome: string, url: string) =>
  `Olá, ${nome}! ⚡\n\nSua adesão à B2W Energia foi registrada. Falta só assinar o contrato — ` +
  `leva menos de 2 minutos e é 100% digital. ✍️\n\nEntenda os termos e assine aqui:\n${url}\n\n` +
  `Enviamos o mesmo link para o seu e-mail. Qualquer dúvida, é só responder esta mensagem.`;

export const textoOriginador = (cliente: string) =>
  `🚀 Novo cliente pelo seu link!\n\n${cliente} concluiu a adesão e recebeu o contrato para assinar.\nAcompanhe pelo CRM.`;
