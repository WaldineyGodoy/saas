-- C1 — o portao de envio era contornavel por `notification_triggers`.
--
-- O DEFEITO
-- A tabela tinha quatro politicas para `authenticated`, todas com `true`:
--   SELECT / INSERT / UPDATE / DELETE  ->  "Enable * for authenticated users"
-- Ou seja: qualquer pessoa logada — assinante, embaixador, lead, fornecedor —
-- criava uma regra de gatilho. E a regra nao e um registro inerte:
--
--   1. `fn_process_notification_triggers()` (SECURITY DEFINER) roda nos gatilhos
--      AFTER de leads/subscribers/consumer_units/invoices/suppliers/
--      financial_transfer. Ela le as linhas de `notification_triggers` e, para
--      cada uma, insere em `notification_logs` com `body` =
--      `message_body` da regra (texto livre) e `recipient` = telefone resolvido
--      OU cada item de `custom_recipients`, uma lista livre separada por ";".
--   2. `fn_check_invoice_due_reminders()` (SECURITY DEFINER) faz o mesmo pelo
--      caminho de vencimento de fatura.
--   3. `fn_dispatch_notification()` (SECURITY DEFINER) dispara cada linha
--      `pending` de `notification_logs` para send-whatsapp / send-email com o
--      segredo interno do Vault.
--
-- Resultado: texto arbitrario, para destino arbitrario, saindo do WhatsApp e do
-- e-mail da empresa, sem limite de taxa. A Task 12 (20260921f) fechou o INSERT
-- direto em `notification_logs` ao papel interno, mas o desvio por
-- `notification_triggers` continuava aberto — o INSERT no log passa a ser feito
-- pela funcao SECURITY DEFINER, que roda como dona e nao e alcancada pela
-- politica do log. Fechar o log sem fechar o gatilho e trancar a porta e deixar
-- a janela.
--
-- QUEM ESCREVE LEGITIMAMENTE (levantado antes de aplicar)
--   - src/pages/settings/TriggerMessageDashboard.jsx  (SELECT, UPDATE is_active,
--     DELETE)
--   - src/pages/settings/components/MessageTriggerModal.jsx (INSERT/UPDATE)
--   Ambas vivem dentro de SettingsLayout, e o item "Configuracoes" do menu
--   (src/pages/Dashboard.jsx, item 10) so entra para ['admin','super_admin'] —
--   os dois dentro de fn_papel_interno(). Nenhuma Edge Function e nenhum robo
--   (scraper/) escreve nesta tabela; conferido por varredura. Logo, nenhum
--   escritor legitimo perde acesso com esta migracao.
--
-- POR QUE POLITICA E NAO REVOKE (mesma razao da 20260922h)
-- Revogar o grant fecharia para todo mundo que loga, admin inclusive: o CRM
-- inteiro chega ao banco como `authenticated`. Quem distingue as pessoas e a
-- politica, que le profiles.role pelo auth.uid() do JWT.
--
-- POR QUE `USING (true)` NO UPDATE
-- UPDATE com USING restritivo nao levanta erro: filtra a linha, o comando
-- atinge 0 linhas e o PostgREST devolve sucesso. O botao ATIVO/INATIVO do
-- painel mostraria "Gatilho ativado!" sem ter ativado nada. Com USING (true) +
-- WITH CHECK (fn_papel_interno()) o banco recusa com SQLSTATE 42501 e a tela
-- cai no catch. Nao ha perda de rigor: fn_papel_interno() nao olha a linha,
-- entao nenhum UPDATE de papel nao interno passa.
-- No DELETE o USING restritivo fica (padrao da 20260922h): o painel ja pergunta
-- antes de apagar e a linha simplesmente nao existe para quem nao e interno.
--
-- SERVICE ROLE
-- `service_role` tem BYPASSRLS; robos e Edge Functions (se um dia escreverem
-- aqui) nao sao atingidos.
--
-- SELECT FICA COMO ESTA (USING true), de proposito: esta tarefa e sobre
-- escrita, e o que a leitura expoe hoje nao muda com esta migracao.

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.notification_triggers;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.notification_triggers;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.notification_triggers;
DROP POLICY IF EXISTS notification_triggers_insert_interno ON public.notification_triggers;
DROP POLICY IF EXISTS notification_triggers_update_interno ON public.notification_triggers;
DROP POLICY IF EXISTS notification_triggers_delete_interno ON public.notification_triggers;

CREATE POLICY notification_triggers_insert_interno ON public.notification_triggers
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_papel_interno());

CREATE POLICY notification_triggers_update_interno ON public.notification_triggers
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (public.fn_papel_interno());

CREATE POLICY notification_triggers_delete_interno ON public.notification_triggers
  FOR DELETE TO authenticated
  USING (public.fn_papel_interno());
