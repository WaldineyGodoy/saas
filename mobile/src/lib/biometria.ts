import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Entrar com Face ID / digital.
 *
 * A senha nunca e guardada. Ao ativar, o app guarda no Keychain/Keystore o
 * refresh token da sessao; para entrar, o sistema confere o rosto ou a digital
 * e so entao o token e usado para abrir uma sessao nova. O Supabase gira o
 * refresh token a cada renovacao, por isso o AuthContext regrava o token a
 * cada mudanca de sessao, e o "Sair" com biometria ativa so apaga a sessao do
 * aparelho, sem revogar no servidor, para o token guardado continuar valido.
 */
const CHAVE_ATIVA = 'b2w.bio.ativa';
const CHAVE_TOKEN = 'b2w.bio.rt';
const CHAVE_EMAIL = 'b2w.bio.email';
const CHAVE_PERGUNTOU = 'b2w.bio.perguntou';

export const BIOMETRIA_NO_APARELHO = Platform.OS !== 'web';

/** Nome do recurso como a pessoa conhece: Face ID no iPhone, digital no Android. */
export async function nomeBiometria(): Promise<string | null> {
  if (!BIOMETRIA_NO_APARELHO) return null;
  try {
    const [hardware, cadastrada] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!hardware || !cadastrada) return null;
    const tipos = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (tipos.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return Platform.OS === 'ios' ? 'Face ID' : 'reconhecimento facial';
    }
    if (tipos.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return Platform.OS === 'ios' ? 'Touch ID' : 'digital';
    }
    return 'biometria';
  } catch {
    return null;
  }
}

export async function biometriaAtiva(): Promise<boolean> {
  if (!BIOMETRIA_NO_APARELHO) return false;
  try {
    const [ativa, token] = await Promise.all([
      SecureStore.getItemAsync(CHAVE_ATIVA),
      SecureStore.getItemAsync(CHAVE_TOKEN),
    ]);
    return ativa === '1' && !!token;
  } catch {
    return false;
  }
}

export async function emailDaBiometria(): Promise<string | null> {
  if (!BIOMETRIA_NO_APARELHO) return null;
  return SecureStore.getItemAsync(CHAVE_EMAIL).catch(() => null);
}

/** Pede o rosto ou a digital. true = conferido. */
export async function conferirBiometria(motivo: string): Promise<boolean> {
  if (!BIOMETRIA_NO_APARELHO) return false;
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: motivo,
    cancelLabel: 'Usar senha',
    disableDeviceFallback: false,
  });
  return r.success;
}

export async function ativarBiometria(refreshToken: string, email?: string | null) {
  await SecureStore.setItemAsync(CHAVE_TOKEN, refreshToken);
  if (email) await SecureStore.setItemAsync(CHAVE_EMAIL, email);
  await SecureStore.setItemAsync(CHAVE_ATIVA, '1');
}

/** Regrava o token girado pelo Supabase, so se a biometria estiver ativa. */
export async function atualizarTokenBiometria(refreshToken: string) {
  if (!BIOMETRIA_NO_APARELHO) return;
  const ativa = await SecureStore.getItemAsync(CHAVE_ATIVA).catch(() => null);
  if (ativa === '1') await SecureStore.setItemAsync(CHAVE_TOKEN, refreshToken).catch(() => {});
}

export async function lerTokenBiometria(): Promise<string | null> {
  if (!BIOMETRIA_NO_APARELHO) return null;
  return SecureStore.getItemAsync(CHAVE_TOKEN).catch(() => null);
}

export async function desativarBiometria() {
  if (!BIOMETRIA_NO_APARELHO) return;
  await Promise.all([CHAVE_ATIVA, CHAVE_TOKEN, CHAVE_EMAIL].map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
}

/** Oferecer a biometria uma vez so, depois do primeiro login com senha. */
export async function jaPerguntouBiometria(): Promise<boolean> {
  if (!BIOMETRIA_NO_APARELHO) return true;
  return (await SecureStore.getItemAsync(CHAVE_PERGUNTOU).catch(() => null)) === '1';
}
export async function marcarPerguntouBiometria() {
  if (!BIOMETRIA_NO_APARELHO) return;
  await SecureStore.setItemAsync(CHAVE_PERGUNTOU, '1').catch(() => {});
}
