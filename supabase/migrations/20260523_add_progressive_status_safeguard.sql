-- Migration: 20260523_add_progressive_status_safeguard
-- Description: Implement a progressive safeguard to prevent automated triggers from retrogressing UC status.
-- Order of statuses (1 is lowest, 10 is highest):
-- 1. em_ativacao
-- 2. vinculado
-- 3. em_transf_titularidade
-- 4. aguardando_conexao
-- 5. ativo
-- 6. sem_geracao
-- 7. em_atraso
-- 8. desconectado
-- 9. cancelado
-- 10. cancelado_inadimplente

-- 1. Create or replace the rank getter function
CREATE OR REPLACE FUNCTION public.fn_get_uc_status_rank(status_val TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN CASE status_val
        WHEN 'em_ativacao' THEN 1
        WHEN 'vinculado' THEN 2
        WHEN 'em_transf_titularidade' THEN 3
        WHEN 'aguardando_conexao' THEN 4
        WHEN 'ativo' THEN 5
        WHEN 'sem_geracao' THEN 6
        WHEN 'em_atraso' THEN 7
        WHEN 'desconectado' THEN 8
        WHEN 'cancelado' THEN 9
        WHEN 'cancelado_inadimplente' THEN 10
        ELSE 0
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Update public.handle_uc_usina_link trigger function
CREATE OR REPLACE FUNCTION public.handle_uc_usina_link()
RETURNS TRIGGER AS $$
DECLARE
    usina_status TEXT;
BEGIN
    -- Se usina_id mudou e não é nulo
    IF NEW.usina_id IS NOT NULL AND (OLD.usina_id IS NULL OR NEW.usina_id != OLD.usina_id) THEN
        SELECT status INTO usina_status FROM usinas WHERE id = NEW.usina_id;
        
        -- TRAVA: Se for um UPDATE e o status não estiver sendo alterado manualmente (NEW.status = OLD.status)
        IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
            DECLARE
                v_suggested_status TEXT;
            BEGIN
                IF usina_status = 'gerando' THEN
                    v_suggested_status := 'ativo';
                ELSIF usina_status = 'em_conexao' THEN
                    v_suggested_status := 'vinculado';
                ELSIF usina_status IN ('manutencao', 'inativa', 'cancelada') THEN
                    v_suggested_status := 'sem_geracao';
                END IF;

                -- Só aplica o novo status se ele for de ranque maior ou igual ao status atual
                -- Além disso, mantém as travas de status inativos (desconectado, cancelado, cancelado_inadimplente)
                IF OLD.status IN ('desconectado', 'cancelado', 'cancelado_inadimplente') THEN
                    NULL; -- Não altera de forma alguma
                ELSIF v_suggested_status IS NOT NULL AND fn_get_uc_status_rank(v_suggested_status) >= fn_get_uc_status_rank(OLD.status) THEN
                    NEW.status := v_suggested_status;
                END IF;
            END;
        ELSE
            -- Se for INSERT ou se o status estiver sendo alterado manualmente (NEW.status != OLD.status)
            -- Lógica para novos registros ou alterações explícitas
            IF NEW.status IS NULL OR TG_OP = 'INSERT' THEN
                IF usina_status = 'gerando' THEN
                    NEW.status := 'ativo';
                ELSIF usina_status = 'em_conexao' THEN
                    NEW.status := 'vinculado';
                ELSIF usina_status IN ('manutencao', 'inativa', 'cancelada') THEN
                    NEW.status := 'sem_geracao';
                END IF;
            END IF;
        END IF;
    END IF;
    
    -- Se desvinculado (usina_id se torna nulo)
    IF NEW.usina_id IS NULL AND OLD.usina_id IS NOT NULL THEN
        -- Só altera automaticamente se for um UPDATE e o status atual não retroagir
        IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
            -- Como 'em_ativacao' (rank 1) retrocederia qualquer outro status, não fazemos nada, mantemos o status antigo.
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

-- 3. Update public.handle_usina_status_change trigger function
CREATE OR REPLACE FUNCTION public.handle_usina_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- Atualiza as UCs vinculadas, aplicando a regra progressiva
        -- E a trava contra reativação de UCs desconectadas ou canceladas
        UPDATE consumer_units
        SET status = CASE
            WHEN NEW.status = 'gerando' AND fn_get_uc_status_rank('ativo') >= fn_get_uc_status_rank(status) THEN 'ativo'
            WHEN NEW.status = 'em_conexao' AND fn_get_uc_status_rank('vinculado') >= fn_get_uc_status_rank(status) THEN 'vinculado'
            WHEN NEW.status IN ('manutencao', 'inativa', 'cancelada') AND fn_get_uc_status_rank('sem_geracao') >= fn_get_uc_status_rank(status) THEN 'sem_geracao'
            ELSE status
        END
        WHERE usina_id = NEW.id 
          AND status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Update public.handle_invoice_status_change trigger function
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
        -- Não retroage status se o status atual da UC já for maior que 'em_atraso' (rank 7)
        IF fn_get_uc_status_rank('em_atraso') >= fn_get_uc_status_rank(v_uc_status) THEN
            UPDATE consumer_units SET status = 'em_atraso' WHERE id = NEW.uc_id;
        END IF;
        
        IF (CURRENT_DATE - NEW.vencimento) > 60 THEN
            IF fn_get_uc_status_rank('cancelado_inadimplente') >= fn_get_uc_status_rank(v_uc_status) THEN
                UPDATE consumer_units SET status = 'cancelado_inadimplente' WHERE id = NEW.uc_id;
            END IF;
        END IF;
    END IF;
    
    -- Se a fatura foi paga e estava atrasada, recalcular status baseado na usina (aplicando regra progressiva e travas)
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
                WHEN (SELECT status FROM u_status) = 'gerando' AND fn_get_uc_status_rank('ativo') >= fn_get_uc_status_rank(status) THEN 'ativo'
                WHEN (SELECT status FROM u_status) = 'em_conexao' AND fn_get_uc_status_rank('vinculado') >= fn_get_uc_status_rank(status) THEN 'vinculado'
                WHEN (SELECT status FROM u_status) IN ('manutencao', 'inativa', 'cancelada') AND fn_get_uc_status_rank('sem_geracao') >= fn_get_uc_status_rank(status) THEN 'sem_geracao'
                ELSE status
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
