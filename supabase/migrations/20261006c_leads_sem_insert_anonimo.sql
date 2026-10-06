-- =====================================================================
-- Leads: fim do insert direto pelo publico
-- Data: 06/10/2026 · branch app-v1.3
--
-- O site publicado (PR #6, deploy de 06/10/2026) grava a simulacao por
-- fn_registrar_lead_publico, que aplica a trava por celular/e-mail, o
-- limite por hora e o campo armadilha (20261006b). Enquanto o insert
-- direto existisse, um robo contornaria tudo isso indo direto na tabela.
--
-- * anon: sem insert e sem a leitura "recem-inserido" (so servia ao insert
--   direto, que precisava ler a linha de volta);
-- * authenticated: insere so equipe interna ou o originador no proprio nome.
--   O ramo "status = simulacao" deixava qualquer login (assinante do app,
--   fornecedor) criar lead sem passar pela trava.
-- =====================================================================

DROP POLICY IF EXISTS leads_anon_insert_simulacao ON public.leads;
DROP POLICY IF EXISTS leads_anon_select_recem_inserido ON public.leads;

DROP POLICY IF EXISTS leads_authenticated_insert ON public.leads;
CREATE POLICY leads_authenticated_insert ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (public.fn_papel_interno() OR originator_id = auth.uid());
