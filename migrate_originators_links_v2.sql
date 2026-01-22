
-- 1. Migrar dados da tabela antiga para a nova (Versão Corrigida)
-- Assumindo que 'created_at' não existe na antiga, usamos NOW()
-- Assumindo que 'name' existe. Se não existir, o script falhará novamente, mas pelo erro anterior "name" parece existir.
INSERT INTO public.originators_v2 (id, created_at, name, email, phone, cpf_cnpj, address, pix_key, split_commission)
SELECT 
    id, 
    NOW(), -- Gerar timestamp atual já que não existe na origem
    name, 
    NULL as email, 
    NULL as phone, 
    NULL as cpf_cnpj, 
    '{}'::jsonb as address, 
    NULL as pix_key, 
    '{"start": 0, "recurrent": 0}'::jsonb as split_commission
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
