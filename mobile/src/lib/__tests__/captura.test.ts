import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-file-system', () => ({ File: class {} }));
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
vi.mock('expo-image-picker', () => ({}));
vi.mock('../dialogo', () => ({ avisar: () => {} }));
const { bytesDoBase64 } = await import('../captura');

describe('bytesDoBase64', () => {
  it('decodifica o base64 do arquivo', () => {
    expect(Array.from(bytesDoBase64('JVBERg=='))).toEqual([0x25, 0x50, 0x44, 0x46]); // %PDF
    expect(bytesDoBase64('').length).toBe(0);
  });
});
