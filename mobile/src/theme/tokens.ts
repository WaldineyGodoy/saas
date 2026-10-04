// Design system "B2W Energia Helios Sovereign" (Stitch, projeto 2359134248600550624).
// Os valores vem do designMd do projeto — mudar la e aqui juntos.
export const colors = {
  background: '#070A1E',
  surface: '#0F1226',
  surfaceLowest: '#090D21',
  surfaceLow: '#171A2F',
  surfaceContainer: '#1B1E33',
  surfaceHigh: '#25293E',
  surfaceHighest: '#303349',
  header: '#0B1124',
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
} as const;

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
