import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { BotaoConvite, ConviteRodape, useDestinoAssinarEnergia } from '../../../components/Convites';
import { LinkIndicacao } from '../../../components/LinkIndicacao';
import { RedeIndicados } from '../../../components/RedeIndicados';
import { RedeParceiro } from '../../../components/RedeParceiro';
import { Card, Empty, ErrorState, Hero, Icon, Loading, Metric, Row, Screen, SectionLabel } from '../../../components/ui';
import { useMeuOriginador, useMinhaRede, usePerfil, useRedeParceiro } from '../../../lib/api';
import { fmtBRL, fmtKwh } from '../../../lib/format';
import { linkIndicacao, linkParceiro, STATUS_PODE_INDICAR, textoConviteParceiro, textoIndicacao } from '../../../lib/links';
import { grupoParceiro, grupoRede } from '../../../lib/status';
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
  const ehParceiro = Boolean(parceiro.data?.id && parceiro.data.ativo);
  // A rede do parceiro fica no app (antes a tela mandava para o CRM).
  const clientes = useRedeParceiro(ehParceiro);

  const tot = useMemo(() => {
    const ativos = (rede.data ?? []).filter((i) => grupoRede(i.status, i.fatura_status) === 'ativo');
    return {
      consumo: ativos.reduce((a, i) => a + (Number(i.consumo_kwh) || 0), 0),
      cashback: ativos.reduce((a, i) => a + (Number(i.cashback) || 0), 0),
    };
  }, [rede.data]);

  const totPar = useMemo(() => {
    const lista = clientes.data ?? [];
    return {
      ativos: lista.filter((c) => grupoParceiro(c.etapa) === 'ativo').length,
      comissao: lista.reduce((a, c) => a + (Number(c.comissao) || 0), 0),
    };
  }, [clientes.data]);

  if (perfil.isLoading) return <Loading />;

  return (
    <Screen refreshing={rede.isRefetching || clientes.isRefetching} onRefresh={() => { perfil.refetch(); rede.refetch(); if (ehParceiro) clientes.refetch(); }}>
      <Hero title="Home Connect" subtitle={sub || !linkPar ? 'Ganhe cashback todo mês indicando assinantes para a sua rede.' : 'Indique clientes para a B2W e ganhe comissão por cada adesão.'} />
      {sub && pode ? <LinkIndicacao link={link} texto={textoIndicacao(sub.name, link)} bonus={linkPar ? 'Cashback na sua fatura' : undefined} /> : null}
      {ehParceiro ? <CadastrarAssinante /> : null}
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
      {ehParceiro ? (
        <>
          <Row>
            <Metric label="Clientes ativos" value={String(totPar.ativos)} icon="groups" />
            <Metric label="Comissões" value={fmtBRL(totPar.comissao)} icon="payments" iconColor={colors.secondary} foot="Acumulado" footIcon="verified" />
          </Row>
          <SectionLabel title="Minha rede de clientes" aside={`${clientes.data?.length ?? 0} clientes`} />
          {clientes.isLoading ? <Loading /> : clientes.error ? <ErrorState error={clientes.error} onRetry={() => clientes.refetch()} /> : <RedeParceiro clientes={clientes.data ?? []} />}
        </>
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

/** Adesão assistida: o parceiro cadastra o cliente pelo próprio app. */
function CadastrarAssinante() {
  return (
    <Card onPress={() => router.push('/adesao-cliente')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderColor: colors.primary, borderWidth: 1 }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="person-add" size={24} color={colors.onPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Cadastrar Novo Assinante</Text>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Novo assinante para minha rede</Text>
      </View>
      <Icon name="chevron-right" color={colors.primary} />
    </Card>
  );
}
