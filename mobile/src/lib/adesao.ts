import AsyncStorage from '@react-native-async-storage/async-storage';
import { CRM_URL } from './env';

/**
 * Adesão do cliente novo pelo app.
 *
 * A visita (lead_visitas) registrada na pergunta da indicação é o que a
 * adesão usa para atribuir a indicação: "vale a sessão que concluiu"
 * (20261006b). Ela fica guardada até o contrato sair.
 *
 * Etapa provisória: enquanto as telas próprias da adesão não ficam prontas
 * (etapa 3 do plano), a adesão abre o /contrato do site com essa visita, que
 * já preenche o que a pessoa digitou e atribui a indicação certa.
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

export const urlAdesaoSite = (visita: string | null) =>
  visita ? `${CRM_URL}/contrato?lead_id=${encodeURIComponent(visita)}` : `${CRM_URL}/contrato`;
