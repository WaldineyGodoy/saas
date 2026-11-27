import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarRegime } from './regimeConsumo.js';

const CASO_REAL = [
    { mes: '2026-08', kwh: 4334, dias: 30 },
    { mes: '2026-07', kwh: 869, dias: 33 },
    { mes: '2026-06', kwh: 329, dias: 29 },
    { mes: '2026-05', kwh: 100, dias: 20 },
];

test('classificarRegime: caso real: em rampa, franquia de rampa 3467', () => {
    const r = classificarRegime(CASO_REAL);
    assert.equal(r.regime, 'em_rampa');
    assert.equal(r.n, 4);
    assert.equal(Math.round(r.cUlt), 4334);
    assert.equal(r.franquiaRampa, 3467);
    assert.equal(r.franquiaJanela, 790);
});

test('classificarRegime: um mês só: insuficiente', () => {
    const r = classificarRegime([{ mes: '2026-08', kwh: 500, dias: 30 }]);
    assert.equal(r.regime, 'insuficiente');
    assert.equal(r.franquiaRampa, null);
});

test('classificarRegime: doze meses estáveis: estavel', () => {
    const h = Array.from({ length: 12 }, (_, i) => ({ mes: `2025-${String(i + 1).padStart(2, '0')}`, kwh: 1000 + (i % 3) * 20, dias: 30 }));
    assert.equal(classificarRegime(h).regime, 'estavel');
});

test('classificarRegime: crescimento que parou (último ≈ penúltimo): estavel', () => {
    const h = [...CASO_REAL, { mes: '2026-09', kwh: 4400, dias: 30 }];
    const r = classificarRegime(h);
    assert.equal(r.regime, 'estavel');
    assert.equal(r.franquiaJanela, 4334);
});

test('classificarRegime: queda forte: em_queda, janela dos 3 últimos', () => {
    const h = [
        { mes: '2026-05', kwh: 3000, dias: 30 }, { mes: '2026-06', kwh: 3100, dias: 30 },
        { mes: '2026-07', kwh: 2900, dias: 30 }, { mes: '2026-08', kwh: 800, dias: 30 },
    ];
    const r = classificarRegime(h);
    assert.equal(r.regime, 'em_queda');
    assert.equal(r.franquiaJanela, 2900);
});

test('classificarRegime: sem dias usa o kWh como está', () => {
    const h = [{ mes: '2026-06', kwh: 100 }, { mes: '2026-07', kwh: 300 }, { mes: '2026-08', kwh: 900 }];
    const r = classificarRegime(h);
    assert.equal(r.regime, 'em_rampa');
    assert.equal(r.cUlt, 900);
});

test('classificarRegime: mais de 6 meses nunca é rampa', () => {
    const h = [100, 120, 150, 200, 300, 500, 2000].map((kwh, i) => ({ mes: `2026-0${i + 1}`, kwh, dias: 30 }));
    assert.notEqual(classificarRegime(h).regime, 'em_rampa');
});

test('classificarRegime: mesmo mês do calendário em anos diferentes: vale a leitura mais recente', () => {
    const h = [{ mes: '2025-08', kwh: 100, dias: 30 }, { mes: '2026-08', kwh: 4334, dias: 30 }];
    const r = classificarRegime(h);
    assert.equal(r.n, 1);
    assert.equal(r.regime, 'insuficiente');
});
