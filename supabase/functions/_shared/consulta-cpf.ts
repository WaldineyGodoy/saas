/**
 * Regras da consulta de CPF na CPFHub (https://www.cpfhub.io/documentacao).
 *
 * Sem imports Deno e sem acesso a rede, para o Vitest testar tudo. O que toca
 * rede e banco fica em `consulta-cpf/index.ts`.
 *
 * Duas coisas aqui custam dinheiro de verdade, e por isso sao regras e nao
 * detalhe de tela:
 *
 *   1. So uma resposta 200 consome credito (1 por CPF encontrado). 400, 404,
 *      422, 429, 502 e 503 nao consomem. A validacao do CPF vem ANTES da
 *      chamada: CPF com digito errado nunca chega a API.
 *   2. Timeout do nosso lado nao quer dizer que a consulta falhou: ela pode
 *      ter sido concluida e cobrada no servidor, e repetir cobra de novo. Por
 *      isso so se repete em 5xx (que nao cobra), nunca em timeout.
 *
 * ASCII-only: acentos em escapes \u, como as demais shared (o canal de deploy
 * do MCP decodifica; o resultado e identico).
 */

import { PAPEIS_INTERNOS } from './envio-portao.ts';

export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/** CPF de 11 digitos, nao repetido, com os dois digitos verificadores certos. */
export function cpfValido(valor: unknown): boolean {
  const cpf = soDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== Number(cpf[tamanho])) return false;
  }
  return true;
}

/**
 * DD/MM/AAAA (formato da CPFHub) para AAAA-MM-DD (formato do banco).
 * Data que nao existe, no futuro ou de antes de 1900 volta nula: melhor
 * campo vazio do que uma data inventada num contrato.
 */
export function nascimentoIso(br: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br ?? '').trim());
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]), ano = Number(m[3]);
  if (ano < 1900 || mes < 1 || mes > 12 || dia < 1) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  if (d.getTime() > Date.now()) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * A base pode devolver o nome todo em maiusculas. So nesse caso converte; um
 * nome que ja veio em caixa mista (McDonald, de Souza) nao e mexido.
 */
