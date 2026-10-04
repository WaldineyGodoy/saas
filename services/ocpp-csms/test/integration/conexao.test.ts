import { afterEach, describe, expect, it, vi } from 'vitest';
import { subirCenario, enviarEEsperar, BOOT, type Cenario } from './helpers.js';
import { gerarSenhaHash, verificarSenha } from '../../src/server/auth.js';

let c: Cenario | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await c?.encerrar();
  c = undefined;
});

const esperar = (fn: () => void | Promise<void>) => vi.waitFor(fn, { timeout: 2000, interval: 10 });

describe('CP - conexao e registro', () => {
  it('CP-01 boot aceito grava vendor e fica online', async () => {
    c = await subirCenario({ heartbeatS: 45 });
    const cli = c.carregadorFake('CP-1', 'segredo-cp1');
    await cli.connect();
    const r = (await cli.call('BootNotification', BOOT)) as { status: string; interval: number; currentTime: string };
    expect(r.status).toBe('Accepted');
    expect(r.interval).toBe(45);
    expect(new Date(r.currentTime).toISOString()).toBe(r.currentTime);
    const cp = await c.repo.buscarCarregador('CP-1');
    expect(cp).toMatchObject({ vendor: 'Joult', modelo: 'J7', serial: 'SN1', firmware: '1.2.3', online: true, estado_registro: 'aceito' });
  });

  it('CP-02 ocpp_id nao cadastrado: handshake 404 e so o log de recusa', async () => {
    c = await subirCenario();
    const cli = c.carregadorFake('FANTASMA', 'x');
    await expect(cli.connect()).rejects.toMatchObject({ code: 404 });
    expect(c.repo.mensagens).toHaveLength(1);
    expect(c.repo.mensagens[0]).toMatchObject({ carregador_id: null, ocpp_id: 'FANTASMA', acao: 'handshake_recusado', tipo: null });
  });

  it('CP-03 senha errada: 401 (e senha_hash nulo tambem, e sem senha)', async () => {
    c = await subirCenario({ carregadores: { 'CP-1': 'certa', 'CP-SEM': undefined } });
    await expect(c.carregadorFake('CP-1', 'errada').connect()).rejects.toMatchObject({ code: 401 });
    await expect(c.carregadorFake('CP-1').connect()).rejects.toMatchObject({ code: 401 });
    await expect(c.carregadorFake('CP-SEM', 'qualquer').connect()).rejects.toMatchObject({ code: 401 });
    expect(c.repo.mensagens.every((m) => m.acao === 'handshake_recusado')).toBe(true);
    expect(JSON.stringify(c.repo.mensagens)).not.toContain('errada');
    const ok = c.carregadorFake('CP-1', 'certa');
    await ok.connect();
  });

  it('CP-03b auth off aceita sem senha, mas ainda recusa ocpp_id desconhecido', async () => {
    c = await subirCenario({ auth: 'off' });
    await c.carregadorFake('CP-1').connect();
    await expect(c.carregadorFake('FANTASMA').connect()).rejects.toMatchObject({ code: 404 });
  });

  it('CP-04 sem subprotocolo ocpp1.6: handshake recusado', async () => {
    c = await subirCenario();
    await expect(c.wsCru('CP-1', { protocols: [], senha: 'segredo-cp1' })).rejects.toThrow(/400/);
    await expect(c.wsCru('CP-1', { protocols: ['ocpp2.0.1'], senha: 'segredo-cp1' })).rejects.toThrow(/400/);
  });

  it('CP-05 heartbeat devolve currentTime UTC; mudo por 3x intervalo vira offline', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    c = await subirCenario({ heartbeatS: 10, verificarOfflineMs: 5000 });
    const cli = c.carregadorFake('CP-1', 'segredo-cp1');
    await cli.connect();
    await cli.call('BootNotification', BOOT);
    const hb = (await cli.call('Heartbeat', {})) as { currentTime: string };
    expect(hb.currentTime).toMatch(/Z$/);
    expect(Math.abs(new Date(hb.currentTime).getTime() - Date.now())).toBeLessThan(2000);
    expect((await c.repo.buscarCarregador('CP-1'))?.online).toBe(true);

    await vi.advanceTimersByTimeAsync(20_000); // 2 intervalos: ainda online
    expect((await c.repo.buscarCarregador('CP-1'))?.online).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000); // > 3 intervalos
    expect((await c.repo.buscarCarregador('CP-1'))?.online).toBe(false);
  });

  it('CP-06 frame com campo obrigatorio faltando: CALLERROR e conexao continua', async () => {
    c = await subirCenario();
    const ws = await c.wsCru('CP-1', { senha: 'segredo-cp1' });
    const r = await enviarEEsperar(ws, [2, 'a1', 'StatusNotification', { connectorId: 1, status: 'Available' }]);
    expect(r[0]).toBe(4);
    expect(r[1]).toBe('a1');
    expect(String(r[2])).toMatch(/FormationViolation|PropertyConstraintViolation|OccurrenceConstraintViolation/);
    expect(ws.readyState).toBe(ws.OPEN);
    const ok = await enviarEEsperar(ws, [2, 'a2', 'Heartbeat', {}]);
    expect(ok[0]).toBe(3);
  });

  it('CP-07 acao inexistente: NotImplemented e conexao continua', async () => {
    c = await subirCenario();
    const ws = await c.wsCru('CP-1', { senha: 'segredo-cp1' });
    const r = await enviarEEsperar(ws, [2, 'b1', 'AcaoQueNaoExiste', {}]);
    expect(r[0]).toBe(4);
    expect(r[2]).toBe('NotImplemented');
    expect(ws.readyState).toBe(ws.OPEN);
    const ok = await enviarEEsperar(ws, [2, 'b2', 'Heartbeat', {}]);
    expect(ok[0]).toBe(3);
  });

  it('CP-08 segunda conexao derruba a primeira; a segunda segue e nao fica offline pelo close da antiga', async () => {
    c = await subirCenario();
    const a = c.carregadorFake('CP-1', 'segredo-cp1');
    await a.connect();
    await a.call('BootNotification', BOOT);
    const fechouA = new Promise<{ code: number }>((res) => a.once('close', res));

    const b = c.carregadorFake('CP-1', 'segredo-cp1');
    await b.connect();
    await b.call('BootNotification', BOOT);

    expect((await fechouA).code).toBe(4000);
    await new Promise((r) => setTimeout(r, 50)); // deixa o handler de close da antiga rodar
    expect((await c.repo.buscarCarregador('CP-1'))?.online).toBe(true);
    expect(c.srv.clientes.get('CP-1')).toBeDefined();
    const hb = (await b.call('Heartbeat', {})) as { currentTime: string };
    expect(hb.currentTime).toBeTruthy();

    // ao fechar a vigente, ai sim fica offline e sai do mapa
    await b.close();
    await esperar(async () => {
      expect((await c!.repo.buscarCarregador('CP-1'))?.online).toBe(false);
      expect(c!.srv.clientes.has('CP-1')).toBe(false);
    });
  });

  it('trilha: todo frame (entrada/saida, tipo 2/3/4) vai para ocpp_mensagens com acao correlacionada', async () => {
    c = await subirCenario();
    const ws = await c.wsCru('CP-1', { senha: 'segredo-cp1' });
    await enviarEEsperar(ws, [2, 't1', 'Heartbeat', {}]);
    await enviarEEsperar(ws, [2, 't2', 'Nada', {}]);
    await esperar(() => expect(c!.repo.mensagens).toHaveLength(4));
    const m = c.repo.mensagens;
    expect(m[0]).toMatchObject({ direcao: 'entrada', tipo: 2, unique_id: 't1', acao: 'Heartbeat', ocpp_id: 'CP-1' });
    expect(m[1]).toMatchObject({ direcao: 'saida', tipo: 3, unique_id: 't1', acao: 'Heartbeat' });
    expect(m[2]).toMatchObject({ direcao: 'entrada', tipo: 2, unique_id: 't2', acao: 'Nada' });
    expect(m[3]).toMatchObject({ direcao: 'saida', tipo: 4, unique_id: 't2', acao: 'Nada' });
    expect(m[0]?.carregador_id).toBe((await c.repo.buscarCarregador('CP-1'))?.id);
  });
});

