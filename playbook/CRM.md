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
- **Visualização Padrão**: Definida como **Calendário** para facilitar o acompanhamento das datas de leitura e status de extração.

### 💰 Gestão de Faturas (Billing)
Faturamento mensal, integração bancária e automação de cobrança.
- **Novo Modal de Faturamento (`InvoiceFormModal`)**: Refatorado para navegação por abas horizontais (**Identificação, Consumo, Financeiro, Resumo**).
- **Aba Resumo**: Centraliza o card de detalhamento e as ações de download/visualização, otimizando o fluxo de conferência.
- **Calendários de Vencimento**: Dualidade de visão entre **Venc. Faturas** (B2W) e **Venc. Conta de Energia** (Concessionária).

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
- **Liquidação Automática (Conta de Energia)**: Quando o toggle "Pagamento Automático" está ativo nas Configurações, o sistema dispara a ordem de pagamento da fatura da concessionária imediatamente após a compensação da fatura do assinante no Asaas.

---

## 4. Configurações e Parâmetros do Sistema

O CRM centraliza as chaves de integração e regras de processamento em um painel unificado.

### ⚙️ Módulos de Configuração
- **Perfil de Usuários (`Users`)**: Gestão de acessos e permissões (Roles).
- **Evolution API (`Code`)**: Instância e chaves do WhatsApp para mensageria.
- **Serviço de e-mail (`Mail`)**: Credenciais do Resend para notificações transacionais.
- **Integração Financeira (`CreditCard`)**: Endpoint e chaves do Asaas (Sandbox/Produção).
- **Conta de Energia (`Zap`)**: Regras de faturamento e **Pagamento Automático**.
- **Padronização (`Palette`)**: Branding, logos e paleta de cores do sistema.

---

## 5. Padrões de Layout e UX

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
- **Logs de UI**: Histórico de mudanças de layout e visualização padrão.

---

## 8. Log de Atualizações Recentes

### 📅 07 de Abril de 2026 (23:20)
- **Refatoração do Modal de Fatura**: Implementação de sistema de abas e limpeza visual total.
- **Padronização de Visão**: Unidades Consumidoras agora iniciam na visão de **Calendário de Leituras** por padrão.
- **Renomeação Semântica**: Botões de calendário de faturas renomeados para "Venc. Faturas" e "Venc. Conta de Energia".
- **Ajuste de Grid**: Correção do layout dos cards no calendário de energia para evitar quebra de layout em resoluções padrão.
- **Rótulo Financeiro**: Alteração do texto "CONCESSIONÁRIA" para "Vr. A Pagar" na visão de faturas da concessionária.
- **Detalhamento de UC**: Inclusão automática do **Assinante B2W (Titular)** (campo da seção de vínculos) nos cards da visão de Calendário de Leituras, facilitando a identificação do responsável pela fatura.
