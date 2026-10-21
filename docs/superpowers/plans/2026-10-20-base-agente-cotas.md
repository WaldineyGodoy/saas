# Base do Agente Cotas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Base de conhecimento do Agente Cotas (FAQ + documento "Usinas com cotas" gerado do CRM), campo "Cotas vendidas" na usina e nova versão do agente.

**Architecture:** Mesmo padrão das bases do Investidor e da Assinatura: a `deskcomm-base` sincroniza as fontes por categoria; o documento sai de uma RPC e se atualiza pelo gatilho de usinas já existente; o roteiro vai numa versão nova publicada por script SQL idempotente.

**Tech Stack:** Postgres/Supabase, Edge Function Deno (`deskcomm-base`), React (`PowerPlantModal.jsx`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-base-agente-cotas-design.md`

## Global Constraints

- Worktree `C:\Users\Godoy\Documents\HTML\wt-cotas`, branch `feat/base-agente-cotas`. Produção (`abbysvxnnhwvvzhftoms`) só com aprovação do usuário.
- 10 cotas por usina. Preço da cota = `round(valor_investido / 10 × 1,1)`. Retorno: "entre 1,8% e 2% ao mês, a depender do mês de geração", antes de impostos, com a ressalva do Investidor.
- Associação dos cotistas já formada: quem compra se associa e recebe título de propriedade da cota. Pagamento somente à vista.
- Documento só com usinas `a_venda`, `modelo_venda = 'cotas'`, status fora de (`cancelada`, `inativa`) e `cotas_vendidas < 10`. Nunca nomes de cotistas nem dado pessoal.
- Gatilhos nunca bloqueiam gravação. Horários ao usuário em Brasília.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261021b_base_agente_cotas.sql` (novo) | Coluna `cotas_vendidas`, RPC `ponte_deskcomm_usinas_cotas`, chaves em `fontes_base`, gatilho de usinas com a coluna nova. |
| `supabase/tests/usinas_cotas.test.sql` (novo) | Teste em transação desfeita. |
| `supabase/functions/deskcomm-base/bases/cotas-faq.ts` (novo) | FAQ fixo (14 pares). |
| `supabase/functions/deskcomm-base/bases/investidor-faq.ts` | Pergunta da cota sem "R$ 35.000". |
| `supabase/functions/deskcomm-base/montar.ts` | `montarUsinasCotas`, `SEM_COTAS`, `UsinaCotas`. |
| `supabase/functions/deskcomm-base/index.ts` | Conteúdos `cotas_faq` e `usinas_cotas` (categoria `cotas`). |
| `tests/deskcomm-base.test.ts` | Testes do montador e dos FAQs. |
| `src/components/PowerPlantModal.jsx` | Campo "Cotas vendidas (de 10)". |
| `scripts/deskcomm/base_cotas.sql` (novo) | Versão nova do Agente Cotas. |
| `scripts/deskcomm/base_investidor.sql` | Inclui a fonte `usinas_cotas`. |
| `playbook/DESKCOMM.md` | §7 e §8.4. |

---

### Task 1: Migration

**Files:** Create `supabase/migrations/20261021b_base_agente_cotas.sql`, `supabase/tests/usinas_cotas.test.sql`

**Interfaces:**
- Produces: `usinas.cotas_vendidas smallint` (0–10); `public.ponte_deskcomm_usinas_cotas() returns table(nome text, cidade text, uf text, status text, previsao_entrega date, valor_investido numeric, cotas_vendidas smallint, short_url text)`, só `service_role`; chaves `cotas_faq` e `usinas_cotas` em `ponte_deskcomm.fontes_base`.

- [ ] **Step 1: Teste SQL**

```sql
-- Sandbox: usinas com cotas (spec 2026-10-20-base-agente-cotas-design.md §4.2, §7.2).
-- Rodar depois da migration 20261021b; tudo é desfeito no RAISE final.
DO $t$
DECLARE n int; v_nomes text;
BEGIN
  UPDATE usinas SET a_venda = false;
  INSERT INTO usinas (name, status, a_venda, modelo_venda, valor_investido, cotas_vendidas) VALUES
    ('Cota Livre', 'pre_operacao', true, 'cotas', 315000, 3),
    ('Cota Esgotada', 'pre_operacao', true, 'cotas', 315000, 10),
    ('Integral', 'pre_operacao', true, 'integral', 315000, 0),
    ('Fora de Venda', 'pre_operacao', false, 'cotas', 315000, 0),
    ('Cancelada', 'cancelada', true, 'cotas', 315000, 0);
  SELECT count(*), string_agg(nome, ',') INTO n, v_nomes FROM public.ponte_deskcomm_usinas_cotas();
  IF n <> 1 OR v_nomes <> 'Cota Livre' THEN RAISE EXCEPTION 'FALHOU filtro: % %', n, v_nomes; END IF;
  IF (SELECT cotas_vendidas FROM public.ponte_deskcomm_usinas_cotas()) <> 3 THEN RAISE EXCEPTION 'FALHOU vendidas'; END IF;
  BEGIN
    UPDATE usinas SET cotas_vendidas = 11 WHERE name = 'Cota Livre';
    RAISE EXCEPTION 'FALHOU check aceitou 11';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM ponte_deskcomm.fontes_base WHERE chave IN ('cotas_faq', 'usinas_cotas')) <> 2 THEN
    RAISE EXCEPTION 'FALHOU chaves'; END IF;
  RAISE EXCEPTION 'SANDBOX_OK';
END
$t$;
```

- [ ] **Step 2: Rodar e ver falhar** (`execute_sql`): erro de coluna `cotas_vendidas` inexistente.

- [ ] **Step 3: Migration**

```sql
-- =====================================================================
-- Base do Agente Cotas (spec docs/superpowers/specs/2026-10-20-base-agente-cotas-design.md §5.1)
--   1. usinas.cotas_vendidas: contador manual (0 a 10) ate existir o
--      cadastro de cotistas.
--   2. ponte_deskcomm_usinas_cotas: dados do documento "Usinas com cotas".
--   3. Chaves cotas_faq e usinas_cotas em ponte_deskcomm.fontes_base.
--   4. trg_ponte_usinas_base passa a reagir a cotas_vendidas.
-- =====================================================================

alter table public.usinas
    add column if not exists cotas_vendidas smallint not null default 0
        constraint usinas_cotas_vendidas_check check (cotas_vendidas between 0 and 10);
comment on column public.usinas.cotas_vendidas is
    'Cotas vendidas de 10 (modelo_venda = cotas). Contador manual ate existir o cadastro de cotistas; alimenta "Usinas com cotas" no Deskcomm.';

create or replace function public.ponte_deskcomm_usinas_cotas()
returns table(nome text, cidade text, uf text, status text, previsao_entrega date,
              valor_investido numeric, cotas_vendidas smallint, short_url text)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select u.name, u.address->>'cidade', u.address->>'uf', u.status::text, u.previsao_entrega,
           u.valor_investido, u.cotas_vendidas, u.short_url
      from usinas u
     where u.a_venda
       and u.modelo_venda = 'cotas'
       and u.cotas_vendidas < 10
       and u.status::text not in ('cancelada', 'inativa')
$$;
revoke all on function public.ponte_deskcomm_usinas_cotas() from public, anon, authenticated;
grant execute on function public.ponte_deskcomm_usinas_cotas() to service_role;

insert into ponte_deskcomm.fontes_base (chave) values ('cotas_faq'), ('usinas_cotas')
on conflict (chave) do nothing;

drop trigger if exists trg_ponte_usinas_base on public.usinas;
create trigger trg_ponte_usinas_base
    after insert or delete or update of a_venda, previsao_entrega, modelo_venda, status, name, address,
        potencia_kwp, potencia_inversor_w, modalidade_gd, modalidade, valor_investido, short_url, cotas_vendidas
    on public.usinas
    for each row execute function ponte_deskcomm.fn_usina_para_base();
```

- [ ] **Step 4: Ensaio sem efeito** — rodar migration + teste numa só chamada `execute_sql` (o RAISE final desfaz tudo). Esperado: `SANDBOX_OK`. Conferir depois que a coluna não existe.
- [ ] **Step 5: Commit** `feat(deskcomm): cotas vendidas na usina e RPC das usinas com cotas`.

---

### Task 2: Fontes da base

**Files:** Create `bases/cotas-faq.ts`; Modify `bases/investidor-faq.ts`, `montar.ts`, `index.ts`, `tests/deskcomm-base.test.ts`

**Interfaces:**
- Consumes: RPC `ponte_deskcomm_usinas_cotas()` (Task 1).
- Produces: `montarUsinasCotas(usinas: UsinaCotas[]): string`, `SEM_COTAS`, `FAQ_COTAS`; fontes "Cotas — Perguntas e respostas" e "Usinas com cotas".

- [ ] **Step 1: Testes** — em `tests/deskcomm-base.test.ts`, importar `montarUsinasCotas, SEM_COTAS, type UsinaCotas` e `FAQ_COTAS` de `bases/cotas-faq`, e acrescentar:

```ts
const cotaSantaMaria: UsinaCotas = {
    nome: 'UFV Santa Maria', cidade: 'Santa Maria', uf: 'RN', status: 'pre_operacao',
    previsao_entrega: '2026-12-01', valor_investido: 315000, cotas_vendidas: 3,
    short_url: 'https://link.b2wenergia.com.br/ufvsantamariausina',
}

describe('montarUsinasCotas', () => {
    it('monta preço da cota, cotas livres, pagamento e link', () => {
        const md = montarUsinasCotas([cotaSantaMaria])
        expect(md).toContain('## UFV Santa Maria — Santa Maria/RN')
        expect(md).toContain('Estágio: em obra (pré-operação) · Previsão de entrega: dez/2026')
        expect(md).toContain('Preço da cota: R$ 34.650 (usina R$ 315.000 ÷ 10 + 10%)')
        expect(md).toContain('Cotas livres: 7 de 10')
        expect(md).toContain('Pagamento: somente à vista')
        expect(md).toContain('Página da usina: https://link.b2wenergia.com.br/ufvsantamariausina')
    })
    it('sem preço e sem link saem como "a confirmar com o consultor"', () => {
        const md = montarUsinasCotas([{ ...cotaSantaMaria, valor_investido: 0, short_url: null, previsao_entrega: null }])
        expect(md).toContain('Preço da cota: a confirmar com o consultor')
        expect(md).toContain('Página da usina: a confirmar com o consultor')
        expect(md).toContain('Previsão de entrega: a confirmar com o consultor')
    })
    it('esgotada, cancelada ou lista vazia → aviso', () => {
        expect(montarUsinasCotas([])).toBe(SEM_COTAS)
        expect(montarUsinasCotas([{ ...cotaSantaMaria, cotas_vendidas: 10 }])).toBe(SEM_COTAS)
        expect(montarUsinasCotas([{ ...cotaSantaMaria, status: 'cancelada' }])).toBe(SEM_COTAS)
    })
    it('ordena pela previsão e não carrega campo fora do contrato', () => {
        const md = montarUsinasCotas([
            { ...cotaSantaMaria, nome: 'B', previsao_entrega: null },
            { ...cotaSantaMaria, nome: 'A', previsao_entrega: '2026-11-01', cpf: '529.982.247-25' } as UsinaCotas,
        ])
        expect(md.indexOf('## A')).toBeLessThan(md.indexOf('## B'))
        expect(md).not.toContain('529.982')
    })
})

describe('FAQ de Cotas', () => {
    it('tem as 14 perguntas aprovadas e respeita as proibições', () => {
        expect(lerFaq(FAQ_COTAS)).toHaveLength(14)
        const tudo = FAQ_COTAS.toLowerCase()
        for (const proibido of ['garantid', 'risco zero', 'blindad', '100% segur', 'parcel', 'financiamento', 'multa']) {
            expect(tudo, proibido).not.toContain(proibido)
        }
        expect(tudo).toContain('somente à vista')
        expect(tudo).toContain('1,8% a 2% ao mês')
        expect(tudo).toContain('título de propriedade')
    })
    it('o FAQ do Investidor não cita mais R$ 35.000', () => {
        expect(FAQ_INVESTIDOR).not.toContain('35.000')
        expect(FAQ_INVESTIDOR).toContain('dividido por 10, mais 10%')
    })
})
```

- [ ] **Step 2: Rodar e ver falhar:** `npx vitest run tests/deskcomm-base.test.ts`.

- [ ] **Step 3: `bases/cotas-faq.ts`** — export `FAQ_COTAS` com os 14 pares da spec §4.1 (texto aprovado, já com as ressalvas de 20/10/2026), no formato `## Pergunta:` / `## Resposta:`; o 14º é cópia literal de "Quem é a B2W Energia? Posso visitar uma usina?" de `investidor-faq.ts`.

- [ ] **Step 4: `investidor-faq.ts`** — trocar a resposta de "Dá para comprar só uma parte?" por: "Sim, por cotas: o preço da usina dividido por 10, mais 10% de taxa, que cobre a estruturação jurídica da associação e a gestão da divisão do repasse. Os valores por usina estão em \"Usinas com cotas\"."

- [ ] **Step 5: `montar.ts`**

```ts
export interface UsinaCotas {
    nome: string
    cidade: string | null
    uf: string | null
    status: string
    previsao_entrega: string | null
    valor_investido: number | null
    cotas_vendidas: number
    short_url: string | null
}

export const SEM_COTAS =
    '# Usinas com cotas\n\nNo momento não há cota disponível; o consultor avisa quando a próxima abrir.\n'

function blocoCotas(u: UsinaCotas) {
    const local = [u.cidade, u.uf].filter(Boolean).join('/')
    const usina = Number(u.valor_investido) || 0
    const preco = usina > 0
        ? `R$ ${numero(Math.round(usina / 10 * 1.1))} (usina R$ ${numero(usina)} ÷ 10 + 10%)`
        : A_CONFIRMAR
    return [
        `## ${u.nome}${local ? ` — ${local}` : ''}`,
        `Estágio: ${ESTAGIO[u.status] ?? u.status} · Previsão de entrega: ${mesAno(u.previsao_entrega)}`,
        `Preço da cota: ${preco}`,
        `Cotas livres: ${10 - Number(u.cotas_vendidas)} de 10`,
        'Pagamento: somente à vista',
        `Página da usina: ${u.short_url || A_CONFIRMAR}`,
    ].join('\n')
}

