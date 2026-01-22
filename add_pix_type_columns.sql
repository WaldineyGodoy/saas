-- Add pix_key_type column to originators_v2
ALTER TABLE public.originators_v2 
ADD COLUMN IF NOT EXISTS pix_key_type TEXT;

-- Add pix_key_type column to suppliers
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'suppliers') THEN
        ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS pix_key_type TEXT;
    END IF;
END $$;
