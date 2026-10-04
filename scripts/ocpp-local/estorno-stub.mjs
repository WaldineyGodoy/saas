// SOMENTE AMBIENTE LOCAL DE TESTES (docker-compose.ocpp.yml). Nunca usado em producao.
//
// O CSMS pede estorno chamando a Edge Function `refund-charging`, que chama a Stripe. No Supabase
// local nao ha chave da Stripe, entao este processo fica entre o CSMS e o Supabase local:
//   * POST /functions/v1/refund-charging  -> substituto: mesmas regras de entrada da funcao real
//     (Bearer = service role, validarPedidoEstorno, idempotente por recarga), grava
//     stripe_refund_id = 're_stub_<n>' e valor_estornado na recarga (o mesmo efeito no banco) e
//     guarda o pedido recebido;
//   * GET  /__stub/estornos[?recarga_id=]   -> pedidos recebidos (os testes L3b conferem aqui);
//   * todo o resto (REST, Realtime por WebSocket) -> repassado sem mudanca ao Supabase local.
// O CSMS roda a imagem de producao sem alteracao; so o SUPABASE_URL dele aponta para ca.
import http from 'node:http';
import net from 'node:net';

const UPSTREAM = new URL(process.env.UPSTREAM_URL ?? 'http://host.docker.internal:54321');
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PORTA = Number(process.env.PORT ?? 8080);
if (!CHAVE) {
  console.error('[estorno-stub] SUPABASE_SERVICE_ROLE_KEY ausente');
  process.exit(1);
}

const pedidos = []; // { recarga_id, valor_centavos, motivo, status, recebido_em }
let seq = 0;

const json = (res, status, corpo) => {
  const b = JSON.stringify(corpo);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
};

const lerCorpo = (req) => new Promise((ok, falha) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
  req.on('error', falha);
});

async function rest(caminho, init = {}) {
  const r = await fetch(new URL(`/rest/v1/${caminho}`, UPSTREAM), {
    ...init,
    headers: {
      apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json',
      Prefer: 'return=representation', ...(init.headers ?? {}),
    },
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`REST ${r.status}: ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

// Copia de validarPedidoEstorno (supabase/functions/_shared/recarga.ts).
function validarPedidoEstorno(recarga, valorCentavos) {
  if (typeof valorCentavos !== 'number' || !Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    return 'valor_centavos deve ser um inteiro maior que zero.';
  }
  if (recarga.status === 'pending_payment') return 'Recarga ainda nao paga.';
  if (!recarga.stripe_payment_intent_id) return 'Recarga sem PaymentIntent.';
  if (valorCentavos > Math.round(Number(recarga.valor) * 100)) return 'Estorno excede o valor pago.';
  return null;
}

async function estornar(req, res) {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (bearer !== CHAVE) return json(res, 403, { error: 'Somente o CSMS (service role) pode estornar.' });
  let corpo;
  try { corpo = JSON.parse(await lerCorpo(req)); } catch { return json(res, 400, { error: 'JSON invalido.' }); }
  const { recarga_id, valor_centavos, motivo } = corpo ?? {};
  const registro = { recarga_id, valor_centavos, motivo, status: 0, recebido_em: new Date().toISOString() };
  pedidos.push(registro);
  const responder = (status, b) => { registro.status = status; return json(res, status, b); };
  if (typeof recarga_id !== 'string' || !recarga_id) return responder(400, { error: 'recarga_id obrigatorio.' });
  try {
    const [recarga] = await rest(`recargas_eletroposto?id=eq.${encodeURIComponent(recarga_id)}&select=id,valor,status,stripe_payment_intent_id,stripe_refund_id`);
    if (!recarga) return responder(404, { error: 'Recarga inexistente.' });
    if (recarga.stripe_refund_id) return responder(200, { ok: true, ja_estornada: true, stripe_refund_id: recarga.stripe_refund_id });
    const recusa = validarPedidoEstorno(recarga, valor_centavos);
    if (recusa) return responder(400, { error: recusa });
    const refundId = `re_stub_${Date.now()}_${++seq}`;
    await rest(`recargas_eletroposto?id=eq.${encodeURIComponent(recarga_id)}`, {
      method: 'PATCH', body: JSON.stringify({ stripe_refund_id: refundId, valor_estornado: valor_centavos / 100 }),
    });
    return responder(200, { ok: true, stripe_refund_id: refundId });
  } catch (e) {
    console.error('[estorno-stub] erro:', e);
    return responder(502, { error: String(e?.message ?? e) });
  }
}

function repassar(req, res) {
  const up = http.request({
    host: UPSTREAM.hostname, port: UPSTREAM.port || 80, method: req.method, path: req.url,
    headers: { ...req.headers, host: UPSTREAM.host },
  }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => { if (!res.headersSent) json(res, 502, { error: `upstream: ${e.message}` }); else res.destroy(); });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub');
  if (req.method === 'GET' && url.pathname === '/__stub/estornos') {
    const id = url.searchParams.get('recarga_id');
    return json(res, 200, id ? pedidos.filter((p) => p.recarga_id === id) : pedidos);
  }
  if (req.method === 'GET' && url.pathname === '/__stub/health') return json(res, 200, { status: 'ok' });
  if (req.method === 'POST' && url.pathname === '/functions/v1/refund-charging') return void estornar(req, res);
  return repassar(req, res);
});

// Realtime (WebSocket): repassa o upgrade como um tunel TCP
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(Number(UPSTREAM.port || 80), UPSTREAM.hostname, () => {
    const linhas = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const nome = req.rawHeaders[i];
      linhas.push(`${nome}: ${nome.toLowerCase() === 'host' ? UPSTREAM.host : req.rawHeaders[i + 1]}`);
    }
    up.write(`${linhas.join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  const fechar = () => { socket.destroy(); up.destroy(); };
  up.on('error', fechar);
  socket.on('error', fechar);
});

server.listen(PORTA, '0.0.0.0', () => console.log(`[estorno-stub] ouvindo em ${PORTA}, repassando para ${UPSTREAM.origin}`));
