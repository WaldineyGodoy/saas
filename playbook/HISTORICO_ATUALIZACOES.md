# Histórico de Atualizações - CRM B2W Energia

---

## [29/04/2026] - Reorganização de Configurações e Integração Financeira

### ⚙️ Configurações e Workflow
- **Migração de Regras Gerais**: A seção "Regras Gerais" (Pagamento Automático) foi movida de "Conta de Energia" para "Integração Financeira".
- **Consolidação Financeira**: O bloco "Permitir resgate automático" foi integrado à nova seção "Regras Gerais" dentro das configurações de Integração Financeira (Asaas).
- **Otimização de Webhook**: A Edge Function `asaas-webhook` foi atualizada para ler a flag `auto_payment` diretamente da configuração da API financeira, reduzindo latência e consolidando a lógica de negócio.
- **Limpeza de Interface**: Removidos estados e funções obsoletos em `EnergyAccountSettings.jsx`.


## [29/04/2026] - Implementação de Fluxo Kanban e Status de Faturas
 
### 📊 Gestão de Faturas e Kanban
- **Novo Status "Ag. Emissão de Boleto"**: Introduzido um novo estado no ciclo de vida das faturas para identificar documentos gerados que ainda não possuem cobrança vinculada no Asaas.
- **Coluna Kanban Dedicada**: O painel de faturas (`InvoiceListManager.jsx`) agora conta com uma quarta coluna à esquerda, específica para o status "Ag. Emissão de Boleto", com somatórios financeiros em tempo real.
- **Automação de Transição**: 
    - Faturas recém-criadas agora possuem o status padrão `"ag_emissao_boleto"`.
    - Implementada lógica na Edge Function `create-asaas-charge` para transicionar automaticamente o status para `"a_vencer"` ou `"atrasado"` imediatamente após a criação bem-sucedida da cobrança no Asaas.
- **Interface Refinada (Badge)**: Adicionado suporte visual ao novo status com ícone dedicado (`TicketMinus`) e cores em tons de azul para fácil identificação.
- **Controle Manual**: O modal de edição de faturas (`InvoiceFormModal.jsx`) agora permite a alteração manual para o novo status na aba Geral, com botões de seleção estilizados.

---

## [29/04/2026] - Modernização de Interface e Comunicação (UC)

### 🎨 Visual e Interface (ConsumerUnitModal)
- **Refatoração Premium**: O modal de Unidade Consumidora (`ConsumerUnitModal.jsx`) foi completamente reestruturado para um sistema de navegação por abas (**Geral**, **Técnico**, **Financeiro**, **Comunicados**).
- **Status em Destaque**: Adicionado um badge de status dinâmico à esquerda do menu de abas no modal de UC, permitindo visualização imediata do estado da unidade (Ativo, Em Ativação, etc.) independente da aba selecionada.
- **Organização Lógica**: O bloco **Gestão de Faturas** foi movido da aba Técnica para a aba **Financeiro**, alinhando-se melhor ao fluxo de trabalho do usuário.
- **Correção de Histórico (Timeline)**: O botão "Histórico" no cabeçalho agora abre um modal dedicado com formatação aprimorada, corrigindo o erro de layout "sequestrado" que ocorria anteriormente.
- **Hotfix de Build**: Resolvido erro de sintaxe JSX em `HistoryTimeline.jsx` (`Unterminated regular expression`) que impedia o build de produção.
- **Redirecionamento de Sessão**: Implementado redirecionamento automático para a página de login em caso de expiração de JWT (`PGRST303`), eliminando o travamento na tela de carregamento de perfil.
- **Organização de Dados**: Centralização de informações básicas (Assinante, Localização) na aba Geral; Status e Dados Operacionais na aba Técnico; e Tarifas/Faturamento na aba Financeiro.
- **Aba de Comunicados (WhatsApp)**: Integração de compositor de mensagens manual com suporte a anexos (PDF/Imagens), permitindo comunicação direta com o assinante a partir da UC.
- **Histórico de Interações**: Implementação de log automático via `addHistory` para cada mensagem enviada, integrando as comunicações manuais à timeline do CRM.
- **Estabilização de Tarifas**: Reforço da lógica de campos *read-only* para componentes tarifários provenientes do motor de cálculo, garantindo integridade dos dados financeiros.

