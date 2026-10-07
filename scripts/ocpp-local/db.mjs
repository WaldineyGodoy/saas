// Banco do Supabase LOCAL para o OCPP (Tarefa 10). Nunca toca em producao: fala so com o container
// supabase_db_* desta maquina (psql dentro do container).
//
//   node scripts/ocpp-local/db.mjs migrar      bootstrap + migracoes OCPP verbatim (se ainda nao aplicadas)
//   node scripts/ocpp-local/db.mjs seed        scripts/ocpp-seed.sql (idempotente)
//   node scripts/ocpp-local/db.mjs testes-sql  supabase/tests/<OCPP>.test.sql; cada um deve terminar em SANDBOX_OK
//
// Por que nao `supabase db reset`: as migracoes do repo nao reproduzem o banco do zero (ver o cabecalho
// de scripts/ocpp-local-bootstrap.sql). O stack sobe com SUPABASE_DB_MIGRATIONS_ENABLED=false.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const MIGRACOES_OCPP = [
  'supabase/migrations/20260923_create_planos_assinatura_energia.sql',
  'supabase/migrations/20260929a_eletropostos.sql',
  'supabase/migrations/20260929b_planos_escrita_so_admin.sql',
  'supabase/migrations/20260930_create_recargas_eletroposto.sql',
  'supabase/migrations/20261007a_recarga_seguranca.sql',
  'supabase/migrations/20261007b_ocpp_estrutura.sql',
  'supabase/migrations/20261007c_conector_numero.sql',
  'supabase/migrations/20261007d_recarga_publica_tarifa.sql',
  'supabase/migrations/20261007e_recarga_estorno_tardio.sql',
];

// Migracoes so de CREATE OR REPLACE/grants: reaplicadas mesmo num banco local que ja tem as anteriores
// (o banco local criado antes delas as recebe no proximo `migrar`).
export const MIGRACOES_OCPP_REAPLICAVEIS = [
  'supabase/migrations/20261007e_recarga_estorno_tardio.sql',
];

export const TESTES_SQL_OCPP = [
  'supabase/tests/eletropostos.test.sql',
  'supabase/tests/recarga_seguranca.test.sql',
  'supabase/tests/ocpp_estrutura.test.sql',
  'supabase/tests/conector_numero.test.sql',
  'supabase/tests/recarga_estorno_tardio.test.sql',
];

export function containerDb() {
  if (process.env.OCPP_DB_CONTAINER) return process.env.OCPP_DB_CONTAINER;
  const nomes = execFileSync('docker', ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  if (nomes.length !== 1) {
    throw new Error(`esperado 1 container supabase_db_* rodando, achei ${nomes.length} (${nomes.join(', ')}); defina OCPP_DB_CONTAINER`);
  }
  return nomes[0];
}

// Roda SQL (texto) no psql do container como `postgres` (o mesmo papel do SQL Editor).
export function psql(sql, { pararNoErro = true } = {}) {
  const args = ['exec', '-i', containerDb(), 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q'];
  if (pararNoErro) args.push('-v', 'ON_ERROR_STOP=1');
  const r = spawnSync('docker', args, { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function psqlArquivo(rel) {
  const r = psql(readFileSync(join(RAIZ, rel), 'utf8'));
  if (r.status !== 0) throw new Error(`${rel} falhou (psql ${r.status}):\n${r.stderr}`);
  return r;
}

export function migrar({ log = console.log } = {}) {
  const r = psql("select (to_regclass('public.ocpp_comandos') is not null)::text;");
  if (r.status === 0 && r.stdout.includes('true')) {
    log('[ocpp-db] migracoes OCPP ja aplicadas; reaplicando as reaplicaveis');
    for (const m of MIGRACOES_OCPP_REAPLICAVEIS) {
      log(`[ocpp-db] aplicando ${m}`);
      psqlArquivo(m);
    }
    psql("notify pgrst, 'reload schema';");
    return false;
  }
  log('[ocpp-db] aplicando scripts/ocpp-local-bootstrap.sql');
  psqlArquivo('scripts/ocpp-local-bootstrap.sql');
  for (const m of MIGRACOES_OCPP) {
    log(`[ocpp-db] aplicando ${m}`);
    psqlArquivo(m);
  }
  // PostgREST le o schema em cache: avisa que mudou
  psql("notify pgrst, 'reload schema';");
  return true;
}

export function seed({ log = console.log } = {}) {
  log('[ocpp-db] aplicando scripts/ocpp-seed.sql');
  psqlArquivo('scripts/ocpp-seed.sql');
  psql("notify pgrst, 'reload schema';");
}

// Executa cada teste VERBATIM. Sucesso = a unica mensagem de erro e SANDBOX_OK.
export function testesSql(arquivos = TESTES_SQL_OCPP, { log = console.log } = {}) {
  const resultados = [];
  for (const rel of arquivos) {
    const r = psql(readFileSync(join(RAIZ, rel), 'utf8'), { pararNoErro: true });
    const erros = r.stderr.split(/\r?\n/).filter((l) => /^(psql:.*)?ERROR:|^ERROR:/.test(l) || l.includes('ERROR:'));
    const ok = erros.length === 1 && /ERROR:\s+SANDBOX_OK\b/.test(erros[0]);
    resultados.push({ arquivo: rel, ok, saida: (r.stderr || r.stdout).trim() });
    log(`[ocpp-db] ${ok ? 'OK  ' : 'FAIL'} ${rel}${ok ? '' : `\n${r.stderr || r.stdout}`}`);
  }
  return resultados;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...resto] = process.argv.slice(2);
  try {
    if (cmd === 'migrar') migrar();
    else if (cmd === 'seed') seed();
    else if (cmd === 'testes-sql') {
      const res = testesSql(resto.length ? resto : undefined);
      if (res.some((x) => !x.ok)) process.exit(1);
    } else {
      console.error('uso: node scripts/ocpp-local/db.mjs migrar | seed | testes-sql [arquivos...]');
      process.exit(2);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
