import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Badge, Button, Card, Empty, ErrorState, Hero, KeyValue, ListItem, Loading, Screen, SearchInput, SectionLabel } from '../../components/ui';
import { useEletropostosPublicos, useMinhasRecargas } from '../../lib/api';
import { enderecoCurto, fmtBRL, fmtData, fmtKwh } from '../../lib/format';
import { eletropostoStatus } from '../../lib/status';
import { colors, type } from '../../theme/tokens';
import * as WebBrowser from 'expo-web-browser';
import { urlCheckoutRecarga } from '../../lib/links';

const STATUS_RECARGA: Record<string, string> = { paid: 'Paga', pending_payment: 'Aguardando pagamento', failed: 'Falhou' };

export default function Eletroposto() {
  const postos = useEletropostosPublicos();
  const recargas = useMinhasRecargas();
  const [busca, setBusca] = useState('');
  const lista = (postos.data ?? []).filter((p) => {
    const q = busca.trim().toLowerCase();
    return !q || `${p.nome} ${enderecoCurto(p.endereco)}`.toLowerCase().includes(q);
  });
  const refresh = () => { postos.refetch(); recargas.refetch(); };

  return (
    <Screen refreshing={postos.isRefetching || recargas.isRefetching} onRefresh={refresh}>
      <Hero kicker="Rede Drive Connect · Mobilidade B2W" title="Eletroposto Drive Connect" subtitle="Recarga com descontos exclusivos da rede B2W." />
      <Card style={{ gap: 10, borderColor: `${colors.primary}66` }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Iniciar recarga</Text>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Aponte a câmera para o QR Code do carregador. O pagamento é por PIX ou cartão.</Text>
        <Button label="Escanear QR Code" icon="qr-code-scanner" onPress={() => router.push('/scan')} />
      </Card>

      <SearchInput value={busca} onChangeText={setBusca} placeholder="Buscar eletroposto ou bairro" />
      <SectionLabel title="Eletropostos B2W" aside={`${postos.data?.length ?? 0} operando`} />
      {postos.isLoading ? <Loading /> : postos.error ? <ErrorState error={postos.error} onRetry={refresh} /> : lista.length === 0 ? (
        <Empty icon="ev-station" title={busca ? 'Nenhum eletroposto encontrado' : 'Nenhum eletroposto operando ainda'} text="Novos hubs da rede aparecem aqui assim que entram em operação." />
      ) : lista.map((p) => {
        const [label, tone] = eletropostoStatus(p.status);
        return (
          <ListItem key={p.id} icon="ev-station" title={p.nome}
            subtitle={[enderecoCurto(p.endereco), p.potencia_kw ? `${fmtKwh(p.potencia_kw)} kW` : null, p.tarifa_kwh ? `${fmtBRL(p.tarifa_kwh)}/kWh` : null].filter(Boolean).join(' · ')}
            right={<Badge label={label} tone={tone} />}
            onPress={() => WebBrowser.openBrowserAsync(urlCheckoutRecarga(p.id, '1'))} />
        );
      })}

      <SectionLabel title="Minhas recargas" />
      {recargas.isLoading ? <Loading /> : (recargas.data ?? []).length === 0 ? (
        <Empty icon="history" title="Nenhuma recarga ainda" text="Suas recargas pagas pelo app aparecem aqui." />
      ) : (
        <Card style={{ paddingVertical: 6 }}>
          {recargas.data!.map((r) => (
            <KeyValue key={r.id} k={`${fmtData(r.created_at)} · ${r.eletroposto_nome ?? 'Eletroposto'} · ${STATUS_RECARGA[r.status] ?? r.status}`} v={fmtBRL(r.valor)} />
          ))}
        </Card>
      )}
    </Screen>
  );
}