/** Documento "Usinas com cotas". Só usina válida e com cota livre; ordem pela previsão. */
export function montarUsinasCotas(usinas: UsinaCotas[]): string {
    const validas = usinas.filter((u) => u.status in ESTAGIO && Number(u.cotas_vendidas) < 10)
    if (validas.length === 0) return SEM_COTAS
    const ordenadas = [...validas].sort((a, b) =>
        (a.previsao_entrega ?? '9999').localeCompare(b.previsao_entrega ?? '9999') || a.nome.localeCompare(b.nome))
    return '# Usinas com cotas\n\n' + ordenadas.map(blocoCotas).join('\n\n') + '\n'
}
```

(`numero`, `ESTAGIO`, `mesAno` e `A_CONFIRMAR` já existem em `montar.ts`.) Conferência: `Math.round(315000 / 10 * 1.1) = 34650`.

- [ ] **Step 6: Rodar os testes** — PASS.

- [ ] **Step 7: `index.ts`** — importar `montarUsinasCotas, type UsinaCotas` e `FAQ_COTAS`; `Conteudo.chave` ganha `'cotas_faq' | 'usinas_cotas'` e `categoria` ganha `'cotas'`; em `montarConteudos`, ler `lerFaq(FAQ_COTAS)` (incluir na checagem de `faq_vazio`), chamar `ponte_deskcomm_usinas_cotas` (erro → `cotas_ilegiveis`) e acrescentar:

```ts
        { chave: 'cotas_faq', categoria: 'cotas', tipo: 'faq', nome: 'Cotas — Perguntas e respostas', texto: JSON.stringify(paresCot), pares: paresCot },
        { chave: 'usinas_cotas', categoria: 'cotas', tipo: 'documento', nome: 'Usinas com cotas', texto: montarUsinasCotas((cotas ?? []) as UsinaCotas[]) },
