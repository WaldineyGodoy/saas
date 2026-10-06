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

export type PlanoUc = { id: string; nome: string; desconto_assinante: number | null };

/** Planos ativos que valem para a distribuidora da UC (planos_distribuidoras). */
export const usePlanosParaUc = (concessionaria?: string) =>
  useQuery({
    queryKey: ['planos-uc', concessionaria],
    queryFn: () => rpc<PlanoUc[]>('app_planos_para_uc', { p_concessionaria: concessionaria }),
    enabled: Boolean(concessionaria),
  });

export type PedidoUc = {
  lead_id: string; numero_uc: string; plano: string | null; criado_em: string;
  situacao: 'em_preparo' | 'aguardando_assinatura' | 'assinado' | 'uc_criada' | 'encerrado';
  link_assinatura: string | null;
};

export const useMeusPedidosUc = (enabled = true) =>
  useQuery({ queryKey: ['pedidos-uc'], queryFn: () => rpc<PedidoUc[]>('app_meus_pedidos_uc'), enabled });

/** Gera o termo aditivo da UC nova com o plano escolhido e devolve o link de
 *  assinatura (Edge Function aditivo-nova-uc). A UC so nasce depois de assinado. */
export async function gerarTermoAditivo(conta: unknown, planoId: string): Promise<{ lead_id: string; link: string }> {
  if (DEMO) return { lead_id: 'demo', link: 'https://www.autentique.com.br/' };
  const { data, error } = await supabase.functions.invoke('aditivo-nova-uc', { body: { conta, plano_id: planoId } });
  if (error || !data?.ok) {
    let msg: string | undefined = data?.error;
    const ctx = (error as { context?: Response } | null)?.context;
    if (!msg && ctx?.json) {
      try { msg = (await ctx.json())?.error; } catch { /* corpo nao-JSON */ }
    }
    throw new Error(msg || 'Não foi possível gerar o termo. Tente de novo.');
  }
  return { lead_id: data.lead_id, link: data.link };
}

// ---------------------------------------------------------------------------
// Indicação e cadastro pelo app (migração 20261006d)
// ---------------------------------------------------------------------------

export type IndicadorPublico = { valido: boolean; id?: string; primeiro_nome?: string; motivo?: string };

/** Confere o código do link/QR e devolve só o primeiro nome de quem indicou. */
export const confirmarIndicador = (id: string) =>
  rpc<IndicadorPublico>('fn_indicador_publico', { p_id: id });

/** Link curto do QR (encurtador): o destino só aparece seguindo o redirecionamento. */
export async function resolverLinkCurto(url: string): Promise<string> {
  if (DEMO) return '3f2b9c1e-8a4d-4e2f-9b1a-0c5d6e7f8a9b';
  const { data, error } = await supabase.functions.invoke('resolver-link-indicacao', { body: { url } });
  if (error || !data?.id) {
    let msg: string | undefined = data?.error;
    const ctx = (error as { context?: Response } | null)?.context;
    if (!msg && ctx?.json) {
      try { msg = (await ctx.json())?.error; } catch { /* corpo nao-JSON */ }
    }
    throw new Error(msg || 'Não foi possível abrir este link. Tente o QR Code.');
  }
  return data.id as string;
}

/** Registra o interesse (lead ligado ao login) e devolve o id da visita, que
 *  segue para a adesão: é ele que decide a indicação no contrato. */
export const registrarInteresse = (dados: { name: string; phone: string }, indicador: string | null, meio: 'qr' | 'app' | 'link') =>
  rpc<string>('app_registrar_interesse', { p_dados: dados, p_indicador: indicador, p_meio: meio === 'qr' ? 'qr' : 'app' });
