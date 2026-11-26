import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { router, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/ui';
import { useNaoLidas, usePerfil } from '../../lib/api';
import { iniciais } from '../../lib/format';
import { colors, esquemaAtual, fonts } from '../../theme/tokens';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];
function icon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialIcons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

/** Esfera central em degradê azul royal/escuro (#002244 a #0A58CA) para a aba central (Energia). */
function CentralOrbIcon({ focused }: { focused: boolean }) {
  return (
    <View style={[s.orbWrap, focused && s.orbFocused]}>
      <LinearGradient
        colors={[colors.centerOrbStart, colors.centerOrbEnd]}
        start={{ x: 0.15, y: 0.1 }}
        end={{ x: 0.85, y: 0.95 }}
        style={s.orb}
      >
        <MaterialIcons name="bolt" color={colors.centerOrbIcon} size={24} />
      </LinearGradient>
    </View>
  );
}

export default function TabsLayout() {
  const { data: perfil } = usePerfil();
  const { data: naoLidas } = useNaoLidas();
  // Altura do menu com folga para o rótulo e a barra de gestos do iPhone:
  // o padrão cortava a parte de baixo dos textos (11/10/2026).
  const insets = useSafeAreaInsets();
  const folga = Math.max(insets.bottom, 8);
  const ativo = esquemaAtual === 'light' ? '#1A1A1A' : esquemaAtual === 'dark' ? '#FFFFFF' : colors.primary;
  return (
    <Tabs
      screenOptions={{
        header: () => (
          <TopBar initials={iniciais(perfil?.name)} onAvatar={() => router.navigate('/mais')}
            naoLidas={naoLidas ?? 0} onSino={() => router.push('/notificacoes')} />
        ),
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: 1,
          height: 68 + folga,
          paddingTop: 6,
          paddingBottom: folga,
        },
        tabBarActiveTintColor: ativo,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 11, lineHeight: 15 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('grid-view') }} />
      <Tabs.Screen name="eletroposto" options={{ title: 'Eletroposto', tabBarIcon: icon('ev-station') }} />
      <Tabs.Screen
        name="energia"
        options={{
          title: 'Energia',
          tabBarIcon: ({ focused }) => <CentralOrbIcon focused={focused} />,
        }}
      />
      <Tabs.Screen name="invest" options={{ title: 'B2W Invest', tabBarIcon: icon('solar-power') }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais', tabBarIcon: icon('more-horiz') }} />
      {/* Home e Drive Connect: telas do ecossistema com o mesmo cabeçalho e
          menu das abas, mas sem botão próprio no menu (11/10/2026). */}
      <Tabs.Screen name="connect/home" options={{ title: 'Home Connect', href: null }} />
      <Tabs.Screen name="connect/drive" options={{ title: 'Drive Connect', href: null }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  orbWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginTop: -10,
    shadowColor: '#0A58CA',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  orbFocused: {
    transform: [{ scale: 1.06 }],
    shadowOpacity: 0.5,
  },
  orb: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
  },
});
