-- Migration: 20260608_adjust_activation_safeguards
-- Description: Adjust trigger functions handle_usina_status_change, handle_uc_usina_link, and handle_uc_activation_date to prevent automatic promotion to 'ativo' for consumer units in 'aguardando_conexao' or 'em_transf_titularidade', and safeguard existing activation dates.

-- 1. Update handle_usina_status_change to protect 'aguardando_conexao' and 'em_transf_titularidade' from auto-activation
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
          AND status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente')
          AND NOT (NEW.status = 'gerando' AND status IN ('aguardando_conexao', 'em_transf_titularidade'));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Update handle_uc_usina_link to prevent auto-activation of 'aguardando_conexao' and 'em_transf_titularidade'
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
        -- TRAVA: Não avança automaticamente de 'aguardando_conexao' ou 'em_transf_titularidade' para 'ativo'
        ELSIF (TG_OP = 'UPDATE' AND OLD.status IN ('aguardando_conexao', 'em_transf_titularidade') AND NEW.status = OLD.status) 
           OR (TG_OP = 'INSERT' AND NEW.status IN ('aguardando_conexao', 'em_transf_titularidade')) THEN
            -- Mantém o status atual, se for mudar para gerando não altera para ativo
            IF usina_status = 'em_conexao' THEN
                NEW.status := 'vinculado';
            ELSIF usina_status IN ('manutencao', 'inativa', 'cancelada') THEN
                NEW.status := 'sem_geracao';
            END IF;
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
        IF TG_OP = 'UPDATE' AND OLD.status IN ('desconectado', 'cancelado', 'cancelado_inadimplente') AND NEW.status = OLD.status THEN
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

-- 3. Update handle_uc_activation_date to guarantee data_ativacao is never overwritten if already active
CREATE OR REPLACE FUNCTION public.handle_uc_activation_date()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'ativo' AND NEW.data_ativacao IS NULL THEN
            NEW.data_ativacao := CURRENT_DATE;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Se já estava ativa e a data de ativação já existia, garante que não seja sobrescrita ou zerada
        IF OLD.status = 'ativo' AND OLD.data_ativacao IS NOT NULL THEN
            NEW.data_ativacao := OLD.data_ativacao;
        ELSIF NEW.status = 'ativo' AND OLD.status != 'ativo' AND NEW.data_ativacao IS NULL THEN
            NEW.data_ativacao := CURRENT_DATE;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
