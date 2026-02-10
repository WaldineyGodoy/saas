-- Force RLS policy for anonymous inserts on leads
-- We drop first to ensure we are not skipping due to 'IF EXISTS' checks on an incorrect policy.

DROP POLICY IF EXISTS "Allow public insert on leads" ON public.leads;

CREATE POLICY "Allow public insert on leads"
ON public.leads
FOR INSERT
TO anon
WITH CHECK (true);

-- Ensure table permissions are granted to the role
GRANT INSERT ON public.leads TO anon;
GRANT SELECT ON public.leads TO anon; -- Often needed if returning data

-- Grant usage on sequences if ID is serial (though UUID is used likely)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
