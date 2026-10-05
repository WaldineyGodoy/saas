import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

// O token de sessao fica no Keychain (iOS) / Keystore (Android). O SecureStore
// limita cada valor a ~2 KB, e a sessao do Supabase passa disso; por isso ela
// e fatiada em pedacos com um indice.
const CHUNK = 1800;

const secureStorage = {
  async getItem(key: string) {
    const n = await SecureStore.getItemAsync(`${key}.n`);
    if (!n) return null;
    const parts = await Promise.all(
      Array.from({ length: Number(n) }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)),
    );
    return parts.some((p) => p == null) ? null : parts.join('');
  },
  async setItem(key: string, value: string) {
    await this.removeItem(key);
    const parts = value.match(new RegExp(`.{1,${CHUNK}}`, 'gs')) ?? [''];
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(`${key}.${i}`, p)));
    await SecureStore.setItemAsync(`${key}.n`, String(parts.length));
  },
  async removeItem(key: string) {
    const n = await SecureStore.getItemAsync(`${key}.n`);
    if (!n) return;
    await Promise.all(
      Array.from({ length: Number(n) }, (_, i) => SecureStore.deleteItemAsync(`${key}.${i}`)),
    );
    await SecureStore.deleteItemAsync(`${key}.n`);
  },
};

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'missing', {
  auth: {
    storage: Platform.OS === 'web' ? undefined : secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Em app mobile o refresh automatico so deve rodar com o app em primeiro plano.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
