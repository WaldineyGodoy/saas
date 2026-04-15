---

## [2026-04-15] - Hardening do CRM, UI/UX e Estabilização de Integrações (20:30)

### Atualizações Registradas:
1. **Módulo Financeiro e Asaas (Configurações)**:
    - **Credenciais Dinâmicas**: Remoção total do uso de `.env` no Deno para as credenciais Asaas (`create_asaas_charge`, `manage_asaas_customer`, `transfer_asaas_pix`). As chaves agora são lidas exclusivamente da tabela `integrations_config` pelo frontend e backend.
2. **Módulo Unidades Consumidoras e Vínculos**:
    - **Organização Visual**: Tela de Dados com layout horizontal e box colorido para Saldo Remanescente. O menu passou a ser chamado "Calendário de Leituras" oficialmente.
    - **Novo Vínculo Operacional (Dono da Cota)**: Select de "Assinante Vinculado à UC" adicionado diretamente sob o "Assinante B2W (Titular)" na aba de Vínculos da UC, mapeando o pagador real independente da titularidade da fatura.
3. **Módulo de Faturamento / Calendário**:
    - **Fatura Zerada Inteligente (`Upsert`)**: Modal robusto e customizado criado para "Fatura Avulsa". A integração de gravação parou de bater cabeça com faturas "Canceladas" (invisíveis) usando comando `upsert`. Faturas passadas e anuladas agora são sobrescritas pela zerada e o calendário reage tornando-se Verde imediato.
    - **Data da Fonte da Verdade**: A alocação no Kanban e a listagem passaram a respeitar unicamente o `dia_vencimento` cadastrado na UC, ignorando datas compiladas artificialmente.
4. **Precisão de Assinantes (Stale Data)**:
    - Faturas "cancelado" foram filtradas à força nos cálculos retroativos de `Saldo Devedor` explícitos nas modais de assinante e cards globais, saneando a contabilidade em tempo real.
5. **WhatsApp & Evolution API**:
    - Regra ativa na Edge Function `send-whatsapp` que monitora números curtos (10-11 digitos) e prepende inteligentemente o prefixo (55), extinguindo o erro `Bad Request`.

---

## [2026-04-15] - Refatoração de Segurança e Pagamento de Boletos (20:30)

### Atualizações Registradas:
1. **Migração de Segredos para o Banco de Dados**:
    - Credenciais do Asaas (`API_KEY` e `API_URL`) movidas de variáveis de ambiente para a tabela `integrations_config`.
    - Atualização das funções `create_asaas_charge`, `manage_asaas_customer` e `transfer_asaas_pix` para leitura dinâmica das chaves.
2. **Nova Funcionalidade: Pagamento de Contas (`pay-asaas-bill`)**:
    - Implementação de Edge Function para pagamento de boletos externos e contas de consumo via linha digitável.
    - Proteção por autenticação e verificação de nível de acesso (`admin`/`superadmin`).
3. **Resolução de Erro 404 (Webhook)**:
    - Identificação e correção da ausência de deploy da função `asaas-webhook`.
    - Ajuste no `config.toml` para permitir comunicações externas sem JWT (`verify_jwt = false`) especificamente para o Webhook do Asaas.
4. **Padronização Técnica e CI/CD**:
    - Estruturação de todas as Edge Functions no padrão `supabase/functions/<nome>/index.ts`.
    - Inclusão das novas funções (`asaas-webhook`, `pay-asaas-bill`) no workflow do GitHub Actions (`deploy.yml`).

---

## [2026-04-15] - Integração YOURLS e SEO de Links (21:00)

### Atualizações Registradas:
1. **Encurtador de Links Próprio (Shortener)**:
    - Integração completa do YOURLS no domínio `link.b2wenergia.com.br`.
    - **Dashboard do Embaixador**: Links de indicação agora são encurtados automaticamente (`link.../ref-xxxx`) e salvos no banco.
    - **Assinaturas de Contrato**: URLs do Autentique são encurtadas antes do envio, melhorando a aceitação em filtros de SPAM do WhatsApp.
2. **Normalização de WhatsApp (DDI 55)**:
    - Implementação de regra na Edge Function para prepender `55` em números brasileiros de 10/11 dígitos.
3. **Limpeza de Landing Pages**:
    - Otimização da página de contratos (`/Contrato`), removendo seções de "Ambiente de Assinatura" e "Minuta Jurídica" para foco em conversão direta.

---

## [2026-04-15] - Paridade CRM e Auditoria Unificada (23:30)

