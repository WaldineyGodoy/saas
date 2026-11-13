import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Campo } from '../../components/Campo';
import { Button, Card, Icon } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { confirmarIndicador } from '../../lib/api';
import { celularBR, lerIndicacaoPendente } from '../../lib/indicacao';
import { PRIVACIDADE_URL } from '../../lib/links';
import { colors, esquemaAtual, space, type } from '../../theme/tokens';

const SENHA_MINIMA = 8;

/**
 * Criar conta no app (cadastro aberto, 06/10/2026). Dois passos: dados e o
 * código de 6 dígitos que chega no e-mail. Ao confirmar, a sessão abre e o
 * app leva para a pergunta da indicação (login sem produto).
 */
export default function CriarConta() {
  const { criarConta, confirmarCadastro, reenviarCodigoCadastro, entrarSeConfirmado } = useAuth();
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
  const conferindo = useRef(false);

  // Quem toca no link do e-mail confirma a conta no navegador, fora do app, e o
  // código passa a dar "vencido" (13/11/2026). Ao voltar para o app, tenta
  // entrar com a senha que acabou de criar: se a conta já está confirmada, a
  // sessão abre e o app segue sozinho.
  useEffect(() => {
    if (etapa !== 'codigo') return;
    const sub = AppState.addEventListener('change', async (estado) => {
      if (estado !== 'active' || conferindo.current) return;
      conferindo.current = true;
      try { await entrarSeConfirmado(email, senha); } finally { conferindo.current = false; }
    });
    return () => sub.remove();
  }, [etapa, email, senha, entrarSeConfirmado]);

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
    setAviso(`Enviamos um e-mail para ${email.trim().toLowerCase()}. Digite o código ou toque no link do e-mail e volte para cá. Confira também o spam.`);
    setEtapa('codigo');
  };

  const confirmar = async () => {
    setErro(null);
    if (!/^\d{6,10}$/.test(codigo.trim())) return setErro('Digite o código numérico que chegou no e-mail.');
    setEnviando(true);
    const e = await confirmarCadastro(email, codigo);
    if (e && (await entrarSeConfirmado(email, senha))) return setEnviando(false); // já confirmada pelo link
    setEnviando(false);
    if (e) setErro(e);
    // Sem erro a sessão abre e o app segue sozinho.
  };

  const jaConfirmei = async () => {
    setErro(null);
    setEnviando(true);
    const ok = await entrarSeConfirmado(email, senha);
    setEnviando(false);
    if (!ok) setErro('Ainda não recebemos a confirmação. Toque no link do e-mail ou digite o código.');
  };

  const reenviar = async () => {
    setErro(null);
    setEnviando(true);
    // Conta já confirmada (pelo link): o Supabase aceita o reenvio mas não manda
    // nada, e a pessoa fica esperando um e-mail que nunca chega.
    if (await entrarSeConfirmado(email, senha)) return setEnviando(false);
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
              : 'Digite o código que chegou no seu e-mail ou toque no link dele.'}
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
              <Button label="Já confirmei pelo link" icon="mark-email-read" variant="ghost" onPress={jaConfirmei} disabled={enviando} />
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
