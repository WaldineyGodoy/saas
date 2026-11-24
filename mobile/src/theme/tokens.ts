// Sistema de temas do app B2W Energia com 3 variações de visualização:
//   - 'blue':  Tema original azul-marinho ("B2W Energia Helios Sovereign")
//   - 'light': Tema claro (#F8F8F8 fundo, #EEEEEE cards/busca, #1A1A1A textos e ícones, #757575–#828282 muted)
//   - 'dark':  Tema escuro (#121212 fundo, #1C1C1E cards/busca, #FFFFFF textos e ícones, #8E8E93 muted)

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type Esquema = 'blue' | 'light' | 'dark';

export const ESQUEMAS: { id: Esquema; rotulo: string; resumo: string }[] = [
  { id: 'blue', rotulo: 'Blue', resumo: 'Azul-marinho original B2W' },
  { id: 'light', rotulo: 'Light', resumo: 'Tema claro' },
  { id: 'dark', rotulo: 'Dark', resumo: 'Tema escuro' },
];

type Paleta = {
  background: string; surface: string; surfaceLowest: string; surfaceLow: string; surfaceContainer: string;
  surfaceHigh: string; surfaceHighest: string;
  header: string; headerInk: string; headerAccent: string; headerChip: string; headerBorder: string;
  tabBar: string; tabBarBorder: string;
  centerOrbStart: string; centerOrbEnd: string; centerOrbIcon: string;
  onSurface: string; onSurfaceVariant: string; inkPrimary: string; inkSecondary: string; inkMuted: string;
  placeholder: string; searchIcon: string;
  iconPrimary: string; iconBoxBg: string | null; iconBoxBorder: string | null;
  outline: string; outlineVariant: string; borderSubtle: string; borderStrong: string;
  primary: string; primaryLight: string; primaryHover: string; onPrimary: string;
  secondary: string; tertiary: string; tertiaryContainer: string; navyAccent: string; navyDeep: string;
  accentSolar: string; accentEnergy: string; accentEv: string; accentConnect: string;
  error: string; statusVerified: string; statusWarning: string; statusCalculated: string; statusProvisional: string;
};

const blue: Paleta = {
  background: '#070A1E',
  surface: '#0F1226',
  surfaceLowest: '#090D21',
  surfaceLow: '#141830',
  surfaceContainer: '#1B203B',
  surfaceHigh: '#242A4A',
  surfaceHighest: '#2F365C',
  header: '#0B1124',
  headerInk: '#F8FAFC',
  headerAccent: '#10B981',
  headerChip: '#1E2544',
  headerBorder: 'rgba(255,255,255,0.08)',
  tabBar: '#0B1124',
  tabBarBorder: 'rgba(255,255,255,0.08)',
  centerOrbStart: '#002244',
  centerOrbEnd: '#0A58CA',
  centerOrbIcon: '#FFFFFF',
  onSurface: '#F1F5F9',
  onSurfaceVariant: '#94A3B8',
  inkPrimary: '#F8FAFC',
  inkSecondary: '#CBD5E1',
  inkMuted: '#7E8BA8',
  placeholder: '#7E8BA8',
  searchIcon: '#94A3B8',
  iconPrimary: '#F26B00',
  iconBoxBg: null,
  iconBoxBorder: null,
  outline: '#64748B',
  outlineVariant: '#334155',
  borderSubtle: '#1E2646',
  borderStrong: '#333D66',
  primary: '#F26B00',
  primaryLight: '#FF9B52',
  primaryHover: '#FF7B20',
  onPrimary: '#FFFFFF',
  secondary: '#E9C349',
  tertiary: '#2DD4BF',
  tertiaryContainer: '#0D9488',
  navyAccent: '#6481BF',
  navyDeep: '#031952',
  accentSolar: '#F59E0B',
  accentEnergy: '#38BDF8',
  accentEv: '#818CF8',
  accentConnect: '#2DD4BF',
  error: '#F87171',
  statusVerified: '#10B981',
  statusWarning: '#F59E0B',
  statusCalculated: '#38BDF8',
  statusProvisional: '#F87171',
};

