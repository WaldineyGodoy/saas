-- Migration: 20260523_add_safeguard_to_uc_triggers
-- Description: Implement a safeguard (lock) to prevent consumer units (UCs) in inactive statuses 
-- ('desconectado', 'cancelado', 'cancelado_inadimplente') from automatically returning to active statuses 
-- ('ativo', 'vinculado', 'aguardando_conexao', 'sem_geracao', 'em_ativacao') via triggers.

-- 1. Update handle_uc_usina_link trigger function
CREATE OR REPLACE FUNCTION public.handle_uc_usina_link()
RETURNS TRIGGER AS $$
DECLARE
    usina_status TEXT;
BEGIN
    -- Se usina_id mudou e não é nulo
    IF NEW.usina_id IS NOT NULL AND (OLD.usina_id IS NULL OR NEW.usina_id != OLD.usina_id) THEN
        SELECT status INTO usina_status FROM usinas WHERE id = NEW.usina_id;
        
        -- TRAVA: Se for um UPDATE e o status antigo for inativo/cancelado/desconectado,
        -- e o status não estiver sendo alterado manualmente (NEW.status = OLD.status), NÃO altera automaticamente.
        IF TG_OP = 'UPDATE' AND OLD.status IN ('desconectado', 'cancelado', 'cancelado_inadimplente') AND NEW.status = OLD.status THEN
            -- Mantém o status antigo
            NULL;
        ELSE
            IF usina_status = 'gerando' THEN
                NEW.status := 'ativo';
            ELSIF usina_status = 'em_conexao' THEN
                NEW.status := 'vinculado';
            ELSIF usina_status IN ('manutencao', 'inativa', 'cancelada') THEN
                NEW.status := 'sem_geracao';
            END IF;
        END IF;
    END IF;
    
    -- Se desvinculado (usina_id se torna nulo)
    IF NEW.usina_id IS NULL AND OLD.usina_id IS NOT NULL THEN
        -- TRAVA: Se for um UPDATE e o status antigo for inativo/cancelado/desconectado,
        -- e o status não estiver sendo alterado manualmente (NEW.status = OLD.status), NÃO altera automaticamente.
        IF TG_OP = 'UPDATE' AND OLD.status IN ('desconectado', 'cancelado', 'cancelado_inadimplente') AND NEW.status = OLD.status THEN
            -- Mantém o status antigo
            NULL;
        ELSE
            NEW.status := 'em_ativacao'; 
        END IF;
    END IF;

    -- Padrão na criação se nulo
    IF NEW.status IS NULL THEN
        NEW.status := 'em_ativacao';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Update handle_usina_status_change trigger function
CREATE OR REPLACE FUNCTION public.handle_usina_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        UPDATE consumer_units
        SET status = CASE
            WHEN NEW.status = 'gerando' THEN 'ativo'
            WHEN NEW.status = 'em_conexao' THEN 'vinculado'
            WHEN NEW.status IN ('manutencao', 'inativa', 'cancelada') THEN 'sem_geracao'
            ELSE status
        END
        WHERE usina_id = NEW.id 
          AND status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente'); -- TRAVA
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Update handle_invoice_status_change trigger function
CREATE OR REPLACE FUNCTION public.handle_invoice_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_subscriber_id UUID;
    v_uc_status TEXT;
BEGIN
    -- Obter subscriber_id e status da UC vinculada
    SELECT subscriber_id, status INTO v_subscriber_id, v_uc_status
    FROM consumer_units 
    WHERE id = COALESCE(NEW.uc_id, OLD.uc_id);

    -- Lógica original de atraso da UC (só aplica se não estiver desconectada/cancelada)
    IF NEW.status = 'atrasado' AND v_uc_status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente') THEN
        UPDATE consumer_units SET status = 'em_atraso' WHERE id = NEW.uc_id;
        
        IF (CURRENT_DATE - NEW.vencimento) > 60 THEN
             UPDATE consumer_units SET status = 'cancelado_inadimplente' WHERE id = NEW.uc_id;
        END IF;
    END IF;
    
    -- Se a fatura foi paga e estava atrasada, recalcular status baseado na usina (só aplica se não estiver desconectada/cancelada)
    IF NEW.status = 'pago' AND OLD.status = 'atrasado' AND v_uc_status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente') THEN
        IF NOT EXISTS (SELECT 1 FROM invoices WHERE uc_id = NEW.uc_id AND status = 'atrasado') THEN
             WITH u_status AS (
                SELECT u.status 
                FROM usinas u 
                JOIN consumer_units c ON c.usina_id = u.id 
                WHERE c.id = NEW.uc_id
             )
             UPDATE consumer_units c
             SET status = CASE
                WHEN (SELECT status FROM u_status) = 'gerando' THEN 'ativo'
                WHEN (SELECT status FROM u_status) = 'em_conexao' THEN 'vinculado'
                WHEN (SELECT status FROM u_status) IN ('manutencao', 'inativa', 'cancelada') THEN 'sem_geracao'
                ELSE 'em_ativacao'
             END
             WHERE id = NEW.uc_id;
        END IF;
    END IF;

    -- Recalcular status do assinante se houver
    IF v_subscriber_id IS NOT NULL THEN
        PERFORM fn_recalculate_subscriber_status(v_subscriber_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
