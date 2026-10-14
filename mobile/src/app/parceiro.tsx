import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, Text, View } from 'react-native';
import { Campo } from '../components/Campo';
import { Button, Card, Chip, Hero, Icon, Row, Screen, type IconName } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { cadastrarParceiro, type DadosParceiro } from '../lib/api';
import { buscarCep, documentoValido, soDigitos, tipoDocumento } from '../lib/documento';
import { celularBR } from '../lib/indicacao';
import { linkParceiro } from '../lib/links';
import { colors, space, type } from '../theme/tokens';

type TipoPix = 'documento' | 'email' | 'telefone' | 'aleatoria';
const TIPOS_PIX: { valor: TipoPix; rotulo: string }[] = [
  { valor: 'documento', rotulo: 'CPF/CNPJ' },
  { valor: 'email', rotulo: 'E-mail' },
  { valor: 'telefone', rotulo: 'Telefone' },
  { valor: 'aleatoria', rotulo: 'Aleatória' },
];

const VANTAGENS: { icon: IconName; texto: string }[] = [
  { icon: 'link', texto: 'Seu link e QR Code de indicação' },
  { icon: 'payments', texto: 'Comissão por cliente que assinar pelo seu link, paga no PIX' },
  { icon: 'notifications-active', texto: 'Aviso no WhatsApp a cada novo cliente' },
];


/**
 * Ser um Parceiro Power (decisão do dono, 11/10/2026). Mesmos campos do
 * cadastro de parceiro do site, mas pela conta já aberta: o formulário do
 * site cria outra conta, e quem já tem login ficaria com um cadastro solto.
 */
