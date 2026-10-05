import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Linking, Text } from 'react-native';
import { Button, Card, ListItem, Screen, SectionLabel } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { usePerfil } from '../../lib/api';
import { PRIVACIDADE_URL } from '../../lib/links';
import { colors, type } from '../../theme/tokens';

const PAPEL: Record<string, string> = {
  subscriber: 'Assinante', supplier: 'Investidor', originator: 'Embaixador', gerador: 'Gerador',
  admin: 'Equipe B2W', super_admin: 'Equipe B2W', manager: 'Equipe B2W', coordinator: 'Equipe B2W',
};

export default function Mais() {
  const { signOut, session, excluirConta } = useAuth();
  const [excluindo, setExcluindo] = useState(false);
  const { data: perfil } = usePerfil();
  const sair = () => Alert.alert('Sair da conta', 'Deseja sair do app?', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Sair', style: 'destructive', onPress: signOut },
  ]);

  // Decisao do dono (05/10/2026): apaga o login e abre pedido de cancelamento
  // da assinatura para a equipe; contrato, UCs e faturas seguem o contrato.
  const confirmarExclusao = () => Alert.alert(
    'Excluir conta',
    'Seu login no app será apagado e a equipe B2W receberá um pedido de cancelamento da sua assinatura, '
      + 'que segue as regras do contrato (aviso prévio e faturas em aberto). Seus dados de contrato e faturas '
      + 'continuam guardados pelo prazo exigido por lei. Deseja continuar?',
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir conta', style: 'destructive', onPress: async () => {
          setExcluindo(true);
          const erro = await excluirConta();
          setExcluindo(false);
          if (erro) Alert.alert('Não foi possível excluir', erro);
          else Alert.alert('Conta excluída', 'Recebemos seu pedido. A equipe B2W vai entrar em contato para concluir o cancelamento.');
        },
      },
    ],
  );

  return (
    <Screen>
      <Card style={{ gap: 4 }}>
        <Text style={[type.headlineMd, { color: colors.onSurface }]}>{perfil?.name || 'Minha conta'}</Text>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{perfil?.email ?? session?.user.email}</Text>
        <Text style={[type.labelSm, { color: colors.secondary, textTransform: 'uppercase', marginTop: 4 }]}>
          {[perfil?.subscriber && 'Assinante', perfil?.supplier && 'Investidor', perfil?.originator && 'Embaixador'].filter(Boolean).join(' · ') || PAPEL[perfil?.role ?? ''] || 'Cliente'}
        </Text>
      </Card>
      <SectionLabel title="Conecte & ganhe" />
      <ListItem icon="badge" title="Home Connect" subtitle="Indique assinantes e ganhe cashback" onPress={() => router.push('/connect/home')} />
      <ListItem icon="router" title="Drive Connect" subtitle="Sua rede de recargas" onPress={() => router.push('/connect/drive')} />
      <SectionLabel title="Ajuda" />
      <ListItem icon="support-agent" title="Falar com a B2W" subtitle="Atendimento por e-mail" onPress={() => Linking.openURL('mailto:contato@b2wenergia.com.br')} />
      <ListItem icon="public" title="Site B2W Energia" onPress={() => Linking.openURL('https://b2wenergia.com.br')} />
      <ListItem icon="privacy-tip" title="Política de privacidade" onPress={() => WebBrowser.openBrowserAsync(PRIVACIDADE_URL)} />
      <Button label="Sair" icon="logout" variant="ghost" onPress={sair} style={{ marginTop: 8 }} />
      <Button label="Excluir conta" icon="delete-forever" variant="ghost" onPress={confirmarExclusao} loading={excluindo} />
      <Text style={[type.labelSm, { color: colors.inkMuted, textAlign: 'center' }]}>Versão {Constants.expoConfig?.version ?? '—'}</Text>
    </Screen>
  );
}
