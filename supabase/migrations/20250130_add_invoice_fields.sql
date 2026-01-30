ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS iluminacao_publica decimal(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tarifa_minima decimal(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS outros_lancamentos decimal(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS consumo_reais decimal(10,2) DEFAULT 0;
