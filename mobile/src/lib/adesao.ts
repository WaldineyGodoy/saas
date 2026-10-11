import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Adesão do cliente novo pelo app.
 *
 * A visita (lead_visitas) registrada na pergunta da indicação é o que a
 * adesão usa para atribuir a indicação: "vale a sessão que concluiu"
 * (20261006b). Ela fica guardada até o contrato sair.
 *
 * Etapa 3 (11/10/2026): a adesão inteira é do app (app/adesao.tsx); o termo
 * é gerado no servidor (onboarding-finalizar com gerar_no_servidor).
 */
const CHAVE = 'b2w.visitaAdesao';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function guardarVisitaAdesao(visita: string) {
  try { await AsyncStorage.setItem(CHAVE, visita); } catch { /* sem armazenamento: o lead continua no CRM */ }
}

export async function lerVisitaAdesao(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(CHAVE);
    return v && UUID.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Mesma versão dos termos que o site grava no aceite (src/lib/onboarding.js). */
export const VERSAO_TERMOS = '3.0';
export const URL_TERMOS_USO = 'https://b2wenergia.com.br/termos-de-uso/';
export const DIAS_VENCIMENTO = [5, 10, 15, 20];