### Atualizações Registradas:
1. **Comunicação Multicanal em Leads**:
    - Implementação da aba de **Comunicados** em `LeadModal.jsx`.
    - Suporte a envio de WhatsApp manual com **anexos (Base64)** de imagens e documentos.
    - Registro automático de cada disparo na `crm_history` para auditoria centralizada.
2. **Estabilização de Roteamento (Segurança)**:
    - Implementação da regra de **`key` única** baseada no ID em todos os modais de listagem (`LeadsList`, `OriginatorList`, `SupplierList`).
    - **Regra de Processo**: Forçar a re-montagem completa do componente ao trocar de registro para evitar vazamento de dados (*stale state*).
    - Uso de **Props Diretas** (em vez de `formData`) para roteamento de WhatsApp, garantindo 100% de entrega correta.
3. **Auditoria Unificada (Timeline)**:
    - Integração do componente `HistoryTimeline` nos modais de **Originador** e **Fornecedor**.
    - Implementação do helper `addHistory` e logs automáticos de criação e edição para todos os parceiros.
4. **Normalização de Dados**:
    - Frontend preparado para prepender **DDI 55** em números brasileiros, garantindo compatibilidade com a Evolution API.

---

## [2026-04-15] - Reestruturação da Lista de Faturas e Timeline (16:10)

### Atualizações Registradas:
1. **Nova Grade de Dados (Modo Lista)**:
    - Implementação de colunas específicas: **Vr. da Fatura**, **Vr. Conta de Energia** e **Saldo**.
    - **Ação Contextual**: Botão **BOLETO** movido para a coluna da fatura; Botões **PAGAR/PAGA** movidos para a coluna da conta de energia.
    - **Lógica de Saldo**: Cálculo automático da diferença entre o recebível do assinante e o custo da concessionária.
2. **Expansão de Mensagens (Timeline)**:
    - Implementação de **"Ver mais/Ver menos"** no `HistoryTimeline.jsx`.
    - **Priorização de Metadata**: Otimização para exibir o conteúdo completo da mensagem armazenada nos metadados, contornando resumos truncados.
3. **Correções de UI (Bug Fix)**:
    - Proteção contra fechamento acidental de modais ao interagir com elementos de expansão (uso de `type="button"` e `stopPropagation`).

---

## [2026-04-14] - Integração YOURLS e SEO de Links

### Atualizações Registradas:
1. **Encurtador de Links Próprio**:
    - Finalização da infraestrutura YOURLS no servidor Hostinger.
    - Integração via Edge Function `yourls-shorten` para automação de links de contrato e faturas.
2. **Limpeza de Landing Pages**:
    - Remoção de seções obsoletas ("Ambiente de Assinatura" e "Minuta Jurídica") na página de contratos para foco em conversão.

---

## [2026-04-12] - Estabilização de Comunicação e Leads

### Atualizações Registradas:
1. **Roteamento de Mensagens Estável**:
    - Padronização da comunicação manual em modais de **Leads**, **Originadores** e **Fornecedores**.
    - Implementação de **Unique Keys** para re-montagem de componentes, garantindo que o histórico e o envio de mensagens correspondam sempre ao registro ativo na tela.
2. **Edição Rápida de UC**:
    - Inclusão do botão "Editar" diretamente nos cards de Unidade Consumidora dentro do modal do assinante.

---

## [2026-04-10] - Gestão de Inventário e Autentique v2

### Atualizações Registradas:
1. **Inventário de Materiais (Obras)**:
    - Lançamento do módulo de controle de insumos para a UFV Bom Jesus II.
    - Rastreamento de fornecedores, quantidades e custos unitários na `materials_inventory`.
2. **Webhook Autentique v2**:
    - Refatoração da Edge Function para suportar payloads aninhados da API V2.
    - Sincronização automática do status "Assinado" com o banco de dados.

---


## [2026-04-15] - Automação de Pagamentos Asaas e Suporte Consolidado (20:30)

### Atualizações Registradas:
1. **Motor de Liquidação Automática**:
    - Implementação de regra para pagamento instantâneo da conta de concessionária via API Asaas (`/bills`) assim que a fatura do assinante é confirmada.
2. **Inteligência de Faturas Consolidadas**:
    - O webhook agora identifica pagamentos únicos que cobrem múltiplas UCs, resolvendo o vínculo e atualizando o status de todas as faturas filhas em cascata.
3. **Gestão de Exceções Financeiras**:
    - Criação do status **`erro`** para faturas onde a automação falhou (ex: falta de saldo no Asaas).
    - Registro mandatório do motivo da falha na timeline (`crm_history`) para ação manual imediata.
