import { router, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Card, Hero, Icon, Screen, type IconName } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { usePerfil } from '../lib/api';
import { confirmar } from '../lib/dialogo';
import { guardarObjetivo, type Objetivo } from '../lib/objetivo';
import { colors, space, type } from '../theme/tokens';

type Opcao = { objetivo: Objetivo; icon: IconName; titulo: string; texto: string; destino: Href; trocar?: boolean };

const OPCOES: Opcao[] = [
  { objetivo: 'energia', icon: 'bolt', titulo: 'Assinar energia', texto: 'Desconto na conta de luz, sem obra e sem instalar nada.', destino: '/indicacao' },
  // A recarga é uma aba: troca a tela em vez de empilhar.
  { objetivo: 'recarga', icon: 'ev-station', titulo: 'Fazer minha primeira recarga', texto: 'Encontre um eletroposto ou escaneie o QR Code do carregador.', destino: '/eletroposto', trocar: true },
  { objetivo: 'parceiro', icon: 'handshake', titulo: 'Ser um Parceiro Power', texto: 'Indique clientes B2W e ganhe comissão.', destino: '/parceiro' },
  { objetivo: 'investir', icon: 'solar-power', titulo: 'Ter renda com usinas e eletropostos', texto: 'Cotas, consórcio, financiamento, arrendamento de área ou locação de vagas.', destino: '/investir' },
];

/**
 * Primeira tela da conta nova (decisão do dono, 11/10/2026): em vez de
 * presumir que todo login novo é um futuro assinante de energia, pergunta o
 * que a pessoa quer fazer.
 */
export default function Comecar() {
  const { session, signOut } = useAuth();
  const { data: perfil } = usePerfil();
  // Adesão de energia já começada: retoma de onde parou, sem perguntar a
  // indicação de novo.
  const aderindo = Boolean(perfil?.lead) || perfil?.subscriber?.status === 'ativacao';
  const opcoes = OPCOES.map((o) => (o.objetivo === 'energia' && aderindo
    ? { ...o, texto: 'Sua adesão está em andamento. Continue de onde parou.', destino: '/adesao' as Href }
    : o));

  const escolher = async (o: Opcao) => {
    await guardarObjetivo(session?.user?.id, o.objetivo);
    if (o.trocar) router.replace(o.destino);
    else router.push(o.destino);
  };

  return (
    <Screen>
      <Hero kicker="Bem-vindo à B2W" title="O que você quer fazer?" subtitle="Escolha por onde começar. Depois você pode explorar as outras opções pelo início." />
      {opcoes.map((o) => (
        <Card key={o.objetivo} onPress={() => escolher(o)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: `${colors.primary}1F`, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={o.icon} color={colors.primary} size={24} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.headlineSm, { color: colors.onSurface }]}>{o.titulo}</Text>
            <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{o.texto}</Text>
          </View>
          <Icon name="chevron-right" color={colors.inkMuted} />
        </Card>
      ))}
      <Pressable
        onPress={() => confirmar('Sair da conta', `Sair de ${session?.user?.email ?? 'sua conta'}?`, 'Sair', signOut)}
        style={{ alignSelf: 'center', padding: 10 }}
        accessibilityRole="button"
      >
        <Text style={[type.bodySm, { color: colors.inkMuted }]}>Entrar com outra conta</Text>
      </Pressable>
    </Screen>
  );
}
