# Histórico de Atualizações do Playbook

Este log registra cronologicamente todas as atualizações informadas pelo usuário e as ações tomadas pelo assistente para manter a base de conhecimento (CRM.md e APP.md) atualizada.

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
