// Configuracao do processo, somente a partir de variaveis de ambiente (segredos nunca no codigo).
import type { ModoAuth } from './server/auth.js';

export interface Config {
  porta: number;
  auth: ModoAuth;
  connectionTimeoutS: number;
  supabaseUrl: string;
  serviceRoleKey: string;
}

type Env = Record<string, string | undefined>;

function inteiro(env: Env, nome: string, padrao: number, min: number, max: number): number {
  const bruto = env[nome];
  if (bruto === undefined || bruto === '') return padrao;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nome} invalida: esperado inteiro entre ${min} e ${max}`);
  return n;
}

export function lerConfig(env: Env): Config {
  const faltando = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((n) => !env[n]);
  if (faltando.length > 0) throw new Error(`variaveis obrigatorias ausentes: ${faltando.join(', ')}`);
  const auth = env.OCPP_AUTH || 'basic';
  if (auth !== 'basic' && auth !== 'off') throw new Error("OCPP_AUTH invalida: use 'basic' ou 'off'");
  return {
    porta: inteiro(env, 'PORT', 9220, 1, 65535),
    auth,
    connectionTimeoutS: inteiro(env, 'CONNECTION_TIMEOUT_S', 120, 1, 86400),
    supabaseUrl: env.SUPABASE_URL as string,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY as string,
  };
}
