/**
 * CPF/CNPJ e CEP do cadastro de parceiro pelo app. Mesmas regras de
 * src/lib/validators.js do CRM: o documento vira chave PIX e é por ele que a
 * comissão é paga, então um dígito errado só apareceria meses depois.
 */
export const soDigitos = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

function cpfValido(c: string) {
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(c[n])) return false;
  }
  return true;
}

function cnpjValido(c: string) {
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const n of [12, 13]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * pesos[i + 13 - n];
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    if (dv !== Number(c[n])) return false;
  }
  return true;
}

export function documentoValido(v: string) {
  const c = soDigitos(v);
  return c.length === 11 ? cpfValido(c) : c.length === 14 ? cnpjValido(c) : false;
}

export const tipoDocumento = (v: string): 'cpf' | 'cnpj' => (soDigitos(v).length > 11 ? 'cnpj' : 'cpf');

export type EnderecoCep = { rua: string; bairro: string; cidade: string; uf: string };

/** ViaCEP. Sem resposta, a pessoa preenche o endereço à mão. */
export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const c = soDigitos(cep);
  if (c.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${c}/json/`);
    const j = await r.json();
    if (!r.ok || j?.erro) return null;
    return { rua: j.logradouro ?? '', bairro: j.bairro ?? '', cidade: j.localidade ?? '', uf: j.uf ?? '' };
  } catch {
    return null;
  }
}
