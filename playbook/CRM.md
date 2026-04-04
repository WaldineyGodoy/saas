# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### 👥 Gestão de Assinantes (Subscribers)
Controle do ciclo de vida dos clientes e visão 360º.
- **Interface**: Navegação por **Abas Superiores** (Dados, Endereço, UCs, Faturas).
- **Dashboard**: Tabela de alta densidade agrupando Nome, CPF e Contatos em coluna única.
- **KPIs**: Total no Mês, Total a Pagar (Global) e Progresso de Leitura (Ex: `4/5`).

### ⚡ Gestão de Unidades Consumidoras (UCs)
Monitoramento técnico e operacional de leituras.
- **Filtro Temporal**: Seletor de Mês/Ano unificado que controla indicadores em tempo real.

### 💰 Gestão de Faturas (Billing)
Faturamento mensal, integração bancária e automação de cobrança.

---

## 2. Gatilhos e Automações (Triggers)

### A. Mensageria Híbrida (Notificações)
| Evento | Ação de Automação | Destino |
| :--- | :--- | :--- |
| **Emissão / Download** | Disparo simultâneo e atômico | **E-mail (Resend) + WhatsApp (Evolution)** |

### B. Gestão de Inadimplência
- **15 dias de atraso**: Move assinante para **Ativo Inadimplente (Âmbar)**.
- **60 dias de atraso**: Move assinante para **Cancelado Inadimplente (Vinho)**.

### C. PDF Composto
- O sistema une o Demonstrativo B2W ao Boleto Asaas em um único anexo enviado ao cliente.

---

## 3. Regras de Negócio e Segurança

### 🚦 Sandbox Seguro (Roteamento)
Se o modo sandbox estiver ativo na integração financeira:
- **E-mails**: Desviados para `waldineygodoy@gmail.com`.
- **WhatsApp**: Desviado para o **Telefone de Teste** fixo nas configurações.

### ⚖️ Visibilidade por Modalidade
- **Auto Consumo**: Botões de pagamento e calendário de energia **visíveis**.
- **Geração Compartilhada**: Botões e calendário **ocultos** (responsabilidade do assinante).

---

## 4. Padrões de Layout e UX (UI Modernizada)

- **Menu em Abas**: Modal do Assinante com abas superiores para eliminar scroll excessivo.
- **Sticky UI**: Cabeçalhos e filtros fixos (`sticky`) para rápida interação.
- **Grid de 7 Colunas**: Calendários padronizados (Segunda a Domingo) com `min-height` fixo.
- **Responsividade**: Layout expandido para `maxWidth: 1600px`.

---

## 5. Identidade Visual (Cores e Símbolos)

### Ações de Cobrança (Ícone `CreditCard`)
Reflete a saúde financeira do **mês selecionado**:
- 🔴 **Vermelho**: Não Emitido (Existe débito sem boleto consolidado).
- 🔵 **Azul**: Emitido (Aguardando pagamento/compensação).
- 🟢 **Verde**: Quitado (Todas as faturas do período pagas).

### Status de Unidades Consumidoras (UCs)
| Status | Cor | Contexto |
| :--- | :--- | :--- |
| **Ativo / Sucesso** | 🟢 Verde (`#22c55e`) | Operação normal e leitura confirmada. |
| **Pendente** | 🟠 Laranja (`#f97316`) | Unidade ativa aguardando leitura/processamento. |
| **Erro / Alerta** | 🔴 Vermelho (`#ef4444`) | Falha no scraping ou inadimplência crítica. |
| **Inativo** | 🔘 Cinza (`#64748b`) | Unidade desativada ou transferida. |

### Status de Leitura (Ícones)
- ✅ **Sucesso**: Fatura encontrada e processada.
- 🌀 **Processando (Spin)**: Scraping em curso ou aguardando sincronia.
- ⚠️ **Erro**: Falha técnica na coleta junto à concessionária.
- 🕒 **Pendente**: Leitura aguardando data prevista.

---

## 6. Rastreabilidade (Logs)
- **Log Unificado**: `"Fatura enviada ao e-mail {email} e whatsapp {phone}"`.
- **Auditoria**: Tabela `crm_history` com metadados `email_status` e `wa_status`.
