import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { BarChart } from '../../components/BarChart';
import { PagarFatura } from '../../components/PagarFatura';
import { Badge, Button, Card, Divider, Empty, ErrorState, KeyValue, Loading, Metric, Row, Screen, SectionLabel } from '../../components/ui';
import { useMinhasUcs, useUcDetalhe } from '../../lib/api';
import { enderecoCurto, fmtBRL, fmtCiclo, fmtData, fmtKwh, fmtPct, mesCurto, variacao } from '../../lib/format';
import { ucStatus } from '../../lib/status';
import { colors, type } from '../../theme/tokens';

export default function UcDetalhe() {
  const { ucId } = useLocalSearchParams<{ ucId: string }>();
  const q = useUcDetalhe(ucId);
  const ucs = useMinhasUcs();

  if (q.isLoading) return <Loading />;
  if (q.error) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  if (!q.data) return <Screen><Empty title="UC não encontrada" text="Ela pode ter sido transferida ou não pertence a este login." /></Screen>;

  const { uc, faturas } = q.data;
  const atual = faturas[0];
  const anterior = faturas[1];
  const [label, tone] = ucStatus(uc.status);
  const varConsumo = variacao(atual?.consumo_kwh, anterior?.consumo_kwh);
  const desconto = atual && Number(atual.valor_concessionaria) > 0
    ? (Number(atual.economia_reais) / Number(atual.valor_concessionaria)) * 100 : null;
  const compensacao = atual && Number(atual.consumo_kwh) > 0
    ? (Number(atual.consumo_compensado) / Number(atual.consumo_kwh)) * 100 : null;
  const hist = [...faturas].reverse();
  const outras = (ucs.data ?? []).filter((u) => u.id !== uc.id);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Stack.Screen options={{ title: `UC ${uc.numero_uc}` }} />
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionLabel title="Unidade consumidora detalhada" />
        {outras.length > 0 && (
          <Button label="Trocar UC" icon="swap-horiz" variant="ghost" style={{ minHeight: 34, paddingHorizontal: 10 }}
            onPress={() => router.replace({ pathname: '/energia/[ucId]', params: { ucId: outras[0]!.id } })} />
        )}
      </Row>
      <Card style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[type.headlineMd, { color: colors.onSurface }]}>UC: {uc.numero_uc}</Text>
          <Badge label={label} tone={tone} />
        </Row>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{enderecoCurto(uc.address) || '—'}</Text>
        {uc.concessionaria ? <Text style={[type.labelSm, { color: colors.inkMuted, textTransform: 'uppercase' }]}>{uc.concessionaria}</Text> : null}
      </Card>

      {!atual ? (
        <Empty icon="receipt-long" title="Ainda sem fatura" text="A primeira fatura aparece aqui depois da leitura do medidor." />
      ) : (
        <>
          <Row>
            <Metric label="Consumo mês" value={fmtKwh(atual.consumo_kwh)} unit="kWh" icon="speed"
              foot={varConsumo === null ? fmtCiclo(atual.mes_referencia) : `${varConsumo > 0 ? '+' : ''}${fmtPct(varConsumo)} vs mês ant.`}
              footIcon={varConsumo !== null ? (varConsumo > 0 ? 'trending-up' : 'trending-down') : undefined}
              footColor={varConsumo !== null && varConsumo <= 0 ? colors.statusVerified : colors.inkSecondary} />
            <Metric label="Fatura atual" value={fmtBRL(atual.valor_a_pagar)} icon="receipt-long" foot={`Vencimento: ${fmtData(atual.vencimento).slice(0, 5)}`} />
          </Row>
          <Row>
            <Metric label="Economia gerada" value={fmtBRL(atual.economia_reais)} icon="savings" iconColor={colors.secondary}
              foot={desconto === null ? undefined : `Desconto de ${fmtPct(desconto)}`} footColor={colors.statusVerified} />
            <Metric label="Compensação" value={fmtKwh(atual.consumo_compensado)} unit="kWh" icon="solar-power" iconColor={colors.secondary}
              foot={compensacao === null ? undefined : `${fmtPct(compensacao)} da demanda`} />
          </Row>

          {hist.length > 1 && (
            <Card style={{ gap: 12 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.headlineSm, { color: colors.onSurface }]}>Histórico de consumo & injeção</Text>
              </Row>
              <Text style={[type.bodySm, { color: colors.inkSecondary, marginTop: -8 }]}>Últimos {hist.length} meses</Text>
              <BarChart
                categories={hist.map((f) => mesCurto(f.mes_referencia))}
                series={[
                  { label: 'Energia solar compensada', values: hist.map((f) => f.consumo_compensado), color: colors.secondary },
                  { label: 'Consumo rede', values: hist.map((f) => f.consumo_kwh), color: colors.navyAccent },
                ]}
              />
            </Card>
          )}

          <Card>
            <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={[type.headlineSm, { color: colors.onSurface }]}>Demonstrativo financeiro</Text>
              <Text style={[type.labelSm, { color: colors.secondary }]}>CICLO {fmtCiclo(atual.mes_referencia)}</Text>
            </Row>
            <KeyValue k="Tarifa distribuidora (sem B2W)" v={fmtBRL(atual.valor_concessionaria)} />
            <KeyValue k="Crédito de energia solar" v={`- ${fmtBRL(atual.economia_reais)}`} vColor={colors.statusVerified} />
            <Divider />
            <KeyValue k="Total líquido da fatura" v={fmtBRL(atual.valor_a_pagar)} bold vColor={colors.primaryLight} />
          </Card>

          <PagarFatura fatura={atual} />

          {faturas.length > 1 && (
            <>
              <SectionLabel title="Faturas anteriores" />
              <Card style={{ paddingVertical: 6 }}>
                {faturas.slice(1).map((f, i) => (
                  <View key={f.id}>
                    {i > 0 && <Divider />}
                    <KeyValue k={`${fmtCiclo(f.mes_referencia)} · ${fmtKwh(f.consumo_kwh)} kWh`} v={fmtBRL(f.valor_a_pagar)} />
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
