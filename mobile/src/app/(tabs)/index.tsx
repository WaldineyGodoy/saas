import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { Empty, ErrorState, Hero, ListItem, Loading, Metric, Row, Screen, SearchInput, SectionLabel, type IconName } from '../../components/ui';
import { useMinhasUcs, useMinhasUsinas, usePerfil } from '../../lib/api';
import { fmtBRL, primeiroNome } from '../../lib/format';
import { colors, type } from '../../theme/tokens';

type Modalidade = { key: string; icon: IconName; title: string; subtitle: string; href: Href; tags: string; badge?: string };

const MODALIDADES: Modalidade[] = [
  { key: 'usinas', icon: 'solar-power', title: 'Usinas de Investimento', subtitle: 'Gere energia para sua rede', href: '/invest', tags: 'solar usina invest gd' },
  { key: 'energia', icon: 'swap-horiz', title: 'Energia por assinatura', subtitle: 'Energia com descontos', href: '/energia', tags: 'energia assinatura uc conta fatura' },
  { key: 'eletroposto', icon: 'ev-station', title: 'Eletropostos', subtitle: 'Recargas em eletropostos', href: '/eletroposto', tags: 'eletroposto recarga carro ve' },
  { key: 'drive', icon: 'router', title: 'Drive Connect', subtitle: 'Sua rede de recargas', href: '/connect/drive', tags: 'drive connect motorista rede', badge: 'HOT' },
  { key: 'home', icon: 'badge', title: 'Home Connect', subtitle: 'Indique e ganhe', href: '/connect/home', tags: 'home connect indicar indicacao cashback' },
];

export default function Inicio() {
  const perfil = usePerfil();
  const ucs = useMinhasUcs();
  const usinas = useMinhasUsinas();
  const [busca, setBusca] = useState('');

  const economia = useMemo(() => (ucs.data ?? []).reduce((a, u) => a + (Number(u.economia_reais) || 0), 0), [ucs.data]);
  const receita = useMemo(() => (usinas.data ?? []).reduce((a, u) => a + (Number(u.receita_mes) || 0), 0), [usinas.data]);

  const lista = MODALIDADES.filter((m) => {
    const q = busca.trim().toLowerCase();
    return !q || `${m.title} ${m.subtitle} ${m.tags}`.toLowerCase().includes(q);
  });

  const refreshing = perfil.isRefetching || ucs.isRefetching || usinas.isRefetching;
  const refresh = () => { perfil.refetch(); ucs.refetch(); usinas.refetch(); };

  if (perfil.isLoading) return <Loading />;
  if (perfil.error) return <Screen><ErrorState error={perfil.error} onRetry={refresh} /></Screen>;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Hero
        kicker={`Olá, ${primeiroNome(perfil.data?.name) || 'bem-vindo'}`}
        title="Ecossistema B2W"
        subtitle="Acompanhe sua economia, seus investimentos e sua rede de indicações em poucos toques."
      />
      <SearchInput value={busca} onChangeText={setBusca} placeholder="Buscar solução (ex: Solar, Recarga, Indicar…)" />
      <Row>
        <Metric label="Economia no mês" value={fmtBRL(economia)} icon="savings" iconColor={colors.secondary} foot={`${ucs.data?.length ?? 0} UCs`} footIcon="bolt" />
        <Metric label="Receita usinas" value={fmtBRL(receita)} icon="payments" foot={`${usinas.data?.length ?? 0} usinas`} footIcon="solar-power" />
      </Row>
      <SectionLabel title="Selecione a modalidade" aside={`${MODALIDADES.length} disponíveis`} />
      {lista.length === 0 ? (
        <Empty title="Nenhuma modalidade encontrada" text="Tente buscar por termos como 'Solar', 'Recarga' ou 'Indicar'." />
      ) : (
        lista.map((m) => (
          <ListItem
            key={m.key}
            icon={m.icon}
            title={m.title}
            subtitle={m.subtitle}
            onPress={() => router.push(m.href)}
            right={m.badge ? <Text style={[type.labelSm, { color: colors.primary }]}>{m.badge}</Text> : undefined}
          />
        ))
      )}
    </Screen>
  );
}
