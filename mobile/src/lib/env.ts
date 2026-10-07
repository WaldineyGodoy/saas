export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL ?? 'https://crm.b2wenergia.com.br').replace(/\/$/, '');
export const envOk = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
