# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### 👥 Gestão de Assinantes (Subscribers)
Controle do ciclo de vida dos clientes e visão 360º.
- **Interface**: Navegação por **Abas Superiores** (Dados, Endereço, UCs, Faturas).
- **Dashboard (Dashboard Modernizado)**:
    - **Cards de Resumo**: Localizados no topo, exibem a soma de **"Total do Mês"** e **"Total Global"** de todos os registros visíveis no grid.
    - **Tabela de Alta Densidade**: Agrupamento de Nome, CPF e Contatos em coluna única.
    - **KPIs**: Total no Mês (Vencimento), Total a Pagar (Global) e Progresso de Leitura (Ex: `4/5`).
- **Filtros Inteligentes**:
    - **Seletor Universal**: Seletores de Mês e Ano individuais (Substituem o input de data nativo para compatibilidade).
    - **Ocultação Automática**: Assinantes com status **Cancelado** são ocultados por padrão (exibidos apenas em buscas ativas).
    - **Sorting**: Ordenação interativa por cabeçalho (Alfabética, Status, Financeiro).

### ⚡ Gestão de Unidades Consumidoras (UCs)
Monitoramento técnico e operacional de leituras.

### 💰 Gestão de Faturas (Billing)
Faturamento mensal, integração bancária e automação de cobrança.

---

## 2. Regras de Negócio e Lógica Financeira

### ⚖️ Cálculo de Indicadores
- **Total no Mês**: Soma das faturas com status `pago`, `atrasado` ou `a_vencer`. O cálculo é baseado na **Data de Vencimento** da fatura, garantindo a visualização correta do fluxo de caixa sem duplicidades por mês de referência.
- **Total a Pagar (Global)**: Saldo devedor total acumulado ao longo de todo o histórico.

### 📊 Ciclo de Leitura (Indicador `X/Y`)
- O contador quantitativo (Ex: 2 unidades lidas de 5 totais) reflete o sucesso das coletas estritamente para o **Mês de Referência** selecionado no filtro temporal.

### 🚦 Roteamento e Segurança (Sandbox)
- **E-mails**: Desviados para `waldineygodoy@gmail.com`.
- **WhatsApp**: Desviado para o **Telefone de Teste** fixo nas configurações.

---

## 3. Gatilhos e Automações (Triggers)

- **Mensageria Híbrida**: Disparo simultâneo (E-mail + WhatsApp) na emissão/download.
- **Inadimplência Automática**: 15 dias -> **Inadimplente** | 60 dias -> **Cancelamento Crítico**.
- **PDF Composto**: Mesclagem automática de Demonstrativo B2W + Boleto Asaas.

---

## 4. Padrões de Layout e UX

- **Menu em Abas**: Modal do Assinante com abas superiores.
- **Sticky UI**: Filtros e cabeçalhos fixos.
- **Layout Expandido**: `maxWidth: 1600px`.
- **Responsividade**: Tabelas adaptadas para omitir dados menos críticos (Ex: Cidade) em favor de indicadores financeiros.

---

## 5. Identidade Visual (Cores e Símbolos)

### Ações de Cobrança (Ícone `CreditCard`)
- 🔴 **Vermelho**: Não Emitido (Débito no período sem boleto consolidado).
- 🔵 **Azul**: Emitido (Aguardando pagamento).
- 🟢 **Verde**: Quitado (Todas as faturas do período pagas).

### Status de Unidades Consumidoras (UCs)
- 🟢 **Verde**: Ativo/Sucesso | 🟠 **Laranja**: Pendente | 🔴 **Vermelho**: Erro/Alerta | 🔘 **Cinza**: Inativo.

### Status de Leitura (Ícones)
- ✅ Sucesso | 🌀 Processando (Spin) | ⚠️ Erro | 🕒 Pendente

---

## 6. Rastreabilidade
- **Log Unificado**: `"Fatura enviada ao e-mail {email} e whatsapp {phone}"`.
- **Auditoria de Canal**: Metadados `email_status` e `wa_status` na timeline do CRM.
