-- 1. Function to handle Usina Status Changes (Updates all linked UCs)
CREATE OR REPLACE FUNCTION handle_usina_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- If status changed
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- Link Rules:
        -- gerando -> ativo
        -- em_conexao -> aguardando_conexao
        -- manutencao, inativa, cancelada -> sem_geracao
        
        UPDATE consumer_units
        SET status = CASE
            WHEN NEW.status = 'gerando' THEN 'ativo'
            WHEN NEW.status = 'em_conexao' THEN 'aguardando_conexao'
            WHEN NEW.status IN ('manutencao', 'inativa', 'cancelada') THEN 'sem_geracao'
            ELSE status -- Keep current if unknown map
        END
        WHERE usina_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Function to handle Linking UC to Usina (Updates specific UC)
CREATE OR REPLACE FUNCTION handle_uc_usina_link()
RETURNS TRIGGER AS $$
DECLARE
    usina_status TEXT;
BEGIN
    -- If usina_id changed and is not null
    IF NEW.usina_id IS NOT NULL AND (OLD.usina_id IS NULL OR NEW.usina_id != OLD.usina_id) THEN
        SELECT status INTO usina_status FROM usinas WHERE id = NEW.usina_id;
        
        IF usina_status = 'gerando' THEN
            NEW.status := 'ativo';
        ELSIF usina_status = 'em_conexao' THEN
            NEW.status := 'aguardando_conexao';
        ELSIF usina_status IN ('manutencao', 'inativa', 'cancelada') THEN
            NEW.status := 'sem_geracao';
        END IF;
    END IF;
    
    -- If Unlinked (usina_id becomes null) -> Revert to 'em_ativacao' or 'aguardando_conexao'? 
    -- Usually if unlinked it goes back to 'em_ativacao' unless manually set.
    IF NEW.usina_id IS NULL AND OLD.usina_id IS NOT NULL THEN
        NEW.status := 'em_ativacao'; 
    END IF;

    -- Default on create if null
    IF NEW.status IS NULL THEN
        NEW.status := 'em_ativacao';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Function to handle Invoice Status (Delinquency)
CREATE OR REPLACE FUNCTION handle_invoice_status_change()
RETURNS TRIGGER AS $$
DECLARE
    days_late INT;
BEGIN
    -- Only relevant if status is 'atrasado'
    IF NEW.status = 'atrasado' THEN
        -- Update UC to 'em_atraso' immediately
        UPDATE consumer_units SET status = 'em_atraso' WHERE id = NEW.uc_id;
        
        -- Check delays > 60 days
        -- Assuming vencimento is DATE
        IF (CURRENT_DATE - NEW.vencimento) > 60 THEN
             UPDATE consumer_units SET status = 'cancelado_inadimplente' WHERE id = NEW.uc_id;
        END IF;
    END IF;
    
    -- If invoice becomes paid, we might want to check if there are other overdue invoices.
    -- If NO other overdue invoices, revert UC status?
    -- Complex logic: Reverting to 'ativo' might be wrong if Usina is 'inativa'.
    -- Safe approach: Leave manual revert or re-trigger Usina check.
    -- For now, let's just re-apply the Usina logic to "reset" it if it was 'em_atraso'.
    
    IF NEW.status = 'pago' AND OLD.status = 'atrasado' THEN
        -- Check if there are other pending overdue invoices for this UC
        IF NOT EXISTS (SELECT 1 FROM invoices WHERE uc_id = NEW.uc_id AND status = 'atrasado') THEN
             -- Re-eval based on Usina
             WITH u_status AS (
                SELECT u.status 
                FROM usinas u 
                JOIN consumer_units c ON c.usina_id = u.id 
                WHERE c.id = NEW.uc_id
             )
             UPDATE consumer_units c
             SET status = CASE
                WHEN (SELECT status FROM u_status) = 'gerando' THEN 'ativo'
                WHEN (SELECT status FROM u_status) = 'em_conexao' THEN 'aguardando_conexao'
                WHEN (SELECT status FROM u_status) IN ('manutencao', 'inativa', 'cancelada') THEN 'sem_geracao'
                ELSE 'em_ativacao' -- No usina
             END
             WHERE id = NEW.uc_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS on_usina_status_update ON usinas;
CREATE TRIGGER on_usina_status_update
AFTER UPDATE ON usinas
FOR EACH ROW EXECUTE FUNCTION handle_usina_status_change();

DROP TRIGGER IF EXISTS on_uc_usina_link ON consumer_units;
CREATE TRIGGER on_uc_usina_link
BEFORE INSERT OR UPDATE ON consumer_units
FOR EACH ROW EXECUTE FUNCTION handle_uc_usina_link();

DROP TRIGGER IF EXISTS on_invoice_update ON invoices;
CREATE TRIGGER on_invoice_update
AFTER INSERT OR UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION handle_invoice_status_change();
