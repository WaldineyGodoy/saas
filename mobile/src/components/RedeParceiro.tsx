import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { ClienteParceiro } from '../lib/api';
import { fmtBRL, fmtKwh, iniciais } from '../lib/format';
import { grupoParceiro, ROTULO_PARCEIRO, type GrupoParceiro } from '../lib/status';
import { colors, type } from '../theme/tokens';
import { Badge, Card, Chip, Empty, Icon, Row } from './ui';

const ABAS: { key: GrupoParceiro | 'todos'; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'adesao', label: 'Em adesão' },
  { key: 'assinatura', label: 'Assinatura' },
  { key: 'ativacao', label: 'Ativação' },
  { key: 'ativo', label: 'Ativos' },
  { key: 'interessado', label: 'Interessados' },
  { key: 'cancelado', label: 'Encerrados' },
];

/** Clientes do Parceiro Power. Quem está em adesão ou aguardando a
 *  assinatura abre a adesão assistida para continuar de onde parou. */
export function RedeParceiro({ clientes }: { clientes: ClienteParceiro[] }) {
  const [aba, setAba] = useState<GrupoParceiro | 'todos'>('todos');
  const comGrupo = clientes.map((c) => ({ ...c, grupo: grupoParceiro(c.etapa) }));
  const conta = (k: GrupoParceiro | 'todos') => (k === 'todos' ? comGrupo.length : comGrupo.filter((c) => c.grupo === k).length);
  const lista = aba === 'todos' ? comGrupo : comGrupo.filter((c) => c.grupo === aba);

  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {ABAS.filter((a) => a.key === 'todos' || conta(a.key) > 0).map((a) => (
          <Chip key={a.key} label={`${a.label} (${conta(a.key)})`} active={aba === a.key} onPress={() => setAba(a.key)} />
        ))}
      </ScrollView>
      {lista.length === 0 ? (
        <Empty icon="group-add" title="Ninguém aqui ainda" text="Cadastre um novo assinante ou compartilhe seu link: cada cliente ativo gera comissão." />
      ) : lista.map((c) => {
        const [rotulo, tom] = ROTULO_PARCEIRO[c.grupo];
        const continuar = c.tipo === 'assinante' && (c.grupo === 'adesao' || c.grupo === 'assinatura');
        return (
          <Card
            key={`${c.tipo}:${c.id}`}
            style={{ gap: 8, padding: 12 }}
            onPress={continuar ? () => router.push({ pathname: '/adesao-cliente', params: { id: c.id } }) : undefined}
          >
            <Row style={{ alignItems: 'center', gap: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[type.headlineSm, { color: colors.inkPrimary, fontSize: 13 }]}>{iniciais(c.name)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.headlineSm, { color: colors.onSurface, fontSize: 15 }]} numberOfLines={1}>{c.name}</Text>
                <Text style={[type.bodySm, { color: colors.inkSecondary }]} numberOfLines={1}>
                  {[c.numero_uc ? `UC ${c.numero_uc}` : null, [c.cidade, c.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Badge label={rotulo} tone={tom} />
            </Row>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[type.bodySm, { color: colors.inkSecondary, flexShrink: 1 }]} numberOfLines={1}>
                {c.consumo_kwh ? `Consumo: ${fmtKwh(c.consumo_kwh)} kWh/mês` : c.grupo === 'interessado' ? 'Fez a simulação' : ' '}
              </Text>
              {continuar ? (
                <Row style={{ alignItems: 'center', gap: 4 }}>
                  <Text style={[type.bodySm, { color: colors.primary }]}>{c.grupo === 'adesao' ? 'Continuar adesão' : 'Reenviar contrato'}</Text>
                  <Icon name="chevron-right" size={18} color={colors.primary} />
                </Row>
              ) : c.grupo === 'interessado' ? (
                <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Ainda sem adesão</Text>
              ) : (
                <Text style={[type.bodySm, { color: c.comissao > 0 ? colors.statusVerified : colors.inkSecondary }]}>{`Comissão: ${fmtBRL(c.comissao)}`}</Text>
              )}
            </Row>
          </Card>
        );
      })}
    </View>
  );
}
