import { useMemo } from 'react';
import { LinkIndicacao } from '../../components/LinkIndicacao';
import { RedeIndicados } from '../../components/RedeIndicados';
import { Empty, ErrorState, Hero, Loading, Metric, Row, Screen, SectionLabel } from '../../components/ui';
import { useMinhaRede, usePerfil } from '../../lib/api';
import { fmtBRL, fmtKwh } from '../../lib/format';
import { linkIndicacao, STATUS_PODE_INDICAR, textoIndicacao } from '../../lib/links';
import { grupoRede } from '../../lib/status';
import { colors } from '../../theme/tokens';

export default function HomeConnect() {
  const perfil = usePerfil();
  const rede = useMinhaRede();
  const sub = perfil.data?.subscriber ?? null;
  const pode = Boolean(sub && STATUS_PODE_INDICAR.includes(sub.status));
  const link = pode ? linkIndicacao(sub) : '';

  const tot = useMemo(() => {
    const ativos = (rede.data ?? []).filter((i) => grupoRede(i.status, i.fatura_status) === 'ativo');
    return {
      consumo: ativos.reduce((a, i) => a + (Number(i.consumo_kwh) || 0), 0),
      cashback: ativos.reduce((a, i) => a + (Number(i.cashback) || 0), 0),
    };
  }, [rede.data]);

  if (perfil.isLoading) return <Loading />;

  return (
    <Screen refreshing={rede.isRefetching} onRefresh={() => { perfil.refetch(); rede.refetch(); }}>
      <Hero title="Home Connect" subtitle="Ganhe cashback todo mês indicando assinantes para a sua rede." />
      {!sub ? (
        <Empty icon="badge" title="Disponível para assinantes" text="O Home Connect é liberado para quem tem contrato de energia por assinatura." />
      ) : !pode ? (
        <Empty icon="hourglass-top" title="Seu link sai após a assinatura" text="Assim que seu contrato for assinado, o link de indicação aparece aqui." />
      ) : (
        <LinkIndicacao link={link} texto={textoIndicacao(sub.name, link)} />
      )}
      <Row>
        <Metric label="Consumo da rede" value={fmtKwh(tot.consumo)} unit="kWh" icon="payments" />
        <Metric label="Rendimentos" value={fmtBRL(tot.cashback)} icon="speed" iconColor={colors.secondary} foot="Deduzidos na conta" footIcon="verified" />
      </Row>
      <SectionLabel title="Rede de assinantes indicados" aside={`${rede.data?.length ?? 0} indicados`} />
      {rede.isLoading ? <Loading /> : rede.error ? <ErrorState error={rede.error} onRetry={() => rede.refetch()} /> : <RedeIndicados indicados={rede.data ?? []} />}
    </Screen>
  );
}