export function nomeProprio(nome: unknown): string {
  const limpo = String(nome ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return '';
  if (limpo !== limpo.toUpperCase()) return limpo;
  return limpo
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

export type Resultado =
  | { tipo: 'encontrado'; cpf: string; nome: string; nascimento: string | null; creditos: 1 }
  | { tipo: 'nao_encontrado'; creditos: 0 }
  | { tipo: 'cpf_invalido'; creditos: 0 }
  | { tipo: 'limite_minuto'; espera: number; creditos: 0 }
  | { tipo: 'chave_invalida'; creditos: 0 }
  | { tipo: 'sem_credito'; creditos: 0 }
  | { tipo: 'conta_bloqueada'; creditos: 0 }
  | { tipo: 'indisponivel'; retentavel?: boolean; creditos: 0 };

/** A CPFHub usa `error` como objeto (com message) ou como texto: le os dois. */
const textoDoErro = (corpo: unknown): string => {
  const e = (corpo as { error?: unknown } | null)?.error;
  if (typeof e === 'string') return e;
  const msg = (e as { message?: unknown } | null)?.message;
  return typeof msg === 'string' ? msg : '';
};

/**
 * Traduz status + corpo da CPFHub no que fazer. Decide pelo status HTTP, como
 * a propria documentacao manda: a mensagem em texto serve para log, nao para
 * comparar -- exceto no 403, onde o status e o mesmo para saldo acabado e para
 * conta bloqueada e so o formato do erro (objeto x texto) separa os dois.
 */
export function interpretarResposta(status: number, corpo: unknown, retryAfter?: string | null): Resultado {
  if (status === 200) {
    const d = (corpo as { success?: boolean; data?: Record<string, unknown> } | null)?.data;
    const nome = nomeProprio(d?.name);
    // 200 sem nome nao e um achado: nao entrega campo vazio como se fosse dado.
    if (!d || !nome) return { tipo: 'indisponivel', retentavel: false, creditos: 0 };
    return { tipo: 'encontrado', cpf: soDigitos(d.cpf), nome, nascimento: nascimentoIso(d.birthDate), creditos: 1 };
  }
  if (status === 404) return { tipo: 'nao_encontrado', creditos: 0 };
  if (status === 400 || status === 422) return { tipo: 'cpf_invalido', creditos: 0 };
  if (status === 429) {
    const n = Number.parseInt(String(retryAfter ?? ''), 10);
    return { tipo: 'limite_minuto', espera: Number.isFinite(n) && n > 0 ? n : 5, creditos: 0 };
  }
  if (status === 401) return { tipo: 'chave_invalida', creditos: 0 };
  if (status === 403) {
    const e = (corpo as { error?: unknown } | null)?.error;
    // Objeto = "Limite de creditos excedido"; texto = conta inativa/bloqueada.
    if (e && typeof e === 'object' && /cr[e\u00e9]dito/i.test(textoDoErro(corpo))) return { tipo: 'sem_credito', creditos: 0 };
    return { tipo: 'conta_bloqueada', creditos: 0 };
  }
  if (status === 500 || status === 502 || status === 503) return { tipo: 'indisponivel', retentavel: true, creditos: 0 };
  return { tipo: 'indisponivel', retentavel: false, creditos: 0 };
}

const MENSAGENS: Record<string, string> = {
  cpf_invalido: 'CPF inv\u00e1lido. Confira os n\u00fameros e tente de novo.',
  nao_encontrado: 'N\u00e3o encontramos esse CPF na base de consulta. Preencha os dados manualmente.',
  limite_minuto: 'Muitas consultas ao mesmo tempo. Aguarde alguns segundos e tente de novo.',
  limite_publico: 'Muitas consultas por aqui. Preencha os dados manualmente ou tente mais tarde.',
  indisponivel: 'A consulta do CPF est\u00e1 indispon\u00edvel agora. Preencha os dados manualmente.',
  // Saldo acabado, chave errada, conta bloqueada e consulta sem configuracao:
  // quem usa o site nao pode fazer nada a respeito, e nao deve saber a causa.
  sem_credito: 'A consulta do CPF est\u00e1 indispon\u00edvel agora. Preencha os dados manualmente.',
  chave_invalida: 'A consulta do CPF est\u00e1 indispon\u00edvel agora. Preencha os dados manualmente.',
  conta_bloqueada: 'A consulta do CPF est\u00e1 indispon\u00edvel agora. Preencha os dados manualmente.',
  nao_configurado: 'A consulta do CPF est\u00e1 indispon\u00edvel agora. Preencha os dados manualmente.',
};

export const mensagemDoMotivo = (motivo: string): string => MENSAGENS[motivo] ?? MENSAGENS.indisponivel;

export type Origem = 'interno' | 'publico';

/** Equipe do CRM = papel interno. Todo o resto, inclusive logado, e publico. */
export const origemDoPapel = (papel: string | null | undefined): Origem =>
  papel && PAPEIS_INTERNOS.includes(papel) ? 'interno' : 'publico';

/** Motivos que so a equipe precisa conhecer; para o publico viram "indisponivel". */
const MOTIVOS_INTERNOS = new Set(['sem_credito', 'chave_invalida', 'conta_bloqueada', 'nao_configurado']);

type Falha = { tipo: string };

/**
 * O que volta para o navegador.
 *
 * Quem NAO e da equipe recebe so o nome: a data de nascimento fica no servidor
 * (a trigger do banco a copia para o assinante quando ele e criado). CPF + nome
 * + nascimento e exatamente o conjunto usado em fraude de identidade, e a
 * adesao publica e aberta a qualquer um que digite qualquer CPF.
 */
export function respostaParaCliente(r: Resultado | Falha, origem: Origem, cache: boolean) {
  if (r.tipo === 'encontrado') {
    const achado = r as Extract<Resultado, { tipo: 'encontrado' }>;
    return origem === 'interno'
      ? { ok: true as const, encontrado: true as const, nome: achado.nome, nascimento: achado.nascimento, cache }
      : { ok: true as const, encontrado: true as const, nome: achado.nome, cache };
  }
  if (r.tipo === 'nao_encontrado') {
    return { ok: true as const, encontrado: false as const, mensagem: mensagemDoMotivo('nao_encontrado') };
  }
  const motivo = origem === 'publico' && MOTIVOS_INTERNOS.has(r.tipo) ? 'indisponivel' : r.tipo;
  return { ok: false as const, motivo, mensagem: mensagemDoMotivo(r.tipo), ...(('espera' in r) ? { espera: (r as { espera: number }).espera } : {}) };
}

export interface Limites {
  publicoAtivo: boolean;
  limiteIpHora: number;
  limitePublicoDia: number;
  validadeCacheDias: number;
}

/**
 * A tela de Integracoes grava as variaveis como TEXTO ("5", "false"), entao
 * numero e booleano precisam ser aceitos nas duas formas.
 */
const inteiro = (v: unknown, padrao: number, teto: number): number => {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? Math.min(n, teto) : padrao;
};

const VERDADEIRO = new Set(['true', '1', 'sim', 's', 'on', 'ligado', 'ativo']);

/**
 * Chave liga/desliga do publico. Ausente = ligado (padrao). Qualquer valor
 * presente que nao seja um "sim" claro DESLIGA: quem digitou algo ali queria
 * mexer na chave, e na duvida o lado seguro e nao gastar credito.
 */
const ligado = (v: unknown): boolean => {
  if (v === undefined || v === null) return true;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return VERDADEIRO.has(String(v).trim().toLowerCase());
};

/**
 * Ajustes do dono, lidos de integrations_config.variables. Valor ausente ou
 * invalido volta ao padrao CONSERVADOR -- nunca a "sem limite": um erro de
 * digitacao nao pode virar consulta paga liberada para a internet.
 */
export function lerLimites(variables: Record<string, unknown> | null | undefined): Limites {
  const v = variables ?? {};
  return {
    publicoAtivo: ligado(v.publico_ativo),
    limiteIpHora: inteiro(v.limite_ip_hora, 5, 100),
    limitePublicoDia: inteiro(v.limite_publico_dia, 150, 5000),
    validadeCacheDias: inteiro(v.validade_cache_dias, 180, 3650),
  };
}

/** IP do chamador, na ordem em que a borda do Supabase o informa. */
export function ipDoRequest(h: Headers): string {
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = h.get('x-forwarded-for');
  return xff ? xff.split(',')[0].trim() : '';
}

/**
 * SHA-256 do IP com um sal. O IP em claro e dado pessoal e nao e preciso: o
 * limite so precisa saber que duas consultas vieram do mesmo lugar. Sem IP,
 * devolve vazio e o chamador aplica o limite mais rigido.
 */
export async function hashearIp(ip: string, sal: string): Promise<string> {
  if (!ip) return '';
  const bytes = new TextEncoder().encode(`${sal}|${ip}`);
  const dig = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** O CPF vai no caminho da URL: so 11 digitos, nunca texto livre. */
export function urlDaConsulta(base: string, cpf: string): string {
  if (!/^\d{11}$/.test(cpf)) throw new Error('CPF deve ter 11 digitos para montar a URL.');
  return `${base.replace(/\/+$/, '')}/cpf/${cpf}`;
}