```

Mensagem de fonte recriada: `cotas` → `base_cotas.sql`. Comentário do topo: acrescentar as duas fontes de Cotas.

- [ ] **Step 8: Suíte inteira** (`npx vitest run`) e commit `feat(deskcomm-base): fontes da base do Agente Cotas`.

---

### Task 3: Campo "Cotas vendidas" na usina

**Files:** Modify `src/components/PowerPlantModal.jsx` (estado inicial ~l.401, leitura ~l.1119, payload ~l.3356, aba Contratos ~l.5600)

- [ ] **Step 1:** estado inicial `cotas_vendidas: 0,` depois de `modelo_venda: 'integral',`; leitura `cotas_vendidas: usina.cotas_vendidas ?? 0,`; payload `cotas_vendidas: formData.modelo_venda === 'cotas' ? Math.min(10, Math.max(0, parseInt(formData.cotas_vendidas, 10) || 0)) : 0,`.
- [ ] **Step 2:** depois do `<div>` de "Modelo de venda", com o mesmo estilo:

```jsx
                                    {formData.modelo_venda === 'cotas' && (
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>Cotas vendidas (de 10)</label>
                                            <input
                                                type="number" min="0" max="10" step="1"
                                                style={{ width: '100%', padding: '0.65rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' }}
                                                value={formData.cotas_vendidas ?? 0}
                                                onChange={e => setFormData({ ...formData, cotas_vendidas: e.target.value })}
                                            />
                                        </div>
                                    )}
