import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Divider, Icon, KeyValue, Loading, Screen, SectionLabel } from '../../components/ui';
import { lerConta, solicitarNovaUc } from '../../lib/api';
import { contaParaPedido, LIGACAO, mensagemDeErro, PDF_MAXIMO_BYTES, tamanhoReduzido, type ContaLida } from '../../lib/conta';
import { colors, type } from '../../theme/tokens';

type Etapa = 'escolher' | 'lendo' | 'conferir' | 'enviando' | 'enviado';

/**
 * Nova UC pela conta de energia. O assinante fotografa a conta (ou envia o
 * PDF), confere o que foi lido e manda o pedido. Nao cria UC: a equipe B2W
 * recebe o pedido ja preenchido e a UC so entra na assinatura depois do termo
 * assinado.
 */
export default function NovaUc() {
  const [etapa, setEtapa] = useState<Etapa>('escolher');
  const [conta, setConta] = useState<ContaLida | null>(null);
  const [erro, setErro] = useState('');
  const [jaExistia, setJaExistia] = useState(false);

  const ler = async (obterArquivo: () => Promise<{ base64: string; tipo: 'image/jpeg' | 'application/pdf' } | null>) => {
    setErro('');
    try {
      const arquivo = await obterArquivo();
      if (!arquivo) return; // cancelado
      setEtapa('lendo');
      const lida = contaParaPedido(await lerConta(arquivo.base64, arquivo.tipo));
      if (!lida.numeroUc) throw new Error('Não encontramos o número da UC nesta conta. Tente outra foto, com a conta inteira e boa luz.');
      setConta(lida);
      setEtapa('conferir');
    } catch (e) {
      setErro(mensagemDeErro(e instanceof Error ? e.message : String(e)));
      setEtapa('escolher');
    }
  };

  // Reduz a foto (celulares tiram 12 MP ou mais) e manda em JPEG.
  const fotoEmBase64 = async (asset: ImagePicker.ImagePickerAsset) => {
    const ctx = ImageManipulator.manipulate(asset.uri);
    const tamanho = tamanhoReduzido(asset.width, asset.height);
    if (tamanho) ctx.resize(tamanho);
    const imagem = await ctx.renderAsync();
    const salva = await imagem.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    if (!salva.base64) throw new Error('Não foi possível preparar a foto.');
    return { base64: salva.base64, tipo: 'image/jpeg' as const };
  };

  const fotografar = () => ler(async () => {
    const permissao = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissao.granted) {
      Alert.alert('Câmera bloqueada', 'Libere o acesso à câmera nas configurações do celular, ou escolha uma foto da galeria.');
      return null;
    }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    return r.canceled ? null : fotoEmBase64(r.assets[0]!);
  });

  const escolherFoto = () => ler(async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    return r.canceled ? null : fotoEmBase64(r.assets[0]!);
  });

  const escolherPdf = () => ler(async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (r.canceled) return null;
    const pdf = r.assets[0]!;
    if (pdf.size && pdf.size > PDF_MAXIMO_BYTES) throw new Error('PDF grande demais. Envie a conta em PDF da distribuidora (normalmente menos de 1 MB).');
    return { base64: await new File(pdf.uri).base64(), tipo: 'application/pdf' as const };
  });

  const enviar = async () => {
    if (!conta) return;
    setErro('');
    setEtapa('enviando');
    try {
      const r = await solicitarNovaUc(conta);
      setJaExistia(r.ja_existia);
      setEtapa('enviado');
    } catch (e) {
      setErro(mensagemDeErro(e instanceof Error ? e.message : String(e)));
      setEtapa('conferir');
    }
  };

  const recomecar = () => { setConta(null); setErro(''); setEtapa('escolher'); };

  if (etapa === 'lendo') return <Loading label="Lendo a conta… pode levar uns 20 segundos" />;
  if (etapa === 'enviando') return <Loading label="Enviando o pedido…" />;

  if (etapa === 'enviado') {
    return (
      <Screen>
        <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 10 }}>
          <Icon name="check-circle" size={44} color={colors.statusVerified} />
          <Text style={[type.headlineMd, { color: colors.onSurface, textAlign: 'center' }]}>
            {jaExistia ? 'Pedido já registrado' : 'Pedido enviado'}
          </Text>
          <Text style={[type.body, { color: colors.inkSecondary, textAlign: 'center' }]}>
            {jaExistia
              ? `Já temos um pedido em aberto para a UC ${conta?.numeroUc}. A equipe B2W vai falar com você.`
              : `A equipe B2W recebeu os dados da UC ${conta?.numeroUc} e vai preparar o termo para você assinar. A UC entra na sua assinatura depois da assinatura do termo.`}
          </Text>
          <Button label="Voltar para Energia" icon="arrow-back" onPress={() => router.back()} style={{ marginTop: 8, alignSelf: 'stretch' }} />
        </Card>
      </Screen>
    );
  }

  const Erro = erro ? (
    <Card style={{ flexDirection: 'row', gap: 10, borderColor: colors.error, borderWidth: 1 }}>
      <Icon name="error-outline" color={colors.error} />
      <Text style={[type.bodySm, { color: colors.error, flex: 1 }]}>{erro}</Text>
    </Card>
  ) : null;

  if (etapa === 'conferir' && conta) {
    const end = conta.endereco;
    return (
      <Screen>
        <SectionLabel title="Confira os dados lidos" />
        {Erro}
        <Card style={{ gap: 2 }}>
          <KeyValue k="Número da UC" v={conta.numeroUc} bold />
          <KeyValue k="Titular na conta" v={conta.titular || '—'} />
          <KeyValue k="Ligação" v={LIGACAO[conta.ligacao || ''] || conta.tipoFornecimento || '—'} />
          <KeyValue k="Consumo médio" v={conta.mediaKwh ? `${conta.mediaKwh} kWh` : '—'} />
          <KeyValue k="Conta de referência" v={conta.mesReferencia || '—'} />
          <Divider />
          <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Endereço da UC</Text>
          <Text style={[type.body, { color: colors.onSurface }]}>{end?.completo || '—'}</Text>
        </Card>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
          Algum dado errado? Leia a conta de novo com uma foto mais nítida. A equipe B2W também confere tudo antes do termo.
        </Text>
        <Button label="Enviar pedido" icon="send" onPress={enviar} />
        <Button label="Ler outra conta" icon="refresh" variant="ghost" onPress={recomecar} />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionLabel title="Nova UC pela conta de luz" />
      <Text style={[type.body, { color: colors.inkSecondary }]}>
        Fotografe a conta de energia do imóvel novo ou envie o PDF. Lemos os dados da UC para você conferir e a equipe
        B2W prepara o termo para assinatura. A UC só entra na sua assinatura depois do termo assinado.
      </Text>
      {Erro}
      <Card style={{ gap: 10 }}>
        <Button label="Fotografar a conta" icon="photo-camera" onPress={fotografar} />
        <Button label="Escolher foto da galeria" icon="photo-library" variant="secondary" onPress={escolherFoto} />
        <Button label="Enviar PDF da conta" icon="picture-as-pdf" variant="secondary" onPress={escolherPdf} />
      </Card>
      <View style={{ gap: 6 }}>
        <Text style={[type.labelSm, { color: colors.inkMuted }]}>DICAS PARA A FOTO</Text>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
          Conta inteira no enquadramento, sem dobras e com boa luz. Por enquanto lemos contas da Neoenergia Cosern.
        </Text>
      </View>
    </Screen>
  );
}
