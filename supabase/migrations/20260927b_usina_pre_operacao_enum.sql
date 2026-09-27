-- Pre-Operacao: usina em obra, antes do pedido de conexao.
--
-- Sozinho de proposito: um valor novo de enum nao pode ser usado na mesma
-- transacao que o cria. A 20260927c e' quem passa a usa-lo.
alter type public.usina_status add value if not exists 'pre_operacao' before 'em_conexao';
