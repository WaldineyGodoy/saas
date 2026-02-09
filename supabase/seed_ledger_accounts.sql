-- Seed Ledger Accounts

-- 1. ASSETS (ATIVO)
INSERT INTO public.ledger_accounts (code, name, type, parent_id)
VALUES ('1.0.0', 'ATIVO', 'asset', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '1.1.0', 'Ativo Circulante', 'asset', id FROM public.ledger_accounts WHERE code = '1.0.0'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '1.1.1', 'Bancos e Equivalentes', 'asset', id FROM public.ledger_accounts WHERE code = '1.1.0'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '1.1.1.01', 'Banco Asaas', 'asset', id FROM public.ledger_accounts WHERE code = '1.1.1'
ON CONFLICT (code) DO NOTHING;

-- 2. LIABILITIES (PASSIVO)
INSERT INTO public.ledger_accounts (code, name, type, parent_id)
VALUES ('2.0.0', 'PASSIVO', 'liability', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '2.1.0', 'Passivo Circulante', 'liability', id FROM public.ledger_accounts WHERE code = '2.0.0'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '2.1.1', 'Obrigações com Usinas', 'liability', id FROM public.ledger_accounts WHERE code = '2.1.0'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '2.1.2', 'Comissões a Pagar', 'liability', id FROM public.ledger_accounts WHERE code = '2.1.0'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '2.1.3', 'Repasses a Concessionária', 'liability', id FROM public.ledger_accounts WHERE code = '2.1.0'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '2.1.3.01', 'Taxa CD/CIP', 'liability', id FROM public.ledger_accounts WHERE code = '2.1.3'
ON CONFLICT (code) DO NOTHING;

-- 3. INCOME (RECEITAS)
INSERT INTO public.ledger_accounts (code, name, type, parent_id)
VALUES ('3.0.0', 'RECEITAS', 'income', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '3.1.0', 'Receita Operacional', 'income', id FROM public.ledger_accounts WHERE code = '3.0.0'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '3.1.1', 'Taxa de Gestão B2W', 'income', id FROM public.ledger_accounts WHERE code = '3.1.0'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '3.1.2', 'Multas e Juros Recebidos', 'income', id FROM public.ledger_accounts WHERE code = '3.1.0'
ON CONFLICT (code) DO NOTHING;

-- 4. EXPENSES (DESPESAS)
INSERT INTO public.ledger_accounts (code, name, type, parent_id)
VALUES ('4.0.0', 'DESPESAS', 'expense', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '4.1.0', 'Despesas Financeiras', 'expense', id FROM public.ledger_accounts WHERE code = '4.0.0'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '4.1.1', 'Taxas Bancárias (Asaas)', 'expense', id FROM public.ledger_accounts WHERE code = '4.1.0'
ON CONFLICT (code) DO NOTHING;
