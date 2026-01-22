-- Add unique constraint to cpf_cnpj in subscribers table
ALTER TABLE public.subscribers ADD CONSTRAINT subscribers_cpf_cnpj_key UNIQUE (cpf_cnpj);

-- Create index for faster lookups if it doesn't exist automatically (UNIQUE constraint usually creates one)
-- CREATE INDEX IF NOT EXISTS idx_subscribers_cpf_cnpj ON public.subscribers(cpf_cnpj);