### 💬 Mensageria e Notificações
- **Notificação Automática (Faturas Individuais)**: O sistema agora dispara automaticamente o combo E-mail + WhatsApp com o PDF anexo no momento em que um boleto individual é gerado no `InvoiceFormModal.jsx`. 
- **Sincronização de Estado (React Fix)**: Resolvido problema onde a notificação automática falhava por tentar usar a URL do boleto antes da atualização do estado local. Agora, a URL é passada diretamente para o motor de geração de PDF.
- [FIX] **Sincronização de Histórico na UC**: Corrigido o mismatch de `entity_type` (`consumer_unit` -> `uc`) que impedia a visualização de logs de notificação na timeline da Unidade Consumidora.
- [FIX] **Nome do Assinante no PDF**: Resolvida a omissão do nome do assinante no detalhamento da fatura (PDF) através da propagação direta do estado do assinante no template de captura.
- [FIX] **Exibição de Telefone (UC)**: Corrigida a consulta de assinantes no `ConsumerUnitModal.jsx` para incluir o campo `phone`, resolvendo a exibição de "N/A" e "Sem Telefone" nas abas Geral e Comunicados.
- **Histórico Unificado**: Implementada a gravação de logs de envio na entidade `uc` (unificada). Isso permite que o histórico de comunicações apareça diretamente no modal de faturas da UC (`UCInvoicesModal.jsx` / `ConsumerUnitModal.jsx`), além do perfil do assinante.

### 💰 Financeiro e Tarifas (Fixes Críticos)
- [FIX] **Normalização de Desconto (%)**: Corrigida a lógica de exibição do percentual de desconto no `ConsumerUnitModal.jsx`. O sistema agora detecta e normaliza automaticamente valores decimais (ex: 0.20 -> 20.00%) tanto no carregamento inicial quanto na busca via CEP, prevenindo o erro de exibição de "2.000%".
- **Consistência de Dados**: Garantida a integridade na gravação do `desconto_assinante` como valor numérico absoluto, alinhando o frontend com as regras de negócio do banco de dados.
- **Campos Editáveis (Faturamento)**: Reativada a edição dos campos de **Dia de Vencimento**, **Desconto**, **Franquia** e **Saldo Remanescente** na aba Financeiro da UC, permitindo ajustes diretos conforme necessário.

---

## [28/04/2026] - Refinamento de Documentos, UX e Gestão de Tarifas

### 💰 Funcionalidades Financeiras e PDF
- **Nomenclatura Inteligente de Arquivos**: Implementada lógica de nomes descritivos para downloads de PDF.
    - **Faturas Individuais**: `Fatura_NomeDoCliente_NumerodaUC_Mes_Ano.pdf`.
    - **Faturas Consolidadas**: `Fatura_Consolidada_NomeDoCliente_Mes_Ano.pdf`.
    - **Normalização**: Nomes são higienizados (sem acentos ou caracteres especiais) para compatibilidade universal.
- **Header Content-Disposition**: Atualização da Edge Function `merge-pdf` para retornar o nome do arquivo nos headers HTTP, garantindo que o navegador identifique o arquivo corretamente mesmo em downloads diretos.

### ⚡ Unidades Consumidoras e Tarifas
- **Proteção de Dados Tarifários**: No modal de Unidades Consumidoras (`ConsumerUnitModal.jsx`), a seção de **Componentes Tarifários** (Tarifa, TE, TUSD, Fio B) agora é estritamente **Informativa/Read-only**. Isso previne alterações manuais que poderiam conflitar com o motor de cálculo global.
- **View SQL de Resumo (`view_concessionarias_resumo`)**: Implementada lógica de agregação no servidor para gerenciar mais de 5.200 registros de municípios, resolvendo a limitação de exibição de cards (agora exibe todas as 85 concessionárias únicas/UF).
- **Cálculo Automático de Tarifa Final**: Implementada soma em tempo real de **TE + TUSD** no modal de edição e nos cards, garantindo precisão matemática.

