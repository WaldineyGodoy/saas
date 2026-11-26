import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from 'react-native';
import { BarChart } from '../../components/BarChart';
import { PagarFatura } from '../../components/PagarFatura';
import { Badge, Button, Card, Divider, Empty, ErrorState, Icon, KeyValue, Loading, Row, Screen, SectionLabel } from '../../components/ui';
import { useMinhasUcs, useUcDetalhe } from '../../lib/api';
import { enderecoCurto, fmtBRL, fmtCiclo, fmtData, fmtKwh, fmtPct, mesCurto, variacao } from '../../lib/format';
import { resumoFatura } from '../../lib/resumoFatura';
import { ucStatus } from '../../lib/status';
import { colors, fonts, radius, type } from '../../theme/tokens';

const fmtTarifa = (v: number) => `R$ ${v.toFixed(5).replace('.', ',')}/kWh`;
// Valor no meio da frase nao pode quebrar entre "R$" e o numero.
const semQuebra = (s: string) => s.replace(/\s/g, ' ');

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

/**
 * Bloco recolhivel. Recolhido mostra so o que importa (o total); aberto, a
 * quantidade em kWh e as parcelas que somam esse total. O toque e no
 * cabecalho inteiro.
 */
function Bloco({ titulo, legenda, kwh, kwhRotulo, children, total, totalCor }: {
  titulo: string;
  legenda: string;
  kwh: number;
  kwhRotulo: string;
  children: ReactNode;
  total: string;
  totalCor: string;
}) {
  const [aberto, setAberto] = useState(false);
  const alternar = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeOut', 'opacity'));
    setAberto((a) => !a);
  };
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: 0 }}>
      <Pressable
        onPress={alternar}
        accessibilityRole="button"
        accessibilityState={{ expanded: aberto }}
        accessibilityHint={aberto ? 'Recolhe o detalhamento' : 'Mostra o detalhamento'}
        style={({ pressed }) => ({ padding: 16, opacity: pressed ? 0.85 : 1 })}
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.headlineSm, { color: colors.onSurface }]}>{titulo}</Text>
            <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{legenda}</Text>
          </View>
          <Text style={[type.metric, { color: totalCor }]}>{total}</Text>
          <Icon name={aberto ? 'expand-less' : 'expand-more'} size={22} color={colors.inkMuted} />
        </Row>
      </Pressable>
      {aberto && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <Divider />
          <KeyValue k={kwhRotulo} v={`${fmtKwh(kwh)} kWh`} />
          {children}
        </View>
      )}
    </Card>
  );
}

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
  const r = atual ? resumoFatura(atual, uc.tarifa_concessionaria) : null;
  // Sem tarifa nao ha como projetar a conta da concessionaria: a tela diz isso em vez de mostrar zero.
  const semTarifa = !r || r.tarifa <= 0;
  const varConsumo = variacao(atual?.consumo_kwh, anterior?.consumo_kwh);
  const hist = [...faturas].reverse();
  const outras = (ucs.data ?? []).filter((u) => u.id !== uc.id);
  const ok = colors.statusVerified;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Stack.Screen options={{ title: `UC ${uc.numero_uc}` }} />
      <Card style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[type.headlineMd, { color: colors.onSurface }]}>UC {uc.numero_uc}</Text>
          <Badge label={label} tone={tone} />
        </Row>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{enderecoCurto(uc.address) || '—'}</Text>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[type.bodySm, { color: colors.inkMuted }]}>{uc.concessionaria ?? ''}</Text>
          {outras.length > 0 && (
            <Button label="Trocar UC" icon="swap-horiz" variant="ghost" style={{ minHeight: 34, paddingHorizontal: 10 }}
              onPress={() => router.replace({ pathname: '/energia/[ucId]', params: { ucId: outras[0]!.id } })} />
          )}
        </Row>
      </Card>

      {!atual || !r ? (
        <Empty icon="receipt-long" title="Ainda sem fatura" text="A primeira fatura aparece aqui depois da leitura do medidor." />
      ) : (
        <>
          <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2 }}>
            <Text style={[type.headlineMd, { color: colors.onSurface }]}>Ciclo {fmtCiclo(atual.mes_referencia)}</Text>
            {atual.vencimento ? (
              <Text style={[type.body, { color: colors.inkSecondary }]}>Vence {fmtData(atual.vencimento).slice(0, 5)}</Text>
            ) : null}
          </Row>

          <Bloco titulo="Consumo do mês" legenda="Conta na concessionária, sem a B2W" kwh={r.consumoKwh} kwhRotulo="Consumo"
            total={semTarifa ? '—' : fmtBRL(r.contaProjetada)} totalCor={colors.onSurface}>
            <KeyValue k="Energia compensada (tarifa cheia)" v={fmtBRL(r.compensadaCheia)} />
            {r.naoCompensada > 0 && <KeyValue k="Consumo não compensado" v={fmtBRL(r.naoCompensada)} />}
            <KeyValue k="Iluminação pública" v={fmtBRL(r.iluminacao)} />
            {r.outros > 0 && <KeyValue k="Outros lançamentos" v={fmtBRL(r.outros)} />}
            {r.parcelamento > 0 && <KeyValue k="Parcelamento" v={fmtBRL(r.parcelamento)} />}
          </Bloco>

          <View style={{
            backgroundColor: `${ok}14`, borderColor: `${ok}3D`, borderWidth: 1, borderRadius: radius.xl,
            padding: 16, gap: 10,
          }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.headlineSm, { color: colors.onSurface }]}>Economia gerada</Text>
                <Text style={[type.metricLg, { color: ok }]}>{fmtBRL(r.desconto)}</Text>
              </View>
              {r.descontoPct !== null && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[type.metricLg, { color: ok }]}>{fmtPct(r.descontoPct)}</Text>
                  <Text style={[type.bodySm, { color: colors.inkSecondary }]}>de desconto</Text>
                </View>
              )}
            </Row>
            <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
              Diferença entre a energia compensada na tarifa cheia ({semQuebra(fmtBRL(r.compensadaCheia))}) e com o desconto B2W ({semQuebra(fmtBRL(r.compensadaComDesconto))}).
            </Text>
          </View>

          <Bloco titulo="Fatura atual" legenda="Valor da fatura, com a B2W" kwh={r.compensadoKwh} kwhRotulo="Energia compensada"
            total={fmtBRL(r.valorFatura)} totalCor={colors.primaryLight}>
            <KeyValue k="Energia compensada com desconto" v={fmtBRL(r.compensadaComDesconto)} />
            {r.naoCompensada > 0 && <KeyValue k="Consumo não compensado" v={fmtBRL(r.naoCompensada)} />}
            <KeyValue k="Iluminação pública" v={fmtBRL(r.iluminacao)} />
            {r.outros > 0 && <KeyValue k="Outros lançamentos" v={fmtBRL(r.outros)} />}
            {r.parcelamento > 0 && <KeyValue k="Parcelamento" v={fmtBRL(r.parcelamento)} />}
          </Bloco>

          {hist.length > 1 && (
            <Card style={{ gap: 12 }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text style={[type.headlineSm, { color: colors.onSurface, flexShrink: 1 }]}>Histórico da injeção</Text>
                {varConsumo !== null && (
                  <Row style={{ alignItems: 'center', gap: 4 }}>
                    <Icon name={varConsumo > 0 ? 'trending-up' : varConsumo < 0 ? 'trending-down' : 'trending-flat'} size={16}
                      color={varConsumo > 0 ? colors.statusWarning : ok} />
                    <Text style={[type.bodySm, { color: varConsumo > 0 ? colors.statusWarning : ok, fontFamily: fonts.bodySemi }]}>
                      Consumo {varConsumo > 0 ? '+' : ''}{fmtPct(varConsumo)} vs {mesCurto(anterior?.mes_referencia).toLowerCase()}
                    </Text>
                  </Row>
                )}
              </Row>
              <Text style={[type.bodySm, { color: colors.inkSecondary, marginTop: -8 }]}>Últimos {hist.length} meses</Text>
              <BarChart
                highlightLast
                categories={hist.map((f) => mesCurto(f.mes_referencia))}
                series={[
                  { label: 'Energia solar compensada', values: hist.map((f) => f.consumo_compensado), color: colors.secondary },
                  { label: 'Consumo', values: hist.map((f) => f.consumo_kwh), color: colors.navyAccent },
                ]}
              />
            </Card>
          )}

          <Card>
            <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={[type.headlineSm, { color: colors.onSurface }]}>Demonstrativo financeiro</Text>
              <Text style={[type.bodySm, { color: colors.inkMuted }]}>Ciclo {fmtCiclo(atual.mes_referencia)}</Text>
            </Row>
            <KeyValue k="Conta na concessionária (sem B2W)" v={semTarifa ? '—' : fmtBRL(r.contaProjetada)} />
            <KeyValue k="Economia B2W" v={semTarifa ? '—' : `- ${fmtBRL(r.economia)}`} vColor={ok} />
            <Divider />
            <KeyValue k="Valor da fatura" v={fmtBRL(r.valorFatura)} bold vColor={colors.primaryLight} />
            <Text style={[type.bodySm, { color: colors.inkMuted, marginTop: 6 }]}>
              {semTarifa
                ? 'A tarifa desta conta ainda não foi informada; a conta projetada aparece quando ela for lida.'
                : `Tarifa ${r.tarifaOrigem === 'conta' ? 'impressa na conta (TE + TUSD)' : 'do cadastro da UC'}: ${fmtTarifa(r.tarifa)}.`}
            </Text>
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
