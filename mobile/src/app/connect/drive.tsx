import { router } from 'expo-router';
import { Text } from 'react-native';
import { LinkIndicacao } from '../../components/LinkIndicacao';
import { Badge, Button, Card, Empty, ErrorState, Hero, Loading, Metric, Row, Screen, SectionLabel } from '../../components/ui';
import { useMeusEletropostos, usePerfil } from '../../lib/api';
import { enderecoCurto, fmtBRL, fmtKwh, fmtPct } from '../../lib/format';
import { linkIndicacao, STATUS_PODE_INDICAR, textoIndicacao } from '../../lib/links';
import { eletropostoStatus } from '../../lib/status';
import { colors, type } from '../../theme/tokens';

export default function DriveConnect() {
  const perfil = usePerfil();
  const postos = useMeusEletropostos();
  const sub = perfil.data?.subscriber ?? null;
  const link = sub && STATUS_PODE_INDICAR.includes(sub.status) ? linkIndicacao(sub) : '';
  const kwh = (postos.data ?? []).reduce((a, p) => a + (Number(p.kwh_mes) || 0), 0);
  const receita = (postos.data ?? []).reduce((a, p) => a + (Number(p.receita_mes) || 0) * ((Number(p.percentual) || 0) / 100), 0);

  if (perfil.isLoading) return <Loading />;

  return (
    <Screen refreshing={postos.isRefetching} onRefresh={() => postos.refetch()}>
      <Hero title="Drive Connect" subtitle="Ganhe todo mês com a sua rede de recarga de veículos elétricos." />
      <SectionLabel title="Meu eletroposto" aside={postos.data?.length ? `${postos.data.length} hub(s)` : undefined} />
      {postos.isLoading ? <Loading /> : postos.error ? <ErrorState error={postos.error} onRetry={() => postos.refetch()} /> : (postos.data ?? []).length === 0 ? (
        <Empty icon="ev-station" title="Você ainda não tem cotas de eletroposto" text="Quando você investir em um hub B2W, a operação dele aparece aqui."
          action={<Button label="Ver eletropostos" icon="ev-station" variant="secondary" onPress={() => router.navigate('/eletroposto')} style={{ marginTop: 8 }} />} />
      ) : postos.data!.map((p) => {
        const [label, tone] = eletropostoStatus(p.status);
        return (
          <Card key={p.id} style={{ gap: 12 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[type.headlineSm, { color: colors.onSurface, flexShrink: 1 }]} numberOfLines={1}>{p.nome}</Text>
              <Badge label={label} tone={tone} />
            </Row>
            <Text style={[type.bodySm, { color: colors.inkSecondary, marginTop: -6 }]}>
              {[enderecoCurto(p.endereco), p.potencia_kw ? `${fmtKwh(p.potencia_kw)} kW` : null].filter(Boolean).join(' · ')}
            </Text>
            <Row>
              <Metric label="Carga / mês" value={fmtKwh(p.kwh_mes)} unit="kWh" icon="bolt" />
              <Metric label="Participação" value={fmtPct(p.percentual)} icon="pie-chart" iconColor={colors.secondary} foot={`Receita ${fmtBRL((Number(p.receita_mes) || 0) * ((Number(p.percentual) || 0) / 100))}`} />
            </Row>
          </Card>
        );
      })}
      {(postos.data ?? []).length > 1 && (
        <Row>
          <Metric label="Consumo da rede" value={fmtKwh(kwh)} unit="kWh" icon="bolt" />
          <Metric label="Rendimentos" value={fmtBRL(receita)} icon="speed" iconColor={colors.secondary} foot="Sua parte no mês" footIcon="verified" />
        </Row>
      )}
      <SectionLabel title="Indique motoristas" />
      {link ? (
        <LinkIndicacao link={link} texto={textoIndicacao(sub?.name, link)} />
      ) : (
        <Empty icon="person-add" title="Link de indicação indisponível" text="O link é liberado para assinantes com contrato assinado." />
      )}
    </Screen>
  );
}
