-- Adiciona a coluna data_ativacao na tabela consumer_units se não existir
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS data_ativacao DATE;

-- Recupera a data de ativação das UCs atualmente ativas
-- Como não há logs históricos detalhados de transições de status no banco, 
-- usamos a data de criação (created_at::date) como uma estimativa segura da data de ativação.
UPDATE public.consumer_units
SET data_ativacao = created_at::date
WHERE status = 'ativo' AND data_ativacao IS NULL;

-- Função do trigger para automatizar a definição da data de ativação
CREATE OR REPLACE FUNCTION public.handle_uc_activation_date()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'ativo' AND NEW.data_ativacao IS NULL THEN
            NEW.data_ativacao := CURRENT_DATE;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status = 'ativo' AND OLD.status != 'ativo' AND NEW.data_ativacao IS NULL THEN
            NEW.data_ativacao := CURRENT_DATE;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criação do trigger na tabela consumer_units
DROP TRIGGER IF EXISTS trg_uc_activation_date ON public.consumer_units;
CREATE TRIGGER trg_uc_activation_date
    BEFORE INSERT OR UPDATE ON public.consumer_units
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_uc_activation_date();
