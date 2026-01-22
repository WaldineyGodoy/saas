
ALTER TABLE public.usinas 
ADD COLUMN IF NOT EXISTS service_values JSONB DEFAULT '{}'::jsonb;
