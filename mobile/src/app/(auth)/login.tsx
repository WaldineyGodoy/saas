import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Campo } from '../../components/Campo';
import { FundoLogin } from '../../components/FundoLogin';
import { Icon, type IconName } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { envOk } from '../../lib/env';
import { PRIVACIDADE_URL } from '../../lib/links';
import { space, type } from '../../theme/tokens';
import { vidro } from '../../theme/vidro';

// Logo oficial em PNG com fundo transparente (versão para fundo escuro).
const LOGO = require('../../../assets/logo-vertical.png');
const WEB = Platform.OS === 'web';

/** Placa de vidro líquido: desfoque do vídeo por trás, borda com brilho no
 *  topo e um reflexo diagonal suave. Sem backdrop-filter (nativo), fica
 *  mais opaca para o texto continuar legível. */
function Placa({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={[
        {
          borderRadius: 24,
          borderWidth: 1,
          borderColor: vidro.borda,
          borderTopColor: vidro.bordaBrilho,
          backgroundColor: WEB ? vidro.placa : vidro.placaSemDesfoque,
          overflow: 'hidden',
          padding: 20,
          gap: space.md,
        },
        WEB ? ({ backdropFilter: vidro.desfoque, boxShadow: vidro.sombra } as object) : null,
        style,
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        colors={['rgba(255,255,255,0.11)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)']}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.9, y: 1 }}
      />
      {children}
    </View>
  );
}

function Botao({
  label, icon, onPress, tipo, loading,
}: { label: string; icon?: IconName; onPress: () => void; tipo: 'primario' | 'vidro' | 'texto'; loading?: boolean }) {
  const cor = tipo === 'texto' ? vidro.tinta2 : vidro.tinta;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: loading }}
      onPress={loading ? undefined : onPress}
      style={(estado) => {
        const { pressed } = estado;
        const { hovered, focused } = estado as typeof estado & { hovered?: boolean; focused?: boolean };
        const base: ViewStyle = {
          minHeight: tipo === 'texto' ? 40 : 50,
          borderRadius: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: 16,
          opacity: loading ? 0.7 : 1,
        };
        const web = WEB
          ? ({
              transitionProperty: 'background-color, transform, box-shadow',
              transitionDuration: '160ms',
              transform: pressed ? 'scale(0.985)' : 'none',
              outlineStyle: 'none',
              boxShadow: focused ? `0 0 0 3px ${vidro.anel}` : tipo === 'primario' ? '0 10px 24px -10px rgba(242,107,0,0.65)' : 'none',
              cursor: loading ? 'progress' : 'pointer',
            } as object)
          : null;
        if (tipo === 'primario') {
          return [base, web, { backgroundColor: pressed ? '#D95F00' : hovered ? '#FF7B20' : vidro.primario }];
        }
        if (tipo === 'vidro') {
          return [
            base,
            web,
            {
              backgroundColor: pressed || hovered ? vidro.botaoPressionado : WEB ? vidro.botao : vidro.placaSemDesfoque,
              borderWidth: 1,
              borderColor: vidro.borda,
              borderTopColor: vidro.bordaBrilho,
            },
            WEB ? ({ backdropFilter: vidro.desfoque } as object) : null,
          ];
        }
        return [base, web, { backgroundColor: hovered || pressed ? 'rgba(255,255,255,0.06)' : 'transparent' }];
      }}
    >
      {loading ? <ActivityIndicator color={cor} /> : icon ? <Icon name={icon} size={19} color={cor} /> : null}
      <Text style={[type.headlineSm, { color: cor, fontSize: 15 }, WEB && tipo === 'texto' ? ({ textShadow: vidro.sombraTexto } as object) : null]}>{label}</Text>
    </Pressable>
  );
}

export default function Login() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async () => {
    if (!email || !senha) return setErro('Informe e-mail e senha.');
    setEnviando(true);
    setErro(await signIn(email, senha));
    setEnviando(false);
  };

  const esqueci = () => router.push({ pathname: '/recuperar-senha', params: email ? { email } : {} });

  return (
    <View style={{ flex: 1, backgroundColor: '#0B1124' }}>
      <StatusBar style="light" />
      <FundoLogin />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ backgroundColor: 'transparent' }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: space.lg,
            paddingTop: insets.top + space.xl,
            paddingBottom: insets.bottom + space.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Bloco único, centralizado e com largura de formulário (não estica no computador). */}
          <View style={{ width: '100%', maxWidth: 400, gap: 20 }}>
            <View style={{ alignItems: 'center', gap: 14, marginBottom: 4 }}>
              <Image source={LOGO} style={{ width: 124, height: 117 }} resizeMode="contain" accessibilityLabel="B2W Energia" />
              <Text style={[type.body, { color: vidro.tinta2, textAlign: 'center', fontSize: 15, lineHeight: 22, maxWidth: 300 }, WEB ? ({ textWrap: 'balance', textShadow: vidro.sombraTexto } as object) : null]}>
                Sua energia, suas usinas e sua rede de indicações em um só lugar.
              </Text>
            </View>

            {!envOk && (
              <Placa style={{ borderColor: 'rgba(248,113,113,0.5)' }}>
                <Text style={[type.bodySm, { color: vidro.erro }]}>
                  App sem configuração: defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no arquivo .env.
                </Text>
              </Placa>
            )}

            <Placa>
              <Campo vidro label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
              <Campo vidro label="Senha" value={senha} onChangeText={setSenha} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={entrar} />
              {erro ? (
                <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="error-outline" size={17} color={vidro.erro} />
                  <Text style={[type.bodySm, { color: vidro.erro, flex: 1, fontSize: 13, lineHeight: 18 }]}>{erro}</Text>
                </View>
              ) : null}
              <View style={{ gap: 4, marginTop: 2 }}>
                <Botao tipo="primario" label="Entrar" icon="login" onPress={entrar} loading={enviando} />
                <Botao tipo="texto" label="Esqueci minha senha" onPress={esqueci} />
              </View>
            </Placa>

            <View style={{ gap: 10 }}>
              <Text style={[type.bodySm, { color: vidro.tinta2, textAlign: 'center', fontSize: 13, lineHeight: 18 }, WEB ? ({ textShadow: vidro.sombraTexto } as object) : null]}>
                Já é cliente? Use o mesmo e-mail cadastrado no seu contrato B2W.
              </Text>
              <Botao tipo="vidro" label="Ainda não sou cliente: criar conta" icon="person-add" onPress={() => router.push('/criar-conta')} />
            </View>
            <View style={{ alignItems: 'center' }}>
              <Botao tipo="texto" label="Política de privacidade" onPress={() => WebBrowser.openBrowserAsync(PRIVACIDADE_URL)} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
