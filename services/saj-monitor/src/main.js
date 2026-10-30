/**
 * saj-monitor — robô de monitoramento dos inversores SAJ das usinas.
 *
 * Roda na VPS Contabo (EasyPanel, projeto b2w), porque a SAJ só aceita chamada
 * dos IPs da whitelist do app. A cada INTERVALO_MIN minutos coleta e entrega o
 * pacote a `fn_monitor_registrar` no Supabase.
 *
 * O robô não tem service_role. Ele fala com o banco pela chave anon (pública)
 * e prova quem é com MONITOR_TOKEN, um segredo nascido no Vault do banco e
 * conferido lá dentro. A função só sabe gravar nas tabelas monitor_*, então um
 * vazamento deste container não abre o resto do CRM.
 *
 *   node src/main.js            loop contínuo
 *   node src/main.js --uma-vez  um ciclo e sai (teste manual)
 */
import { criarClienteSaj } from './saj.js';
import { coletar } from './coleta.js';

const env = process.env;
const obrigatorias = ['SAJ_APP_ID', 'SAJ_APP_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'MONITOR_TOKEN'];
const faltando = obrigatorias.filter((k) => !env[k]);
if (faltando.length) {
  console.error(`variáveis ausentes: ${faltando.join(', ')}`);
  process.exit(1);
}

const intervaloMs = Math.max(5, Number(env.INTERVALO_MIN ?? 10)) * 60 * 1000;
const saj = criarClienteSaj({ appId: env.SAJ_APP_ID, appSecret: env.SAJ_APP_SECRET, base: env.SAJ_BASE || undefined });

async function registrar(pacote) {
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/fn_monitor_registrar`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_token: env.MONITOR_TOKEN, p_fabricante: 'SAJ', p_pacote: pacote }),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

async function ciclo() {
  const t0 = Date.now();
  let pacote;
  try {
    pacote = await coletar(saj);
  } catch (err) {
    // falha antes de qualquer dado (token, IP fora da whitelist, app não publicado):
    // o banco registra mesmo assim, para fn_saude_robos mostrar que o robô rodou e falhou
    pacote = { coletado_em: new Date().toISOString(), dispositivos: [], plantas: [], alarmes: [], erros: [err.message] };
  }
  try {
    const r = await registrar(pacote);
    console.log(`[${pacote.coletado_em}] ${pacote.dispositivos.length} inversores, ${pacote.plantas.length} usinas, `
      + `${pacote.alarmes.length} alarmes, ${pacote.erros.length} erros em ${Date.now() - t0} ms`, r ?? '');
    for (const e of pacote.erros) console.error(`  erro: ${e}`);
  } catch (err) {
    console.error(`[${pacote.coletado_em}] não gravou no Supabase: ${err.message}`);
    for (const e of pacote.erros) console.error(`  erro SAJ: ${e}`);
  }
}

if (process.argv.includes('--uma-vez')) {
  await ciclo();
} else {
  for (;;) {
    await ciclo();
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
}
