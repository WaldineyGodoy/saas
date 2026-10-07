import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { BarChart } from '../../components/BarChart';
import { Badge, Card, Divider, Empty, ErrorState, KeyValue, Loading, Metric, Row, Screen, SectionLabel } from '../../components/ui';
import { useUsinaDetalhe } from '../../lib/api';
import { enderecoCurto, fmtBRL, fmtCiclo, fmtKwh, fmtPct, mesCurto, variacao } from '../../lib/format';
import { usinaStatus } from '../../lib/status';
import { colors, type } from '../../theme/tokens';

export default function UsinaDetalhe() {
  const { usinaId } = useLocalSearchParams<{ usinaId: string }>();
  const q = useUsinaDetalhe(usinaId);

  if (q.isLoading) return <Loading />;
  if (q.error) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  if (!q.data) return <Screen><Empty title="Usina não encontrada" text="Ela não pertence a este login." /></Screen>;

  const { usina, producao } = q.data;
  const atual = producao[0];
  const [label, tone] = usinaStatus(usina.status);
  const investido = Number(usina.valor_investido) || 0;
  const receita = Number(atual?.saldo_receber) || 0;
  const rentab = investido > 0 && atual ? (receita / investido) * 100 : null;
  const vsPrev = variacao(atual?.geracao_mensal_kwh, atual?.geracao_prevista);
  const acumulado = producao.reduce((a, p) => a + (Number(p.saldo_receber) || 0), 0);
  const mediaMensal = producao.length ? acumulado / producao.length : 0;
  const paybackAnos = mediaMensal > 0 ? investido / mediaMensal / 12 : null;
  const hist = [...producao].reverse();
  const precoKwh = atual && Number(atual.geracao_mensal_kwh) > 0 ? Number(atual.faturamento_mensal) / Number(atual.geracao_mensal_kwh) : null;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Stack.Screen options={{ title: usina.name }} />
      <Card style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[type.labelSm, { color: colors.secondary, textTransform: 'uppercase' }]}>Ativo solar · usina fotovoltaica</Text>
          <Badge label={label} tone={tone} />
        </Row>
        <Text style={[type.headlineMd, { color: colors.onSurface }]}>
          {usina.name}{usina.potencia_kwp ? ` · ${fmtKwh(usina.potencia_kwp)} kWp` : ''}
        </Text>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
          {[enderecoCurto(usina.address), usina.fabricante_inversor ? `Inversor ${usina.fabricante_inversor}` : null].filter(Boolean).join(' · ')}
        </Text>
      </Card>

      <Row>
        <Metric label="Geração do mês" value={fmtKwh(atual?.geracao_mensal_kwh)} unit="kWh" icon="solar-power"
          foot={vsPrev === null ? fmtCiclo(atual?.mes_referencia) : `${vsPrev > 0 ? '+' : ''}${fmtPct(vsPrev)} vs projetado`}
          footIcon={vsPrev === null ? undefined : vsPrev >= 0 ? 'trending-up' : 'trending-down'}
          footColor={vsPrev !== null && vsPrev >= 0 ? colors.statusVerified : colors.inkSecondary} />
        <Metric label="Receita do mês" value={fmtBRL(atual?.saldo_receber)} icon="payments" iconColor={colors.secondary}
          foot={rentab === null ? undefined : `Rentabilidade ${fmtPct(rentab)} a.m.`} footIcon="verified" />
      </Row>
      <Row>
        <Metric label="Valor investido" value={fmtBRL(investido)} icon="account-balance" />
        <Metric label="Payback estimado" value={paybackAnos === null ? '—' : `${paybackAnos.toFixed(1).replace('.', ',')} anos`} icon="hourglass-top"
          foot={investido > 0 ? `Amortizado: ${fmtPct(Math.min(100, (acumulado / investido) * 100))}` : undefined} />
      </Row>

      {hist.length > 0 && (
        <Card style={{ gap: 12 }}>
          <Text style={[type.headlineSm, { color: colors.onSurface }]}>Histórico de geração mensal (kWh)</Text>
          <Text style={[type.bodySm, { color: colors.inkSecondary, marginTop: -8 }]}>Últimos {hist.length} meses</Text>
          <BarChart highlightLast categories={hist.map((p) => mesCurto(p.mes_referencia))}
            series={[{ label: 'Geração', values: hist.map((p) => p.geracao_mensal_kwh), color: colors.primary }]} />
        </Card>
      )}

      {atual ? (
        <Card>
          <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={[type.headlineSm, { color: colors.onSurface }]}>Demonstrativo financeiro</Text>
            <Text style={[type.labelSm, { color: colors.secondary }]}>CICLO {fmtCiclo(atual.mes_referencia)}</Text>
          </Row>
          <KeyValue k={`Geração total (${fmtKwh(atual.geracao_mensal_kwh)} kWh)`} v={precoKwh === null ? '—' : `${fmtBRL(precoKwh)} / kWh`} />
          <KeyValue k="Faturamento bruto" v={fmtBRL(atual.faturamento_mensal)} />
          <KeyValue k="Despesas (O&M, gestão, encargos)" v={`- ${fmtBRL(atual.total_despesas)}`} vColor={colors.statusProvisional} />
          <Divider />
          <KeyValue k="Receita líquida" v={fmtBRL(atual.saldo_receber)} bold vColor={colors.primaryLight} />
          {atual.repasse_status ? <Text style={[type.bodySm, { color: colors.inkSecondary, marginTop: 4 }]}>Repasse: {atual.repasse_status.replace(/_/g, ' ')}</Text> : null}
        </Card>
      ) : (
        <Empty icon="insights" title="Sem fechamento ainda" text="Os números aparecem após o primeiro fechamento mensal da usina." />
      )}

      {producao.length > 1 && (
        <>
          <SectionLabel title="Fechamentos anteriores" />
          <Card style={{ paddingVertical: 6 }}>
            {producao.slice(1).map((p, i) => (
              <Row key={p.id} style={{ flexDirection: 'column', gap: 0 }}>
                {i > 0 && <Divider />}
                <KeyValue k={`${fmtCiclo(p.mes_referencia)} · ${fmtKwh(p.geracao_mensal_kwh)} kWh`} v={fmtBRL(p.saldo_receber)} />
              </Row>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
