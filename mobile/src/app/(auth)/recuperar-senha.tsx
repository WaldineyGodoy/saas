import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { colors, radius, space, type } from '../../theme/tokens';

const SENHA_MINIMA = 8;

/**
 * Recuperar senha por CODIGO, nao por link: o link do e-mail abre o site e
 * nao volta para o app (e falha quando o cliente le o e-mail no computador).
 * O cliente pede o codigo, recebe no e-mail (template de recuperacao do
 * Supabase com {{ .Token }}) e digita aqui junto com a senha nova.
 */
export default function RecuperarSenha() {
  const { resetPassword, redefinirSenha } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [etapa, setEtapa] = useState<'email' | 'codigo'>('email');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const pedirCodigo = async () => {
    setErro(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErro('Digite o e-mail cadastrado no seu contrato B2W.');
    setEnviando(true);
    const e = await resetPassword(email);
    setEnviando(false);
    if (e) return setErro(e);
    setAviso(`Enviamos um código para ${email.trim().toLowerCase()}. Ele vale por 1 hora; confira também o spam.`);
    setEtapa('codigo');
  };

  const salvar = async () => {
    setErro(null);
    if (!/^\d{6,10}$/.test(codigo.trim())) return setErro('Digite o código numérico que chegou no e-mail.');
    if (senha.length < SENHA_MINIMA) return setErro(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
    if (senha !== confirma) return setErro('As senhas não conferem.');
    setEnviando(true);
    const e = await redefinirSenha(email, codigo, senha);
    setEnviando(false);
    if (e) setErro(e);
    // Sem erro a sessao abre e o app vai sozinho para a tela inicial.
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.lg, paddingTop: insets.top + space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Text style={[type.headlineLg, { color: colors.inkPrimary }]}>Recuperar senha</Text>
          <Text style={[type.body, { color: colors.inkSecondary }]}>
            {etapa === 'email'
              ? 'Informe seu e-mail. Vamos enviar um código para você criar uma senha nova.'
              : 'Digite o código que chegou no seu e-mail e escolha a senha nova.'}
          </Text>
        </View>

        <Card style={{ gap: space.md }}>
          {etapa === 'email' ? (
            <>
              <Campo label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" onSubmitEditing={pedirCodigo} />
              {erro ? <Text style={[type.bodySm, { color: colors.error }]}>{erro}</Text> : null}
              <Button label="Enviar código" icon="mail" onPress={pedirCodigo} loading={enviando} />
            </>
          ) : (
            <>
              {aviso ? <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{aviso}</Text> : null}
              <Campo label="Código" value={codigo} onChangeText={(t) => setCodigo(t.replace(/\D/g, ''))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={10} />
              <Campo label="Senha nova" value={senha} onChangeText={setSenha} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
              <Campo label="Confirme a senha" value={confirma} onChangeText={setConfirma} secureTextEntry autoComplete="new-password" textContentType="newPassword" onSubmitEditing={salvar} />
              {erro ? <Text style={[type.bodySm, { color: colors.error }]}>{erro}</Text> : null}
              <Button label="Salvar senha nova" icon="lock-reset" onPress={salvar} loading={enviando} />
              <Button label="Reenviar código" variant="ghost" onPress={pedirCodigo} disabled={enviando} />
            </>
          )}
          <Button label="Voltar para o login" icon="arrow-back" variant="ghost" onPress={() => router.back()} />
        </Card>
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
