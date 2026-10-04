// Autenticacao do handshake (OCPP Security Profile 1: HTTP Basic sobre WS).
//
// Formato de senha_hash em eletroposto_carregadores (autodescritivo, scrypt do node:crypto):
//   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
// Gere com gerarSenhaHash(senha) (runbook e seed usam isto). A senha e o hash NUNCA sao logados.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Repo } from '../repo/types.js';

const N = 16384;
const R = 8;
const P = 1;
const TAM_CHAVE = 32;
const N_MAX = 1 << 20; // limite defensivo ao ler parametros do hash

export function gerarSenhaHash(senha: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(Buffer.from(senha, 'utf8'), salt, TAM_CHAVE, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Falha fechado: qualquer formato invalido devolve false.
export function verificarSenha(senha: Buffer, hashArmazenado: string): boolean {
  try {
    const [alg, n, r, p, salt64, hash64] = hashArmazenado.split('$');
    if (alg !== 'scrypt' || !n || !r || !p || !salt64 || !hash64) return false;
    const Nn = Number(n);
    const Rr = Number(r);
    const Pp = Number(p);
    if (![Nn, Rr, Pp].every(Number.isInteger) || Nn < 2 || Nn > N_MAX || (Nn & (Nn - 1)) !== 0) return false;
    if (Rr < 1 || Rr > 32 || Pp < 1 || Pp > 16) return false;
    const esperado = Buffer.from(hash64, 'base64');
    if (esperado.length === 0) return false;
    const calculado = scryptSync(senha, Buffer.from(salt64, 'base64'), esperado.length, {
      N: Nn, r: Rr, p: Pp, maxmem: 256 * Nn * Rr,
    });
    return timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

export type ModoAuth = 'basic' | 'off';

export interface HandshakeLike {
  identity: string;
  protocols: Set<string>;
  password: Buffer | undefined;
}

type Aceitar = (session?: Record<string, unknown>, protocol?: string | false) => void;
type Recusar = (code: number, message: string) => void;

export function criarAuth(repo: Repo, modo: ModoAuth) {
  const recusar = async (reject: Recusar, h: HandshakeLike, code: number, motivo: string, carregadorId: string | null) => {
    try {
      await repo.logMensagem({
        carregador_id: carregadorId, ocpp_id: h.identity, direcao: 'entrada', tipo: null,
        unique_id: null, acao: 'handshake_recusado', payload: { codigo: code, motivo },
      });
    } catch { /* a trilha nunca derruba o handshake */ }
    reject(code, motivo);
  };

  return async (accept: Aceitar, reject: Recusar, h: HandshakeLike): Promise<void> => {
    if (!h.protocols.has('ocpp1.6')) return recusar(reject, h, 400, 'subprotocolo ocpp1.6 obrigatorio', null);
    const cp = await repo.buscarCarregador(h.identity);
    if (!cp) return recusar(reject, h, 404, 'carregador nao cadastrado', null);
    if (modo === 'basic') {
      if (!cp.senha_hash || !h.password || !verificarSenha(h.password, cp.senha_hash)) {
        return recusar(reject, h, 401, 'credenciais invalidas', cp.id);
      }
    }
    accept({ carregadorId: cp.id, ocppId: cp.ocpp_id });
  };
}
