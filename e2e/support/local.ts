// Ambiente LOCAL do E2E da tela /recarga (Tarefa 11). Nada aqui toca em producao:
// as chaves vem de `npx supabase status -o env` (ou de variaveis de ambiente) e so
// vivem na memoria deste processo; a URL tem de ser localhost/127.0.0.1.
//
// Pre-requisitos (Tarefa 10): Supabase local, CSMS na 9220 (docker-compose.ocpp.yml),
// seed scripts/ocpp-seed.sql e o venv do emulador em tools/ocpp-emulator/.venv.
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..', '..');
const SENHA_CARREGADOR = 'emu-local-senha'; // so do ambiente local (scripts/ocpp-seed.sql)
const PLANO_SEED = '0cbb0000-0000-4000-8000-000000000001';
const TARIFA = 2.15;
const CP_SEED = 'CP_EMU_01';
const RESERVA_PAGAMENTO_MIN = 10;
export const CSMS_WS = process.env.OCPP_CSMS_URL || 'ws://127.0.0.1:9220/ocpp';

export type Ambiente = { url: string; anon: string; servico: string; jwtSecret: string };

let cache: Ambiente | null = null;

export function ambienteLocal(): Ambiente {
  if (cache) return cache;
  let url = process.env.SUPABASE_URL || '';
  let anon = process.env.SUPABASE_ANON_KEY || '';
  let servico = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  let jwtSecret = process.env.SUPABASE_JWT_SECRET || '';
  if (!url || !anon || !servico || !jwtSecret) {
    const saida = execSync('npx supabase status -o env', { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const env: Record<string, string> = {};
    for (const linha of saida.split(/\r?\n/)) {
      const m = linha.match(/^([A-Z_]+)="?(.*?)"?$/);
      if (m) env[m[1]] = m[2];
    }
    url ||= env.API_URL;
    anon ||= env.ANON_KEY;
    servico ||= env.SERVICE_ROLE_KEY;
    jwtSecret ||= env.JWT_SECRET;
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(url || '')) {
    throw new Error(`E2E recusado: SUPABASE_URL nao e local (${url}). Esta suite semeia e apaga dados.`);
  }
  if (!anon || !servico) throw new Error('E2E: chaves do Supabase local ausentes (npx supabase status).');
  cache = { url: url.replace(/\/$/, ''), anon, servico, jwtSecret };
  return cache;
}

// ------------------------------------------------------------------ PostgREST (service role)

async function http(metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}) {
  const { url, servico } = ambienteLocal();
  const r = await fetch(`${url}${caminho}`, {
    method: metodo,
    headers: { apikey: servico, Authorization: `Bearer ${servico}`, 'Content-Type': 'application/json', ...extra },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  if (!r.ok) throw new Error(`${metodo} ${caminho}: HTTP ${r.status} ${texto}`);
  return json;
}

export const db = {
  get: (tabela: string, filtro = '') => http('GET', `/rest/v1/${tabela}?${filtro}`) as Promise<any[]>,
  insert: (tabela: string, linhas: unknown, query = '', prefer = 'return=representation') =>
    http('POST', `/rest/v1/${tabela}${query}`, linhas, { Prefer: prefer }) as Promise<any[]>,
  update: (tabela: string, filtro: string, patch: unknown) =>
    http('PATCH', `/rest/v1/${tabela}?${filtro}`, patch, { Prefer: 'return=representation' }) as Promise<any[]>,
  delete: (tabela: string, filtro: string) => http('DELETE', `/rest/v1/${tabela}?${filtro}`),
  rpc: (fn: string, args: unknown) => http('POST', `/rest/v1/rpc/${fn}`, args),
};

export const agoraIso = (maisS = 0) => new Date(Date.now() + maisS * 1000).toISOString();

// ------------------------------------------------------------------ posto proprio do teste

export type Posto = { eletropostoId: string; carregadorId: string; ocppId: string };

export async function criarPosto(): Promise<Posto> {
  const [cp] = await db.get('eletroposto_carregadores', `ocpp_id=eq.${CP_SEED}&select=senha_hash`);
  if (!cp?.senha_hash) throw new Error('rode o seed: node scripts/ocpp-local/db.mjs seed');
  const ocppId = `E2E_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
  const [e] = await db.insert('eletropostos', {
    nome: `Posto ${ocppId}`, status: 'operando', plano_id: PLANO_SEED, qtd_carregadores: 1,
  });
  const [c] = await db.insert('eletroposto_carregadores', {
    eletroposto_id: e.id, ocpp_id: ocppId, senha_hash: cp.senha_hash, heartbeat_intervalo_s: 60,
  });
  return { eletropostoId: e.id, carregadorId: c.id, ocppId };
}

// Conector offline/ocupado sem emulador: semeia direto o estado que o CSMS gravaria (UI-01)
export async function semearConector(p: Posto, numero: number, status: string, online: boolean) {
  await db.insert('eletroposto_conectores', { carregador_id: p.carregadorId, connector_id: numero, numero, status });
  // ultimo_contato_em recente: o verificador de contato do CSMS (3 x heartbeat) nao derruba o online
  await db.update('eletroposto_carregadores', `id=eq.${p.carregadorId}`, { online, ultimo_contato_em: agoraIso() });
}

export async function apagarPosto(p: Posto) {
  const recargas: string[] = (await db.get('recargas_eletroposto', `eletroposto_id=eq.${p.eletropostoId}&select=id`)).map((r) => r.id);
  await db.delete('notification_logs', `entity_id=eq.${p.carregadorId}`).catch(() => {});
  await db.delete('ocpp_transacoes', `carregador_id=eq.${p.carregadorId}`);
  if (recargas.length) {
    const lista = recargas.join(',');
    await db.delete('ocpp_id_tags', `recarga_id=in.(${lista})`);
    await db.delete('recargas_eletroposto', `id=in.(${lista})`);
  }
  await db.delete('ocpp_mensagens', `ocpp_id=eq.${p.ocppId}`);
  await db.delete('eletroposto_carregadores', `id=eq.${p.carregadorId}`);
  await db.delete('eletropostos', `id=eq.${p.eletropostoId}`);
}

// ------------------------------------------------------------------ recarga paga sem Stripe
// Espelho de tools/ocpp-emulator/conftest.py (que espelha o stripe-charging-webhook):
// fn_reservar_recarga -> fn_marcar_recarga_paga -> fn_confirmar_inicio -> idTag + start:<recarga>

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const gerarIdTag = () => 'RC' + [...randomBytes(18)].map((b) => BASE32[b % 32]).join('');

// Em duas fases para o teste ver "Conecte o cabo" com calma: o CSMS local usa
// CONNECTION_TIMEOUT_S=5 (RC-03), entao do RemoteStart ao plug nao sobra tempo para a tela
// mostrar o estado. `iniciar()` grava idTag + comando start:<recarga> (o que o webhook faz
// logo apos marcar paga).
export async function recargaPaga(p: Posto, valor: number, userId: string | null, numero = 1) {
  const [conector] = await db.get('eletroposto_conectores', `eletroposto_id=eq.${p.eletropostoId}&numero=eq.${numero}&select=*`);
  if (!conector) throw new Error(`conector ${numero} inexistente no posto`);
  const rid: string | null = await db.rpc('fn_reservar_recarga', {
    p_carregador_id: p.carregadorId, p_connector_id: conector.connector_id, p_reserva_min: RESERVA_PAGAMENTO_MIN,
    p_eletroposto_id: p.eletropostoId, p_conector_numero: numero, p_user_id: userId,
    p_motorista_nome: 'Motorista E2E', p_motorista_email: null, p_motorista_telefone: null, p_valor: valor,
    p_kwh_estimado: Math.round((valor / TARIFA) * 100) / 100, p_tarifa_kwh_aplicada: TARIFA,
    p_metadata: { nome_posto: 'E2E' },
  });
  if (!rid) throw new Error('fn_reservar_recarga recusou (conector reservado/em uso)');
  const pi = `pi_local_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  await db.update('recargas_eletroposto', `id=eq.${rid}`, { stripe_payment_intent_id: pi });

  const marcada = await db.rpc('fn_marcar_recarga_paga', { p_payment_intent_id: pi });
  if (!marcada) throw new Error('fn_marcar_recarga_paga nao marcou a recarga');
  const veredito = await db.rpc('fn_confirmar_inicio', { p_recarga_id: rid, p_reserva_min: RESERVA_PAGAMENTO_MIN });
  if (veredito !== 'ok') throw new Error(`fn_confirmar_inicio: ${veredito}`);

  const iniciar = async () => {
    const [r] = await db.get('recargas_eletroposto', `id=eq.${rid}&select=carregador_id,ocpp_connector_id`);
    const tag = gerarIdTag();
    await db.insert('ocpp_id_tags', { id_tag: tag, recarga_id: rid, expira_em: agoraIso(300) });
    await db.update('recargas_eletroposto', `id=eq.${rid}`, { ocpp_id_tag: tag });
    await db.insert(
      'ocpp_comandos',
      {
        carregador_id: r.carregador_id, acao: 'RemoteStartTransaction',
        payload: { connectorId: r.ocpp_connector_id, idTag: tag },
        chave_idempotencia: `start:${rid}`, expira_em: agoraIso(120), recarga_id: rid,
      },
      '?on_conflict=chave_idempotencia',
      'return=representation,resolution=ignore-duplicates',
    );
  };
  return { id: rid as string, pi, iniciar };
}

// ------------------------------------------------------------------ usuario logado (prova de posse do stop)
// stop-charging aceita o JWT do dono da recarga. Usuario descartavel do Auth LOCAL,
// senha aleatoria gerada aqui; apagado no fim.

export type UsuarioTeste = { id: string; sessao: Record<string, unknown>; chaveStorage: string };

function reassinarHs256(token: string, segredo: string): string {
  const [, payload] = token.split('.');
  const cab = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const assinatura = createHmac('sha256', segredo).update(`${cab}.${payload}`).digest('base64url');
  return `${cab}.${payload}.${assinatura}`;
}

export async function criarUsuarioTeste(): Promise<UsuarioTeste> {
  const { url, anon, jwtSecret } = ambienteLocal();
  const email = `e2e-${randomUUID().slice(0, 8)}@teste.invalid`;
  const senha = randomBytes(18).toString('base64url');
  const criado = await http('POST', '/auth/v1/admin/users', { email, password: senha, email_confirm: true });
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
  if (!r.ok) throw new Error(`login do usuario de teste: HTTP ${r.status}`);
  const sessao = await r.json();
  // O Auth local assina com ES256, que o gateway das Edge Functions locais nao consegue verificar
  // (401 "Invalid JWT" antes de chegar no stop-charging). Reassina o MESMO token (mesmas claims,
  // inclusive session_id) em HS256 com o segredo do stack local, que o gateway e o GoTrue aceitam.
  if (jwtSecret) sessao.access_token = reassinarHs256(sessao.access_token, jwtSecret);
  // supabase-js: sb-<primeiro rotulo do host>-auth-token
  const chaveStorage = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  return { id: criado.id, sessao, chaveStorage };
}

export const apagarUsuarioTeste = (u: UsuarioTeste) => http('DELETE', `/auth/v1/admin/users/${u.id}`).catch(() => {});

// ------------------------------------------------------------------ emulador

export type Emulador = { proc: ChildProcess; saida: () => string; parar: () => Promise<void> };

function pythonDoEmulador(): string {
  if (process.env.OCPP_PYTHON) return process.env.OCPP_PYTHON;
  const venv = join(RAIZ, 'tools', 'ocpp-emulator', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';
}

// happy_path sem parada automatica (so o RemoteStop do app encerra). time-scale acelera a
// energia simulada para o kWh aparecer na tela em segundos.
export function iniciarEmulador(ocppId: string, opcoes: { plugDelayS?: number; timeScale?: number; atrasoStartS?: number } = {}): Emulador {
  const args = [
    '-m', 'emulator', '--id', ocppId, '--url', CSMS_WS, '--password', SENHA_CARREGADOR,
    '--connectors', '1', '--scenario', 'happy_path', '--meter-interval', '1',
    '--plug-delay', String(opcoes.plugDelayS ?? 6), '--time-scale', String(opcoes.timeScale ?? 200),
    '--finish-delay', '1',
    // atrasa o Accepted do RemoteStart: a tela fica mais tempo em "Conecte o cabo" (webhook real)
    ...(opcoes.atrasoStartS ? ['--delay', `RemoteStartTransaction=${opcoes.atrasoStartS}`] : []),
  ];
  const proc = spawn(pythonDoEmulador(), args, { cwd: join(RAIZ, 'tools', 'ocpp-emulator'), stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  proc.stdout?.on('data', (d) => (buf += d));
  proc.stderr?.on('data', (d) => (buf += d));
  return {
    proc,
    saida: () => buf,
    parar: () =>
      new Promise<void>((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once('exit', () => resolve());
        proc.kill();
        setTimeout(resolve, 5000);
      }),
  };
}

export async function aguardar<T>(condicao: () => Promise<T | false | null | undefined>, ms: number, oque: string): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await condicao();
    if (v) return v;
    if (Date.now() > fim) throw new Error(`timeout (${ms} ms) esperando ${oque}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ------------------------------------------------------------------ webhook da Stripe assinado (spec com Stripe real)

export async function entregarWebhookPagamento(paymentIntentId: string, segredo: string) {
  const { url, anon } = ambienteLocal();
  const corpo = JSON.stringify({
    id: `evt_${randomBytes(8).toString('hex')}`, object: 'event', type: 'payment_intent.succeeded',
    data: { object: { id: paymentIntentId, object: 'payment_intent', status: 'succeeded' } },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex');
  const r = await fetch(`${url}/functions/v1/stripe-charging-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}`, Authorization: `Bearer ${anon}`, apikey: anon },
    body: corpo,
  });
  if (!r.ok) throw new Error(`webhook: HTTP ${r.status} ${await r.text()}`);
}
