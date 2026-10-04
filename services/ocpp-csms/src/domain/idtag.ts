import { randomBytes } from 'node:crypto';

// idTag de uso unico por recarga: "RC" + 18 chars base32 = 20 (CiString20Type).
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function gerarIdTag(): string {
  const bytes = randomBytes(18);
  let s = 'RC';
  // 32 simbolos dividem 256 igualmente: sem vies no modulo
  for (const b of bytes) s += ALFABETO[b % 32];
  return s;
}