```

- [ ] **Step 3:** `npx vite build` sem erro; commit `feat(usinas): cotas vendidas na aba Contratos`.

---

### Task 4: Scripts dos agentes

**Files:** Create `scripts/deskcomm/base_cotas.sql`; Modify `scripts/deskcomm/base_investidor.sql`

- [ ] **Step 1: `base_cotas.sql`** — copiar a estrutura de `base_assinatura.sql`: categoria `cotas`, fontes `cotas_faq` + `usinas_cotas`, sem ferramenta nova (idempotência: prompt e fontes), origem `base_cotas`, mesmo `v_comum`. `v_roteiro`:

```
Você atende quem quer comprar COTAS de usina solar da B2W Energia.
Objetivo: explicar a cota, informar o preço e as cotas livres e levar o cliente ao consultor para fechar.

Use a busca na base de conhecimento (crm_search_knowledge) antes de responder qualquer pergunta sobre o produto. Os fatos estão em "Cotas — Perguntas e respostas" e "Usinas com cotas". Responda com o que estiver lá; se não estiver, diga que vai confirmar com o consultor e passe para humano.

Roteiro:
1. Entenda o interesse: quanto pretende investir ou quantas cotas; pessoa física ou empresa.
2. Explique o modelo em até 3 frases: a usina é dividida em 10 cotas; quem compra se associa à associação dos cotistas, que já está formada, e recebe o título de propriedade da cota; a associação recebe o repasse da B2W e divide entre os cotistas, 1/10 do repasse líquido para cada cota.
3. Ofereça: consulte "Usinas com cotas" e envie o preço da cota e o link da página da usina com cota livre.
4. Números que você pode citar, sempre como estão na base: o preço da cota de cada usina e a projeção de 1,8% a 2% ao mês, a depender do mês de geração. Toda vez que citar retorno, diga junto: "é uma projeção, não garantia: varia com a geração anual, a tarifa da concessionária e o estágio da obra; é antes de impostos."
5. Com valor e usina definidos, passe para humano (crm_request_human_handoff) com o motivo "fechar cota". O pagamento é somente à vista.

