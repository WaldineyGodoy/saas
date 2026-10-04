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

describe('carregador e conector', () => {
  it('busca por ocpp_id; desconhecido retorna null', async () => {
    expect((await repo.buscarCarregador('CP-1'))?.id).toBe(cpId);
    expect(await repo.buscarCarregador('NAO-EXISTE')).toBeNull();
  });
  it('ocpp_id duplicado e recusado', () => {
    expect(() => repo.semearCarregador({ ocppId: 'CP-1' })).toThrow(/unic/i);
  });
  it('registrarBoot grava dados e fica online', async () => {
    await repo.registrarBoot(cpId, { vendor: 'V', modelo: 'M', serial: 'S', firmware: 'F' });
    const c = await repo.buscarCarregador('CP-1');
    expect(c).toMatchObject({ vendor: 'V', modelo: 'M', online: true, ultimo_boot_em: T0 });
  });
  it('upsertConector respeita unicidade (carregador, connector_id)', async () => {
    const a = await repo.upsertConector(cpId, 1, { status: 'Available' });
    const b = await repo.upsertConector(cpId, 1, { status: 'Charging' });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe('Charging');
    expect(repo.conectores).toHaveLength(1);
  });
});

describe('transacao', () => {
  const dados = (o = {}) => ({
    carregador_id: cpId, connector_id: 1, recarga_id: null, id_tag: 'RCAAAAAAAAAAAAAAAAAA',
    meter_start_wh: 1000, inicio_em: T0, ...o,
  });
  it('mesma chave de idempotencia devolve a mesma transacao', async () => {
    const a = await repo.criarOuObterTransacao('k1', dados());
    const b = await repo.criarOuObterTransacao('k1', dados());
    expect(a.criada).toBe(true);
    expect(b.criada).toBe(false);
    expect(b.transacao.id).toBe(a.transacao.id);
    expect(repo.transacoes).toHaveLength(1);
  });
  it('ids sao inteiros sequenciais', async () => {
    const a = await repo.criarOuObterTransacao('k1', dados());
    const b = await repo.criarOuObterTransacao('k2', dados());
    expect(Number.isInteger(a.transacao.id)).toBe(true);
    expect(b.transacao.id).toBe(a.transacao.id + 1);
  });
  it('fecharTransacao grava stop; connector_id 0 e recusado', async () => {
    const { transacao } = await repo.criarOuObterTransacao('k1', dados());
    const f = await repo.fecharTransacao(transacao.id, { meter_stop_wh: 5000, fim_em: T0, motivo_parada: 'Local' });
    expect(f.fechada).toBe(true);
    expect(f.transacao).toMatchObject({ meter_stop_wh: 5000, motivo_parada: 'Local' });
    await expect(repo.criarOuObterTransacao('k0', dados({ connector_id: 0 }))).rejects.toThrow();
  });
  it('fecharTransacao e idempotente: o 2o fechamento nao sobrescreve', async () => {
    const { transacao } = await repo.criarOuObterTransacao('k1', dados());
    await repo.fecharTransacao(transacao.id, { meter_stop_wh: 5000, fim_em: T0, motivo_parada: 'Local' });
    const f2 = await repo.fecharTransacao(transacao.id, { meter_stop_wh: 9000, fim_em: '2026-10-04T13:00:00.000Z', motivo_parada: 'Other' });
    expect(f2.fechada).toBe(false);
    expect(f2.transacao).toMatchObject({ meter_stop_wh: 5000, fim_em: T0, motivo_parada: 'Local' });
  });
  it('buscas de transacao: por chave, aberta do conector e aberta por idTag (fechada some)', async () => {
    const { transacao } = await repo.criarOuObterTransacao('k1', dados({ id_tag: 'TAGX' }));
    expect((await repo.buscarTransacaoPorChave('k1'))?.id).toBe(transacao.id);
    expect(await repo.buscarTransacaoPorChave('nada')).toBeNull();
    expect((await repo.buscarTransacaoAberta(cpId, 1))?.id).toBe(transacao.id);
    expect((await repo.buscarTransacaoAbertaPorTag('TAGX'))?.id).toBe(transacao.id);
    await repo.fecharTransacao(transacao.id, { meter_stop_wh: 1, fim_em: T0 });
    expect(await repo.buscarTransacaoAberta(cpId, 1)).toBeNull();
    expect(await repo.buscarTransacaoAbertaPorTag('TAGX')).toBeNull();
  });
  it('solicitarEstorno registra o pedido; valor <= 0 ou recarga inexistente e recusado', async () => {
    await repo.solicitarEstorno(recargaId, { valor: 30, motivo: 'StopTransaction EVDisconnected' });
    expect(repo.estornos).toEqual([{ recarga_id: recargaId, valor: 30, motivo: 'StopTransaction EVDisconnected' }]);
    await repo.solicitarEstorno(recargaId, { valor: 30, motivo: 'repetido' });
    expect(repo.estornos).toHaveLength(1); // idempotente por recarga
    await expect(repo.solicitarEstorno(recargaId, { valor: 0, motivo: 'x' })).rejects.toThrow();
    await expect(repo.solicitarEstorno('nao-existe', { valor: 1, motivo: 'x' })).rejects.toThrow();
  });
});

