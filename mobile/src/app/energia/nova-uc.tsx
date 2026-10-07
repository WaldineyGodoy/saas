import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Button, Card, Divider, Empty, Icon, KeyValue, Loading, Screen, SectionLabel } from '../../components/ui';
import { gerarTermoAditivo, lerConta, usePlanosParaUc, type PlanoUc } from '../../lib/api';
import { contaParaPedido, LIGACAO, mensagemDeErro, PDF_MAXIMO_BYTES, tamanhoReduzido, type ContaLida } from '../../lib/conta';
import { fmtPct } from '../../lib/format';
import { colors, radius, type } from '../../theme/tokens';

type Etapa = 'escolher' | 'lendo' | 'plano' | 'conferir' | 'gerando' | 'assinar';

/**
 * Nova UC pela conta de energia, tudo no app (decisao do dono, 05/10/2026):
 * le a conta -> escolhe o plano da distribuidora -> confere -> assina o termo
 * aditivo. A UC so entra na assinatura depois do termo assinado; o
 * autentique-webhook cria ela em "Em Ativacao" com o plano escolhido.
 */
export default function NovaUc() {
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState<Etapa>('escolher');
  const [conta, setConta] = useState<ContaLida | null>(null);
  const [plano, setPlano] = useState<PlanoUc | null>(null);
  const [link, setLink] = useState('');
  const [erro, setErro] = useState('');
  const planos = usePlanosParaUc(etapa === 'plano' ? conta?.concessionaria : undefined);

  const ler = async (obterArquivo: () => Promise<{ base64: string; tipo: 'image/jpeg' | 'application/pdf' } | null>) => {
    setErro('');
    try {
      const arquivo = await obterArquivo();
      if (!arquivo) return; // cancelado
      setEtapa('lendo');
      const lida = contaParaPedido(await lerConta(arquivo.base64, arquivo.tipo));
      if (!lida.numeroUc) throw new Error('Não encontramos o número da UC nesta conta. Tente outra foto, com a conta inteira e boa luz.');
      setConta(lida);
      setPlano(null);
      setEtapa('plano');
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

  const abrirTermo = async (url: string) => {
    await WebBrowser.openBrowserAsync(url);
    // Voltou do navegador: a situacao do pedido pode ter mudado.
    qc.invalidateQueries({ queryKey: ['pedidos-uc'] });
    qc.invalidateQueries({ queryKey: ['ucs'] });
  };

  const gerarEAssinar = async () => {
    if (!conta || !plano) return;
    setErro('');
    setEtapa('gerando');
    try {
      const r = await gerarTermoAditivo(conta, plano.id);
      setLink(r.link);
      setEtapa('assinar');
      await abrirTermo(r.link);
    } catch (e) {
      setErro(mensagemDeErro(e instanceof Error ? e.message : String(e)));
      setEtapa('conferir');
    }
  };

  const recomecar = () => { setConta(null); setPlano(null); setErro(''); setEtapa('escolher'); };

  if (etapa === 'lendo') return <Loading label="Lendo a conta… pode levar uns 20 segundos" />;
  if (etapa === 'gerando') return <Loading label="Preparando o termo para assinatura…" />;

  const Erro = erro ? (
    <Card style={{ flexDirection: 'row', gap: 10, borderColor: colors.error, borderWidth: 1 }}>
      <Icon name="error-outline" color={colors.error} />
      <Text style={[type.bodySm, { color: colors.error, flex: 1 }]}>{erro}</Text>
    </Card>
  ) : null;

  if (etapa === 'assinar') {
    return (
      <Screen>
        <Card style={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
          <Icon name="draw" size={44} color={colors.primary} />
          <Text style={[type.headlineMd, { color: colors.onSurface, textAlign: 'center' }]}>Termo pronto para assinar</Text>
          <Text style={[type.body, { color: colors.inkSecondary, textAlign: 'center' }]}>
            {`Assine o termo aditivo da UC ${conta?.numeroUc}. Depois de assinado, ela aparece na aba Energia como "Em ativação", com o plano ${plano?.nome}.`}
          </Text>
          <Button label="Abrir termo para assinar" icon="draw" onPress={() => abrirTermo(link)} style={{ marginTop: 8, alignSelf: 'stretch' }} />
          <Button label="Voltar para Energia" icon="arrow-back" variant="ghost" onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
        </Card>
        <Text style={[type.bodySm, { color: colors.inkSecondary, textAlign: 'center' }]}>
          Se fechar agora, o termo continua pendente na aba Energia.
        </Text>
      </Screen>
    );
  }

  if (etapa === 'plano' && conta) {
    return (
      <Screen>
        <SectionLabel title="Escolha o plano" aside={`UC ${conta.numeroUc}`} />
        <Text style={[type.body, { color: colors.inkSecondary }]}>
          {`Planos disponíveis para ${conta.concessionaria || 'a distribuidora da sua UC'}. O desconto vale para esta UC.`}
        </Text>
        {Erro}
        {planos.isLoading ? <Loading label="Buscando planos…" /> : planos.error ? (
          <Empty icon="error-outline" title="Não foi possível carregar os planos" text={mensagemDeErro(planos.error instanceof Error ? planos.error.message : String(planos.error))}
            action={<Button label="Tentar de novo" icon="refresh" variant="secondary" onPress={() => planos.refetch()} style={{ marginTop: 8 }} />} />
        ) : (planos.data ?? []).length === 0 ? (
          <Empty icon="info-outline" title="Ainda sem plano para esta região"
            text="Ainda não temos plano disponível para a distribuidora desta UC. Fale com o suporte B2W." />
        ) : (
          (planos.data ?? []).map((p) => {
            const ativo = plano?.id === p.id;
            return (
              <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ checked: ativo }} onPress={() => setPlano(p)}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: ativo ? colors.primary : colors.borderSubtle, borderRadius: radius.lg }}>
                  <Icon name={ativo ? 'radio-button-checked' : 'radio-button-unchecked'} color={ativo ? colors.primary : colors.inkMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.headlineSm, { color: colors.onSurface }]}>{p.nome}</Text>
                    {p.desconto_assinante ? (
                      <Text style={[type.bodySm, { color: colors.secondary }]}>{`${fmtPct(Number(p.desconto_assinante))} de desconto pagando em dia`}</Text>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            );
          })
        )}
        <Button label="Continuar" icon="arrow-forward" disabled={!plano} onPress={() => setEtapa('conferir')} />
        <Button label="Ler outra conta" icon="refresh" variant="ghost" onPress={recomecar} />
      </Screen>
    );
  }

  if (etapa === 'conferir' && conta && plano) {
    const end = conta.endereco;
    return (
      <Screen>
        <SectionLabel title="Confira antes de assinar" />
        {Erro}
        <Card style={{ gap: 2 }}>
          <KeyValue k="Número da UC" v={conta.numeroUc} bold />
          <KeyValue k="Titular na conta" v={conta.titular || '—'} />
          <KeyValue k="Ligação" v={LIGACAO[conta.ligacao || ''] || conta.tipoFornecimento || '—'} />
          <KeyValue k="Consumo médio" v={conta.mediaKwh ? `${conta.mediaKwh} kWh` : '—'} />
          <KeyValue k="Plano" v={plano.nome} />
          {plano.desconto_assinante ? <KeyValue k="Desconto" v={fmtPct(Number(plano.desconto_assinante))} vColor={colors.secondary} /> : null}
          <Divider />
          <Text style={[type.bodySm, { color: colors.inkSecondary }]}>Endereço da UC</Text>
          <Text style={[type.body, { color: colors.onSurface }]}>{end?.completo || '—'}</Text>
        </Card>
        <Text style={[type.bodySm, { color: colors.inkSecondary }]}>
          Ao continuar, geramos o termo aditivo que inclui esta UC na sua assinatura. Algum dado errado? Leia a conta de novo com uma foto mais nítida.
        </Text>
        <Button label="Gerar termo e assinar" icon="draw" onPress={gerarEAssinar} />
        <Button label="Trocar plano" icon="swap-horiz" variant="ghost" onPress={() => setEtapa('plano')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionLabel title="Nova UC pela conta de luz" />
      <Text style={[type.body, { color: colors.inkSecondary }]}>
        Fotografe a conta de energia do imóvel novo ou envie o PDF. Você escolhe o plano, confere os dados e assina o termo
        aditivo aqui mesmo. A UC entra na sua assinatura depois do termo assinado.
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
