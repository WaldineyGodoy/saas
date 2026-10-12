import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Campo } from '../components/Campo';
import { Button, Card, Chip, Hero, Icon, Row, Screen, type IconName } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { registrarInteresseInvestimento, usePerfil, type CodigoInvestimento } from '../lib/api';
import { celularBR } from '../lib/indicacao';
import { colors, radius, space, type } from '../theme/tokens';

/** Cada opção vira uma etiqueta do lead no CRM (fn_tags_investimento). */
const FORMAS: { codigo: CodigoInvestimento; icon: IconName; titulo: string; texto: string }[] = [
  { codigo: 'usinas', icon: 'solar-power', titulo: 'Usinas solares', texto: 'Renda com a energia gerada pela sua usina.' },
  { codigo: 'eletropostos', icon: 'ev-station', titulo: 'Eletropostos', texto: 'Renda com recargas de carros elétricos.' },
  { codigo: 'cotas', icon: 'pie-chart', titulo: 'Cotas de usina', texto: 'Invista em parte de uma usina.' },
  { codigo: 'consorcio', icon: 'groups', titulo: 'Consórcio', texto: 'Sua usina pelo consórcio, sem juros.' },
  { codigo: 'financiamento', icon: 'account-balance', titulo: 'Financiamento', texto: 'Sua usina financiada e paga pela própria geração.' },
  { codigo: 'arrendamento', icon: 'landscape', titulo: 'Arrendamento de área', texto: 'Alugue um terreno ou telhado para uma usina.' },
  { codigo: 'vagas', icon: 'local-parking', titulo: 'Locação de vagas', texto: 'Alugue vagas para um eletroposto.' },
];

const FAIXAS = ['Até R$ 50 mil', 'R$ 50 a 200 mil', 'R$ 200 mil a 1 milhão', 'Acima de R$ 1 milhão', 'Ainda não sei'];

/**
 * Ter renda com usinas e eletropostos (decisão do dono, 11/10/2026). Não
 * existe cadastro de investidor: a qualificação daqui vira lead com
 * etiquetas, e a equipe comercial segue a jornada pelo Kanban do CRM.
 */
export default function Investir() {
  const { session } = useAuth();
  const perfil = usePerfil();
  const qc = useQueryClient();
  const meta = (session?.user?.user_metadata ?? {}) as { name?: string; phone?: string };
  const [formas, setFormas] = useState<CodigoInvestimento[]>([]);
  const [faixa, setFaixa] = useState<string | null>(null);
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [celular, setCelular] = useState(meta.phone ?? '');
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const alternar = (c: CodigoInvestimento) =>
    setFormas((f) => (f.includes(c) ? f.filter((x) => x !== c) : [...f, c]));

  const enviar = async () => {
    setErro(null);
    if (formas.length === 0) return setErro('Escolha pelo menos uma forma de investir.');
    const cel = celularBR(celular);
    if (!cel) return setErro('Informe seu celular com DDD para o especialista falar com você.');
    setEnviando(true);
    try {
      await registrarInteresseInvestimento({
        name: meta.name, phone: cel, interesses: formas, faixa, cidade, uf, mensagem,
      });
      await qc.invalidateQueries({ queryKey: ['perfil'] });
      setEnviado(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <Screen>
        <Hero kicker="B2W Invest" title="Recebemos seu interesse" subtitle="Um especialista da B2W vai falar com você pelo WhatsApp para entender seu objetivo e apresentar as oportunidades." />
        <Button label="Ir para o início" icon="home" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const jaPediu = perfil.data?.interesse_investimento;

  return (
    <Screen>
      <Hero kicker="B2W Invest" title="Renda com energia" subtitle="Conte como você quer investir. Um especialista B2W monta a proposta com você." />
      {jaPediu ? (
        <Card style={{ flexDirection: 'row', gap: 10, alignItems: 'center', borderColor: colors.secondary }}>
          <Icon name="check-circle" color={colors.secondary} />
          <Text style={[type.bodySm, { color: colors.onSurface, flex: 1 }]}>
            Você já enviou seu interesse em {new Date(jaPediu).toLocaleDateString('pt-BR')}. Pode enviar de novo para acrescentar opções.
          </Text>
        </Card>
      ) : null}

      <Text style={[type.headlineSm, { color: colors.onSurface }]}>Como você quer investir?</Text>
      <Text style={[type.bodySm, { color: colors.inkSecondary, marginTop: -8 }]}>Pode escolher mais de uma.</Text>
      {FORMAS.map((f) => {
        const ativo = formas.includes(f.codigo);
        return (
          <Pressable
            key={f.codigo}
            onPress={() => alternar(f.codigo)}
            accessibilityRole="checkbox"
            accessibilityLabel={f.titulo}
            accessibilityState={{ checked: ativo }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.xl,
              backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: ativo ? colors.primary : colors.borderSubtle,
            }}
          >
            <Icon name={f.icon} color={ativo ? colors.primary : colors.inkSecondary} size={24} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headlineSm, { color: colors.onSurface }]}>{f.titulo}</Text>
              <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{f.texto}</Text>
            </View>
            <Icon name={ativo ? 'check-box' : 'check-box-outline-blank'} color={ativo ? colors.primary : colors.inkMuted} />
          </Pressable>
        );
      })}

      <Card style={{ gap: space.md }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Quanto pensa em investir?</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {FAIXAS.map((x) => <Chip key={x} label={x} active={faixa === x} onPress={() => setFaixa(faixa === x ? null : x)} />)}
        </Row>
      </Card>

      <Card style={{ gap: space.md }}>
        <Row>
          <View style={{ flex: 3 }}><Campo label="Cidade" value={cidade} onChangeText={setCidade} autoCapitalize="words" /></View>
          <View style={{ flex: 1 }}><Campo label="UF" value={uf} onChangeText={(t) => setUf(t.toUpperCase())} maxLength={2} autoCapitalize="characters" /></View>
        </Row>
        <Campo label="Celular (WhatsApp)" value={celular} onChangeText={setCelular} keyboardType="phone-pad" placeholder="(84) 99999-9999" />
        <Campo label="Algo mais? (opcional)" value={mensagem} onChangeText={setMensagem} autoCapitalize="sentences" placeholder="Ex.: tenho um terreno de 2 hectares" />
      </Card>

      {erro ? <Text style={[type.bodySm, { color: colors.error }]}>{erro}</Text> : null}
      <Button label="Quero falar com um especialista" icon="send" onPress={enviar} loading={enviando} />
    </Screen>
  );
}