### 🏭 Gestão de Usinas (Power Plants)
- **Persistência de Geração Mensal**: Correção crítica no `PowerPlantModal.jsx` para mapear corretamente o campo de interface para a coluna do banco de dados (`geracao_mensal_kwh`), resolvendo o erro de coluna inexistente.
- **Normalização de Status de Produção**: Correção do valor padrão de status de `"pendente"` para `"em_producao"` no `PowerPlantModal.jsx`, adequando-se às restrições de `enum` do banco de dados e evitando falhas de salvamento.
- **Compatibilidade de Chaves de Analytics**: Implementada lógica de fallback no `PowerPlantModal.jsx` para suportar tanto a chave `geracao` quanto `estimativa` no objeto de performance, garantindo que o campo "Geração Prevista" nunca fique zerado devido a inconsistências entre componentes.
- **Sincronização de Analytics (IrradianceChart)**: Atualização do `IrradianceChart.jsx` para utilizar a coluna `geracao_mensal_kwh` em vez da depreciada `geracao_real`, restaurando a exibição de dados reais nos gráficos de performance.

### 🛡️ Segurança e Infraestrutura (DevOps)
- **Migração para GitHub Secrets**: Transição das chaves sensíveis (`VITE_MAPBOX_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) para o cofre do GitHub.
- **Deploy Resiliente**: Atualização do workflow `deploy.yml` para injeção de variáveis em tempo de build.
- **Fix de Imports Edge Functions**: Substituição de imports `esm.sh` por especificadores `npm` estáveis para evitar falhas de runtime.

---

## [24/04/2026] - Inteligência Geoespacial e Rede de Distribuição

### 🗺️ Mapeamento e Expansão
- **Módulo de Rede de Distribuição**: Implementação de sistema de busca geoespacial para prospecção de subestações de energia.
- **Geoprocessamento (PostGIS)**: Ativação da extensão PostGIS no Supabase e criação de funções de busca por proximidade (Srid: 4326).
- **Integração Mapbox GL**: Novo componente `GridMap.jsx` com visualização premium em modo Dark, exibindo subestações e raios de cobertura.
- **ETL Automático**: Script de ingestão de dados ANEEL/EPE para popular tabelas de subestações com coordenadas geográficas.

---

## [21/04/2026] - Refatoração Premium e Integração Financeira (Fornecedores e Originadores)

### 🎨 Visual e Interface (Premium UI/UX)
- **Reorganização do Modal de Fornecedores**: Movidos campos de Contato (Telefone e Email) para a aba **Geral**, centralizando as informações básicas.
- **Seção Financeira Refinada**: Foco exclusivo em **Dados Bancários e PIX** na aba Financeiro, otimizando o fluxo de gestão de pagamentos.
- **Layout de Endereço Compacto**: Agrupamento de campos (Cidade/UF e CEP/Rua) em linhas únicas para uma interface mais limpa e produtiva.
- **Botão Copiar PIX**: Integração de funcionalidade de cópia no clipboard diretamente no campo da chave PIX com feedback de sucesso.
- **Saldo Acumulado no Financeiro**: Inclusão de card informativo com o saldo total a receber diretamente na aba de dados bancários, facilitando a consulta rápida.
- **Refatoração da Listagem de Fornecedores**: Modernização completa da tela de lista (`SupplierList.jsx`) para seguir o padrão visual da área de Assinantes.
- **Cards de Resumo**: Adicionados cards premium no topo com métricas em tempo real (Total de Fornecedores, Ativos, Em Ativação).
- **Toolbar de Busca**: Implementada barra de pesquisa dinâmica com filtragem por Nome, CNPJ e Email.
- **Tabela Premium**: Refatoração da tabela com cabeçalhos estilizados, badges de status refinados e botões de ação intuitivos (Visualizar e Editar) com ícones `lucide-react`.
- **Navegação por Abas**: Implementação do design "Premium" com navegação por abas horizontais (Geral, Endereço, Financeiro, Extrato, Histórico).
- **Padronização Visual**: Aplicação de cantos arredondados (30px), gradientes de alta fidelidade (Slate 800/900), e overlays com blur (backdrop-filter).
- **Sistema de Temas (Dark/Light Mode)**: Implementação global com o componente `ThemeToggle`, persistência via `localStorage` e tokens CSS dinâmicos no `index.css`.
- **Responsividade Adaptativa**: Reestruturação de Dashboards com grids inteligentes e `max-width` global para visualização otimizada em monitores Ultra-Wide e dispositivos mobile.
- **Extrato Visual Refinado**: Redesign completo das linhas da tabela de extrato com ícones coloridos (`ArrowUpRight` / `ArrowDownLeft`) para distinguir aumentos de saldo e pagamentos.
- **Modernização da Usina (`PowerPlantModal`)**: Transição para navegação em abas (Geral, Analytics, Unidades), inclusão de card de resumo flutuante e sincronização de dados de performance em tempo real.
- **Status de Atraso Dinâmico**: Implementação de lógica de recálculo no frontend para exibir faturas como "atrasado" com base na data atual, complementando o status oficial do Asaas.

### 📈 Analytics e Inteligência (Usina)
- **Refatoração do PlantAnalyticsModal**: Novo seletor de períodos (1, 3, 6, 12 meses) e KPIs dinâmicos baseados no faturamento real do CRM e consumo das faturas.
- **Gráficos Híbridos (ComposedChart)**: Implementação de visualização mista (Barras/Área) com linhas de projeção de geração e teto de franquia das UCs.
- **Cálculo de Vacância e Rentabilidade**: Fórmulas corrigidas para refletir o benefício real gerado pela usina comparado ao valor investido.

### 💰 Funcionalidades Financeiras e Automação
- **Otimização de Consulta do Ledger**: Refatoração da query no `SupplierModal.jsx` para buscar por `supplier_id` e `reference_id` na view `view_ledger_enriched`, garantindo 100% de precisão nos lançamentos financeiros vinculados.
- **Segurança em Transações PIX**: Adicionada a exibição visual da **Chave PIX e Tipo** (CPF/CNPJ) nos modais de confirmação de pagamento (CRM) e resgate (App), prevenindo envios para contas incorretas.
- **Resgate Condicional (App do Fornecedor)**: Implementada lógica de visibilidade para o botão **"Resgatar Agora"**. O botão agora é ocultado automaticamente se a configuração `allow_auto_redemption` estiver desativada no CRM.
- **Paridade Financeira CRM vs App**: Ajuste na query `view_ledger_enriched` para utilizar `reference_id` e `account_code: '2.1.1'`, garantindo que o investidor visualize exatamente o mesmo saldo e extrato que o administrador.
- **Extrato de Faturamento (Fornecedores)**: Nova seção que exibe em tempo real os lançamentos do Livro Razão e o saldo acumulado do fornecedor.
- **Automação de Gestão B2W**: Lançamentos de "Taxa Fixa Gestão B2W" agora são calculados e registrados automaticamente como despesas extras (Conta 2.1.4) no fechamento mensal.
- **Filtros Inteligentes no Extrato**: Implementada lógica de ocultação de valores zerados para reduzir poluição visual nos extratos financeiros.
- **Busca por Referência**: Refinamento na busca de lançamentos contábeis para identificar entidades tanto por ID de referência quanto por descrição.
- **Deploy Automático**: Integração e deploy das atualizações no repositório `saas` via Git.
- **Melhoria no Cadastro**: Adicionada busca automática de endereço por CEP e integração aprimorada com API de dados de CNPJ no modal de fornecedores.
- **Correção de Lançamento de Produção**: Fix da persistência de dados de performance (coluna `mes_referencia`) ao efetuar lançamentos mensais da usina.
- **Enriquecimento de Dados de Performance**: Suporte à captura de Geração Real, Energia Injetada e Custo de Disponibilidade por competência.

---

## [2026-04-17] - Fix: Paginação e Captura de Contratos Autentique (10:45)

 ### Atualizações Registradas:
 1. **Correção de Truncagem de PDF**:
     - **Estabilização de Renderização**: Implementação de delay de 1500ms antes da captura para garantir que o DOM esteja totalmente montado antes do processamento pelo `html2canvas`.
     - **Lógica de Paginação (Split)**: Refatoração da função de divisão de conteúdo utilizando Regex robusta (`CLÁUSULA\s+7/i`) para garantir a quebra correta entre as 3 páginas do contrato principal.
     - **Garantia de 4 Páginas**: Ajuste no loop de captura para assegurar a inclusão obrigatória da Procuração (Página 4) e das seções intermediárias do contrato.
 2. **Infraestrutura e Segurança**:
     - **Fix de JWT**: Resolvido o erro `Unsupported JWT algorithm ES256` na Edge Function `create-autentique-document` através da desativação da validação de JWT no Gateway (`verify_jwt: false`), contornando incompatibilidades de algoritmo de assinatura.
     - **Fix de Importação**: Corrigido o `ReferenceError: shortenLink is not defined` no `SubscriberModal.jsx` através da inclusão do import faltante da função no destructuring de `../lib/api`.
 3. **Melhorias de Visual e Rastreabilidade**:
     - **Design Premium**: Aumento de padding, logos e tipografia nas páginas ocultas para gerar PDFs com estética profissional e respiro visual.
     - **Telemetria de Erros**: Adição de logs de console detalhados no frontend e logs de tamanho de payload (Base64) na Edge Function para monitoramento de integridade.
 3. **Correção de Build**:
     - Verificação e garantia da exportação de `shortenLink` em `api.js`, resolvendo erros de deploy de CI/CD.

---

 ## [2026-04-16] - Refinamento Contábil: Split de Receitas, Comissões e Rastreabilidade (20:30)

 ### Atualizações Registradas:
 1. **Visual e UI/UX (Ledger)**:
     - **Rastreabilidade Consolidada**: O filtro "Origem/Destino" agora busca em um campo unificado de **Entidade**, abrangendo Assinantes, Usinas, Fornecedores e Originadores.
     - **Rótulos Precisos**: Atualização dos nomes das contas contábeis para refletir a realidade dos contratos (ex: de "Obrigações Usina" para `2.1.1 - Repasse para o Investidor`).
     - **Extrato Detalhado**: Cada item de serviço da usina (Água, Energia, Internet, Manutenção, Arrendamento) agora possui sua própria linha no extrato, extinguindo lançamentos agrupados.

 2. **Funcionalidades e Regras de Negócio**:
     - **Inteligência de Split (Originador)**: Implementação da lógica de comissão **Start** (descontada do investidor na 1ª fatura) e **Recorrente** (descontada da receita GESTÃO B2W em todas as faturas).
     - **Gestão de Custos Operacionais**: Separação automática de despesas da usina (Água, Luz, Net) que são provisionadas na conta `2.1.4` para pagamento a terceiros.
     - **Receitas Próprias B2W**: Categorização individualizada de Manutenção e Arrendamento como receitas da empresa.
     - **Automação de Taxa Asaas**: Lançamento compulsório de R$ 0,99 (ou R$ 1,99 pós 19/04/2026) como despesa de taxa bancária para cada boleto recebido.
     - **Fluxo de Resgate**: Implementação de rastreio por `supplier_id` e `originator_id` no Ledger, permitindo que parceiros consultem e solicitem resgate de seus saldos credores acumulados.

 3. **Gatilhos e Lógica de Banco (Back-end)**:
     - **Trigger `handle_invoice_paid_ledger`**: Refatoração completa para suportar o split multi-beneficiário e detecção de primeira fatura.
     - **Liquidação Automática de Concessionária**: Integração do RPC `liquidate_concessionaria_payment` ao botão "Pagar" do financeiro, dando baixa automática no passivo da concessionária ao efetuar o pagamento do boleto.
     - **Views de Auditoria**: Criação de `view_investor_balances` e `view_originator_balances` para monitoramento de dívidas com parceiros em tempo real.

 ---

 ## [2026-04-16] - Refatoração Originadores e Automação Financeira (23:30)

 ## [2026-04-16] - Automação de Comissões e Estabilização de Interface (21:30)
 
 ### Atualizações Registradas:
 1. **Estabilização de Interface (Fix Navegação)**:
     - **Correção de Overlay Crítico**: Resolvido o bug onde o `HistoryTimeline` "sequestrava" a interface ao abrir como overlay de tela cheia dentro de modais.
     - **Padrão Inline**: Implementação de `isInline={true}` no componente de histórico nos modais de **Originador**, **Fornecedor**, **Unidade Consumidora**, **Leads** e **Assinantes**.
 2. **Funcionalidades Contábeis (Ledger)**:
     - **Split de Comissão Automatizado**: Sistema agora diferencia automaticamente **Primeira Fatura (Start + Recorrente)** de **Faturas Mensais (Recorrente)**.
     - **Base de Cálculo**: Padronização da base de comissão sobre `(Valor Pago - Conta de Energia)`.
     - **Liquidação Integrada**: Automação de contas a pagar (Água, Internet, Luz) da usina e baixa automática de dívida da concessionária no Ledger ao realizar o pagamento via CRM.
 3. **Gatilhos e Banco de Dados**:
     - **Trigger `handle_invoice_paid_ledger`**: Atualizado para processar os novos splits e descontos (Start descontado do Fornecedor, Recorrente da B2W).
     - **Views de Saldo**: Criação de `view_originator_balance` e `view_investor_balance` para rastreabilidade financeira imediata.

 ---

 ## [2026-04-16] - Módulo de Billing: Livro Razão e Extrato Detalhado (18:15)
 
 ### Atualizações Registradas:
 1. **Novo Módulo: Livro Razão (Ledger)**:
     - Integração completa do **Livro Razão** como uma nova aba no dashboard de Billing.
     - Implementação de filtros avançados por **Data**, **Descrição**, **Tipo (D/C)** e **Conta**.
     - **Busca por Origem/Destino**: Filtro inteligente que busca por nome em Usinas, Assinantes, Originadores e Fornecedores.
 2. **Infraestrutura de Dados**:
     - Atualização da view SQL `view_ledger_enriched` para incluir metadados de entidades (nomes), facilitando auditoria e filtragem.
 3. **UI/UX Reestruturada**:
     - Substituição do antigo modal "EXTRATO" por uma visualização integrada de 3 abas: **Kanban**, **Lista** e **Livro Razão**.
     - Dashboards compactos com somatórios de saldo no topo da área do extrato.

---

 ## [2026-04-16] - Automação Financeira e Estabilização de Webhooks (21:30)
 
 ### Atualizações Registradas:
 1. **Automação de Pagamento de Contas (Bills)**:
     - Implementação do motor de liquidação automática para contas de concessionária via API Asaas.
     - **Regra de Gatilho**: O pagamento é disparado no `asaas-webhook` assim que a fatura do assinante é confirmada como `pago`.
     - **Fix de Endpoint**: Correção crítica do endpoint de `/v3/bills` para `/v3/bill` e campo `identification` para `identificationField`.
 2. **Segurança e Estabilização**:
     - **Token de Acesso**: Implementada validação de `asaas-access-token` via banco de dados (`integrations_config`).
     - **Tratamento de Erros**: Adicionado log de resposta bruta para evitar crash de JSON em respostas vazias da API.
     - **Deploy CI/CD**: Inclusão das funções `asaas-webhook` e `pay-asaas-bill` no workflow de deploy do GitHub.
 3. **Manutenção e Recuperação**:
     - **Guarauto (Guanabara Auto Diesel)**: Execução manual de pagamentos de energia pendentes via API (Protocolos registrados na timeline).
     - **Ledger Entries**: Regularização manual do livro razão para faturas liquidadas durante a queda do webhook.

 ---

 ## [2026-04-15] - Sincronização Definitiva de Webhooks e Harmonização (20:30)
 
 ### Atualizações Registradas:
 1. **Fix Webhook Autentique V2**:
     - Mapeamento definitivo do payload aninhado: `event.type` para ação e `event.data.id` para identificação do documento.
     - Inclusão do suporte ao evento `document.finished` para atualização de status automático para "signed".
     - Prevenção de crash `toLowerCase` em payloads não-string.
 2. **Auditoria de Integrações**:
     - Ativação da tabela `webhook_logs` para rastreamento de payload, headers e status de todas as requisições externas.
 3. **Harmonização de Dependências**:
     - Padronização das Edge Functions (v2.45.0) para evitar erros de importação via CDN.

---

 ## [2026-04-13] - Identificação Jurídica e Fix GraphQL Autentique (18:15)
 
 ### Atualizações Registradas:
 1. **Validade Jurídica (Procuração)**:
     - Preenchimento dinâmico de todos os dados do Outorgante na página 4 do contrato (CPF/CNPJ e endereço completo).
     - Padronização da identificação da B2W Energia como Outorgada.
 2. **Padrão Autentique V2**:
     - Substituição do campo obsoleto `view_short_link` por `short_link` nas queries de criação e consulta.
     - Implementação de **Assinaturas Visíveis** configuradas para as linhas de assinatura específicas no PDF.

---

 ## [2026-04-10] - Resiliência em Comunicação e Normalização (14:40)
 
 ### Atualizações Registradas:
 1. **Sanitização de Contatos (DDI 55)**:
     - Gatilho automático para garantir que todos os números de WhatsApp possuam o prefixo do país, evitando falhas na Evolution API.
 2. **Melhoria no CRM History**:
     - Registro obrigatório de comunicados manuais na timeline do assinante, permitindo auditoria de conversas extras.
 3. **Restauração de Interface**:
     - Reativação e estilização do compositor de mensagens (aba Comunicados) com suporte a anexos.

---

 ## [2026-04-08] - Configurações de Energia e Infraestrutura (10:00)
 
 ### Atualizações Registradas:
 1. **Nova Seção: Conta de Energia**:
     - Implementação de painel de configuração para regras de liquidação.
     - Controle de **Pagamento Automático** (Toggle) para automatizar o fluxo financeiro entre assinante e concessionária.
 2. **Reestruturação de Funções**:
     - Migração das funções de webhook do Asaas e Autentique para o padrão de diretórios `supabase/functions/` para melhor manutenção.

---
 
## [2026-04-15] - Estabilização de Build, Edição de UC e Harmonização de Funções (23:45)
 
### Atualizações Registradas:
1. **Estabilização de Build (Frontend)**:
    - Limpeza de imports órfãos no `SubscriberModal.jsx` (removido `shortenLink`), garantindo sucesso no bundle de produção do Vite.
2. **Harmonização de Versões (Edge Functions)**:
    - Atualização global do `@supabase/supabase-js` para v2.45.0 em 5 funções críticas (`send-email`, `send-whatsapp`, `yourls-shorten`, etc.) para mitigar erros 522 do CDN `esm.sh`.
3. **Melhoria UX (Unidades Consumidoras)**:
    - Implementação do botão **Editar** (ícone Lápis) diretamente nos cards de UC no Modal do Assinante, permitindo acesso imediato à edição completa (`ucModalMode: all`).
4. **Precisão Financeira de Inadimplência**:
    - Refino do filtro de faturas em modais e cards globais para ignorar lançamentos com status **`cancelado`**, estabilizando o cálculo do "Total a Pagar".
5. **Comunicação (Comunicados)**:
    - Re-introdução do compositor manual de WhatsApp na aba Comunicados e suporte ao modo `isInline` para a Timeline Histórica.
 
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

### 2026-04-16 - Correção do Endpoint de Pagamento Asaas e Tratamento de Erro de JSON
- **Ajuste Técnico**: Correção do endpoint de `/v3/bills` para `/v3/bill` (singular) e campo `identification` para `identificationField` para compatibilidade com a API de produção do Asaas.
- **Tratamento de Erro**: Implementado check de `response.ok` e `responseText` no `asaas-webhook` antes do parsing de JSON, evitando o erro "Unexpected end of JSON input" quando a API do Asaas retorna corpos vazios ou erros 400+.
- **Manutenção**: Executados manualmente pagamentos pendentes do cliente Guarauto e regularizado o histórico no CRM.

### 2026-04-16 - Estabilização de Webhook e Refatoração de Segurança
2. **Nova Funcionalidade: Pagamento de Contas (`pay-asaas-bill`)**:
    - Implementação de Edge Function para pagamento de boletos externos e contas de consumo via linha digitável.
    - Proteção por autenticação e verificação de nível de acesso (`admin`/`superadmin`).
3. **Resolução de Erro 404 (Webhook)**:
    - Identificação e correção da ausência de deploy da função `asaas-webhook`.

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
    - **Ação Contextual**: Botão **BOLETO** movido para a coluna da fatura; Botões **PAGAR/PAGA** movidos para a coluna da conta de energia e o custo da concessionária.
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
