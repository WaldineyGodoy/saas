# Conta em rampa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar UC em rampa de consumo (histórico curto e crescente) e, nesse caso, sugerir/aplicar franquia, preencher o perfil mensal e congelar a base do Start com o consumo recente, em vez da mediana.

**Architecture:** A regra mora no banco (`fn_regime_consumo`, chamada por `fn_historico_consumo_gravar_uc`, o único ponto que grava histórico para site, app, WhatsApp e CRM). Um espelho puro em JS (`src/lib/regimeConsumo.js`) só serve à pré-visualização na tela e usa as mesmas fixtures dos testes SQL. A tela do histórico mostra o regime, a franquia sugerida e o botão Aplicar.

**Tech Stack:** PostgreSQL (Supabase, plpgsql), React 19 + Vite, Vitest.

Spec: `docs/superpowers/specs/2026-11-26-conta-em-rampa-design.md` (aprovada em 26/11/2026: base do Start opção C, prudência 80 %, franquia só sugerida depois do contrato, conta em queda sugere redução).

## Global Constraints

- Regime: `insuficiente` (n < 2), `em_rampa`, `em_queda`, `estavel`. Consumo normalizado a 30 dias: `c = kwh / dias × 30` (sem `dias`, `c = kwh`); só meses com `kwh > 0`; por mês do calendário vale a leitura mais recente.
- `em_rampa` = `n ≤ 6` **e** `c_ult ≥ 2 × mediana(c anteriores)` **e** `c_ult > 1,25 × c_penúltimo`. (Refinamento da spec: o "ainda subindo" usa a mesma faixa de ±25 % da saída da rampa; sem isso um mês +1,5 % manteria a conta em rampa.)
- `em_queda` = `n ≥ 3` **e** `c_ult ≤ 0,5 × mediana(c anteriores)`.
- `franquia_rampa = arredondar( máx( 0,8 × c_ult , mediana do perfil ) )`. Prudência 0,8. Sem teto físico nesta versão (opcional na spec).
- Base do Start (`start_base_kwh`): congelada uma única vez, como hoje; em rampa recebe `franquia_rampa` (opção C).
- Franquia: na **primeira carga do histórico** da UC (`historico_consumo` nulo) em rampa, `franquia := franquia_rampa`. Nas cargas seguintes só grava `franquia_sugerida`; quem aplica é a equipe (botão Aplicar). Isso substitui o "antes da assinatura aplica sozinha" da spec, que o banco não consegue distinguir de forma confiável.
- Meses sem leitura: em rampa recebem `franquia_rampa` com `origem = 'rampa'`; fora da rampa, a mediana com `origem = 'mediana'`. `fn_mediana_kwh` ignora `mediana` e `rampa`.
- Saída da rampa: `regime` volta a `estavel`; se o regime anterior era `em_rampa`, `franquia_sugerida` = mediana dos 3 últimos ciclos normalizados (`franquia_janela`).
- `em_queda`: `franquia_sugerida` = `franquia_janela`; nada muda sozinho.
- Parâmetros ficam como argumentos com default de `fn_regime_consumo` (`p_prudencia 0.8`, `p_razao 2`, `p_janela 6`, `p_queda 0.5`).
- Gate de gravação igual ao de `fn_gravar_historico_consumo`: `service_role`, papel interno ou `session_user = 'postgres'`.
- `consumer_units.franquia`, `start_base_kwh` e `consumo_mediano_kwh` são `numeric`; `historico_consumo` é `jsonb` por mês do calendário: `{"08":{"kwh":4334,"ref":"2026-08","origem":"cadastro","dias":30}}`.
- Migração nova: `supabase/migrations/20261127a_conta_em_rampa.sql`. Projeto Supabase `abbysvxnnhwvvzhftoms`. Migração só é aplicada em produção com autorização do dono; merge em `main` republica o CRM.
- Arquivos do repo usam CRLF; edite preservando as quebras de linha.

## File Structure

- Create `src/lib/regimeConsumo.js` — espelho puro do detector (classificação + franquia).
- Create `src/lib/regimeConsumo.test.js` — Vitest com as fixtures compartilhadas.
- Create `supabase/migrations/20261127a_conta_em_rampa.sql` — colunas, `fn_regime_consumo`, ajustes das funções de histórico, `fn_aplicar_franquia_sugerida`.
- Modify `src/lib/historicoConsumo.js` — rótulo da origem `rampa`.
- Modify `src/components/HistoricoConsumo.jsx` — selo de regime, franquia sugerida, botão Aplicar, cor da origem `rampa`.

## Fixtures compartilhadas (JS e SQL)

Caso real (UC da Bem Potiguar, 26/11/2026), leitor `[{mes,kwh,dias}]`:

```
2026-08 4334 30 | 2026-07 869 33 | 2026-06 329 29 | 2026-05 100 20
```
Normalizado (30 dias): 150, 340, 790, 4334. Esperado: `em_rampa`, `franquia_rampa = 3467`, `franquia_janela = 790` (mediana de 340, 790, 4334 = 790).

---

### Task 1: Espelho JS do detector

**Files:**
- Create: `src/lib/regimeConsumo.js`
- Test: `src/lib/regimeConsumo.test.js`

**Interfaces:**
- Produces: `PARAMETROS_RAMPA = { prudencia: 0.8, razao: 2, janela: 6, queda: 0.5, banda: 1.25 }`; `classificarRegime(historico, params = PARAMETROS_RAMPA)` onde `historico = [{ mes: 'AAAA-MM', kwh: number, dias?: number }]`, retorna `{ regime: 'insuficiente'|'em_rampa'|'em_queda'|'estavel', n: number, cUlt: number|null, medianaAnteriores: number|null, franquiaRampa: number|null, franquiaJanela: number|null }`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/regimeConsumo.test.js
import { describe, it, expect } from 'vitest';
import { classificarRegime } from './regimeConsumo';

const CASO_REAL = [
    { mes: '2026-08', kwh: 4334, dias: 30 },
    { mes: '2026-07', kwh: 869, dias: 33 },
    { mes: '2026-06', kwh: 329, dias: 29 },
    { mes: '2026-05', kwh: 100, dias: 20 },
];

