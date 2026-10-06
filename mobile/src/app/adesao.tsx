import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Hero, Icon, Loading, Screen, type IconName } from '../components/ui';
import { usePerfil } from '../lib/api';
import { lerVisitaAdesao, urlAdesaoSite } from '../lib/adesao';
import { colors, space, type } from '../theme/tokens';

const PASSOS: { icon: IconName; titulo: string; texto: string }[] = [
  { icon: 'receipt-long', titulo: 'Sua conta de energia', texto: 'Número da UC e titular, direto da conta.' },
  { icon: 'person', titulo: 'Seus dados', texto: 'CPF, endereço e o melhor dia de vencimento.' },
  { icon: 'draw', titulo: 'Contrato', texto: 'Você assina pelo celular, sem papel.' },
  { icon: 'bolt', titulo: 'Ativação', texto: 'A B2W cuida da troca com a distribuidora.' },
];

/**
 * Adesão do cliente novo. Provisório até as telas próprias (etapa 3 do
 * plano): abre o /contrato do site com a visita registrada, que atribui a
 * indicação pela sessão que concluiu.
 */
export default function Adesao() {
  const perfil = usePerfil();
  const qc = useQueryClient();
  const [visita, setVisita] = useState<string | null | undefined>(undefined);

  useEffect(() => { lerVisitaAdesao().then(setVisita); }, []);

  if (perfil.isLoading || visita === undefined) return <Loading />;
  const indicador = perfil.data?.lead?.indicador_nome;

  const abrir = async () => {
    await WebBrowser.openBrowserAsync(urlAdesaoSite(visita));
    qc.invalidateQueries({ queryKey: ['perfil'] });
  };

  return (
    <Screen>
      <Hero kicker="Energia por assinatura" title="Vamos fazer sua adesão" subtitle="Leva poucos minutos. Tenha à mão uma conta de energia recente." />
      {indicador ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.secondary }}>
          <Icon name="volunteer-activism" color={colors.secondary} />
          <Text style={[type.body, { color: colors.onSurface, flex: 1 }]}>Indicação de <Text style={{ fontWeight: '700' }}>{indicador}</Text> registrada.</Text>
        </Card>
      ) : null}
      <Card style={{ gap: space.md }}>
        {PASSOS.map((p, i) => (
          <View key={p.titulo} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <Icon name={p.icon} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: colors.onSurface }]}>{i + 1}. {p.titulo}</Text>
              <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{p.texto}</Text>
            </View>
          </View>
        ))}
      </Card>
      <Button label="Começar a adesão" icon="arrow-forward" onPress={abrir} />
    </Screen>
  );
}
