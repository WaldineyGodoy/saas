# Base do Agente Investidor — Implementation Plan

> **For agentic workers:** executado inline em 20/10/2026 (executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao Agente Investidor do Deskcomm uma base de conhecimento (FAQ + "Usinas à venda" gerada do CRM) e um roteiro novo.

**Architecture:** prompt = comportamento; base = fatos (exigido pela trava de promessas do Deskcomm). A Edge Function `deskcomm-base` grava as fontes direto nas tabelas do Deskcomm (mesmo projeto Supabase), repetindo o que a tela dele faz, depois de conferir o contrato; gatilho em `usinas` + cron de hora em hora disparam a função.

**Tech Stack:** Postgres/Supabase (pg_cron, pg_net, Vault), Edge Function Deno, React (Vite), vitest.

## Global Constraints

- Ressalva fixa: "projeção, não garantia: varia com a geração anual, a tarifa da concessionária e o estágio da obra no momento do aporte; os ~2% são antes do Simples Nacional."
- Nunca: "garantido", "risco zero", "blindado", "100% seguro", multa/retenção de rescisão, arrendamento averbado na matrícula.
- Nada de dado pessoal na base (CPF/CNPJ, dono, credenciais, UCs, endereço completo).
- Não gravar `content_hash` em `ai_knowledge_sources` (o indexador do Deskcomm pula a fonte quando bate).
- RPCs públicas da ponte só para `service_role`.

---

### Task 1: Montador de texto e FAQ

**Files:** Create `supabase/functions/deskcomm-base/montar.ts`, `supabase/functions/deskcomm-base/bases/investidor-faq.ts`; Test `tests/deskcomm-base.test.ts`

**Interfaces — Produces:** `montarUsinasAVenda(usinas: UsinaAVenda[]): string`, `lerFaq(md: string): ParFaq[]`, `hashTexto(t: string): Promise<string>`, `SEM_USINAS`, `FAQ_INVESTIDOR`.

- [x] Testes: bloco completo da usina; Cotas; campo vazio → "a confirmar com o consultor"; nenhuma usina/cancelada/inativa → `SEM_USINAS`; ordem por previsão; campos fora do contrato não vazam; FAQ com 15 pares, sem palavras proibidas e com a ressalva; hash estável.
- [x] Implementação e `npx vitest run tests/deskcomm-base.test.ts` → 10 passed.
- [x] FAQ em `.ts`: a Edge Function não publica `.md` lido com `Deno.readTextFile` (erro "path not found" no primeiro ensaio).

### Task 2: Migration

**Files:** Create `supabase/migrations/20261020b_base_agente_investidor.sql`

**Interfaces — Produces:** `usinas.a_venda/previsao_entrega/modelo_venda`; `ponte_deskcomm.fontes_base`; RPCs `ponte_deskcomm_usinas_a_venda()`, `ponte_deskcomm_agente_da_categoria(text)`, `ponte_deskcomm_fontes_base()`, `ponte_deskcomm_fonte_base_marcar(text, uuid, text)`, `ponte_deskcomm_contrato_base() → text[]`, `ponte_deskcomm_faq_trocar(uuid, uuid, jsonb) → int`, `ponte_deskcomm_emitir_fonte(uuid, uuid, uuid, text)`, `ponte_deskcomm_erro_base(text, text)`; gatilho `trg_ponte_usinas_base`; cron `ponte-deskcomm-base` ('17 * * * *').

- [x] Aplicada em produção (`20261020b_base_agente_investidor`); cron ativo.

### Task 3: Edge Function `deskcomm-base`

**Files:** Create `supabase/functions/deskcomm-base/index.ts`

- [x] Token `x-ponte-token`; `{"ensaio": true}` sem gravar; conferência de contrato; cria fonte se faltar; documento = novo `.md` no bucket `ai-policy` + troca de `blob_path` + remoção do anterior; FAQ = troca transacional de `ai_faq_items`; evento `knowledge_source.updated`; reenvio se a indexação for anterior ao último envio.
- [x] Publicada (`npx supabase functions deploy deskcomm-base`), ensaio 200 (15 pares; sem usina à venda), execução real criou as duas fontes; indexação `success` (15 e 2 trechos).

### Task 4: Campos no modal da usina

**Files:** Modify `src/components/PowerPlantModal.jsx` (estado inicial, carga, payload, cartão "Venda ao investidor" na aba Contratos)

- [x] `npx vitest run` → 390 passed; `npx vite build` ok.

### Task 5: Versão do agente

**Files:** Create `scripts/deskcomm/base_investidor.sql`

- [x] Executado: Agente Investidor v2 publicada com o roteiro, `crm_search_knowledge` e as fontes (mantida "Conversas anteriores").

### Task 6: Documentação e entrega

**Files:** Modify `playbook/DESKCOMM.md` (§7 arquivos, §8.1 base do Investidor e checklist pós-atualização); spec atualizado.

- [x] Commit, push e PR.
- [ ] Teste de conversa pelo WhatsApp (usuário): "qual o retorno?", "qual o payback?", "só tenho 50 mil", "tem usina disponível?" (depois de cadastrar a Santa Maria como à venda).
