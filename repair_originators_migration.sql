
-- 1. Inserir IDs órfãos encontrados na tabela SUBSCRIBERS
INSERT INTO public.originators_v2 (id, created_at, name)
SELECT DISTINCT s.originator_id, NOW(), 'Originador Restaurado (Sub)'
FROM public.subscribers s
WHERE s.originator_id IS NOT NULL 
AND NOT EXISTS (SELECT 1 FROM public.originators_v2 o WHERE o.id = s.originator_id)
ON CONFLICT (id) DO NOTHING;

-- 2. Inserir IDs órfãos encontrados na tabela LEADS
INSERT INTO public.originators_v2 (id, created_at, name)
SELECT DISTINCT l.originator_id, NOW(), 'Originador Restaurado (Lead)'
FROM public.leads l
WHERE l.originator_id IS NOT NULL 
AND NOT EXISTS (SELECT 1 FROM public.originators_v2 o WHERE o.id = l.originator_id)
ON CONFLICT (id) DO NOTHING;

-- 3. Agora sim, aplicar as constraints com segurança
ALTER TABLE public.subscribers 
DROP CONSTRAINT IF EXISTS subscribers_originator_id_fkey;

ALTER TABLE public.subscribers 
ADD CONSTRAINT subscribers_originator_id_fkey 
FOREIGN KEY (originator_id) 
REFERENCES public.originators_v2 (id) 
ON DELETE SET NULL;

ALTER TABLE public.leads 
DROP CONSTRAINT IF EXISTS leads_originator_id_fkey;

ALTER TABLE public.leads 
ADD CONSTRAINT leads_originator_id_fkey 
FOREIGN KEY (originator_id) 
REFERENCES public.originators_v2 (id) 
ON DELETE SET NULL;
