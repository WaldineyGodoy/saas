-- Migration: 20260706_add_usina_to_protocols_constraint
-- Description: Drop protocols_linked_entity_type_check constraint and add a new one including 'usina'

ALTER TABLE public.protocols DROP CONSTRAINT IF EXISTS protocols_linked_entity_type_check;

ALTER TABLE public.protocols ADD CONSTRAINT protocols_linked_entity_type_check 
CHECK (linked_entity_type = ANY (ARRAY['assinante'::text, 'unidade_consumidora'::text, 'conta_energia'::text, 'fatura'::text, 'rateio_list'::text, 'usina'::text]));
