import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { colors, fonts } from '../theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const { session, loading } = useAuth();
  const [fontsLoaded] = useFonts({
    Manrope_700Bold, Manrope_800ExtraBold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
    JetBrainsMono_500Medium, JetBrainsMono_600SemiBold,
  });
  const ready = fontsLoaded && !loading;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: colors.inkPrimary,
        headerTitleStyle: { fontFamily: fonts.headline },
        contentStyle: { backgroundColor: colors.surface },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="energia/[ucId]" options={{ title: 'Unidade consumidora' }} />
        <Stack.Screen name="energia/nova-uc" options={{ title: 'Nova UC' }} />
        <Stack.Screen name="invest/[usinaId]" options={{ title: 'Detalhamento da usina' }} />
        <Stack.Screen name="connect/home" options={{ title: 'Home Connect' }} />
        <Stack.Screen name="connect/drive" options={{ title: 'Drive Connect' }} />
        <Stack.Screen name="scan" options={{ title: 'Escanear carregador', presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [qc] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusBar style="light" />
          <RootStack />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
