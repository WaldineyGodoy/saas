import { describe, expect, it } from 'vitest';
import { maskPhoneDdi, normalizePhoneDdi, validatePhoneDdi } from '../src/lib/validators';

// O lead é gravado com DDI: o portão da página das usinas (usina-acesso)
// procura o lead pelo número exato com o 55.
describe('telefone do lead com DDI', () => {
    it('aceita o número digitado com DDI e grava só os dígitos', () => {
        expect(validatePhoneDdi('55 84 99999-9999')).toBe(true);
        expect(validatePhoneDdi('+55 (84) 99999-9999')).toBe(true);
        expect(normalizePhoneDdi('+55 (84) 99999-9999')).toBe('5584999999999');
    });

    it('sem DDI, entra o 55', () => {
        expect(validatePhoneDdi('(84) 99999-9999')).toBe(true);
        expect(normalizePhoneDdi('(84) 99999-9999')).toBe('5584999999999');
    });

    it('DDD 55 sem DDI não é confundido com o DDI', () => {
        expect(normalizePhoneDdi('55 99999-9999')).toBe('5555999999999');
    });

    it('lead já gravado com 55 volta a salvar', () => {
        expect(validatePhoneDdi('5511910767844')).toBe(true);
        expect(normalizePhoneDdi('5511910767844')).toBe('5511910767844');
    });

    it('aceita fixo brasileiro, com ou sem DDI', () => {
        expect(normalizePhoneDdi('(84) 3333-3333')).toBe('558433333333');
        expect(validatePhoneDdi('558433333333')).toBe(true);
    });

    it('aceita DDI de outro país', () => {
        // Investidor do México já cadastrado pela página das usinas.
        expect(validatePhoneDdi('+52 1 55 1234 5678')).toBe(true);
        expect(normalizePhoneDdi('+52 1 55 1234 5678')).toBe('5215512345678');
    });

    it('recusa número curto ou longo demais', () => {
        expect(validatePhoneDdi('9999-9999')).toBe(false);
        expect(validatePhoneDdi('55 84 99999-99999')).toBe(false);
        expect(validatePhoneDdi('1234567890123456')).toBe(false);
        expect(validatePhoneDdi('')).toBe(false);
    });

    it('mostra o número no padrão +DDI (DDD) número', () => {
        expect(maskPhoneDdi('5584999999999')).toBe('+55 (84) 99999-9999');
        expect(maskPhoneDdi('84999999999')).toBe('+55 (84) 99999-9999');
        expect(maskPhoneDdi('558433333333')).toBe('+55 (84) 3333-3333');
        expect(maskPhoneDdi('5215512345678')).toBe('+5215512345678');
        expect(maskPhoneDdi('123')).toBe('123');
    });
});
