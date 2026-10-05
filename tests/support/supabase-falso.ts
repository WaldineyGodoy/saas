// Usado pelos testes das Edge Functions (sem Deno nem banco).
// Cliente Supabase falso: registra cada consulta (tabela, operacao, filtros, payload) e responde
// pelo `responder` do teste. Cobre a API encadeada que o webhook usa.
export type Consulta = {
  tabela?: string; rpc?: string; args?: unknown; op: string; payload?: unknown;
  filtros: [string, string, unknown][]; unico?: 'single' | 'maybeSingle';
};

export function falso(responder: (q: Consulta) => { data?: unknown; error?: unknown }) {
  const consultas: Consulta[] = [];
  const builder = (q: Consulta) => {
    const b: any = {
      select: () => { if (q.op === 'none') q.op = 'select'; return b; },
      insert: (p: unknown) => { q.op = 'insert'; q.payload = p; return b; },
      update: (p: unknown) => { q.op = 'update'; q.payload = p; return b; },
      upsert: (p: unknown) => { q.op = 'upsert'; q.payload = p; return b; },
      eq: (c: string, v: unknown) => { q.filtros.push(['eq', c, v]); return b; },
      in: (c: string, v: unknown) => { q.filtros.push(['in', c, v]); return b; },
      limit: () => b,
      single: () => { q.unico = 'single'; return b; },
      maybeSingle: () => { q.unico = 'maybeSingle'; return b; },
      then: (ok: any, err: any) => {
        consultas.push(q);
        const r = responder(q);
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(ok, err);
      },
    };
    return b;
  };
  const cliente = {
    from: (tabela: string) => builder({ tabela, op: 'none', filtros: [] }),
    rpc: (rpc: string, args: unknown) => builder({ rpc, args, op: 'rpc', filtros: [] }),
  };
  return { cliente, consultas };
}

