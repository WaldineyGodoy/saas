import { describe, it, expect } from 'vitest';
import { rotuloVisita } from '../src/lib/leadVisitas';

describe('rotuloVisita (20261006b)', () => {
    it('indicação de assinante com o parceiro dele', () => {
        const r = rotuloVisita({ meio: 'qr', aplicada: true, indicador: { name: 'Ana' }, originador: { name: 'Carlos' } });
        expect(r.titulo).toBe('Indicado por Ana (parceiro Carlos), via QR Code');
        expect(r.detalhe).toBeNull();
    });

    it('link só do parceiro', () => {
        expect(rotuloVisita({ meio: 'link', aplicada: true, originador: { name: 'Carlos' } }).titulo)
            .toBe('Link do parceiro Carlos, via link');
    });

    it('retorno sem link', () => {
        expect(rotuloVisita({ meio: 'organico', aplicada: true }).titulo).toBe('Simulou de novo, sem link (acesso direto)');
    });

    it('indicação que chegou depois do contrato fica marcada', () => {
        const r = rotuloVisita({ meio: 'link', aplicada: false, motivo: 'contrato_assinado', indicador: { name: 'Bia' } });
        expect(r.detalhe).toMatch(/contrato já estava assinado/);
    });
});
