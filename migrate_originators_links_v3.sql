
-- 1. Migrar IDs (essencial para não quebrar links de Assinantes/Leads existentes)
-- Como 'name' e 'created_at' não existem na origem, geramos valores padrão.
INSERT INTO public.originators_v2 (id, created_at, name)
SELECT 
    id, 
    NOW(), 
    'Originador (Migrado)' -- Nome genérico para não quebrar a restrição NOT NULL
FROM public.originators
ON CONFLICT (id) DO NOTHING;

-- 2. Atualizar Constraints na tabela SUBSCRIBERS
ALTER TABLE public.subscribers 
DROP CONSTRAINT IF EXISTS subscribers_originator_id_fkey;

ALTER TABLE public.subscribers 
ADD CONSTRAINT subscribers_originator_id_fkey 
FOREIGN KEY (originator_id) 
REFERENCES public.originators_v2 (id) 
ON DELETE SET NULL;

-- 3. Atualizar Constraints na tabela LEADS
ALTER TABLE public.leads 
DROP CONSTRAINT IF EXISTS leads_originator_id_fkey;

ALTER TABLE public.leads 
ADD CONSTRAINT leads_originator_id_fkey 
FOREIGN KEY (originator_id) 
REFERENCES public.originators_v2 (id) 
ON DELETE SET NULL;
