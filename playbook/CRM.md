# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### Gestão de Unidades Consumidoras (UCs)
Módulo para cadastro e acompanhamento técnico/financeiro das unidades integradas.
- **Vistas**: 
    - **Lista**: Consulta detalhada e exportação com busca por texto. Expandida para `maxWidth: 1600px`.
    - **Kanban**: Gestão do ciclo de vida operacional (Arraste e Solte).
    - **Calendário de Leituras**: Monitoramento temporal agrupado pelo **Dia de Leitura (1 a 31)**.

### Gestão de Faturas (Billing)
Módulo para lançamento de faturas mensais e acompanhamento de pagamentos.
- **Fluxo**: Recebimento da conta da concessionária -> Lançamento no CRM -> Emissão de boleto Asaas -> Conciliação de pagamento.
- **Ações**: Nova fatura, Edição, Gerar Boleto Asaas, Pagar Conta via Asaas (Restrito).

---

## 2. Gatilhos e Automações (Triggers)

| Evento (Trigger) | Ação | Resultado |
| :--- | :--- | :--- |
| **Arrastrar Card no Kanban** | Update no Banco (Supabase) | Muda o status da UC/Assinante em tempo real. |
| **Alteração de Fatura (Atraso/Pagamento)** | Gatilho `handle_invoice_status_change` | Recalcula status da UC e do **Assinante** vinculado. |
| **Alteração de Status de UC** | Gatilho `tr_recalculate_subscriber_on_uc_change` | Recalcula status do **Assinante** em tempo real. |
| **Botão 'Extrair Faturas'** | Dispara Scraper e muda status da UC | Muda a UC no calendário para **Processando (Azul)** até a conclusão. |
| **Botão 'Pagar' / 'Pagar Agora'** | Supabase Edge Function `pay-asaas-bill` | **Exclusivo para `Auto Consumo Remoto`**. Agenda pagamento da conta de concessionária e marca fatura como 'Paga'. |
| **Botão 'Gerar Boleto Asaas'** | API `createAsaasCharge` | Cria cobrança no Asaas para o cliente (**Visível para todas as modalidades**). |

---

## 3. Regras de Negócio e Filtragem

### ⚖️ Responsabilidade de Pagamento
O CRM diferencia a responsabilidade financeira com base na modalidade da UC:
- **Auto Consumo Remoto**: A B2W é responsável pelo pagamento da conta de energia. Botões de pagamento ficam **visíveis**.
- **Geração Compartilhada**: O assinante paga a conta diretamente. Botões de pagamento ficam **ocultos** para evitar duplicidade.

### 🗓️ Filtragem do Calendário de Energia
O Calendário de Energia e suas estatísticas de legenda aplicam filtros estritos:
1.  **Status**: Apenas unidades `Ativo`.
2.  **Modalidade**: Apenas unidades `Auto Consumo Remoto`.
*Nota: Faturas de outras modalidades são gerenciadas apenas pela lista geral de faturas.*

### 🛡️ Lógica de Existência Temporal
1.  **Criação de UC**: Uma unidade só aparece no calendário e estatísticas a partir do mês/ano de registro no campo `created_at`.

---

## 4. Padrões de Layout e UX

### 📐 Dimensões e Grid
- **Largura Máxima**: Telas de listagem e gestão expandidas para `1600px` para melhor aproveitamento de monitores widescreen.
- **Grid de Calendário**: Padronizado em **7 colunas fixas** (Segunda a Domingo).
- **Cabeçalho de Dias**: Exibição compacta (SEG, TER, QUA... DOM).
- **Alinhamento**: Células com `min-height` fixo para garantir alinhamento horizontal em todas as linhas.

### 📝 Tipografia e Texto
- **Consistência**: Uso de `white-space: nowrap` e `text-overflow: ellipsis` em nomes de assinantes e números de UC para manter a interface limpa e evitar quebras de layout.

---

## 5. Identidade Visual e Simbologia

### Status da Unidade Consumidora (Kanban)
| Status | Label | Cor Hex | Significado |
| :--- | :--- | :--- | :--- |
| `em_ativacao` | Em Ativação | `#3b82f6` (Azul) | Documentação em análise. |
| `aguardando_conexao` | Aguardando Conexão | `#eab308` (Ouro) | Aprovada, aguardando conexão física. |
| `ativo` | Ativo | `#22c55e` (Verde) | Operação normal. |
| `sem_geracao` | Sem Geração | `#64748b` (Slate) | Ativa mas sem créditos no mês. |
| `em_atraso` | Em Atraso | `#f97316` (Laranja) | Fatura pendente. |
| `cancelado` | Cancelado | `#ef4444` (Vermelho) | Encerrada. |

### Status do Assinante (Kanban Automatizado)
O status do assinante é gerenciado por automação baseada nas UCs e faturas:
| Status | Label | Cor Hex | Regra de Automação |
| :--- | :--- | :--- | :--- |
| `ativacao` | Ativação | `#0ea5e9` | Estado inicial ou UCs em processo de ativação. |
| `ativo` | Ativo | `#22c55e` | Possui ao menos uma UC com status `Ativo`. |
| `ativo_inadimplente` | Ativo Inadimplente | `#f59e0b` | Possui ao menos uma UC com fatura atrasada **> 15 dias**. |
| `cancelado_inadimplente`| Cancelado Inadimplente| `#b91c1c`| Possui ao menos uma UC com fatura atrasada **> 60 dias**. |
| `cancelado` | Cancelado | `#ef4444` | **Todas** as UCs vinculadas estão com status `Cancelado`. |
| `transferido` | Transferido | `#64748b` | Status manual (Protegido contra automação). |

### Calendário de Leituras (Monitoramento)
| Status | Cor | Contexto |
| :--- | :--- | :--- |
| **Sucesso** | 🟢 Verde (`#22c55e`) | Fatura extraída e disponível. |
| **Não Disponível** | ⚪ Cinza (`#94a3b8`) | Ciclo de leitura futuro. |
| **Pendente** | 🟠 Laranja (`#f97316`) | **Leitura atrasada** (data passou e fatura não encontrada). |
| **Erro / Atenção** | 🔴 Vermelho (`#ef4444`) | Falha técnica no robô de extração. |
| **Processando** | 🔵 Azul (`#3b82f6`) | Extração em curso. |

---

## 6. Legendas e Símbolos
- **Ícone de Engrenagem**: Extração ativa (Scraping).
- **Ticket Check**: Boleto Asaas emitido.
- **Ticket Minus**: Aguardando emissão de boleto.