export default function Parceiro() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const meta = (session?.user?.user_metadata ?? {}) as { name?: string; phone?: string };
  const [nome, setNome] = useState(meta.name ?? '');
  const [celular, setCelular] = useState(meta.phone ?? '');
  const [doc, setDoc] = useState('');
  const [tipoPix, setTipoPix] = useState<TipoPix>('documento');
  const [pix, setPix] = useState('');
  const [profissao, setProfissao] = useState('');
  const [cep, setCep] = useState('');
  const [rua, setRua] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState<string | null>(null);

  const mudarCep = async (t: string) => {
    setCep(t);
    if (soDigitos(t).length !== 8) return;
    setAviso('Buscando endereço…');
    const e = await buscarCep(t);
    setAviso(e ? null : 'CEP não encontrado. Preencha o endereço.');
    if (e) { setRua(e.rua); setBairro(e.bairro); setCidade(e.cidade); setUf(e.uf); }
  };

  const enviar = async () => {
    setErro(null);
    if (nome.trim().split(/\s+/).length < 2) return setErro('Informe nome e sobrenome.');
    const cel = celularBR(celular);
    if (!cel) return setErro('WhatsApp inválido. Informe DDD + número.');
    if (!documentoValido(doc)) return setErro('CPF ou CNPJ inválido. Confira o número.');
    if (tipoPix !== 'documento' && !pix.trim()) return setErro('Informe a chave PIX para receber as comissões.');
    if (soDigitos(cep).length !== 8 || !cidade.trim() || !uf.trim()) return setErro('Informe o CEP e confira o endereço.');
    if (!numero.trim()) return setErro('Informe o número do endereço.');
    const dados: DadosParceiro = {
      name: nome, phone: cel, cpf_cnpj: soDigitos(doc),
      pix_key_type: tipoPix === 'documento' ? tipoDocumento(doc) : tipoPix,
      pix_key: tipoPix === 'documento' ? soDigitos(doc) : pix.trim(),
      profession: profissao,
      address: { cep: soDigitos(cep), rua, numero, complemento, bairro, cidade, uf },
    };
    setEnviando(true);
    try {
      const id = await cadastrarParceiro(dados);
      await qc.invalidateQueries({ queryKey: ['perfil'] });
      setPronto(id);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  if (pronto) {
    const link = linkParceiro({ id: pronto, short_url: null });
    return (
      <Screen>
        <Hero kicker="Parceiro Power" title="Bem-vindo, parceiro!" subtitle="Seu cadastro foi feito. Divulgue seu link: cada cliente que assinar por ele fica com você." />
        <Card style={{ gap: space.md }}>
          <Text style={[type.labelSm, { color: colors.onSurfaceVariant, textTransform: 'uppercase' }]}>Seu link de indicação</Text>
          <Text selectable style={[type.body, { color: colors.onSurface }]}>{link}</Text>
          <Row>
            <Button label="Copiar" icon="content-copy" variant="secondary" style={{ flex: 1 }} onPress={() => Clipboard.setStringAsync(link).then(() => setAviso('Link copiado.'))} />
            <Button label="Compartilhar" icon="share" style={{ flex: 1 }} onPress={() => Share.share({ message: `Economize na conta de luz com a B2W Energia: ${link}` }).catch(() => {})} />
          </Row>
          {aviso ? <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{aviso}</Text> : null}
          <Text style={[type.bodySm, { color: colors.inkMuted }]}>Em instantes o link curto e o painel de comissões também ficam disponíveis no CRM da B2W.</Text>
        </Card>
        <Button label="Ir para o início" icon="home" variant="ghost" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Hero kicker="Parceiro Power" title="Indique e ganhe" subtitle="Cadastre-se como parceiro B2W e receba comissão pelos clientes que indicar." />
      <Card style={{ gap: 10 }}>
        {VANTAGENS.map((v) => (
          <View key={v.texto} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name={v.icon} color={colors.secondary} />
            <Text style={[type.body, { color: colors.onSurface, flex: 1 }]}>{v.texto}</Text>
          </View>
        ))}
      </Card>

      <Card style={{ gap: space.md }}>
        <Campo label="Nome completo" value={nome} onChangeText={setNome} autoCapitalize="words" />
        <Campo label="WhatsApp" value={celular} onChangeText={setCelular} keyboardType="phone-pad" placeholder="(84) 99999-9999" />
        <Campo label="CPF ou CNPJ" value={doc} onChangeText={setDoc} keyboardType="number-pad" />
        <Campo label="Profissão (opcional)" value={profissao} onChangeText={setProfissao} autoCapitalize="sentences" />
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Chave PIX para as comissões</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {TIPOS_PIX.map((t) => <Chip key={t.valor} label={t.rotulo} active={tipoPix === t.valor} onPress={() => setTipoPix(t.valor)} />)}
        </Row>
        {tipoPix === 'documento'
          ? <Text style={[type.bodySm, { color: colors.inkSecondary }]}>A chave será o seu CPF/CNPJ informado acima.</Text>
          : <Campo label="Chave PIX" value={pix} onChangeText={setPix} keyboardType={tipoPix === 'email' ? 'email-address' : tipoPix === 'telefone' ? 'phone-pad' : 'default'} />}
      </Card>

      <Card style={{ gap: space.md }}>
        <Text style={[type.headlineSm, { color: colors.onSurface }]}>Endereço</Text>
        <Campo label="CEP" value={cep} onChangeText={mudarCep} keyboardType="number-pad" maxLength={9} />
        {aviso ? <Text style={[type.bodySm, { color: colors.inkSecondary }]}>{aviso}</Text> : null}
        <Campo label="Rua" value={rua} onChangeText={setRua} autoCapitalize="words" />
        <Row>
          <View style={{ flex: 1 }}><Campo label="Número" value={numero} onChangeText={setNumero} /></View>
          <View style={{ flex: 2 }}><Campo label="Complemento" value={complemento} onChangeText={setComplemento} autoCapitalize="sentences" /></View>
        </Row>
        <Campo label="Bairro" value={bairro} onChangeText={setBairro} autoCapitalize="words" />
        <Row>
          <View style={{ flex: 3 }}><Campo label="Cidade" value={cidade} onChangeText={setCidade} autoCapitalize="words" /></View>
          <View style={{ flex: 1 }}><Campo label="UF" value={uf} onChangeText={(t) => setUf(t.toUpperCase())} maxLength={2} autoCapitalize="characters" /></View>
        </Row>
      </Card>

      {erro ? <Text style={[type.bodySm, { color: colors.error }]}>{erro}</Text> : null}
      <Button label="Quero ser parceiro" icon="handshake" onPress={enviar} loading={enviando} />
    </Screen>
  );
}