describe('ST - status e falhas de hardware', () => {
  it('ST-01 StatusNotification dos conectores 0 e 1 faz upsert', async () => {
    c = await subirCenario();
    const cli = c.carregadorFake('CP-1', 'segredo-cp1');
    await cli.connect();
    await cli.call('BootNotification', BOOT);
    await cli.call('StatusNotification', { connectorId: 0, status: 'Available', errorCode: 'NoError' });
    await cli.call('StatusNotification', { connectorId: 1, status: 'Preparing', errorCode: 'NoError', timestamp: '2026-10-04T12:00:00.000Z' });
    const cp = (await c.repo.buscarCarregador('CP-1'))!;
    expect(await c.repo.buscarConector(cp.id, 0)).toMatchObject({ status: 'Available', bloqueado_ate_reset: false });
    expect(await c.repo.buscarConector(cp.id, 1)).toMatchObject({ status: 'Preparing', error_code: 'NoError', status_em: '2026-10-04T12:00:00.000Z' });
    await cli.call('StatusNotification', { connectorId: 1, status: 'Available', errorCode: 'NoError' });
    expect((await c.repo.buscarConector(cp.id, 1))?.status).toBe('Available');
    expect(c.repo.conectores).toHaveLength(2);
  });

  it('ST-02 parada de emergencia (Faulted + OtherError "EmergencyStop") bloqueia e alerta', async () => {
    c = await subirCenario();
    const cli = c.carregadorFake('CP-1', 'segredo-cp1');
    await cli.connect();
    await cli.call('BootNotification', BOOT);
    await cli.call('StatusNotification', {
      connectorId: 1, status: 'Faulted', errorCode: 'OtherError', info: 'EmergencyStop', vendorErrorCode: 'EMERGENCY_STOP',
    });
    const cp = (await c.repo.buscarCarregador('CP-1'))!;
    expect(await c.repo.buscarConector(cp.id, 1)).toMatchObject({ status: 'Faulted', bloqueado_ate_reset: true });
    expect(c.repo.alertas).toHaveLength(1);
    expect(c.repo.alertas[0]).toMatchObject({ carregador_id: cp.id, connector_id: 1, tipo: 'conector_falha_grave' });
  });

  it('ST-02b errorCode "EmergencyStop" nao existe no 1.6: strict mode recusa o frame', async () => {
    c = await subirCenario();
    const ws = await c.wsCru('CP-1', { senha: 'segredo-cp1' });
    const r = await enviarEEsperar(ws, [2, 'e1', 'StatusNotification', { connectorId: 1, status: 'Faulted', errorCode: 'EmergencyStop' }]);
    expect(r[0]).toBe(4);
    expect(c.repo.conectores).toHaveLength(0);
  });

  it('ST-02c Faulted com falha comum alerta mas nao bloqueia', async () => {
    c = await subirCenario();
    const cli = c.carregadorFake('CP-1', 'segredo-cp1');
    await cli.connect();
    await cli.call('StatusNotification', { connectorId: 1, status: 'Faulted', errorCode: 'ReaderFailure' });
    const cp = (await c.repo.buscarCarregador('CP-1'))!;
    expect((await c.repo.buscarConector(cp.id, 1))?.bloqueado_ate_reset).toBe(false);
    expect(c.repo.alertas).toHaveLength(1);
  });

  it('ST-03 GroundFailure bloqueia; Available nao libera; boot sem Reset aceito nao libera; boot apos Reset aceito libera', async () => {
    c = await subirCenario();
    let cli = c.carregadorFake('CP-1', 'segredo-cp1');
    await cli.connect();
    await cli.call('BootNotification', BOOT);
    await cli.call('StatusNotification', { connectorId: 1, status: 'Faulted', errorCode: 'GroundFailure' });
    const cp = (await c.repo.buscarCarregador('CP-1'))!;
    expect((await c.repo.buscarConector(cp.id, 1))?.bloqueado_ate_reset).toBe(true);
    expect(c.repo.alertas).toHaveLength(1);

    await cli.call('StatusNotification', { connectorId: 1, status: 'Available', errorCode: 'NoError' });
    expect(await c.repo.buscarConector(cp.id, 1)).toMatchObject({ status: 'Available', bloqueado_ate_reset: true });

    // boot espontaneo (sem Reset aceito) nao libera
    await cli.call('BootNotification', BOOT);
    expect((await c.repo.buscarConector(cp.id, 1))?.bloqueado_ate_reset).toBe(true);

    // a Tarefa 6 marca o Reset aceito; o proximo boot libera e consome a marca
    c.srv.resetAceito.add('CP-1');
    await cli.close();
    cli = c.carregadorFake('CP-1', 'segredo-cp1');
    await cli.connect();
    await cli.call('BootNotification', BOOT);
    await cli.call('StatusNotification', { connectorId: 1, status: 'Available', errorCode: 'NoError' });
    expect(await c.repo.buscarConector(cp.id, 1)).toMatchObject({ status: 'Available', bloqueado_ate_reset: false });
    expect(c.srv.resetAceito.has('CP-1')).toBe(false);
  });
});

