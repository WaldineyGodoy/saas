# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### 👥 Gestão de Assinantes (Subscribers)
Controle do ciclo de vida dos clientes e visão 360º.
- **Estabilização de Interface**: Componente `SubscriberModal` refatorado para estabilidade de build (uso extensivo de `useCallback` e limpeza de dependências).
- **Dashboard**: Tabela de alta densidade e **Cards de Resumo** (Total Mês/Global).

### ⚡ Gestão de Unidades Consumidoras (UCs)
Monitoramento técnico e operacional de leituras.
- **Interface Modernizada (`ConsumerUnitModal`)**: Navegação por 4 abas superiores:
    1. **Vínculos**: Assinante, Titularidade e Credenciais.
    2. **Dados da UC**: Modalidade, Prazos e Contrato.
    3. **Endereço**: Layout otimizado com busca por CEP.
    4. **Dados Técnicos**: Parâmetros FV, Tarifas (TE/TUSD) e Resumo de Faturamento.

### 💰 Gestão de Faturas (Billing)
Faturamento mensal, integração bancária e automação de cobrança.

---

## 2. Regras de Negócio e Lógica Financeira

### ⚖️ Cálculo de Indicadores e Tarifas
- **Total no Mês**: Baseado na **Data de Vencimento** (inclui `atrasado` e `a_vencer`).
- **Recálculo Dinâmico**: Tarifas mínimas e descontos são recalculados automaticamente com base no tipo de ligação (**Monofásico**, **Bifásico** ou **Trifásico**).
- **Self-Healing (Auto-Correção)**: O sistema detecta e limpa automaticamente IDs de pagamentos residuais (faturas órfãs) para evitar erros `400` no Asaas.

### 📊 Ciclo de Leitura (`X/Y`)
- Reflete o sucesso das coletas estritamente para o **Mês de Referência** selecionado.

---

## 3. Gatilhos e Automações (Triggers)

- **Mensageria Híbrida**: Disparo simultâneo (Resend + Evolution API).
- **WhatsApp Premium**: Texto com emojis e formatação otimizada para legibilidade móvel.
- **Inadimplência Automática**: 15 dias (`Inadimplente`) e 60 dias (`Cancelamento Crítico`).

---

## 4. Padrões de Layout e UX

### 📐 Estrutura de Documentos (PDF Consolidado)
1. **Capa (Resumo B2W)**: Design em cards por UC.
    - **Tipografia de Cabeçalho**: Nome do Assinante em **18px (Extra-Bold)**.
    - **Bloco de Economia**: Valores internos em **14px (Extra-Bold)** para destaque dos benefícios.
2. **Pagamento (Boleto Asaas)**.
3. **Comprovação (Faturas Originais)**: Anexo recursivo de todas as contas do período.

### 🎨 Design System e Estética
- **Tipografia**: Uso obrigatório da fonte **Manrope**.
- **Branding**: Azul Marinho, Laranja e Verde.
- **Selo de Qualidade**: Inclusão do selo **"Eficiência Energética Nível A+"**.

---

## 5. Especificações Técnicas: Notificações

### 🔗 E-mail Engine (Resend)
- **URL**: `https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/send-email`
- **Auth**: `--no-verify-jwt`.
- **CORS**: Respostas resilientes (status 200).

### 💬 WhatsApp (Evolution API)
- **Endpoint**: `sendMedia` (v2) para PDFs.
- **Log**: Metadados de sucesso por canal registrados no `crm_history`.

---

## 6. Rastreabilidade
- **Ações**: `email_sent`, `wa_sent`, `fatura_emitida`.
- **Auditoria**: Timeline registra ambiente (Sandbox/Prod) e status de entrega.
