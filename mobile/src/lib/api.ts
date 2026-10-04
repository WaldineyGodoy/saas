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
