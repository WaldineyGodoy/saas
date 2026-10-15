import { MaterialIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { colors, fonts } from '../theme/tokens';

/**
 * Voltar do cabeçalho, sempre visível. O voltar nativo some quando não há
 * histórico (webapp aberto direto na rota, ou recarregado), e a pessoa
 * ficava presa na tela (reportado pelo dono no Cadastrar Novo Assinante,
 * 15/10/2026). Sem histórico, vai para `destino`.
 */
export function BotaoVoltar({ destino }: { destino: Href }) {
  const voltar = () => (router.canGoBack() ? router.back() : router.replace(destino));
  return (
    <Pressable
      onPress={voltar}
      accessibilityRole="button"
      accessibilityLabel="Voltar"
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 4,
        height: 34, paddingLeft: 8, paddingRight: 14, marginRight: 12, borderRadius: 17,
        backgroundColor: colors.headerChip, borderWidth: 1, borderColor: colors.headerBorder,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <MaterialIcons name="chevron-left" size={22} color={colors.primary} />
      <Text style={{ fontFamily: fonts.headline, fontSize: 14, color: colors.headerInk }}>Voltar</Text>
    </Pressable>
  );
}
