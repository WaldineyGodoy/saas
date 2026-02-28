-- Adiciona a coluna outros_lancamentos à tabela invoices para permitir ajustes manuais
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS outros_lancamentos numeric;
COMMENT ON COLUMN public.invoices.outros_lancamentos IS 'Registra outros lançamentos ou ajustes na fatura';
