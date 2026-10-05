import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { envOk } from '../../lib/env';
import { PRIVACIDADE_URL } from '../../lib/links';
import { colors, fonts, radius, space, type } from '../../theme/tokens';

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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.lg, paddingTop: insets.top + space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 10 }}>
          <View style={{ backgroundColor: colors.primary, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 6 }}>
            <Text style={{ fontFamily: fonts.display, fontSize: 28, color: '#fff', letterSpacing: 1 }}>B2W</Text>
          </View>
          <Text style={[type.headlineLg, { color: colors.inkPrimary }]}>B2W Energia</Text>
          <Text style={[type.body, { color: colors.inkSecondary, textAlign: 'center' }]}>
            Sua energia, suas usinas e sua rede de indicações em um só lugar.
          </Text>
        </View>

        {!envOk && (
          <Card style={{ borderColor: colors.statusProvisional }}>
            <Text style={[type.bodySm, { color: colors.error }]}>
              App sem configuração: defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no arquivo .env.
            </Text>
          </Card>
        )}

        <Card style={{ gap: space.md }}>
          <Campo label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
          <Campo label="Senha" value={senha} onChangeText={setSenha} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={entrar} />
          {erro ? <Text style={[type.bodySm, { color: colors.error }]}>{erro}</Text> : null}
          <Button label="Entrar" icon="login" onPress={entrar} loading={enviando} />
          <Button label="Esqueci minha senha" variant="ghost" onPress={esqueci} />
        </Card>

        <Text style={[type.bodySm, { color: colors.inkMuted, textAlign: 'center' }]}>
          Use o mesmo e-mail cadastrado no seu contrato B2W.
        </Text>
        <Button label="Política de privacidade" variant="ghost" onPress={() => WebBrowser.openBrowserAsync(PRIVACIDADE_URL)} style={{ alignSelf: 'center', minHeight: 36 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Campo({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[type.labelSm, { color: colors.onSurfaceVariant, textTransform: 'uppercase' }]}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.inkMuted}
        style={[type.body, { height: 48, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, color: colors.onSurface, paddingHorizontal: 14 }]}
        {...props}
      />
    </View>
  );
}
