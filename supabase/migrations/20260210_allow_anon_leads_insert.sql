-- Allow anonymous users (e.g. from Landing Page Simulator) to insert leads
-- This is required for the public-facing layout/simulation to work.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'leads' 
        AND policyname = 'Allow public insert on leads'
    ) THEN
        CREATE POLICY "Allow public insert on leads"
        ON public.leads
        FOR INSERT
        TO anon
        WITH CHECK (true);
    END IF;
END
$$;
