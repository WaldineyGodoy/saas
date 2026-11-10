import { MaterialIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toneColor, type Tone } from '../lib/status';
import { colors, esquemaAtual, fonts, radius, space, type, type Esquema } from '../theme/tokens';

export type IconName = ComponentProps<typeof MaterialIcons>['name'];

export const Icon = ({ name, size = 20, color = colors.inkSecondary }: { name: IconName; size?: number; color?: string }) => (
  <MaterialIcons name={name} size={size} color={color} />
);

export function Screen({
  children, refreshing, onRefresh, contentStyle,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={[{ padding: space.gutterMobile, paddingBottom: space.xl, gap: space.md }, contentStyle]}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

const LOGO_HORIZONTAL = require('../../assets/logo-horizontal.png');

/** Cabecalho fixo das telas (logo, "Online", sino, avatar), como no Stitch. */
export function TopBar({ initials, onAvatar }: { initials?: string; onAvatar?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.topbar, { paddingTop: insets.top }]}>
      <View style={s.topbarRow}>
        {/* Logo oficial (Stitch: B2W_E_V1_FUNDOESCURO) */}
        <Image source={LOGO_HORIZONTAL} style={{ width: 104, height: 30 }} resizeMode="contain" accessibilityLabel="B2W Energia" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={s.online}>
            <View style={s.onlineDot} />
            <Text style={s.onlineTxt}>Online</Text>
          </View>
          <Pressable accessibilityLabel="Perfil" onPress={onAvatar} style={s.avatar}>
            <Text style={s.avatarTxt}>{initials || '•'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function Hero({ kicker, title, subtitle }: { kicker?: string; title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 4, paddingTop: 2, paddingBottom: 2 }}>
      {kicker ? (
        <Text style={{ fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18, color: colors.primaryLight, letterSpacing: 0.2 }}>
          {kicker}
        </Text>
      ) : null}
      <Text style={[type.headlineLg, { color: colors.onSurface }]}>{title}</Text>
      {subtitle ? <Text style={[type.body, { color: colors.onSurfaceVariant, marginTop: 2 }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.88, transform: [{ scale: 0.995 }] }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[s.card, style]}>{children}</View>;
}

export function Metric({
  label, value, unit, icon, iconColor = colors.tertiary, foot, footColor = colors.inkSecondary, footIcon, embedded,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: IconName;
  iconColor?: string;
  foot?: string;
  footColor?: string;
  footIcon?: IconName;
  embedded?: boolean;
}) {
  const tamanhoValor = value.length > 12 ? 16 : value.length >= 10 ? 18 : 21;
  return (
    <View style={[embedded ? s.metricEmbedded : s.card, { flex: 1, padding: 12, gap: 6 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <Text style={[type.labelSm, { color: colors.onSurfaceVariant, textTransform: 'uppercase', flex: 1 }]} numberOfLines={1}>{label}</Text>
        <View style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: `${iconColor}1A`, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={15} color={iconColor} />
        </View>
      </View>
      <Text
        style={[type.metric, { color: colors.onSurface, fontSize: tamanhoValor, lineHeight: 25 }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {value}
        {unit ? <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.onSurfaceVariant }}>{` ${unit}`}</Text> : null}
      </Text>
      {foot ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {footIcon ? <Icon name={footIcon} size={13} color={footColor} /> : null}
          <Text style={[type.bodySm, { color: footColor, flex: 1 }]} numberOfLines={1}>{foot}</Text>
        </View>
      ) : null}
    </View>
  );
}

export const Row = ({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ flexDirection: 'row', gap }, style]}>{children}</View>
);

export function SectionLabel({ title, aside, asideColor = colors.secondary }: { title: string; aside?: string; asideColor?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2, marginTop: 4 }}>
      <Text style={[type.labelMono, { color: colors.onSurfaceVariant, textTransform: 'uppercase', flexShrink: 1 }]}>{title}</Text>
      {aside ? <Text style={[type.labelSm, { color: asideColor, textTransform: 'uppercase' }]}>{aside}</Text> : null}
    </View>
  );
}

const TONE_ICON: Record<Tone, IconName> = {
  ok: 'check-circle',
  warn: 'warning-amber',
  bad: 'error-outline',
  info: 'schedule',
  neutral: 'radio-button-unchecked',
};

export function Badge({ label, tone }: { label: string; tone: Tone }) {
  const c = toneColor[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, backgroundColor: `${c}1F`, borderWidth: 1, borderColor: `${c}4D` }}>
      <MaterialIcons name={TONE_ICON[tone]} size={11} color={c} />
      <Text style={[type.labelSm, { color: c, textTransform: 'uppercase' }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label, icon, onPress, variant = 'primary', loading, disabled, style,
}: {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === 'primary'
    ? colors.primary
    : variant === 'secondary'
      ? colors.surfaceHigh
      : variant === 'danger'
        ? `${colors.statusProvisional}1A`
        : 'transparent';
  const fg = variant === 'primary'
    ? colors.onPrimary
    : variant === 'danger'
      ? colors.statusProvisional
      : variant === 'ghost'
        ? colors.inkSecondary
        : colors.onSurface;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.82 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.borderSubtle },
        variant === 'danger' && { borderWidth: 1, borderColor: `${colors.statusProvisional}4D` },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={19} color={fg} /> : null}
      <Text style={[type.headlineSm, { color: fg, fontSize: 15 }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.full,
        backgroundColor: active ? colors.primary : colors.surfaceLowest,
        borderWidth: 1, borderColor: active ? colors.primary : colors.borderSubtle,
      }}
    >
      <Text style={[type.bodySm, { color: active ? colors.onPrimary : colors.inkSecondary, fontFamily: fonts.bodySemi }]}>{label}</Text>
    </Pressable>
  );
}

