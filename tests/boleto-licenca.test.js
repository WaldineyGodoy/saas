import { describe, it, expect } from 'vitest';
import { situacaoBoleto } from '../src/lib/boletoLicenca';

const hoje = new Date(2026, 10, 14); // 14/11/2026
const base = { licenca_preco: 500, licenca_valor: 500, licenca_paga_em: null, licenca_vencimento: null };

describe('boleto da licença: quando gerar', () => {
    it('cargo isento ou voucher de isenção total não geram boleto', () => {
        expect(situacaoBoleto({ originator: { ...base, licenca_preco: 0, licenca_valor: 0 }, hoje }).podeGerar).toBe(false);
        expect(situacaoBoleto({ originator: { ...base, licenca_valor: 0 }, hoje }).texto).toMatch(/voucher/);
    });

    it('sem pagamento: adesão; com desconto o boleto é do valor já descontado', () => {
        expect(situacaoBoleto({ originator: { ...base, licenca_valor: 250 }, hoje })).toMatchObject({ podeGerar: true, tipo: 'adesao' });
    });

    it('vencida volta a ser adesão', () => {
        expect(situacaoBoleto({ originator: { ...base, licenca_paga_em: '2025-11-01', licenca_vencimento: '2026-11-01' }, hoje }))
            .toMatchObject({ podeGerar: true, tipo: 'adesao' });
    });

    it('em dia: renovação só nos 30 dias antes do fim', () => {
        expect(situacaoBoleto({ originator: { ...base, licenca_paga_em: '2026-11-01', licenca_vencimento: '2027-11-01' }, hoje }).podeGerar).toBe(false);
        expect(situacaoBoleto({ originator: { ...base, licenca_paga_em: '2025-12-10', licenca_vencimento: '2026-12-10' }, hoje }))
            .toMatchObject({ podeGerar: true, tipo: 'renovacao' });
    });

    it('nunca com boleto em aberto', () => {
        expect(situacaoBoleto({ originator: base, cobrancas: [{ status: 'vencido' }], hoje }).podeGerar).toBe(false);
        expect(situacaoBoleto({ originator: base, cobrancas: [{ status: 'cancelado' }], hoje }).podeGerar).toBe(true);
    });
});
