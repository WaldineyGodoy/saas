import { useQuery } from '@tanstack/react-query';
import { DEMO, demoRpc } from './demo';
import { supabase } from './supabase';
import type {
  EletropostoPublico, Indicado, MeuEletroposto, Perfil, Recarga,
  UcDetalhe, UcResumo, UsinaDetalhe, UsinaResumo,
} from './types';

// Toda leitura passa pelas funcoes `app_*` (migration 20261004a_app_mobile_rpcs),
// que filtram por auth.uid(). Nao consultar tabelas direto daqui: as policies
// delas liberam a base inteira para qualquer usuario logado.
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (DEMO) return demoRpc(fn, args) as T;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const usePerfil = (enabled = true) =>
  useQuery({ queryKey: ['perfil'], queryFn: () => rpc<Perfil | null>('app_perfil'), enabled });

export const useMinhasUcs = (enabled = true) =>
  useQuery({ queryKey: ['ucs'], queryFn: () => rpc<UcResumo[]>('app_minhas_ucs'), enabled });

export const useUcDetalhe = (id?: string) =>
  useQuery({
    queryKey: ['uc', id],
    queryFn: () => rpc<UcDetalhe | null>('app_uc_detalhe', { p_uc: id }),
    enabled: Boolean(id),
  });

export const useMinhasUsinas = (enabled = true) =>
  useQuery({ queryKey: ['usinas'], queryFn: () => rpc<UsinaResumo[]>('app_minhas_usinas'), enabled });

export const useUsinaDetalhe = (id?: string) =>
  useQuery({
    queryKey: ['usina', id],
    queryFn: () => rpc<UsinaDetalhe | null>('app_usina_detalhe', { p_usina: id }),
    enabled: Boolean(id),
  });

export const useMinhaRede = (enabled = true) =>
  useQuery({ queryKey: ['rede'], queryFn: () => rpc<Indicado[]>('app_minha_rede'), enabled });

export const useMeusEletropostos = (enabled = true) =>
  useQuery({ queryKey: ['meus-eletropostos'], queryFn: () => rpc<MeuEletroposto[]>('app_meus_eletropostos'), enabled });

export const useEletropostosPublicos = () =>
  useQuery({ queryKey: ['eletropostos'], queryFn: () => rpc<EletropostoPublico[]>('app_eletropostos_publicos') });

export const useMinhasRecargas = () =>
  useQuery({ queryKey: ['recargas'], queryFn: () => rpc<Recarga[]>('app_minhas_recargas') });

// ---------------------------------------------------------------------------
// Nova UC pela conta de energia
// ---------------------------------------------------------------------------

const CONTA_DEMO: Record<string, unknown> = {
  numeroUc: '7000000001', codigoCliente: '7000000001', titular: 'CLIENTE DEMONSTRACAO', documentoTipo: 'CPF',
  documento: '123.4**.***-**', classificacao: 'B1 RESIDENCIAL', tipoFornecimento: 'Conv. Monômia - Monofásico',
  ligacao: 'monofasico', mediaKwh: 275, mesReferencia: '05/2026', consumoKwh: 166, valorTotal: 403.09,
  endereco: { logradouro: 'RUA DAS FLORES 100', bairro: 'CENTRO', cep: '59678-000', cidade: 'TIBAU', uf: 'RN', completo: 'RUA DAS FLORES 100, CENTRO, 59678-000 TIBAU RN' },
};

/** Le a conta (foto JPEG ou PDF, em base64) na Edge Function. Devolve a leitura
 *  ja com os campos derivados (numeroUc, ligacao, mediaKwh). */
export async function lerConta(base64: string, mediaType: 'image/jpeg' | 'application/pdf'): Promise<Record<string, unknown>> {
  if (DEMO) return CONTA_DEMO;
  const { data, error } = await supabase.functions.invoke('parse-invoice-image', {
    body: { imageBase64: base64, mediaType },
  });
  // functions.invoke devolve o erro em `error`; a mensagem util vem no corpo.
  if (error || !data?.ok) {
    let msg: string | undefined = data?.error;
    const ctx = (error as { context?: Response } | null)?.context;
    if (!msg && ctx?.json) {
      try { msg = (await ctx.json())?.error; } catch { /* corpo nao-JSON */ }
    }
    throw new Error(msg || 'Não foi possível ler a conta. Tente de novo.');
  }
  return data.dados as Record<string, unknown>;
}

/** Pedido de nova UC: vira um lead para a equipe. Nao cria UC. */
export const solicitarNovaUc = (conta: unknown) =>
  rpc<{ lead_id: string; ja_existia: boolean }>('app_solicitar_nova_uc', { p_conta: conta });
