# Playbook CRM (Administrativo)

Este documento centraliza as regras de negócio, fluxos de trabalho, gatilhos e identidade visual do CRM.

---

## 1. Módulos Principais

### 👥 Gestão de Assinantes (Subscribers)
Controle do ciclo de vida dos clientes e visão 360º.
- **Gestão de Contratos (Autentique V2)**:
    - **Identificação Jurídica**: A Procuração exige identificação completa do Outorgante (CPF/CNPJ, Endereço completo com CEP) e Outorgado (B2W Energia).
    - **Assinaturas Visíveis**: Configuradas para aparecerem em campos específicos das páginas 3 (Contrato) e 4 (Procuração).
- **Dashboard**: Tabela de alta densidade e **Cards de Resumo** (Total Mês/Global).
- **Filtro Financeiro**: Faturas com status `cancelado` são explicitamente ignoradas nos cálculos de débito e na visualização do modal do assinante.

### ⚡ Gestão de Unidades Consumidoras (UCs)
Monitoramento técnico e operacional de leituras.
- **Interface Modernizada (`ConsumerUnitModal`)**: Navegação por 4 abas superiores.
- **Visualização Padrão**: Definida como **Calendário** para facilitar o acompanhamento das datas de leitura e status de extração.
- **Edição Direta**: Os cards de UC no Modal do Assinante possuem botão de edição rápida (ícone Lápis) para acesso completo aos dados.
- **Campos Informativos (Read-only)**: Os componentes tarifários (Tarifa, TE, TUSD e Fio B) no modal de UC são configurados como apenas leitura para evitar edições manuais inconsistentes com a tabela global de tarifas.

### 💰 Gestão de Faturas (Billing)
Faturamento mensal, integração bancária e automação de cobrança.
- **Visualização em Lista (Grid Financeiro)**: Reestruturada para exibir **Vr. da Fatura**, **Vr. Conta de Energia** (fonte destacada em vermelho) e **Saldo** (lucro líquido por fatura).
- **Ações Rápidas**: Links de Boleto e botões de Pagamento posicionados junto aos seus respectivos valores para agilidade operacional.
- **Novo Modal de Faturamento (`InvoiceFormModal`)**: Refatorado para navegação por abas horizontais (**Identificação, Consumo, Financeiro, Resumo**).
- **Pagamento de Boletos Externos (`pay-asaas-bill`)**: Funcionalidade para liquidação de contas de consumo (água, luz) e boletos bancários via linha digitável, protegida por autenticação administrativa.
- **Competência Manual**: Introdução de seletor de mês/ano para faturas manuais, permitindo lançamentos de valor zero ou ajustes retroativos sem violação de chaves únicas.
- **Aba Resumo**: Centraliza o card de detalhamento e as ações de download/visualização, otimizando o fluxo de conferência.
- **Calendários de Vencimento**: Dualidade de visão entre **Venc. Faturas** (B2W) e **Venc. Conta de Energia** (Concessionária).

### 🏗️ Gestão de Inventário e Obras
Monitoramento de insumos para projetos de infraestrutura (ex: UFV Bom Jesus II).
- **Controle de Materiais**: Registro de pedidos, fornecedores e custos unitários na tabela `materials_inventory`.
- **Rastreabilidade**: Vinculação de compras a projetos específicos para controle de saldo residual de oba.

### 🏢 Gestão de Parceiros (Originadores e Fornecedores)
Cadastramento e acompanhamento de parceiros estratégicos.
- **Paridade de Auditoria**: Possuem a mesma aba **Comunicados** e **Timeline de Histórico** que os Assinantes.
- **Auditoria de Cadastro**: Logs automáticos para criação, edição e ativação de perfis.

### 🏭 Gestão de Usinas (Power Plants)
Monitoramento de geração e performance de ativos solares.
- **Interface Premium (`PowerPlantModal`)**: Navegação por abas (**Geral**, **Analytics**, **Unidades Vinculadas**) e card de resumo flutuante para KPIs rápidos.
- **Analytics Detalhado**: Gráficos híbridos (Barras/Área) com seletor de períodos (1-12 meses) para análise de geração vs franquia.
- **Lançamentos de Performance**: Captura mensal de Geração Real, Energia Injetada e Custo de Disponibilidade por competência.

