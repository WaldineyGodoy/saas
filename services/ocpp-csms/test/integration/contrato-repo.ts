// Bateria de propriedades do contrato `Repo`. Roda contra MemoryRepo (sempre) e SupabaseRepo
// (com Supabase local) para a L3a nunca testar um repositorio que se comporta diferente do banco.
// So usa a interface publica do Repo; semeadura e observacao vem do "mundo" que a fabrica monta.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  Alerta, Carregador, IdTag, Mensagem, Recarga, Repo,
} from '../../src/repo/types.js';

export interface Mundo {
  repo: Repo;
  // relogio do repo (o MemoryRepo pode usar relogio fixo)
  agora(): Date;
  // ocppId opcional (padrao: unico aleatorio); lanca se violar unicidade/constraints do banco
  semearCarregador(p?: { ocppId?: string } & Partial<Carregador>): Promise<Carregador>;
  semearIdTag(p: Partial<IdTag> & { id_tag: string }): Promise<IdTag>;
  semearRecarga(p?: Partial<Recarga>): Promise<Recarga>;
  // observacao do que o Repo so escreve
  mensagens(ocppId: string): Promise<Mensagem[]>;
  estornos(recargaId: string): Promise<{ valor: number; motivo: string }[]>;
  alertas(carregadorId: string): Promise<Alerta[]>;
  // remove tudo o que o teste criou
  limpar(): Promise<void>;
}

export type FabricaMundo = () => Promise<Mundo>;

const aleatorio = () => Math.random().toString(36).slice(2, 10).toUpperCase();

