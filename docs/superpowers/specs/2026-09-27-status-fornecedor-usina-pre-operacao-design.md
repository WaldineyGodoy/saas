# Status do fornecedor e Pré-Operação da usina — design

Aprovado pelo dono em 27/09/2026.

## Problema

- O fornecedor virava `contrato_assinado` com **qualquer** documento assinado na Autentique. O Rodrigo foi promovido por duas Compras e Vendas, e o histórico registrou "Contrato de Gestão assinado".
- `fn_recalculate_supplier_status` (19/08) só conhece `ativo`/`ativacao`. Ligada, rebaixaria `contrato_assinado`.
- A usina não tem estado para "em obra". Pré-Operação só existe como regime de arrendamento (`b2w_pre_operacao`).
- A data do contrato de gestão (`suppliers.contrato_assinado_em`) só tem campo no app (WorkSpace 2), não no CRM.

## Status

**Usina** (`usina_status`): `pre_operacao` (novo, default) → `em_conexao` → `gerando` → `manutencao` / `inativa` / `cancelada`.
- Sai de Pré-Operação **à mão**.
- As 10 usinas existentes mantêm o status atual.

**Fornecedor** (`suppliers.status`): `cadastrado` (novo, default) → `contrato_assinado` → `ativacao` (rótulo "Em Ativação") → `ativo` → `inativo`.

## Regra do fornecedor (derivada)

`fn_recalculate_supplier_status(uuid)`, do degrau mais alto para o mais baixo:

| Resultado | Condição |
|---|---|
| (não toca) | status atual `inativo` — decisão do operador |
| `ativo` | `contrato_assinado_em` preenchido **e** alguma usina do fornecedor em `em_conexao`, `gerando` ou `manutencao` |
| `ativacao` | `contrato_assinado_em` preenchido |
| `contrato_assinado` | alguma usina do fornecedor com `compra_venda_assinada_em` preenchido |
| `cadastrado` | nenhum dos anteriores |

- Grava só se `IS DISTINCT FROM` o atual.
- Não exige UC vinculada (regra antiga abandonada por decisão do dono).
- Uma usina que cumpra basta.

## Fontes da assinatura

- **Gestão:** `suppliers.contrato_assinado_em` (existe). Campo "Contrato de Gestão assinado em" no cadastro do fornecedor do CRM.
- **Compra e Venda:** coluna nova `usinas.compra_venda_assinada_em timestamptz`. Campo "Compra e Venda assinada em" no cadastro da usina.
  - Backfill: `signatures` com `signer_type='supplier'`, `document_type='compra_venda'`, `status='signed'` → `updated_at` da assinatura (Santa Maria e São Vicente do Rodrigo).
- **Webhook da Autentique**, ao receber `signed` de fornecedor:
  - `gestao` → `contrato_assinado_em`;
  - `compra_venda` → `compra_venda_assinada_em` da `usina_id`.
  - Só preenche se estiver vazio.
  - Tipo nulo com nome começando por `Contrato_Gestao` conta como gestão.
  - Não escreve mais `suppliers.status`.
- Assinar a Compra e Venda **não muda o status da usina**. Ela já nasce em Pré-Operação, e uma usina mais adiante não regride.

## Efeito nas UCs

`pre_operacao` se comporta como `em_conexao`: as UCs ficam `vinculado`. Isso vale para `handle_uc_usina_link`, `handle_usina_status_change` e `handle_invoice_status_change`.

## Telas

- **CRM (Antigravity):**
  - `PowerPlantList` e `PowerPlantModal`: opção, coluna e default Pré-Operação; campo de data da Compra e Venda.
  - `SupplierList`: coluna Cadastrado, na ordem dos status.
  - `SupplierModal`: default `cadastrado`; status em modo só leitura, com a caixa "Inativo" (desmarcar volta para `cadastrado` e o cálculo reposiciona); campo de data da Gestão.
  - `MessageTriggerModal`: listas de status com os valores novos.
- **App (WorkSpace 2):**
  - rótulo Pré-operação no painel do investidor;
  - default `cadastrado` no `SupplierModal` de lá.

## Entrega em duas fases

- **Fase A:** esquema, funções, webhook e telas. A função de recálculo é reescrita, mas **continua sem gatilho**.
- **O dono preenche** a data da Gestão de TOBIAS, B2W PROJETOS, NILTON e SOLLARECO.
- **Fase B:** gatilhos de recálculo em `suppliers` (`contrato_assinado_em`, saída de `inativo`) e em `usinas` (insert/delete, `status`, `supplier_id`, `compra_venda_assinada_em`); depois, recálculo de todos.

Resultado esperado na Fase B, com as datas preenchidas:
- Rodrigo → `contrato_assinado`;
- Ana Paola → `cadastrado`;
- os outros quatro → `ativo`.

## Fora do escopo

- Mensagem de WhatsApp do fornecedor: desativada pelo dono; o gatilho será revisto por ele.
- `SupplierDashboard.jsx` (decisão anterior do dono).
