-- Legacy cleanup
DROP POLICY IF EXISTS "Allow public insert on leads" ON public.leads;

-- Robust policy for Anonymous users
-- Allows INSERT, SELECT, UPDATE, DELETE only for rows with status = 'simulacao'
-- This ensures 'anon' can create the lead AND read it back (required for .select() call)
-- and protects other data.

CREATE POLICY "Anon allow all on leads simulacao"
ON public.leads
FOR ALL
TO anon
USING (status = 'simulacao')
WITH CHECK (status = 'simulacao');
