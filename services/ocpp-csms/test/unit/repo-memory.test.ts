// So o que e proprio do MemoryRepo (semeadura, estado interno, relogio injetado).
// As propriedades do contrato Repo estao em test/integration/contrato-repo.ts e rodam contra
// MemoryRepo (test/integration/memory-repo.test.ts) e SupabaseRepo (supabase-repo.test.ts).
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepo } from '../../src/repo/memory.js';

const T0 = '2026-10-04T12:00:00.000Z';

let repo: MemoryRepo;
let cpId: string;
let recargaId: string;
let avancar: (ms: number) => void;

beforeEach(() => {
  let agora = new Date(T0);
  avancar = (ms) => { agora = new Date(agora.getTime() + ms); };
  repo = new MemoryRepo({ agora: () => agora });
  cpId = repo.semearCarregador({ ocppId: 'CP-1' }).id;
  recargaId = repo.semearRecarga({ valor: 50, tarifa_kwh_aplicada: 2.15, status: 'paid' }).id;
});

describe('semeadura', () => {
  it('ocpp_id duplicado e recusado', () => {
    expect(() => repo.semearCarregador({ ocppId: 'CP-1' })).toThrow(/unic/i);
  });
  it('idTag: limite de 20 caracteres e unicidade', () => {
    expect(() => repo.semearIdTag({ id_tag: 'X'.repeat(21) })).toThrow();
    expect(() => repo.semearIdTag({ id_tag: '' })).toThrow();
    repo.semearIdTag({ id_tag: 'A' });
    expect(() => repo.semearIdTag({ id_tag: 'A' })).toThrow(/unic/i);
  });
});

describe('relogio injetado', () => {
  it('registrarBoot grava o instante do relogio', async () => {
    await repo.registrarBoot(cpId, { vendor: 'V', modelo: 'M' });
    expect(await repo.buscarCarregador('CP-1')).toMatchObject({ ultimo_boot_em: T0, ultimo_contato_em: T0 });
  });
  it('comando: vence e expira (2 min) pelo relogio', async () => {
    const outro = repo.semearCarregador({ ocppId: 'CP-2' }).id;
    const a = (await repo.enfileirarComando({ carregador_id: cpId, acao: 'RemoteStartTransaction' })).comando;
    await repo.enfileirarComando({ carregador_id: outro, acao: 'RemoteStartTransaction' });
    const futuro = (await repo.enfileirarComando({
      carregador_id: cpId, acao: 'RemoteStartTransaction', proxima_tentativa_em: '2026-10-04T12:01:00.000Z',
    })).comando;
    expect(a).toMatchObject({ proxima_tentativa_em: T0, atualizado_em: T0 });
    expect(new Date(a.expira_em).getTime() - new Date(T0).getTime()).toBe(120000);
    expect((await repo.proximosComandos(['CP-1'])).map((c) => c.id)).toEqual([a.id]);
    await repo.atualizarComando(a.id, { status: 'enviado' });
    avancar(61000);
    expect((await repo.proximosComandos(['CP-1'])).map((c) => c.id)).toEqual([futuro.id]);
    avancar(120000);
    expect(await repo.proximosComandos(['CP-1'])).toHaveLength(0); // expirou
  });
  it('aceito_em e o instante do relogio na aceitacao', async () => {
    const { comando } = await repo.enfileirarComando({
      carregador_id: cpId, acao: 'RemoteStartTransaction', recarga_id: recargaId, payload: {},
    });
    avancar(5000);
    await repo.atualizarComando(comando.id, { status: 'aceito' });
    const l = await repo.listarRecargasComPartidaAceita();
    expect(l[0]!.aceito_em).toBe(new Date(new Date(T0).getTime() + 5000).toISOString());
  });
});

describe('estado interno', () => {
  it('solicitarEstorno guarda o pedido uma vez por recarga', async () => {
    await repo.solicitarEstorno(recargaId, { valor: 30, motivo: 'a' });
    await repo.solicitarEstorno(recargaId, { valor: 30, motivo: 'b' });
    expect(repo.estornos).toEqual([{ recarga_id: recargaId, valor: 30, motivo: 'a' }]);
  });
});
