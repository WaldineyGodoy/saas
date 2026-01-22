
-- 1. Create table if it doesn't quite exist or just ensure it's there (it is, but let's be safe)
CREATE TABLE IF NOT EXISTS originators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT
);

-- 2. Add all potentially missing columns
ALTER TABLE originators 
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT, 
ADD COLUMN IF NOT EXISTS address JSONB DEFAULT '{}'::jsonb, 
ADD COLUMN IF NOT EXISTS pix_key TEXT, 
ADD COLUMN IF NOT EXISTS split_commission JSONB DEFAULT '{"start": 0, "recurrent": 0}'::jsonb;

-- 3. Force PostgREST schema cache reload
NOTIFY pgrst, 'reload config';
