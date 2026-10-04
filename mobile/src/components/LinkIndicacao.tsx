import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Linking, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors, type } from '../theme/tokens';
import { Button, Card, Row } from './ui';

export function LinkIndicacao({ link, texto, bonus }: { link: string; texto: string; bonus?: string }) {
  const [copiado, setCopiado] = useState(false);
  const [qr, setQr] = useState(false);
  const copiar = async () => {
    await Clipboard.setStringAsync(link);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };
  return (
    <Card style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Seu link de indicação</Text>
        {bonus ? <Text style={[type.labelSm, { color: colors.secondary }]}>{bonus}</Text> : null}
      </Row>
      <View style={{ backgroundColor: colors.surface, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.borderSubtle }}>
        <Text style={[type.bodySm, { color: colors.inkPrimary, fontFamily: 'JetBrainsMono_500Medium' }]} selectable numberOfLines={2}>{link}</Text>
      </View>
      <Row>
        <Button label={copiado ? 'Copiado!' : 'Copiar'} icon="content-copy" variant="secondary" onPress={copiar} style={{ flex: 1 }} />
        <Button label={qr ? 'Ocultar QR' : 'QR Code'} icon="qr-code-2" variant="secondary" onPress={() => setQr((v) => !v)} style={{ flex: 1 }} />
      </Row>
      {qr && (
        <View style={{ alignItems: 'center', padding: 16, backgroundColor: '#fff', borderRadius: 12 }}>
          <QRCode value={link} size={200} />
        </View>
      )}
      <Row>
        <Button label="WhatsApp" icon="chat" onPress={() => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(texto)}`)} style={{ flex: 1 }} />
        <Button label="Compartilhar" icon="share" variant="ghost" onPress={() => Share.share({ message: texto })} style={{ flex: 1 }} />
      </Row>
    </Card>
  );
}
