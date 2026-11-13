import { describe, it, expect } from 'vitest';
import {
    normalizarLicencaConfig,
    validarLicencaConfig,
    precoLicenca,
    descontoVoucher,
    vencimentoLicenca,
    resumoLicenca,
    problemaVoucher,
    validarVoucher,
    payloadVoucher
} from '../src/lib/licencaOriginador';

const plano = { id: 'p1', licenca_config: { lider: 1000, ppe: 0, ppp: '500', ppf: null } };
const hoje = new Date(2026, 10, 13); // 13/11/2026

describe('licença do originador', () => {
    it('preço por cargo vem do plano; ausente ou inválido = 0', () => {
        expect(normalizarLicencaConfig(plano.licenca_config)).toEqual({ lider: 1000, ppe: 0, ppp: 500, ppf: 0 });
        expect(precoLicenca(plano, 'ppp')).toBe(500);
        expect(precoLicenca(null, 'ppp')).toBe(0);
        expect(validarLicencaConfig({ ppp: '-1' })).toHaveLength(1);
        expect(validarLicencaConfig({ ppp: '199,90', ppf: '' })).toEqual([]);
    });

    it('desconto do voucher nunca passa do preço', () => {
        expect(descontoVoucher(500, { tipo: 'percentual', valor: 50 })).toBe(250);
        expect(descontoVoucher(500, { tipo: 'valor', valor: 800 })).toBe(500);
        expect(descontoVoucher(500, { tipo: 'isencao', valor: 0 })).toBe(500);
        expect(descontoVoucher(0, { tipo: 'isencao' })).toBe(0);
    });

    it('vence 1 ano depois do pagamento', () => {
        expect(vencimentoLicenca('2026-11-13')).toBe('2027-11-13');
        expect(vencimentoLicenca('2028-02-29')).toBe('2029-02-28');
        expect(vencimentoLicenca(null)).toBeNull();
    });

    it('sem pagamento = aguardando; pago = ativa; mais de 1 ano = vencida', () => {
        expect(resumoLicenca({ plano, cargo: 'ppp', hoje })).toMatchObject({ preco: 500, valor: 500, status: 'pendente', emDia: false, vencimento: null });
        expect(resumoLicenca({ plano, cargo: 'ppp', pagaEm: '2026-11-01', hoje })).toMatchObject({ status: 'ativa', vencimento: '2027-11-01', emDia: true });
        expect(resumoLicenca({ plano, cargo: 'ppp', pagaEm: '2025-11-12', hoje })).toMatchObject({ status: 'vencida', emDia: false });
        expect(resumoLicenca({ plano, cargo: 'ppp', pagaEm: '2025-11-13', hoje })).toMatchObject({ status: 'ativa', vencimento: '2026-11-13' });
    });

    it('cargo sem preço é isento; voucher que zera ativa no dia', () => {
        expect(resumoLicenca({ plano, cargo: 'ppe', hoje })).toMatchObject({ status: 'isenta', emDia: true });
        expect(resumoLicenca({ plano, cargo: 'ppp', voucher: { tipo: 'isencao' }, hoje }))
            .toMatchObject({ valor: 0, pagaEm: '2026-11-13', vencimento: '2027-11-13', status: 'ativa' });
    });

    it('voucher recusado como no banco', () => {
        const v = { codigo: 'X', ativo: true, plano_originador_id: 'p1', validade: '2026-12-31', cargos: ['ppp'], limite_usos: 2 };
        expect(problemaVoucher(v, { planoId: 'p1', cargo: 'ppp', usos: 1, hoje })).toBeNull();
        expect(problemaVoucher(v, { planoId: 'p2', cargo: 'ppp', hoje })).toMatch(/não pertence/);
        expect(problemaVoucher(v, { planoId: 'p1', cargo: 'lider', hoje })).toMatch(/não vale/);
        expect(problemaVoucher(v, { planoId: 'p1', cargo: 'ppp', usos: 2, hoje })).toMatch(/limite/);
        expect(problemaVoucher({ ...v, validade: '2026-11-12' }, { planoId: 'p1', cargo: 'ppp', hoje })).toMatch(/venceu/);
        expect(problemaVoucher({ ...v, ativo: false }, { planoId: 'p1', cargo: 'ppp', hoje })).toMatch(/inativo/);
    });

    it('formulário de voucher', () => {
        expect(validarVoucher({ codigo: 'pro-50', tipo: 'percentual', valor: '50' })).toEqual([]);
        expect(validarVoucher({ codigo: 'a', tipo: 'percentual', valor: '150' })).toHaveLength(2);
        expect(validarVoucher({ codigo: 'ISENTO', tipo: 'isencao', limite_usos: '0' })).toHaveLength(1);
        expect(payloadVoucher({ codigo: ' pro-50 ', tipo: 'percentual', valor: '50', cargos: ['lider', 'ppe', 'ppp', 'ppf'], limite_usos: '' }, 'p1'))
            .toMatchObject({ codigo: 'PRO-50', valor: 50, cargos: null, limite_usos: null, plano_originador_id: 'p1', ativo: true });
    });
});
