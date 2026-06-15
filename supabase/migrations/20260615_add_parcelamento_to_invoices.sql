-- Adiciona a coluna parcelamento à tabela invoices para armazenar o valor extraído no OCR
ALTER TABLE invoices
ADD COLUMN parcelamento numeric(10,2) DEFAULT 0;