describe('medicoes', () => {
  const nova = async () => (await repo.criarOuObterTransacao('k1', {
    carregador_id: cpId, connector_id: 1, recarga_id: null, id_tag: 'X', meter_start_wh: 0, inicio_em: T0,
  })).transacao;
  it('dedupe por (transacao, medido_em, measurand, phase); phase vazia por padrao', async () => {
    const t = await nova();
    const m = { transacao_id: t.id, connector_id: 1, medido_em: T0, valor: 100, unidade: 'Wh' };
    expect(await repo.gravarMedicoes([m])).toBe(1);
    expect(await repo.gravarMedicoes([m, { ...m, valor: 999 }])).toBe(0);
    expect(await repo.gravarMedicoes([{ ...m, phase: 'L1' }, { ...m, measurand: 'Voltage' }])).toBe(2);
    expect(repo.medicoes).toHaveLength(3);
    expect(repo.medicoes[0]).toMatchObject({ measurand: 'Energy.Active.Import.Register', phase: '', valor: 100 });
  });
  it('dedupe compara o instante (timestamptz), nao o texto', async () => {
    const t = await nova();
    const m = { transacao_id: t.id, connector_id: 1, valor: 100, unidade: 'Wh' };
    expect(await repo.gravarMedicoes([{ ...m, medido_em: '2026-10-04T12:00:00Z' }])).toBe(1);
    expect(await repo.gravarMedicoes([{ ...m, medido_em: '2026-10-04T12:00:00.000Z' }])).toBe(0);
    expect(await repo.gravarMedicoes([{ ...m, medido_em: '2026-10-04T09:00:00-03:00' }])).toBe(0);
    expect(repo.medicoes).toHaveLength(1);
  });
  it('transacao inexistente e recusada (FK)', async () => {
    await expect(repo.gravarMedicoes([{ transacao_id: 99, connector_id: 1, medido_em: T0, valor: 1, unidade: 'Wh' }]))
      .rejects.toThrow();
  });
});

describe('recarga', () => {
  it('transicao valida aplica o patch', async () => {
    const r = await repo.atualizarRecarga(recargaId, { status: 'starting' });
    expect(r?.status).toBe('starting');
  });
  it('transicao invalida e rejeitada (gatilho)', async () => {
    await expect(repo.atualizarRecarga(recargaId, { status: 'completed' })).rejects.toThrow(/transicao/i);
    expect((await repo.buscarRecarga(recargaId))?.status).toBe('paid');
  });
  it('terminal nao sai', async () => {
    await repo.atualizarRecarga(recargaId, { status: 'failed' });
    await expect(repo.atualizarRecarga(recargaId, { status: 'paid' })).rejects.toThrow();
  });
  it('deStatus diferente do atual: nao aplica e devolve null', async () => {
    expect(await repo.atualizarRecarga(recargaId, { status: 'starting' }, 'pending_payment')).toBeNull();
    expect((await repo.buscarRecarga(recargaId))?.status).toBe('paid');
  });
  it('mesmo status nao e transicao (patch de outros campos passa)', async () => {
    const r = await repo.atualizarRecarga(recargaId, { kwh_consumido: 1.5 });
    expect(r).toMatchObject({ status: 'paid', kwh_consumido: 1.5 });
  });
});

describe('idTag', () => {
  it('limite de 20 caracteres', () => {
    expect(() => repo.semearIdTag({ id_tag: 'X'.repeat(21) })).toThrow();
    expect(() => repo.semearIdTag({ id_tag: '' })).toThrow();
  });
  it('busca e atualiza', async () => {
    repo.semearIdTag({ id_tag: 'RCAAAAAAAAAAAAAAAAAA', recarga_id: recargaId });
    expect((await repo.buscarIdTag('RCAAAAAAAAAAAAAAAAAA'))?.status).toBe('Accepted');
    await repo.atualizarIdTag('RCAAAAAAAAAAAAAAAAAA', { status: 'Expired' });
    expect((await repo.buscarIdTag('RCAAAAAAAAAAAAAAAAAA'))?.status).toBe('Expired');
    expect(await repo.buscarIdTag('NAO')).toBeNull();
  });
});

