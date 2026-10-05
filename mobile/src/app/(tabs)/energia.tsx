import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorState, Hero, ListItem, Loading, Metric, Row, Screen, SearchInput, SectionLabel } from '../../components/ui';
import { useMinhasUcs, usePerfil } from '../../lib/api';
import { enderecoCurto, fmtBRL, fmtKwh, primeiroNome } from '../../lib/format';
import { ucStatus } from '../../lib/status';
import { colors, type } from '../../theme/tokens';
import { Text } from 'react-native';

export default function Energia() {
  const perfil = usePerfil();
  const ucs = useMinhasUcs();
  const [busca, setBusca] = useState('');

  const tot = useMemo(() => {
    const l = ucs.data ?? [];
    const sum = (k: 'consumo_kwh' | 'valor_concessionaria' | 'economia_reais') => l.reduce((a, u) => a + (Number(u[k]) || 0), 0);
    return { consumo: sum('consumo_kwh'), valor: sum('valor_concessionaria'), economia: sum('economia_reais') };
  }, [ucs.data]);

  const lista = (ucs.data ?? []).filter((u) => {
    const q = busca.trim().toLowerCase();
    return !q || `${u.numero_uc} ${enderecoCurto(u.address)}`.toLowerCase().includes(q);
  });

  return (
    <Screen refreshing={ucs.isRefetching} onRefresh={() => ucs.refetch()}>
      <Hero
        kicker={`Olá, ${primeiroNome(perfil.data?.name)}`}
        title="Energia por assinatura"
        subtitle="Economize na sua conta de energia todos os meses usando energia limpa e renovável."
      />
      <SearchInput value={busca} onChangeText={setBusca} placeholder="Buscar UC ou endereço" />
      <Row>
        <Metric label="Consumo do mês" value={fmtKwh(tot.consumo)} unit="kWh" icon="payments" foot={`Vr. ${fmtBRL(tot.valor)}`} footColor={colors.secondary} />
        <Metric label="Economia" value={fmtBRL(tot.economia)} icon="speed" iconColor={colors.secondary} foot="Economia no mês" footIcon="verified" />
      </Row>
      <SectionLabel title="Unidades consumidoras (UCs)" aside={`${ucs.data?.length ?? 0} cadastradas`} />
      {ucs.isLoading ? <Loading /> : ucs.error ? <ErrorState error={ucs.error} onRetry={() => ucs.refetch()} /> : lista.length === 0 ? (
        <Empty
          icon="bolt"
          title={busca ? 'Nenhuma UC encontrada' : 'Nenhuma UC no seu nome'}
          text={busca ? 'Confira o número ou endereço digitado.' : perfil.data?.subscriber ? 'Suas unidades aparecem aqui assim que forem ativadas.' : 'Este login ainda não está vinculado a um contrato de assinatura.'}
        />
      ) : (
        lista.map((u) => {
          const [label, tone] = ucStatus(u.status);
          return (
            <ListItem
              key={u.id}
              icon="bolt"
              title={`UC: ${u.numero_uc}`}
              subtitle={enderecoCurto(u.address) || u.concessionaria || ''}
              right={<Badge label={label} tone={tone} />}
              onPress={() => router.push({ pathname: '/energia/[ucId]', params: { ucId: u.id } })}
            />
          );
        })
      )}
      {perfil.data?.subscriber ? (
        <Card style={{ gap: 10 }}>
          <Text style={[type.headlineSm, { color: colors.onSurface }]}>Cadastrar nova UC</Text>
          <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
            Tem outro imóvel? Fotografe a conta de luz dele: lemos os dados e a equipe B2W prepara o termo para você assinar.
          </Text>
          <Button label="Adicionar UC pela conta de luz" icon="photo-camera" variant="secondary" onPress={() => router.push('/energia/nova-uc')} />
        </Card>
      ) : null}
    </Screen>
  );
}
