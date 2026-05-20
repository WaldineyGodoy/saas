-- Migration: Add column saldo_kwh to public.invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS saldo_kwh NUMERIC DEFAULT 0;
