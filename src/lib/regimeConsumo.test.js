import { describe, it, expect } from 'vitest';
import { classificarRegime } from './regimeConsumo';

const CASO_REAL = [
    { mes: '2026-08', kwh: 4334, dias: 30 },
    { mes: '2026-07', kwh: 869, dias: 33 },
    { mes: '2026-06', kwh: 329, dias: 29 },
    { mes: '2026-05', kwh: 100, dias: 20 },
];

describe('classificarRegime', () => {
    it('caso real: em rampa, franquia de rampa 3467', () => {
        const r = classificarRegime(CASO_REAL);
        expect(r.regime).toBe('em_rampa');
        expect(r.n).toBe(4);
        expect(Math.round(r.cUlt)).toBe(4334);
        expect(r.franquiaRampa).toBe(3467);
        expect(r.franquiaJanela).toBe(790);
    });

    it('um mês só: insuficiente', () => {
        const r = classificarRegime([{ mes: '2026-08', kwh: 500, dias: 30 }]);
        expect(r.regime).toBe('insuficiente');
        expect(r.franquiaRampa).toBeNull();
    });

    it('doze meses estáveis: estavel', () => {
        const h = Array.from({ length: 12 }, (_, i) => ({ mes: `2025-${String(i + 1).padStart(2, '0')}`, kwh: 1000 + (i % 3) * 20, dias: 30 }));
        expect(classificarRegime(h).regime).toBe('estavel');
    });

    it('crescimento que parou (último ≈ penúltimo): estavel', () => {
        const h = [...CASO_REAL, { mes: '2026-09', kwh: 4400, dias: 30 }];
        const r = classificarRegime(h);
        expect(r.regime).toBe('estavel');
        expect(r.franquiaJanela).toBe(4334);
    });

    it('queda forte: em_queda, janela dos 3 últimos', () => {
        const h = [
            { mes: '2026-05', kwh: 3000, dias: 30 }, { mes: '2026-06', kwh: 3100, dias: 30 },
            { mes: '2026-07', kwh: 2900, dias: 30 }, { mes: '2026-08', kwh: 800, dias: 30 },
        ];
        const r = classificarRegime(h);
        expect(r.regime).toBe('em_queda');
        expect(r.franquiaJanela).toBe(2900);
    });

    it('sem dias usa o kWh como está', () => {
        const h = [{ mes: '2026-06', kwh: 100 }, { mes: '2026-07', kwh: 300 }, { mes: '2026-08', kwh: 900 }];
        const r = classificarRegime(h);
        expect(r.regime).toBe('em_rampa');
        expect(r.cUlt).toBe(900);
    });

    it('mais de 6 meses nunca é rampa', () => {
        const h = [100, 120, 150, 200, 300, 500, 2000].map((kwh, i) => ({ mes: `2026-0${i + 1}`, kwh, dias: 30 }));
        expect(classificarRegime(h).regime).not.toBe('em_rampa');
    });

    it('mesmo mês do calendário em anos diferentes: vale a leitura mais recente', () => {
        const h = [{ mes: '2025-08', kwh: 100, dias: 30 }, { mes: '2026-08', kwh: 4334, dias: 30 }];
        const r = classificarRegime(h);
        expect(r.n).toBe(1);
        expect(r.regime).toBe('insuficiente');
    });
});
