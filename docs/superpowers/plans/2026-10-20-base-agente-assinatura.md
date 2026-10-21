# Base do Agente Assinatura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Agente Assinatura do Deskcomm uma base de conhecimento (FAQ + documento gerado do CRM) e a ferramenta `b2w_simular_assinatura` (economia em R$, vaga, link de adesão), e publicar o roteiro novo.

**Architecture:** Igual à base do Investidor: o prompt diz como agir, a base guarda os fatos (a trava de promessas do Deskcomm só aceita prova vinda da base), e a conta e a vaga saem de uma RPC chamada pelo servidor MCP `b2w-mcp`. A função `deskcomm-base` passa a sincronizar fontes de mais de um agente.

**Tech Stack:** Postgres/Supabase (migration, RPC security definer, gatilhos, pg_cron), Edge Functions Deno (`b2w-mcp`, `deskcomm-base`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md`

## Global Constraints

- Trabalhar no worktree `C:\Users\Godoy\Documents\HTML\wt-assinatura`, branch `feat/base-agente-assinatura`.
- Projeto Supabase `abbysvxnnhwvvzhftoms` (mesmo banco do CRM e do Deskcomm). **Aplicar migration, publicar função e rodar script em produção só com aprovação explícita do usuário.**
- Conta da economia idêntica ao site: `economia_mensal = round(consumo × tarifa × desconto/100, 2)`, `economia_anual = round(consumo × tarifa × desconto/100 × 12, 2)`. Cosern 300 kWh → 46,56 e 558,74.
- Desconto = `fn_desconto_plano_vigente(concessionaria)`; tarifa = `"Concessionaria"."Tarifa Concessionaria"`.
- Consumo mínimo 150 kWh/mês. Vencimento dia 5. Fio B incluído no desconto; bandeira não cobrada.
- UC ocupa vaga se `status` NÃO estiver em (`cancelado`, `cancelado_inadimplente`, `desconectado`, `desligado_por_tt`).
- Telefone só pelo cabeçalho `X-Deskcomm-Contato-Telefone`; a ferramenta nunca devolve nome de usina nem dado pessoal.
- Gatilhos nunca bloqueiam gravação: `exception when others` → `ponte_deskcomm.erros`.
- Horários para o usuário em Brasília (UTC-3).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261021a_base_agente_assinatura.sql` (novo) | RPCs `b2w_mcp_simular_assinatura` e `ponte_deskcomm_assinatura_cobertura`; gatilhos de planos/tarifa → `deskcomm-base`. |
| `supabase/tests/assinatura_simular.test.sql` (novo) | Teste em transação desfeita das duas RPCs e do crédito de indicação × split. |
| `supabase/functions/b2w-mcp/logica.ts` | Ferramenta `b2w_simular_assinatura` (esquema, validação, chamada). |
| `supabase/functions/b2w-mcp/index.ts` | Dependência `simular` → RPC. |
| `tests/b2w-mcp.test.ts` | Testes da ferramenta nova. |
| `supabase/functions/deskcomm-base/bases/assinatura-faq.ts` (novo) | FAQ fixo (18 pares). |
| `supabase/functions/deskcomm-base/montar.ts` | `montarCoberturaAssinatura`. |
| `supabase/functions/deskcomm-base/index.ts` | Conteúdos com categoria própria (Investidor e Assinatura). |
| `tests/deskcomm-base.test.ts` | Testes do montador e do FAQ novos. |
| `scripts/deskcomm/base_assinatura.sql` (novo) | Nova versão publicada do Agente Assinatura. |
| `playbook/DESKCOMM.md` | §7 (arquivos) e §8.3. |

---

### Task 1: Migration — simulação, cobertura e gatilhos

**Files:**
- Create: `supabase/migrations/20261021a_base_agente_assinatura.sql`
- Create: `supabase/tests/assinatura_simular.test.sql`

**Interfaces:**
- Produces:
  - `public.b2w_mcp_simular_assinatura(p_cidade text, p_uf text, p_consumo_kwh numeric, p_valor_reais numeric, p_telefone text) returns jsonb` — `p_cidade` já normalizada (minúsculas, sem acento), `p_uf` sigla. Chaves: `atende, concessionaria, desconto_pct, tarifa, consumo_kwh, consumo_convertido, economia_mensal, economia_anual, atinge_minimo, vaga ('imediata'|'pre_operacao'|'fila'|null), previsao_operacao (date|null), link_adesao`.
  - `public.ponte_deskcomm_assinatura_cobertura() returns table(concessionaria text, ufs text, desconto_pct numeric, tarifa numeric, credito_indicacao_100kwh numeric)`.
  - Ambas só `service_role`.

- [ ] **Step 1: Escrever o teste SQL (falha: funções não existem)**

`supabase/tests/assinatura_simular.test.sql`:

```sql
-- Sandbox: simulação da Energia por Assinatura e Fonte B
-- (spec 2026-10-20-base-agente-assinatura-design.md §4.2, §5, §8.2).
-- Rodar depois da migration 20261021a; tudo é desfeito no RAISE final.
DO $t$
DECLARE
  r jsonb; v_cob record; v_split jsonb; v_regras jsonb; v_base numeric;
  v_usina uuid; v_lead uuid; v_ind uuid;
BEGIN
  -- Isola o teste: tira as usinas reais da Cosern da conta de vagas.
  UPDATE usinas SET concessionaria = concessionaria || ' (teste)' WHERE concessionaria = 'Neoenergia Cosern';

  -- 1. Sem usina nenhuma: fila.
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 300, null, null);
  IF (r->>'economia_mensal')::numeric <> 46.56 OR (r->>'economia_anual')::numeric <> 558.74 THEN
    RAISE EXCEPTION 'FALHOU economia: %', r; END IF;
  IF (r->>'desconto_pct')::numeric <> 15 OR r->>'vaga' <> 'fila' OR (r->>'atinge_minimo')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU fila: %', r; END IF;
  IF r->>'link_adesao' <> 'https://b2wenergia.com.br/' THEN RAISE EXCEPTION 'FALHOU link: %', r; END IF;

  -- 2. Usina em pré-operação com espaço.
  INSERT INTO usinas (name, status, concessionaria, geracao_estimada_kwh, previsao_entrega)
  VALUES ('UFV Teste Pré', 'pre_operacao', 'Neoenergia Cosern', 5000, '2026-12-01') RETURNING id INTO v_usina;
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 300, null, null);
  IF r->>'vaga' <> 'pre_operacao' OR r->>'previsao_operacao' <> '2026-12-01' THEN RAISE EXCEPTION 'FALHOU pre: %', r; END IF;

  -- 3. Usina gerando com espaço vence a pré-operação.
  INSERT INTO usinas (name, status, concessionaria, geracao_estimada_kwh)
  VALUES ('UFV Teste Gerando', 'gerando', 'Neoenergia Cosern', 1000);
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 300, null, null);
  IF r->>'vaga' <> 'imediata' THEN RAISE EXCEPTION 'FALHOU imediata: %', r; END IF;
  -- ...mas não comporta 1.200 kWh: cai na pré-operação.
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 1200, null, null);
  IF r->>'vaga' <> 'pre_operacao' THEN RAISE EXCEPTION 'FALHOU capacidade: %', r; END IF;

  -- 4. Valor em reais vira kWh pela tarifa; abaixo de 150 kWh.
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', null, 103.47, null);
  IF (r->>'consumo_kwh')::numeric <> 100 OR (r->>'consumo_convertido')::boolean IS NOT TRUE
     OR (r->>'atinge_minimo')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FALHOU reais: %', r; END IF;

  -- 5. Cidade fora da tabela e distribuidora sem plano.
  r := public.b2w_mcp_simular_assinatura('cidade que nao existe', 'RN', 300, null, null);
  IF (r->>'atende')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FALHOU fora: %', r; END IF;
  r := public.b2w_mcp_simular_assinatura('belo horizonte', 'MG', 300, null, null);
  IF (r->>'atende')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FALHOU sem plano: %', r; END IF;

  -- 6. Link com indicador do lead achado pelo telefone.
  SELECT id INTO v_ind FROM subscribers ORDER BY created_at LIMIT 1;
  INSERT INTO leads (name, phone, indicador_assinante_id) VALUES ('Lead Teste', '84 99999-0001', v_ind) RETURNING id INTO v_lead;
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 300, null, '5584999990001');
  IF r->>'link_adesao' <> 'https://b2wenergia.com.br/?indicador=' || v_ind THEN RAISE EXCEPTION 'FALHOU indicador: %', r; END IF;

  -- 7. Fonte B: Cosern com 15%, tarifa e crédito de indicação igual ao split.
  SELECT * INTO v_cob FROM public.ponte_deskcomm_assinatura_cobertura() WHERE concessionaria = 'Neoenergia Cosern';
  IF v_cob.desconto_pct <> 15 OR v_cob.tarifa <> 1.0347 OR v_cob.ufs <> 'RN' THEN RAISE EXCEPTION 'FALHOU cobertura: %', row_to_json(v_cob); END IF;
  SELECT p.recorrente_config->'regras_multinivel', (p.recorrente_config->'lastro_tarifario'->>'base_calculo_liquida')::numeric
    INTO v_regras, v_base
    FROM planos_assinatura_energia p JOIN planos_distribuidoras d ON d.plano_id = p.id
   WHERE p.ativo AND p.status = 'ativo' AND d.concessionaria = 'Neoenergia Cosern';
  v_split := public.fn_calcular_split_recompensa(v_base * 100, 999999, v_regras,
             '[{"papel":"assinante_conect","id":"00000000-0000-0000-0000-000000000001","nivel":1}]'::jsonb);
  IF (v_split->'beneficiarios'->0->>'valor')::numeric <> v_cob.credito_indicacao_100kwh THEN
    RAISE EXCEPTION 'FALHOU indicacao: split % x fonte %', v_split->'beneficiarios'->0->>'valor', v_cob.credito_indicacao_100kwh; END IF;

  IF (SELECT count(*) FROM ponte_deskcomm.fontes_base WHERE chave IN ('assinatura_faq', 'assinatura_cobertura')) <> 2 THEN
    RAISE EXCEPTION 'FALHOU chaves de fontes_base'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK credito_100kwh=% simulacao=%', v_cob.credito_indicacao_100kwh, r;
END
$t$;
```

- [ ] **Step 2: Rodar e ver falhar**

Rodar o arquivo pelo `execute_sql` do MCP do Supabase (projeto `abbysvxnnhwvvzhftoms`). Esperado: erro `function public.b2w_mcp_simular_assinatura(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261021a_base_agente_assinatura.sql`:

```sql
-- =====================================================================
-- Base do Agente Assinatura (spec docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md)
--   1. b2w_mcp_simular_assinatura: a conta do simulador do site + vaga + link.
--   2. ponte_deskcomm_assinatura_cobertura: dados da Fonte B.
--   3. Chaves assinatura_faq e assinatura_cobertura em ponte_deskcomm.fontes_base.
--   4. Gatilhos: plano, ligação plano-distribuidora ou tarifa mudou ->
--      deskcomm-base regenera a Fonte B (o cron de hora em hora é a rede).
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. Simulação
-- ---------------------------------------------------------------------------
create or replace function public.b2w_mcp_simular_assinatura(
    p_cidade text, p_uf text, p_consumo_kwh numeric, p_valor_reais numeric, p_telefone text)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_conc     text;
    v_tarifa   numeric;
    v_desc     numeric;
    v_kwh      numeric;
    v_conv     boolean := false;
    v_vaga     text;
    v_prev     date;
    v_tel      text := ponte_deskcomm.fn_telefone(p_telefone);
    v_lead     record;
    v_link     text := 'https://b2wenergia.com.br/';
begin
    select btrim(c."Concessionaria"), c."Tarifa Concessionaria"
      into v_conc, v_tarifa
      from "Concessionaria" c
     where ponte_deskcomm.fn_sem_acento(c."Município") = ponte_deskcomm.fn_sem_acento(p_cidade)
       and upper(btrim(c."UF")) = ponte_deskcomm.fn_uf(p_uf)
     limit 1;

    if v_conc is null or not exists (select 1 from planos_distribuidoras pd where pd.concessionaria = v_conc) then
        return jsonb_build_object('atende', false, 'concessionaria', v_conc, 'desconto_pct', null,
                                  'link_adesao', v_link);
    end if;

    v_desc := public.fn_desconto_plano_vigente(v_conc);

    if p_consumo_kwh is not null and p_consumo_kwh > 0 then
        v_kwh := p_consumo_kwh;
    elsif p_valor_reais is not null and p_valor_reais > 0 and v_tarifa > 0 then
        v_kwh := round(p_valor_reais / v_tarifa);
        v_conv := true;
    end if;

    -- Vaga: livre = geração estimada - franquias das UCs que ocupam a usina.
    if v_kwh is not null then
        with livre as (
            select u.status::text as status, u.previsao_entrega,
                   u.geracao_estimada_kwh - coalesce((
                       select sum(cu.franquia) from consumer_units cu
                        where cu.usina_id = u.id
                          and cu.status::text not in ('cancelado', 'cancelado_inadimplente', 'desconectado', 'desligado_por_tt')
                   ), 0) as kwh
              from usinas u
             where u.concessionaria = v_conc and u.geracao_estimada_kwh is not null
        )
        select case
                 when exists (select 1 from livre where status = 'gerando' and kwh >= v_kwh) then 'imediata'
                 when exists (select 1 from livre where status in ('pre_operacao', 'em_conexao') and kwh >= v_kwh) then 'pre_operacao'
                 else 'fila' end,
               (select min(previsao_entrega) from livre
                 where status in ('pre_operacao', 'em_conexao') and kwh >= v_kwh)
          into v_vaga, v_prev;
        if v_vaga <> 'pre_operacao' then v_prev := null; end if;
    end if;

    -- Link de adesão com a indicação do lead deste telefone.
    if v_tel is not null then
        select l.indicador_assinante_id, l.originator_id into v_lead
          from leads l
         where ponte_deskcomm.fn_telefone(l.phone) = v_tel and l.arquivado_em is null
         order by l.updated_at desc nulls last limit 1;
        if v_lead.indicador_assinante_id is not null then
            v_link := v_link || '?indicador=' || v_lead.indicador_assinante_id;
        elsif v_lead.originator_id is not null then
            v_link := v_link || '?id=' || v_lead.originator_id;
        end if;
    end if;

    return jsonb_build_object(
        'atende', true,
        'concessionaria', v_conc,
        'desconto_pct', v_desc,
        'tarifa', v_tarifa,
        'consumo_kwh', v_kwh,
        'consumo_convertido', v_conv,
        'economia_mensal', case when v_kwh is not null and v_desc is not null
                                then round(v_kwh * v_tarifa * v_desc / 100, 2) end,
        'economia_anual', case when v_kwh is not null and v_desc is not null
                               then round(v_kwh * v_tarifa * v_desc / 100 * 12, 2) end,
        'atinge_minimo', case when v_kwh is not null then v_kwh >= 150 end,
        'vaga', v_vaga,
        'previsao_operacao', v_prev,
        'link_adesao', v_link);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Fonte B
-- ---------------------------------------------------------------------------
create or replace function public.ponte_deskcomm_assinatura_cobertura()
returns table(concessionaria text, ufs text, desconto_pct numeric, tarifa numeric, credito_indicacao_100kwh numeric)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select d.concessionaria,
           (select string_agg(distinct upper(btrim(c."UF")), ', ' order by upper(btrim(c."UF")))
              from "Concessionaria" c where btrim(c."Concessionaria") = d.concessionaria),
           public.fn_desconto_plano_vigente(d.concessionaria),
           (select max(c."Tarifa Concessionaria") from "Concessionaria" c
             where btrim(c."Concessionaria") = d.concessionaria),
           round((p.recorrente_config->'lastro_tarifario'->>'base_calculo_liquida')::numeric * 100
                 * coalesce((p.recorrente_config->'regras_multinivel'->'assinante_conect'->'niveis'->>'L1')::numeric, 0)
                 / 100, 2)
      from planos_distribuidoras d
      join planos_assinatura_energia p on p.id = d.plano_id and p.ativo and p.status = 'ativo'
     where public.fn_desconto_plano_vigente(d.concessionaria) is not null
     order by d.concessionaria
$$;

revoke all on function public.b2w_mcp_simular_assinatura(text, text, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_assinatura_cobertura() from public, anon, authenticated;
grant execute on function public.b2w_mcp_simular_assinatura(text, text, numeric, numeric, text) to service_role;
grant execute on function public.ponte_deskcomm_assinatura_cobertura() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Chaves da base: ponte_deskcomm_fonte_base_marcar só faz UPDATE.
-- ---------------------------------------------------------------------------
insert into ponte_deskcomm.fontes_base (chave) values ('assinatura_faq'), ('assinatura_cobertura')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Gatilhos (por instrução: a tabela de tarifas tem milhares de linhas)
-- ---------------------------------------------------------------------------
create or replace function ponte_deskcomm.fn_assinatura_para_base()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    perform ponte_deskcomm.fn_chamar_funcao('deskcomm-base', '{}'::jsonb);
    return null;
exception when others then
    -- Falha aqui nunca bloqueia a gravação; o cron corrige.
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('fn_assinatura_para_base', null, sqlstate, sqlerrm);
    return null;
end
$$;

drop trigger if exists trg_ponte_planos_assinatura_base on public.planos_assinatura_energia;
create trigger trg_ponte_planos_assinatura_base
    after insert or delete or update of desconto_assinante, ativo, status, recorrente_config
    on public.planos_assinatura_energia
    for each statement execute function ponte_deskcomm.fn_assinatura_para_base();

drop trigger if exists trg_ponte_planos_distribuidoras_base on public.planos_distribuidoras;
create trigger trg_ponte_planos_distribuidoras_base
    after insert or delete or update on public.planos_distribuidoras
    for each statement execute function ponte_deskcomm.fn_assinatura_para_base();

drop trigger if exists trg_ponte_tarifa_base on public."Concessionaria";
create trigger trg_ponte_tarifa_base
    after update of "Tarifa Concessionaria", "Concessionaria", "UF" on public."Concessionaria"
    for each statement execute function ponte_deskcomm.fn_assinatura_para_base();
```

(`ponte_deskcomm.erros.ref_id` aceita `null`: conferido em 20/10/2026.)

- [ ] **Step 4: Aplicar (com aprovação do usuário) e rodar o teste**

Pedir aprovação ao usuário. Aplicar com `apply_migration` (nome `20261021a_base_agente_assinatura`) e rodar `supabase/tests/assinatura_simular.test.sql` com `execute_sql`.
Esperado: `ERROR: SANDBOX_OK credito_100kwh=1.33 simulacao={...}`. Qualquer `FALHOU` → corrigir a migration (`create or replace`) e repetir.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261021a_base_agente_assinatura.sql supabase/tests/assinatura_simular.test.sql
git commit -m "feat(deskcomm): RPCs da simulação e da cobertura da Energia por Assinatura"
```

---

### Task 2: Ferramenta `b2w_simular_assinatura` no servidor MCP

**Files:**
- Modify: `supabase/functions/b2w-mcp/logica.ts`
- Modify: `supabase/functions/b2w-mcp/index.ts`
- Test: `tests/b2w-mcp.test.ts`

**Interfaces:**
- Consumes: RPC `b2w_mcp_simular_assinatura(p_cidade, p_uf, p_consumo_kwh, p_valor_reais, p_telefone)` (Task 1).
- Produces: `Dependencias.simular(cidade: string, uf: string, consumoKwh: number | null, valorReais: number | null, telefone: string | null): Promise<Simulacao>`; ferramenta `b2w_simular_assinatura` em `FERRAMENTAS` (terceira posição).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/b2w-mcp.test.ts`, no `deps()` acrescentar o fake de `simular`:

```ts
    simular: vi.fn(async () => ({
        atende: true, concessionaria: 'Neoenergia Cosern', desconto_pct: 15, tarifa: 1.0347,
        consumo_kwh: 300, consumo_convertido: false, economia_mensal: 46.56, economia_anual: 558.74,
        atinge_minimo: true, vaga: 'imediata' as const, previsao_operacao: null,
        link_adesao: 'https://b2wenergia.com.br/',
    })),
```

Trocar a expectativa de `tools/list` para:

```ts
        expect(r.result.tools.map((t: any) => t.name)).toEqual(['b2w_concessionaria', 'b2w_identificar_contato', 'b2w_simular_assinatura'])
```

E acrescentar o bloco:

```ts
describe('b2w_simular_assinatura', () => {
    it('normaliza cidade e UF e passa o telefone do cabeçalho, nunca de argumento', async () => {
        const d = deps()
        const r: any = await chamar('b2w_simular_assinatura',
            { cidade: 'Natal', uf: 'rn', consumo_kwh: 300, telefone: '5511000000000' }, d, '(84) 99999-0001')
        expect(d.simular).toHaveBeenCalledWith('natal', 'RN', 300, null, '5584999990001')
        expect(r.result.structuredContent.economia_mensal).toBe(46.56)
    })
    it('aceita valor da conta em reais', async () => {
        const d = deps()
        await chamar('b2w_simular_assinatura', { cidade: 'Natal', uf: 'RN', valor_conta_reais: 'R$ 310,41' }, d)
        expect(d.simular).toHaveBeenCalledWith('natal', 'RN', null, 310.41, null)
    })
    it('sem consumo nem valor vira erro de ferramenta, sem consultar', async () => {
        const d = deps()
        const r: any = await chamar('b2w_simular_assinatura', { cidade: 'Natal', uf: 'RN' }, d)
        expect(r.result.isError).toBe(true)
        expect(d.simular).not.toHaveBeenCalled()
    })
    it('falha do banco vira erro de ferramenta', async () => {
        const d = deps({ simular: vi.fn(async () => { throw new Error('db') }) })
        const r: any = await chamar('b2w_simular_assinatura', { cidade: 'Natal', uf: 'RN', consumo_kwh: 300 }, d)
        expect(r.result.isError).toBe(true)
    })
})

describe('lerNumero', () => {
    it('lê número, texto com vírgula e com milhar', () => {
        expect(lerNumero(300)).toBe(300)
        expect(lerNumero('300 kWh')).toBe(300)
        expect(lerNumero('R$ 1.250,90')).toBe(1250.9)
        expect(lerNumero('0')).toBeNull()
        expect(lerNumero('abc')).toBeNull()
        expect(lerNumero(undefined)).toBeNull()
    })
})
```

E incluir `lerNumero` no import de `../supabase/functions/b2w-mcp/logica`.

- [ ] **Step 2: Rodar e ver falhar**

Run (PowerShell, no worktree): `npx vitest run tests/b2w-mcp.test.ts`
Esperado: FAIL — `lerNumero` não exportado e `tools/list` com 2 ferramentas.

- [ ] **Step 3: Implementar em `logica.ts`**

Depois de `Identificacao`:

```ts
export interface Simulacao {
    atende: boolean
    concessionaria: string | null
    desconto_pct: number | null
    tarifa?: number
    consumo_kwh?: number | null
    consumo_convertido?: boolean
    economia_mensal?: number | null
    economia_anual?: number | null
    atinge_minimo?: boolean | null
    vaga?: 'imediata' | 'pre_operacao' | 'fila' | null
    previsao_operacao?: string | null
    link_adesao: string
}
```

Em `Dependencias`, acrescentar:

```ts
    simular(cidade: string, uf: string, consumoKwh: number | null, valorReais: number | null,
            telefone: string | null): Promise<Simulacao>
```

Depois de `normalizarTelefone`:

```ts
/** 300, "300 kWh", "R$ 1.250,90" -> número positivo; o resto -> null. */
export function lerNumero(valor: unknown): number | null {
    if (typeof valor === 'number') return Number.isFinite(valor) && valor > 0 ? valor : null
    if (typeof valor !== 'string') return null
    const limpo = valor.replace(/[^\d.,]/g, '')
    const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo
    const n = Number(normal)
    return Number.isFinite(n) && n > 0 ? n : null
}
```

Em `FERRAMENTAS`, terceiro item:

```ts
    {
        name: 'b2w_simular_assinatura',
        title: 'Simular Energia por Assinatura',
        description:
            'Estima a economia mensal e anual na Energia por Assinatura (mesma conta do simulador do site), ' +
            'diz se o consumo atinge o mínimo, se há vaga em usina (imediata, pre_operacao ou fila) e devolve ' +
            'o link de adesão. Informe o consumo em kWh OU o valor da conta em reais.',
        inputSchema: {
            type: 'object',
            properties: {
                cidade: { type: 'string', description: 'Nome da cidade, como o cliente escreveu.' },
                uf: { type: 'string', description: 'Estado: sigla (RN) ou nome (Rio Grande do Norte).' },
                consumo_kwh: { type: 'number', description: 'Consumo médio mensal em kWh.' },
                valor_conta_reais: { type: 'number', description: 'Valor médio da conta em reais, se o cliente não souber o kWh.' },
            },
            required: ['cidade', 'uf'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
```

Em `chamarFerramenta`, antes do `return null` final:

```ts
    if (nome === 'b2w_simular_assinatura') {
        const cidade = typeof args?.cidade === 'string' ? normalizarTexto(args.cidade) : ''
        const uf = typeof args?.uf === 'string' ? normalizarUf(args.uf) : null
        const kwh = lerNumero(args?.consumo_kwh)
        const reais = kwh === null ? lerNumero(args?.valor_conta_reais) : null
        if (!cidade || !uf) {
            return resultadoDeFerramenta({ erro: 'Informe a cidade e o estado (sigla ou nome).' }, true)
        }
        if (kwh === null && reais === null) {
            return resultadoDeFerramenta({ erro: 'Informe o consumo em kWh ou o valor da conta em reais.' }, true)
        }
        return resultadoDeFerramenta(await deps.simular(cidade, uf, kwh, reais, normalizarTelefone(ctx.telefone)))
    }
```

Atualizar o comentário do topo: "Ferramentas: b2w_concessionaria, b2w_identificar_contato e b2w_simular_assinatura (spec 2026-10-20-base-agente-assinatura-design.md §5)".

- [ ] **Step 4: Implementar em `index.ts`**

Import: `import { responder, tokenConfere, type Concessionaria, type Identificacao, type Simulacao } from './logica.ts'`. Em `deps`:

```ts
        async simular(cidade: string, uf: string, consumoKwh: number | null, valorReais: number | null,
                      telefone: string | null): Promise<Simulacao> {
            const { data, error } = await supabase.rpc('b2w_mcp_simular_assinatura', {
                p_cidade: cidade, p_uf: uf, p_consumo_kwh: consumoKwh, p_valor_reais: valorReais, p_telefone: telefone,
            })
            if (error) throw error
            return data as Simulacao
        },
```

E no comentário do topo trocar a lista de ferramentas por "b2w_concessionaria, b2w_identificar_contato e b2w_simular_assinatura".

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/b2w-mcp.test.ts`
Esperado: PASS (todos os testes, inclusive os 13 antigos).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/b2w-mcp tests/b2w-mcp.test.ts
git commit -m "feat(b2w-mcp): ferramenta b2w_simular_assinatura"
```

---

### Task 3: Fontes da base (FAQ e cobertura) na `deskcomm-base`

**Files:**
- Create: `supabase/functions/deskcomm-base/bases/assinatura-faq.ts`
- Modify: `supabase/functions/deskcomm-base/montar.ts`
- Modify: `supabase/functions/deskcomm-base/index.ts`
- Test: `tests/deskcomm-base.test.ts`

**Interfaces:**
- Consumes: RPC `ponte_deskcomm_assinatura_cobertura()` (Task 1).
- Produces: `montarCoberturaAssinatura(linhas: CoberturaAssinatura[]): string`, `SEM_COBERTURA`, `FAQ_ASSINATURA`; chaves de `fontes_base` `assinatura_faq` e `assinatura_cobertura`; nomes das fontes `Assinatura — Perguntas e respostas` e `Assinatura: cobertura, desconto e indicação`.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/deskcomm-base.test.ts`, trocar o import por:

```ts
import {
    montarUsinasAVenda, montarCoberturaAssinatura, lerFaq, hashTexto, SEM_USINAS, SEM_COBERTURA,
    type UsinaAVenda, type CoberturaAssinatura,
} from '../supabase/functions/deskcomm-base/montar'
import { FAQ_INVESTIDOR } from '../supabase/functions/deskcomm-base/bases/investidor-faq'
import { FAQ_ASSINATURA } from '../supabase/functions/deskcomm-base/bases/assinatura-faq'
```

E acrescentar:

```ts
const cosern: CoberturaAssinatura = {
    concessionaria: 'Neoenergia Cosern', ufs: 'RN', desconto_pct: 15, tarifa: 1.0347, credito_indicacao_100kwh: 1.33,
}

describe('montarCoberturaAssinatura', () => {
    it('monta a seção da distribuidora com desconto, tarifa, fórmula, exemplo, mínimo, indicação e vencimento', () => {
        const md = montarCoberturaAssinatura([cosern])
        expect(md).toContain('## Neoenergia Cosern (RN)')
        expect(md).toContain('Desconto do assinante: 15% sobre a energia compensada (Fio B incluído; bandeira tarifária não é cobrada)')
        expect(md).toContain('Tarifa usada na estimativa: R$ 1,0347/kWh')
        expect(md).toContain('Fórmula: economia mensal estimada = consumo (kWh) × tarifa × desconto')
        expect(md).toContain('Exemplo: 300 kWh/mês → economia estimada de R$ 46,56/mês (R$ 558,74/ano)')
        expect(md).toContain('Custo mínimo da distribuidora: 30 kWh (mono), 50 kWh (bi), 100 kWh (tri)')
        expect(md).toContain('Consumo mínimo para assinar: 150 kWh/mês')
        expect(md).toContain('Crédito de indicação: cerca de R$ 1,33 a cada 100 kWh compensados pelo indicado')
        expect(md).toContain('Vencimento do boleto: dia 5')
    })
    it('sem distribuidora devolve o aviso', () => {
        expect(montarCoberturaAssinatura([])).toBe(SEM_COBERTURA)
        expect(montarCoberturaAssinatura([{ ...cosern, desconto_pct: null }])).toBe(SEM_COBERTURA)
    })
    it('ordena por nome e não carrega campo fora do contrato', () => {
        const md = montarCoberturaAssinatura([
            { ...cosern, concessionaria: 'Zeta' },
            { ...cosern, concessionaria: 'Alfa', cnpj: '12.345.678/0001-90' } as CoberturaAssinatura,
        ])
        expect(md.indexOf('## Alfa')).toBeLessThan(md.indexOf('## Zeta'))
        expect(md).not.toContain('12.345.678')
    })
    it('sem crédito de indicação omite a linha', () => {
        expect(montarCoberturaAssinatura([{ ...cosern, credito_indicacao_100kwh: 0 }])).not.toContain('Crédito de indicação')
    })
})

describe('FAQ da Assinatura', () => {
    it('tem as 18 perguntas aprovadas e respeita as proibições', () => {
        const pares = lerFaq(FAQ_ASSINATURA)
        expect(pares).toHaveLength(18)
        const tudo = FAQ_ASSINATURA.toLowerCase()
        expect(tudo).not.toContain('30%')
        expect(tudo).not.toContain('fidelidade de')
        expect(tudo).toContain('não há fidelidade nem multa')
        expect(tudo).toContain('todo dia 5')
        expect(tudo).toContain('fio b incluído')
        // Números que mudam ficam na Fonte B, não aqui.
        expect(tudo).not.toMatch(/\b15%/)
        expect(tudo).not.toContain('1,0347')
    })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/deskcomm-base.test.ts`
Esperado: FAIL — `montarCoberturaAssinatura`/`assinatura-faq` não existem.

- [ ] **Step 3: Criar `bases/assinatura-faq.ts`**

Ver o formato de `bases/investidor-faq.ts` (export de template string). Conteúdo:

```ts
/**
 * FAQ do Agente Assinatura no DeskcommCRM
 * (spec docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md §4.1).
 * Em .ts porque a Edge Function so publica arquivo importado.
 * Numeros que mudam (desconto, tarifa, credito de indicacao) ficam na Fonte B,
 * gerada do CRM: aqui so regra.
 */
export const FAQ_ASSINATURA = `## Pergunta: Como funciona a energia por assinatura?
## Resposta: A B2W tem usinas solares ligadas à Associação de Usinas B2W Energia, no modelo de geração compartilhada da Lei 14.300. A energia gerada vira crédito na sua unidade consumidora, e você paga a energia compensada com desconto. Sem obra e sem instalar placas.

## Pergunta: Qual é o desconto?
## Resposta: É o percentual do plano vigente da sua distribuidora (veja "Assinatura: cobertura, desconto e indicação"). Vale sobre a energia compensada, com o Fio B incluído.

## Pergunta: O que fica sem desconto?
## Resposta: A iluminação pública e, quando o consumo não chega a cobri-lo, o custo mínimo da distribuidora: 30 kWh (monofásico), 50 kWh (bifásico) ou 100 kWh (trifásico).

## Pergunta: E a bandeira tarifária?
## Resposta: Na energia por assinatura a bandeira não é cobrada. Em bandeira amarela ou vermelha, a economia que você percebe na conta fica maior.

## Pergunta: Como é calculada a economia?
## Resposta: Consumo mensal × tarifa da distribuidora × percentual de desconto. É uma estimativa: o valor exato sai da sua conta de energia.

## Pergunta: Em quanto tempo começa o desconto?
## Resposta: Em 30 a 60 dias (1 a 2 ciclos). Podem vir até 2 contas proporcionais sem desconto: uma ainda no seu nome, até a troca de titularidade, e outra já no nome da Associação, enquanto a distribuidora processa a lista de rateio.

## Pergunta: Precisa ter vaga?
## Resposta: Sim. Com vaga numa usina que já gera, a adesão é imediata. Com vaga só numa usina em pré-operação, você assina agora e o desconto começa quando ela entrar em operação. Sem vaga, você entra na fila de espera e a equipe avisa quando abrir.

## Pergunta: A conta muda de nome?
## Resposta: Sim. A unidade consumidora passa para o nome da Associação, que representa você na distribuidora. O imóvel e o consumo continuam seus.

## Pergunta: Como eu pago?
## Resposta: Um único boleto ou PIX da B2W por mês, que já inclui o que é devido à distribuidora: a B2W quita a conta da concessionária. Ele chega por e-mail ou WhatsApp com 5 dias de antecedência, e a 2ª via sai pelo app.

## Pergunta: Qual o vencimento?
## Resposta: Todo dia 5.

## Pergunta: E se eu atrasar?
## Resposta: Aquela fatura sai pelo valor cheio, sem o desconto, com multa de 2%, juros de 1% ao mês e correção pelo IPCA. O desconto volta no ciclo seguinte. Com 30 dias de atraso a unidade sai do rateio; com 45, o débito pode ir a protesto; com 60, o contrato é rescindido.

## Pergunta: Tem fidelidade? Como cancelo?
## Resposta: Não há fidelidade nem multa. Para sair, avise com 90 dias ou 3 ciclos de compensação, o que vier por último.

## Pergunta: E se a usina gerar menos?
## Resposta: No ciclo sem compensação você paga o valor normal da distribuidora, sem desconto e sem nenhum custo extra.

## Pergunta: Vou mudar ou vender o imóvel. O que faço?
## Resposta: Avise a B2W com 30 dias de antecedência.

## Pergunta: Como faço a adesão?
## Resposta: Pelo link: CEP e consumo, documento com foto e a conta de energia de cada unidade; se for empresa, também o contrato social. A assinatura é eletrônica e o link vale 30 dias. Dá para aderir com várias unidades.

## Pergunta: Como funciona a indicação?
## Resposta: Depois de assinar você ganha link e QR code próprios. Cada indicado que assina gera um crédito mensal abatido na sua fatura (valor em "Assinatura: cobertura, desconto e indicação"), enquanto vocês dois estiverem ativos e em dia. O crédito abate primeiro a fatura mais próxima; o que sobrar no ciclo é descartado.

## Pergunta: É um investimento?
## Resposta: Não. O benefício é o desconto na conta. Para quem quer renda, a B2W tem as Usinas de Investimento.

## Pergunta: Quem é a B2W Energia? Posso visitar uma usina?
## Resposta: A B2W Energia é uma empresa mineira que opera há 8 anos no Rio Grande do Norte, estado de alto potencial energético. É especializada em usinas de investimento e acompanha o investidor de ponta a ponta, da prospecção da área à gestão dos assinantes que consomem a energia gerada. São mais de 1.000 usinas de varejo construídas e dezenas de usinas de investimento entregues. Você pode visitar uma usina em funcionamento e o nosso escritório no Rio Grande do Norte: recebemos você no aeroporto e levamos até usinas próximas.
`
```

A última resposta é cópia literal da pergunta "Quem é a B2W Energia?" de `bases/investidor-faq.ts`: se uma mudar, mude a outra.

- [ ] **Step 4: Implementar em `montar.ts`**

Depois de `ParFaq`:

```ts
export interface CoberturaAssinatura {
    concessionaria: string
    ufs: string | null
    desconto_pct: number | null
    tarifa: number | null
    credito_indicacao_100kwh: number | null
}

export const SEM_COBERTURA =
    '# Assinatura: cobertura, desconto e indicação\n\nNo momento a energia por assinatura não está disponível em nenhuma região.\n'

const reais = (v: number) => `R$ ${numero(v, 2)}`

function blocoCobertura(c: CoberturaAssinatura) {
    const d = Number(c.desconto_pct)
    const t = Number(c.tarifa)
    const mensal = Math.round(300 * t * d) / 100
    const anual = Math.round(300 * t * d * 12) / 100
    const linhas = [
        `## ${c.concessionaria}${c.ufs ? ` (${c.ufs})` : ''}`,
        `Desconto do assinante: ${numero(d)}% sobre a energia compensada (Fio B incluído; bandeira tarifária não é cobrada)`,
        `Tarifa usada na estimativa: R$ ${t.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}/kWh`,
        'Fórmula: economia mensal estimada = consumo (kWh) × tarifa × desconto',
        `Exemplo: 300 kWh/mês → economia estimada de ${reais(mensal)}/mês (${reais(anual)}/ano)`,
        'Custo mínimo da distribuidora: 30 kWh (mono), 50 kWh (bi), 100 kWh (tri)',
        'Consumo mínimo para assinar: 150 kWh/mês',
    ]
    if (c.credito_indicacao_100kwh && c.credito_indicacao_100kwh > 0) {
        linhas.push(`Crédito de indicação: cerca de ${reais(c.credito_indicacao_100kwh)} a cada 100 kWh compensados pelo indicado`)
    }
    linhas.push('Vencimento do boleto: dia 5')
    return linhas.join('\n')
}

/** Documento "Assinatura: cobertura, desconto e indicação". Só distribuidora com desconto e tarifa. */
export function montarCoberturaAssinatura(linhas: CoberturaAssinatura[]): string {
    const validas = linhas.filter((c) => c.desconto_pct != null && Number(c.desconto_pct) > 0 && Number(c.tarifa) > 0)
    if (validas.length === 0) return SEM_COBERTURA
    const ordenadas = [...validas].sort((a, b) => a.concessionaria.localeCompare(b.concessionaria))
    return '# Assinatura: cobertura, desconto e indicação\n\n' + ordenadas.map(blocoCobertura).join('\n\n') + '\n'
}
```

Conferência da conta do exemplo: `Math.round(300 × 1.0347 × 15) / 100 = Math.round(4656.15) / 100 = 46.56`; anual `Math.round(55873.8) / 100 = 558.74`. Mesmo resultado do `round(...,2)` da RPC.

Atualizar o comentário do topo: "Monta os textos das bases do Agente Investidor (spec 2026-10-19 §4) e do Agente Assinatura (spec 2026-10-20 §4)".

- [ ] **Step 5: Rodar os testes do montador**

Run: `npx vitest run tests/deskcomm-base.test.ts`
Esperado: PASS.

- [ ] **Step 6: `index.ts` sincroniza por categoria**

Imports:

```ts
import { hashTexto, lerFaq, montarUsinasAVenda, montarCoberturaAssinatura, type UsinaAVenda, type CoberturaAssinatura } from './montar.ts'
import { FAQ_INVESTIDOR } from './bases/investidor-faq.ts'
import { FAQ_ASSINATURA } from './bases/assinatura-faq.ts'
```

Remover `const CATEGORIA = 'usina_investimento'`. Em `Conteudo`:

```ts
interface Conteudo {
    chave: 'investidor_faq' | 'usinas_a_venda' | 'assinatura_faq' | 'assinatura_cobertura'
    categoria: 'usina_investimento' | 'energia_assinatura'
    tipo: 'faq' | 'documento'
    nome: string
    texto: string
    pares?: { question: string; answer: string }[]
}
```

`montarConteudos` passa a devolver as quatro fontes:

```ts
async function montarConteudos(supabase: Supa): Promise<Conteudo[]> {
    const paresInv = lerFaq(FAQ_INVESTIDOR)
    const paresAss = lerFaq(FAQ_ASSINATURA)
    if (paresInv.length === 0 || paresAss.length === 0) throw new Error('faq_vazio')

    const { data: usinas, error } = await supabase.rpc('ponte_deskcomm_usinas_a_venda')
    if (error) throw new Error(`usinas_ilegiveis: ${error.message}`)
    const { data: cobertura, error: cobErr } = await supabase.rpc('ponte_deskcomm_assinatura_cobertura')
    if (cobErr) throw new Error(`cobertura_ilegivel: ${cobErr.message}`)

    return [
        { chave: 'investidor_faq', categoria: 'usina_investimento', tipo: 'faq', nome: 'Investidor — Perguntas e respostas', texto: JSON.stringify(paresInv), pares: paresInv },
        { chave: 'usinas_a_venda', categoria: 'usina_investimento', tipo: 'documento', nome: 'Usinas à venda', texto: montarUsinasAVenda((usinas ?? []) as UsinaAVenda[]) },
        { chave: 'assinatura_faq', categoria: 'energia_assinatura', tipo: 'faq', nome: 'Assinatura — Perguntas e respostas', texto: JSON.stringify(paresAss), pares: paresAss },
        { chave: 'assinatura_cobertura', categoria: 'energia_assinatura', tipo: 'documento', nome: 'Assinatura: cobertura, desconto e indicação', texto: montarCoberturaAssinatura((cobertura ?? []) as CoberturaAssinatura[]) },
    ]
}
```

Na mensagem de fonte recriada (dentro de `sincronizar`), trocar o script fixo por um que depende da categoria:

```ts
        const script = c.categoria === 'energia_assinatura' ? 'base_assinatura.sql' : 'base_investidor.sql'
        await supabase.rpc('ponte_deskcomm_erro_base', {
            p_onde: 'deskcomm-base', p_mensagem: `fonte ${c.chave} recriada (${fonte.id}): rode scripts/deskcomm/${script}`,
        })
```

No `serve`, trocar o bloco que busca um único agente (de `const { data: alvo }` até o `if (!org || !agente) {...}`) por um mapa por categoria, e o loop passa a usar o agente da categoria do conteúdo:

```ts
        const alvos = new Map<string, { org: string; agente: string }>()
        for (const cat of new Set(conteudos.map((c) => c.categoria))) {
            const { data: alvo } = await supabase.rpc('ponte_deskcomm_agente_da_categoria', { p_slug: cat })
            const org = (alvo as any[] | null)?.[0]?.organization_id as string | undefined
            const agente = (alvo as any[] | null)?.[0]?.agent_id as string | undefined
            if (org && agente) alvos.set(cat, { org, agente })
            else await erro(`agente da categoria ${cat} não encontrado`)
        }

        const { data: registros, error: regErr } = await supabase.rpc('ponte_deskcomm_fontes_base')
        if (regErr) throw new Error(`fontes_base: ${regErr.message}`)
        const porChave = new Map(((registros ?? []) as Registro[]).map((r) => [r.chave, r]))

        const resultado = []
        for (const c of conteudos) {
            const alvo = alvos.get(c.categoria)
            if (!alvo) {
                resultado.push({ chave: c.chave, erro: 'agente_nao_encontrado' })
                continue
            }
            const reg = porChave.get(c.chave) ?? { chave: c.chave, knowledge_source_id: null, ultimo_hash: null, sincronizado_em: null }
            try {
                resultado.push(await sincronizar(supabase, alvo.org, alvo.agente, c, reg))
            } catch (e) {
                const msg = `${c.chave}: ${String((e as Error)?.message ?? e)}`
                await erro(msg)
                resultado.push({ chave: c.chave, erro: msg })
            }
        }
        return json(200, { ok: resultado.every((r: any) => !r.erro), resultado })
```

Atualizar o comentário do topo: a função mantém as fontes do Investidor (§5.3 da spec 2026-10-19) e da Assinatura (`assinatura_faq` faq; `assinatura_cobertura` documento gerado por `ponte_deskcomm_assinatura_cobertura`), e é chamada também pelos gatilhos de planos e tarifa.

`ponte_deskcomm_fonte_base_marcar` só faz UPDATE: as chaves novas já foram criadas pela migration da Task 1 (seção 3).

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npx vitest run`
Esperado: PASS, sem regressão nos testes do Investidor.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/deskcomm-base tests/deskcomm-base.test.ts
git commit -m "feat(deskcomm-base): fontes da base do Agente Assinatura"
```

---

### Task 4: Publicar as funções e sincronizar a base

**Files:** nenhum novo (só deploy e verificação).

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: fontes `assinatura_faq` e `assinatura_cobertura` em `ponte_deskcomm.fontes_base` com `knowledge_source_id`; ferramenta visível no `tools/list`.

- [ ] **Step 1: Publicar (com aprovação do usuário)**

Pedir aprovação. Depois, no worktree:

```bash
npx supabase functions deploy b2w-mcp --project-ref abbysvxnnhwvvzhftoms --no-verify-jwt
npx supabase functions deploy deskcomm-base --project-ref abbysvxnnhwvvzhftoms
```

- [ ] **Step 2: Ensaio**

```sql
select ponte_deskcomm.fn_chamar_funcao('deskcomm-base', '{"ensaio": true}'::jsonb);
```

Ler a resposta em `net._http_response` (como no ensaio do Investidor) e conferir: quatro conteúdos; `assinatura_faq` com `pares = 18`; texto de `assinatura_cobertura` com a seção da Cosern e "R$ 46,56/mês".

- [ ] **Step 3: Sincronizar de verdade e conferir a indexação**

```sql
select ponte_deskcomm.fn_chamar_funcao('deskcomm-base', '{}'::jsonb);
```

Depois de ~1 minuto:

```sql
select f.chave, s.name, s.source_type, s.last_index_status, s.chunks_count
  from ponte_deskcomm.fontes_base f join ai_knowledge_sources s on s.id = f.knowledge_source_id
 where f.chave like 'assinatura_%';
```

Esperado: duas linhas, `last_index_status = success`, `chunks_count > 0`. Fontes do Investidor continuam `success`.

- [ ] **Step 4: Ferramenta no servidor MCP**

Conferir em `query_logs` (`function_edge_logs`, url com `b2w-mcp`) que não há 5xx depois do deploy. A lista de ferramentas é lida pelo Deskcomm na próxima conversa.

---

### Task 5: Nova versão do Agente Assinatura

**Files:**
- Create: `scripts/deskcomm/base_assinatura.sql`

**Interfaces:**
- Consumes: `fontes_base` (`assinatura_faq`, `assinatura_cobertura`) da Task 4; ferramenta `mcp_externo:leitura:b2w_simular_assinatura`.
- Produces: versão publicada do Agente Assinatura.

- [ ] **Step 1: Escrever o script**

`scripts/deskcomm/base_assinatura.sql` — mesma estrutura de `scripts/deskcomm/base_investidor.sql` (ler o arquivo inteiro antes), com estas diferenças:

1. Cabeçalho: "Nova versao do Agente Assinatura com a base de conhecimento (spec docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md §3 e §6)."
2. `v_roteiro`:

```
Você é a Bel da equipe de Energia por Assinatura da B2W Energia.
Objetivo: mostrar a economia na conta de luz e levar o cliente à adesão pelo link.

Use a busca na base de conhecimento (crm_search_knowledge) antes de responder qualquer pergunta sobre o produto. Os fatos estão em "Assinatura — Perguntas e respostas" e "Assinatura: cobertura, desconto e indicação". Responda com o que estiver lá; se não estiver, diga que vai confirmar com a equipe e passe para humano.

Roteiro (depois da abertura):
1. Consumo: "Quanto vem sua conta de luz por mês? Pode ser em kWh, em reais ou a foto da conta." Grave consumo_kwh.
2. Se for empresa, se o consumo passar de 5.000 kWh ou se a conta mostrar "Grupo A" ou "B Optante": "Sua conta é de média tensão ou B optante?"
3. Simulação: no MESMO turno, busque "simulação desconto assinatura" na base e chame b2w_simular_assinatura (cidade, uf e consumo_kwh ou valor_conta_reais). Se o consumo veio convertido de reais, grave o consumo_kwh devolvido.
4. Responda conforme o caso:
- Consumo abaixo de 150 kWh (atinge_minimo = false): explique que, com consumo baixo, o custo mínimo da distribuidora come a economia. Não insista; deixe a porta aberta.
- Grupo A (média ou alta tensão, não optante): passe para humano com o motivo "Grupo A — avaliar Mercado Livre/Gestora".
- B optante: explique que, pela regra da ANEEL, B optante só recebe créditos de usina instalada no próprio local. Com 5.000 kWh/mês ou mais, ofereça a análise de uma usina no local em comodato, com contrato de 48 meses; se aceitar, passe para humano com o motivo "B optante — usina no local em comodato". Abaixo de 5.000 kWh, explique e encerre com cordialidade.
- Já tem placa solar ou participa de outra cooperativa ou associação: passe para humano com o motivo "já gera energia ou participa de outra associação".
- vaga = imediata: diga a economia estimada por mês e por ano ("é uma estimativa; o valor exato sai da sua conta"), que o desconto começa em 30 a 60 dias e que podem vir até 2 contas proporcionais sem desconto durante a troca de titularidade e o rateio. Envie o link_adesao.
- vaga = pre_operacao: diga a estimativa e que o cliente assina agora e o desconto começa quando a usina entrar em operação (cite a previsão, se vier). Envie o link_adesao.
- vaga = fila: grave lista_espera = true, explique a fila de espera e diga que a equipe avisa quando abrir vaga. Não envie link.
- desconto_pct vazio: passe para humano com o motivo "distribuidora sem desconto vigente único".
- Se a ferramenta não responder: diga que vai confirmar a simulação com a equipe, envie https://b2wenergia.com.br/ para o cliente simular e siga.
- Se não puder citar o valor em reais, diga o percentual e envie o link do simulador.
5. Depois do link, tire as dúvidas da adesão (documentos com foto, conta de cada unidade, contrato social se for empresa, assinatura eletrônica, link válido por 30 dias, várias unidades). Passe para humano só se o cliente pedir, reclamar ou travar. A adesão pelo link não é contrato montado pela equipe: aqui ela não exige humano.

Nunca diga "30% de desconto". Nunca diga que há fidelidade ou multa para sair. Nunca diga que o desconto vale sobre a conta inteira: ficam fora a iluminação pública e o custo mínimo quando o consumo não o cobre. Nunca diga qual usina vai atender o cliente. Nenhum número que não veio da ferramenta ou da base.

Etapas: cidade e consumo informados → "Qualificando". Estimativa enviada → "Simulação / Proposta enviada". Link enviado e o cliente diz que vai assinar → "Contrato enviado".
```

3. `v_comum`: copiar o bloco `v_comum` de `base_investidor.sql` sem nenhuma mudança.
4. Categoria: `ponte_deskcomm_agente_da_categoria('energia_assinatura')`; erro "Agente Assinatura nao encontrado".
5. Fontes: `where chave in ('assinatura_faq', 'assinatura_cobertura')`.
6. Ferramentas acrescentadas: as mesmas de `base_investidor.sql` mais `'mcp_externo:leitura:b2w_simular_assinatura'`.
7. Idempotência: além de prompt e fontes, `v.tool_ids @> array['mcp_externo:leitura:b2w_simular_assinatura']`.
8. `event_log` com `'origem', 'base_assinatura'`; notice "Agente Assinatura ja esta com o roteiro e as fontes; nada a fazer".

- [ ] **Step 2: Rodar (com aprovação do usuário) e conferir**

Pedir aprovação; rodar o script com `execute_sql`. Conferir:

```sql
select v.version_number, position('b2w_simular_assinatura' in v.system_prompt) > 0 roteiro,
       'mcp_externo:leitura:b2w_simular_assinatura' = any(v.tool_ids) ferramenta,
       v.knowledge_source_ids @> (select array_agg(knowledge_source_id) from ponte_deskcomm.fontes_base
                                   where chave like 'assinatura_%') fontes
  from ai_agents a join ai_agent_versions v on v.id = a.published_version_id
 where a.name = 'Agente Assinatura';
```

Esperado: versão 3, `true, true, true`. Rodar o script de novo: notice "nada a fazer".

- [ ] **Step 3: Commit**

```bash
git add scripts/deskcomm/base_assinatura.sql
git commit -m "feat(deskcomm): roteiro e base do Agente Assinatura"
```

---

### Task 6: Documentação, PR e conversas de teste

**Files:**
- Modify: `playbook/DESKCOMM.md`
- Modify: `docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md` (estado)

- [ ] **Step 1: Playbook**

Em `playbook/DESKCOMM.md`, na lista de arquivos da §7, acrescentar:

```
- `supabase/migrations/20261021a_base_agente_assinatura.sql` — simulação (b2w_mcp_simular_assinatura), cobertura da Fonte B e gatilhos de planos/tarifa.
- `supabase/functions/deskcomm-base/bases/assinatura-faq.ts` — FAQ do Agente Assinatura.
- `scripts/deskcomm/base_assinatura.sql` — publica a versão do Agente Assinatura com roteiro, fontes e a ferramenta de simulação.
```

E a seção nova depois da §8.2:

```
### 8.3 Base do Agente Assinatura — no ar desde <data da Task 5, em Brasília>

Spec: `docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md`.

- **Fontes:** "Assinatura — Perguntas e respostas" (faq, `bases/assinatura-faq.ts`) e "Assinatura: cobertura, desconto e indicação" (documento gerado por `ponte_deskcomm_assinatura_cobertura`: desconto do plano vigente, tarifa, fórmula, crédito de indicação). Regenerada por gatilho em `planos_assinatura_energia`, `planos_distribuidoras` e tarifa da `"Concessionaria"`, e pelo cron de hora em hora.
- **Ferramenta `b2w_simular_assinatura`** (servidor `b2w-mcp`): mesma conta do simulador do site, vaga (imediata / pré-operação / fila) e link de adesão com o indicador do lead.
- **Vaga:** geração estimada da usina − franquias das UCs que a ocupam (todas menos canceladas, desconectadas e desligadas por TT).
- **Mudar o FAQ:** editar `bases/assinatura-faq.ts` e publicar `deskcomm-base`. **Mudar o roteiro:** editar `base_assinatura.sql` e rodar.
- **Pendências:** termo de adesão diverge do roteiro (titularidade, Fio B, bandeira, vencimento dia 5) — revisar com o jurídico; UFV Bom Jesus com franquias acima da geração estimada.
```

- [ ] **Step 2: Estado do spec**

Trocar "Estado: desenho aprovado, aguardando revisão do spec" por "Estado: implementado em <data> (ver `playbook/DESKCOMM.md` §8.3)".

- [ ] **Step 3: Suíte, commit, push e PR**

```bash
npx vitest run
git add playbook/DESKCOMM.md docs/superpowers/specs/2026-10-20-base-agente-assinatura-design.md docs/superpowers/plans/2026-10-20-base-agente-assinatura.md
git commit -m "docs(deskcomm): playbook da base do Agente Assinatura"
git push -u origin feat/base-agente-assinatura
gh pr create --repo WaldineyGodoy/saas --base main --head feat/base-agente-assinatura --title "feat(deskcomm): base de conhecimento do Agente Assinatura"
```

Corpo do PR: o que muda, o que já está em produção (migration, funções, versão do agente), testes, pendências (termo de adesão, Bom Jesus).

- [ ] **Step 4: Conversas de teste (usuário, número que não é cliente nem lead)**

| Mensagem | Esperado |
|---|---|
| Natal/RN, "uns 300 kWh" | Estimativa ~R$ 46,56/mês, prazo 30–60 dias, link (ou fila, conforme as vagas do dia) |
| "gasto 100 kWh" | Explica consumo baixo, não insiste |
| "4.000 kWh" | Pré-operação: assina agora, desconto quando a usina operar |
| "sou B optante, 8.000 kWh" | Regra da ANEEL + oferta de comodato 48 meses |
| "tem fidelidade?" | Sem fidelidade nem multa, aviso de 90 dias |
| "e a bandeira vermelha?" | Bandeira não é cobrada; economia percebida maior |
| Vindo por link de indicação do site | Link de adesão com `?indicador=` |

Depois de cada uma, conferir o card (etapa, `consumo_kwh`, `lista_espera`) e os logs do `b2w-mcp` (sem erro).
