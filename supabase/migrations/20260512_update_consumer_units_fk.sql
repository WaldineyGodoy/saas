ALTER TABLE public.consumer_units
DROP CONSTRAINT IF EXISTS consumer_units_subscriber_id_fkey,
ADD CONSTRAINT consumer_units_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;

ALTER TABLE public.consumer_units
DROP CONSTRAINT IF EXISTS consumer_units_titular_fatura_id_fkey,
ADD CONSTRAINT consumer_units_titular_fatura_id_fkey FOREIGN KEY (titular_fatura_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;
