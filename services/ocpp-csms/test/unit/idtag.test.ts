import { describe, it, expect } from 'vitest';
import { gerarIdTag } from '../../src/domain/idtag.js';

describe('gerarIdTag', () => {
  it('formato RC + 18 base32, 20 caracteres', () => {
    const t = gerarIdTag();
    expect(t).toMatch(/^RC[A-Z2-7]{18}$/);
    expect(t).toHaveLength(20);
  });
  it('10 000 geracoes sem colisao', () => {
    const s = new Set<string>();
    for (let i = 0; i < 10000; i++) s.add(gerarIdTag());
    expect(s.size).toBe(10000);
  });
});
