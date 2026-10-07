import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, Card, Screen } from '../components/ui';
import { parseQrRecarga, urlCheckoutRecarga } from '../lib/links';
import { colors, radius, type } from '../theme/tokens';

export default function Scan() {
  const [perm, pedir] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const lido = useRef(false);

  const abrir = async (raw: string) => {
    const alvo = parseQrRecarga(raw);
    if (!alvo) {
      setErro('Este QR Code não é de um carregador B2W.');
      lido.current = false;
      return;
    }
    await WebBrowser.openBrowserAsync(urlCheckoutRecarga(alvo.posto, alvo.conector));
    router.back();
  };

  return (
    <Screen>
      {!perm ? null : perm.granted ? (
        <View style={{ height: 320, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 2, borderColor: colors.primary }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (lido.current) return;
              lido.current = true;
              abrir(data);
            }}
          />
        </View>
      ) : (
        <Card style={{ gap: 10 }}>
          <Text style={[type.body, { color: colors.onSurface }]}>Precisamos da câmera para ler o QR Code do carregador.</Text>
          <Button label="Permitir câmera" icon="photo-camera" onPress={pedir} />
        </Card>
      )}
      {erro ? <Text style={[type.bodySm, { color: colors.error }]}>{erro}</Text> : null}
      <Card style={{ gap: 10 }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Ou digite o ID do eletroposto</Text>
        <TextInput
          value={manual}
          onChangeText={setManual}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Cole o link ou o ID impresso no carregador"
          placeholderTextColor={colors.inkMuted}
          style={[type.body, { height: 46, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.borderStrong, color: colors.onSurface, paddingHorizontal: 12 }]}
        />
        <Button label="Continuar" icon="arrow-forward" variant="secondary" disabled={!manual.trim()} onPress={() => abrir(manual)} />
      </Card>
    </Screen>
  );
}
