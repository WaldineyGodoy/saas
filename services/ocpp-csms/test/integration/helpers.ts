// Utilitarios dos testes de integracao L3a: sobe o CSMS em porta efemera com MemoryRepo
// e conecta carregadores falsos (RPCClient estrito ou WebSocket cru para frames manuais).
import { RPCClient } from 'ocpp-rpc';
import WebSocket from 'ws';
import { MemoryRepo } from '../../src/repo/memory.js';
import { criarServidor, type Servidor } from '../../src/server/index.js';
import { gerarSenhaHash } from '../../src/server/auth.js';

export interface Cenario {
  repo: MemoryRepo;
  srv: Servidor;
  url: string;
  // fecha clientes abertos e o servidor
  encerrar(): Promise<void>;
  carregadorFake(ocppId: string, senha?: string): RPCClient;
  wsCru(ocppId: string, opts?: { protocols?: string[]; senha?: string }): Promise<WebSocket>;
}

export interface OpcoesCenario {
  auth?: 'basic' | 'off';
  heartbeatS?: number;
  verificarOfflineMs?: number;
  // carregadores semeados: ocppId -> senha em claro (undefined = sem senha_hash)
  carregadores?: Record<string, string | undefined>;
}

export async function subirCenario(o: OpcoesCenario = {}): Promise<Cenario> {
  const repo = new MemoryRepo();
  const carregadores = o.carregadores ?? { 'CP-1': 'segredo-cp1' };
  for (const [ocppId, senha] of Object.entries(carregadores)) {
    repo.semearCarregador({
      ocppId,
      senha_hash: senha === undefined ? null : gerarSenhaHash(senha),
      heartbeat_intervalo_s: o.heartbeatS ?? 60,
    });
  }
  const srv = await criarServidor({
    repo, porta: 0, auth: o.auth ?? 'basic', verificarOfflineMs: o.verificarOfflineMs,
  });
  const url = `ws://127.0.0.1:${srv.porta}/ocpp`;
  const abertos = new Set<RPCClient>();
  const crus = new Set<WebSocket>();

  return {
    repo, srv, url,
    carregadorFake(ocppId, senha) {
      const c = new RPCClient({
        endpoint: url, identity: ocppId, protocols: ['ocpp1.6'], strictMode: true,
        password: senha ?? null, reconnect: false, callTimeoutMs: 5000,
      } as unknown as ConstructorParameters<typeof RPCClient>[0]);
      abertos.add(c);
      return c;
    },
    async wsCru(ocppId, opts = {}) {
      const headers: Record<string, string> = {};
      if (opts.senha !== undefined) {
        headers.Authorization = 'Basic ' + Buffer.from(`${ocppId}:${opts.senha}`).toString('base64');
      }
      const ws = new WebSocket(`${url}/${ocppId}`, opts.protocols ?? ['ocpp1.6'], { headers });
      crus.add(ws);
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
        ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      });
      return ws;
    },
    async encerrar() {
      for (const c of abertos) { try { await c.close({ force: true }); } catch { /* ja fechado */ } }
      for (const w of crus) { try { w.terminate(); } catch { /* ja fechado */ } }
      await srv.fechar();
    },
  };
}

// espera o proximo frame JSON recebido num WebSocket cru
export function proximoFrame(ws: WebSocket): Promise<unknown[]> {
  return new Promise((resolve) => {
    ws.once('message', (d) => resolve(JSON.parse(d.toString()) as unknown[]));
  });
}

export async function enviarEEsperar(ws: WebSocket, frame: unknown[]): Promise<unknown[]> {
  const p = proximoFrame(ws);
  ws.send(JSON.stringify(frame));
  return p;
}

export const BOOT = { chargePointVendor: 'Joult', chargePointModel: 'J7', chargePointSerialNumber: 'SN1', firmwareVersion: '1.2.3' };
