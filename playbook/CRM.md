# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### 👥 Gestão de Assinantes (Subscribers)
Controle do ciclo de vida dos clientes e visão 360º (Unidades, Faturas, Anexos).
- **Listagem (Dashboard)**: Tabela densa com filtros temporais dinâmicos e KPIs de performance (Financeira e Leituras).
- **SubscriberModal**: Navegação por abas e gestão detalhada de faturas e UCs.

### ⚡ Gestão de Unidades Consumidoras (UCs)
Módulo para acompanhamento técnico e monitoramento de leituras.

### 💰 Gestão de Faturas (Billing)
Faturamento mensal, integração bancária (Asaas) e envio de faturas.

### 📢 Sistema de Notificações (Multicanal)
Automação de envio de faturas via **E-mail (Resend)** e **WhatsApp (Evolution API)**.

---

## 2. Gatilhos e Automações (Triggers)

### A. Gatilhos de Notificação (Híbridos)
O sistema realiza o disparo coordenado e atômico nos seguintes eventos:
| Evento | Ação | Canais |
| :--- | :--- | :--- |
| **Emissão Consolidada** | Envio de PDF Combinado | E-mail + WhatsApp |
| **Download PDF/Fatura** | Envio de cópia/link imediato | E-mail + WhatsApp |

### B. Gatilhos de Status e Inteligência
- **Inadimplência**: 15 dias -> **Inadimplente** | 60 dias -> **Cancelamento Crítico (Vinho)**.
- **Leitura Automática**: Sucesso marcado se houver fatura no mês/ano selecionado para as UCs vinculadas.

---

## 3. Regras de Negócio e Segurança

### 🚦 Roteamento de Notificações (Sandbox vs Produção)
Baseado no ambiente da integração financeira (Asaas):
| Ambiente | Destino E-mail | Destino WhatsApp |
| :--- | :--- | :--- |
| **Modo Sandbox** | `waldineygodoy@gmail.com` | **Telefone de Teste** (Salvo em Settings) |
| **Modo Produção** | E-mail do Perfil | Celular do Perfil |

### 📦 Composição e Documentos
- **PDF Mesclado**: Demonstrativo B2W + Boleto Asaas (Página Final). Enviado via `sendMedia` da Evolution API v2.
- **Formatação WhatsApp**: Uso de Markdown (`*negrito*`, emojis) via helper `sendInvoiceNotifications`.

### ⚖️ Visibilidade por Modalidade
- **Auto Consumo**: Pagamento e Calendário de Energia **visíveis**.
- **Geração Compartilhada**: Pagamento e calendário **ocultos** (responsabilidade do cliente).

---

## 4. Padrões de Layout e UX

### 📊 Listagem de Assinantes (Dashboard Modernizado)
- **Filtro Temporal**: Seletor de Mês/Ano no topo para recalcular indicadores do grid.
- **Densidade de Dados**: Coluna única agrupada para **Nome, CPF/CNPJ, E-mail e Telefone**.
- **Novos Indicadores**:
    - **Total no Mês**: Soma das faturas no período selecionado.
    - **Total a Pagar**: Saldo devedor histórico (Global).
    - **Leitura**: Progresso operacional (Ex: `2/5` lidas).

### 📐 SubscriberModal (Tabs & Sticky)
- **Navegação**: Menu superior em abas com ícones e cabeçalhos fixos (`sticky`).
- **Layout**: `maxWidth: 1600px` para visualização em alta densidade.

---

## 5. Identidade Visual (Cores e Símbolos)

### Indicador de Boleto (Ícone CreditCard)
Representa a saúde financeira do assinante no mês selecionado:
- 🔴 **Vermelho**: Inadimplente no mês (sem boleto gerado).
- 🔵 **Azul**: Boleto consolidado emitido e aguardando pagamento.
- 🟢 **Verde**: Faturas do mês quitadas.

### Status de Assinantes (Kanban)
| Status | Label | Cor Hex |
| :--- | :--- | :--- |
| `ativacao` | **ATIVAÇÃO** | `#0ea5e9` |
| `ativo` | **ATIVO** | `#22c55e` |
| `ativo_inadimplente` | **ATIVO INAD.** | `#f59e0b` |
| `cancelado_inadimplente` | **CANC. INAD.** | `#b91c1c` |
| `cancelado` | **CANCELADO** | `#ef4444` |

### Indicadores de Leitura (Cards UC)
- ✅ Sucesso | 🌀 Lendo (Spin) | ⚠️ Erro | 🕒 Pendente

---

## 6. Rastreabilidade (Logs do CRM)
Toda interação é unificada na tabela `crm_history`:
- **Log de Envio**: `"Fatura enviada ao e-mail {email} e whatsapp {phone}"`.
- **Metadados**: Registro interno de `email_status` e `wa_status` para auditoria técnica.
