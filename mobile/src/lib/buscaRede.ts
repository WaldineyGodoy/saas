import type { ClienteParceiro } from './api';

const soDigitos = (t?: string | null) => (t ?? '').replace(/\D/g, '');
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Buscavel = Pick<ClienteParceiro, 'name' | 'cpf_cnpj' | 'representante_cpf' | 'telefone'>;

/**
 * Busca da "Minha rede de clientes" (Home Connect): nome sem acento, ou
 * CPF/CNPJ/telefone com ou sem pontuação (a partir de 3 dígitos).
 */
export function casaBusca(c: Buscavel, busca: string): boolean {
  const q = busca.trim();
  if (!q) return true;
  if (semAcento(c.name ?? '').includes(semAcento(q))) return true;
  const dig = soDigitos(q);
  if (dig.length < 3) return false;
  return [c.cpf_cnpj, c.representante_cpf, c.telefone].some((v) => soDigitos(v).includes(dig));
}
