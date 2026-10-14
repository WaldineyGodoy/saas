import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Button, Card, Hero, Icon, Screen, type IconName } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { avisar, confirmar } from '../lib/dialogo';
import { PRIVACIDADE_URL } from '../lib/links';
import { colors, space, type } from '../theme/tokens';

const EMAIL_SUPORTE = 'contato@b2wenergia.com.br';

const APAGADO: { icon: IconName; texto: string }[] = [
  { icon: 'person-off', texto: 'Seu login (e-mail e senha) e o acesso ao app B2W Energia.' },
  { icon: 'link-off', texto: 'O vínculo do app com o seu cadastro de assinante, investidor ou parceiro.' },
];

const GUARDADO: { icon: IconName; texto: string }[] = [
  { icon: 'description', texto: 'Contrato, unidades consumidoras, faturas e pagamentos, pelo prazo exigido por lei (obrigações fiscais e contratuais).' },
  { icon: 'history', texto: 'O histórico de atendimento ligado a esses registros.' },
];

/**
 * Exclusão de conta (exigência da Google Play: endereço na internet onde a
 * pessoa pede a exclusão, além do botão no app). Pública: explica o que é
 * apagado e o que fica, e quem estiver logado exclui aqui mesmo, pelo mesmo
 * caminho do botão de "Mais" (excluir-conta-app). Sem login, entra na conta
 * ou pede por e-mail.
 */
export default function ExcluirConta() {
  const { session, excluirConta } = useAuth();
  const [excluindo, setExcluindo] = useState(false);
  const [concluido, setConcluido] = useState(false);

  const excluir = () => confirmar(
    'Excluir conta',
    'Seu login será apagado e, se você for assinante, abriremos o pedido de cancelamento da assinatura, '
      + 'que segue as regras do contrato. Deseja continuar?',
    'Excluir conta',
    async () => {
      setExcluindo(true);
      const erro = await excluirConta();
      setExcluindo(false);
      if (erro) avisar('Não foi possível excluir', erro);
      else setConcluido(true);
    },
  );

  const lista = (itens: { icon: IconName; texto: string }[], cor: string) => itens.map((i) => (
    <View key={i.texto} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Icon name={i.icon} color={cor} />
      <Text style={[type.body, { color: colors.onSurface, flex: 1 }]}>{i.texto}</Text>
    </View>
  ));

  if (concluido) {
    return (
      <Screen>
        <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
          <Icon name="check-circle" size={44} color={colors.secondary} />
          <Text style={[type.headlineMd, { color: colors.onSurface, textAlign: 'center' }]}>Conta excluída</Text>
          <Text style={[type.body, { color: colors.inkSecondary, textAlign: 'center' }]}>
            Seu login foi apagado. Se você era assinante, a equipe B2W vai entrar em contato para concluir o cancelamento.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Hero kicker="B2W Energia" title="Excluir sua conta" subtitle="Como pedir a exclusão da sua conta do app B2W Energia e o que acontece com os seus dados." />

      <Card style={{ gap: space.md }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Como excluir</Text>
        <Text style={[type.body, { color: colors.inkSecondary }]}>
          No app: toque em <Text style={{ fontWeight: '700' }}>Mais</Text> e depois em <Text style={{ fontWeight: '700' }}>Excluir conta</Text>. Ou faça por aqui:
        </Text>
        {session ? (
          <>
            <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{`Conta conectada: ${session.user.email ?? ''}`}</Text>
            <Button label="Excluir minha conta" icon="delete-forever" onPress={excluir} loading={excluindo} />
          </>
        ) : (
          <Button label="Entrar para excluir a conta" icon="login" onPress={() => router.push('/login')} />
        )}
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
          {`Sem acesso à conta? Peça pelo e-mail ${EMAIL_SUPORTE}, a partir do e-mail cadastrado.`}
        </Text>
        <Button label="Pedir por e-mail" icon="mail-outline" variant="secondary"
          onPress={() => Linking.openURL(`mailto:${EMAIL_SUPORTE}?subject=${encodeURIComponent('Excluir minha conta B2W Energia')}`)} />
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>O que é apagado</Text>
        {lista(APAGADO, colors.error)}
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>O que fica guardado</Text>
        {lista(GUARDADO, colors.secondary)}
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
          Se você é assinante, excluir a conta abre o pedido de cancelamento da assinatura, que segue o contrato (aviso prévio e faturas em aberto).
          Dados de simulação ou de contato também podem ser apagados a pedido, pelo e-mail acima.
        </Text>
        <Button label="Política de privacidade" variant="ghost" onPress={() => Linking.openURL(PRIVACIDADE_URL)} />
      </Card>
    </Screen>
  );
}
