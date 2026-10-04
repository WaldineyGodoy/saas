import { describe, it, expect } from 'vitest';
import { proximoAtrasoMs } from '../../src/domain/backoff.js';

describe('proximoAtrasoMs', () => {
  it('2s, 4s, 8s e depois expira', () => {
    expect(proximoAtrasoMs(1)).toBe(2000);
    expect(proximoAtrasoMs(2)).toBe(4000);
    expect(proximoAtrasoMs(3)).toBe(8000);
    expect(proximoAtrasoMs(4)).toBeNull();
  });
});
