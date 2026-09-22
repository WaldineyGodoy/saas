-- Task 17 — so papel interno grava faturas e razao.
--
-- Regra do dono (22/09/2026): "embaixador nao pode marcar fatura como paga,
-- somente admins".
--
-- Estado anterior:
--   invoices        -> 1 politica "Enable all for authenticated users"
--                      (ALL, USING true, WITH CHECK true) para `authenticated`
--   ledger_entries  -> SELECT/INSERT/UPDATE/DELETE, todas com true
-- Ou seja: qualquer usuario logado — assinante, embaixador, lead — criava,
-- alterava, apagava fatura e lancava no razao. E a tela Faturas
-- (InvoiceListManager), com arrastar-para-Pago, aparecia no menu de todos os
-- papeis (src/pages/Dashboard.jsx, itens 5 e 6 do getMenuItems).
--
-- Papel interno = public.fn_papel_interno() (super_admin, admin, manager,
-- coordinator), criada na Task 15: SECURITY DEFINER, STABLE, sem parametro —
-- o id vem sempre de auth.uid() e nao da para forjar na chamada.
--
-- POR QUE POLITICA E NAO REVOKE DE GRANT
-- Revogar INSERT/UPDATE/DELETE de `authenticated` fecharia a porta para TODO
-- mundo que loga, inclusive o admin: grant e por papel do Postgres, e o CRM
-- inteiro (admin incluso) chega ao banco como `authenticated`. Quem distingue
-- uma pessoa da outra e a politica, que consulta profiles.role pelo auth.uid()
-- do JWT. Os grants ficam como estao.
--
-- POR QUE `USING (true)` NO UPDATE DE invoices
-- Politica de UPDATE com USING restritivo nao levanta erro: ela filtra a linha,
-- o comando atinge 0 linhas e volta "sucesso". A tela diria "fatura baixada" e
-- nada teria acontecido — pior do que a falha. Com USING (true) +
-- WITH CHECK (fn_papel_interno()) o banco recusa com SQLSTATE 42501 e a tela
-- mostra o motivo. Nao ha perda de rigor: fn_papel_interno() nao olha a linha,
-- entao nenhum UPDATE de papel nao interno passa. E os gatilhos que tem efeito
-- colateral (on_invoice_update, tr_invoice_paid_ledger, trg_notify_invoice_status,
-- tr_log_invoice_change) sao todos AFTER — com a recusa no WITH CHECK, nenhum
-- deles chega a rodar.
--
-- ROBOS E EDGE FUNCTIONS
-- faturista/emissor/enviador/recuperar (scraper/) e as Edge Functions que
-- escrevem fatura (create-asaas-charge, update-asaas-charge, asaas-webhook,
-- emissor, cron-monthly-expenses) usam a SERVICE_ROLE_KEY. `service_role` tem
-- BYPASSRLS: nenhuma destas politicas o alcanca. O gatilho de fatura paga
-- (handle_invoice_paid_ledger, SECURITY DEFINER desde a Task 16) tambem passa,
-- porque roda como o dono da tabela.
--
-- SELECT fica como esta (USING true). Esta tarefa e sobre escrita; fechar a
-- leitura mexeria em tela de assinante, de originador e no grafo, e nao e o
-- que o dono pediu.

-- ---------------------------------------------------------------- invoices
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.invoices;
DROP POLICY IF EXISTS invoices_select_authenticated ON public.invoices;
DROP POLICY IF EXISTS invoices_insert_interno ON public.invoices;
DROP POLICY IF EXISTS invoices_update_interno ON public.invoices;
DROP POLICY IF EXISTS invoices_delete_interno ON public.invoices;

CREATE POLICY invoices_select_authenticated ON public.invoices
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY invoices_insert_interno ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_papel_interno());

CREATE POLICY invoices_update_interno ON public.invoices
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (public.fn_papel_interno());

CREATE POLICY invoices_delete_interno ON public.invoices
  FOR DELETE TO authenticated
  USING (public.fn_papel_interno());

-- ---------------------------------------------------------- ledger_entries
-- A leitura continua aberta a quem loga: o painel "Minhas Comissoes" do
-- embaixador le a conta 2.1.2 dele, e o modal do fornecedor le a 2.1.1/1.1.3.
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.ledger_entries;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.ledger_entries;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.ledger_entries;
DROP POLICY IF EXISTS ledger_entries_insert_interno ON public.ledger_entries;
DROP POLICY IF EXISTS ledger_entries_update_interno ON public.ledger_entries;
DROP POLICY IF EXISTS ledger_entries_delete_interno ON public.ledger_entries;

CREATE POLICY ledger_entries_insert_interno ON public.ledger_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_papel_interno());

-- Aqui o USING restritivo e o certo: nenhuma tela altera ou apaga lancamento
-- do razao (o que existe e INSERT de ajuste, no SupplierModal, que e tela de
-- papel interno). Sem caminho de UI para quebrar, vale esconder a linha da
-- escrita em vez de recusa-la depois.
CREATE POLICY ledger_entries_update_interno ON public.ledger_entries
  FOR UPDATE TO authenticated
  USING (public.fn_papel_interno())
  WITH CHECK (public.fn_papel_interno());

CREATE POLICY ledger_entries_delete_interno ON public.ledger_entries
  FOR DELETE TO authenticated
  USING (public.fn_papel_interno());
