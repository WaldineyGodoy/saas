import { useMemo } from 'react';
import { BotaoConvite, ConviteRodape, useDestinoAssinarEnergia } from '../../../components/Convites';
import { LinkIndicacao } from '../../../components/LinkIndicacao';
import { RedeIndicados } from '../../../components/RedeIndicados';
import { Card, Empty, ErrorState, Hero, Loading, Metric, Row, Screen, SectionLabel } from '../../../components/ui';
import { Text } from 'react-native';
import { useMeuOriginador, useMinhaRede, usePerfil } from '../../../lib/api';
import { fmtBRL, fmtKwh } from '../../../lib/format';
import { linkIndicacao, linkParceiro, STATUS_PODE_INDICAR, textoConviteParceiro, textoIndicacao } from '../../../lib/links';
import { grupoRede } from '../../../lib/status';
import { colors, type } from '../../../theme/tokens';

export default function HomeConnect() {
  const perfil = usePerfil();
  const rede = useMinhaRede();
  const sub = perfil.data?.subscriber ?? null;
  const pode = Boolean(sub && STATUS_PODE_INDICAR.includes(sub.status));
  const link = pode ? linkIndicacao(sub) : '';
  const assinar = useDestinoAssinarEnergia();
  // Parceiro Power (originador): tem o link dele, de comissão, mesmo sem ser
  // assinante. Antes a tela dizia "Disponível para assinantes" (14/10/2026).
  const parceiro = useMeuOriginador(Boolean(perfil.data?.originator));
  const linkPar = linkParceiro(parceiro.data);

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
      <Hero title="Home Connect" subtitle={sub || !linkPar ? 'Ganhe cashback todo mês indicando assinantes para a sua rede.' : 'Indique clientes para a B2W e ganhe comissão por cada adesão.'} />
      {sub && pode ? <LinkIndicacao link={link} texto={textoIndicacao(sub.name, link)} bonus={linkPar ? 'Cashback na sua fatura' : undefined} /> : null}
      {linkPar ? (
        <LinkIndicacao titulo="Seu link de Parceiro Power" bonus="Comissão por cliente" link={linkPar} texto={textoConviteParceiro(parceiro.data?.name, linkPar)} />
      ) : null}
      {sub && !pode ? (
        <Empty icon="hourglass-top" title="Seu link sai após a assinatura" text="Assim que seu contrato for assinado, o link de indicação aparece aqui." />
      ) : null}
      {!sub && !linkPar ? (
        parceiro.isLoading && perfil.data?.originator ? <Loading /> : (
          <Empty icon="badge" title="Disponível para assinantes e parceiros" text="O Home Connect é liberado para quem tem contrato de energia por assinatura ou é Parceiro Power."
            action={<BotaoConvite label={perfil.data?.lead ? 'Continuar minha adesão' : 'Assinar energia'} icon="bolt" destino={assinar} />} />
        )
      ) : null}
      {!sub && linkPar ? (
        <Card style={{ gap: 6 }}>
          <Text style={[type.headlineSm, { color: colors.onSurface }]}>Seus clientes e comissões</Text>
          <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Quem assinar pelo seu link fica ligado a você. Acompanhe os clientes e as comissões no CRM B2W (crm.b2wenergia.com.br), com o mesmo e-mail do app.</Text>
        </Card>
      ) : null}
      {sub ? (
        <>
      <Row>
        <Metric label="Consumo da rede" value={fmtKwh(tot.consumo)} unit="kWh" icon="payments" />
        <Metric label="Rendimentos" value={fmtBRL(tot.cashback)} icon="speed" iconColor={colors.secondary} foot="Deduzidos na conta" footIcon="verified" />
      </Row>
      <SectionLabel title="Rede de assinantes indicados" aside={`${rede.data?.length ?? 0} indicados`} />
      {rede.isLoading ? <Loading /> : rede.error ? <ErrorState error={rede.error} onRetry={() => rede.refetch()} /> : <RedeIndicados indicados={rede.data ?? []} />}
        </>
      ) : null}
      {sub ? (
        <ConviteRodape titulo="Ganhe também com usinas e eletropostos" texto="Além do cashback da sua rede, tenha renda com cotas de usina, consórcio, financiamento ou um eletroposto." botao="Ter renda com usinas e eletropostos" />
      ) : null}
    </Screen>
  );
}
