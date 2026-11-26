import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Button, Empty, ErrorState, Icon, Loading, Screen, type IconName } from '../components/ui';
import { marcarLidas, useNotificacoes, type Notificacao } from '../lib/api';
import { colors, radius, type } from '../theme/tokens';

const ICONE: Record<string, IconName> = {
  rede_novo_assinante: 'group-add',
  recompensa_recebida: 'payments',
  bonus_recebido: 'redeem',
  comunicado: 'campaign',
};

/** "agora", "há 5 min", "há 3 h", "ontem", "12/03". */
function quando(iso: string) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  if (min < 48 * 60) return 'ontem';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Notificacoes() {
  const q = useNotificacoes();
  const qc = useQueryClient();
  const itens = q.data ?? [];
  const naoLidas = itens.filter((n) => !n.lida_em).length;

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ['notificacoes'] });
    void qc.invalidateQueries({ queryKey: ['notificacoes-nao-lidas'] });
  };

  const abrir = async (n: Notificacao) => {
    if (!n.lida_em) {
      await marcarLidas([n.id]).catch(() => {});
      atualizar();
    }
    if (n.rota) router.push(n.rota as Href);
  };

  if (q.isLoading) return <Loading />;
  if (q.error) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {itens.length === 0 ? (
        <Empty icon="notifications-none" title="Nenhuma notificação" text="Avisos da sua rede, recompensas e comunicados da B2W aparecem aqui." />
      ) : (
        <>
          {naoLidas > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[type.body, { color: colors.inkSecondary }]}>
                {naoLidas === 1 ? '1 não lida' : `${naoLidas} não lidas`}
              </Text>
              <Button label="Marcar todas como lidas" icon="done-all" variant="ghost" style={{ minHeight: 34, paddingHorizontal: 10 }}
                onPress={async () => { await marcarLidas().catch(() => {}); atualizar(); }} />
            </View>
          )}
          <View style={{ gap: 8 }}>
            {itens.map((n) => {
              const nova = !n.lida_em;
              return (
                <Pressable
                  key={n.id}
                  onPress={() => abrir(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`${nova ? 'Não lida. ' : ''}${n.titulo}. ${n.corpo}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.xl, borderWidth: 1,
                    borderColor: nova ? `${colors.primary}40` : colors.borderSubtle,
                    backgroundColor: nova ? `${colors.primary}0F` : colors.surfaceLowest,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.primary}1A` }}>
                    <Icon name={ICONE[n.tipo] ?? 'notifications'} size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={[type.headlineSm, { color: colors.onSurface, flex: 1, fontSize: 15 }]} numberOfLines={2}>{n.titulo}</Text>
                      <Text style={[type.bodySm, { color: colors.inkMuted }]}>{quando(n.criada_em)}</Text>
                    </View>
                    <Text style={[type.body, { color: colors.inkSecondary }]}>{n.corpo}</Text>
                  </View>
                  {nova && <View accessibilityElementsHidden style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 }} />}
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}
