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

-- 3. Function to handle Invoice Status (Delinquency) and update Subscriber
CREATE OR REPLACE FUNCTION handle_invoice_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_subscriber_id UUID;
BEGIN
    -- Get subscriber_id from the linked UC
    SELECT subscriber_id INTO v_subscriber_id 
    FROM consumer_units 
    WHERE id = COALESCE(NEW.uc_id, OLD.uc_id);

    -- Original UC delinquency logic
    IF NEW.status = 'atrasado' THEN
        -- Update UC to 'em_atraso' immediately
        UPDATE consumer_units SET status = 'em_atraso' WHERE id = NEW.uc_id;
        
        -- Check delays > 60 days
        IF (CURRENT_DATE - NEW.vencimento) > 60 THEN
             UPDATE consumer_units SET status = 'cancelado_inadimplente' WHERE id = NEW.uc_id;
        END IF;
    END IF;
    
    -- If invoice becomes paid, we might want to check if there are other overdue invoices.
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

    -- Trigger Subscriber Status Recalculation
    IF v_subscriber_id IS NOT NULL THEN
        PERFORM fn_recalculate_subscriber_status(v_subscriber_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Function to recalculate Subscriber Status based on rules
CREATE OR REPLACE FUNCTION fn_recalculate_subscriber_status(p_subscriber_id UUID)
RETURNS VOID AS $$
DECLARE
    v_max_delay INT;
    v_has_active BOOLEAN;
    v_all_cancelled BOOLEAN;
    v_new_status subscriber_status;
    v_current_status subscriber_status;
BEGIN
    -- Get current status
    SELECT status INTO v_current_status FROM subscribers WHERE id = p_subscriber_id;

    -- 1. Check for max delay on 'atrasado' invoices
    SELECT MAX(CURRENT_DATE - i.vencimento)
    INTO v_max_delay
    FROM invoices i
    JOIN consumer_units cu ON i.uc_id = cu.id
    WHERE cu.subscriber_id = p_subscriber_id 
    AND i.status = 'atrasado';

    -- 2. Check UC statuses
    SELECT 
        EXISTS(SELECT 1 FROM consumer_units WHERE subscriber_id = p_subscriber_id AND status = 'ativo'),
        NOT EXISTS(SELECT 1 FROM consumer_units WHERE subscriber_id = p_subscriber_id AND status != 'cancelado')
    INTO v_has_active, v_all_cancelled;

    -- 3. Determine new status based on priority
    IF v_max_delay >= 60 THEN
        v_new_status := 'cancelado_inadimplente';
    ELSIF v_max_delay >= 15 THEN
        v_new_status := 'ativo_inadimplente';
    ELSIF v_has_active THEN
        v_new_status := 'ativo';
    ELSIF v_all_cancelled AND EXISTS(SELECT 1 FROM consumer_units WHERE subscriber_id = p_subscriber_id) THEN
        v_new_status := 'cancelado';
    ELSE
        -- Default to 'ativacao' if it was previously in one of the auto-calculated states but no longer qualifies
        IF v_current_status IN ('ativo', 'cancelado', 'ativo_inadimplente', 'cancelado_inadimplente') THEN
            v_new_status := 'ativacao';
        ELSE
            v_new_status := v_current_status;
        END IF;
    END IF;

    -- 4. Update if different and not a terminal/special state like 'transferido'
    IF v_new_status IS NOT NULL AND v_current_status IS DISTINCT FROM 'transferido' AND v_new_status IS DISTINCT FROM v_current_status THEN
        UPDATE subscribers SET status = v_new_status WHERE id = p_subscriber_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 5. New function for UC status changes to trigger Subscriber recalculation
CREATE OR REPLACE FUNCTION fn_trigger_subscriber_recalculate()
RETURNS TRIGGER AS $$
BEGIN
    -- Recalculate for the new/current subscriber
    IF NEW.subscriber_id IS NOT NULL THEN
        PERFORM fn_recalculate_subscriber_status(NEW.subscriber_id);
    END IF;
    
    -- Also recalculate for the old subscriber if it was changed
    IF OLD.subscriber_id IS NOT NULL AND OLD.subscriber_id != NEW.subscriber_id THEN
        PERFORM fn_recalculate_subscriber_status(OLD.subscriber_id);
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

DROP TRIGGER IF EXISTS tr_recalculate_subscriber_on_uc_change ON consumer_units;
CREATE TRIGGER tr_recalculate_subscriber_on_uc_change
AFTER INSERT OR UPDATE OF status, subscriber_id ON consumer_units
FOR EACH ROW EXECUTE FUNCTION fn_trigger_subscriber_recalculate();
