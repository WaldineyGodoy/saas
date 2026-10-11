import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Button, Card, Icon } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { confirmarIndicador } from '../../lib/api';
import { celularBR, lerIndicacaoPendente } from '../../lib/indicacao';
import { PRIVACIDADE_URL } from '../../lib/links';
import { colors, esquemaAtual, radius, space, type } from '../../theme/tokens';

const SENHA_MINIMA = 8;

/**
 * Criar conta no app (cadastro aberto, 06/10/2026). Dois passos: dados e o
 * código de 6 dígitos que chega no e-mail. Ao confirmar, a sessão abre e o
 * app leva para a pergunta da indicação (login sem produto).
 */
export default function CriarConta() {
  const { criarConta, confirmarCadastro, reenviarCodigoCadastro } = useAuth();
  const insets = useSafeAreaInsets();
  const [etapa, setEtapa] = useState<'dados' | 'codigo'>('dados');
  const [nome, setNome] = useState('');
  const [celular, setCelular] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [indicadoPor, setIndicadoPor] = useState<string | null>(null);

  // Veio por um link de indicação: mostra de quem, para a pessoa reconhecer.
  useEffect(() => {
    lerIndicacaoPendente().then(async (p) => {
      if (!p) return;
      try {
        const r = await confirmarIndicador(p.id);
        if (r?.valido && r.primeiro_nome) setIndicadoPor(r.primeiro_nome);
      } catch { /* sem nome: segue sem o aviso */ }
    });
  }, []);

  const enviarDados = async () => {
    setErro(null);
    if (nome.trim().split(/\s+/).length < 2) return setErro('Informe nome e sobrenome.');
    const cel = celularBR(celular);
    if (!cel) return setErro('Celular inválido. Informe DDD + número.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErro('E-mail inválido.');
    if (senha.length < SENHA_MINIMA) return setErro(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
    setEnviando(true);
    const e = await criarConta({ nome, celular: cel, email, senha });
    setEnviando(false);
    if (e) return setErro(e);
    setAviso(`Enviamos um código para ${email.trim().toLowerCase()}. Confira também o spam.`);
    setEtapa('codigo');
  };

  const confirmar = async () => {
    setErro(null);
    if (!/^\d{6,10}$/.test(codigo.trim())) return setErro('Digite o código numérico que chegou no e-mail.');
    setEnviando(true);
    const e = await confirmarCadastro(email, codigo);
    setEnviando(false);
    if (e) setErro(e);
    // Sem erro a sessão abre e o app segue sozinho.
  };

  const reenviar = async () => {
    setErro(null);
    setEnviando(true);
    const e = await reenviarCodigoCadastro(email);
    setEnviando(false);
    if (e) setErro(e);
    else setAviso('Código reenviado. Confira também o spam.');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style={esquemaAtual === 'light' ? 'dark' : 'light'} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.lg, paddingTop: insets.top + space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }}>
          <Text style={[type.headlineLg, { color: colors.inkPrimary }]}>Criar conta</Text>
          <Text style={[type.body, { color: colors.inkSecondary }]}>
            {etapa === 'dados'
              ? 'Crie sua conta para simular e assinar a energia com desconto.'
              : 'Digite o código que chegou no seu e-mail.'}
          </Text>
        </View>

        {indicadoPor && etapa === 'dados' ? (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.secondary }}>
            <Icon name="volunteer-activism" color={colors.secondary} />
            <Text style={[type.body, { color: colors.onSurface, flex: 1 }]}>Você foi indicado por <Text style={{ fontWeight: '700' }}>{indicadoPor}</Text>.</Text>
          </Card>
        ) : null}

        <Card style={{ gap: space.md }}>
          {etapa === 'dados' ? (
            <>
              <Campo label="Nome completo" value={nome} onChangeText={setNome} autoCapitalize="words" autoComplete="name" textContentType="name" />
              <Campo label="Celular (WhatsApp)" value={celular} onChangeText={setCelular} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="(84) 99999-9999" />
              <Campo label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
              <Campo label="Senha" value={senha} onChangeText={setSenha} secureTextEntry autoComplete="new-password" textContentType="newPassword" onSubmitEditing={enviarDados} />
              {erro ? <Text style={[type.bodySm, { color: colors.error }]}>{erro}</Text> : null}
              <Button label="Criar conta" icon="person-add" onPress={enviarDados} loading={enviando} />
              <Text style={[type.bodySm, { color: colors.inkMuted, textAlign: 'center' }]}>
                Ao criar a conta você concorda com a nossa política de privacidade.
              </Text>
              <Button label="Política de privacidade" variant="ghost" onPress={() => WebBrowser.openBrowserAsync(PRIVACIDADE_URL)} style={{ alignSelf: 'center', minHeight: 36 }} />
            </>
          ) : (
            <>
              {aviso ? <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{aviso}</Text> : null}
              <Campo label="Código" value={codigo} onChangeText={(t) => setCodigo(t.replace(/\D/g, ''))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={10} onSubmitEditing={confirmar} />
              {erro ? <Text style={[type.bodySm, { color: colors.error }]}>{erro}</Text> : null}
              <Button label="Confirmar" icon="check" onPress={confirmar} loading={enviando} />
              <Button label="Reenviar código" variant="ghost" onPress={reenviar} disabled={enviando} />
              <Button label="Corrigir e-mail" variant="ghost" onPress={() => { setEtapa('dados'); setCodigo(''); setErro(null); }} />
            </>
          )}
          <Button label="Já tenho conta" icon="arrow-back" variant="ghost" onPress={() => router.back()} />
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
