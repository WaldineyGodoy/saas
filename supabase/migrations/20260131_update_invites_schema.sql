-- Add company_name to originators_v2
ALTER TABLE originators_v2 ADD COLUMN IF NOT EXISTS company_name text;

-- Add 'convite_enviado' to lead_status enum
-- Postgres allows adding values to enum inside transaction in newer versions, 
-- but sometimes it's safer to do it conditionally or catch error if it exists.
-- However, 'IF NOT EXISTS' for enum value is not standard SQL.
-- We will try to add it. If it fails (already exists), it might error, but usually this unique migration runs once.

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'convite_enviado';
