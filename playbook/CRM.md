# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### 👥 Gestão de Assinantes (Subscribers)
Controle do ciclo de vida dos clientes e visão 360º.
- **Estabilização de Interface**: Refatoração do `SubscriberModal` para estabilidade de build.
- **Dashboard**: Tabela de alta densidade e **Cards de Resumo** (Total Mês/Global).

### ⚡ Gestão de Unidades Consumidoras (UCs)
Monitoramento técnico e operacional de leituras.
- **Interface Modernizada (`ConsumerUnitModal`)**: Navegação por 4 abas superiores.

### 💰 Gestão de Faturas (Billing)
Faturamento mensal, integração bancária e automação de cobrança.

---

## 2. Regras de Negócio e Lógica Financeira

### ⚖️ Cálculo de Indicadores e Tarifas
- **Total no Mês**: Baseado na **Data de Vencimento** (inclui `atrasado` e `a_vencer`).
- **Recálculo Dinâmico**: Tarifas mínimas e descontos baseados no tipo de ligação (**Mono/Bi/Trifásico**).
- **Self-Healing (Auto-Correção)**: Detecção e limpeza de faturas órfãs no Asaas.

### 📊 Ciclo de Leitura e Notificação
- **Auto-Geração no Reenvio**: Se o PDF consolidado for removido ou não existir no Storage, ele é gerado automaticamente ao disparar um "Reenviar Notificação".
- **Logs de Diagnóstico**: Alertas no console para identificar falhas de renderização em componentes ocultos (capture targets).

---

## 3. Gatilhos e Automações (Triggers)

- **Mensageria Híbrida**: Disparo simultâneo (Resend + Evolution API).
- **WhatsApp Premium**: Texto com emojis e formatação otimizada.
- **Inadimplência Automática**: 15 dias (`Inadimplente`) e 60 dias (`Cancelamento Crítico`).

---

## 4. Padrões de Layout e UX

### 📐 Estrutura de Documentos (PDF Consolidado)
1. **Capa (Resumo B2W)**: Design em cards por UC.
    - **Captura Técnica**: Timeout de **2000ms** obrigatório para garantir o carregamento total de logotipos e fontes externas (Manrope).
    - **Safe Access**: Mapeamento de itens de fatura com navegação segura (`?.`) para evitar crashes `undefined`.
    - **Tipografia**: Nome do Assinante em **18px (Extra-Bold)** | Economia em **14px (Extra-Bold)**.
2. **Pagamento (Boleto Asaas)**.
3. **Comprovação (Faturas Originais)**: Anexo recursivo.

### 🎨 Design System e Estética
- **Tipografia**: Fonte **Manrope**.
- **Branding**: Azul Marinho, Laranja e Verde.
- **Selo de Qualidade**: **"Eficiência Energética Nível A+"**.

---

## 5. Identidade Visual (Cores e Símbolos)

### Ações de Cobrança (Ícone `CreditCard`)
- **Padrão Semafórico**:
    - 🔴 **Vermelho**: Não Emitido (Débito pendente).
    - 🔵 **Azul**: Emitido (Aguardando compensação).
    - 🟢 **Verde**: Quitado (Todas as faturas do período pagas).

### Unidades Consumidoras e Leitura
- 🟢 Ativo/Sucesso | 🟠 Pendente | 🔴 Erro | 🔘 Inativo.
- Ícones: ✅ Sucesso | 🌀 Lendo (Spin) | ⚠️ Erro | 🕒 Pendente.

---

## 6. Especificações Técnicas: Notificações

### 🔗 E-mail Engine (Resend)
- **URL**: `https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/send-email`
- **Auth**: `--no-verify-jwt` | **CORS**: Status 200 resiliente.

### 💬 WhatsApp (Evolution API)
- **Endpoint**: `sendMedia` (v2) para PDFs.
- **Log**: Metadados registrados no `crm_history`.

---

## 7. Rastreabilidade
- **Ações**: `email_sent`, `wa_sent`, `fatura_emitida`.
- **Auditoria**: Timeline registra ambiente (Sandbox/Prod).
