import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Button, Card, ListItem, Row, Screen, SectionLabel } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { usePerfil } from '../../lib/api';
import { avisar, confirmar } from '../../lib/dialogo';
import { iniciais } from '../../lib/format';
import { PRIVACIDADE_URL } from '../../lib/links';
import { NOVIDADES_DA_VERSAO } from '../../lib/versao';
import { colors, type } from '../../theme/tokens';

const PAPEL: Record<string, string> = {
  subscriber: 'Assinante', supplier: 'Investidor', originator: 'Embaixador', gerador: 'Gerador',
  admin: 'Equipe B2W', super_admin: 'Equipe B2W', manager: 'Equipe B2W', coordinator: 'Equipe B2W',
};

export default function Mais() {
  const { signOut, session, excluirConta } = useAuth();
  const [excluindo, setExcluindo] = useState(false);
  const { data: perfil } = usePerfil();
  const sair = () => confirmar('Sair da conta', 'Deseja sair do app?', 'Sair', signOut);

  // Decisao do dono (05/10/2026): apaga o login e abre pedido de cancelamento
  // da assinatura para a equipe; contrato, UCs e faturas seguem o contrato.
  const confirmarExclusao = () => confirmar(
    'Excluir conta',
    'Seu login no app será apagado e a equipe B2W receberá um pedido de cancelamento da sua assinatura, '
      + 'que segue as regras do contrato (aviso prévio e faturas em aberto). Seus dados de contrato e faturas '
      + 'continuam guardados pelo prazo exigido por lei. Deseja continuar?',
    'Excluir conta',
    async () => {
      setExcluindo(true);
      const erro = await excluirConta();
      setExcluindo(false);
      if (erro) avisar('Não foi possível excluir', erro);
      else avisar('Conta excluída', 'Recebemos seu pedido. A equipe B2W vai entrar em contato para concluir o cancelamento.');
    },
  );

  return (
    <Screen>
      <Card style={{ gap: 12 }}>
        <Row style={{ alignItems: 'center', gap: 14 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: `${colors.primary}1F`, borderWidth: 1, borderColor: `${colors.primary}40`, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[type.headlineMd, { color: colors.primary, fontSize: 17 }]}>{iniciais(perfil?.name)}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.headlineMd, { color: colors.onSurface }]} numberOfLines={1}>{perfil?.name || 'Minha conta'}</Text>
            <Text style={[type.bodySm, { color: colors.inkSecondary }]} numberOfLines={1}>{perfil?.email ?? session?.user.email}</Text>
            <Text style={[type.labelSm, { color: colors.secondary, textTransform: 'uppercase', marginTop: 2 }]}>
              {[perfil?.subscriber && 'Assinante', perfil?.supplier && 'Investidor', perfil?.originator && 'Embaixador'].filter(Boolean).join(' · ') || PAPEL[perfil?.role ?? ''] || 'Cliente'}
            </Text>
          </View>
        </Row>
      </Card>
      <SectionLabel title="Conecte & ganhe" />
      <ListItem icon="diversity-3" iconColor={colors.primary} title="Home Connect" subtitle="Indique assinantes e ganhe cashback" onPress={() => router.push('/connect/home')} />
      <ListItem icon="electric-car" iconColor={colors.accentConnect} title="Drive Connect" subtitle="Sua rede de recargas" onPress={() => router.push('/connect/drive')} />
      <SectionLabel title="Ajuda & institucional" />
      <ListItem icon="support-agent" iconColor={colors.accentEnergy} title="Falar com a B2W" subtitle="Atendimento por e-mail" onPress={() => Linking.openURL('mailto:contato@b2wenergia.com.br')} />
      <ListItem icon="public" iconColor={colors.accentEnergy} title="Site B2W Energia" subtitle="b2wenergia.com.br" onPress={() => Linking.openURL('https://b2wenergia.com.br')} />
      <ListItem icon="verified-user" iconColor={colors.statusVerified} title="Política de privacidade" subtitle="Seus dados e privacidade" onPress={() => WebBrowser.openBrowserAsync(PRIVACIDADE_URL)} />
      <Button label="Sair da conta" icon="logout" variant="secondary" onPress={sair} style={{ marginTop: 8 }} />
      <Button label="Excluir conta" icon="delete-outline" variant="danger" onPress={confirmarExclusao} loading={excluindo} />
      <Text style={[type.labelSm, { color: colors.inkMuted, textAlign: 'center', marginTop: 4 }]}>Versão {Constants.expoConfig?.version ?? '—'}</Text>
      <Text style={[type.bodySm, { color: colors.inkMuted, textAlign: 'center' }]}>{NOVIDADES_DA_VERSAO}</Text>
    </Screen>
  );
}
