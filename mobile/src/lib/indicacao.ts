import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Indicação no app (docs/plano-indicacao-app.md).
 *
 * O link de indicação chega em três formas:
 *   - o link longo: `https://b2wenergia.com.br/?indicador=<uuid>&name=...`;
 *   - a rota do webapp: `https://apps.b2wenergia.com.br/i/<uuid>`;
 *   - o link curto do encurtador (`link.b2wenergia.com.br/<palavra>`), que é
 *     o que vai no QR do assinante. Esse precisa ser resolvido no servidor
 *     (Edge Function resolver-link-indicacao), porque o destino só aparece
 *     seguindo o redirecionamento.
 * Também aceita só o código (o UUID), digitado ou colado.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SO_UUID = new RegExp(`^${UUID.source}$`, 'i');
export const HOSTS_CURTOS = ['link.b2wenergia.com.br'];

export type LeituraIndicacao = { id: string } | { curto: string } | null;

export function extrairIndicador(raw: string | null | undefined): LeituraIndicacao {
  const txt = String(raw ?? '').trim();
  if (!txt) return null;
  if (SO_UUID.test(txt)) return { id: txt.toLowerCase() };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(txt) ? txt : `https://${txt}`);
  } catch {
    return null;
  }

  const param = url.searchParams.get('indicador');
  if (param && SO_UUID.test(param)) return { id: param.toLowerCase() };

  const rota = url.pathname.match(new RegExp(`/i/(${UUID.source})`, 'i'));
  if (rota) return { id: rota[1].toLowerCase() };

  if (HOSTS_CURTOS.includes(url.hostname.toLowerCase()) && url.pathname.length > 1) {
    return { curto: `https://${url.hostname.toLowerCase()}${url.pathname}` };
  }
  return null;
}

// Indicação que chegou antes do login (link aberto, QR lido na tela de
// entrada): fica guardada até a pessoa entrar e ser registrada.
const CHAVE = 'b2w.indicacaoPendente';
const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;

export async function guardarIndicacaoPendente(id: string, meio: 'link' | 'qr' | 'app' = 'link') {
  try {
    await AsyncStorage.setItem(CHAVE, JSON.stringify({ id, meio, em: Date.now() }));
  } catch { /* armazenamento indisponível: a pessoa lê o QR de novo */ }
}

export async function lerIndicacaoPendente(): Promise<{ id: string; meio: 'link' | 'qr' | 'app' } | null> {
  try {
    const bruto = await AsyncStorage.getItem(CHAVE);
    if (!bruto) return null;
    const v = JSON.parse(bruto);
    if (!v?.id || !SO_UUID.test(v.id) || Date.now() - Number(v.em) > VALIDADE_MS) return null;
    return { id: v.id, meio: v.meio === 'qr' || v.meio === 'app' ? v.meio : 'link' };
  } catch {
    return null;
  }
}

export async function limparIndicacaoPendente() {
  try { await AsyncStorage.removeItem(CHAVE); } catch { /* nada a fazer */ }
}

/** Celular como o banco espera: só dígitos, DDD + número, sem o 55. */
export function celularBR(raw: string): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (/^(\d)\1+$/.test(d)) return null;
  return d;
}
