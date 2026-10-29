# Base da Helena (Gestora) Implementation Plan

> **For agentic workers:** execute task by task (inline). Steps use checkbox syntax.

**Goal:** dar à Helena uma base de conhecimento (FAQ + planos vigentes gerados do CRM) e as regras do fornecedor.

**Architecture:** igual à base da Bel: duas fontes mantidas pela Edge Function `deskcomm-base`, gatilho em `planos_usina` e Helena v7 publicada por script cirúrgico.

**Tech Stack:** Postgres (Supabase), Deno Edge Function, vitest.

Spec: `docs/superpowers/specs/2026-10-25-base-helena-gestora-design.md`.

## Global Constraints
- Nenhum número no FAQ; números só do documento gerado do plano ativo.
- Campos fora do contrato de `montarGestoraPlanos` (recuperação, retenção, multas) nunca entram.
- Migration e publicação só depois de ensaio em transação desfeita.
- Persona da Helena preservada (alteração cirúrgica).

## Tasks
- [x] **Task 1 — Testes e montagem.** `tests/deskcomm-base.test.ts` (FAQ da Gestora, `montarGestoraPlanos`), `bases/gestora-faq.ts`, `montar.ts` (`PlanoGestora`, `SEM_PLANOS_GESTORA`, `montarGestoraPlanos`), `index.ts` (duas fontes, categoria `comercializadora`, script `base_helena.sql`). Verificação: `npx vitest run tests/deskcomm-base.test.ts` → 43 passando.
- [ ] **Task 2 — Migration.** Ensaiar `20261025a_gestora_helena.sql` com `begin … rollback` (colunas, gatilho, RPC só `service_role`, 2 linhas em `fontes_base`); aplicar.
- [ ] **Task 3 — Deploy e sincronização.** `npx supabase functions deploy deskcomm-base --project-ref abbysvxnnhwvvzhftoms`; ensaio `{"ensaio": true}`; execução real; conferir as fontes indexadas e que não há número no FAQ nem campo fora do contrato no documento.
- [ ] **Task 4 — Helena v7.** Ensaiar `scripts/deskcomm/base_helena.sql` em transação desfeita; aplicar; conferir prompt (persona, bloco, trechos trocados), fontes, ferramentas, intenções do roteador e `ai_agents.published_version_id`.
- [ ] **Task 5 — Documentação e PR.** `playbook/DESKCOMM.md` §8.6, memória, commit, PR.