describe('falhas de trilha/offline sao reportadas, sem derrubar a conexao', () => {
  it('logMensagem e marcarOffline que falham chegam ao onErro e a conexao segue', async () => {
    const erros: string[] = [];
    c = await subirCenario({ onErro: (ctx) => erros.push(ctx) });
    const cli = c.carregadorFake('CP-1', 'segredo-cp1');
    await cli.connect();
    c.repo.logMensagem = async () => { throw new Error('supabase fora'); };
    c.repo.marcarOffline = async () => { throw new Error('supabase fora'); };
    const hb = (await cli.call('Heartbeat', {})) as { currentTime: string };
    expect(hb.currentTime).toBeTruthy(); // conexao e resposta intactas
    await esperar(() => expect(erros).toContain('logMensagem'));
    await cli.close();
    await esperar(() => expect(erros).toContain('marcarOffline'));
  });

  it('falha ao gravar a recusa de handshake tambem e reportada e o handshake e recusado', async () => {
    const erros: string[] = [];
    c = await subirCenario({ onErro: (ctx) => erros.push(ctx) });
    c.repo.logMensagem = async () => { throw new Error('supabase fora'); };
    await expect(c.carregadorFake('FANTASMA', 'x').connect()).rejects.toMatchObject({ code: 404 });
    expect(erros).toContain('auth.logMensagem');
  });
});

