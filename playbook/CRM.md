# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### 👥 Gestão de Assinantes (Subscribers)
Controle do ciclo de vida dos clientes, integrando dados cadastrais, técnicos (UCs) e financeiros (Faturas).
- **Vistas**: Kanban (Status automatizado), Lista (Exportação) e Busca Inteligente (Nome/CPF/CNPJ).
- **Recursos**: Boleto Consolidado (`CreditCard`), Edição Centralizada e Gestão de Anexos.

### ⚡ Gestão de Unidades Consumidoras (UCs)
Módulo para acompanhamento técnico das unidades integradas às concessionárias.
- **Vistas**: Lista, Kanban e Calendário de Leituras (Filtrado por `Auto Consumo Remoto`).

### 💰 Gestão de Faturas (Billing)
Lançamento e acompanhamento de faturas mensais e integração bancária.

---

## 2. Gatilhos e Automações (Triggers)

### A. Gatilhos de Status (Assinantes)
Diferente das UCs, o status do assinante é **recalculado automaticamente** pelo sistema:

| Evento | Condição | Ação |
| :--- | :--- | :--- |
| **Inadimplência (15 dias)** | Fatura `atrasado` > 15 dias | Move para **Ativo Inadimplente**. |
| **Inadimplência (60 dias)** | Fatura `atrasado` > 60 dias | Move para **Cancelado Inadimplente**. |
| **Recuperação de Crédito** | Pagamento de faturas pendentes | Reavalia UCs e volta para **Ativo**. |
| **Ativação Técnica** | Mudança de 1ª UC para `ativo` | Move assinante de `ativacao` para **Ativo**. |
| **Cancelamento Total** | Todas as UCs em `cancelado` | Status final do assinante muda para **Cancelado**. |

### B. Gatilhos de Operação (Geral)
| Evento | Ação | Resultado |
| :--- | :--- | :--- |
| **Botão 'CreditCard'** | Consolidação de débitos | Gera cobrança única no Asaas com todas as faturas pendentes. |
| **Botão 'Pagar'** | Edge Function `pay-asaas-bill` | **Exclusivo `Auto Consumo Remoto`**. Paga concessionária via saldo B2W. |
| **Botão 'Extrair Faturas'** | Dispara Scraper | Inicia coleta nos portais e muda cor no calendário para **Azul**. |

---

## 3. Regras de Negócio e Filtragem

### ⚖️ Responsabilidade Financeira e Visibilidade
- **Auto Consumo Remoto**: B2W paga a concessionária. Botões de pagamento **visíveis**. Calendário de energia **ativo**.
- **Geração Compartilhada**: Assinante paga a concessionária. Botões de pagamento **ocultos**. Calendário de energia **oculto**.
- **Boleto Asaas**: Sempre disponível para cobrança da taxa de serviço/gestão.

### 🛡️ Lógica Temporal e Estabilidade
- **Criação de UC**: Unidades só aparecem no calendário/estatísticas a partir do seu `created_at`.
- **Banco de Dados**: Coluna de modalidade deve ser referenciada como `modalidade` (não `modalidade_consumo`).

---

## 4. Padrões de Layout e UX

### 📐 Estrutura
- **Largura Máxima**: Telas de gestão otimizadas para `maxWidth: 1600px`.
- **Calendários**: Grid de **7 colunas** (Segunda a Domingo) com `min-height` fixo nas células.
- **Truncamento**: Uso de `ellipsis` e `nowrap` para manter cards e listas limpos.

### 👥 Interface de Assinantes
- **Cards do Kanban**: Exibição obrigatória de Nome (negrito), CPF/CNPJ, Cidade e Data de Criação.
- **Tipografia**: Nome em negrito com documentos secundários em `fontSize: 0.8rem`.

---

## 5. Identidade Visual (Cores)

### Status de Assinantes (Kanban)
| Status | Label | Cor Hex | Significado |
| :--- | :--- | :--- | :--- |
| `ativacao` | **ATIVAÇÃO** | `#0ea5e9` | Cadastro ou análise documental. |
| `ativo` | **ATIVO** | `#22c55e` | Operação normal e adimplente. |
| `ativo_inadimplente` | **ATIVO INAD.** | `#f59e0b` | Atraso > 15 dias. |
| `cancelado_inadimplente` | **CANC. INAD.** | `#b91c1c` | Atraso crítico > 60 dias. |
| `cancelado` | **CANCELADO** | `#ef4444` | Encerramento total de vínculos. |
| `transferido` | **TRANSFERIDO** | `#64748b` | Imune a automações (Manual).|

### Status de Unidades Consumidoras (Kanban)
*Mesmas cores de faturas e leituras, com ênfase no progresso técnico.*
(Consulte a seção de UCs para detalhes: Azul, Ouro, Verde, Slate, Laranja, Vermelho, Vinho).

### Calendário de Leituras (Contextual)
- **Sucesso**: 🟢 `#22c55e` | **N/D**: ⚪ `#94a3b8` | **Pendente**: 🟠 `#f97316` | **Erro**: 🔴 `#ef4444` | **Processando**: 🔵 `#3b82f6`
