import { defineConfig } from '@playwright/test';
import { ambienteLocal } from './e2e/support/local';

// E2E da tela /recarga contra o stack LOCAL (Supabase + CSMS + emulador). Usa o Chromium ja
// instalado em %LOCALAPPDATA%\ms-playwright (@playwright/test 1.60 = chromium-1223); nao rodar
// `playwright install`. O Vite sobe com a URL/anon do Supabase LOCAL, que prevalecem sobre o .env.
const PORTA = Number(process.env.E2E_PORT || 5199);
const amb = ambienteLocal();

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORTA}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORTA} --strictPort`,
    url: `http://127.0.0.1:${PORTA}/recarga`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: amb.url,
      VITE_SUPABASE_ANON_KEY: amb.anon,
      ...(process.env.VITE_STRIPE_PUBLISHABLE_KEY ? { VITE_STRIPE_PUBLISHABLE_KEY: process.env.VITE_STRIPE_PUBLISHABLE_KEY } : {}),
    },
  },
});