describe('DataTransfer / Diagnostics / Firmware', () => {
  it('respostas minimas validas', async () => {
    c = await subirCenario();
    const cli = c.carregadorFake('CP-1', 'segredo-cp1');
    await cli.connect();
    expect(await cli.call('DataTransfer', { vendorId: 'Joult', messageId: 'x', data: '1' })).toMatchObject({ status: 'Accepted' });
    expect(await cli.call('DiagnosticsStatusNotification', { status: 'Idle' })).toEqual({});
    expect(await cli.call('FirmwareStatusNotification', { status: 'Idle' })).toEqual({});
  });
});

describe('auth: hash de senha', () => {
  it('scrypt autodescritivo; verifica certa e errada; formato invalido falha fechado', () => {
    const h = gerarSenhaHash('abc');
    expect(h).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(h).not.toContain('abc');
    expect(gerarSenhaHash('abc')).not.toBe(h); // salt aleatorio
  });
  it('verificarSenha e assincrona e continua recusando senha errada e hash invalido', async () => {
    const h = gerarSenhaHash('abc');
    const p = verificarSenha(Buffer.from('abc'), h);
    expect(p).toBeInstanceOf(Promise);
    expect(await p).toBe(true);
    expect(await verificarSenha(Buffer.from('abd'), h)).toBe(false);
    expect(await verificarSenha(Buffer.from('abc'), 'lixo')).toBe(false);
  });
});
