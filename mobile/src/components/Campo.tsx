import { useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { colors, radius, type } from '../theme/tokens';
import { vidro } from '../theme/vidro';

/** Campo de formulário com rótulo (login, recuperar senha, criar conta, parceiro, investir).
 *  `vidro`: versão translúcida para telas sobre vídeo (login). */
export function Campo({ label, onFocus, onBlur, style, vidro: emVidro, ...props }: { label: string; vidro?: boolean } & React.ComponentProps<typeof TextInput>) {
  const [focado, setFocado] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={[
          type.labelSm,
          { textTransform: 'uppercase' },
          emVidro
            ? { color: focado ? vidro.acento : vidro.rotulo }
            : { color: focado ? colors.primaryLight : colors.onSurfaceVariant },
        ]}
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={emVidro ? vidro.tinta3 : colors.inkMuted}
        onFocus={(e) => { setFocado(true); onFocus?.(e); }}
        onBlur={(e) => { setFocado(false); onBlur?.(e); }}
        style={[
          type.body,
          emVidro
            ? {
                height: 50,
                borderRadius: 14,
                backgroundColor: focado ? vidro.campoFocado : vidro.campo,
                borderWidth: 1,
                borderColor: focado ? vidro.acento : vidro.borda,
                color: vidro.tinta,
                fontSize: 16,
                paddingHorizontal: 16,
                ...(Platform.OS === 'web'
                  ? ({
                      outlineStyle: 'none',
                      caretColor: vidro.acento,
                      transitionProperty: 'border-color, background-color, box-shadow',
                      transitionDuration: '180ms',
                      boxShadow: focado ? `0 0 0 3px ${vidro.anel}` : 'inset 0 1px 2px rgba(2,6,23,0.25)',
                    } as object)
                  : null),
              }
            : {
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
