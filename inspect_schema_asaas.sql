
-- Check for likely table names for Invoices and Subscribers
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';

-- Once we know the table names, we can check columns. 
-- Tentatively checking 'faturas' and 'assinantes' if they exist.
SELECT 
    table_name, 
    column_name, 
    data_type 
FROM 
    information_schema.columns 
WHERE 
    table_name IN ('faturas', 'invoices', 'assinantes', 'subscribers', 'users', 'consumer_units')
ORDER BY table_name, ordinal_position;
