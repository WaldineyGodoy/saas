# Histórico de Atualizações do Playbook

Este log registra cronologicamente todas as atualizações informadas pelo usuário e as ações tomadas pelo assistente para manter a base de conhecimento (CRM.md e APP.md) atualizada.

---

## [2026-04-03] - Modernização da Listagem de Assinantes (Dashboard)

### Atualizações Registradas:
1. **Filtro Temporal Dinâmico**:
    - Introdução de um **Seletor de Mês (Calendário)** no topo da lista para controle de indicadores mensais.
2. **Reestruturação da Tabela**:
    - **Densidade de Dados**: Agrupamento de Nome, CPF, Email e Telefone em uma única coluna vertical, otimizando o espaço horizontal.
    - **Remoção de Redundância**: Exclusão da coluna "Cidade" para focar em métricas operacionais e financeiras.
3. **Novos Indicadores de Performance**:
    - **Financeiro Mensal**: Coluna "Total no Mês" com soma automática de faturas do período selecionado.
    - **Financeiro Global**: Coluna "Total a Pagar" refletindo o saldo devedor histórico completo.
    - **Operacional (Leitura)**: Coluna "Leitura" exibindo o progresso de coleta de faturas das UCs (Ex: 2/5 lidas).
4. **Inteligência Visual nas Ações**:
    - **Status do Boleto (Ícone CreditCard)**:
        - 🔴 **Vermelho**: Inadimplência no mês sem boleto emitido.
        - 🔵 **Azul**: Boleto consolidado emitido e aguardando pagamento.
        - 🟢 **Verde**: Faturas do mês quitadas.
    - **Feedback de Processamento**: Adição de animação (*spin*) e ícones de confirmação (`CheckCircle`) para processos em tempo real.

---

## [2026-04-03] - Automação de Notificações de Fatura

### Atualizações Registradas:
1. **Sistema de E-mail (Resend)**:
    - Integração de e-mails transacionais via Edge Functions.
    - Gatilhos: Emissão Consolidada e Download de Fatura.
2. **Roteamento de Segurança (Sandbox)**:
    - Implementação de desvio automático para e-mail administrativo em ambiente de teste.
3. **PDF Inteligente**:
    - Geração de PDF composto (Demonstrativo B2W + Boleto Asaas em um único anexo).
4. **Logs de Envio**:
    - Registro obrigatório na tabela `crm_history` com a ação `email_sent`.

---

## [2026-04-03] - Modernização da Interface de Assinantes (SubscriberModal)

### Atualizações Registradas:
1. **Navegação por Abas**:
    - Substituição do layout de seções colapsáveis por um **Menu Superior em Abas** (Dados Cadastrais, Endereço, Unidades Consumidoras, Faturas).
    - Introdução de ícones coloridos para cada aba.
2. **Otimização da Aba de Faturas**:
    - **Reorganização Visual**: Botões de ação (Emitir Fatura Consolidada) e filtro de data movidos para a esquerda; resumo financeiro para a direita.
    - **Gestão Financeira**: Introdução do box **"Total a Pagar" (Saldo Global Devedor)** que soma todas as faturas pendentes, e renomeação do box mensal para "Total a Pagar no Mês".
    - **Seletor de Data**: Implementação de seletor Mês/Ano com opção de "Todas as Datas".
3. **Melhoria nos Cards de UC**:
    - **Status Colorido**: Unidades exibem status com cores específicas (Verde, Laranja, Vermelho, Cinza) e fundos tonais.
    - **Indicadores de Leitura**: Exibição do dia de leitura e status por ícones + texto (✅ Sucesso, 🌀 Lendo, ⚠️ Erro, 🕒 Pendente).
    - **Lógica Temporal**: Detecção automática de faturas no mês atual para marcar sucesso na leitura.
4. **Ajustes de Layout (Sticky UI)**:
    - Fixação de cabeçalhos e filtros (`sticky`) para garantir visibilidade durante o scroll longo da modal.

---

## [2026-04-03] - Consolidação da Gestão de Assinantes

### Atualizações Registradas:
1. **Regras de Status Automatizadas**:
    - Implementação de gatilhos de inadimplência (15 dias para `Inadimplente`, 60 dias para `Cancelamento Crítico`).
    - Lógica de reativação automática após pagamento e dependência do status técnico das UCs.
2. **Funcionalidades de Cobrança**:
    - Introdução do botão **`CreditCard`** (Boleto Consolidado no Asaas).
3. **Identidade Visual (Assinantes)**:
    - Definição da paleta de cores para o Kanban de Assinantes (Azul para Ativação, Verde para Ativo, Âmbar para Inadimplente, Vinho para Crítico, Vermelho para Cancelado e Cinza para Manual/Transferido).
4. **Padrões de UI**:
    - Padronização de cards (Nome em Negrito, CPF/CNPJ, Cidade e Data).
    - Aplicação de `fontSize: 0.8rem` para dados secundários.

---

## [2026-04-03] - Novas Regras de Pagamento e Ajustes de UI

### Atualizações Registradas:
1. **Regras de Negócio (Faturas)**:
    - Restrição do botão **"PAGAR"** exclusivamente para a modalidade `Auto Consumo Remoto`.
    - Ocultação dos botões de pagamento para outras modalidades (evitando duplicidade).
    - Filtragem do **Calendário de Energia** para exibir apenas faturas de unidades `Ativas` e `Auto Consumo Remoto`.
2. **Interface e UX**:
    - Expansão do `maxWidth` das telas de listagem e gestão para **1600px**.
    - Padronização do grid de calendários em **7 colunas (SEG-DOM)**.
    - Implementação de consistência de células (`min-height` e `ellipsis`).
3. **Estabilização**:
    - Correção do nome da coluna de banco de dados: de `modalidade_consumo` para `modalidade`.

---

## [2026-04-03] - Detalhamento do Guia de Operação (UCs)

### Atualizações Registradas:
1. **Unidades Consumidoras**:
    - Detalhamento das 3 visualizações (Lista, Kanban, Calendário).
    - Definição exata das cores e contextos para o Calendário de Leituras (Verde, Cinza, Laranja, Vermelho, Azul).
    - Implementação da **Lógica de Existência Temporal** (baseada no `created_at`).
    - Regra de filtragem de **Unidades Inativas** no calendário.
    - Especialização dos **Contadores Acumulados** (Faturas vs Ausentes no Ano).

---

## [2026-04-03] - Estruturação Inicial do Playbook

### Atualizações Registradas:
1. **Estrutura de Pastas**: Criação da pasta `/playbook` e arquivos `CRM.md`, `APP.md`, `README.md` e `HISTORICO_ATUALIZACOES.md`.
2. **Definição de Política**: Estabelecimento de regras para eliminação de dados obsoletos, mapeamento de gatilhos e detecção de conflitos.
3. **Mapeamento Inicial (Estado Atual)**:
    - Extração de Status e Cores do Kanban de Unidades Consumidoras.
    - Mapeamento do Calendário de Leituras e Status de Scraping.
    - Documentação dos status de faturas e integrações com Asaas.
    - Identificação de gatilhos de banco de dados e automações de pagamento.

---
*Aguardando próximas atualizações do dia...*
