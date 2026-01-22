
-- Add Asaas Customer ID to subscribers
ALTER TABLE subscribers
ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

-- Add Asaas Payment details to invoices
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS asaas_payment_id TEXT,
ADD COLUMN IF NOT EXISTS asaas_boleto_url TEXT,
ADD COLUMN IF NOT EXISTS asaas_status TEXT;

-- Optional: Index for performance
CREATE INDEX IF NOT EXISTS idx_subscribers_asaas_id ON subscribers(asaas_customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_asaas_payment_id ON invoices(asaas_payment_id);
