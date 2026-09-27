# Status do fornecedor e Pré-Operação da usina — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fornecedor com cinco status derivados das assinaturas e do status da usina; usina ganha Pré-Operação.

**Architecture:** O banco calcula tudo. `fn_supplier_status_calculado(uuid)` é pura (só SELECT) e pode ser testada sem escrever nada. `fn_recalculate_supplier_status` grava o resultado. A Autentique e as telas só gravam **datas** (`suppliers.contrato_assinado_em`, `usinas.compra_venda_assinada_em`), nunca o status. Os gatilhos de recálculo entram só na Fase B, depois de o dono preencher as datas.

**Tech Stack:** Postgres/Supabase (plpgsql), Edge Function Deno (`autentique-webhook`), React/Vite em dois repositórios: CRM = WorkSpace 1 Antigravity; app = WorkSpace 2 Front End.

Spec: `docs/superpowers/specs/2026-09-27-status-fornecedor-usina-pre-operacao-design.md`

## Global Constraints

- Valores de status do fornecedor: `cadastrado`, `contrato_assinado`, `ativacao` (rótulo "Em Ativação"), `ativo`, `inativo`. Default `cadastrado`.
- Valor novo de usina: `pre_operacao` (rótulo "Pré-Operação"), posicionado antes de `em_conexao`, default das usinas novas.
- Usinas que contam para `ativo`: `em_conexao`, `gerando`, `manutencao`.
- `inativo` nunca é escrito nem desfeito pela automação.
- Sem data de assinatura = `NULL`, nunca string vazia.
- DDL em produção é aplicado **pelo dono** no SQL Editor: o classificador barra `apply_migration`. Cada migração é um arquivo em `supabase/migrations/`.
- Nunca push em `main` sem o dono pedir: publica crm.b2wenergia.com.br / app.b2wenergia.com.br.
- Os dois repositórios não têm vitest instalado no CRM. A verificação do front é `npx eslint <arquivo>` (sem aumentar a contagem do arquivo) + `npm run build` + navegador.

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260927b_usina_pre_operacao_enum.sql` (novo) | só o `ALTER TYPE ... ADD VALUE` (não pode dividir transação com o uso do valor) |
| `supabase/migrations/20260927c_status_fornecedor_degraus.sql` (novo) | colunas, CHECK, defaults, backfill, funções de UC e de fornecedor |
| `supabase/migrations/20260927d_gatilhos_status_fornecedor.sql` (novo, Fase B) | gatilhos de recálculo + recálculo de todos |
| `supabase/functions/autentique-webhook/index.ts` | grava a data do contrato certo; não escreve status |
| `src/components/SupplierModal.jsx` (CRM) | status só leitura + "Inativo"; data da Gestão; carimbo `document_type='gestao'` |
| `src/pages/dashboards/SupplierList.jsx` (CRM) | colunas na ordem nova; arrastar só entra/sai de Inativo |
| `src/components/PowerPlantModal.jsx` (CRM) | opção e default Pré-Operação; data da Compra e Venda |
| `src/pages/dashboards/PowerPlantList.jsx` (CRM) | coluna Pré-Operação |
| `src/pages/settings/components/MessageTriggerModal.jsx` (CRM) | listas de status |
| WS2 `src/pages/investidor/format.js`, `InvestorPanel.jsx`, `src/components/SupplierModal.jsx` | rótulo, filtro e status só leitura no app |

---

### Task 1: Migrações da Fase A (banco)

**Files:**
- Create: `supabase/migrations/20260927b_usina_pre_operacao_enum.sql`
- Create: `supabase/migrations/20260927c_status_fornecedor_degraus.sql`

**Interfaces:**
- Produces:
  - `public.fn_supplier_status_calculado(p_supplier_id uuid) returns text` (STABLE, sem escrita);
  - `public.fn_recalculate_supplier_status(p_supplier_id uuid) returns void`;
  - coluna `usinas.compra_venda_assinada_em timestamptz`.

- [ ] **Step 1: Escrever `20260927b`**

```sql
-- Sozinho de proposito: valor novo de enum nao pode ser usado na mesma
-- transacao que o cria. A 20260927c usa.
alter type public.usina_status add value if not exists 'pre_operacao' before 'em_conexao';
```

- [ ] **Step 2: Escrever `20260927c`.** Conteúdo completo:
  - `usinas.status` default `'pre_operacao'`;
  - coluna `compra_venda_assinada_em` + backfill a partir de `signatures`;
  - `suppliers_status_check` com os 5 valores e default `'cadastrado'`;
  - `handle_uc_usina_link`, `handle_usina_status_change` e `handle_invoice_status_change` reescritas iguais às atuais, trocando `= 'em_conexao'` por `IN ('pre_operacao','em_conexao')`;
  - as duas funções de fornecedor.

  Os corpos das três funções de UC são os que estão em produção (lidos com `select prosrc from pg_proc where proname = ...`), mudando só essa comparação.

- [ ] **Step 3: Teste de leitura antes de aplicar.** Rodar pelo `execute_sql` a regra como SELECT puro, com os dados de hoje:

```sql
select s.name,
  case when s.status='inativo' then 'inativo'
       when s.contrato_assinado_em is not null and exists(select 1 from usinas u where u.supplier_id=s.id and u.status::text in ('em_conexao','gerando','manutencao')) then 'ativo'
       when s.contrato_assinado_em is not null then 'ativacao'
       when exists(select 1 from usinas u where u.supplier_id=s.id and u.compra_venda_assinada_em is not null)
         or exists(select 1 from signatures g join usinas u on u.id=g.usina_id where u.supplier_id=s.id and g.document_type='compra_venda' and g.status='signed') then 'contrato_assinado'
       else 'cadastrado' end previsto
