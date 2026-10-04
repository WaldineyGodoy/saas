import { MaterialIcons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
import { router, Tabs } from 'expo-router';
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
  return (
    <Tabs
      screenOptions={{
        header: () => <TopBar initials={iniciais(perfil?.name)} onAvatar={() => router.navigate('/mais')} />,
        tabBarStyle: { backgroundColor: colors.header, borderTopColor: 'rgba(255,255,255,0.08)' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('play-circle-outline') }} />
      <Tabs.Screen name="eletroposto" options={{ title: 'Eletroposto', tabBarIcon: icon('ev-station') }} />
      <Tabs.Screen name="energia" options={{ title: 'Energia', tabBarIcon: icon('bolt') }} />
      <Tabs.Screen name="invest" options={{ title: 'B2W Invest', tabBarIcon: icon('trending-up') }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais', tabBarIcon: icon('more-horiz') }} />
    </Tabs>
  );
}
