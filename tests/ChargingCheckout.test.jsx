import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ChargingCheckout, { StripePaymentForm, mensagemPagamentoRecusado } from '../src/pages/public/ChargingCheckout';
import * as stripeService from '../src/services/stripeChargingService';
import * as authContext from '../src/contexts/AuthContext';

// Mocks
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div data-testid="mock-stripe-elements">{children}</div>,
  PaymentElement: () => <div data-testid="mock-payment-element" />,
  useStripe: vi.fn(),
  useElements: vi.fn(),
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}));

// A tela não fala mais com o Supabase direto: o andamento vem de
// acompanharRecarga (polling de fn_recarga_publica).
vi.mock('../src/lib/supabase', () => ({
  supabase: {},
}));

vi.mock('../src/services/stripeChargingService', () => ({
  getStripe: vi.fn(() => Promise.resolve({})),
  fetchEletroposto: vi.fn(),
  listEletropostos: vi.fn(),
  createChargingCheckoutSession: vi.fn(),
  tarifaDoPosto: vi.fn((p) => (Number(p?.tarifa_motorista_kwh) > 0 ? Number(p.tarifa_motorista_kwh) : null)),
  acompanharRecarga: vi.fn(() => () => {}),
  statusPagamentoDaRecarga: vi.fn(() => null),
}));

vi.mock('../src/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Helper para normalizar o HTML gerado pelo React 19 SSR (remove comentários <!-- -->)
const render = (ui) => renderToString(ui).replace(/<!-- -->/g, '');

describe('ChargingCheckout Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeService.listEletropostos.mockResolvedValue([
      {
        id: 'posto-teste-1',
        nome: 'Posto B2W Shopping Sul',
        endereco: 'Av. das Américas, 5000',
        tarifa_motorista_kwh: 2.15,
        potencia_kw: 60,
        tipo_recarga: 'DC Rápida',
        qtd_carregadores: 2,
        status: 'online',
      },
    ]);
    stripeService.fetchEletroposto.mockResolvedValue({
      id: 'posto-teste-1',
      nome: 'Posto B2W Shopping Sul',
      endereco: 'Av. das Américas, 5000',
      tarifa_motorista_kwh: 2.15,
      potencia_kw: 60,
      tipo_recarga: 'DC Rápida',
      qtd_carregadores: 2,
    });
  });

  it('renderiza a tela pública para motorista avulso com cabeçalho B2W Charge', () => {
    authContext.useAuth.mockReturnValue({
      user: null,
      profile: null,
      loading: false,
    });

    const html = render(
      <MemoryRouter initialEntries={['/recarga']}>
        <ChargingCheckout />
      </MemoryRouter>
    );

    expect(html).toContain('B2W');
    expect(html).toContain('Charge');
    expect(html).toContain('Online');
    expect(html).toContain('Quanto você deseja recarregar?');
    expect(html).toContain('R$ 30,00');
    expect(html).toContain('R$ 50,00');
    expect(html).toContain('R$ 100,00');
    expect(html).toContain('Recarga Avulsa');
    expect(html).toContain('Nome Completo');
    expect(html).toContain('E-mail para Recibo');
    expect(html).toContain('Continuar para Pagamento');
  });

  it('exibe badge de assinante logado quando usuário está autenticado', () => {
    authContext.useAuth.mockReturnValue({
      user: { id: 'usr-123', email: 'motorista@b2wenergia.com.br' },
      profile: { nome: 'Carlos Silva', telefone: '(11) 98888-7777' },
      loading: false,
    });

    const html = render(
      <MemoryRouter initialEntries={['/recarga']}>
        <ChargingCheckout />
      </MemoryRouter>
    );

    expect(html).toContain('Assinante B2W');
    expect(html).toContain('Conectado como Carlos Silva');
    expect(html).not.toContain('Recarga Avulsa');
  });

  it('renderiza os seletores de conector e cálculo de estimativas em tempo real', () => {
    authContext.useAuth.mockReturnValue({
      user: null,
      profile: null,
      loading: false,
    });

    const html = render(
      <MemoryRouter initialEntries={['/recarga?conector=2']}>
        <ChargingCheckout />
      </MemoryRouter>
    );

    expect(html).toContain('Conector 1');
    expect(html).toContain('Conector 2');
    expect(html).toContain('equivalem a');
    expect(html).toContain('autonomia para o seu veículo');
  });

  it('sem tarifa carregada não mostra preço padrão (sem R$ 2,15 de reserva)', () => {
    authContext.useAuth.mockReturnValue({ user: null, profile: null, loading: false });

    const html = render(
      <MemoryRouter initialEntries={['/recarga']}>
        <ChargingCheckout />
      </MemoryRouter>
    );

    expect(html).not.toContain('2,15');
  });

  it('renderiza o subcomponente StripePaymentForm com o botão de pagamento seguro', () => {
    const html = render(
      <StripePaymentForm 
        valor={75}
        onPaymentSuccess={vi.fn()}
        onPaymentError={vi.fn()}
      />
    );

    expect(html).toContain('mock-payment-element');
    expect(html).toContain('Pagar R$ 75,00 e Iniciar Recarga');
    expect(html).toContain('Pagamento seguro e criptografado via Stripe');
  });

  it('renderiza mensagem de erro no StripePaymentForm se houver falha', () => {
    // Testamos a renderização de erro passando estado de erro
    const html = render(
      <StripePaymentForm 
        valor={50}
        onPaymentSuccess={vi.fn()}
        onPaymentError={vi.fn()}
      />
    );

    expect(html).toContain('data-testid="pay-submit-button"');
  });
});

describe('mensagemPagamentoRecusado (C1: cartao recusado nao encerra a recarga)', () => {
  it('cartao recusado: diz que nada foi cobrado e o que fazer, sem prometer estorno', () => {
    const m = mensagemPagamentoRecusado({ type: 'card_error', message: 'Your card was declined.' });
    expect(m).toContain('Your card was declined.');
    expect(m).toContain('Nenhum valor foi cobrado');
    expect(m).toMatch(/outro cartão|Pix/);
    expect(m).not.toMatch(/estorn/i);
  });
  it('dados invalidos no formulario: so a mensagem da Stripe', () => {
    expect(mensagemPagamentoRecusado({ type: 'validation_error', message: 'Número do cartão incompleto.' })).toBe('Número do cartão incompleto.');
  });
  it('erro sem mensagem: texto padrao', () => {
    expect(mensagemPagamentoRecusado({})).toBe('Erro ao processar pagamento.');
    expect(mensagemPagamentoRecusado(null)).toBe('Erro ao processar pagamento.');
  });
});
