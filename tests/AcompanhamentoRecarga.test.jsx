import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import AcompanhamentoRecarga from '../src/pages/public/AcompanhamentoRecarga';

// Mesma normalização do teste do ChargingCheckout (React 19 SSR emite <!-- -->)
const render = (ui) => renderToString(ui).replace(/<!-- -->/g, '');

const base = {
  status: 'paid',
  kwh_estimado: 23.26,
  kwh_consumido: 0,
  valor: 50,
  valor_final: null,
  valor_estornado: null,
  conector_numero: 1,
  nome_posto: 'Posto B2W Shopping Sul',
  tarifa_kwh_aplicada: 2.15,
};

describe('AcompanhamentoRecarga (estados da recarga ao vivo, spec §5.4)', () => {
  it.each(['paid', 'starting'])('status %s pede para conectar o cabo e não oferece parar', (status) => {
    const html = render(<AcompanhamentoRecarga recarga={{ ...base, status }} onParar={vi.fn()} />);
    expect(html).toContain('Conecte o cabo ao veículo');
    expect(html).toContain('Conector 1');
    expect(html).not.toContain('Parar recarga');
  });

  it('charging mostra kWh e R$ (kWh x tarifa da recarga) e o botão Parar recarga', () => {
    const html = render(
      <AcompanhamentoRecarga recarga={{ ...base, status: 'charging', kwh_consumido: 3.4 }} onParar={vi.fn()} />,
    );
    expect(html).toContain('Carregando');
    expect(html).toContain('3,40 kWh');
    expect(html).toContain('R$ 7,31'); // 3,4 x 2,15
    expect(html).toContain('Parar recarga');
  });

  it('charging sem medição ainda mostra zero, não NaN', () => {
    const html = render(
      <AcompanhamentoRecarga recarga={{ ...base, status: 'charging', kwh_consumido: null }} onParar={vi.fn()} />,
    );
    expect(html).toContain('0,00 kWh');
    expect(html).toContain('R$ 0,00');
    expect(html).not.toContain('NaN');
  });

  it('charging sem tarifa na recarga não inventa preço (sem fallback)', () => {
    const html = render(
      <AcompanhamentoRecarga
        recarga={{ ...base, status: 'charging', kwh_consumido: 3.4, tarifa_kwh_aplicada: null }}
        onParar={vi.fn()}
      />,
    );
    expect(html).toContain('3,40 kWh');
    expect(html).not.toContain('R$ 7,31');
    expect(html).toContain('R$ --');
  });

  it('parando desabilita o botão e avisa; erro do stop-charging aparece como alerta', () => {
    const html = render(
      <AcompanhamentoRecarga
        recarga={{ ...base, status: 'charging', kwh_consumido: 1 }}
        onParar={vi.fn()}
        parando
        erro="Sem permissão para parar esta recarga."
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="parar-recarga"|<button[^>]*data-testid="parar-recarga"[^>]*disabled/);
    expect(html).toContain('Parando');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Sem permissão para parar esta recarga.');
  });

  it('charging sem prova de posse (sem onParar) não mostra o botão Parar recarga', () => {
    const html = render(<AcompanhamentoRecarga recarga={{ ...base, status: 'charging', kwh_consumido: 1 }} />);
    expect(html).toContain('Carregando');
    expect(html).not.toContain('Parar recarga');
  });

  it('completed mostra o resumo com valor_final e valor_estornado', () => {
    const html = render(
      <AcompanhamentoRecarga
        recarga={{ ...base, status: 'completed', kwh_consumido: 10, valor_final: 21.5, valor_estornado: 28.5 }}
        onParar={vi.fn()}
      />,
    );
    expect(html).toContain('Recarga concluída');
    expect(html).toContain('10,00 kWh');
    expect(html).toContain('R$ 21,50');
    expect(html).toContain('R$ 28,50');
    expect(html).toContain('estornado');
    expect(html).not.toContain('Parar recarga');
  });

  it('completed sem sobra para estornar não mostra linha de estorno zerada', () => {
    const html = render(
      <AcompanhamentoRecarga
        recarga={{ ...base, status: 'completed', kwh_consumido: 23.26, valor_final: 50, valor_estornado: 0 }}
        onParar={vi.fn()}
      />,
    );
    expect(html).toContain('R$ 50,00');
    expect(html).not.toContain('Valor estornado');
  });

  it.each(['failed', 'canceled'])('status %s informa o estorno total do valor pago', (status) => {
    const html = render(<AcompanhamentoRecarga recarga={{ ...base, status }} onParar={vi.fn()} />);
    expect(html).toContain('estornado integralmente');
    expect(html).toContain('R$ 50,00');
    expect(html).not.toContain('Parar recarga');
  });

  it('sem leitura ainda (recarga null) mostra aguardando confirmação', () => {
    const html = render(<AcompanhamentoRecarga recarga={null} onParar={vi.fn()} />);
    expect(html).toContain('Confirmando pagamento');
  });
});
