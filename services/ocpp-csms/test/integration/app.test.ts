// Montagem do processo (a mesma fabrica que o main.ts usa) com MemoryRepo, porta efemera e sem variaveis de ambiente.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPCClient } from 'ocpp-rpc';
import { iniciarApp, type App } from '../../src/app.js';
import { MemoryRepo } from '../../src/repo/memory.js';
import { gerarSenhaHash } from '../../src/server/auth.js';

let app: App | undefined;
let cliente: RPCClient | undefined;

afterEach(async () => {
  try { await cliente?.close({ force: true }); } catch { /* ja fechado */ }
  cliente = undefined;
  await app?.parar();
  app = undefined;
});

async function subir() {
  const repo = new MemoryRepo();
  repo.semearCarregador({ ocppId: 'CP-1', senha_hash: gerarSenhaHash('segredo') });
  app = await iniciarApp({ repo, porta: 0, host: '127.0.0.1', auth: 'basic', onErro: () => undefined });
  return { repo, base: `http://127.0.0.1:${app.porta}` };
}

describe('GET /health', () => {
  it('responde 200 com o numero de carregadores conectados', async () => {
    const { base } = await subir();
    const r0 = await fetch(`${base}/health`);
    expect(r0.status).toBe(200);
    expect(await r0.json()).toEqual({ status: 'ok', carregadores_conectados: 0 });

    cliente = new RPCClient({
      endpoint: `ws://127.0.0.1:${app!.porta}/ocpp`, identity: 'CP-1', protocols: ['ocpp1.6'], strictMode: true,
      password: 'segredo', reconnect: false,
    } as unknown as ConstructorParameters<typeof RPCClient>[0]);
    await cliente.connect();
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: 'ok', carregadores_conectados: 1 });

    await cliente.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: 'ok', carregadores_conectados: 0 });
  });

  it('outras rotas HTTP respondem 404', async () => {
    const { base } = await subir();
    expect((await fetch(`${base}/nada`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(404);
  });
});

describe('encerramento (SIGTERM)', () => {
  it('parar() fecha o servidor, derruba conexoes e e idempotente', async () => {
    const { base } = await subir();
    cliente = new RPCClient({
      endpoint: `ws://127.0.0.1:${app!.porta}/ocpp`, identity: 'CP-1', protocols: ['ocpp1.6'], strictMode: true,
      password: 'segredo', reconnect: false,
    } as unknown as ConstructorParameters<typeof RPCClient>[0]);
    await cliente.connect();
    await app!.parar();
    await app!.parar(); // segunda chamada nao falha
    await expect(fetch(`${base}/health`)).rejects.toThrow();
    const c = cliente;
    await vi.waitFor(() => expect(c.state).not.toBe(1), { timeout: 3000 }); // deixa de estar OPEN
  });

  it('para a fila: o repo nao recebe mais assinatura de comandos', async () => {
    const repo = new MemoryRepo();
    let ativos = 0;
    const assinar = repo.assinarComandos.bind(repo);
    repo.assinarComandos = (cb) => { ativos++; const c = assinar(cb); return () => { ativos--; c(); }; };
    app = await iniciarApp({ repo, porta: 0, host: '127.0.0.1', auth: 'off', onErro: () => undefined });
    expect(ativos).toBe(1);
    await app.parar();
    expect(ativos).toBe(0);
  });
});