export function contratoRepo(fabrica: FabricaMundo): void {
  let m: Mundo;
  let repo: Repo;
  let cp: Carregador;
  let recarga: Recarga;
  const em = (ms: number) => new Date(m.agora().getTime() + ms).toISOString();

  beforeEach(async () => {
    m = await fabrica();
    repo = m.repo;
    cp = await m.semearCarregador();
    recarga = await m.semearRecarga({ valor: 50, tarifa_kwh_aplicada: 2.15, status: 'paid' });
  });
  afterEach(async () => { await m.limpar(); });

  describe('carregador e conector', () => {
    it('busca por ocpp_id; desconhecido retorna null', async () => {
      expect((await repo.buscarCarregador(cp.ocpp_id))?.id).toBe(cp.id);
      expect(await repo.buscarCarregador('NAO-EXISTE-' + aleatorio())).toBeNull();
    });
    it('ocpp_id duplicado e recusado', async () => {
      await expect(m.semearCarregador({ ocppId: cp.ocpp_id })).rejects.toThrow();
    });
    it('registrarBoot grava dados e fica online', async () => {
      await repo.registrarBoot(cp.id, { vendor: 'V', modelo: 'M', serial: 'S', firmware: 'F' });
      const c = await repo.buscarCarregador(cp.ocpp_id);
      expect(c).toMatchObject({ vendor: 'V', modelo: 'M', serial: 'S', firmware: 'F', online: true, estado_registro: 'aceito' });
      expect(Math.abs(new Date(c!.ultimo_boot_em!).getTime() - m.agora().getTime())).toBeLessThan(10000);
      expect(c!.ultimo_contato_em).not.toBeNull();
    });
    it('registrarContato e marcarOffline alternam online; listarOnline so traz online', async () => {
      const outro = await m.semearCarregador();
      const meus = async () => (await repo.listarOnline()).filter((c) => [cp.id, outro.id].includes(c.id)).map((c) => c.ocpp_id);
      expect(await meus()).toEqual([]);
      await repo.registrarContato(outro.id);
      expect(await meus()).toEqual([outro.ocpp_id]);
      await repo.marcarOffline(outro.id);
      expect(await meus()).toEqual([]);
    });
    it('upsertConector respeita unicidade (carregador, connector_id)', async () => {
      const a = await repo.upsertConector(cp.id, 1, { status: 'Available' });
      const b = await repo.upsertConector(cp.id, 1, { status: 'Charging' });
      expect(b.id).toBe(a.id);
      expect(b.status).toBe('Charging');
      expect(await repo.listarConectores(cp.id)).toHaveLength(1);
      expect(await repo.buscarConector(cp.id, 1)).toMatchObject({ id: a.id, status: 'Charging', error_code: 'NoError' });
      expect(await repo.buscarConector(cp.id, 2)).toBeNull();
    });
    it('upsertConector com patch vazio cria com os defaults do banco', async () => {
      const c = await repo.upsertConector(cp.id, 0, {});
      expect(c).toMatchObject({ connector_id: 0, status: 'Unavailable', error_code: 'NoError', bloqueado_ate_reset: false });
    });
    it('connector_id negativo e carregador inexistente sao recusados', async () => {
      await expect(repo.upsertConector(cp.id, -1, {})).rejects.toThrow();
      await expect(repo.upsertConector('00000000-0000-4000-8000-000000000000', 1, {})).rejects.toThrow();
    });
    it('listarConectores filtra pelo carregador', async () => {
      const outro = await m.semearCarregador();
      await repo.upsertConector(cp.id, 0, {});
      await repo.upsertConector(cp.id, 1, {});
      await repo.upsertConector(outro.id, 1, {});
      expect((await repo.listarConectores(cp.id)).map((c) => c.connector_id).sort()).toEqual([0, 1]);
    });
  });

  describe('transacao', () => {
    const dados = (o = {}) => ({
      carregador_id: cp.id, connector_id: 1, recarga_id: null, id_tag: 'RCAAAAAAAAAAAAAAAAAA',
      meter_start_wh: 1000, inicio_em: '2026-10-04T12:00:00.000Z', ...o,
    });
    const T0 = '2026-10-04T12:00:00.000Z';

    it('mesma chave de idempotencia devolve a mesma transacao', async () => {
      const k = 'k1-' + aleatorio();
      const a = await repo.criarOuObterTransacao(k, dados());
      const b = await repo.criarOuObterTransacao(k, dados());
      expect(a.criada).toBe(true);
      expect(b.criada).toBe(false);
      expect(b.transacao.id).toBe(a.transacao.id);
      expect(a.transacao).toMatchObject({ meter_start_wh: 1000, meter_stop_wh: null, fim_em: null, chave_idempotencia: k });
    });
    it('retransmissoes simultaneas criam uma unica transacao', async () => {
      const k = 'kc-' + aleatorio();
      const r = await Promise.all([1, 2, 3, 4].map(() => repo.criarOuObterTransacao(k, dados())));
      expect(r.filter((x) => x.criada)).toHaveLength(1);
      expect(new Set(r.map((x) => x.transacao.id)).size).toBe(1);
    });
    it('ids sao inteiros crescentes', async () => {
      const a = await repo.criarOuObterTransacao('k1-' + aleatorio(), dados());
      const b = await repo.criarOuObterTransacao('k2-' + aleatorio(), dados());
      expect(Number.isInteger(a.transacao.id)).toBe(true);
      expect(Number.isInteger(b.transacao.id)).toBe(true);
      expect(b.transacao.id).toBeGreaterThan(a.transacao.id);
    });
    it('fecharTransacao grava stop; connector_id 0 e carregador inexistente sao recusados', async () => {
      const { transacao } = await repo.criarOuObterTransacao('k1-' + aleatorio(), dados());
      const f = await repo.fecharTransacao(transacao.id, { meter_stop_wh: 5000, fim_em: T0, motivo_parada: 'Local' });
      expect(f.fechada).toBe(true);
      expect(f.transacao).toMatchObject({ meter_stop_wh: 5000, motivo_parada: 'Local' });
      expect(new Date(f.transacao.fim_em!).getTime()).toBe(new Date(T0).getTime());
      await expect(repo.criarOuObterTransacao('k0-' + aleatorio(), dados({ connector_id: 0 }))).rejects.toThrow();
      await expect(repo.criarOuObterTransacao('kx-' + aleatorio(), dados({ carregador_id: '00000000-0000-4000-8000-000000000000' }))).rejects.toThrow();
      await expect(repo.fecharTransacao(2_000_000_000, { meter_stop_wh: 1, fim_em: T0 })).rejects.toThrow();
    });
    it('fecharTransacao e idempotente: o 2o fechamento nao sobrescreve', async () => {
      const { transacao } = await repo.criarOuObterTransacao('k1-' + aleatorio(), dados());
      await repo.fecharTransacao(transacao.id, { meter_stop_wh: 5000, fim_em: T0, motivo_parada: 'Local' });
      const f2 = await repo.fecharTransacao(transacao.id, { meter_stop_wh: 9000, fim_em: '2026-10-04T13:00:00.000Z', motivo_parada: 'Other' });
      expect(f2.fechada).toBe(false);
      expect(f2.transacao).toMatchObject({ meter_stop_wh: 5000, motivo_parada: 'Local' });
      expect(new Date(f2.transacao.fim_em!).getTime()).toBe(new Date(T0).getTime());
    });
    it('StopTransaction simultaneos: so um fecha', async () => {
      const { transacao } = await repo.criarOuObterTransacao('k1-' + aleatorio(), dados());
      const r = await Promise.all([1, 2, 3].map((i) =>
        repo.fecharTransacao(transacao.id, { meter_stop_wh: 1000 * i, fim_em: T0 })));
      expect(r.filter((x) => x.fechada)).toHaveLength(1);
      expect(new Set(r.map((x) => x.transacao.meter_stop_wh)).size).toBe(1);
    });
    it('buscas de transacao: por id, por chave, aberta do conector e aberta por idTag (fechada some)', async () => {
      const k = 'k1-' + aleatorio();
      const tag = 'TAG' + aleatorio();
      const { transacao } = await repo.criarOuObterTransacao(k, dados({ id_tag: tag }));
      expect((await repo.buscarTransacao(transacao.id))?.chave_idempotencia).toBe(k);
      expect(await repo.buscarTransacao(2_000_000_000)).toBeNull();
      expect((await repo.buscarTransacaoPorChave(k))?.id).toBe(transacao.id);
      expect(await repo.buscarTransacaoPorChave('nada-' + aleatorio())).toBeNull();
      expect((await repo.buscarTransacaoAberta(cp.id, 1))?.id).toBe(transacao.id);
      expect((await repo.buscarTransacaoAbertaPorTag(tag))?.id).toBe(transacao.id);
      await repo.fecharTransacao(transacao.id, { meter_stop_wh: 1, fim_em: T0 });
      expect(await repo.buscarTransacaoAberta(cp.id, 1)).toBeNull();
      expect(await repo.buscarTransacaoAbertaPorTag(tag)).toBeNull();
    });
  });

  describe('estorno', () => {
    it('solicitarEstorno registra o pedido; valor <= 0 ou recarga inexistente e recusado', async () => {
      await repo.solicitarEstorno(recarga.id, { valor: 30, motivo: 'StopTransaction EVDisconnected' });
      expect(await m.estornos(recarga.id)).toEqual([{ valor: 30, motivo: 'StopTransaction EVDisconnected' }]);
      await repo.solicitarEstorno(recarga.id, { valor: 30, motivo: 'repetido' });
      expect(await m.estornos(recarga.id)).toHaveLength(1); // idempotente por recarga
      await expect(repo.solicitarEstorno(recarga.id, { valor: 0, motivo: 'x' })).rejects.toThrow();
      await expect(repo.solicitarEstorno('00000000-0000-4000-8000-000000000000', { valor: 1, motivo: 'x' })).rejects.toThrow();
    });
  });

  describe('medicoes', () => {
    const nova = async () => (await repo.criarOuObterTransacao('k1-' + aleatorio(), {
      carregador_id: cp.id, connector_id: 1, recarga_id: null, id_tag: 'X', meter_start_wh: 0, inicio_em: '2026-10-04T12:00:00.000Z',
    })).transacao;
    const T0 = '2026-10-04T12:00:00.000Z';

    it('dedupe por (transacao, medido_em, measurand, phase); phase vazia por padrao', async () => {
      const t = await nova();
      const med = { transacao_id: t.id, connector_id: 1, medido_em: T0, valor: 100, unidade: 'Wh' };
      expect(await repo.gravarMedicoes([med])).toBe(1);
      expect(await repo.gravarMedicoes([med, { ...med, valor: 999 }])).toBe(0);
      expect(await repo.gravarMedicoes([{ ...med, phase: 'L1' }, { ...med, measurand: 'Voltage' }])).toBe(2);
      const lista = await repo.listarMedicoes(t.id);
      expect(lista).toHaveLength(3);
      expect(lista[0]).toMatchObject({ measurand: 'Energy.Active.Import.Register', phase: '', valor: 100, unidade: 'Wh', contexto: null });
    });
    it('lote com duplicata interna entra uma vez; lote vazio nao falha', async () => {
      const t = await nova();
      const med = { transacao_id: t.id, connector_id: 1, medido_em: T0, valor: 1, unidade: 'Wh' };
      expect(await repo.gravarMedicoes([med, { ...med, valor: 2 }])).toBe(1);
      expect(await repo.gravarMedicoes([])).toBe(0);
    });
    it('dedupe compara o instante (timestamptz), nao o texto', async () => {
      const t = await nova();
      const med = { transacao_id: t.id, connector_id: 1, valor: 100, unidade: 'Wh' };
      expect(await repo.gravarMedicoes([{ ...med, medido_em: '2026-10-04T12:00:00Z' }])).toBe(1);
      expect(await repo.gravarMedicoes([{ ...med, medido_em: '2026-10-04T12:00:00.000Z' }])).toBe(0);
      expect(await repo.gravarMedicoes([{ ...med, medido_em: '2026-10-04T09:00:00-03:00' }])).toBe(0);
      expect(await repo.listarMedicoes(t.id)).toHaveLength(1);
    });
    it('transacao inexistente e recusada (FK)', async () => {
      await expect(repo.gravarMedicoes([{ transacao_id: 2_000_000_000, connector_id: 1, medido_em: T0, valor: 1, unidade: 'Wh' }]))
        .rejects.toThrow();
    });
  });

  describe('recarga', () => {
    it('buscarRecarga devolve a recarga ou null', async () => {
      expect(await repo.buscarRecarga(recarga.id)).toMatchObject({ id: recarga.id, status: 'paid', valor: 50, tarifa_kwh_aplicada: 2.15 });
      expect(await repo.buscarRecarga('00000000-0000-4000-8000-000000000000')).toBeNull();
    });
    it('transicao valida aplica o patch', async () => {
      const r = await repo.atualizarRecarga(recarga.id, { status: 'starting' });
      expect(r?.status).toBe('starting');
      expect((await repo.buscarRecarga(recarga.id))?.status).toBe('starting');
    });
    it('transicao invalida e rejeitada (gatilho)', async () => {
      await expect(repo.atualizarRecarga(recarga.id, { status: 'completed' })).rejects.toThrow(/transi/i);
      expect((await repo.buscarRecarga(recarga.id))?.status).toBe('paid');
    });
    it('terminal nao sai', async () => {
      await repo.atualizarRecarga(recarga.id, { status: 'failed' });
      await expect(repo.atualizarRecarga(recarga.id, { status: 'paid' })).rejects.toThrow();
    });
    it('deStatus diferente do atual: nao aplica e devolve null; igual aplica', async () => {
      expect(await repo.atualizarRecarga(recarga.id, { status: 'starting' }, 'pending_payment')).toBeNull();
      expect((await repo.buscarRecarga(recarga.id))?.status).toBe('paid');
      expect((await repo.atualizarRecarga(recarga.id, { status: 'starting' }, 'paid'))?.status).toBe('starting');
    });
    it('recarga inexistente lanca (com ou sem deStatus)', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await expect(repo.atualizarRecarga(id, { kwh_consumido: 1 })).rejects.toThrow();
      await expect(repo.atualizarRecarga(id, { kwh_consumido: 1 }, 'paid')).rejects.toThrow();
    });
    it('transicoes concorrentes com a mesma guarda: so uma aplica', async () => {
      const r = await Promise.all([1, 2, 3].map(() => repo.atualizarRecarga(recarga.id, { status: 'starting' }, 'paid')));
      expect(r.filter((x) => x !== null)).toHaveLength(1);
    });
    it('mesmo status nao e transicao (patch de outros campos passa)', async () => {
      const r = await repo.atualizarRecarga(recarga.id, { kwh_consumido: 1.5 });
      expect(r).toMatchObject({ status: 'paid', kwh_consumido: 1.5 });
    });
    it('metadata e mesclada por chave (nao substitui o objeto) e preserva o que ja existia', async () => {
      const r0 = await m.semearRecarga({ status: 'paid', metadata: { origem: 'checkout' } });
      await repo.atualizarRecarga(r0.id, { metadata: { a: 1 } });
      const r = await repo.atualizarRecarga(r0.id, { metadata: { b: 2 } });
      expect(r?.metadata).toEqual({ origem: 'checkout', a: 1, b: 2 });
      expect((await repo.buscarRecarga(r0.id))?.metadata).toEqual({ origem: 'checkout', a: 1, b: 2 });
    });
    it('escritas concorrentes de metadata com chaves diferentes nao se atropelam', async () => {
      await Promise.all([
        repo.atualizarRecarga(recarga.id, { metadata: { a: 1 } }),
        repo.atualizarRecarga(recarga.id, { metadata: { b: 2 } }),
        repo.atualizarRecarga(recarga.id, { metadata: { c: 3 } }, 'paid'),
      ]);
      expect((await repo.buscarRecarga(recarga.id))?.metadata).toEqual({ a: 1, b: 2, c: 3 });
    });
    it('metadata com guarda de status: so mescla se a guarda vale', async () => {
      expect(await repo.atualizarRecarga(recarga.id, { metadata: { x: 1 } }, 'starting')).toBeNull();
      expect((await repo.buscarRecarga(recarga.id))?.metadata).toEqual({});
    });
  });

  describe('idTag', () => {
    it('limite de 20 caracteres', async () => {
      await expect(m.semearIdTag({ id_tag: 'X'.repeat(21) })).rejects.toThrow();
      await expect(m.semearIdTag({ id_tag: '' })).rejects.toThrow();
    });
    it('busca e atualiza', async () => {
      const tag = 'RC' + aleatorio();
      await m.semearIdTag({ id_tag: tag, recarga_id: recarga.id });
      expect((await repo.buscarIdTag(tag))?.status).toBe('Accepted');
      await repo.atualizarIdTag(tag, { status: 'Expired' });
      expect((await repo.buscarIdTag(tag))?.status).toBe('Expired');
      expect(await repo.buscarIdTag('NAO' + aleatorio())).toBeNull();
      await expect(repo.atualizarIdTag('NAO' + aleatorio(), { status: 'Expired' })).rejects.toThrow();
    });
  });

  describe('comandos', () => {
    const cmd = (o = {}) => ({ carregador_id: cp.id, acao: 'RemoteStartTransaction' as const, payload: {}, ...o });

    it('chave de idempotencia igual nao duplica', async () => {
      const k = 'start:' + aleatorio();
      const a = await repo.enfileirarComando(cmd({ chave_idempotencia: k }));
      const b = await repo.enfileirarComando(cmd({ chave_idempotencia: k }));
      expect(a.criado).toBe(true);
      expect(b.criado).toBe(false);
      expect(b.comando.id).toBe(a.comando.id);
    });
    it('enfileiramentos simultaneos com a mesma chave criam um comando', async () => {
      const k = 'start:' + aleatorio();
      const r = await Promise.all([1, 2, 3].map(() => repo.enfileirarComando(cmd({ chave_idempotencia: k }))));
      expect(r.filter((x) => x.criado)).toHaveLength(1);
      expect(new Set(r.map((x) => x.comando.id)).size).toBe(1);
    });
    it('chave nula pode repetir (comando de operador)', async () => {
      const a = await repo.enfileirarComando(cmd({ acao: 'Reset' }));
      const b = await repo.enfileirarComando(cmd({ acao: 'Reset' }));
      expect(a.criado && b.criado).toBe(true);
      expect(a.comando.id).not.toBe(b.comando.id);
    });
    it('defaults: pendente, 0 tentativas, vence agora e expira em 2 min; payload e recarga_id gravados', async () => {
      const { comando } = await repo.enfileirarComando(cmd({ payload: { connectorId: 1, idTag: 'T' }, recarga_id: recarga.id }));
      expect(comando).toMatchObject({
        status: 'pendente', tentativas: 0, resposta: null, erro: null, recarga_id: recarga.id,
        payload: { connectorId: 1, idTag: 'T' }, acao: 'RemoteStartTransaction', carregador_id: cp.id,
      });
      expect(Math.abs(new Date(comando.proxima_tentativa_em).getTime() - m.agora().getTime())).toBeLessThan(10000);
      expect(new Date(comando.expira_em).getTime() - new Date(comando.proxima_tentativa_em).getTime()).toBe(120000);
      expect(comando.atualizado_em).toBeTruthy();
    });
    it('proximosComandos filtra por carregador, status, vencimento e expiracao; ordena por vencimento', async () => {
      const outro = await m.semearCarregador();
      const y = (await repo.enfileirarComando(cmd({ proxima_tentativa_em: em(-1000) }))).comando;
      const x = (await repo.enfileirarComando(cmd({ proxima_tentativa_em: em(-5000) }))).comando;
      await repo.enfileirarComando(cmd({ carregador_id: outro.id, proxima_tentativa_em: em(-1000) }));
      await repo.enfileirarComando(cmd({ proxima_tentativa_em: em(60000) })); // futuro
      await repo.enfileirarComando(cmd({ proxima_tentativa_em: em(-3000), expira_em: em(-1) })); // expirado
      const ids = async () => (await repo.proximosComandos([cp.ocpp_id])).map((c) => c.id);
      expect(await ids()).toEqual([x.id, y.id]);
      await repo.atualizarComando(x.id, { status: 'enviado' });
      expect(await ids()).toEqual([y.id]);
      expect(await repo.proximosComandos([])).toEqual([]);
      expect((await repo.proximosComandos([cp.ocpp_id, outro.ocpp_id])).map((c) => c.carregador_id).sort())
        .toEqual([cp.id, outro.id].sort());
    });
    it('atualizarComando aplica o patch e falha se o comando nao existe', async () => {
      const { comando } = await repo.enfileirarComando(cmd());
      const c = await repo.atualizarComando(comando.id, {
        status: 'aceito', tentativas: 2, resposta: { status: 'Accepted' }, erro: 'e', proxima_tentativa_em: em(5000),
      });
      expect(c).toMatchObject({ status: 'aceito', tentativas: 2, resposta: { status: 'Accepted' }, erro: 'e' });
      await expect(repo.atualizarComando('00000000-0000-4000-8000-000000000000', { status: 'aceito' })).rejects.toThrow();
    });
  });

  describe('fila - trava, expirados e starting', () => {
    const novo = (o = {}) => repo.enfileirarComando({ carregador_id: cp.id, acao: 'GetConfiguration', payload: {}, ...o });
    const meus = <T extends { carregador_id: string }>(l: T[]) => l.filter((c) => c.carregador_id === cp.id);

    it('reivindicarComando trava pendente -> enviado so uma vez', async () => {
      const { comando } = await novo();
      const t = await repo.reivindicarComando(comando.id);
      expect(t?.status).toBe('enviado');
      expect(await repo.reivindicarComando(comando.id)).toBeNull();
      expect(await repo.reivindicarComando('00000000-0000-4000-8000-000000000000')).toBeNull();
    });
    it('reivindicacoes simultaneas: so uma instancia trava', async () => {
      const { comando } = await novo();
      const r = await Promise.all([1, 2, 3, 4, 5].map(() => repo.reivindicarComando(comando.id)));
      expect(r.filter((x) => x !== null)).toHaveLength(1);
    });
    it('listarComandosExpirados devolve so pendentes vencidos', async () => {
      const vivo = (await novo()).comando;
      const vencido = (await novo({ expira_em: em(-1) })).comando;
      const enviado = (await novo({ expira_em: em(-1) })).comando;
      await repo.reivindicarComando(enviado.id);
      const ids = meus(await repo.listarComandosExpirados()).map((c) => c.id);
      expect(ids).toEqual([vencido.id]);
      expect(ids).not.toContain(vivo.id);
    });
    it('listarRecargasComPartidaAceita traz o instante da aceitacao do RemoteStart (paid ou starting)', async () => {
      const minhas = async () => (await repo.listarRecargasComPartidaAceita()).filter((x) => x.recarga.id === recarga.id);
      expect(await minhas()).toEqual([]); // sem comando aceito
      const { comando } = await novo({ acao: 'RemoteStartTransaction', recarga_id: recarga.id });
      expect(await minhas()).toEqual([]); // pendente nao conta
      const aceito = await repo.atualizarComando(comando.id, { status: 'aceito' });
      const l = await minhas();
      expect(l).toHaveLength(1);
      expect(l[0]!.aceito_em).toBe(aceito.atualizado_em);
      expect(l[0]!.recarga.id).toBe(recarga.id);
      await repo.atualizarRecarga(recarga.id, { status: 'starting' });
      expect(await minhas()).toHaveLength(1);
      await repo.atualizarRecarga(recarga.id, { status: 'charging' });
      expect(await minhas()).toEqual([]); // so paid|starting
    });
    it('assinarComandos avisa a cada insercao e o cancelamento funciona', async () => {
      if (!repo.assinarComandos) return; // opcional no contrato
      let n = 0;
      const cancelar = repo.assinarComandos(() => { n++; });
      try {
        // o Realtime leva um instante para assinar: enfileira ate o aviso chegar
        await vi.waitFor(async () => {
          await novo();
          expect(n).toBeGreaterThan(0);
        }, { timeout: 15000, interval: 500 });
      } finally { cancelar(); }
      await new Promise((r) => setTimeout(r, 300)); // avisos em voo
      const antes = n;
      await novo();
      await new Promise((r) => setTimeout(r, 1500));
      expect(n).toBe(antes);
    }, 20000);
    it('atualizarComandoSe e condicional ao status e ao atualizado_em', async () => {
      const { comando } = await novo();
      expect(await repo.atualizarComandoSe(comando.id, { status: 'enviado' }, { status: 'aceito' })).toBeNull();
      const lido = (await repo.reivindicarComando(comando.id))!.atualizado_em; // valor exato devolvido pelo repo
      expect(await repo.atualizarComandoSe(comando.id, { status: 'enviado', atualizado_em: '2000-01-01T00:00:00.000Z' }, { status: 'pendente' })).toBeNull();
      const ok = await repo.atualizarComandoSe(comando.id, { status: 'enviado', atualizado_em: lido }, { status: 'pendente' });
      expect(ok?.status).toBe('pendente');
      // o valor lido antes da escrita nao vale mais
      expect(await repo.atualizarComandoSe(comando.id, { status: 'pendente', atualizado_em: lido }, { status: 'aceito' })).toBeNull();
    });
    it('atualizarComandoSe concorrente com o mesmo atualizado_em: so uma aplica', async () => {
      const { comando } = await novo();
      const lido = (await repo.reivindicarComando(comando.id))!.atualizado_em;
      const r = await Promise.all([1, 2, 3].map(() =>
        repo.atualizarComandoSe(comando.id, { status: 'enviado', atualizado_em: lido }, { status: 'pendente' })));
      expect(r.filter((x) => x !== null)).toHaveLength(1);
    });
    it('listarComandosEnviadosAntigos so traz enviado anterior ao limite', async () => {
      const { comando } = await novo();
      const t = { atualizado_em: (await repo.reivindicarComando(comando.id))!.atualizado_em };
      const antigos = async (limite: string) => meus(await repo.listarComandosEnviadosAntigos(limite)).map((c) => c.id);
      expect(await antigos(t.atualizado_em)).toEqual([]); // estritamente anterior
      expect(await antigos(new Date(new Date(t.atualizado_em).getTime() + 1).toISOString())).toEqual([comando.id]);
    });
    it('listarRecargasComEstornoPendente traz failed/canceled marcadas', async () => {
      const minhas = async () => (await repo.listarRecargasComEstornoPendente()).filter((r) => r.id === recarga.id).map((r) => r.id);
      await repo.atualizarRecarga(recarga.id, { metadata: { estorno_total_pendente: true } });
      expect(await minhas()).toEqual([]); // ainda paid
      await repo.atualizarRecarga(recarga.id, { status: 'failed', metadata: { estorno_total_pendente: true } });
      expect(await minhas()).toEqual([recarga.id]);
      await repo.atualizarRecarga(recarga.id, { metadata: { estorno_total_pendente: false } });
      expect(await minhas()).toEqual([]);
    });
  });

  describe('log de mensagens e alertas', () => {
    it('guarda frames na ordem', async () => {
      const x = 'X-' + aleatorio();
      await repo.logMensagem({ carregador_id: cp.id, ocpp_id: x, direcao: 'entrada', tipo: 2, unique_id: 'a', acao: 'Heartbeat', payload: {} });
      await repo.logMensagem({ carregador_id: null, ocpp_id: x, direcao: 'saida', tipo: null, unique_id: null, acao: null, payload: null });
      const l = await m.mensagens(x);
      expect(l.map((f) => f.direcao)).toEqual(['entrada', 'saida']);
      expect(l[0]).toMatchObject({ tipo: 2, unique_id: 'a', acao: 'Heartbeat', payload: {}, carregador_id: cp.id });
      expect(l[1]).toMatchObject({ tipo: null, carregador_id: null, payload: null });
    });
    it('alertar guarda o alerta e recusa carregador inexistente', async () => {
      await repo.alertar({ carregador_id: cp.id, connector_id: 1, tipo: 'conector_falha_grave', mensagem: 'x', dados: { error_code: 'GroundFailure' } });
      const l = await m.alertas(cp.id);
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ tipo: 'conector_falha_grave', mensagem: 'x', connector_id: 1 });
      await expect(repo.alertar({ carregador_id: '00000000-0000-4000-8000-000000000000', connector_id: null, tipo: 't', mensagem: 'm' }))
        .rejects.toThrow();
    });
  });
}
