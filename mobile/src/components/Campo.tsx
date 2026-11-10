import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { colors, radius, type } from '../theme/tokens';

/** Campo de formulário com rótulo (login, recuperar senha, criar conta, parceiro, investir). */
export function Campo({ label, onFocus, onBlur, style, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  const [focado, setFocado] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.labelSm, { color: focado ? colors.primaryLight : colors.onSurfaceVariant, textTransform: 'uppercase' }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.inkMuted}
        onFocus={(e) => { setFocado(true); onFocus?.(e); }}
        onBlur={(e) => { setFocado(false); onBlur?.(e); }}
        style={[
          type.body,
          {
            height: 48,
            borderRadius: radius.xl,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: focado ? colors.primary : colors.borderStrong,
            color: colors.onSurface,
            paddingHorizontal: 14,
          },
          style,
        ]}
        {...props}
      />
    </View>
  );
}
