import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * O que a conta nova quer fazer (decisão do dono, 11/10/2026). Login sem
 * produto nem sempre é um futuro assinante: pode ser um motorista, um
 * parceiro ou um investidor. A escolha fica no aparelho, por conta, só para
 * o início não abrir a tela de opções de novo depois que a pessoa escolheu.
 */
export type Objetivo = 'energia' | 'recarga' | 'parceiro' | 'investir';

const chave = (uid: string) => `b2w.objetivo.${uid}`;

export async function guardarObjetivo(uid: string | undefined, objetivo: Objetivo) {
  if (!uid) return;
  try { await AsyncStorage.setItem(chave(uid), objetivo); } catch { /* sem armazenamento: a tela volta a perguntar */ }
}

export async function lerObjetivo(uid: string | undefined): Promise<Objetivo | null> {
  if (!uid) return null;
  try {
    const v = await AsyncStorage.getItem(chave(uid));
    return v === 'energia' || v === 'recarga' || v === 'parceiro' || v === 'investir' ? v : null;
  } catch {
    return null;
  }
}
