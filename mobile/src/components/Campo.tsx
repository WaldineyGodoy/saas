import { Text, TextInput, View } from 'react-native';
import { colors, radius, type } from '../theme/tokens';

/** Campo de formulário com rótulo (criar conta, parceiro, investir). */
export function Campo({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.labelSm, { color: colors.onSurfaceVariant, textTransform: 'uppercase' }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.inkMuted}
        style={[type.body, { height: 48, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, color: colors.onSurface, paddingHorizontal: 14 }]}
        {...props}
      />
    </View>
  );
}
