# Eletropostos no CRM — cadastro e telas (projeto 1)

Aprovado pelo dono em 29/09/2026.

## Por que

O eletroposto é um misto de usina e assinante:

- **Como usina:** tem fornecedores (investidores), que podem ser mais de um, com divisão do lucro entre eles.
- **Como assinante:** não tem UG. Consome de uma Unidade Consumidora, e essa UC é compensada por uma usina.

Cadeia produtiva: **Usina → compensa energia na UC → UC fornece energia ao eletroposto.**

O que existe em 29/09/2026:

- **Planos:** os planos de eletroposto têm tela em Configurações (`EletropostoPlanModal`) e gravam em `planos_assinatura_energia` com `recorrente_config.categoria_plano = 'eletroposto'`. Hoje há zero planos desse tipo.
- **Entidade e menu:** não existe tabela de eletroposto nem item de menu.
- **Usina:** tem um fornecedor só (`usinas.supplier_id`). O formato de vários beneficiários com percentual já existe em `leased_area_beneficiaries`.

## Escopo

**Projeto 1 (esta spec):** a entidade, os fornecedores com percentual, a UC vinculada (e a usina por ela), o plano, o originador e a tarifa do investidor. Nas telas, entram o menu lateral, o Kanban, a lista e os filtros.

**Projeto 2 (fora desta spec):**

- medição da energia fornecida (B2W Charge / OCPP);
- cadastro de despesas;
- o motor do split do eletroposto;
- os lançamentos no razão.

A base de cálculo definida pelo dono para o projeto 2 é:

> **energia fornecida pelo eletroposto (kWh) × tarifa do investidor (piso) − despesas**

A **hierarquia** (Líder, Parceiro Power) **vincula-se ao eletroposto**, não ao fornecedor.

## Banco

Uma migração: `supabase/migrations/20260929a_eletropostos.sql`. O dono aplica no SQL Editor, porque o `apply_migration` em produção é bloqueado.

### Enum `eletroposto_status`

Os status espelham os da usina e mudam **só à mão**:

`pre_operacao` (padrão) → `em_instalacao` → `operando` → `manutencao` → `inativo` → `cancelado`

| Valor | Rótulo | Significado |
|---|---|---|
| `pre_operacao` | Pré-Operação | contrato ou obra |
| `em_instalacao` | Em Instalação | carregador sendo instalado |
| `operando` | Operando | liberado ao público |
| `manutencao` | Manutenção | parado para reparo |
| `inativo` | Inativo | fora de operação |
| `cancelado` | Cancelado | projeto encerrado |

### Tabela `eletropostos`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `nome` | text not null | |
| `endereco` | jsonb default `'{}'` | mesmo formato de `usinas.address` |
| `status` | `eletroposto_status` not null | default `pre_operacao` |
| `consumer_unit_id` | uuid → `consumer_units(id)` `on delete set null` | **unique**: uma UC atende no máximo um eletroposto |
| `originator_id` | uuid → `originators_v2(id)` `on delete set null` | hierarquia do split |
| `plano_id` | uuid → `planos_assinatura_energia(id)` `on delete set null` | só plano com `categoria_plano = 'eletroposto'` (guarda por gatilho) |
| `tarifa_investidor_kwh` | numeric(10,4) | R$/kWh, piso do investidor; `>= 0` |
| `qtd_carregadores` | integer | `>= 0` |
| `potencia_kw` | numeric | potência por carregador; `>= 0` |
| `tipo_recarga` | text | `AC`, `DC` ou `AC_DC` |
| `fabricante` | text | |
| `modelo` | text | |
| `observacoes` | text | |
| `created_at`, `updated_at` | timestamptz | default `now()`; `updated_at` mantido por gatilho |

A usina **não tem coluna própria**: vem de `consumer_units.usina_id`. Se a UC mudar de usina, o eletroposto acompanha sem ninguém mexer nele.

### Tabela `eletroposto_fornecedores`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `eletroposto_id` | uuid not null → `eletropostos(id)` `on delete cascade` | |
| `supplier_id` | uuid not null → `suppliers(id)` | |
| `percentual` | numeric(5,2) not null | `> 0 and <= 100` |
| `ativo` | boolean default true | |
| `created_at`, `updated_at` | timestamptz | |

