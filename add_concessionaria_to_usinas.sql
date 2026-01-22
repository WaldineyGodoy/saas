
-- Migration to add concessionaria to usinas table
ALTER TABLE usinas ADD COLUMN IF NOT EXISTS concessionaria TEXT;

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'usinas';
