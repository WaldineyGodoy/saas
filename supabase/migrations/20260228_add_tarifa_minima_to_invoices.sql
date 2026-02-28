-- Adiciona a coluna tarifa_minima à tabela invoices para compatibilidade com o frontend do portal do assinante
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tarifa_minima numeric;
COMMENT ON COLUMN public.invoices.tarifa_minima IS 'Registra o valor da tarifa mínima da fatura';
