import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { fmtBRL, fmtData } from '../lib/format';
import { faturaStatus } from '../lib/status';
import type { Fatura } from '../lib/types';
import { colors, type } from '../theme/tokens';
import { Badge, Button, Card, Row } from './ui';

export const faturaEmAberto = (f?: Fatura | null) => Boolean(f && ['a_vencer', 'atrasado'].includes(f.status));

/** Acoes de pagamento de uma fatura B2W: PIX copia-e-cola, linha digitavel,
 *  boleto (Asaas) e PDF. So mostra o que a fatura de fato tem. */
export function PagarFatura({ fatura, titulo = 'Pagar fatura' }: { fatura: Fatura; titulo?: string }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [label, tone] = faturaStatus(fatura.status);
  const copiar = async (txt: string, qual: string) => {
    await Clipboard.setStringAsync(txt);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopiado(qual);
    setTimeout(() => setCopiado(null), 2500);
  };
  const pdf = fatura.asaas_pdf_storage_url || fatura.asaas_boleto_url;

  return (
    <Card style={{ gap: 12 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>{titulo}</Text>
        <Badge label={label} tone={tone} />
      </Row>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View>
          <Text style={[type.labelSm, { color: colors.inkSecondary, textTransform: 'uppercase' }]}>Valor</Text>
          <Text style={[type.metricLg, { color: colors.inkPrimary }]}>{fmtBRL(fatura.valor_a_pagar)}</Text>
        </View>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Vencimento {fmtData(fatura.vencimento)}</Text>
      </Row>
      {faturaEmAberto(fatura) && fatura.pix_string ? (
        <Button label={copiado === 'pix' ? 'PIX copiado!' : 'Copiar PIX copia e cola'} icon="qr-code-2" onPress={() => copiar(fatura.pix_string!, 'pix')} />
      ) : null}
      {faturaEmAberto(fatura) && fatura.linha_digitavel ? (
        <Button label={copiado === 'linha' ? 'Código copiado!' : 'Copiar código do boleto'} icon="content-copy" variant="secondary" onPress={() => copiar(fatura.linha_digitavel!, 'linha')} />
      ) : null}
      {pdf ? (
        <Button label="Baixar fatura PDF / 2ª via" icon="download" variant="ghost" onPress={() => WebBrowser.openBrowserAsync(pdf)} />
      ) : null}
      {faturaEmAberto(fatura) && !fatura.pix_string && !fatura.linha_digitavel && !pdf ? (
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>O boleto desta fatura ainda está sendo emitido. Ele aparece aqui assim que ficar pronto.</Text>
      ) : null}
    </Card>
  );
}
