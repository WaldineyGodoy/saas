import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Card, Icon, Loading } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { confirmarIndicador } from '../../lib/api';
import { ehComputador, extrairIndicador, guardarIndicacaoPendente } from '../../lib/indicacao';
import { linkSiteConvite, linkSiteIndicacao } from '../../lib/links';
import { colors, space, type } from '../../theme/tokens';

/**
 * Rota do link de indicação: apps.b2wenergia.com.br/i/<id> (e o mesmo
 * caminho no app nativo, quando os links passarem a abrir o app). Guarda a
 * indicação e manda para criar conta, ou para a pergunta da indicação se a
 * pessoa já estiver logada.
 *
 * No computador (webapp) oferece antes o site, que continua sendo o caminho
 * por lá (decisão A de 06/10/2026), com a mesma indicação. O id pode ser de
 * um assinante (?indicador=) ou de um originador (/convite/, comissão).
 */
const computador = () =>
  Platform.OS === 'web' && typeof navigator !== 'undefined'
  // iPad recente se apresenta como Mac; o toque denuncia.
  && ehComputador(navigator.userAgent) && !(navigator.maxTouchPoints > 1);

export default function LinkIndicacao() {
  const { codigo } = useLocalSearchParams<{ codigo: string }>();
  const { session } = useAuth();
  const [pronto, setPronto] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [nome, setNome] = useState<string | null>(null);
  const [originador, setOriginador] = useState(false);
  const [ficarNoApp, setFicarNoApp] = useState(false);

  useEffect(() => {
    const lido = extrairIndicador(String(codigo ?? ''));
    const valido = lido && 'id' in lido ? lido.id : null;
    setId(valido);
    if (valido && computador()) {
      confirmarIndicador(valido).then((r) => {
        if (!r?.valido) return;
        if (r.primeiro_nome) setNome(r.primeiro_nome);
        setOriginador(r.tipo === 'originador');
      }).catch(() => {});
    }
    (valido ? guardarIndicacaoPendente(valido, 'link') : Promise.resolve()).finally(() => setPronto(true));
  }, [codigo]);

  if (!pronto) return <Loading />;
  // Logado: o início decide (login sem produto vai para a pergunta da indicação).
  if (session) return <Redirect href="/" />;
  if (!id || ficarNoApp || !computador()) return <Redirect href="/criar-conta" />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: space.lg }}>
      <View style={{ width: '100%', maxWidth: 440, gap: space.lg }}>
        <View style={{ gap: 8 }}>
          <Text style={[type.headlineLg, { color: colors.inkPrimary }]}>Energia com desconto</Text>
          <Text style={[type.body, { color: colors.inkSecondary }]}>
            {nome ? <>Você foi indicado por <Text style={{ fontWeight: '700' }}>{nome}</Text>. </> : null}
            Como prefere continuar?
          </Text>
        </View>
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name="computer" color={colors.secondary} />
            <Text style={[type.body, { color: colors.onSurface, flex: 1 }]}>Pelo site, aqui no computador. A indicação vai junto.</Text>
          </View>
          <Button label="Continuar pelo site" icon="open-in-new" onPress={() => Linking.openURL((originador ? linkSiteConvite : linkSiteIndicacao)(id, nome))} />
        </Card>
        <Card style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name="smartphone" color={colors.secondary} />
            <Text style={[type.body, { color: colors.onSurface, flex: 1 }]}>Pelo app: crie sua conta e acompanhe tudo pelo celular depois.</Text>
          </View>
          <Button label="Criar conta no app" icon="person-add" variant="ghost" onPress={() => setFicarNoApp(true)} />
          <Button label="Já tenho conta" variant="ghost" onPress={() => router.replace('/login')} />
        </Card>
      </View>
    </ScrollView>
  );
}
