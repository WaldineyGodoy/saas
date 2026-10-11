// Contrato do Repo contra o SupabaseRepo, num Supabase LOCAL (`supabase start`).
// Roda so com SUPABASE_URL apontando para localhost/127.0.0.1/[::1] E SUPABASE_SERVICE_ROLE_KEY definida;
// qualquer outro valor (producao inclusive) pula tudo. Exemplo:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<chave de `supabase status`> \
//     npx vitest run test/integration/supabase-repo.test.ts
import { describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepo } from '../../src/repo/supabase.js';
import type { Alerta, Carregador, IdTag, Mensagem, Recarga } from '../../src/repo/types.js';
import { contratoRepo, type Mundo } from './contrato-repo.js';

const url = process.env.SUPABASE_URL ?? '';
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);
const habilitado = local && chave !== '';
const motivo = !url ? 'SUPABASE_URL ausente'
  : !local ? 'SUPABASE_URL nao e local: recusado para nao tocar em producao'
    : !chave ? 'SUPABASE_SERVICE_ROLE_KEY ausente' : 'Supabase local';

function ok<T>(r: { data: T; error: { message: string } | null }, ctx: string): T {
  if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
  return r.data;
}

const aleatorio = () => Math.random().toString(36).slice(2, 10).toUpperCase();

async function criarMundo(): Promise<Mundo> {
  const sb: SupabaseClient = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  // A Edge Function refund-charging (Tarefa 9) nao existe no Supabase local: o substituto segue o contrato
  // documentado em src/repo/supabase.ts (corpo e idempotencia por recarga) e guarda o que recebeu.
  const pedidos = new Map<string, { valor: number; motivo: string }>();
  const repo = new SupabaseRepo(sb, {
    onErro: () => undefined,
    invocarFuncao: async (nome, body) => {
      if (nome !== 'refund-charging') throw new Error(`funcao inesperada: ${nome}`);
      const { recarga_id, valor_centavos, motivo: m } = body as { recarga_id: string; valor_centavos: number; motivo: string };
      if (!pedidos.has(`refund:${recarga_id}`)) pedidos.set(`refund:${recarga_id}`, { valor: valor_centavos / 100, motivo: m });
    },
  });

  const criados = {
    eletropostos: [] as string[], carregadores: [] as string[], recargas: [] as string[],
    idTags: [] as string[], ocppIds: [] as string[],
  };
  let eletropostoId: string | undefined;
  const eletroposto = async () => {
    if (!eletropostoId) {
      const r = ok(await sb.from('eletropostos').insert({ nome: `contrato-ocpp-${aleatorio()}` }).select('id').single(), 'eletroposto') as { id: string };
      eletropostoId = r.id;
      criados.eletropostos.push(eletropostoId);
    }
    return eletropostoId;
  };

  return {
    repo,
    agora: () => new Date(),
    async semearCarregador(p = {}) {
      const { ocppId, ...resto } = p;
      const ocpp_id = ocppId ?? `CT-${aleatorio()}`;
      const r = ok(await sb.from('eletroposto_carregadores')
        .insert({ eletroposto_id: await eletroposto(), ...resto, ocpp_id }).select('*').single(), 'semearCarregador') as Carregador;
      criados.carregadores.push(r.id);
      criados.ocppIds.push(ocpp_id);
      return r;
    },
    async semearIdTag(p) {
      const r = ok(await sb.from('ocpp_id_tags').insert(p).select('*').single(), 'semearIdTag') as IdTag;
      criados.idTags.push(r.id_tag);
      return r;
    },
    async semearRecarga(p = {}) {
      const r = ok(await sb.from('recargas_eletroposto').insert({
        eletroposto_id: await eletroposto(), conector_numero: 1, tipo_usuario: 'avulso', valor: 0, tarifa_kwh_aplicada: 0,
        ...p,
      }).select('id').single(), 'semearRecarga') as { id: string };
      criados.recargas.push(r.id);
      return repo.buscarRecarga(r.id) as Promise<Recarga>;
    },
    async mensagens(ocppId) {
      const r = ok(await sb.from('ocpp_mensagens').select('carregador_id,ocpp_id,direcao,tipo,unique_id,acao,payload')
        .eq('ocpp_id', ocppId).order('id'), 'mensagens');
      return r as Mensagem[];
    },
    async estornos(recargaId) {
      const e = pedidos.get(`refund:${recargaId}`);
      return e ? [e] : [];
    },
    async alertas(carregadorId) {
      const r = ok(await sb.from('notification_logs').select('entity_id,body,metadata').eq('entity_id', carregadorId), 'alertas') as
        { entity_id: string; body: string; metadata: { tipo: string; connector_id: number | null; dados?: Record<string, unknown> } }[];
      return r.map((x): Alerta => ({
        carregador_id: x.entity_id, connector_id: x.metadata.connector_id, tipo: x.metadata.tipo,
        mensagem: x.body, dados: x.metadata.dados,
      }));
    },
    async limpar() {
      await repo.fechar();
      // ordem por FK: transacoes (restrict) -> idTags/recargas -> carregadores (cascade) -> eletropostos
      if (criados.carregadores.length) {
        ok(await sb.from('notification_logs').delete().in('entity_id', criados.carregadores), 'limpar alertas');
        ok(await sb.from('ocpp_transacoes').delete().in('carregador_id', criados.carregadores), 'limpar transacoes');
      }
      // mensagens: as do contrato usam ocpp_id 'X-<aleatorio>' e carregador_id nulo em parte das linhas
      if (criados.ocppIds.length) ok(await sb.from('ocpp_mensagens').delete().in('ocpp_id', criados.ocppIds), 'limpar mensagens');
      ok(await sb.from('ocpp_mensagens').delete().like('ocpp_id', 'X-%'), 'limpar mensagens X');
      if (criados.idTags.length) ok(await sb.from('ocpp_id_tags').delete().in('id_tag', criados.idTags), 'limpar idTags');
      if (criados.recargas.length) ok(await sb.from('recargas_eletroposto').delete().in('id', criados.recargas), 'limpar recargas');
      if (criados.carregadores.length) ok(await sb.from('eletroposto_carregadores').delete().in('id', criados.carregadores), 'limpar carregadores');
      if (criados.eletropostos.length) ok(await sb.from('eletropostos').delete().in('id', criados.eletropostos), 'limpar eletropostos');
    },
  };
}

describe.skipIf(!habilitado)(`contrato Repo: SupabaseRepo (${motivo})`, () => {
  contratoRepo(criarMundo);

  describe('SupabaseRepo: Edge Function de estorno', () => {
    it('envia o corpo do contrato; falha da funcao lanca (quem chama tenta de novo)', async () => {
      const sb = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
      const chamadas: unknown[] = [];
      let falhar = true;
      const repo = new SupabaseRepo(sb, {
        invocarFuncao: async (nome, body) => { chamadas.push({ nome, body }); if (falhar) throw new Error('503'); },
      });
      const m = await criarMundo();
      try {
        const r = await m.semearRecarga({ status: 'failed', valor: 12.34 });
        await expect(repo.solicitarEstorno(r.id, { valor: 12.34, motivo: 'm' })).rejects.toThrow('503');
        falhar = false;
        await repo.solicitarEstorno(r.id, { valor: 12.34, motivo: 'm' });
        expect(chamadas.at(-1)).toEqual({ nome: 'refund-charging', body: { recarga_id: r.id, valor_centavos: 1234, motivo: 'm' } });
      } finally { await m.limpar(); }
    });
  });
});
