// Processo do CSMS: le o ambiente, liga o repo do Supabase (service role) e sobe o servidor OCPP + fila.
// A montagem em si (testavel sem ambiente) esta em app.ts.
import { iniciarApp } from './app.js';
import { lerConfig } from './config.js';
import { criarSupabaseRepo } from './repo/supabase.js';

async function main(): Promise<void> {
  const cfg = lerConfig(process.env);
  const repo = criarSupabaseRepo(cfg.supabaseUrl, cfg.serviceRoleKey);
  const app = await iniciarApp({
    repo, porta: cfg.porta, host: '0.0.0.0', auth: cfg.auth, connectionTimeoutS: cfg.connectionTimeoutS,
    callTimeoutMs: cfg.callTimeoutS * 1000, verificarOfflineMs: cfg.offlineCheckS * 1000,
  });
  console.log(`[ocpp-csms] ouvindo na porta ${app.porta} (auth=${cfg.auth})`);

  let encerrando = false;
  const encerrar = (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    console.log(`[ocpp-csms] ${sinal}: encerrando`);
    // pior caso: o fechamento trava; o orquestrador manda SIGKILL depois do prazo dele
    app.parar()
      .then(() => repo.fechar())
      .then(() => process.exit(0), (e) => { console.error('[ocpp-csms] falha ao encerrar:', e); process.exit(1); });
  };
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

main().catch((e) => {
  console.error('[ocpp-csms] falha ao iniciar:', e instanceof Error ? e.message : e);
  process.exit(1);
});