- `unique (eletroposto_id, supplier_id)`.
- **Guarda de soma:** um gatilho recusa (`ERRCODE 23514`) quando a soma dos percentuais ativos de um eletroposto passa de 100. Uma soma abaixo de 100 é aceita, porque o cadastro pode estar incompleto; a tela avisa.

### Acesso (RLS)

As duas tabelas têm RLS ligado:

- Os papéis internos (`fn_papel_interno()`) leem e gravam tudo.
- O papel `supplier` só **lê** os eletropostos em que participa, via `eletroposto_fornecedores.supplier_id` → `suppliers.profile_id = auth.uid()` (o mesmo vínculo que o `SupplierDashboard` usa), e as linhas de fornecedores desses eletropostos.
- Ninguém mais tem acesso.

### O que não muda

Nenhum gatilho de UC, usina, fornecedor ou fatura muda, e nenhum lançamento entra no razão. O status do eletroposto não altera o status da UC nem o do fornecedor.

## CRM (WorkSpace 1 Antigravity)

### Menu

`src/pages/Dashboard.jsx` ganha o item `{ id: 'eletropostos', label: 'Eletropostos', icon: 'bi-ev-station' }`:

- fica logo depois de "Usinas";
- aparece para os mesmos papéis (`supplier`, `manager`, `admin`, `super_admin`);
- o `renderContent` ganha o `case 'eletropostos'`.

### `src/pages/dashboards/EletropostoList.jsx`

Segue o padrão da `PowerPlantList`.

- **Alternância Kanban / Lista.**
- **Kanban:** tem as 6 colunas e mudar de coluna arrastando grava o status. O papel `supplier` não arrasta.
- **Card e linha da lista:** nome, cidade/UF, UC, usina, fornecedores e originador.
- **Filtros:** busca (nome, número da UC, cidade), status, usina, fornecedor e originador.
- O botão **"Novo Eletroposto"** abre o modal. O papel `supplier` não vê esse botão.

### `src/components/EletropostoModal.jsx`

Tem quatro abas.

1. **Dados:** nome, endereço, status, plano (só planos de eletroposto), originador e tarifa do investidor (R$/kWh).
2. **UC e Usina:**
   - a busca de UC mostra só as que não estão ligadas a outro eletroposto;
   - a usina da UC e o status dela aparecem só para leitura.
3. **Fornecedores:**
   - adicionar ou remover fornecedor, com o percentual de cada um;
   - o total aparece somado, com um aviso enquanto for diferente de 100%;
   - acima de 100% a tela não deixa salvar.
4. **Técnico:** quantidade de carregadores, potência em kW, tipo de recarga, fabricante e modelo.

**Como salvar:** grava o eletroposto e depois sincroniza os fornecedores. Os fornecedores removidos são apagados e os existentes são atualizados só se algo mudou. Qualquer `{error}` do supabase-js interrompe e é mostrado ao usuário; o supabase-js não lança exceção sozinho.

## Testes

- **SQL** (`supabase/tests/eletropostos.test.sql`): um bloco `DO $$ … $$` terminado em `RAISE EXCEPTION 'SANDBOX_OK'`, rodado pelo `execute_sql` depois que a migração estiver aplicada. Cobre:
  - status padrão `pre_operacao`;
  - UC repetida recusada;
  - plano que não é de eletroposto recusado;
  - soma de percentuais acima de 100 recusada, e 100 exatos aceitos;
  - fornecedor duplicado recusado;
  - `updated_at` atualizado.
- **Tela:** `npm run build`, eslint dos arquivos novos e validação no navegador (criar, editar, arrastar no Kanban, filtrar, apagar o registro de teste).

## Riscos

- **UC sem usina:** o eletroposto mostra "sem usina". Isso é legítimo durante a implantação.
- **O status de `usinas` segue aberto a qualquer usuário logado:** isso está fora desta spec; as tabelas novas já nascem fechadas.
- **Publicação:** o `main` publica o CRM, então o push só com autorização do dono.
