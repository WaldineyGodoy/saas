-- Migration: 20260918a_bucket_portal_sessions
-- Description: bucket privado onde o robô guarda a sessão autenticada de cada
--              titular no portal da concessionária (ver scraper/lib/sessao.js).
--
-- POR QUE EXISTE
-- Sem sessão persistida, o faturista refaz o login completo a cada rodada e o
-- WAF do portal vê sempre um cliente sem histórico — o perfil que ele desafia.
-- Guardando o storageState (cookies + localStorage), o login passa a acontecer
-- por expiração, não por execução.
--
-- SEGURANÇA
-- O conteúdo é uma sessão autenticada: quem tem o arquivo entra no portal como
-- o titular, sem precisar da senha. Vale o mesmo cuidado que a senha recebeu na
-- migração do Vault (fn_get_portal_credentials).
--
-- Por isso o bucket é privado e fica SEM NENHUMA POLICY. Storage roda com RLS
-- ligado, então ausência de policy significa: ninguém no CRM lê, nem usuário
-- autenticado, nem anônimo. Só o service_role — que ignora RLS — alcança, e é
-- exatamente com ele que o robô sobe.
--
-- ⚠️ Não crie policy de leitura para `authenticated` aqui. Qualquer usuário
--    logado no CRM passaria a conseguir baixar a sessão de qualquer titular.

insert into storage.buckets (id, name, public)
values ('portal-sessions', 'portal-sessions', false)
on conflict (id) do nothing;
