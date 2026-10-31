/**
 * Cliente da Elekeeper Open Platform (SAJ), nó internacional.
 *
 * Três regras da plataforma moldam este arquivo:
 *   - O token vale 8 h, e pedir outro INVALIDA o anterior. Por isso ele fica
 *     em cache e só é renovado perto de vencer, ou quando a SAJ diz que ele
 *     não existe mais (200010).
 *   - Toda chamada leva `clientSign`: o SHA-256 de "appId=..,chave=valor" com
 *     as chaves em ordem ASCII, separadas por vírgula. A doc mostra o hash em
 *     minúsculas (C#) e em maiúsculas (Java); se a SAJ recusar a assinatura
 *     (200012), tentamos a outra caixa uma vez e guardamos a que funcionou.
 *   - O limite é 5 chamadas por segundo. O intervalo mínimo entre chamadas
 *     fica em 250 ms.
 *
 * A chamada só funciona do IP liberado na whitelist do app (VPS Contabo).
 */
import { createHash } from 'node:crypto';

export const BASE_PADRAO = 'https://intl-developer.saj-electric.com/prod-api';

const OK = new Set([0, 200]);
const TOKEN_INEXISTENTE = 200010;
const ASSINATURA_INVALIDA = 200012;

export function textoAssinado(appId, params = {}) {
  const todos = { appId, ...params };
  return Object.keys(todos)
    .filter((k) => todos[k] !== undefined && todos[k] !== null)
    .sort()
    .map((k) => `${k}=${todos[k]}`)
    .join(',');
}

export function assinar(appId, params, caixa = 'lower') {
  const hex = createHash('sha256').update(textoAssinado(appId, params), 'utf8').digest('hex');
  return caixa === 'upper' ? hex.toUpperCase() : hex;
}

export class ErroSaj extends Error {
  constructor(caminho, code, msg) {
    super(`SAJ ${caminho}: ${code} ${msg ?? ''}`.trim());
    this.code = code;
  }
}

export function criarClienteSaj({ appId, appSecret, base = BASE_PADRAO, fetchImpl = fetch, intervaloMs = 250, agora = Date.now }) {
  if (!appId || !appSecret) throw new Error('SAJ_APP_ID e SAJ_APP_SECRET são obrigatórios');

  let token = null;
  let venceEm = 0;
  let caixa = 'lower';
  let ultimaChamada = 0;

  async function respeitarLimite() {
    const espera = ultimaChamada + intervaloMs - agora();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaChamada = agora();
  }

  async function obterToken(forcar = false) {
    if (!forcar && token && agora() < venceEm) return token;
    await respeitarLimite();
    const url = `${base}/open/api/access_token?appId=${encodeURIComponent(appId)}&appSecret=${encodeURIComponent(appSecret)}`;
    const res = await fetchImpl(url, { headers: { 'content-language': 'en_US' } });
    const corpo = await res.json();
    if (!OK.has(corpo.code) || !corpo.data?.access_token) {
      throw new ErroSaj('access_token', corpo.code, corpo.msg);
    }
    token = corpo.data.access_token;
    // folga de 10 min para não usar um token que vence no meio do ciclo
    venceEm = agora() + Math.max(60, (corpo.data.expires ?? 28800) - 600) * 1000;
    return token;
  }

  async function chamar(metodo, caminho, params = {}, tentativa = 0) {
    const tk = await obterToken();
    await respeitarLimite();
    const headers = {
      accessToken: tk,
      clientSign: assinar(appId, params, caixa),
      'content-language': 'en_US',
    };
    let url = `${base}${caminho}`;
    const init = { method: metodo, headers };
    if (metodo === 'GET') {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
      ).toString();
      if (qs) url += `?${qs}`;
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(params);
    }

    const res = await fetchImpl(url, init);
    const corpo = await res.json();
    if (OK.has(corpo.code)) return corpo;

    if (tentativa === 0 && corpo.code === TOKEN_INEXISTENTE) {
      await obterToken(true);
      return chamar(metodo, caminho, params, 1);
    }
    if (tentativa === 0 && corpo.code === ASSINATURA_INVALIDA) {
      caixa = caixa === 'lower' ? 'upper' : 'lower';
      return chamar(metodo, caminho, params, 1);
    }
    throw new ErroSaj(caminho, corpo.code, corpo.msg);
  }

  /** Usinas autorizadas ao app (escopo definido no Elekeeper do instalador). */
  async function plantas() {
    const out = [];
    for (let pageNum = 1; ; pageNum++) {
      const r = await chamar('GET', '/open/api/developer/plant/page', { appId, pageNum, pageSize: 100 });
      const rows = Array.isArray(r.rows) ? r.rows : r.rows ? [r.rows] : [];
      out.push(...rows);
      if (!r.totalPage || pageNum >= r.totalPage) break;
    }
    return out;
  }

  /** Inversores autorizados. A paginação é por USINA, não por inversor. */
  async function dispositivos() {
    const out = [];
    for (let pageNum = 1; ; pageNum++) {
      const r = await chamar('GET', '/open/api/developer/device/page', { appId, pageNum, pageSize: 50 });
      out.push(...(r.rows ?? []));
      if (!r.totalPage || pageNum >= r.totalPage) break;
    }
    return out;
  }

  /** Potência atual e energia do dia/mês/ano/total da usina. */
  async function estatisticas(plantId, clientDate) {
    const r = await chamar('GET', '/open/api/plant/getPlantStatisticsData', { plantId, clientDate });
    return r.data ?? null;
  }

  /** Alarmes do app inteiro (todas as usinas autorizadas) na janela pedida. */
  async function alarmes(startTime, endTime) {
    const r = await chamar('GET', '/open/api/device/alarmList', { appId, startTime, endTime, status: '1,4' });
    return r.data ?? [];
  }

  return { obterToken, chamar, plantas, dispositivos, estatisticas, alarmes };
}
