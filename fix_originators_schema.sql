
-- Garantir que TODAS as colunas necessárias existam na tabela originators
ALTER TABLE originators 
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT, 
ADD COLUMN IF NOT EXISTS address JSONB DEFAULT '{}'::jsonb, 
ADD COLUMN IF NOT EXISTS pix_key TEXT, 
ADD COLUMN IF NOT EXISTS split_commission JSONB DEFAULT '{"start": 0, "recurrent": 0}'::jsonb;
