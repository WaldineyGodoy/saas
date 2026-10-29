# Base do Leo: construção sob medida — Plano

> **For agentic workers:** execute inline, task by task.

**Goal:** dar ao Leo a base de conhecimento para atender quem a Helena encaminha com projeto no papel.
**Architecture:** uma fonte FAQ estática na `deskcomm-base`, uma linha em `fontes_base`, Leo v7 por script cirúrgico.
**Spec:** `docs/superpowers/specs/2026-10-25-base-leo-construcao-design.md`.

## Global Constraints
- Nenhum valor de obra; números só os copiados da base do Investidor.
- Persona do Leo preservada; ensaio em transação desfeita antes de publicar.

## Tasks
- [x] **Task 1 — Testes e FAQ.** `tests/deskcomm-base.test.ts`, `bases/construcao-faq.ts`, `index.ts`. 50 testes passando.
- [ ] **Task 2 — Migration e deploy.** Aplicar `20261025b_leo_construcao.sql`; `npx supabase functions deploy deskcomm-base --project-ref abbysvxnnhwvvzhftoms --use-api`; sincronizar; conferir indexação e ausência de R$/kWp.
- [ ] **Task 3 — Leo v7.** Ensaiar `scripts/deskcomm/base_leo_construcao.sql` em transação desfeita; aplicar; conferir prompt, fonte e roteador.
- [ ] **Task 4 — Memória, commit e PR.**
