import AsyncStorage from '@react-native-async-storage/async-storage';
import { CRM_URL } from './env';

/**
 * Adesão do cliente novo pelo app.
 *
 * A visita (lead_visitas) registrada na pergunta da indicação é o que a
 * adesão usa para atribuir a indicação: "vale a sessão que concluiu"
 * (20261006b). Ela fica guardada até o contrato sair.
 *
 * Etapa 3 (11/10/2026): conta, plano, dados e documentos são telas do app
 * (app/adesao.tsx). Só o contrato abre o site, pelo link de retomada
 * (/contrato?retomar=<token>), que já entra no passo de gerar e assinar.
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

/** Link de retomada do site: com os documentos enviados, abre no passo do contrato. */
export const urlContratoRetomar = (token: string) => `${CRM_URL}/contrato?retomar=${encodeURIComponent(token)}`;

/** Mesma versão dos termos que o site grava no aceite (src/lib/onboarding.js). */
export const VERSAO_TERMOS = '3.0';
export const URL_TERMOS_USO = 'https://b2wenergia.com.br/termos-de-uso/';
export const DIAS_VENCIMENTO = [5, 10, 15, 20];
