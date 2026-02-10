CREATE OR REPLACE FUNCTION public.sync_lead_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update lead status to 'em_negociacao' if subscriber is created/updated to 'ativacao'
  -- 'ativacao' is NOT a valid enum for leads, so we map it to 'em_negociacao'.
  IF NEW.status = 'ativacao' THEN
     UPDATE public.leads 
     SET status = 'em_negociacao' 
     WHERE email = NEW.email 
     AND status != 'em_negociacao'; 
     
  -- Update lead status to 'ativo' if subscriber is 'ativo'
  ELSIF NEW.status = 'ativo' THEN
     UPDATE public.leads 
     SET status = 'ativo' 
     WHERE email = NEW.email 
     AND status != 'ativo';
  END IF;
  
  RETURN NEW;
END;
$$;
