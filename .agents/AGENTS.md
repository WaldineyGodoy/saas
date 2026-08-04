# Contexto do Projeto: Gestão e Análise de Faturas de Energia

**Aviso a todos os Agentes:**
Para evitar conflitos com outros setores do sistema, o foco EXCLUSIVO do desenvolvimento e manutenção está no módulo "Standalone" de análise de energia e faturas.

## Componentes Principais (Frontend)
Qualquer edição ou nova funcionalidade deve girar em torno ou utilizar prioritariamente os seguintes arquivos:
- `src/pages/StandaloneAnalysis.jsx`
- `src/components/BatchInvoiceProcessor.jsx`
- `src/pages/StandaloneManagement.jsx`

## Tabelas no Banco de Dados (Supabase)
Todo o armazenamento, CRUD e consultas para este módulo acontecem estritamente nestas tabelas:
- `standalone_ucs`
- `standalone_contas`

**Diretriz de Segurança:** Não modifique componentes, rotas ou tabelas de outros setores a menos que explicitamente solicitado pelo usuário. Concentrem-se no escopo do Standalone acima.
