import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getStripe,
  fetchEletroposto,
  listEletropostos,
  tarifaDoPosto,
  createChargingCheckoutSession,
  buscarRecargaPublica,
  acompanharRecarga,
  statusPagamentoDaRecarga,
  pararRecarga,
} from '../src/services/stripeChargingService';
import { supabase } from '../src/lib/supabase';
import { loadStripe } from '@stripe/stripe-js';

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn((pk) => Promise.resolve({ pk, _mockStripe: true })),
}));

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe('stripeChargingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStripe', () => {
    it('carrega o Stripe e reutiliza a mesma Promise (singleton)', async () => {
      const stripe1 = getStripe();
      const stripe2 = getStripe();

      expect(stripe1).toBe(stripe2);
      expect(loadStripe).toHaveBeenCalledTimes(1);

      const resolved = await stripe1;
      expect(resolved._mockStripe).toBe(true);
      expect(resolved.pk).toContain('pk_test_');
    });
  });

  describe('fetchEletroposto (RPC publica fn_eletroposto_publico)', () => {
    it('retorna null se o id não for fornecido', async () => {
      expect(await fetchEletroposto(null)).toBeNull();
      expect(await fetchEletroposto(undefined)).toBeNull();
      expect(await fetchEletroposto('')).toBeNull();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('busca dados do eletroposto pela RPC (anon não lê a tabela)', async () => {
      const mockPosto = {
        id: 'posto-123',
        nome: 'Posto B2W Matriz',
        endereco: 'Av. Paulista, 1000',
        potencia_kw: 60,
        tipo_recarga: 'DC',
        qtd_carregadores: 4,
        tarifa_motorista_kwh: 2.15,
      };
      supabase.rpc.mockResolvedValue({ data: [mockPosto], error: null });

      const result = await fetchEletroposto('posto-123');

      expect(supabase.rpc).toHaveBeenCalledWith('fn_eletroposto_publico', { p_id: 'posto-123' });
      expect(supabase.from).not.toHaveBeenCalled();
      expect(result).toEqual(mockPosto);
    });

    it('posto inexistente ou fora de operação: null', async () => {
      supabase.rpc.mockResolvedValue({ data: [], error: null });
      expect(await fetchEletroposto('x')).toBeNull();
    });

    it('trata erro de banco e retorna null', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      supabase.rpc.mockResolvedValue({ data: null, error: new Error('Falha no banco') });

      expect(await fetchEletroposto('posto-invalido')).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('listEletropostos (RPC publica fn_eletropostos_publicos)', () => {
    it('retorna a lista de eletropostos com sucesso', async () => {
      const mockLista = [
        { id: '1', nome: 'Posto Alpha', potencia_kw: 30, tarifa_motorista_kwh: 2 },
        { id: '2', nome: 'Posto Beta', potencia_kw: 60, tarifa_motorista_kwh: null },
      ];
      supabase.rpc.mockResolvedValue({ data: mockLista, error: null });

      const result = await listEletropostos();

      expect(supabase.rpc).toHaveBeenCalledWith('fn_eletropostos_publicos');
      expect(supabase.from).not.toHaveBeenCalled();
      expect(result).toEqual(mockLista);
    });

    it('trata erro e retorna array vazio se falhar', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      supabase.rpc.mockResolvedValue({ data: null, error: new Error('Erro de conexão') });

      expect(await listEletropostos()).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('tarifaDoPosto (sem valor de reserva)', () => {
    it('devolve a tarifa do plano', () => {
      expect(tarifaDoPosto({ tarifa_motorista_kwh: '2.1500' })).toBe(2.15);
      expect(tarifaDoPosto({ tarifa_motorista_kwh: 1.99 })).toBe(1.99);
    });
    it.each([null, undefined, {}, { tarifa_motorista_kwh: null }, { tarifa_motorista_kwh: 0 }, { tarifa_motorista_kwh: 'x' }])(
      'sem tarifa (%j) devolve null, nunca um número padrão',
      (posto) => expect(tarifaDoPosto(posto)).toBeNull(),
    );
  });

  describe('createChargingCheckoutSession', () => {
    it('chama edge function com parâmetros esperados e retorna dados de sucesso', async () => {
      const mockSuccessResponse = {
        success: true,
        clientSecret: 'pi_test_secret_123',
        paymentIntentId: 'pi_test_123',
        recargaId: 'recarga-uuid-999',
        kwh_estimado: 23.26,
        tarifa_kwh: 2.15,
        nome_posto: 'Posto B2W Central',
      };

      supabase.functions.invoke.mockResolvedValue({
        data: mockSuccessResponse,
        error: null,
      });

      const params = {
        eletroposto_id: 'posto-123',
        conector_numero: 2,
        valor: 50,
        motorista: { nome: 'Carlos Silva', email: 'carlos@exemplo.com' },
      };

      const result = await createChargingCheckoutSession(params);

      expect(supabase.functions.invoke).toHaveBeenCalledWith('create-charging-checkout', {
        body: {
          eletroposto_id: 'posto-123',
          conector_numero: 2,
          valor: 50,
          motorista: { nome: 'Carlos Silva', email: 'carlos@exemplo.com' },
        },
      });
      expect(result).toEqual(mockSuccessResponse);
    });

    it('usa valores padrão caso conector_numero e motorista não sejam passados', async () => {
      supabase.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      await createChargingCheckoutSession({
        eletroposto_id: 'posto-abc',
        valor: 30,
      });

      expect(supabase.functions.invoke).toHaveBeenCalledWith('create-charging-checkout', {
        body: {
          eletroposto_id: 'posto-abc',
          conector_numero: 1,
          valor: 30,
          motorista: {},
        },
      });
    });

    it('lança erro quando a chamada da Edge Function falha na rede', async () => {
      supabase.functions.invoke.mockResolvedValue({
        data: null,
        error: new Error('Edge function timeout'),
      });

      await expect(
        createChargingCheckoutSession({ eletroposto_id: 'posto-123', valor: 50 })
      ).rejects.toThrow('Edge function timeout');
    });

    it('lança erro quando o retorno indica success: false com mensagem customizada', async () => {
      supabase.functions.invoke.mockResolvedValue({
        data: { success: false, error: 'O valor mínimo para recarga é de R$ 5,00.' },
        error: null,
      });

      await expect(
        createChargingCheckoutSession({ eletroposto_id: 'posto-123', valor: 2 })
      ).rejects.toThrow('O valor mínimo para recarga é de R$ 5,00.');
    });
  });

  describe('buscarRecargaPublica', () => {
    it('lê a recarga pela RPC fn_recarga_publica (anon não lê a tabela)', async () => {
      const linha = { status: 'paid', valor: 50, kwh_estimado: 23.26, nome_posto: 'Posto' };
      supabase.rpc.mockResolvedValue({ data: [linha], error: null });

      const result = await buscarRecargaPublica('recarga-1');

      expect(supabase.rpc).toHaveBeenCalledWith('fn_recarga_publica', { p_recarga_id: 'recarga-1' });
      expect(supabase.from).not.toHaveBeenCalled();
      expect(result).toEqual(linha);
    });

    it('devolve null quando a recarga não existe', async () => {
      supabase.rpc.mockResolvedValue({ data: [], error: null });
      expect(await buscarRecargaPublica('nao-existe')).toBeNull();
    });

    it('devolve null e registra o erro quando a RPC falha', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      supabase.rpc.mockResolvedValue({ data: null, error: new Error('rede') });

      expect(await buscarRecargaPublica('recarga-1')).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('não chama a RPC sem id', async () => {
      expect(await buscarRecargaPublica(null)).toBeNull();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('statusPagamentoDaRecarga', () => {
    it.each(['paid', 'starting', 'charging', 'completed'])('recarga %s → pagamento confirmado', (s) => {
      expect(statusPagamentoDaRecarga(s)).toBe('paid');
    });

    it.each(['pending_payment', 'failed', 'canceled', 'succeeded', undefined])('recarga %s → tela não muda', (s) => {
      expect(statusPagamentoDaRecarga(s)).toBeNull();
    });
  });

  describe('acompanharRecarga (polling de 3 s)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const respostas = (...status) => {
      for (const s of status) {
        supabase.rpc.mockResolvedValueOnce({ data: s ? [{ status: s }] : [], error: null });
      }
    };

    it('consulta na hora e depois a cada 3 s, entregando cada leitura', async () => {
      respostas('pending_payment', 'pending_payment', 'paid');
      const onDados = vi.fn();

      const parar = acompanharRecarga('recarga-1', onDados);
      await vi.advanceTimersByTimeAsync(0);
      expect(onDados).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2999);
      expect(supabase.rpc).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(onDados).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(3000);
      expect(onDados).toHaveBeenLastCalledWith({ status: 'paid' });
      parar();
    });

    it.each(['completed', 'failed', 'canceled'])('para sozinho no status terminal %s', async (terminal) => {
      respostas('paid', terminal);
      const onDados = vi.fn();

      acompanharRecarga('recarga-1', onDados);
      await vi.advanceTimersByTimeAsync(3000);
      expect(onDados).toHaveBeenLastCalledWith({ status: terminal });

      await vi.advanceTimersByTimeAsync(30000);
      expect(supabase.rpc).toHaveBeenCalledTimes(2);
    });

    it('para quando a função devolvida é chamada', async () => {
      supabase.rpc.mockResolvedValue({ data: [{ status: 'pending_payment' }], error: null });
      const parar = acompanharRecarga('recarga-1', vi.fn());
      await vi.advanceTimersByTimeAsync(0);
      parar();

      await vi.advanceTimersByTimeAsync(30000);
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it('não entrega leitura que chegou depois de parar', async () => {
      let resolver;
      supabase.rpc.mockReturnValueOnce(new Promise((r) => { resolver = r; }));
      const onDados = vi.fn();

      const parar = acompanharRecarga('recarga-1', onDados);
      parar();
      resolver({ data: [{ status: 'paid' }], error: null });
      await vi.advanceTimersByTimeAsync(0);

      expect(onDados).not.toHaveBeenCalled();
    });

    it('segue tentando quando uma leitura falha ou não acha a recarga', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      supabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('rede') });
      respostas(null, 'paid');
      const onDados = vi.fn();

      const parar = acompanharRecarga('recarga-1', onDados);
      await vi.advanceTimersByTimeAsync(6000);
      expect(onDados).toHaveBeenCalledTimes(1);
      expect(onDados).toHaveBeenCalledWith({ status: 'paid' });
      parar();
      console.error.mockRestore();
    });
  });
  describe('createChargingCheckoutSession recusa do conector (UI-01)', () => {
    it('propaga o motivo da recusa 409 no erro para a tela desabilitar o pagamento', async () => {
      supabase.functions.invoke.mockResolvedValue({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: { json: async () => ({ success: false, motivo: 'offline', error: 'O carregador esta offline no momento.' }) },
        },
      });

      const erro = await createChargingCheckoutSession({ eletroposto_id: 'p', valor: 30 }).catch((e) => e);
      expect(erro.message).toBe('O carregador esta offline no momento.');
      expect(erro.motivo).toBe('offline');
    });
  });

  describe('pararRecarga (stop-charging, UI-03)', () => {
    it('envia recarga_id e client_secret (prova de posse do motorista avulso)', async () => {
      supabase.functions.invoke.mockResolvedValue({ data: { success: true }, error: null });

      await expect(pararRecarga('rec-1', { clientSecret: 'pi_1_secret_x' })).resolves.toEqual({ success: true });
      expect(supabase.functions.invoke).toHaveBeenCalledWith('stop-charging', {
        body: { recarga_id: 'rec-1', client_secret: 'pi_1_secret_x' },
      });
    });

    it('sem client_secret (usuario logado) manda so o recarga_id', async () => {
      supabase.functions.invoke.mockResolvedValue({ data: { success: true }, error: null });

      await pararRecarga('rec-1');
      expect(supabase.functions.invoke).toHaveBeenCalledWith('stop-charging', { body: { recarga_id: 'rec-1' } });
    });

    it.each([
      [403, 'Sem permissao para parar esta recarga.'],
      [409, 'Esta recarga nao esta em andamento.'],
    ])('recusa %s do servidor vira erro com a mensagem do corpo', async (status, mensagem) => {
      supabase.functions.invoke.mockResolvedValue({
        data: null,
        error: { message: 'non-2xx', context: { status, json: async () => ({ success: false, error: mensagem }) } },
      });

      const erro = await pararRecarga('rec-1', { clientSecret: 's' }).catch((e) => e);
      expect(erro.message).toBe(mensagem);
      expect(erro.status).toBe(status);
    });

    it('lança com a mensagem do invoke quando o corpo não é legível', async () => {
      supabase.functions.invoke.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
      await expect(pararRecarga('rec-1')).rejects.toThrow('Failed to fetch');
    });

    it('sem recargaId não chama o servidor', async () => {
      await expect(pararRecarga(null)).rejects.toThrow();
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });
  });
});