4. **Segurança de Integração**:
    - Adição do campo **Webhook Access Token** na UI de configurações, permitindo a validação de autenticidade dos disparos do Asaas diretamente no CRM.

---

## [2026-04-14] - Encurtamento de Links e Melhoria em Contratos

### Atualizações Registradas:
1. **Integração YOURLS**:
    - Implementação de encurtador de links próprio para reduzir o tamanho de URLs de boletos e contratos enviados via WhatsApp, melhorando a entregabilidade e estética.
2. **Sincronização Autentique V2**:
    - Refatoração completa do webhook de contratos para suportar a estrutura de payload da API V2 da Autentique, garantindo a atualização de status de assinatura em tempo real.

---

## [2026-04-09] - Estabilização de Comunicação e WhatsApp

### Atualizações Registradas:
1. **Resolução de Stale State (Modais)**:
    - Implementação de chaves únicas (`key={entity.id}`) nos modais de Lead, Originador e Fornecedor para forçar a re-renderização e evitar o envio de mensagens para a entidade errada.
2. **Interface de Comunicação Manual**:
    - Adição de campos de mensagem e anexo de arquivos em todos os módulos do CRM, com histórico unificado na timeline.
3. **Histórico Global (`crm_history`)**:
    - Expansão do sistema de histórico para abranger Leads, Originadores e Fornecedores, centralizando todas as interações (WhatsApp, Automações e Notas).

---

## [2026-04-08] - Otimização de Visibilidade Financeira e UX

### Atualizações Registradas:
1. **Visualização de Faturas (Grid)**:
    - Adição de colunas dedicadas: **Valor Fatura**, **V. Energia (Concessionária)** e **Saldo Benefício**.
    - Reposicionamento de botões de faturamento ao lado dos valores para melhorar o fluxo operacional.
2. **Correção do Resumo da Conta (`InvoiceSummaryModal`)**:
    - Ajuste da origem de dados para exibir os **valores brutos extraídos do PDF** da concessionária, garantindo fidelidade total às informações da conta de luz original.
3. **Manual Invoice Flow Control**:
    - Implementação de seletor manual de mês de competência no `InvoiceFormModal` para permitir faturas de valor zero ou ajustes retroativos sem conflito de chaves únicas.
4. **Configurações de Energia**:
    - Lançamento da aba "Conta de Energia" no menu de configurações para controle centralizado das regras de automação.
 ## [2026-04-07] - Configurações de Conta de Energia e Pagamento Automático (23:00)
 
 ### Atualizações Registradas:
 1. **Nova Área de Configurações (`Conta de Energia`)**:
     - Criação de espaço dedicado para regras de processamento de faturas.
     - Ícone identificador: `Zap` (Energia/Velocidade).
 2. **Gatilho de Pagamento Automático**:
     - Implementação de controle (On/Off) para autorizar a liquidação automática de contas de energia junto à concessionária após o recebimento do assinante.
 3. **Persistência de Regras**:
     - Armazenamento em `integrations_config` sob o serviço `energy_rules`.
 4. **Resumo de Painel de Configurações**:
     - Consolidação da documentação de todos os módulos existentes: Usuários, WhatsApp, E-mail, Financeiro, Energia e Branding.

---

## [2026-04-07] - Estabilização de PDF e Reenvio Automático (21:05)

### Atualizações Registradas:
1. **Auto-Geração no Reenvio**:
    - Gatilho automático para gerar o PDF consolidado se ele não for encontrado no Storage ao disparar uma notificação.
2. **Estabilidade de Captura PDF**:
    - Ajuste de **Timeout para 2000ms** para garantir carregamento de logos e fontes externas.
    - Implementação de **Safe Access** em arrays de itens de fatura para evitar erros `undefined map`.
3. **Diagnóstico e Logs**:
    - Alertas no console para identificar falhas de renderização em componentes ocultos durante a captura.
4. **Regras Visuais e Dashboard**:
    - Confirmação do padrão **Semafórico** (Vermelho/Azul/Verde) nos ícones de cobrança.
    - Confirmação da regra de "Total no Mês" estritamente baseada no faturamento financeiro (**Vencimento**).

---

## [2026-04-07] - Estabilização de Build e Modernização de Modais

### Atualizações Registradas:
1. **Refatoração de Front-end (Estabilidade)**:
    - Reestruturação do `SubscriberModal.jsx` para eliminação de erros de linting e build.
    - Memoização de buscas de faturas e UCs com `useCallback`.