from suppliers s order by 1;
```

Esperado:

| Fornecedor | Previsto |
|---|---|
| Rodrigo | `contrato_assinado` |
| Ana Paola, TOBIAS, B2W PROJETOS, NILTON, SOLLARECO | `cadastrado` |

- [ ] **Step 4: Dono aplica** `20260927b` e depois `20260927c` no SQL Editor.

- [ ] **Step 5: Verificar pela função pura (só leitura)**

```sql
select name, status atual, public.fn_supplier_status_calculado(id) calculado from suppliers order by 1;
select column_default from information_schema.columns where table_name='usinas' and column_name='status';
select u.name, u.compra_venda_assinada_em from usinas u where u.compra_venda_assinada_em is not null;
```

Esperado:
- a coluna `calculado` igual ao Step 3;
- o default da usina é `'pre_operacao'::usina_status`;
- Santa Maria e São Vicente com data.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260927b_usina_pre_operacao_enum.sql supabase/migrations/20260927c_status_fornecedor_degraus.sql
git commit -m "feat(db): Pré-Operação da usina e status do fornecedor em cinco degraus"
```

### Task 2: Webhook da Autentique grava a data do contrato certo

**Files:**
- Modify: `supabase/functions/autentique-webhook/index.ts` (bloco `if (sig.signer_type === 'supplier')`, ~linhas 151-182)
- Modify: `src/components/SupplierModal.jsx:443-446` (carimbar `document_type: 'gestao'`)

**Interfaces:**
- Consumes: `usinas.compra_venda_assinada_em` (Task 1); `suppliers.contrato_assinado_em` (existe).

- [ ] **Step 1: Substituir o bloco do fornecedor por:**

```ts
                // Fornecedor: grava a DATA do contrato assinado; o status é
                // calculado no banco (fn_recalculate_supplier_status). Antes
                // qualquer documento — até Compra e Venda — virava "Contrato
                // de Gestão assinado".
                if (sig.signer_type === 'supplier') {
                    const agora = new Date().toISOString();
                    const ehGestao = sig.document_type === 'gestao'
                        || (!sig.document_type && !sig.usina_id);
                    let alvo: string | null = null;

                    if (ehGestao) {
                        const { error } = await supabaseAdmin.from('suppliers')
                            .update({ contrato_assinado_em: agora })
                            .eq('id', sig.signer_id)
                            .is('contrato_assinado_em', null);
                        if (error) { console.error(`Falha ao datar gestão ${sig.signer_id}:`, error); continue; }
                        alvo = 'Contrato de Gestão';
                    } else if (sig.document_type === 'compra_venda' && sig.usina_id) {
                        const { error } = await supabaseAdmin.from('usinas')
                            .update({ compra_venda_assinada_em: agora })
                            .eq('id', sig.usina_id)
                            .is('compra_venda_assinada_em', null);
                        if (error) { console.error(`Falha ao datar compra e venda ${sig.usina_id}:`, error); continue; }
                        alvo = 'Contrato de Compra e Venda';
                    }

                    if (alvo) {
                        promovidos.push(sig.signer_id);
                        await supabaseAdmin.from('crm_history').insert({
                            entity_type: 'supplier',
                            entity_id: sig.signer_id,
                            content: `${alvo} assinado digitalmente.`,
                            metadata: { autentique_doc_id: docId, signature_id: sig.id, document_type: sig.document_type, origem: 'autentique-webhook' }
                        });
                    }
                    continue;
                }
```