describe('comandos', () => {
  const cmd = (o = {}) => ({ carregador_id: cpId, acao: 'RemoteStartTransaction' as const, payload: {}, ...o });
  it('chave de idempotencia igual nao duplica', async () => {
    const a = await repo.enfileirarComando(cmd({ chave_idempotencia: 'start:1' }));
    const b = await repo.enfileirarComando(cmd({ chave_idempotencia: 'start:1' }));
    expect(a.criado).toBe(true);
    expect(b.criado).toBe(false);
    expect(b.comando.id).toBe(a.comando.id);
    expect(repo.comandos).toHaveLength(1);
  });
  it('chave nula pode repetir (comando de operador)', async () => {
    await repo.enfileirarComando(cmd({ acao: 'Reset' }));
    await repo.enfileirarComando(cmd({ acao: 'Reset' }));
    expect(repo.comandos).toHaveLength(2);
  });
  it('defaults: pendente, 0 tentativas, expira em 2 min', async () => {
    const { comando } = await repo.enfileirarComando(cmd());
    expect(comando).toMatchObject({ status: 'pendente', tentativas: 0, proxima_tentativa_em: T0 });
    expect(new Date(comando.expira_em).getTime() - new Date(T0).getTime()).toBe(120000);
  });
  it('proximosComandos filtra por carregador, status, vencimento e expiracao', async () => {
    const outro = repo.semearCarregador({ ocppId: 'CP-2' }).id;
    const a = (await repo.enfileirarComando(cmd())).comando;
    await repo.enfileirarComando(cmd({ carregador_id: outro }));
    const futuro = (await repo.enfileirarComando(cmd({ proxima_tentativa_em: '2026-10-04T12:01:00.000Z' }))).comando;
    expect((await repo.proximosComandos(['CP-1'])).map((c) => c.id)).toEqual([a.id]);
    await repo.atualizarComando(a.id, { status: 'enviado' });
    expect(await repo.proximosComandos(['CP-1'])).toHaveLength(0);
    avancar(61000);
    expect((await repo.proximosComandos(['CP-1'])).map((c) => c.id)).toEqual([futuro.id]);
    avancar(120000);
    expect(await repo.proximosComandos(['CP-1'])).toHaveLength(0); // expirou
  });
});

describe('log de mensagens', () => {
  it('guarda frames na ordem', async () => {
    await repo.logMensagem({ carregador_id: cpId, ocpp_id: 'CP-1', direcao: 'entrada', tipo: 2, unique_id: 'a', acao: 'Heartbeat', payload: {} });
    await repo.logMensagem({ carregador_id: null, ocpp_id: 'X', direcao: 'entrada', tipo: null, unique_id: null, acao: null, payload: null });
    expect(repo.mensagens.map((m) => m.ocpp_id)).toEqual(['CP-1', 'X']);
  });
});

describe('listagens e alertas (Tarefa 4)', () => {
  it('listarOnline devolve so os carregadores online', async () => {
    const outro = repo.semearCarregador({ ocppId: 'CP-2' }).id;
    expect(await repo.listarOnline()).toHaveLength(0);
    await repo.registrarContato(outro);
    expect((await repo.listarOnline()).map((c) => c.ocpp_id)).toEqual(['CP-2']);
    await repo.marcarOffline(outro);
    expect(await repo.listarOnline()).toHaveLength(0);
  });
  it('listarConectores filtra pelo carregador', async () => {
    const outro = repo.semearCarregador({ ocppId: 'CP-2' }).id;
    await repo.upsertConector(cpId, 0, {});
    await repo.upsertConector(cpId, 1, {});
    await repo.upsertConector(outro, 1, {});
    expect((await repo.listarConectores(cpId)).map((c) => c.connector_id)).toEqual([0, 1]);
  });
  it('alertar guarda o alerta e recusa carregador inexistente', async () => {
    await repo.alertar({ carregador_id: cpId, connector_id: 1, tipo: 'conector_falha_grave', mensagem: 'x' });
    expect(repo.alertas).toHaveLength(1);
    await expect(repo.alertar({ carregador_id: 'nao-existe', connector_id: null, tipo: 't', mensagem: 'm' })).rejects.toThrow(/inexistente/);
  });
});
