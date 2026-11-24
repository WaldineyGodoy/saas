-- 20261124a — páginas públicas: devolve o EXECUTE do anon e liga o Premium à Cosern
--
-- A home (b2wenergia.com.br) e o /contrato do CRM chamam estas RPCs como
-- visitante anônimo. O EXECUTE do anon sumiu por fora das migrações: nenhuma
-- migração do repo recria ou revoga essas funções depois da 20261111b, e o
-- último lead do site entrou em 13/11/2026 às 00:36 (antes: 15 a 19 por dia).
-- O navegador recebia "42501 permission denied for function
-- fn_registrar_lead_publico" e o visitante via "Ops, não conseguimos registrar".
--
-- São SECURITY DEFINER e validam tudo do lado do banco: o anon só chama.
-- NÃO revogar por causa do alerta do Supabase "security definer executável
-- por anon" — sem isso a home e a adesão pública param de gravar.
GRANT EXECUTE ON FUNCTION public.fn_registrar_lead_publico(jsonb, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_criar_assinante_publico(text, text, text, text, text, text, text, text, text, text, text, text, text, uuid, jsonb, integer, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_lead_adesao(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_estado(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_desconto_plano_vigente(text) TO anon;

-- Plano Premium disponível na Cosern (decisão do dono, 24/11/2026): a home
-- passa a oferecer Premium (20%) e Ultra Connect (15% + cashback) lado a lado,
-- e a adesão recusa plano que não atende a distribuidora da UC.
-- Efeito colateral aceito: adesão SEM plano escolhido deixa de cair no Ultra
-- automaticamente (havia um só plano na Cosern) e pega o desconto do município;
-- o plano é definido depois no CRM.
INSERT INTO public.planos_distribuidoras (plano_id, concessionaria)
VALUES ('b0298e43-9f01-4104-b77a-c01d3f30310c', 'Neoenergia Cosern')
ON CONFLICT (plano_id, concessionaria) DO NOTHING;

-- Conferência (deve devolver 5 linhas com anon_exec = true):
-- select proname, has_function_privilege('anon', oid, 'EXECUTE') anon_exec from pg_proc
--  where proname in ('fn_registrar_lead_publico','fn_criar_assinante_publico','fn_lead_adesao',
--                    'fn_onboarding_estado','fn_desconto_plano_vigente');