- [ ] **Step 2: No `SupplierModal.jsx` do CRM**, o update depois de criar o documento passa a ser `.update({ short_url: finalLink, document_type: 'gestao' })`.

- [ ] **Step 3: Checar o Deno.** Rodar `npx eslint src/components/SupplierModal.jsx` (contagem igual à anterior). Ler o diff do `index.ts` à procura de variáveis não usadas.

- [ ] **Step 4: Deploy da função.** Pelo MCP `deploy_edge_function`; se o classificador barrar, o dono roda `supabase functions deploy autentique-webhook`.

- [ ] **Step 5: Commit**

### Task 3: Telas da usina (CRM)

**Files:**
- Modify: `src/components/PowerPlantModal.jsx:347-353` (statusOptions), `:383` e `:1059` (default), `montarPayloadUsina` (~2585), bloco "Status Operacional" (~2868)
- Modify: `src/pages/dashboards/PowerPlantList.jsx:23-29`

- [ ] **Step 1:** `statusOptions` ganha `{ value: 'pre_operacao', label: 'Pré-Operação' }` como primeiro item. Os dois defaults `'em_conexao'` viram `'pre_operacao'`.

- [ ] **Step 2:** `formData` ganha `compra_venda_assinada_em: ''`. A hidratação usa `usina.compra_venda_assinada_em ? usina.compra_venda_assinada_em.slice(0, 10) : ''`.

- [ ] **Step 3:** No payload, gravar a data **só se mudou**, para não truncar o horário gravado pela Autentique:

```js
            ...((formData.compra_venda_assinada_em || '') !== (usina?.compra_venda_assinada_em?.slice(0, 10) || '')
                ? { compra_venda_assinada_em: formData.compra_venda_assinada_em || null }
                : {}),
```

- [ ] **Step 4:** Depois do `<select>` de status, um `<input type="date">` com o rótulo "Compra e Venda assinada em" e a nota "Preenchido sozinho quando a assinatura é pela Autentique."

- [ ] **Step 5:** `PowerPlantList` `KANBAN_STATUSES` ganha no início `{ status: 'pre_operacao', label: 'Pré-Operação', color: '#6d28d9', bg: '#ede9fe' }`.

- [ ] **Step 6:** Rodar eslint nos 2 arquivos (contagens iguais às de antes) e `npm run build` (OK). Commit.

### Task 4: Telas do fornecedor (CRM)

**Files:**
- Modify: `src/components/SupplierModal.jsx` (formData ~113-150, `montarPayloadFornecedor` ~1145, bloco "Status Operacional" ~1836-1849)
- Modify: `src/pages/dashboards/SupplierList.jsx` (`KANBAN_STATUSES` 21-26, fallbacks 38 e 412, `handleDragEnd` 186-225, card de contagem ~305)

- [ ] **Step 1:** Criar em `SupplierList.jsx`, na ordem nova:

```js
const KANBAN_STATUSES = [
    { status: 'cadastrado', label: 'Cadastrado', color: '#475569', bg: '#f1f5f9' },
    { status: 'contrato_assinado', label: 'Contrato Assinado', color: '#1e40af', bg: '#dbeafe' },
    { status: 'ativacao', label: 'Em Ativação', color: '#854d0e', bg: '#fef9c3' },
    { status: 'ativo', label: 'Ativo', color: '#166534', bg: '#dcfce7' },
    { status: 'inativo', label: 'Inativo', color: '#991b1b', bg: '#fee2e2' }
];
const STATUS_INATIVO = KANBAN_STATUSES[4];
```

Os dois `|| KANBAN_STATUSES[3]` viram `|| STATUS_INATIVO`.

- [ ] **Step 2:** `handleDragEnd`: calculado `newStatus`, só segue se `newStatus === 'inativo' || activeSupplier.status === 'inativo'`. Ao sair de Inativo, grava `'cadastrado'` (o cálculo reposiciona na Fase B). Nos outros casos, `alert('O status do fornecedor é calculado pelos contratos e pelas usinas. Só é possível mover para Inativo ou tirar de Inativo.')` e `return`.