const light: Paleta = {
  background: '#F8F8F8',
  surface: '#F8F8F8',
  surfaceLowest: '#EEEEEE',
  surfaceLow: '#E4E4E4',
  surfaceContainer: '#EEEEEE',
  surfaceHigh: '#E2E2E2',
  surfaceHighest: '#D6D6D6',
  header: '#F8F8F8',
  headerInk: '#1A1A1A',
  headerAccent: '#0A58CA',
  headerChip: '#EEEEEE',
  headerBorder: '#E0E0E0',
  tabBar: 'rgba(255, 255, 255, 0.88)',
  tabBarBorder: '#E0E0E0',
  centerOrbStart: '#002244',
  centerOrbEnd: '#0A58CA',
  centerOrbIcon: '#FFFFFF',
  onSurface: '#1A1A1A',
  onSurfaceVariant: '#757575',
  inkPrimary: '#1A1A1A',
  inkSecondary: '#222222',
  inkMuted: '#757575',
  placeholder: '#757575',
  searchIcon: '#1A1A1A',
  iconPrimary: '#1A1A1A',
  iconBoxBg: '#E2E2E2',
  iconBoxBorder: '#D4D4D4',
  outline: '#828282',
  outlineVariant: '#D0D0D0',
  borderSubtle: '#E0E0E0',
  borderStrong: '#CCCCCC',
  primary: '#0A58CA',
  primaryLight: '#002244',
  primaryHover: '#002244',
  onPrimary: '#FFFFFF',
  secondary: '#0A58CA',
  tertiary: '#1A1A1A',
  tertiaryContainer: '#222222',
  navyAccent: '#0A58CA',
  navyDeep: '#002244',
  accentSolar: '#1A1A1A',
  accentEnergy: '#1A1A1A',
  accentEv: '#1A1A1A',
  accentConnect: '#1A1A1A',
  error: '#DC2626',
  statusVerified: '#059669',
  statusWarning: '#D97706',
  statusCalculated: '#0A58CA',
  statusProvisional: '#DC2626',
};

const dark: Paleta = {
  background: '#121212',
  surface: '#121212',
  surfaceLowest: '#1C1C1E',
  surfaceLow: '#262629',
  surfaceContainer: '#1C1C1E',
  surfaceHigh: '#2C2C2E',
  surfaceHighest: '#3A3A3C',
  header: '#121212',
  headerInk: '#FFFFFF',
  headerAccent: '#3B82F6',
  headerChip: '#1C1C1E',
  headerBorder: '#2C2C2E',
  tabBar: 'rgba(28, 28, 30, 0.90)',
  tabBarBorder: '#2C2C2E',
  centerOrbStart: '#002244',
  centerOrbEnd: '#0A58CA',
  centerOrbIcon: '#FFFFFF',
  onSurface: '#FFFFFF',
  onSurfaceVariant: '#8E8E93',
  inkPrimary: '#FFFFFF',
  inkSecondary: '#8E8E93',
  inkMuted: '#8E8E93',
  placeholder: '#8E8E93',
  searchIcon: '#8E8E93',
  iconPrimary: '#FFFFFF',
  iconBoxBg: '#262629',
  iconBoxBorder: '#343438',
  outline: '#8E8E93',
  outlineVariant: '#3A3A3C',
  borderSubtle: '#2C2C2E',
  borderStrong: '#3A3A3C',
  primary: '#0A58CA',
  primaryLight: '#60A5FA',
  primaryHover: '#2563EB',
  onPrimary: '#FFFFFF',
  secondary: '#60A5FA',
  tertiary: '#FFFFFF',
  tertiaryContainer: '#8E8E93',
  navyAccent: '#3B82F6',
  navyDeep: '#002244',
  accentSolar: '#FFFFFF',
  accentEnergy: '#FFFFFF',
  accentEv: '#FFFFFF',
  accentConnect: '#FFFFFF',
  error: '#F87171',
  statusVerified: '#10B981',
  statusWarning: '#F59E0B',
  statusCalculated: '#60A5FA',
  statusProvisional: '#F87171',
};

const PALETAS: Record<Esquema, Paleta> = { blue, light, dark };
const CHAVE_TEMA = 'b2w:esquema_visual';

let paletaAtual: Paleta = blue;
export let esquemaAtual: Esquema = 'blue';
const ouvintes = new Set<(e: Esquema) => void>();

/** Aplica um dos 3 esquemas ('blue' | 'light' | 'dark') e notifica a raiz. */
export const aplicarEsquema = (e: Esquema) => {
  esquemaAtual = e;
  paletaAtual = PALETAS[e] ?? blue;
};

export const definirEsquema = (e: Esquema) => {
  aplicarEsquema(e);
  AsyncStorage.setItem(CHAVE_TEMA, e).catch(() => {});
  ouvintes.forEach((fn) => fn(e));
};

export const alternarEsquema = () => {
  const ordem: Esquema[] = ['blue', 'light', 'dark'];
  const prox = ordem[(ordem.indexOf(esquemaAtual) + 1) % ordem.length]!;
  definirEsquema(prox);
};

export const carregarEsquemaSalvo = async (): Promise<Esquema | null> => {
  try {
    const v = await AsyncStorage.getItem(CHAVE_TEMA);
    if (v === 'blue' || v === 'light' || v === 'dark') return v;
  } catch { /* sem storage */ }
  return null;
};

export function useEsquema(): [Esquema, (e: Esquema) => void] {
  const [e, setE] = useState<Esquema>(esquemaAtual);
  useEffect(() => {
    const fn = (novo: Esquema) => setE(novo);
    ouvintes.add(fn);
    return () => { ouvintes.delete(fn); };
  }, []);
  return [e, definirEsquema];
}

