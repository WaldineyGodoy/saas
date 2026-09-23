# Planos e Serviços - Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o submenu "Planos e Serviços" no topo das configurações com 3 seções (Energia por Assinatura, Eletropostos, Usinas), modal de criação de planos de assinatura com regras de recompensa (Start, Recorrente, Híbrido), persistência no Supabase e deploy no Git.

**Architecture:** Tabela dedicada `planos_assinatura_energia` com colunas estruturadas e JSONB para regras de comissionamento; componentes React modulares em `src/pages/settings/` (`PlansServicesSettings.jsx` e `PlanModal.jsx`); inserção no topo da barra de configurações em `SettingsLayout.jsx`.

**Tech Stack:** React, Tailwind / CSS-in-JS, Lucide React, Supabase PostgreSQL, Git.

**Spec:** `docs/superpowers/specs/2026-09-23-planos-e-servicos-design.md`

## Global Constraints
- Foco exclusivo nas tabelas e componentes do módulo solicitado sem vincular a nenhuma entidade existente (sem chaves estrangeiras com subscribers/usinas).
- Item no topo absoluto do submenu lateral em Configurações.
- Suporte a 3 modalidades de recompensas: Start (faturas 1, 2 e/ou 3 elegíveis com percentuais individuais por papel), Recorrente (vigência em meses e percentuais fixos) e Híbrido (Start + Recorrência iniciando após o último ciclo do Start, sem sobreposição).
- Fazer commit e push no git para visualização no ambiente de deploy.

---

### Task 1: Supabase Database Migration
**Files:**
- Supabase SQL execution on project `abbysvxnnhwvvzhftoms`
- Migration file: `supabase/migrations/20260923_create_planos_assinatura_energia.sql`

- [ ] **Passo 1: Criar arquivo de migração SQL local**
- [ ] **Passo 2: Executar SQL no Supabase via MCP execute_sql**
- [ ] **Passo 3: Verificar criação da tabela e colunas**

---

### Task 2: Componente do Modal de Criação/Edição (`PlanModal.jsx`)
**Files:**
- Create: `src/pages/settings/components/PlanModal.jsx`

- [ ] **Passo 1: Implementar estrutura do modal com campos Nome e Desconto (%)**
- [ ] **Passo 2: Implementar seletor visual de recompensas (Start, Recorrente, Híbrido)**
- [ ] **Passo 3: Implementar bloco Start com checkboxes para Faturas 1, 2, 3 e percentuais individuais por papel**
- [ ] **Passo 4: Implementar bloco Recorrente com meses elegíveis e percentuais por papel**
- [ ] **Passo 5: Implementar lógica de não-sobreposição do Híbrido com aviso visual explicativo**
- [ ] **Passo 6: Implementar handlers de validação e salvamento no Supabase**

---

### Task 3: Componente Principal de Configurações (`PlansServicesSettings.jsx`)
**Files:**
- Create: `src/pages/settings/PlansServicesSettings.jsx`

- [ ] **Passo 1: Criar layout com as 3 abas horizontais (Energia por Assinatura, Eletropostos, Usinas)**
- [ ] **Passo 2: Criar placeholders limpos para Eletropostos e Usinas**
- [ ] **Passo 3: Implementar listagem/grid de planos da aba Energia por Assinatura com status e badges**
- [ ] **Passo 4: Integrar abertura do modal de criação e edição**
- [ ] **Passo 5: Implementar alternância de status ativo/inativo e exclusão**

---

### Task 4: Inserção no Topo de Configurações (`SettingsLayout.jsx`)
**Files:**
- Modify: `src/pages/dashboards/SettingsLayout.jsx`

- [ ] **Passo 1: Adicionar "Planos e Serviços" no topo do array `menuItems` (posição 0)**
- [ ] **Passo 2: Mapear aba `plans` para renderizar `<PlansServicesSettings />`**

---

### Task 5: Build & Verificação
- [ ] **Passo 1: Executar build do projeto (`npm run build`) para verificar integridade de imports e sintaxe**
- [ ] **Passo 2: Resolver eventuais inconsistências**

---

### Task 6: Commit e Deploy no Git
- [ ] **Passo 1: Verificar git status e git diff**
- [ ] **Passo 2: Fazer git commit com mensagem semântica**
- [ ] **Passo 3: Fazer git push para a branch main no origin**