### 🎯 Prospecção (Leads)
Funil de entrada de novos assinantes.
- **Histórico de Contato**: Timeline dedicada para registrar ligações, visitas e envios de proposta via WhatsApp.
- **Conversão Direta**: Fluxo simplificado de transformação de Lead em Assinante com preservação do histórico de auditoria.

---

## 2. Regras de Negócio e Lógica Financeira

### ⚖️ Cálculo de Indicadores e Tarifas
- **Total no Mês**: Baseado na **Data de Vencimento** (inclui `atrasado` e `a_vencer`).
- **Recálculo Dinâmico**: Tarifas mínimas e descontos baseados no tipo de ligação (**Mono/Bi/Trifásico**).
- **Status de Atraso em Tempo Real**: O sistema recalcula o status para `atrasado` no frontend se a data atual for superior ao `dia_vencimento`, garantindo visibilidade imediata mesmo antes do processamento do webhook financeiro.
- **Self-Healing (Auto-Correção)**: Detecção e limpeza de faturas órfãs no Asaas.
- **Normalização de Status**: Todas as verificações financeiras utilizam `.trim().toLowerCase()` para garantir compatibilidade entre banco de dados e interface.

### 📊 Ciclo de Leitura e Notificação
- **Auto-Geração no Reenvio**: Se o PDF consolidado for removido ou não existir no Storage, ele é gerado automaticamente ao disparar um "Reenviar Notificação".
- **Logs de Diagnóstico**: Alertas no console para identificar falhas de renderização em componentes ocultos (capture targets).

---

## 3. Gatilhos e Automações (Triggers)

- **Mensageria Híbrida**: Disparo simultâneo (Resend + Evolution API).
- **WhatsApp Premium**: Texto com emojis e formatação otimizada.
- **Normalização de Contatos**: O sistema obrigatoriamente adiciona o prefixo **55** (DDI Brasil) a todos os números de WhatsApp antes do envio via Evolution API para prevenir erros de entrega.
- **Registro de Comunicados**: Mensagens enviadas manualmente via aba "Comunicados" são registradas na `crm_history` com o link do anexo (se houver).
- **Inadimplência Automática**: 15 dias (`Inadimplente`) e 60 dias (`Cancelamento Crítico`).
- **Liquidação Automática (Conta de Energia)**: Quando o toggle **"Pagamento Automático"** está ativo nas Configurações, o sistema dispara a ordem de pagamento da fatura da concessionária imediatamente após a compensação da fatura do assinante no Asaas. O sistema utiliza o endpoint `/v3/bill` (singular) e valida a resposta em texto bruto para evitar erros de parsing de JSON.
- **Permissão de Resgate Automático**: Controle global que habilita ou desabilita a funcionalidade de solicitação de saque via PIX diretamente no Dashboard do Fornecedor, baseando-se na configuração `allow_auto_redemption` do módulo financeiro.

---

## 4. Configurações e Parâmetros do Sistema

O CRM centraliza as chaves de integração e regras de processamento em um painel unificado.

### ⚙️ Módulos de Configuração
- **Perfil de Usuários (`Users`)**: Gestão de acessos e permissões (Roles).
- **Evolution API (`Code`)**: Instância e chaves do WhatsApp para mensageria.
- **Serviço de e-mail (`Mail`)**: Credenciais do Resend para notificações transacionais.
- **Integração Financeira (`CreditCard`)**: Centraliza o endpoint e as chaves do Asaas (Sandbox/Produção). Os dados são consumidos dinamicamente pelas Edge Functions da tabela `integrations_config` (serviço: `financial_api`). Inclui o controle de **Resgate Automático** para parceiros.
- **Conta de Energia (`Zap`)**: Regras de faturamento, **Pagamento Automático** e **Tarifas Concessionárias**.
- **Tarifas Concessionárias**: Área dedicada para o gerenciamento global de tarifas (TE, TUSD, Fio B) e descontos por distribuidora. Possui filtros avançados por Concessionária, Cidade e UF, com atualização em lote para todos os municípios atendidos.
- **Audit de Webhooks (`Telescope`)**: Interface de monitoramento de logs da tabela `webhook_logs` (captura payloads brutos, headers e erros de integração).

