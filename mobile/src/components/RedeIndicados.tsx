import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { fmtBRL, fmtData, fmtKwh, iniciais } from '../lib/format';
import { grupoRede, type GrupoRede } from '../lib/status';
import type { Indicado } from '../lib/types';
import { colors, type } from '../theme/tokens';
import { Badge, Card, Chip, Empty, Row } from './ui';

const ABAS: { key: GrupoRede | 'todos'; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'ativo', label: 'Ativo' },
  { key: 'cadastrado', label: 'Cadastrado' },
  { key: 'atrasado', label: 'Atrasado' },
  { key: 'cancelado', label: 'Cancelado' },
];

const TOM = { ativo: 'ok', cadastrado: 'info', atrasado: 'bad', cancelado: 'neutral' } as const;

export function RedeIndicados({ indicados }: { indicados: Indicado[] }) {
  const [aba, setAba] = useState<GrupoRede | 'todos'>('todos');
  const comGrupo = indicados.map((i) => ({ ...i, grupo: grupoRede(i.status, i.fatura_status) }));
  const conta = (k: GrupoRede | 'todos') => (k === 'todos' ? comGrupo.length : comGrupo.filter((i) => i.grupo === k).length);
  const lista = aba === 'todos' ? comGrupo : comGrupo.filter((i) => i.grupo === aba);

  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {ABAS.map((a) => <Chip key={a.key} label={`${a.label} (${conta(a.key)})`} active={aba === a.key} onPress={() => setAba(a.key)} />)}
      </ScrollView>
      {lista.length === 0 ? (
        <Empty icon="group-add" title="Ninguém aqui ainda" text="Compartilhe seu link: cada indicação ativa vira desconto na sua conta." />
      ) : lista.map((i) => (
        <Card key={i.subscriber_id} style={{ gap: 8, padding: 12 }}>
          <Row style={{ alignItems: 'center', gap: 12 }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[type.headlineSm, { color: colors.inkPrimary, fontSize: 13 }]}>{iniciais(i.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: colors.onSurface, fontSize: 15 }]} numberOfLines={1}>{i.name}</Text>
              <Text style={[type.bodySm, { color: colors.inkSecondary }]} numberOfLines={1}>
                {[i.numero_uc ? `UC ${i.numero_uc}` : null, [i.cidade, i.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Badge label={i.grupo} tone={TOM[i.grupo]} />
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            {i.grupo === 'cadastrado' ? (
              <>
                <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Aguardando 1ª fatura</Text>
                <Text style={[type.bodySm, { color: colors.statusCalculated }]}>Ativação pendente</Text>
              </>
            ) : i.grupo === 'atrasado' ? (
              <>
                <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Fatura pendente{i.fatura_vencimento ? ` (venc. ${fmtData(i.fatura_vencimento).slice(0, 5)})` : ''}</Text>
                <Text style={[type.bodySm, { color: colors.statusProvisional }]}>{fmtBRL(i.cashback)} retido</Text>
              </>
            ) : (
              <>
                <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Consumo mês: {fmtKwh(i.consumo_kwh)} kWh</Text>
                <Text style={[type.bodySm, { color: colors.statusVerified }]}>Cashback: {fmtBRL(i.cashback)}</Text>
              </>
            )}
          </Row>
        </Card>
      ))}
    </View>
  );
}