Payback, TIR e rentabilidade ano a ano são apresentados pelo consultor. Não calcule nem estime.
Nunca diga "garantido", "risco zero", "blindado" ou "100% seguro". Não ofereça parcelamento nem financiamento. Não fale de multa ou retenção. Não cite preço que não esteja em "Usinas com cotas". Nunca diga o nome de outros cotistas.

Desvios:
- Quer investir o valor de uma usina inteira ou mais: explique que dá para comprar a usina inteira e passe para humano com o motivo "quer usina inteira — funil Usinas de Investimento".
- Quer abater a própria conta de luz: explique que a cota é investimento; para ter desconto, ele faz uma adesão separada como assinante da Energia por Assinatura, com o imóvel na área da mesma distribuidora.
- Nenhuma usina com cota livre: diga que o consultor avisa quando abrir a próxima, grave lista_espera = true e passe para humano.
- Tributação: "a associação repassa a cada cotista; a tributação é orientada pelo contador."

Etapas: informou valor e interesse → "Qualificando". Recebeu preço e link → "Simulação / Proposta enviada". Quer fechar → "Contrato enviado" (passe para humano).
```

- [ ] **Step 2: `base_investidor.sql`** — fontes `where chave in ('investidor_faq', 'usinas_a_venda', 'usinas_cotas')`, mínimo 3; roteiro: no desvio da cota, trocar "(a partir de R$ 35.000, 1/10 da usina)" por "(preço da usina dividido por 10, mais 10%; valores em \"Usinas com cotas\")".
- [ ] **Step 3:** commit `feat(deskcomm): roteiro e base do Agente Cotas`.

---

### Task 5: Produção (com aprovação do usuário)

- [ ] Aplicar a migration (`apply_migration` `20261021b_base_agente_cotas`) e rodar o teste SQL (esperado `SANDBOX_OK`).
- [ ] Publicar `deskcomm-base`; ensaio (`{"ensaio": true}`): 6 conteúdos, `cotas_faq` com 14 pares, `usinas_cotas` com o aviso de sem cota; sincronizar; conferir `success` em `cotas_faq`, `usinas_cotas` e `investidor_faq` (reindexado).
- [ ] Rodar `base_cotas.sql` e `base_investidor.sql`; conferir versões publicadas com as fontes.
- [ ] Merge publica o front (GitHub Pages); conferir o campo na aba Contratos.

### Task 6: Documentação e PR

- [ ] `playbook/DESKCOMM.md`: arquivos na §7 e §8.4 (fontes, contador manual, preço, pendências: cadastro de cotistas e split por cota). Estado da spec → implementado.
- [ ] Suíte, commit, push, PR para `main`.
