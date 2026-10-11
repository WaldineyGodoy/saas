import { MaterialIcons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
import { router, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/ui';
import { usePerfil } from '../../lib/api';
import { iniciais } from '../../lib/format';
import { colors, fonts } from '../../theme/tokens';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];
function icon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialIcons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const { data: perfil } = usePerfil();
  // Altura do menu com folga para o rótulo e a barra de gestos do iPhone:
  // o padrão cortava a parte de baixo dos textos (11/10/2026).
  const insets = useSafeAreaInsets();
  const folga = Math.max(insets.bottom, 8);
  return (
    <Tabs
      screenOptions={{
        header: () => <TopBar initials={iniciais(perfil?.name)} onAvatar={() => router.navigate('/mais')} />,
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.tabBarBorder, height: 64 + folga, paddingTop: 4, paddingBottom: folga },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 11, lineHeight: 15 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('play-circle-outline') }} />
      <Tabs.Screen name="eletroposto" options={{ title: 'Eletroposto', tabBarIcon: icon('ev-station') }} />
      <Tabs.Screen name="energia" options={{ title: 'Energia', tabBarIcon: icon('bolt') }} />
      <Tabs.Screen name="invest" options={{ title: 'B2W Invest', tabBarIcon: icon('trending-up') }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais', tabBarIcon: icon('more-horiz') }} />
      {/* Home e Drive Connect: telas do ecossistema com o mesmo cabeçalho e
          menu das abas, mas sem botão próprio no menu (11/10/2026). */}
      <Tabs.Screen name="connect/home" options={{ title: 'Home Connect', href: null }} />
      <Tabs.Screen name="connect/drive" options={{ title: 'Drive Connect', href: null }} />
    </Tabs>
  );
}
