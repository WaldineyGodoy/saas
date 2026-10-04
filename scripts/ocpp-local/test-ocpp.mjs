// `npm run test:ocpp`: L3b do OCPP de ponta a ponta (Tarefa 10). Funciona no Windows e no Linux (CI).
//
//   1. Supabase LOCAL de pe (sobe com as migracoes do CLI desligadas, se preciso)
//   2. bootstrap + migracoes OCPP verbatim (so na primeira vez) + seed + testes SQL (SANDBOX_OK)
//   3. docker compose -f docker-compose.ocpp.yml up -d --build  (CSMS + substituto do estorno)
//   4. pytest tools/ocpp-emulator/tests/integration -v  (argumentos extras sao repassados ao pytest)
//
// As chaves vem de `npx supabase status -o env` e so vivem no ambiente deste processo.
// `--down` derruba o compose no fim (o Supabase local fica de pe).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrar, seed, testesSql } from './db.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';
const NPX = WIN ? 'npx.cmd' : 'npx';
const COMPOSE = join(RAIZ, 'docker-compose.ocpp.yml');
// Servicos do Supabase que a L3b nao usa (economiza disco e memoria)
const EXCLUIR = 'storage-api,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor';

const args = process.argv.slice(2);
const derrubar = args.includes('--down');
const repassar = args.filter((a) => a !== '--down');

function rodar(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd: RAIZ, stdio: 'inherit', shell: WIN && cmd.endsWith('.cmd'), ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} saiu com ${r.status}`);
}

function statusSupabase() {
  const r = spawnSync(NPX, ['supabase', 'status', '-o', 'env'], { cwd: RAIZ, encoding: 'utf8', shell: WIN });
  if (r.status !== 0) return null;
  const env = {};
  for (const linha of r.stdout.split(/\r?\n/)) {
    const m = linha.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return env.SERVICE_ROLE_KEY ? env : null;
}

async function esperar(url, oque, ms = 60000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try { if ((await fetch(url)).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout esperando ${oque} (${url})`);
}

function python() {
  if (process.env.OCPP_PYTHON) return process.env.OCPP_PYTHON;
  const venv = join(RAIZ, 'tools', 'ocpp-emulator', '.venv', WIN ? 'Scripts/python.exe' : 'bin/python');
  return existsSync(venv) ? venv : (WIN ? 'python' : 'python3');
}

async function main() {
  execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' });

  let sb = statusSupabase();
  if (!sb) {
    console.log('[test:ocpp] subindo o Supabase local (migracoes do CLI desligadas: ver scripts/ocpp-local-bootstrap.sql)');
    rodar(NPX, ['supabase', 'start', '-x', EXCLUIR], {
      env: { ...process.env, SUPABASE_DB_MIGRATIONS_ENABLED: 'false', SUPABASE_DB_SEED_ENABLED: 'false' },
    });
    sb = statusSupabase();
    if (!sb) throw new Error('supabase status nao devolveu as chaves');
  }
  const apiUrl = sb.API_URL ?? 'http://127.0.0.1:54321';
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl)) throw new Error(`API_URL nao e local: ${apiUrl}`);

  migrar();
  seed();
  if (testesSql().some((x) => !x.ok)) throw new Error('testes SQL falharam');

  const env = {
    ...process.env, SUPABASE_URL: apiUrl, SUPABASE_SERVICE_ROLE_KEY: sb.SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: sb.ANON_KEY, OCPP_COMPOSE_FILE: COMPOSE,
  };
  rodar('docker', ['compose', '-f', COMPOSE, 'up', '-d', '--build'], { env });
  await esperar('http://127.0.0.1:9220/health', 'CSMS');
  await esperar('http://127.0.0.1:54398/__stub/health', 'substituto do estorno');

  let codigo = 0;
  try {
    rodar(python(), ['-m', 'pytest', 'tests/integration', '-v', ...repassar],
      { cwd: join(RAIZ, 'tools', 'ocpp-emulator'), env });
  } catch (e) {
    codigo = 1;
    console.error(`[test:ocpp] ${e.message}`);
    spawnSync('docker', ['compose', '-f', COMPOSE, 'logs', '--tail', '200'], { cwd: RAIZ, stdio: 'inherit', env });
  } finally {
    if (derrubar) spawnSync('docker', ['compose', '-f', COMPOSE, 'down'], { cwd: RAIZ, stdio: 'inherit', env });
  }
  process.exit(codigo);
}

main().catch((e) => {
  console.error(`[test:ocpp] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
