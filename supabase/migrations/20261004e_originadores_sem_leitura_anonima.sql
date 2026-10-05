-- originators_v2: fim da leitura anonima.
--
-- A 20260817d ja tinha cortado a leitura sem sessao para (id, name, phone,
-- short_url) por GRANT; em producao sobravam (id, phone): a lista completa de
-- telefones dos parceiros, para qualquer um com a chave publicavel.
--
-- O motivo da policy (SubscriberSignup avisar o originador por WhatsApp) nao
-- existe mais no front: a adesao publica passa por fn_criar_assinante_publico
-- e pelas edge functions (service_role), e o nome do originador no convite
-- vem da propria URL. Nos logs de 04/10/2026 nenhuma leitura anonima.
--
-- Quem tem login continua com as policies "propria ou interno" e a do lider.

drop policy if exists originators_v2_anon_referral on public.originators_v2;
revoke select on public.originators_v2 from anon;
revoke select (id, name, phone, short_url) on public.originators_v2 from anon;