- [ ] **Step 3:** `SupplierModal` do CRM:
  - defaults `'ativacao'` → `'cadastrado'`;
  - `formData` ganha `contrato_assinado_em`, hidratado com `slice(0,10)`;
  - payload grava a data só se mudou (mesmo padrão da Task 3);
  - `status` sai do payload, exceto quando a caixa Inativo mudou.

```js
        ...(formData.status !== (supplier?.status || 'cadastrado')
            ? { status: formData.status }
            : {}),
```

O `<select>` vira:
  - um selo com o rótulo do status;
  - um checkbox "Inativo": marcar → `status: 'inativo'`; desmarcar → volta a `supplier.status` se ele não era inativo, senão `'cadastrado'`;
  - o `<input type="date">` "Contrato de Gestão assinado em".

- [ ] **Step 4:** Rodar eslint nos 2 arquivos (contagens iguais) e build. Commit.

### Task 5: Listas de status das mensagens (CRM)

**Files:** Modify: `src/pages/settings/components/MessageTriggerModal.jsx:90-100`

- [ ] **Step 1:**
  - `supplier` passa a listar `cadastrado` (Cadastrado), `contrato_assinado` (Contrato Assinado), `ativacao` (Em Ativação), `ativo` (Ativo), `inativo` (Inativo). Sai `cancelado`, que o CHECK nunca aceitou.
  - `power_plant` ganha `pre_operacao` (Pré-Operação) no início.
- [ ] **Step 2:** Rodar eslint e build. Commit.

### Task 6: App do investidor (WorkSpace 2)

**Files:**
- Modify: WS2 `src/pages/investidor/format.js:86-91`
- Modify: WS2 `src/pages/investidor/InvestorPanel.jsx:11-16`
- Modify: WS2 `src/components/SupplierModal.jsx:35,58,322,795-800`

- [ ] **Step 1:**
  - `STATUS_USINA` ganha `pre_operacao: { rotulo: 'Pré-operação', tom: 'neutro' }`;
  - `FILTROS` ganha `{ id: 'pre_operacao', rotulo: 'Pré-operação' }` antes de `em_conexao`.
- [ ] **Step 2:** `SupplierModal` do WS2: mesma regra da Task 4 (default `cadastrado`, status fora do payload salvo mudança de Inativo, selo + checkbox no lugar do `<select>`).
- [ ] **Step 3:** Rodar `npm test` (vitest do WS2: suíte verde), eslint nos arquivos (contagens iguais) e build. Commit na branch `feat/status-fornecedor-usina-pre-operacao` do WS2.

### Task 7: Verificação no navegador + publicação (dono decide)

- [ ] Preview local ou, com o aval do dono, produção:
  - kanban da usina com a coluna Pré-Operação;
  - modal da usina mostrando a data da Compra e Venda da Santa Maria;
  - kanban do fornecedor com 5 colunas, e arrastar para fora de Inativo bloqueado;
  - modal do fornecedor com o selo, a caixa Inativo e a data da Gestão.
- [ ] Merge/push só com autorização.

### Task 8 (Fase B — depois que o dono preencher as datas da Gestão)

**Files:** Create: `supabase/migrations/20260927d_gatilhos_status_fornecedor.sql`

- [ ] **Step 1:** Rodar o SELECT da Task 1/Step 5. Esperado:

| Fornecedor | `calculado` |
|---|---|
| TOBIAS, B2W PROJETOS, NILTON, SOLLARECO | `ativo` |
| Rodrigo | `contrato_assinado` |
| Ana Paola | `cadastrado` |

Se algum dos quatro vier diferente, parar e reportar.

- [ ] **Step 2:** Escrever a migração:
  - gatilho AFTER em `suppliers` (`UPDATE OF contrato_assinado_em, status`, só quando mudou e `NEW.status <> 'inativo'`);
  - gatilho AFTER em `usinas` (INSERT, DELETE, `UPDATE OF status, supplier_id, compra_venda_assinada_em`), recalculando o fornecedor novo e o antigo;
  - por fim, `select fn_recalculate_supplier_status(id) from suppliers`.
- [ ] **Step 3:** Dono aplica. Conferir que `status` = `calculado` para todos.
- [ ] **Step 4:** Commit.
