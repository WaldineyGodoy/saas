# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### 👥 Gestão de Assinantes (Subscribers)
Controle do ciclo de vida dos clientes e visão 360º (Unidades, Faturas, Anexos).
- **Interface**: Navegação por **Abas Superiores** (Dados, Endereço, UCs, Faturas).
- **Recursos**: Saldo Global Devedor ("Total a Pagar"), Boleto Consolidado e Timeline de Atividades.

### ⚡ Gestão de Unidades Consumidoras (UCs)
Módulo para acompanhamento técnico e monitoramento de leituras.

### 💰 Gestão de Faturas (Billing)
Faturamento mensal, integração bancária (Asaas) e envio de faturas.

### 📧 Sistema de Notificações (E-mail)
Automação de envio de faturas detalhadas via **Resend** e **Supabase Edge Functions**.

---

## 2. Gatilhos e Automações (Triggers)

### A. Gatilhos de E-mail (Transacionais)
| Evento | Ação | Conteúdo |
| :--- | :--- | :--- |
| **Emissão Consolidada** | Disparo automático via Edge Function | E-mail com Detalhamento B2W + Boleto Asaas (Anexo Único). |
| **Download de Fatura** | Geração e envio imediato | Cópia da fatura enviada para o e-mail do assinante. |

### B. Gatilhos de Status (Assinantes)
- **Inadimplência**: 15 dias -> **Inadimplente** | 60 dias -> **Cancelamento Crítico (Vinho)**.
- **Reativação**: Automática após compensação bancária e reavaliação de unidades.

---

## 3. Regras de Negócio e Segurança

### 🚦 Roteamento de E-mail (Sandbox vs Produção)
Para segurança nos testes de faturamento:
- **Modo Sandbox**: Se a API do Asaas estiver em Teste, os envios são desviados para `waldineygodoy@gmail.com`.
- **Modo Produção**: Envios seguem para o e-mail cadastrado no perfil do assinante.

### 📦 Composição do PDF Combinado
O sistema anexa um único arquivo PDF mesclado contendo:
1. **Páginas 1+**: Demonstrativo Detalhado (Gerado pelo CRM).
2. **Página Final**: Boleto registrado no Asaas.

### ⚖️ Responsabilidade Financeira e Visibilidade
- **Auto Consumo Remoto**: B2W paga a concessionária. Pagamentos e Calendário de Energia **visíveis**.
- **Geração Compartilhada**: Assinante paga a concessionária. Botões de pagamento e calendário **ocultos**.

---

## 4. Padrões de Layout e UX

### 📐 SubscriberModal (Modernizado)
- **Navegação**: Menu Superior em **Abas** com ícones coloridos para identificação rápida.
- **Filtros e Ações**: Posicionados à esquerda (Seletor de Mês/Ano, Botão Emitir).
- **Resumo Financeiro**: Posicionado em boxes à direita ("Total a Pagar Global" e "Total no Mês").
- **Sticky UI**: Filtros e cabeçalhos fixos no topo durante o scroll longo.
- **Large Layout**: `maxWidth: 1600px` para máxima produtividade.

### ⚡ Cards de Unidades (Visão Modal)
- **Compacto**: Exibição de Dia de Leitura e Status em linha.
- **Indicadores de Leitura**: 
    - ✅ **Sucesso**: Fatura processada.
    - 🌀 **Lendo**: Extração em curso.
    - ⚠️ **Erro**: Falha técnica.
    - 🕒 **Pendente**: Prazo de leitura já passou.

---

## 5. Identidade Visual (Cores e Símbolos)

### Status de Assinantes (Kanban)
| Status | Label | Cor Hex |
| :--- | :--- | :--- |
| `ativacao` | **ATIVAÇÃO** | `#0ea5e9` (Azul) |
| `ativo` | **ATIVO** | `#22c55e` (Verde) |
| `ativo_inadimplente` | **ATIVO INAD.** | `#f59e0b` (Âmbar) |
| `cancelado_inadimplente` | **CANC. INAD.** | `#b91c1c` (Vinho) |
| `cancelado` | **CANCELADO** | `#ef4444` (Vermelho) |
| `transferido` | **TRANSFERIDO** | `#64748b` (Cinza) |

### Calendário de Leituras (Contextual)
- **Sucesso**: 🟢 `#22c55e` | **N/D**: ⚪ `#94a3b8` | **Pendente**: 🟠 `#f97316` | **Erro**: 🔴 `#ef4444`

---

## 6. Rastreabilidade (Logs do CRM)
Toda interação é registrada na tabela `crm_history`:
- **Ação**: `email_sent` (Com detalhes de sandbox, ID da fatura e destino).
- **Ação**: Alteração de Status, Emissão de Boleto, etc.
