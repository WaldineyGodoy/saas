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
import { BotaoConvite, ConviteRodape } from '../../components/Convites';
import { proximos, RAIO_PROXIMO_KM } from '../../lib/distancia';
import { useLocalizacao } from '../../lib/localizacao';

const STATUS_RECARGA: Record<string, string> = { paid: 'Paga', pending_payment: 'Aguardando pagamento', failed: 'Falhou' };

export default function Eletroposto() {
  const postos = useEletropostosPublicos();
  const recargas = useMinhasRecargas();
  const [busca, setBusca] = useState('');
  const { ponto } = useLocalizacao();
  const q = busca.trim().toLowerCase();
  // Buscando: a rede inteira. Sem busca e com localização: só os de até 30 km.
  const perto = !q && ponto;
  const lista = q
    ? (postos.data ?? []).filter((p) => `${p.nome} ${enderecoCurto(p.endereco)}`.toLowerCase().includes(q)).map((item) => ({ item, km: null as number | null }))
    : perto
      ? proximos(postos.data ?? [], ponto)
      : (postos.data ?? []).map((item) => ({ item, km: null as number | null }));
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
      <SectionLabel
        title={perto ? `Perto de você (até ${RAIO_PROXIMO_KM} km)` : 'Eletropostos B2W'}
        aside={perto ? `${lista.length} de ${postos.data?.length ?? 0}` : `${postos.data?.length ?? 0} operando`}
      />
      {postos.isLoading ? <Loading /> : postos.error ? <ErrorState error={postos.error} onRetry={refresh} /> : lista.length === 0 ? (
        <Empty
          icon="ev-station"
          title={q ? 'Nenhum eletroposto encontrado' : perto ? 'Nenhum eletroposto perto de você' : 'Nenhum eletroposto operando ainda'}
          text={q ? 'Confira o nome ou o bairro digitado.' : 'Que tal ter o seu? Ganhe com cada recarga e leve a rede B2W para a sua região.'}
          action={q ? undefined : <BotaoConvite label="Ter renda com usinas e eletropostos" icon="ev-station" />}
        />
      ) : lista.map(({ item: p, km }) => {
        const [label, tone] = eletropostoStatus(p.status);
        return (
          <ListItem key={p.id} icon="ev-station" title={p.nome}
            subtitle={[km != null ? `${km.toFixed(1).replace('.', ',')} km` : null, enderecoCurto(p.endereco), p.potencia_kw ? `${fmtKwh(p.potencia_kw)} kW` : null, p.tarifa_kwh ? `${fmtBRL(p.tarifa_kwh)}/kWh` : null].filter(Boolean).join(' · ')}
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

      {lista.length > 0 && !q ? (
        <ConviteRodape titulo="Tenha seu próprio eletroposto" texto="Ganhe com cada recarga da rede B2W na sua região." botao="Quero um eletroposto" icon="ev-station" />
      ) : null}
    </Screen>
  );
}
