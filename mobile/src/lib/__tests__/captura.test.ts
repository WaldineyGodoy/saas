import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-file-system', () => ({ File: class {} }));
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
vi.mock('expo-image-picker', () => ({}));
vi.mock('../dialogo', () => ({ avisar: () => {} }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
const { base64DaUri, bytesDoBase64, bytesParaBase64 } = await import('../captura');

describe('bytesDoBase64', () => {
  it('decodifica o base64 do arquivo', () => {
    expect(Array.from(bytesDoBase64('JVBERg=='))).toEqual([0x25, 0x50, 0x44, 0x46]); // %PDF
    expect(bytesDoBase64('').length).toBe(0);
  });
});

describe('arquivo do navegador', () => {
  it('le o base64 de uma data: URL', () => {
    expect(base64DaUri('data:application/pdf;base64,JVBERg==')).toBe('JVBERg==');
    expect(base64DaUri('blob:https://x/abc')).toBeNull();
    expect(base64DaUri(undefined)).toBeNull();
  });
  it('bytes e base64 vao e voltam, inclusive arquivo grande', () => {
    const grande = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(Array.from(bytesDoBase64(bytesParaBase64(grande)).slice(0, 5))).toEqual([0, 1, 2, 3, 4]);
    expect(bytesDoBase64(bytesParaBase64(grande)).length).toBe(200_000);
  });
});
