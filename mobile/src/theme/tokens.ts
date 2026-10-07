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
  error: string; statusVerified: string; statusCalculated: string; statusProvisional: string;
};

const escuro: Paleta = {
  background: '#070A1E',
  surface: '#0F1226',
  surfaceLowest: '#090D21',
  surfaceLow: '#171A2F',
  surfaceContainer: '#1B1E33',
  surfaceHigh: '#25293E',
  surfaceHighest: '#303349',
  header: '#0B1124',
  headerInk: '#F8F9FB',
  headerAccent: '#E9C349',
  headerChip: '#25293E',
  headerBorder: 'rgba(255,255,255,0.08)',
  tabBar: '#0B1124',
  tabBarBorder: 'rgba(255,255,255,0.08)',
  onSurface: '#DFE0FD',
  onSurfaceVariant: '#E1C0B0',
  inkPrimary: '#F8F9FB',
  inkSecondary: '#B8BCCE',
  inkMuted: '#5F6480',
  outline: '#A88B7D',
  outlineVariant: '#594236',
  borderSubtle: '#282D4A',
  borderStrong: '#404562',
  primary: '#F26B00',
  primaryLight: '#FF9B52',
  primaryHover: '#FF7B20',
  onPrimary: '#FFFFFF',
  secondary: '#E9C349',
  tertiary: '#00DDDD',
  tertiaryContainer: '#00A4A4',
  navyAccent: '#6481BF',
  navyDeep: '#031952',
  error: '#FFB4AB',
  statusVerified: '#0E9F6E',
  statusCalculated: '#6FE9F0',
  statusProvisional: '#E25454',
};

const claro: Paleta = {
  background: '#F5F7FB',
  surface: '#F5F7FB',
  surfaceLowest: '#FFFFFF',
  surfaceLow: '#FFFFFF',
  surfaceContainer: '#FFFFFF',
  surfaceHigh: '#EDF2F7',
  surfaceHighest: '#E2E8F0',
  header: '#0B1124',
  headerInk: '#F8F9FB',
  headerAccent: '#2DD4BF',
  headerChip: '#1C2248',
  headerBorder: 'rgba(255,255,255,0.08)',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E2E8F0',
  onSurface: '#0B1124',
  onSurfaceVariant: '#64748B',
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
  secondary: '#008B99',
  tertiary: '#008B99',
  tertiaryContainer: '#006973',
  navyAccent: '#3B5BA5',
  navyDeep: '#031952',
  error: '#DC2626',
  statusVerified: '#0E9F6E',
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
  displayHero: { fontFamily: fonts.display, fontSize: 32, lineHeight: 35 },
  headlineLg: { fontFamily: fonts.headline, fontSize: 24, lineHeight: 29 },
  headlineMd: { fontFamily: fonts.headline, fontSize: 20, lineHeight: 24 },
  headlineSm: { fontFamily: fonts.headline, fontSize: 16, lineHeight: 21 },
  metric: { fontFamily: fonts.mono, fontSize: 22, lineHeight: 26 },
  metricLg: { fontFamily: fonts.mono, fontSize: 28, lineHeight: 30 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
  bodySm: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  labelMono: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 13, letterSpacing: 1.3 },
  labelSm: { fontFamily: fonts.monoMedium, fontSize: 10, lineHeight: 12, letterSpacing: 0.8 },
} as const;