describe('classificarRegime', () => {
    it('caso real: em rampa, franquia de rampa 3467', () => {
        const r = classificarRegime(CASO_REAL);
        expect(r.regime).toBe('em_rampa');
        expect(r.n).toBe(4);
        expect(Math.round(r.cUlt)).toBe(4334);
        expect(r.franquiaRampa).toBe(3467);
        expect(r.franquiaJanela).toBe(790);
    });

    it('um mês só: insuficiente', () => {
        const r = classificarRegime([{ mes: '2026-08', kwh: 500, dias: 30 }]);
        expect(r.regime).toBe('insuficiente');
        expect(r.franquiaRampa).toBeNull();
    });

    it('doze meses estáveis: estavel', () => {
        const h = Array.from({ length: 12 }, (_, i) => ({ mes: `2025-${String(i + 1).padStart(2, '0')}`, kwh: 1000 + (i % 3) * 20, dias: 30 }));
        expect(classificarRegime(h).regime).toBe('estavel');
    });

    it('crescimento que parou (último ≈ penúltimo): estavel', () => {
        const h = [...CASO_REAL, { mes: '2026-09', kwh: 4400, dias: 30 }];
        const r = classificarRegime(h);
        expect(r.regime).toBe('estavel');
        expect(r.franquiaJanela).toBe(4334);
    });

    it('queda forte: em_queda, janela dos 3 últimos', () => {
        const h = [
            { mes: '2026-05', kwh: 3000, dias: 30 }, { mes: '2026-06', kwh: 3100, dias: 30 },
            { mes: '2026-07', kwh: 2900, dias: 30 }, { mes: '2026-08', kwh: 800, dias: 30 },
        ];
        const r = classificarRegime(h);
        expect(r.regime).toBe('em_queda');
        expect(r.franquiaJanela).toBe(2900);
    });

    it('sem dias usa o kWh como está', () => {
        const h = [{ mes: '2026-06', kwh: 100 }, { mes: '2026-07', kwh: 300 }, { mes: '2026-08', kwh: 900 }];
        const r = classificarRegime(h);
        expect(r.regime).toBe('em_rampa');
        expect(r.cUlt).toBe(900);
    });

    it('mais de 6 meses nunca é rampa', () => {
        const h = [100, 120, 150, 200, 300, 500, 2000].map((kwh, i) => ({ mes: `2026-0${i + 1}`, kwh, dias: 30 }));
        expect(classificarRegime(h).regime).not.toBe('em_rampa');
    });

    it('mesmo mês do calendário em anos diferentes: vale a leitura mais recente', () => {
        const h = [{ mes: '2025-08', kwh: 100, dias: 30 }, { mes: '2026-08', kwh: 4334, dias: 30 }];
        const r = classificarRegime(h);
        expect(r.n).toBe(1);
        expect(r.regime).toBe('insuficiente');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/regimeConsumo.test.js`
Expected: FAIL (módulo `./regimeConsumo` não existe).

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/regimeConsumo.js
// Regime de consumo da UC (conta em rampa). ESPELHO PURO de fn_regime_consumo
// (supabase/migrations/20261127a_conta_em_rampa.sql): serve à pré-visualização
// na tela; quem grava é o banco. Mesmas fixtures nos dois testes.
// Spec: docs/superpowers/specs/2026-11-26-conta-em-rampa-design.md

export const PARAMETROS_RAMPA = { prudencia: 0.8, razao: 2, janela: 6, queda: 0.5, banda: 1.25 };

const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const mediana = (valores) => {
    const v = [...valores].sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// Leitura do leitor da conta -> série por mês do CALENDÁRIO (vale a mais
// recente), só kWh > 0, ordenada por referência, com consumo a 30 dias.
const serie = (historico) => {
    const porMes = {};
    for (const item of Array.isArray(historico) ? historico : []) {
        const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(item?.mes || ''));
        const kwh = numero(item?.kwh);
        if (!m || kwh === null || kwh <= 0) continue;
        const dias = numero(item?.dias);
        const atual = porMes[m[2]];
        if (!atual || item.mes > atual.ref) {
            porMes[m[2]] = { ref: item.mes, kwh, c: dias && dias > 0 ? (kwh / dias) * 30 : kwh };
        }
    }
    return Object.values(porMes).sort((a, b) => (a.ref < b.ref ? -1 : 1));
};

export function classificarRegime(historico, params = PARAMETROS_RAMPA) {
    const s = serie(historico);
    const n = s.length;
    const vazio = { regime: 'insuficiente', n, cUlt: null, medianaAnteriores: null, franquiaRampa: null, franquiaJanela: null };
    if (n < 2) return vazio;

    const c = s.map((x) => x.c);
    const cUlt = c[n - 1];
    const cPen = c[n - 2];
    const medAnt = mediana(c.slice(0, n - 1));
    const medPerfil = mediana(s.map((x) => x.kwh));

    let regime = 'estavel';
    if (n <= params.janela && cUlt >= params.razao * medAnt && cUlt > params.banda * cPen) regime = 'em_rampa';
    else if (n >= 3 && cUlt <= params.queda * medAnt) regime = 'em_queda';

    return {
        regime,
        n,
        cUlt,
        medianaAnteriores: medAnt,
        franquiaRampa: Math.round(Math.max(params.prudencia * cUlt, medPerfil)),
        franquiaJanela: n >= 3 ? Math.round(mediana(c.slice(-3))) : null,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/regimeConsumo.test.js`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/regimeConsumo.js src/lib/regimeConsumo.test.js
git commit -m "feat(consumo): detector de regime (conta em rampa) em JS, com testes"
```

---

### Task 2: Banco — colunas e `fn_regime_consumo`

**Files:**
- Create: `supabase/migrations/20261127a_conta_em_rampa.sql`

**Interfaces:**
- Produces: colunas `consumer_units.regime_consumo text`, `regime_desde timestamptz`, `franquia_sugerida numeric`; `public.fn_regime_consumo(p_perfil jsonb, p_prudencia numeric DEFAULT 0.8, p_razao numeric DEFAULT 2, p_janela int DEFAULT 6, p_queda numeric DEFAULT 0.5) RETURNS jsonb` com chaves `regime`, `n`, `c_ult`, `mediana_anteriores`, `franquia_rampa`, `franquia_janela` (números ou `null`). Entrada: perfil por mês do calendário (`{"08":{"kwh":..,"ref":"2026-08","origem":"cadastro","dias":30}}`); só entram entradas de origem `cadastro` ou `conta`.

- [ ] **Step 1: Write the failing test (SQL, transação descartada)**

Rode com `execute_sql` (projeto `abbysvxnnhwvvzhftoms`), no Step 4, colando o conteúdo da migração antes deste bloco. O bloco termina em `RAISE EXCEPTION 'SANDBOX_OK'` para nada persistir:

```sql
DO $t$
DECLARE r jsonb;
BEGIN
  r := public.fn_regime_consumo('{
    "08":{"kwh":4334,"ref":"2026-08","origem":"cadastro","dias":30},
    "07":{"kwh":869,"ref":"2026-07","origem":"cadastro","dias":33},
    "06":{"kwh":329,"ref":"2026-06","origem":"cadastro","dias":29},
    "05":{"kwh":100,"ref":"2026-05","origem":"cadastro","dias":20}}'::jsonb);
  IF r->>'regime' <> 'em_rampa' THEN RAISE EXCEPTION 'FALHOU caso real regime=%', r->>'regime'; END IF;
  IF (r->>'franquia_rampa')::numeric <> 3467 THEN RAISE EXCEPTION 'FALHOU franquia_rampa=%', r->>'franquia_rampa'; END IF;
  IF (r->>'franquia_janela')::numeric <> 790 THEN RAISE EXCEPTION 'FALHOU franquia_janela=%', r->>'franquia_janela'; END IF;

  r := public.fn_regime_consumo('{"08":{"kwh":500,"ref":"2026-08","origem":"cadastro"}}'::jsonb);
  IF r->>'regime' <> 'insuficiente' THEN RAISE EXCEPTION 'FALHOU n=1 regime=%', r->>'regime'; END IF;

  r := public.fn_regime_consumo('{
    "05":{"kwh":3000,"ref":"2026-05","origem":"cadastro","dias":30},
    "06":{"kwh":3100,"ref":"2026-06","origem":"cadastro","dias":30},
    "07":{"kwh":2900,"ref":"2026-07","origem":"cadastro","dias":30},
    "08":{"kwh":800,"ref":"2026-08","origem":"cadastro","dias":30}}'::jsonb);
  IF r->>'regime' <> 'em_queda' THEN RAISE EXCEPTION 'FALHOU queda regime=%', r->>'regime'; END IF;
  IF (r->>'franquia_janela')::numeric <> 2900 THEN RAISE EXCEPTION 'FALHOU queda janela=%', r->>'franquia_janela'; END IF;

  r := public.fn_regime_consumo('{
    "05":{"kwh":100,"ref":"2026-05","origem":"cadastro","dias":20},
    "06":{"kwh":329,"ref":"2026-06","origem":"cadastro","dias":29},
    "07":{"kwh":869,"ref":"2026-07","origem":"cadastro","dias":33},
    "08":{"kwh":4334,"ref":"2026-08","origem":"cadastro","dias":30},
    "09":{"kwh":4400,"ref":"2026-09","origem":"conta","dias":30}}'::jsonb);
  IF r->>'regime' <> 'estavel' THEN RAISE EXCEPTION 'FALHOU parou de crescer regime=%', r->>'regime'; END IF;
  IF (r->>'franquia_janela')::numeric <> 4334 THEN RAISE EXCEPTION 'FALHOU janela estavel=%', r->>'franquia_janela'; END IF;

  -- meses preenchidos (mediana/rampa) nunca entram na série
  r := public.fn_regime_consumo('{
    "07":{"kwh":869,"ref":"2026-07","origem":"cadastro","dias":33},
    "08":{"kwh":4334,"ref":"2026-08","origem":"cadastro","dias":30},
    "09":{"kwh":3467,"ref":null,"origem":"rampa"},
    "10":{"kwh":3467,"ref":null,"origem":"mediana"}}'::jsonb);
  IF (r->>'n')::int <> 2 THEN RAISE EXCEPTION 'FALHOU n com preenchidos=%', r->>'n'; END IF;
  RAISE EXCEPTION 'SANDBOX_OK';
END $t$;
```

- [ ] **Step 2: Run test to verify it fails**

Run o bloco acima **sozinho** (antes de existir a função).
Expected: erro `function public.fn_regime_consumo(jsonb) does not exist`.

- [ ] **Step 3: Write minimal implementation**

Crie `supabase/migrations/20261127a_conta_em_rampa.sql` com:

```sql
-- Conta em rampa (spec 2026-11-26-conta-em-rampa-design.md): consumo curto e
-- crescente nao e bem descrito pela mediana. Regime por UC, franquia sugerida
-- e perfil/base do Start com o consumo recente.

ALTER TABLE public.consumer_units
    ADD COLUMN IF NOT EXISTS regime_consumo    text,
    ADD COLUMN IF NOT EXISTS regime_desde      timestamptz,
    ADD COLUMN IF NOT EXISTS franquia_sugerida numeric;

ALTER TABLE public.consumer_units
    DROP CONSTRAINT IF EXISTS consumer_units_regime_consumo_valido,
    ADD CONSTRAINT consumer_units_regime_consumo_valido
        CHECK (regime_consumo IS NULL OR regime_consumo IN ('insuficiente', 'em_rampa', 'em_queda', 'estavel'));

COMMENT ON COLUMN public.consumer_units.regime_consumo IS
  'Regime do consumo (fn_regime_consumo): insuficiente | em_rampa | em_queda | estavel. Recalculado a cada conta gravada.';
COMMENT ON COLUMN public.consumer_units.franquia_sugerida IS
  'Franquia sugerida pelo regime. Nao altera franquia sozinha, exceto na primeira carga do historico em rampa (fn_historico_consumo_gravar_uc).';

CREATE OR REPLACE FUNCTION public.fn_regime_consumo(
    p_perfil jsonb,
    p_prudencia numeric DEFAULT 0.8,
    p_razao numeric DEFAULT 2,
    p_janela int DEFAULT 6,
    p_queda numeric DEFAULT 0.5)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_c       numeric[];
    v_kwh     numeric[];
    v_n       int;
    v_ult     numeric;
    v_pen     numeric;
    v_med_ant numeric;
    v_med_per numeric;
    v_regime  text := 'estavel';
BEGIN
    SELECT array_agg(s.c ORDER BY s.ref), array_agg(s.kwh ORDER BY s.ref)
      INTO v_c, v_kwh
      FROM (
        SELECT m.value ->> 'ref' AS ref,
               (m.value ->> 'kwh')::numeric AS kwh,
               CASE WHEN (m.value ->> 'dias') ~ '^[0-9]+(\.[0-9]+)?$' AND (m.value ->> 'dias')::numeric > 0
                    THEN (m.value ->> 'kwh')::numeric / (m.value ->> 'dias')::numeric * 30
                    ELSE (m.value ->> 'kwh')::numeric END AS c
          FROM jsonb_each(CASE WHEN jsonb_typeof(p_perfil) = 'object' THEN p_perfil ELSE '{}'::jsonb END) m
         WHERE jsonb_typeof(m.value) = 'object'
           AND COALESCE(m.value ->> 'origem', '') IN ('cadastro', 'conta')
           AND (m.value ->> 'ref') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
           AND (m.value ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$'
           AND (m.value ->> 'kwh')::numeric > 0) s;

    v_n := COALESCE(array_length(v_c, 1), 0);
    IF v_n < 2 THEN
        RETURN jsonb_build_object('regime', 'insuficiente', 'n', v_n, 'c_ult', NULL,
                                  'mediana_anteriores', NULL, 'franquia_rampa', NULL, 'franquia_janela', NULL);
    END IF;

    v_ult := v_c[v_n];
    v_pen := v_c[v_n - 1];
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x) INTO v_med_ant FROM unnest(v_c[1:v_n - 1]) x;
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x) INTO v_med_per FROM unnest(v_kwh) x;

    IF v_n <= p_janela AND v_ult >= p_razao * v_med_ant AND v_ult > 1.25 * v_pen THEN
        v_regime := 'em_rampa';
    ELSIF v_n >= 3 AND v_ult <= p_queda * v_med_ant THEN
        v_regime := 'em_queda';
    END IF;

    RETURN jsonb_build_object(
        'regime', v_regime,
        'n', v_n,
        'c_ult', round(v_ult, 2),
        'mediana_anteriores', round(v_med_ant, 2),
        'franquia_rampa', round(GREATEST(p_prudencia * v_ult, v_med_per)),
        'franquia_janela', CASE WHEN v_n >= 3
                                THEN (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x)) FROM unnest(v_c[v_n - 2:v_n]) x)
                           END);
END;
$function$;

ALTER FUNCTION public.fn_regime_consumo(jsonb, numeric, numeric, int, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_regime_consumo(jsonb, numeric, numeric, int, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_regime_consumo(jsonb, numeric, numeric, int, numeric) TO authenticated, service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Rode em **uma** chamada `execute_sql`: o conteúdo da migração (Step 3) seguido do bloco `DO` do Step 1.
Expected: erro `SANDBOX_OK` (qualquer outro `FALHOU ...` indica a regra errada). Nada persiste.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261127a_conta_em_rampa.sql
git commit -m "feat(consumo): regime de consumo no banco (fn_regime_consumo) e colunas da rampa"
```

---

### Task 3: Banco — origem `rampa` no perfil mensal

**Files:**
- Modify: `supabase/migrations/20261127a_conta_em_rampa.sql` (acrescentar ao final)

**Interfaces:**
- Consumes: `fn_regime_consumo(jsonb, ...)` da Task 2.
- Produces: `fn_mediana_kwh`, `fn_historico_consumo_aplicar` e `fn_historico_consumo_normalizar` tratando `origem = 'rampa'` como preenchimento (igual a `mediana`); `normalizar` preenche meses ausentes/zerados com `franquia_rampa` (`origem 'rampa'`) quando o regime do perfil é `em_rampa`, senão com a mediana (`origem 'mediana'`).

- [ ] **Step 1: Write the failing test**

```sql
DO $t$
DECLARE h jsonb; k int; ok_rampa int;
BEGIN
  -- perfil lido (4 meses) em rampa: os 8 meses restantes viram 'rampa' = 3467
  h := public.fn_historico_consumo_normalizar('{
    "08":{"kwh":4334,"ref":"2026-08","origem":"cadastro","dias":30},
    "07":{"kwh":869,"ref":"2026-07","origem":"cadastro","dias":33},
    "06":{"kwh":329,"ref":"2026-06","origem":"cadastro","dias":29},
    "05":{"kwh":100,"ref":"2026-05","origem":"cadastro","dias":20}}'::jsonb);
  SELECT count(*) INTO ok_rampa FROM jsonb_each(h) m
   WHERE m.value ->> 'origem' = 'rampa' AND (m.value ->> 'kwh')::numeric = 3467;
  IF ok_rampa <> 8 THEN RAISE EXCEPTION 'FALHOU rampa: % meses de 8', ok_rampa; END IF;

  -- fn_mediana_kwh ignora 'rampa': mediana segue 599 (4334,869,329,100)
  IF public.fn_mediana_kwh(h) <> 599 THEN RAISE EXCEPTION 'FALHOU mediana com rampa=%', public.fn_mediana_kwh(h); END IF;

  -- estavel: preenche com a mediana, origem 'mediana'
  h := public.fn_historico_consumo_normalizar('{
    "05":{"kwh":1000,"ref":"2026-05","origem":"cadastro","dias":30},
    "06":{"kwh":1100,"ref":"2026-06","origem":"cadastro","dias":30},
    "07":{"kwh":1000,"ref":"2026-07","origem":"cadastro","dias":30}}'::jsonb);
  IF (h -> '09' ->> 'origem') <> 'mediana' THEN RAISE EXCEPTION 'FALHOU estavel origem=%', h -> '09' ->> 'origem'; END IF;

  -- aplicar sobrescreve mes preenchido por 'rampa'
  h := public.fn_historico_consumo_aplicar('{"09":{"kwh":3467,"ref":null,"origem":"rampa"}}'::jsonb, '2026-09', 4400, 'conta');
  IF (h -> '09' ->> 'kwh')::numeric <> 4400 THEN RAISE EXCEPTION 'FALHOU aplicar sobre rampa'; END IF;
  RAISE EXCEPTION 'SANDBOX_OK';
END $t$;
```

- [ ] **Step 2: Run test to verify it fails**

Rode a migração da Task 2 + este bloco.
Expected: `FALHOU rampa: 0 meses de 8` (a `normalizar` atual preenche com a mediana).

- [ ] **Step 3: Write minimal implementation**

Acrescente ao final da migração:

```sql
-- fn_mediana_kwh: 'rampa' e preenchimento, como 'mediana' (nao entra na mediana).
CREATE OR REPLACE FUNCTION public.fn_mediana_kwh(p_historico jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    WITH v AS (
        SELECT x.kwh
          FROM (SELECT a.kwh
                  FROM (SELECT CASE WHEN (e ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$' THEN (e ->> 'kwh')::numeric END AS kwh,
                               row_number() OVER (PARTITION BY right(e ->> 'mes', 2) ORDER BY e ->> 'mes' DESC) AS rn
                          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_historico) = 'array'
                                                         THEN p_historico ELSE '[]'::jsonb END) e
                         WHERE jsonb_typeof(e) = 'object'
                           AND (e ->> 'mes') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') a
                 WHERE a.rn = 1
                UNION ALL
                SELECT (m.value ->> 'kwh')::numeric
                  FROM jsonb_each(CASE WHEN jsonb_typeof(p_historico) = 'object'
                                       THEN p_historico ELSE '{}'::jsonb END) m
                 WHERE jsonb_typeof(m.value) = 'object'
                   AND COALESCE(m.value ->> 'origem', '') NOT IN ('mediana', 'rampa')
                   AND (m.value ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$') x
         WHERE x.kwh > 0
    ), o AS (
        SELECT kwh, row_number() OVER (ORDER BY kwh) AS rn, count(*) OVER () AS n FROM v
    )
    SELECT round(avg(kwh), 2) FROM o WHERE rn IN ((n + 1) / 2, (n + 2) / 2);
$function$;

-- fn_historico_consumo_aplicar: leitura nova sobrescreve mes preenchido por 'rampa'.
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_aplicar(
    p_historico jsonb, p_ref text, p_kwh numeric, p_origem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_h   jsonb := CASE WHEN jsonb_typeof(p_historico) = 'object' THEN p_historico ELSE '{}'::jsonb END;
    v_k   text;
    v_cur jsonb;
BEGIN
    IF p_ref IS NULL OR p_ref !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR p_kwh IS NULL OR p_kwh < 0 THEN
        RETURN v_h;
    END IF;
    v_k   := right(p_ref, 2);
    v_cur := v_h -> v_k;
    IF jsonb_typeof(v_cur) = 'object'
       AND COALESCE(v_cur ->> 'origem', '') NOT IN ('mediana', 'franquia', 'rampa')
       AND (v_cur ->> 'ref') IS NOT NULL
       AND ((v_cur ->> 'ref') > p_ref
            OR ((v_cur ->> 'ref') = p_ref AND v_cur ->> 'origem' = 'conta' AND p_origem <> 'conta')) THEN
        RETURN v_h;
    END IF;
    RETURN v_h || jsonb_build_object(v_k, jsonb_build_object('kwh', p_kwh, 'ref', p_ref, 'origem', p_origem));
END;
$function$;

-- fn_historico_consumo_normalizar: preenche meses ausentes/zerados com a
-- franquia de rampa (origem 'rampa') quando o perfil esta em rampa; senao, com
-- a mediana (origem 'mediana'). O regime e calculado ANTES do preenchimento.
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_normalizar(p_historico jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_h      jsonb := CASE WHEN jsonb_typeof(p_historico) = 'object' THEN p_historico ELSE '{}'::jsonb END;
    v_med    numeric := public.fn_mediana_kwh(v_h);
    v_reg    jsonb := public.fn_regime_consumo(v_h);
    v_fill   numeric;
    v_origem text := 'mediana';
    v_k      text;
    v_e      jsonb;
BEGIN
    IF v_med IS NULL THEN
        RETURN v_h;
    END IF;
    v_fill := v_med;
    IF v_reg ->> 'regime' = 'em_rampa' THEN
        v_fill   := (v_reg ->> 'franquia_rampa')::numeric;
        v_origem := 'rampa';
    END IF;
    FOR v_k IN SELECT to_char(g, 'FM00') FROM generate_series(1, 12) g LOOP
        v_e := v_h -> v_k;
        CONTINUE WHEN jsonb_typeof(v_e) = 'object'
                  AND COALESCE(v_e ->> 'origem', '') NOT IN ('mediana', 'rampa')
                  AND (v_e ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$'
                  AND (v_e ->> 'kwh')::numeric > 0;
        v_h := v_h || jsonb_build_object(v_k, jsonb_build_object(
                   'kwh', v_fill,
                   'ref', CASE WHEN jsonb_typeof(v_e) = 'object' THEN v_e -> 'ref' ELSE 'null'::jsonb END,
                   'origem', v_origem));
    END LOOP;
    RETURN v_h;
END;
$function$;
```

- [ ] **Step 4: Run test to verify it passes**

Rode a migração (Task 2 + Task 3) + o bloco do Step 1.
Expected: `SANDBOX_OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261127a_conta_em_rampa.sql
git commit -m "feat(consumo): perfil mensal preenchido pela rampa (origem 'rampa')"
```

---

### Task 4: Banco — gravar regime, franquia, base do Start e `fn_aplicar_franquia_sugerida`

**Files:**
- Modify: `supabase/migrations/20261127a_conta_em_rampa.sql` (acrescentar ao final)

**Interfaces:**
- Consumes: `fn_regime_consumo`, `fn_historico_consumo_normalizar` (Tasks 2 e 3).
- Produces: `fn_historico_consumo_gravar_uc(p_uc uuid, p_historico jsonb, p_origem text DEFAULT 'cadastro') RETURNS jsonb` agora com `regime`, `franquia_sugerida` no retorno (junto de `historico`, `mediana`, `start_base_kwh`); grava `dias` por mês, `regime_consumo`, `regime_desde`, `franquia_sugerida`; congela `start_base_kwh` com `franquia_rampa` em rampa; aplica `franquia` só na primeira carga em rampa. `public.fn_aplicar_franquia_sugerida(p_uc uuid) RETURNS numeric` (franquia nova).

- [ ] **Step 1: Write the failing test**

```sql
DO $t$
DECLARE uc uuid; r jsonb; cu record; fr_antes numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT id INTO uc FROM public.consumer_units
   WHERE historico_consumo IS NULL AND start_base_kwh IS NULL AND tipo_unidade IS DISTINCT FROM 'geradora' LIMIT 1;
  IF uc IS NULL THEN RAISE EXCEPTION 'sem UC de teste'; END IF;

  -- 1a carga: caso real -> rampa, franquia 3467, base 3467, perfil com 'rampa'
  r := public.fn_historico_consumo_gravar_uc(uc, '[
    {"mes":"2026-08","kwh":4334,"dias":30},{"mes":"2026-07","kwh":869,"dias":33},
    {"mes":"2026-06","kwh":329,"dias":29},{"mes":"2026-05","kwh":100,"dias":20}]'::jsonb, 'cadastro');
  SELECT * INTO cu FROM public.consumer_units WHERE id = uc;
  IF cu.regime_consumo <> 'em_rampa' THEN RAISE EXCEPTION 'FALHOU regime=%', cu.regime_consumo; END IF;
  IF cu.franquia <> 3467 THEN RAISE EXCEPTION 'FALHOU franquia=%', cu.franquia; END IF;
  IF cu.start_base_kwh <> 3467 THEN RAISE EXCEPTION 'FALHOU base=%', cu.start_base_kwh; END IF;
  IF cu.franquia_sugerida <> 3467 THEN RAISE EXCEPTION 'FALHOU sugerida=%', cu.franquia_sugerida; END IF;
  IF cu.consumo_mediano_kwh <> 599 THEN RAISE EXCEPTION 'FALHOU mediana=%', cu.consumo_mediano_kwh; END IF;
  IF (cu.historico_consumo -> '08' ->> 'dias')::numeric <> 30 THEN RAISE EXCEPTION 'FALHOU dias nao gravados'; END IF;
  IF (cu.historico_consumo -> '11' ->> 'origem') <> 'rampa' THEN RAISE EXCEPTION 'FALHOU perfil sem rampa'; END IF;

  -- 2a carga (conta nova, consumo estabilizou): sai da rampa, franquia NAO muda,
  -- base NAO muda, so a sugestao (mediana dos 3 ultimos ciclos = 4334)
  r := public.fn_historico_consumo_gravar_uc(uc, '[{"mes":"2026-09","kwh":4400,"dias":30}]'::jsonb, 'conta');
  SELECT * INTO cu FROM public.consumer_units WHERE id = uc;
  IF cu.regime_consumo <> 'estavel' THEN RAISE EXCEPTION 'FALHOU regime2=%', cu.regime_consumo; END IF;
  IF cu.franquia <> 3467 THEN RAISE EXCEPTION 'FALHOU franquia2=%', cu.franquia; END IF;
  IF cu.start_base_kwh <> 3467 THEN RAISE EXCEPTION 'FALHOU base2=%', cu.start_base_kwh; END IF;
  IF cu.franquia_sugerida <> 4334 THEN RAISE EXCEPTION 'FALHOU sugerida2=%', cu.franquia_sugerida; END IF;
  IF (cu.historico_consumo -> '11' ->> 'origem') <> 'mediana' THEN RAISE EXCEPTION 'FALHOU perfil2 sem mediana'; END IF;

  -- aplicar a sugestao
  IF public.fn_aplicar_franquia_sugerida(uc) <> 4334 THEN RAISE EXCEPTION 'FALHOU aplicar'; END IF;
  SELECT franquia INTO fr_antes FROM public.consumer_units WHERE id = uc;
  IF fr_antes <> 4334 THEN RAISE EXCEPTION 'FALHOU franquia aplicada=%', fr_antes; END IF;
  RAISE EXCEPTION 'SANDBOX_OK';
END $t$;
```

- [ ] **Step 2: Run test to verify it fails**

Rode a migração (Tasks 2 e 3) + este bloco.
Expected: `column "regime_consumo"` não é gravado / `FALHOU regime=` nulo (a função atual não grava regime), ou `function fn_aplicar_franquia_sugerida does not exist`.

- [ ] **Step 3: Write minimal implementation**

Acrescente ao final da migração:

```sql
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_gravar_uc(
    p_uc uuid, p_historico jsonb, p_origem text DEFAULT 'cadastro')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_cu      record;
    v_h       jsonb;
    v_e       jsonb;
    v_mes     text;
    v_k       text;
    v_med     numeric;
    v_base    numeric;
    v_reg     jsonb;
    v_regime  text;
    v_primeira boolean;
    v_franq   numeric;
    v_sug     numeric;
BEGIN
    IF p_origem IS NULL OR p_origem NOT IN ('cadastro', 'conta') THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: origem "%" invalida (cadastro | conta)', p_origem
            USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_historico) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: p_historico precisa ser o array do leitor [{"mes":"AAAA-MM","kwh":N}]'
            USING ERRCODE = '22023';
    END IF;

    SELECT cu.id, cu.historico_consumo, cu.start_base_kwh, cu.franquia, cu.regime_consumo, cu.regime_desde INTO v_cu
      FROM public.consumer_units cu WHERE cu.id = p_uc FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: UC % inexistente', p_uc USING ERRCODE = 'P0002';
    END IF;

    v_primeira := v_cu.historico_consumo IS NULL OR v_cu.historico_consumo = '{}'::jsonb;
    v_h := COALESCE(v_cu.historico_consumo, '{}'::jsonb);
    -- historico real chegou: o preenchimento por franquia (backfill sem dado) sai
    IF public.fn_mediana_kwh(p_historico) IS NOT NULL THEN
        SELECT COALESCE(jsonb_object_agg(m.key, m.value), '{}'::jsonb) INTO v_h
          FROM jsonb_each(v_h) m
         WHERE COALESCE(m.value ->> 'origem', '') <> 'franquia';
    END IF;
    -- kwh ilegivel conta como 0 (o mes fica e recebe o preenchimento)
    FOR v_e IN SELECT e FROM jsonb_array_elements(p_historico) e
                WHERE jsonb_typeof(e) = 'object'
                  AND (e ->> 'mes') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
                ORDER BY e ->> 'mes' LOOP
        v_mes := v_e ->> 'mes';
        v_h := public.fn_historico_consumo_aplicar(v_h, v_mes,
                   CASE WHEN (v_e ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_e ->> 'kwh')::numeric ELSE 0 END,
                   p_origem);
        -- dias do ciclo: so quando a leitura entrou no perfil (ref igual)
        v_k := right(v_mes, 2);
        IF (v_e ->> 'dias') ~ '^[0-9]+(\.[0-9]+)?$' AND (v_e ->> 'dias')::numeric > 0
           AND (v_h -> v_k ->> 'ref') = v_mes THEN
            v_h := jsonb_set(v_h, ARRAY[v_k, 'dias'], to_jsonb((v_e ->> 'dias')::numeric));
        END IF;
    END LOOP;

    v_reg    := public.fn_regime_consumo(v_h);
    v_regime := v_reg ->> 'regime';
    v_h      := public.fn_historico_consumo_normalizar(v_h);
    v_med    := public.fn_mediana_kwh(v_h);
    IF v_h = '{}'::jsonb THEN
        v_h := v_cu.historico_consumo;
    END IF;

    -- franquia sugerida
    v_sug := CASE
        WHEN v_regime = 'em_rampa' THEN (v_reg ->> 'franquia_rampa')::numeric
        WHEN v_regime = 'em_queda' THEN (v_reg ->> 'franquia_janela')::numeric
        WHEN v_regime = 'estavel' AND v_cu.regime_consumo = 'em_rampa' THEN (v_reg ->> 'franquia_janela')::numeric
        ELSE NULL END;

    -- primeira carga em rampa: a franquia do cadastro (derivada da mediana) e trocada
    v_franq := v_cu.franquia;
    IF v_primeira AND v_regime = 'em_rampa' THEN
        v_franq := v_sug;
    END IF;

    -- base do Start: congelada uma unica vez; em rampa, com a franquia de rampa (opcao C)
    v_base := v_cu.start_base_kwh;
    IF v_base IS NULL AND v_med > 0 THEN
        v_base := CASE WHEN v_regime = 'em_rampa' THEN (v_reg ->> 'franquia_rampa')::numeric ELSE v_med END;
        UPDATE public.consumer_units
           SET historico_consumo = v_h, consumo_mediano_kwh = v_med,
               start_base_kwh = v_base, start_base_em = now(),
               franquia = v_franq, franquia_sugerida = v_sug,
               regime_consumo = v_regime,
               regime_desde = CASE WHEN v_cu.regime_consumo IS DISTINCT FROM v_regime THEN now() ELSE v_cu.regime_desde END
         WHERE id = p_uc;
    ELSE
        UPDATE public.consumer_units
           SET historico_consumo = v_h, consumo_mediano_kwh = v_med,
               franquia = v_franq, franquia_sugerida = v_sug,
               regime_consumo = v_regime,
               regime_desde = CASE WHEN v_cu.regime_consumo IS DISTINCT FROM v_regime THEN now() ELSE v_cu.regime_desde END
         WHERE id = p_uc;
    END IF;

    RETURN jsonb_build_object('historico', v_h, 'mediana', v_med, 'start_base_kwh', v_base,
                              'regime', v_regime, 'franquia_sugerida', v_sug);
END;
$function$;

-- Equipe aplica a franquia sugerida (botao Aplicar). Nao mexe na base do Start.
CREATE OR REPLACE FUNCTION public.fn_aplicar_franquia_sugerida(p_uc uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_sug numeric;
BEGIN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR COALESCE(public.fn_papel_interno(), false)
            OR session_user = 'postgres') THEN
        RAISE EXCEPTION 'fn_aplicar_franquia_sugerida: sem permissao' USING ERRCODE = '42501';
    END IF;
    SELECT franquia_sugerida INTO v_sug FROM public.consumer_units WHERE id = p_uc FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_aplicar_franquia_sugerida: UC % inexistente', p_uc USING ERRCODE = 'P0002';
    END IF;
    IF v_sug IS NULL THEN
        RAISE EXCEPTION 'fn_aplicar_franquia_sugerida: UC sem franquia sugerida' USING ERRCODE = '22023';
    END IF;
    UPDATE public.consumer_units SET franquia = v_sug WHERE id = p_uc;
    RETURN v_sug;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_aplicar_franquia_sugerida(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_franquia_sugerida(uuid) TO authenticated, service_role;
```

`fn_gravar_historico_consumo` (RPC `authenticated`, com gate) já delega a `fn_historico_consumo_gravar_uc`; não muda.

- [ ] **Step 4: Run test to verify it passes**

Rode a migração completa (Tasks 2 a 4) + o bloco do Step 1 numa única `execute_sql`.
Expected: `SANDBOX_OK`. Rode também `select pg_get_functiondef('public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,integer,text,text,text,text)'::regprocedure)` e confira que ainda chama `fn_historico_consumo_gravar_uc(v_uc_id, v_uc -> 'historico', 'cadastro')` (assinatura inalterada).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261127a_conta_em_rampa.sql
git commit -m "feat(consumo): rampa grava regime, franquia sugerida e base do Start (opção C)"
```

---

### Task 5: Tela — regime, franquia sugerida e botão Aplicar

**Files:**
- Modify: `src/lib/historicoConsumo.js` (constante `ORIGENS_HISTORICO`)
- Modify: `src/components/HistoricoConsumo.jsx`

**Interfaces:**
- Consumes: colunas `regime_consumo`, `franquia_sugerida`, `franquia` de `consumer_units`; RPC `fn_aplicar_franquia_sugerida(p_uc)` (retorna numeric); `classificarRegime` da Task 1.
- Produces: no cartão do histórico, selo do regime, cartão "Franquia sugerida × vigente" e botão **Aplicar** (só quando `podeImportar` e sugerida ≠ vigente).

- [ ] **Step 1: Write the failing test**

Crie `src/lib/historicoConsumo.origens.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { ORIGENS_HISTORICO } from './historicoConsumo';

describe('origens do histórico', () => {
    it('tem rótulo para a origem rampa', () => {
        expect(ORIGENS_HISTORICO.rampa).toBe('Preenchido pela rampa');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/historicoConsumo.origens.test.js`
Expected: FAIL (`undefined` não é `'Preenchido pela rampa'`).

- [ ] **Step 3: Write minimal implementation**

3a. `src/lib/historicoConsumo.js`: dentro de `ORIGENS_HISTORICO`, depois de `franquia: 'Preenchido pela franquia',` acrescente:

```js
    rampa: 'Preenchido pela rampa',
```
e no comentário de cabeçalho, na linha `// origem: ...`, acrescente `'rampa' (mês sem leitura de conta em rampa).`

3b. `src/components/HistoricoConsumo.jsx`:

- Import: `import { classificarRegime } from '../lib/regimeConsumo';`
- `CORES_ORIGEM`: acrescente `rampa: { fundo: '#f5f3ff', borda: '#ddd6fe', texto: '#6d28d9', barra: '#8b5cf6' },`
- Barras: troque `opacity: l.origem === 'mediana' || l.origem === 'franquia' ? 0.55 : 1` por `opacity: ['mediana', 'franquia', 'rampa'].includes(l.origem) ? 0.55 : 1`.
- Query: troque o `.select(...)` por `'historico_consumo, consumo_mediano_kwh, start_base_kwh, start_base_em, regime_consumo, franquia_sugerida, franquia'`.
- Estado e ação (depois de `const [importando, setImportando] = useState(false);`):

```jsx
    const [aplicando, setAplicando] = useState(false);

    const aplicarSugestao = async () => {
        const ok = await showConfirm(
            `Aplicar a franquia sugerida de ${fmtKwh(dados?.franquia_sugerida)} (hoje ${fmtKwh(dados?.franquia)})? Se o contrato já foi assinado, a mudança da franquia exige aditivo.`,
            'Aplicar franquia sugerida',
            'Aplicar',
            'Cancelar'
        );
        if (!ok) return;
        setAplicando(true);
        const { error } = await supabase.rpc('fn_aplicar_franquia_sugerida', { p_uc: ucId });
        setAplicando(false);
        if (error) { showAlert(error.message || 'Falha ao aplicar a franquia.', 'error'); return; }
        showAlert('Franquia atualizada.', 'success');
        await carregar();
    };
```

- Texto da confirmação de importação: troque a montagem de `mediana`/`showConfirm` em `importarDaConta` por:

```jsx
            const perfil = montarPerfil(historico, 'cadastro');
            const mediana = medianaDoPerfil(perfil);
            const reg = classificarRegime(historico);
            const aviso = reg.regime === 'em_rampa'
                ? ` Consumo em crescimento: a UC entra em rampa, com franquia de ${fmtKwh(reg.franquiaRampa)} e base do Start nesse valor (se ainda não estiver fixada).`
                : ` A base do Start fica fixada nessa mediana, se ainda não estiver.`;
            const ok = await showConfirm(
                `A conta traz ${historico.length} mês(es) de histórico, mediana de ${fmtKwh(mediana)}.${aviso} Gravar como histórico de consumo desta UC?`,
                'Importar histórico de consumo',
                'Gravar histórico',
                'Cancelar'
            );
```

- Cartões: depois do `<Cartao titulo="Base do Start" ... />` (dentro do mesmo `div` flex) acrescente:

```jsx
                        {dados?.regime_consumo && (
                            <Cartao
                                titulo="Regime do consumo"
                                valor={{ em_rampa: 'Em rampa', em_queda: 'Em queda', estavel: 'Estável', insuficiente: 'Histórico curto' }[dados.regime_consumo] || dados.regime_consumo}
                                nota={dados.regime_consumo === 'em_rampa'
                                    ? 'Consumo crescendo: a franquia segue o consumo recente'
                                    : dados.regime_consumo === 'em_queda' ? 'Consumo caindo: revise a franquia' : null}
                            />
                        )}
                        {dados?.franquia_sugerida != null && Number(dados.franquia_sugerida) !== Number(dados.franquia) && (
                            <Cartao
                                titulo="Franquia sugerida"
                                valor={fmtKwh(dados.franquia_sugerida)}
                                nota={`Franquia atual: ${fmtKwh(dados.franquia)}`}
                            />
                        )}
```

- Botão, logo depois do `div` dos cartões:

```jsx
                    {podeImportar && dados?.franquia_sugerida != null && Number(dados.franquia_sugerida) !== Number(dados.franquia) && (
                        <div>
                            <button
                                type="button"
                                disabled={aplicando}
                                onClick={aplicarSugestao}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', cursor: aplicando ? 'wait' : 'pointer' }}
                            >
                                {aplicando ? <RefreshCw size={15} className="animate-spin" /> : null}
                                Aplicar franquia sugerida ({fmtKwh(dados.franquia_sugerida)})
                            </button>
                        </div>
                    )}
```

- Nota de rodapé: troque a frase "Meses zerados ou ausentes recebem a mediana dos meses com consumo." por "Meses zerados ou ausentes recebem a mediana dos meses com consumo (ou, em rampa, a franquia de rampa)."

- [ ] **Step 4: Run tests and build**

Run: `npx vitest run src/lib/regimeConsumo.test.js src/lib/historicoConsumo.origens.test.js`
Expected: PASS.
Run: `NODE_OPTIONS=--max-old-space-size=3072 npx vite build --outDir "$TEMP/rampa_dist"` e depois `rm -rf "$TEMP/rampa_dist"`.
Expected: `built in` sem erros.
Run: `npx eslint src/components/HistoricoConsumo.jsx src/lib/regimeConsumo.js src/lib/historicoConsumo.js`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/historicoConsumo.js src/lib/historicoConsumo.origens.test.js src/components/HistoricoConsumo.jsx
git commit -m "feat(consumo): regime, franquia sugerida e botão Aplicar no histórico da UC"
```

---

### Task 6: Verificação ponta a ponta e implantação

**Files:**
- Modify: `docs/superpowers/specs/2026-11-26-conta-em-rampa-design.md` (item 4: `c_ult > 1,25 × c_penúltimo`; item 6: primeira carga aplica, depois só sugere)

- [ ] **Step 1: Ajustar a spec**

Na tabela do item 4, troque `c_ult > c_penúltimo` por `c_ult > 1,25 × c_penúltimo`. No item 6, troque "Antes da assinatura (UC em ativação sem contrato enviado), aplica sozinha" por "Na primeira carga do histórico (cadastro) a franquia é aplicada sozinha; nas cargas seguintes só é sugerida".

- [ ] **Step 2: Teste de ponta a ponta em transação descartada**

Em uma `execute_sql`: migração completa + bloco `DO` do Task 4, Step 1 (já cobre: primeira carga, saída da rampa, aplicar). Expected: `SANDBOX_OK`.

- [ ] **Step 3: Rodar toda a suíte do módulo**

Run: `npx vitest run src/lib/regimeConsumo.test.js src/lib/historicoConsumo.origens.test.js src/lib/capacidade.test.js src/lib/usinasParaVincular.test.js`
Expected: tudo PASS (capacidade e vincular não podem regredir).

- [ ] **Step 4: Abrir o PR**

```bash
git add docs/superpowers/specs/2026-11-26-conta-em-rampa-design.md
git commit -m "docs(spec): conta em rampa — ajustes da implementação"
git push -u origin HEAD
gh pr create --base main --title "feat(consumo): conta em rampa (regime, franquia sugerida, base do Start)" --body "Implementa a spec 2026-11-26-conta-em-rampa. Migração 20261127a. Aplicar a migração ANTES de mesclar (a tela chama fn_aplicar_franquia_sugerida e lê colunas novas)."
```

- [ ] **Step 5: Implantar (com autorização do dono)**

1. Aplicar `20261127a_conta_em_rampa.sql` em produção (`apply_migration`).
2. Conferir: `select regime_consumo, count(*) from consumer_units group by 1` (tudo nulo até a próxima conta gravada) e `select proname from pg_proc where proname in ('fn_regime_consumo','fn_aplicar_franquia_sugerida')`.
3. Mesclar o PR (republica o CRM) e conferir o bundle novo com `curl` e cache-busting.
4. Teste real: cadastrar uma UC nova com uma conta de histórico curto e crescente (ou importar a conta pelo botão do histórico numa UC sem perfil) e conferir regime, franquia, base do Start e a origem `rampa` nos meses sem leitura.

## Fora desta versão (registrado)

- Teto físico (carga instalada, demanda, consumo declarado) — opcional na spec.
- Backfill das UCs existentes: elas ganham regime na próxima conta gravada. Para reavaliar uma UC antes disso, reimporte a conta pelo botão do histórico.
- Alerta ativo para sugestão fora de ±30 % da franquia vigente (spec, item 6.3): nesta versão a sugestão aparece como cartão e botão no histórico da UC, sem aviso proativo.
- Selo de regime na lista de UCs.
- Mobile e Edge Functions: já mandam o `historico` (PR 156); a regra roda no banco, sem mudança neles.
