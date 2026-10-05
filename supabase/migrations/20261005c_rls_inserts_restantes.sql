-- Inserts que ainda aceitavam qualquer um (complemento de 20261005b).
--
--   webhook_logs: qualquer pessoa, ate sem login, gravava log falso. So os
--                 webhooks gravam, e eles usam service_role.
--   irradiancia:  policy "Admin Insert" com condicao true: qualquer login.
--   leads:        qualquer login criava lead em nome de qualquer originador.
--                 Quem cria de verdade: equipe, o originador (LeadModal grava
--                 originator_id = ele mesmo) e a simulacao publica
--                 (LeadCaptureForm, status 'simulacao', igual a regra do anon).

drop policy if exists "Enable insert for authenticated users and service role" on public.webhook_logs;
create policy webhook_logs_insert_interno on public.webhook_logs
    for insert to authenticated with check (public.fn_papel_interno());

drop policy if exists "Admin Insert Irradiance" on public.irradiancia;
create policy irradiancia_insert_interno on public.irradiancia
    for insert to authenticated with check (public.fn_papel_interno());

drop policy if exists leads_authenticated_insert on public.leads;
create policy leads_authenticated_insert on public.leads
    for insert to authenticated
    with check (public.fn_papel_interno() or originator_id = auth.uid() or status = 'simulacao'::lead_status);
