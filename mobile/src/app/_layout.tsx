import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BotaoVoltar } from '../components/BotaoVoltar';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { extrairIndicador, guardarIndicacaoPendente } from '../lib/indicacao';
import { aplicarEsquema, colors, fonts, type Esquema } from '../theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Cabeçalho com o Voltar próprio: sem histórico, vai para `destino`. */
const comVoltar = (title: string, destino: Href) => ({
  title,
  headerLeft: () => <BotaoVoltar destino={destino} />,
});

function RootStack() {
  const { session, loading } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    Manrope_700Bold, Manrope_800ExtraBold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
    JetBrainsMono_500Medium, JetBrainsMono_600SemiBold,
  });
  // Fonte que falha não pode travar o app em tela branca: segue com a do sistema.
  const ready = (fontsLoaded || !!fontError) && !loading;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Link de indicação longo (`?indicador=<id>`) abrindo o app ou o webapp:
  // guarda a indicação até a pessoa entrar. A rota /i/<id> trata o curto.
  useEffect(() => {
    const ler = (url: string | null) => {
      const lido = extrairIndicador(url);
      if (lido && 'id' in lido) guardarIndicacaoPendente(lido.id, 'link');
    };
    Linking.getInitialURL().then(ler).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => ler(url));
    return () => sub.remove();
  }, []);

  if (!ready) return null;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: colors.headerInk,
        headerTitleStyle: { fontFamily: fonts.headline },
        contentStyle: { backgroundColor: colors.surface },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/recuperar-senha" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/criar-conta" options={{ headerShown: false }} />
      </Stack.Protected>
      {/* Link de indicação: vale logado ou não. */}
      <Stack.Screen name="i/[codigo]" options={{ headerShown: false }} />
      {/* Exclusão de conta: pública (exigência da Google Play), logado ou não. */}
      <Stack.Screen name="excluir-conta" options={comVoltar('Excluir conta', '/')} />
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="energia/[ucId]" options={comVoltar('Unidade consumidora', '/energia')} />
        <Stack.Screen name="energia/nova-uc" options={comVoltar('Nova UC', '/energia')} />
        <Stack.Screen name="invest/[usinaId]" options={comVoltar('Detalhamento da usina', '/invest')} />
        <Stack.Screen name="scan" options={{ title: 'Escanear carregador', presentation: 'modal' }} />
        <Stack.Screen name="indicacao" options={comVoltar('Indicação', '/')} />
        <Stack.Screen name="adesao" options={comVoltar('Adesão', '/energia')} />
        <Stack.Screen name="adesao-cliente" options={comVoltar('Novo assinante', '/connect/home')} />
        <Stack.Screen name="comecar" options={comVoltar('Começar', '/')} />
        <Stack.Screen name="parceiro" options={comVoltar('Parceiro Power', '/')} />
        <Stack.Screen name="investir" options={comVoltar('B2W Invest', '/invest')} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  // Tema do celular (decisao do dono, 05/10/2026). Sem preferencia, escuro.
  const esquema: Esquema = useColorScheme() === 'light' ? 'light' : 'dark';
  aplicarEsquema(esquema);
  const [qc] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusBar style="light" />
          {/* key: troca de tema redesenha o app inteiro com a paleta nova */}
          <RootStack key={esquema} />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