---

## 5. Padrões de Layout e UX

### 📐 Estrutura de Documentos (PDF Consolidado)
1. **Capa (Resumo B2W)**: Design em cards por UC.
    - **Nomenclatura Padrão**: Downloads seguem o padrão `Fatura_Cliente_UC_Mes_Ano.pdf` (Individuais) ou `Fatura_Consolidada_Cliente_Mes_Ano.pdf` (Consolidadas).
    - **Captura Técnica**: Timeout de **2000ms** obrigatório para garantir o carregamento total de logotipos e fontes externas (Manrope).
    - **Safe Access**: Mapeamento de itens de fatura com navegação segura (`?.`) para evitar crashes `undefined`.
    - **Tipografia**: Nome do Assinante em **18px (Extra-Bold)** | Economia em **14px (Extra-Bold)**.
2. **Pagamento (Boleto Asaas)**.
3. **Comprovação (Faturas Originais)**: Anexo recursivo.

### 🎨 Design System e Estética
- **Tipografia**: Fonte **Manrope**.
- **Branding**: Azul Marinho, Laranja e Verde.
- **Selo de Qualidade**: **"Eficiência Energética Nível A+"**.
- **Sistema de Temas (Dark/Light Mode)**: Suporte global com o componente `ThemeToggle`, persistência via `localStorage` e tokens CSS dinâmicos (HSL-based) no `index.css`.
- **Responsividade Adaptativa**: Layout estruturado com `max-width` e grids inteligentes para visualização otimizada em monitores Ultra-Wide (PC) e dispositivos mobile.

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

## 8. Gestão de Contratos Digitais (Autentique)

Fluxo automatizado para geração, envio e monitoramento de assinaturas.
- **Motor de PDF**: Geração dinâmica com paginação automática (suporta contratos de 17+ cláusulas).
- **Integração YOURLS**: Encurtamento automático do link de assinatura antes do envio ao cliente para melhorar a experiência mobile.
- **Webhooks V2**: Processamento de payloads aninhados (`event.type` e `event.data.id`) para sincronização instantânea. 
- **Evento Crítico**: O sistema reconhece `document.finished` como o gatilho final para mudar o status da assinatura para **Assinado**.
- **Link Persistente**: O link de assinatura fica disponível no histórico do assinante até a conclusão.

---

## 9. Especificações Técnicas: Edge Functions

### 🔗 E-mail Engine (Resend)
- **URL**: `.../functions/v1/send-email`
- **Versão**: Supabase-JS `2.45.0` (Harmonizado para estabilidade de build).

### 💬 WhatsApp (Evolution API)
- **Versão**: Supabase-JS `2.45.0` | Endpoint `sendMedia` v2.

### 💳 Financeiro (Asaas)
- **Segurança de Credenciais**: Todas as funções financeiras (`create_asaas_charge`, `manage_asaas_customer`, `transfer_asaas_pix`, `pay_asaas_bill`) buscam chaves (`api_key` e `endpoint_url`) dinamicamente no banco de dados.
- **Webhooks**: A função `asaas-webhook` opera com `verify_jwt = false` no `config.toml`, permitindo o recebimento de notificações diretas do Asaas.

---

## 10. Rastreabilidade
- **Ações**: `email_sent`, `wa_sent`, `fatura_emitida`, `contract_signed`.
- **Auditoria**: Timeline registra ambiente (Sandbox/Prod).
- **Interatividade**: Suporte a mensagens expansíveis (`expand/collapse`) para visualização de logs longos (Ex: JSON de Webhooks ou payloads de WhatsApp).
- **Segurança de Cache**: Uso de `key={id}` na montagem de modais para garantir que a timeline mostrada pertença estritamente ao registro selecionado, eliminando dados residuais de buscas anteriores.
- **Logs de UI**: Histórico de mudanças de layout e visualização padrão.

