import { colors } from '../theme/tokens';

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info';

export const toneColor: Record<Tone, string> = {
  ok: colors.statusVerified,
  warn: colors.secondary,
  bad: colors.statusProvisional,
  neutral: colors.inkSecondary,
  info: colors.statusCalculated,
};

const UC: Record<string, [string, Tone]> = {
  ativo: ['Ativa', 'ok'],
  vinculado: ['Vinculada', 'ok'],
  ativacao: ['Em ativação', 'info'],
  em_ativacao: ['Em ativação', 'info'],
  aguardando_conexao: ['Aguardando conexão', 'info'],
  em_transf_titularidade: ['Troca de titular', 'info'],
  em_atraso: ['Em atraso', 'bad'],
  sem_geracao: ['Sem geração', 'warn'],
  desconectado: ['Desconectada', 'warn'],
  cancelado: ['Cancelada', 'neutral'],
  cancelado_inadimplente: ['Cancelada', 'neutral'],
};

const USINA: Record<string, [string, Tone]> = {
  gerando: ['Gerando', 'ok'],
  pre_operacao: ['Pré-operação', 'info'],
  em_conexao: ['Em conexão', 'info'],
  manutencao: ['Manutenção', 'warn'],
  inativa: ['Inativa', 'neutral'],
  cancelada: ['Cancelada', 'neutral'],
};

const FATURA: Record<string, [string, Tone]> = {
  pago: ['Paga', 'ok'],
  confirmado: ['Paga', 'ok'],
  a_vencer: ['A vencer', 'info'],
  ag_emissao_boleto: ['Em emissão', 'info'],
  atrasado: ['Atrasada', 'bad'],
  sem_faturamento: ['Sem cobrança', 'neutral'],
  erro: ['Em análise', 'warn'],
};

/** Status do assinante indicado, agrupado nas abas da tela Home Connect. */
export type GrupoRede = 'ativo' | 'cadastrado' | 'atrasado' | 'cancelado';
export const grupoRede = (status: string, faturaStatus?: string | null): GrupoRede => {
  if (status === 'cancelado' || status === 'cancelado_inadimplente' || status === 'transferido') return 'cancelado';
  if (status === 'ativo_inadimplente' || faturaStatus === 'atrasado') return 'atrasado';
  if (status === 'ativo') return 'ativo';
  return 'cadastrado';
};

const ELETROPOSTO: Record<string, [string, Tone]> = {
  operando: ['Operando', 'ok'],
  pre_operacao: ['Pré-operação', 'info'],
  em_instalacao: ['Em instalação', 'info'],
  manutencao: ['Manutenção', 'warn'],
  inativo: ['Inativo', 'neutral'],
  cancelado: ['Cancelado', 'neutral'],
};

const pick = (map: Record<string, [string, Tone]>, s?: string | null): [string, Tone] =>
  (s && map[s]) || [s ? s.replace(/_/g, ' ') : '—', 'neutral'];

export const ucStatus = (s?: string | null) => pick(UC, s);
export const usinaStatus = (s?: string | null) => pick(USINA, s);
export const faturaStatus = (s?: string | null) => pick(FATURA, s);
export const eletropostoStatus = (s?: string | null) => pick(ELETROPOSTO, s);
