import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
  },
}));

const tokens = await import('../../theme/tokens');
const { alternarEsquema, aplicarEsquema, colors, configurarTipografia, ESQUEMAS, fonts, resolverFontes } = tokens;

describe('tokens (3 variações de visualização)', () => {
  it('lista as 3 variações: Blue, Light e Dark', () => {
    expect(ESQUEMAS.map((e) => e.id)).toEqual(['blue', 'light', 'dark']);
  });

  it('aplica a paleta Blue (azul-marinho original)', () => {
    aplicarEsquema('blue');
    expect(tokens.esquemaAtual).toBe('blue');
    expect(colors.background).toBe('#070A1E');
    expect(colors.surface).toBe('#0F1226');
    expect(colors.surfaceLowest).toBe('#090D21');
    expect(colors.primary).toBe('#F26B00');
  });

  it('aplica a paleta Light com as cores especificadas', () => {
    aplicarEsquema('light');
    expect(tokens.esquemaAtual).toBe('light');
    expect(colors.background).toBe('#F8F8F8');
    expect(colors.surface).toBe('#F8F8F8');
    expect(colors.surfaceLowest).toBe('#EEEEEE');
    expect(colors.onSurface).toBe('#1A1A1A');
    expect(colors.inkSecondary).toBe('#222222');
    expect(colors.iconPrimary).toBe('#1A1A1A');
    expect(colors.searchIcon).toBe('#1A1A1A');
    expect(colors.placeholder).toBe('#757575');
    expect(colors.tabBarBorder).toBe('#E0E0E0');
    expect(colors.centerOrbStart).toBe('#002244');
    expect(colors.centerOrbEnd).toBe('#0A58CA');
  });

  it('aplica a paleta Dark com as cores especificadas', () => {
    aplicarEsquema('dark');
    expect(tokens.esquemaAtual).toBe('dark');
    expect(colors.background).toBe('#121212');
    expect(colors.surface).toBe('#121212');
    expect(colors.surfaceLowest).toBe('#1C1C1E');
    expect(colors.onSurface).toBe('#FFFFFF');
    expect(colors.iconPrimary).toBe('#FFFFFF');
    expect(colors.placeholder).toBe('#8E8E93');
    expect(colors.searchIcon).toBe('#8E8E93');
    expect(colors.inkSecondary).toBe('#8E8E93');
    expect(colors.centerOrbStart).toBe('#002244');
    expect(colors.centerOrbEnd).toBe('#0A58CA');
  });

  it('alterna ciclicamente entre Blue -> Light -> Dark -> Blue', () => {
    aplicarEsquema('blue');
    alternarEsquema();
    expect(tokens.esquemaAtual).toBe('light');
    alternarEsquema();
    expect(tokens.esquemaAtual).toBe('dark');
    alternarEsquema();
    expect(tokens.esquemaAtual).toBe('blue');
  });

  it('configura a tipografia V7.2 com Inter e fallbacks nativos SF Pro (iOS) e Roboto (Android)', () => {
    configurarTipografia('ios', true);
    expect(fonts.display).toBe('Inter_800ExtraBold');
    expect(fonts.headline).toBe('Inter_700Bold');
    expect(fonts.body).toBe('Inter_400Regular');
    expect(fonts.bodyMedium).toBe('Inter_500Medium');
    expect(fonts.bodySemi).toBe('Inter_600SemiBold');

    // Fallback nativo iOS quando Inter não carrega
    configurarTipografia('ios', false);
    expect(fonts.display).toBe('SF Pro Display');
    expect(fonts.headline).toBe('SF Pro Display');
    expect(fonts.body).toBe('SF Pro Text');
    expect(fonts.mono).toBe('SF Pro Text');

    // Fallback nativo Android quando Inter não carrega
    configurarTipografia('android', false);
    expect(fonts.display).toBe('Roboto');
    expect(fonts.headline).toBe('Roboto');
    expect(fonts.body).toBe('Roboto');

    // Web stack com Inter + SF Pro + Roboto
    const web = resolverFontes('web', true);
    expect(web.display).toContain('Inter');
    expect(web.display).toContain('SF Pro Display');
    expect(web.body).toContain('SF Pro Text');
    expect(web.body).toContain('Roboto');
  });
});
