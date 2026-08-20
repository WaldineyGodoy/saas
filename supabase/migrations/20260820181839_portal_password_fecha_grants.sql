-- O revoke from public nao bastou: o projeto tem default privileges que
-- concedem EXECUTE de toda funcao nova em public para anon e authenticated.
-- Sem revogar desses papeis nominalmente, a leitura da senha continuaria
-- aberta a qualquer usuario logado -- que e exatamente o buraco a fechar.

revoke all on function public.fn_get_portal_credentials(text, uuid) from public, anon, authenticated;
grant execute on function public.fn_get_portal_credentials(text, uuid) to service_role;

-- Escrever pode; ler nao. anon continua de fora dos dois.
revoke all on function public.fn_set_portal_password(text, uuid, text) from public, anon;
grant execute on function public.fn_set_portal_password(text, uuid, text) to authenticated, service_role;
