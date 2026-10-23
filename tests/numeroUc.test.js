import { describe, expect, it } from 'vitest';
import { formatarNumeroUc, soDigitosUc } from '../src/lib/numeroUc';

describe('numero da UC', () => {
    it('guarda só dígitos', () => {
        expect(soDigitosUc('2.015.420.032-17')).toBe('201542003217');
        expect(soDigitosUc(' 7030765391 ')).toBe('7030765391');
        expect(soDigitosUc(null)).toBe('');
    });

    it('pontua só o padrão de 12 dígitos', () => {
        expect(formatarNumeroUc('201542003217')).toBe('2.015.420.032-17');
        expect(formatarNumeroUc('2.157.563.032-89')).toBe('2.157.563.032-89');
        expect(formatarNumeroUc('7030765391')).toBe('7030765391');
        expect(formatarNumeroUc('2015')).toBe('2015');
    });
});
