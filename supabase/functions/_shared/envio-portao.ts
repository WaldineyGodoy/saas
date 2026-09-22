/**
 * Regra do portão de send-whatsapp / send-email. Sem imports Deno para
 * poder ser testada pelo Vitest. `papelDoBearer` só decodifica: a
 * assinatura já foi conferida pelo gateway (verify_jwt = true).
 */
export const PAPEIS_INTERNOS = ['super_admin', 'admin', 'manager', 'coordinator', 'originator'];

export function papelDoBearer(authorization: string | null, chaveServiceRole?: string | null): string | null {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim();

  // Chaves novas do Supabase (sb_secret_/sb_publishable_) não são JWT — não dá
  // para decodificar `role` delas. Quando o token bate exatamente com a
  // service role key do ambiente, trata como service_role por igualdade.
  if (chaveServiceRole && token === chaveServiceRole) return 'service_role';

  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof json.role === 'string' ? json.role : null;
  } catch { return null; }
}

export function decidirPortao(e: { bearerRole: string | null; userRole: string | null; segredoOk: boolean }) {
  if (e.bearerRole === 'service_role') return { ok: true, motivo: 'service_role' };
  if (e.segredoOk) return { ok: true, motivo: 'segredo_interno' };
  if (e.userRole && PAPEIS_INTERNOS.includes(e.userRole)) return { ok: true, motivo: `usuario:${e.userRole}` };
  return { ok: false, motivo: 'sem_permissao' };
}

export function textoParaHtml(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${esc.replace(/\n/g, '<br>')}</p>`;
}
