import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORIGENS_HISTORICO } from './historicoConsumo.js';

test('tem rotulo para a origem rampa', () => {
    assert.equal(ORIGENS_HISTORICO.rampa, 'Preenchido pela rampa');
});
