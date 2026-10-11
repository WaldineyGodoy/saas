import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { PDF_MAXIMO_BYTES, tamanhoReduzido } from './conta';
import { avisar } from './dialogo';

/**
 * Foto ou PDF escolhido pela pessoa, pronto para enviar: conta de luz (nova
 * UC e adesão) e documentos da adesão. Fotos saem reduzidas em JPEG
 * (celulares tiram 12 MP ou mais).
 */
export type Arquivo = { base64: string; tipo: 'image/jpeg' | 'application/pdf' };

async function fotoEmBase64(asset: ImagePicker.ImagePickerAsset): Promise<Arquivo> {
  try {
    const ctx = ImageManipulator.manipulate(asset.uri);
    const tamanho = tamanhoReduzido(asset.width, asset.height);
    if (tamanho) ctx.resize(tamanho);
    const imagem = await ctx.renderAsync();
    const salva = await imagem.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    if (salva.base64) return { base64: salva.base64, tipo: 'image/jpeg' };
  } catch (e) {
    if (Platform.OS !== 'web') throw e;
  }
  // Webapp: sem redução, manda a imagem como veio do navegador.
  if (Platform.OS === 'web') {
    const b64 = base64DaUri(asset.uri) ?? (asset.file ? bytesParaBase64(new Uint8Array(await asset.file.arrayBuffer())) : null);
    if (b64) return { base64: b64, tipo: 'image/jpeg' };
  }
  throw new Error('Não foi possível preparar a foto.');
}

/** null = a pessoa cancelou (ou negou a câmera, já avisada). */
export async function fotografar(): Promise<Arquivo | null> {
  const permissao = await ImagePicker.requestCameraPermissionsAsync();
  if (!permissao.granted) {
    avisar('Câmera bloqueada', 'Libere o acesso à câmera nas configurações do celular, ou escolha uma foto da galeria.');
    return null;
  }
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  return r.canceled ? null : fotoEmBase64(r.assets[0]!);
}

export async function escolherFoto(): Promise<Arquivo | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  return r.canceled ? null : fotoEmBase64(r.assets[0]!);
}

export async function escolherPdf(): Promise<Arquivo | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (r.canceled) return null;
  const pdf = r.assets[0]!;
  if (pdf.size && pdf.size > PDF_MAXIMO_BYTES) throw new Error('PDF grande demais. Envie um arquivo de até 5 MB.');
  // Webapp: o seletor do navegador já entrega o arquivo (data: URL ou File);
  // o File do expo-file-system só existe no app de celular.
  if (Platform.OS === 'web') {
    const b64 = base64DaUri(pdf.uri) ?? (pdf.file ? bytesParaBase64(new Uint8Array(await pdf.file.arrayBuffer())) : null);
    if (!b64) throw new Error('Não foi possível ler o PDF. Tente de novo ou envie uma foto da conta.');
    if (b64.length * 0.75 > PDF_MAXIMO_BYTES) throw new Error('PDF grande demais. Envie um arquivo de até 5 MB.');
    return { base64: b64, tipo: 'application/pdf' };
  }
  return { base64: await new File(pdf.uri).base64(), tipo: 'application/pdf' };
}

/** Bytes do arquivo (upload direto no Storage). */
export function bytesDoBase64(base64: string): Uint8Array {
  const bin = globalThis.atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Conteúdo de uma data: URL em base64 (o que o navegador devolve), ou null. */
export function base64DaUri(uri: string | null | undefined): string | null {
  const m = /^data:[^;,]*;base64,(.*)$/s.exec(uri ?? '');
  return m ? m[1] : null;
}

/** Bytes -> base64, em blocos (btoa com o arquivo inteiro estoura a pilha). */
export function bytesParaBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(bin);
}