---

## 11. Log de Atualizações Recentes

### 📅 28 de Abril de 2026 (20:00)
- **Nomenclatura de Documentos**: Implementação de nomes de arquivos descritivos e higienização de strings para downloads de PDF.
- **Proteção de Tarifas**: Bloqueio de edição manual nos campos de componentes tarifários no modal de UC.
- **Otimização de Performance (Tarifas)**: Criação da View SQL `view_concessionarias_resumo` para processar o agrupamento de concessionárias no servidor, permitindo a gestão fluida de 5.200+ municípios no frontend.
- **Segurança de Segredos (GitHub)**: Migração total de segredos (Mapbox e Supabase) para o GitHub Secrets e atualização do workflow de deploy para injeção em tempo de build.
- **Cálculos Automáticos**: Automação da soma TE + TUSD para o campo "Tarifa Final" e correção da exibição percentual de descontos.
- **Fix de Usinas**: Correção da persistência de geração mensal (`geracao_mensal_kwh`) e sincronização com projeções do `IrradianceChart`.
- **Estabilização de Funções**: Migração de imports `esm.sh` para `npm` specifiers em todas as Edge Functions críticas.

### 📅 21 de Abril de 2026 (20:45)
- **Modernização de Interface**: Implementação do sistema de Temas (Dark/Light) e Refatoração do `PlantAnalyticsModal` com KPIs baseados em faturamento real e gráficos híbridos.
- **Gestão de Usinas Premium**: Transição do `PowerPlantModal` para sistema de abas e resumo flutuante.
- **Status Dinâmico**: Lógica de "overdue" em tempo real no frontend para faturas vencidas.
- **Fix Financeiro**: Correção da coluna `mes_referencia` para persistência de dados de produção das usinas.
- **Dashboards Responsivos**: Reestruturação de grids para suportar visualização em resoluções PC superiores a 1920px.

### 📅 15 de Abril de 2026 (20:30)
- **Assinante Vinculado à UC**: Select adicionado na Aba de Vínculos da UC, explicitando o real dono daquele ponto de energia.
- **DDI 55 no WhatsApp**: Implementação de higienização de contatos com prepends universais de DDI 55 no servidor.
- **Asaas em Banco de Dados**: Edge functions de cobrança 100% integradas à tabela de configuração (`integrations_config`).
- **Upsert na Fatura Zerada**: Faturas manuais forçam a substituição segura e evitam erros de chave única com faturas outrora canceladas.
- **Self-Healing Financeiro**: Remoção absoluta de faturas inativas ("Canceladas") das fórmulas de Inadimplência, estabilizando cálculos.

### 📅 15 de Abril de 2026 (20:30)
- **Sincronização Autentique**: Correção do mapeamento de payload V2 (Nested JSON) e suporte a `document.finished`.
- **Identificação Jurídica**: Implementação de preenchimento dinâmico de dados de endereço na Procuração.
- **Auditoria**: Ativação da tabela `webhook_logs` para rastreamento de integrações externas.
- **Sanitização**: Normalização obrigatória de DDI 55 em todos os disparos de WhatsApp.

### 📅 15 de Abril de 2026 (11:30)
- **Harmonização de Funções**: Upgrade global do `supabase-js` para v2.45.0 em todas as Edge Functions.
- **Edição Expressa de UC**: Adicionado botão de edição rápida nos cards de UC no modal do assinante.
- **Encurtador de Links**: Ativação da integração YOURLS para dashboards e contratos.
- **Filtro de Inadimplência**: Implementação de limpeza de faturas canceladas nos cálculos de débito global.
- **Compositor de Mensagens**: Restauração da interface de envio manual na aba Comunicados.

### 📅 08 de Abril de 2026 (10:00)
- **Configurações de Energia**: Implementação da seção "Conta de Energia" e do toggle de Pagamento Automático.
- **Reestruturação Técnica**: Padronização da hierarquia de pastas das Edge Functions do Asaas e Autentique.
