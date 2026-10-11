import { router, type Href } from 'expo-router';
import { Text } from 'react-native';
import { usePerfil } from '../lib/api';
import { colors, type } from '../theme/tokens';
import { Button, Card, type IconName } from './ui';

/**
 * Convites das telas de produto (pedido do dono, 11/10/2026): quem ainda não
 * tem o produto vê o caminho para ter; quem já tem vê, no rodapé, o convite
 * para ter mais. Os caminhos são os mesmos da tela de opções (/comecar).
 */
export function ConviteRodape({ titulo, texto, botao, icon = 'trending-up', destino = '/investir' }: {
  titulo: string; texto: string; botao: string; icon?: IconName; destino?: Href;
}) {
  return (
    <Card style={{ gap: 10, borderColor: `${colors.primary}66` }}>
      <Text style={[type.headlineSm, { color: colors.onSurface }]}>{titulo}</Text>
      <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{texto}</Text>
      <Button label={botao} icon={icon} variant="secondary" onPress={() => router.push(destino)} />
    </Card>
  );
}

/** Botão para dentro de um quadro vazio. */
export function BotaoConvite({ label, icon = 'trending-up', destino = '/investir' }: { label: string; icon?: IconName; destino?: Href }) {
  return <Button label={label} icon={icon} variant="secondary" onPress={() => router.push(destino)} style={{ marginTop: 8, alignSelf: 'stretch' }} />;
}

/** "Assinar energia": retoma a adesão já começada ou começa pela indicação. */
export function useDestinoAssinarEnergia(): Href {
  const { data } = usePerfil();
  return data?.lead || data?.subscriber?.status === 'ativacao' ? '/adesao' : '/indicacao';
}
