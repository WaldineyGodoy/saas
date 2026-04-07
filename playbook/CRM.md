# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### 👥 Gestão de Assinantes (Subscribers)
Controle do ciclo de vida dos clientes e visão 360º.
- **KPIs de Performance**: Total no Mês (Vencimento), Total a Pagar (Global) e Progresso de Leitura (`X/Y`).
- **Resumo do Grid**: Cards no topo somando faturamento mensal e saldo devedor histórico dos registros filtrados.

### ⚡ Gestão de Unidades Consumidoras (UCs)
Monitoramento de leituras por concessionária em modo agrupado (**Dia 1 a 31**).

### 💰 Gestão de Faturas (Billing)
Faturamento consolidado, reemissões e controle de inadimplência.

### 📢 Sistema de Notificações (Multicanal)
Disparo atômico e simultâneo via **E-mail (Resend)** e **WhatsApp (Evolution API)**.

---

## 2. Regras de Negócio e Lógica Financeira

### ⚖️ Cálculo de Indicadores e Reemissão
- **Total no Mês**: Baseado na **Data de Vencimento** (inclui `atrasado` e `a_vencer`).
- **Realidade de Faturamento**: Faturas com status `cancelado` são mantidas no cálculo de saldo devedor até que um novo boleto seja gerado ou a dívida quitada.
- **Fluxo de Reemissão**: O cancelamento de um boleto no Asaas limpa automaticamente o `asaas_payment_id` no CRM, reativando o botão "Emitir Fatura Consolidada".

### 📊 Ciclo de Leitura (`X/Y`)
- Reflete o sucesso das coletas estritamente para o **Mês de Referência** selecionado.

### 🚦 Roteamento de Segurança (Sandbox)
- **Modo Sandbox**: Todas as comunicações (Email/WA) são desviadas para os canais de teste fixos nas configurações.

---

## 3. Gatilhos e Automações (Triggers)

- **Mensageria Híbrida**: Disparo unificado (Resend + Evolution API) no momento da emissão.
- **WhatsApp Premium**: Texto com emojis, espaçamento otimizado e Markdown (`*negrito*`).
- **Gatilhos de Inadimplência**: 15 dias (`Inadimplente`) e 60 dias (`Cancelamento Crítico`).

---

## 4. Padrões de Layout e UX

### 📐 Estrutura de Documentos (PDF Consolidado)
O PDF gerado pelo sistema segue uma estrutura profissional tríplice:
1. **Capa (Demonstrativo B2W)**: Design em cards por UC, detalhando Consumo (kWh), Economia e Taxas.
2. **Pagamento (Boleto Asaas)**: Página de cobrança oficial.
3. **Comprovação (Faturas Originais)**: O sistema anexa **recursivamente** todas as contas de energia das concessionárias vinculadas ao período.

### 💻 Interface de Usuário
- **SubscriberModal**: Navegação por abas (`Dados`, `Endereço`, `UCs`, `Faturas`).
- **Sticky UI**: Filtros e cabeçalhos fixos no topo.
- **Grid Universal**: Calendários seguem padrão fixo de 7 colunas (SEG-DOM).

---

## 5. Identidade Visual e Branding

### 🎨 Design System
- **Tipografia**: Uso obrigatório da fonte **Manrope**.
- **Cores**: Azul Marinho (Primária), Laranja (Destaque) e Verde (Sucesso).
- **Indicadores de Qualidade**: Inclusão do selo **"Eficiência Energética Nível A+"** nos documentos para o cliente.

### 🏷️ Simbologia de Status
- **Boleto (`CreditCard`)**: 🔴 Não Emitido | 🔵 Emitido | 🟢 Quitado.
- **Unidades e Leitura**: ✅ Sucesso | 🌀 Lendo (Spin) | ⚠️ Erro | 🕒 Pendente.

---

## 6. Especificações Técnicas: Notificações

### 🔗 E-mail Engine (Resend)
- **URL**: `https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/send-email`
- **Payload**: JSON com variáveis dinâmicas (`nome`, `valor`, `vencimento`).
- **Config**: `faturas@b2wenergia.com.br` (Auth via `--no-verify-jwt`).

### 💬 WhatsApp (Evolution API)
- **Endpoint**: `sendMedia` (v2) para envio de PDFs.
- **Log Unificado**: Registro consolidado no `crm_history` com metadados de sucesso por canal.

---

## 7. Rastreabilidade
- **Ação**: `email_sent` | `wa_sent` | `fatura_emitida`.
- **Auditoria**: Toda timeline do assinante registra o destino (sandbox ou produção).
