
-- Inspect columns of Concessionaria table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'Concessionaria' OR table_name = 'concessionaria';

-- Select one row to see data keys (if JSON) or just to verify content
SELECT * FROM "Concessionaria" LIMIT 1;
