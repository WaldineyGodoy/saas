-- Add 'cancelado' to fatura_status enum
ALTER TYPE fatura_status ADD VALUE IF NOT EXISTS 'cancelado';