2. **Modernização de UI (`ConsumerUnitModal`)**:
    - Substituição de acordeões por navegação em abas superiores (**Vínculos**, **Dados UC**, **Endereço**, **Técnico**).
    - Padronização visual com o design system (Manrope, Grades Modernas).
3. **Melhorias no PDF Consolidado**:
    - Nome do assinante aumentado para **18px (Extra-Bold)**.
    - Valores de economia nos cards das UCs aumentados para **14px (Extra-Bold)**.
4. **Resiliência de Back-end**:
    - Resolução do Erro 400 em `create-asaas-charge` com limpeza de pagamentos órfãos.
    - Mecanismo de **Self-Healing** no front-end para detecção automática de registros inconsistentes.
5. **Regras de Negócio**:
    - Recálculo dinâmico de tarifas mínimas/descontos com base no tipo de ligação (**Mono/Bi/Trifásico**).

---

## [2026-04-06] - Padronização de Dados e Estabilização de APIs

### Atualizações Registradas:
1. **Padronização de Celulares (Sanitização)**:
    - Implementação de limpeza automática (`.replace(/\D/g, '')`) em todos os pontos de entrada de telefone (CRM e Signups públicos).
    - Garantia de conformidade com os requisitos de strings puramente numéricas da Evolution API v2.
2. **Estabilização Evolution API v2**:
    - Refatoração completa das requisições para o padrão "flat" (plano) da v2, corrigindo erros de estrutura JSON.
    - Implementação de `encodeURIComponent` para nomes de instâncias, permitindo espaços e símbolos.
3. **Melhoria Diagnóstica**:
    - Novo sistema de extração de erros detalhados na interface de Configurações, facilitando a identificação imediata de problemas de conexão.

---

## [2026-04-05] - Automação de Notificações de Fatura (E-mail + PDF)

### Atualizações Registradas:
1. **Infraestrutura de E-mail**:
    - Implementação de disparos transacionais via **Resend** e **Supabase Edge Functions**.
2. **Segurança e Testes**:
    - Roteamento inteligente baseado no status da conta Asaas (Sandbox vs Produção).
3. **Composição de Documentos**:
    - Fluxo de mesclagem de PDF em tempo real: Demonstrativo B2W + Boleto Asaas em anexo único.
4. **Logs e Rastreabilidade**:
    - Registro detalhado de cada disparo na `crm_history` para auditoria na timeline do cliente.
5. **Configuração via UI**:
    - Gestão de credenciais `resend_api` integrada ao menu de Configurações.

---

## [2026-04-05] - Integração Resend Email (Edge Function)

### Atualizações Registradas:
1. **Engine de E-mail (Deploy v7)**:
    - Implementação da função `send-email` via Supabase Edge Functions.
    - Suporte a payloads flexíveis e CORS resiliente (status 200).
2. **Template Premium**:
    - HTML baseado em tabelas de alta fidelidade para compatibilidade total.
    - Variáveis dinâmicas (`nome`, `valor`, `vencimento`, `mensagem`).
3. **Ambiente de Segurança**:
    - Redirecionamento automático para `test_email` em modo Sandbox.
4. **Endpoint Técnico**:
    - Mapeamento da URL e método de autenticação (`--no-verify-jwt`).

---

## [2026-04-03] - Reformulação de Indicadores e Filtros (Dashboard)

### Atualizações Registradas:
1. **Lógica Financeira (Precisão)**:
    - Inclusão do status `a_vencer` no somatório mensal.
    - Alteração da base de cálculo de "Total no Mês" para a **Data de Vencimento** (Data de Caixa).
2. **Ciclo de Leitura**:
    - Ajuste do contador `X/Y` para refletir apenas o **Mês de Referência** selecionado.
3. **Interface e Filtros**:
    - Implementação de **Cards de Somatório** (Total Mensal e Global do Grid).
    - Substituição de inputs de data por seletores universais (Mês/Ano).
    - Regra de ocultação automática para assinantes **Cancelados**.
    - Cabeçalhos interativos para ordenação alfabética e por status.

---

## [2026-04-03] - Integração de Mensageria WhatsApp (Evolution API)

### Atualizações Registradas:
1. **Mensageria Híbrida**:
    - Disparo simultâneo e atômico (E-mail via Resend + WhatsApp via Evolution API).
2. **Suporte a Documentos (sendMedia)**:
    - Envio do PDF combinado (Demonstrativo B2W + Boleto Asaas) via WhatsApp.
3. **Persistência de Configuração**:
    - Armazenamento estável de **Telefone de Teste** para modo Sandbox.
4. **Log Unificado**:
    - Registro de sucesso/erro consolidado em uma única entrada no `crm_history`.

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
