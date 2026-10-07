import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({ supabase: {} }));

const { comAvisoSemBoleto } = await import('../src/lib/api');

describe('comAvisoSemBoleto (20261006a)', () => {
    it('ciclo quitado pelo crédito: sem boleto, com aviso', () => {
        const r = comAvisoSemBoleto({ success: true, quitado_por_credito: true, credito: { aplicado: 80 } });
        expect(r.semBoleto).toBe(true);
        expect(r.mensagem).toMatch(/quitada inteira pelo crédito/);
    });

    it('ciclo abaixo de R$ 5,00: adiado para a próxima fatura', () => {
        const r = comAvisoSemBoleto({ success: true, adiada: true, valor: 3.5 });
        expect(r.semBoleto).toBe(true);
        expect(r.mensagem).toMatch(/R\$\s?3,50/);
        expect(r.mensagem).toMatch(/próxima fatura/);
    });

    it('boleto com crédito abatido: segue normal e avisa o valor', () => {
        const r = comAvisoSemBoleto({ success: true, url: 'https://x', credito: { aplicado: 12.4 } });
        expect(r.semBoleto).toBeUndefined();
        expect(r.url).toBe('https://x');
        expect(r.mensagem).toMatch(/R\$\s?12,40/);
    });

    it('boleto sem crédito: resposta intocada', () => {
        const original = { success: true, url: 'https://x', credito: { aplicado: 0 } };
        expect(comAvisoSemBoleto(original)).toBe(original);
    });
});
