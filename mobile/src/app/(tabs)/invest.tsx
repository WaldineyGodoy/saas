import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Badge, Card, Empty, ErrorState, Hero, Icon, Loading, Metric, Row, Screen, SearchInput, SectionLabel } from '../../components/ui';
import { useMinhasUsinas, usePerfil } from '../../lib/api';
import { enderecoCurto, fmtBRL, fmtCiclo, fmtKwh, fmtPct, primeiroNome } from '../../lib/format';
import { usinaStatus } from '../../lib/status';
import { colors, type } from '../../theme/tokens';

export default function Invest() {
  const perfil = usePerfil();
  const usinas = useMinhasUsinas();
  const [busca, setBusca] = useState('');
  const lista = (usinas.data ?? []).filter((u) => {
    const q = busca.trim().toLowerCase();
    return !q || `${u.name} ${enderecoCurto(u.address)}`.toLowerCase().includes(q);
  });

  return (
    <Screen refreshing={usinas.isRefetching} onRefresh={() => usinas.refetch()}>
      <Hero kicker={`Olá, ${primeiroNome(perfil.data?.name)}`} title="Usina de investimento" subtitle="Rentabilize o seu capital gerando energia limpa e renovável." />
      <SearchInput value={busca} onChangeText={setBusca} placeholder="Buscar usina" />
      <SectionLabel title="Portfólio de usinas" aside={`${usinas.data?.length ?? 0} cadastradas`} />
      {usinas.isLoading ? <Loading /> : usinas.error ? <ErrorState error={usinas.error} onRetry={() => usinas.refetch()} /> : lista.length === 0 ? (
        <Empty icon="solar-power" title={busca ? 'Nenhuma usina encontrada' : 'Nenhuma usina no seu portfólio'}
          text={busca ? undefined : perfil.data?.supplier ? 'Suas usinas aparecem aqui após a conexão.' : 'Este login não está vinculado a um cadastro de investidor.'} />
      ) : lista.map((u) => {
        const [label, tone] = usinaStatus(u.status);
        const eficiencia = Number(u.geracao_estimada_kwh) > 0 && u.geracao_mes_kwh != null
          ? (Number(u.geracao_mes_kwh) / Number(u.geracao_estimada_kwh)) * 100 : null;
        const abrir = () => router.push({ pathname: '/invest/[usinaId]', params: { usinaId: u.id } });
        return (
          <Card key={u.id} onPress={abrir} style={{ gap: 12 }}>
            <Row style={{ alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: `${colors.primary}1F`, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bolt" color={colors.primary} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[type.headlineSm, { color: colors.onSurface, flexShrink: 1 }]} numberOfLines={1}>{u.name}</Text>
                  <Badge label={label} tone={tone} />
                </Row>
                <Text style={[type.bodySm, { color: colors.inkSecondary }]} numberOfLines={1}>{enderecoCurto(u.address)}</Text>
              </View>
            </Row>
            <Row>
              <Metric label="Geração do mês" value={fmtKwh(u.geracao_mes_kwh)} unit="kWh" icon="bolt" foot={fmtCiclo(u.mes_referencia)} />
              <Metric label="Receita" value={fmtBRL(u.receita_mes)} icon="speed" iconColor={colors.secondary} foot="Receita do mês" footIcon="verified" />
            </Row>
            <Pressable onPress={abrir} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
                {eficiencia === null ? 'Eficiência: aguardando fechamento' : `Eficiência operacional: ${fmtPct(eficiencia)}`}
              </Text>
              <Row gap={2} style={{ alignItems: 'center' }}>
                <Text style={[type.bodySm, { color: colors.primaryLight }]}>Telemetria & detalhes</Text>
                <Icon name="chevron-right" size={18} color={colors.primaryLight} />
              </Row>
            </Pressable>
          </Card>
        );
      })}
    </Screen>
  );
}