export function SearchInput({ value, onChangeText, placeholder }: { value: string; onChangeText: (t: string) => void; placeholder: string }) {
  return (
    <View style={s.search}>
      <Icon name="search" size={20} color={colors.onSurfaceVariant} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={`${colors.onSurfaceVariant}B3`}
        style={[type.body, { flex: 1, color: colors.onSurface, paddingVertical: 0 }]}
        autoCorrect={false}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Limpar busca">
          <Icon name="close" size={18} color={colors.onSurfaceVariant} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function ListItem({
  icon, iconColor = colors.primary, title, subtitle, right, onPress,
}: {
  icon: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 }}>
      <View style={[s.iconBox, { backgroundColor: `${iconColor}1A`, borderWidth: 1, borderColor: `${iconColor}2E` }]}>
        <Icon name={icon} size={22} color={iconColor} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.headlineSm, { color: colors.onSurface, fontSize: 15 }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[type.bodySm, { color: colors.inkSecondary }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress ? <Icon name="chevron-right" size={20} color={colors.inkMuted} /> : null}
    </Card>
  );
}

export function KeyValue({ k, v, vColor = colors.onSurface, bold, vStyle }: { k: string; v: string; vColor?: string; bold?: boolean; vStyle?: StyleProp<TextStyle> }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 12 }}>
      <Text style={[type.body, { color: colors.inkSecondary, flex: 1 }]}>{k}</Text>
      <Text style={[bold ? type.headlineSm : type.body, { color: vColor, fontFamily: bold ? fonts.mono : fonts.monoMedium }, vStyle]}>{v}</Text>
    </View>
  );
}

export const Divider = () => <View style={{ height: 1, backgroundColor: colors.borderSubtle, marginVertical: 4 }} />;

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center', gap: 12 }}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{label}</Text>
    </View>
  );
}

export function Empty({ icon = 'manage-search', title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
      <Icon name={icon} size={36} color={colors.inkMuted} />
      <Text style={[type.headlineSm, { color: colors.onSurface, textAlign: 'center' }]}>{title}</Text>
      {text ? <Text style={[type.bodySm, { color: colors.inkSecondary, textAlign: 'center' }]}>{text}</Text> : null}
      {action}
    </Card>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error ?? 'Erro desconhecido');
  const semFuncao = /function .* does not exist|Could not find the function/i.test(msg);
  return (
    <Empty
      icon="error-outline"
      title={semFuncao ? 'Servidor ainda não preparado' : 'Não foi possível carregar'}
      text={semFuncao ? 'As funções do app ainda não foram publicadas no banco. Avise o suporte B2W.' : msg}
      action={onRetry ? <Button label="Tentar de novo" icon="refresh" variant="secondary" onPress={onRetry} style={{ marginTop: 8 }} /> : null}
    />
  );
}

// Uma folha por tema, criada na primeira vez que o tema aparece.
const criarFolha = () => StyleSheet.create({
  topbar: { backgroundColor: colors.header, borderBottomWidth: 1, borderBottomColor: colors.headerBorder },
  topbarRow: { height: 56, paddingHorizontal: space.gutterMobile, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  online: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full, backgroundColor: `${colors.headerAccent}1C`, borderWidth: 1, borderColor: `${colors.headerAccent}38` },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.headerAccent },
  onlineTxt: { fontFamily: fonts.mono, fontSize: 9, color: colors.headerAccent, textTransform: 'uppercase', letterSpacing: 0.6 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.headerChip, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.headerBorder },
  avatarTxt: { fontFamily: fonts.headline, fontSize: 12, color: colors.headerInk },
  card: { backgroundColor: colors.surfaceLowest, borderRadius: radius.xl, padding: space.md, borderWidth: 1, borderColor: colors.borderSubtle },
  metricEmbedded: { backgroundColor: colors.surfaceLow, borderRadius: radius.lg },
  btn: { minHeight: 48, borderRadius: radius.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  search: { height: 46, borderRadius: radius.xl, backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.borderSubtle, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  iconBox: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
const folhas: Partial<Record<Esquema, ReturnType<typeof criarFolha>>> = {};
const s = new Proxy({} as ReturnType<typeof criarFolha>, {
  get: (_alvo, chave: string) => (folhas[esquemaAtual] ??= criarFolha())[chave as keyof ReturnType<typeof criarFolha>],
});
