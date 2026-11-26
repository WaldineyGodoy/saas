import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Push do app (Central de notificações, migração 20261126b).
 *
 * O aparelho pede permissão, pega o token do Expo e registra no login atual
 * (app_registrar_push_token). O banco cria as notificações a partir dos
 * eventos e o cron "push-app" envia pelo serviço do Expo. Ao sair, o token
 * é desligado para o próximo login do aparelho não receber o que era do outro.
 */
export const PUSH_NO_APARELHO = Platform.OS !== 'web';

let tokenAtual: string | null = null;

if (PUSH_NO_APARELHO) {
  // App aberto: mostra o aviso do mesmo jeito.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function registrarPush(): Promise<void> {
  if (!PUSH_NO_APARELHO || !Device.isDevice) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos da B2W',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const atual = await Notifications.getPermissionsAsync();
    const permissao = atual.granted ? atual : await Notifications.requestPermissionsAsync();
    if (!permissao.granted) return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;
    await supabase.rpc('app_registrar_push_token', { p_token: token, p_plataforma: Platform.OS });
    tokenAtual = token;
  } catch (e) {
    // Sem push o app continua: os avisos ficam na caixa de notificações.
    console.warn('registrarPush', e);
  }
}

export async function desligarPush(): Promise<void> {
  if (!tokenAtual) return;
  await supabase.rpc('app_remover_push_token', { p_token: tokenAtual }).then(() => undefined, () => undefined);
  tokenAtual = null;
}

/** Rota de destino de um push tocado (ou null). */
export const rotaDoPush = (resposta: Notifications.NotificationResponse | null): { id?: string; rota?: string } | null => {
  const dados = resposta?.notification.request.content.data as { id?: string; rota?: string } | undefined;
  return dados ?? null;
};
