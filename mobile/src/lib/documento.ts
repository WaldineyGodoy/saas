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

export type EnderecoCep = { rua: string; bairro: string; cidade: string; uf: string; ibge: string };

/** ViaCEP. Sem resposta, a pessoa preenche o endereço à mão. */
export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const c = soDigitos(cep);
  if (c.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${c}/json/`);
    const j = await r.json();
    if (!r.ok || j?.erro) return null;
    return { rua: j.logradouro ?? '', bairro: j.bairro ?? '', cidade: j.localidade ?? '', uf: j.uf ?? '', ibge: j.ibge ?? '' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Consulta pública do CNPJ (cnpj.ws, a mesma do CRM): adesão PJ pelo app.

export type EmpresaCnpj = {
  cnpj: string;
  razaoSocial: string;
  email: string;
  telefone: string;
  /** Sócio-administrador (ou o único sócio pessoa física). O CPF dos sócios
   *  vem mascarado pela Receita, então só o nome serve de preenchimento. */
  representante: string;
};

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Nome em caixa de nome próprio: "MARIA DA SILVA" -> "Maria da Silva". */
export function nomeProprio(nome: string) {
  const minusculas = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  return nome.trim().toLowerCase().split(/\s+/).filter(Boolean)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
}

type Socio = { nome?: string; tipo?: string; qualificacao_socio?: { descricao?: string } | string };

/** Mesma regra do CRM (src/lib/representanteLegal.js): o administrador; sem ele, só se houver um sócio pessoa física. */
export function escolherRepresentante(socios: unknown): string {
  if (!Array.isArray(socios)) return '';
  const pessoas = (socios as Socio[]).filter((s) => s?.nome?.trim() && semAcento(s.tipo || 'pessoa fisica').includes('fisica'));
  const qualif = (s: Socio) => (typeof s.qualificacao_socio === 'string' ? s.qualificacao_socio : s.qualificacao_socio?.descricao ?? '');
  const escolhido = pessoas.find((s) => semAcento(qualif(s)).includes('administrador')) ?? (pessoas.length === 1 ? pessoas[0] : null);
  return escolhido?.nome ? nomeProprio(escolhido.nome) : '';
}

/** null = CNPJ não encontrado; lança em falha de rede (a pessoa pode tentar de novo). */
export async function buscarCnpj(cnpj: string): Promise<EmpresaCnpj | null> {
  const c = soDigitos(cnpj);
  if (!documentoValido(c) || c.length !== 14) return null;
  const r = await fetch(`https://publica.cnpj.ws/cnpj/${c}`);
  if (r.status === 404 || r.status === 400) return null;
  if (r.status === 429) throw new Error('Muitas consultas de CNPJ seguidas. Aguarde um minuto e tente de novo.');
  if (!r.ok) throw new Error('A consulta do CNPJ não respondeu. Tente de novo ou preencha à mão.');
  const j = await r.json();
  const est = j?.estabelecimento ?? {};
  return {
    cnpj: c,
    razaoSocial: String(j?.razao_social ?? '').trim(),
    email: String(est.email ?? '').trim().toLowerCase(),
    telefone: est.ddd1 && est.telefone1 ? `(${est.ddd1}) ${est.telefone1}` : '',
    representante: escolherRepresentante(j?.socios),
  };
}
