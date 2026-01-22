
-- 1. Migrar dados da tabela antiga para a nova (se houver dados úteis)
-- Tentamos manter os IDs para não quebrar links existentes se possível
-- Se houver conflito de ID, ignoramos (ON CONFLICT DO NOTHING)
INSERT INTO public.originators_v2 (id, created_at, name, email, phone, cpf_cnpj, address, pix_key, split_commission)
SELECT 
    id, 
    created_at, 
    name, 
    NULL as email, -- Colunas que não existiam vão como NULL 
    NULL as phone, 
    NULL as cpf_cnpj, 
    '{}'::jsonb as address, 
    NULL as pix_key, 
    '{"start": 0, "recurrent": 0}'::jsonb as split_commission
FROM public.originators
ON CONFLICT (id) DO NOTHING;

-- 2. Atualizar Constraints na tabela SUBSCRIBERS
-- Remove a constraint antiga que aponta para 'originators'
ALTER TABLE public.subscribers 
DROP CONSTRAINT IF EXISTS subscribers_originator_id_fkey;

-- Adiciona a nova constraint apontando para 'originators_v2'
ALTER TABLE public.subscribers 
ADD CONSTRAINT subscribers_originator_id_fkey 
FOREIGN KEY (originator_id) 
REFERENCES public.originators_v2 (id) 
ON DELETE SET NULL;

-- 3. Atualizar Constraints na tabela LEADS (se existir)
-- Tenta remover possível constraint antiga
ALTER TABLE public.leads 
DROP CONSTRAINT IF EXISTS leads_originator_id_fkey;

-- Adiciona a nova constraint
ALTER TABLE public.leads 
ADD CONSTRAINT leads_originator_id_fkey 
FOREIGN KEY (originator_id) 
REFERENCES public.originators_v2 (id) 
ON DELETE SET NULL;

-- 4. Renomear tabelas (Opcional - para organização futura)
-- ALTER TABLE originators RENAME TO originators_legacy;
-- ALTER TABLE originators_v2 RENAME TO originators;