/** Cores do tema atual, lidas na hora do render. */
export const colors: Paleta = new Proxy({} as Paleta, {
  get: (_alvo, chave: string) => paletaAtual[chave as keyof Paleta],
});

// Sistema tipográfico V7.2:
//   - Principal: Inter (excelente proporção de caixa-baixa e legibilidade em ecrãs pequenos)
//   - Fallback nativo iOS: SF Pro Display (títulos/display) e SF Pro Text (corpo/labels/métricas)
//   - Fallback nativo Android: Roboto
export type PlataformaTipografica = 'ios' | 'android' | 'web';

type MapaFontes = {
  display: string;
  headline: string;
  body: string;
  bodyMedium: string;
  bodySemi: string;
  mono: string;
  monoMedium: string;
};

const FONTES_INTER_NATIVO: MapaFontes = {
  display: 'Inter_800ExtraBold',
  headline: 'Inter_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  mono: 'Inter_600SemiBold',
  monoMedium: 'Inter_500Medium',
};

const FONTES_FALLBACK_IOS: MapaFontes = {
  display: 'SF Pro Display',
  headline: 'SF Pro Display',
  body: 'SF Pro Text',
  bodyMedium: 'SF Pro Text',
  bodySemi: 'SF Pro Text',
  mono: 'SF Pro Text',
  monoMedium: 'SF Pro Text',
};

const FONTES_FALLBACK_ANDROID: MapaFontes = {
  display: 'Roboto',
  headline: 'Roboto',
  body: 'Roboto',
  bodyMedium: 'Roboto',
  bodySemi: 'Roboto',
  mono: 'Roboto',
  monoMedium: 'Roboto',
};

const STACK_WEB_DISPLAY = "'Inter', 'SF Pro Display', 'SF Pro Text', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif";
const STACK_WEB_TEXT = "'Inter', 'SF Pro Text', 'SF Pro Display', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif";

const FONTES_WEB: MapaFontes = {
  display: STACK_WEB_DISPLAY,
  headline: STACK_WEB_DISPLAY,
  body: STACK_WEB_TEXT,
  bodyMedium: STACK_WEB_TEXT,
  bodySemi: STACK_WEB_TEXT,
  mono: STACK_WEB_TEXT,
  monoMedium: STACK_WEB_TEXT,
};

let fontesAtuais: MapaFontes = FONTES_INTER_NATIVO;

export function resolverFontes(plataforma: PlataformaTipografica, interCarregada = true): MapaFontes {
  if (plataforma === 'web') return FONTES_WEB;
  if (interCarregada) return FONTES_INTER_NATIVO;
  return plataforma === 'ios' ? FONTES_FALLBACK_IOS : FONTES_FALLBACK_ANDROID;
}

export function configurarTipografia(plataforma: PlataformaTipografica, interCarregada = true) {
  fontesAtuais = resolverFontes(plataforma, interCarregada);
}

export const fonts: MapaFontes = new Proxy({} as MapaFontes, {
  get: (_alvo, chave: string) => fontesAtuais[chave as keyof MapaFontes],
});

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, gutter: 16, gutterMobile: 12 } as const;
export const radius = { sm: 2, base: 4, md: 6, lg: 8, xl: 12, full: 9999 } as const;

const construirTipografia = () => ({
  displayHero: { fontFamily: fonts.display, fontWeight: '800' as const, fontSize: 32, lineHeight: 36, letterSpacing: -0.6 },
  headlineLg: { fontFamily: fonts.headline, fontWeight: '700' as const, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  headlineMd: { fontFamily: fonts.headline, fontWeight: '700' as const, fontSize: 20, lineHeight: 25, letterSpacing: -0.3 },
  headlineSm: { fontFamily: fonts.headline, fontWeight: '600' as const, fontSize: 16, lineHeight: 22, letterSpacing: -0.15 },
  metric: { fontFamily: fonts.mono, fontWeight: '600' as const, fontSize: 21, lineHeight: 26, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
  metricLg: { fontFamily: fonts.mono, fontWeight: '700' as const, fontSize: 28, lineHeight: 32, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
  body: { fontFamily: fonts.body, fontWeight: '400' as const, fontSize: 14, lineHeight: 21 },
  bodySm: { fontFamily: fonts.body, fontWeight: '400' as const, fontSize: 12, lineHeight: 17 },
  labelMono: { fontFamily: fonts.mono, fontWeight: '600' as const, fontSize: 11, lineHeight: 14, letterSpacing: 0.8 },
  labelSm: { fontFamily: fonts.monoMedium, fontWeight: '500' as const, fontSize: 10, lineHeight: 13, letterSpacing: 0.5 },
});

export const type: ReturnType<typeof construirTipografia> = new Proxy({} as ReturnType<typeof construirTipografia>, {
  get: (_alvo, chave: string) => construirTipografia()[chave as keyof ReturnType<typeof construirTipografia>],
});
