ALTER TABLE invoices
ADD COLUMN parent_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
