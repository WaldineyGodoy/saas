// Design system do Stitch (projeto 2359134248600550624), em dois temas:
//   escuro: "B2W Energia Helios Sovereign" (colorMode DARK)
//   claro:  "Helios Sovereign" (colorMode LIGHT)
// O app segue o tema do celular (decisao do dono, 05/10/2026). Os valores vem
// do designMd de cada um — mudar la e aqui juntos. O cabecalho continua azul-
// marinho nos dois temas, como nas telas "(Light)" do Stitch.

type Paleta = {
  background: string; surface: string; surfaceLowest: string; surfaceLow: string; surfaceContainer: string;
  surfaceHigh: string; surfaceHighest: string;
  header: string; headerInk: string; headerAccent: string; headerChip: string; headerBorder: string;
  tabBar: string; tabBarBorder: string;
  onSurface: string; onSurfaceVariant: string; inkPrimary: string; inkSecondary: string; inkMuted: string;
  outline: string; outlineVariant: string; borderSubtle: string; borderStrong: string;
  primary: string; primaryLight: string; primaryHover: string; onPrimary: string;
  secondary: string; tertiary: string; tertiaryContainer: string; navyAccent: string; navyDeep: string;
  accentSolar: string; accentEnergy: string; accentEv: string; accentConnect: string;
  error: string; statusVerified: string; statusWarning: string; statusCalculated: string; statusProvisional: string;
};

const escuro: Paleta = {
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
  onSurface: '#F1F5F9',
  onSurfaceVariant: '#94A3B8',
  inkPrimary: '#F8FAFC',
  inkSecondary: '#CBD5E1',
  inkMuted: '#7E8BA8',
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

const claro: Paleta = {
  background: '#F4F6FB',
  surface: '#F4F6FB',
  surfaceLowest: '#FFFFFF',
  surfaceLow: '#F8FAFC',
  surfaceContainer: '#FFFFFF',
  surfaceHigh: '#EDF2F7',
  surfaceHighest: '#E2E8F0',
  header: '#0B1124',
  headerInk: '#F8FAFC',
  headerAccent: '#34D399',
  headerChip: '#1C2248',
  headerBorder: 'rgba(255,255,255,0.08)',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E2E8F0',
  onSurface: '#0B1124',
  onSurfaceVariant: '#475569',
  inkPrimary: '#0B1124',
  inkSecondary: '#334155',
  inkMuted: '#64748B',
  outline: '#94A3B8',
  outlineVariant: '#CBD5E1',
  borderSubtle: '#E2E8F0',
  borderStrong: '#CBD5E1',
  primary: '#F26B00',
  primaryLight: '#D95F00',
  primaryHover: '#D95F00',
  onPrimary: '#FFFFFF',
  secondary: '#0D9488',
  tertiary: '#0284C7',
  tertiaryContainer: '#0369A1',
  navyAccent: '#3B5BA5',
  navyDeep: '#031952',
  accentSolar: '#D97706',
  accentEnergy: '#0284C7',
  accentEv: '#4F46E5',
  accentConnect: '#0D9488',
  error: '#DC2626',
  statusVerified: '#059669',
  statusWarning: '#D97706',
  statusCalculated: '#0284C7',
  statusProvisional: '#DC2626',
};

export type Esquema = 'light' | 'dark';
let paletaAtual = escuro;
export let esquemaAtual: Esquema = 'dark';

/** Troca o tema. O layout raiz chama com o tema do celular antes de desenhar. */
export const aplicarEsquema = (e: Esquema) => {
  esquemaAtual = e;
  paletaAtual = e === 'light' ? claro : escuro;
};

/** Cores do tema atual, lidas na hora do render. A troca de tema redesenha o
 *  app a partir da raiz (key no layout), e cada tela pega a paleta nova. */
export const colors: Paleta = new Proxy({} as Paleta, {
  get: (_alvo, chave: string) => paletaAtual[chave as keyof Paleta],
});

export const fonts = {
  display: 'Manrope_800ExtraBold',
  headline: 'Manrope_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_600SemiBold',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, gutter: 16, gutterMobile: 12 } as const;
export const radius = { sm: 2, base: 4, md: 6, lg: 8, xl: 12, full: 9999 } as const;

export const type = {
  displayHero: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, letterSpacing: -0.6 },
  headlineLg: { fontFamily: fonts.headline, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  headlineMd: { fontFamily: fonts.headline, fontSize: 20, lineHeight: 25, letterSpacing: -0.3 },
  headlineSm: { fontFamily: fonts.headline, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 },
  metric: { fontFamily: fonts.mono, fontSize: 21, lineHeight: 26, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
  metricLg: { fontFamily: fonts.mono, fontSize: 28, lineHeight: 32, fontVariant: ['tabular-nums'] as ('tabular-nums')[] },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
  bodySm: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  labelMono: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 14, letterSpacing: 1.1 },
  labelSm: { fontFamily: fonts.monoMedium, fontSize: 10, lineHeight: 13, letterSpacing: 0.7 },
} as const;
