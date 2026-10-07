-- Views apontadas pelo Security Advisor (04/10/2026).
--
-- mv_closed_invoices_financials: financeiro por fatura (valor e lancamentos do
-- razao), legivel por anon e por qualquer login. Nenhum codigo do repositorio
-- le esta view; o refresh roda como dono.
revoke select on public.mv_closed_invoices_financials from anon, authenticated;

-- view_concessionarias_resumo: tarifas por concessionaria (dado publico),
-- usada nas configuracoes do CRM (logado). So tira o acesso sem login.
revoke select on public.view_concessionarias_resumo from anon;
