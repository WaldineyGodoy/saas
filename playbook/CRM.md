# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### Gestão de Unidades Consumidoras (UCs)
Módulo para cadastro e acompanhamento técnico/financeiro das unidades integradas.
- **Vistas**: 
    - **Lista**: Consulta detalhada e exportação com busca por texto.
    - **Kanban**: Gestão do ciclo de vida operacional (Arraste e Solte).
    - **Calendário**: Monitoramento temporal agrupado pelo **Dia de Leitura (1 a 31)**.

### Gestão de Faturas (Billing)
Módulo para lançamento de faturas mensais e acompanhamento de pagamentos.
- **Fluxo**: Recebimento da conta da concessionária -> Lançamento no CRM -> Emissão de boleto Asaas -> Conciliação de pagamento.
- **Ações**: Nova fatura, Edição, Gerar Boleto Asaas, Pagar Conta via Asaas (Saldo conta).

---

## 2. Gatilhos e Automações (Triggers)

| Evento (Trigger) | Ação | Resultado |
| :--- | :--- | :--- |
| **Arrastar Card no Kanban** | Update no Banco (Supabase) | Muda o status da UC em tempo real. |
| **Botão 'Extrair Faturas'** | Dispara Scraper e muda status da UC | Muda a UC no calendário para **Processando (Azul)** até a conclusão. |
| **Botão 'Pagar Conta'** | Supabase Edge Function `pay-asaas-bill` | Agenda pagamento da conta de concessionária e marca fatura como 'Paga'. |
| **Botão 'Gerar Boleto Asaas'** | API `createAsaasCharge` | Cria cobrança no Asaas e gera link de boleto para o cliente. |

---

## 3. Identidade Visual e Simbologia

### Status da Unidade Consumidora (Kanban)
| Status | Label | Cor Hex | Significado |
| :--- | :--- | :--- | :--- |
| `em_ativacao` | Em Ativação | `#3b82f6` (Azul) | Documentação em análise ou envio à concessionária. |
| `aguardando_conexao` | Aguardando Conexão | `#eab308` (Ouro) | UC aprovada, aguardando troca de medidor ou conexão. |
| `ativo` | Ativo | `#22c55e` (Verde) | UC operando normalmente com economia ativa. |
| `sem_geracao` | Sem Geração | `#64748b` (Slate) | UC ativa mas sem créditos de energia no mês. |
| `em_atraso` | Em Atraso | `#f97316` (Laranja) | Fatura pendente de pagamento. |
| `cancelado` | Cancelado | `#ef4444` (Vermelho) | Cancelamento solicitado ou executado. |
| `cancelado_inadimplente` | Cancelado (Inad.) | `#991b1b` (Vinho) | Cancelamento por falta de pagamento. |

### Calendário de Leituras (Monitoramento)
O sistema de cores no calendário é dinâmico para o mês selecionado:

| Status | Cor | Contexto |
| :--- | :--- | :--- |
| **Sucesso** | 🟢 Verde (`#22c55e`) | Fatura extraída e disponível no sistema. |
| **Não Disponível** | ⚪ Cinza (`#94a3b8`) | Data de leitura futura (ciclo ainda não iniciado). |
| **Pendente** | 🟠 Laranja (`#f97316`) | **Data de leitura já passou**, mas a fatura não foi encontrada. |
| **Erro / Atenção** | 🔴 Vermelho (`#ef4444`) | Falha técnica reportada pelo robô de extração. |
| **Processando** | 🔵 Azul (`#3b82f6`) | Extração em curso no momento (animação de giro). |

---

## 4. Regras de Negócio Importantes

### 🛡️ Lógica de Existência Temporal
Para evitar "falsos positivos" de erro em meses retroativos:
1.  **Criação de UC**: Uma unidade só aparece no calendário e estatísticas a partir do mês/ano de registro no campo `created_at`.
2.  **Unidades Inativas**: Apenas unidades com status **Ativo** são exibidas no fluxo de monitoramento de leitura do calendário.

### 📊 Contadores e Estatísticas
- **No Mês**: Reflete o grid visível para o período selecionado.
- **No Ano (Acumulado)**: 
    - **Faturas no Ano**: Soma de leituras com sucesso de Janeiro até o mês selecionado.
    - **Ausentes no Ano**: Soma de faltas/erros ocorridos em meses passados (respeitando a data de criação da UC).

---

## 5. Legendas e Símbolos
- **Ícone de Engrenagem (Girando)**: Indica processo de extração ativa (Scraping).
- **Ticket Check**: Boleto Asaas emitido e disponível no CRM e APP.
- **Ticket Minus**: Aguardando geração de boleto.
