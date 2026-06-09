-- 1. Update public.handle_invoice_status_change to bypass rank check when restoring status upon payment
CREATE OR REPLACE FUNCTION public.handle_invoice_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_subscriber_id UUID;
    v_uc_status TEXT;
BEGIN
    -- Obter subscriber_id e status da UC vinculada
    SELECT subscriber_id, status::text INTO v_subscriber_id, v_uc_status
    FROM public.consumer_units 
    WHERE id = COALESCE(NEW.uc_id, OLD.uc_id);

    -- Lógica original de atraso da UC (só aplica se não estiver desconectada/cancelada)
    IF NEW.status = 'atrasado' AND v_uc_status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente') THEN
        -- Não retroage status se o status atual da UC já for maior que 'em_atraso' (rank 7)
        IF fn_get_uc_status_rank('em_atraso') >= fn_get_uc_status_rank(v_uc_status) THEN
            UPDATE public.consumer_units SET status = 'em_atraso'::public.uc_status WHERE id = NEW.uc_id;
        END IF;
        
        IF (CURRENT_DATE - NEW.vencimento) > 60 THEN
            IF fn_get_uc_status_rank('cancelado_inadimplente') >= fn_get_uc_status_rank(v_uc_status) THEN
                UPDATE public.consumer_units SET status = 'cancelado_inadimplente'::public.uc_status WHERE id = NEW.uc_id;
            END IF;
        END IF;
    END IF;
    
    -- Se a fatura foi paga e estava atrasada, recalcular status baseado na usina (removendo a trava de ranking progressivo para permitir o retorno do status)
    IF NEW.status = 'pago' AND OLD.status = 'atrasado' AND v_uc_status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente') THEN
        IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE uc_id = NEW.uc_id AND status = 'atrasado') THEN
             WITH u_status AS (
                SELECT u.status 
                FROM public.usinas u 
                JOIN public.consumer_units c ON c.usina_id = u.id 
                WHERE c.id = NEW.uc_id
             )
             UPDATE public.consumer_units c
             SET status = CASE
                WHEN (SELECT status FROM u_status) = 'gerando' THEN 'ativo'::public.uc_status
                WHEN (SELECT status FROM u_status) = 'em_conexao' THEN 'vinculado'::public.uc_status
                WHEN (SELECT status FROM u_status) IN ('manutencao', 'inativa', 'cancelada') THEN 'sem_geracao'::public.uc_status
                ELSE 'em_ativacao'::public.uc_status
             END
             WHERE id = NEW.uc_id;
        END IF;
    END IF;

    -- Recalcular status do assinante se houver
    IF v_subscriber_id IS NOT NULL THEN
        PERFORM public.fn_recalculate_subscriber_status(v_subscriber_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Correct any UCs currently stuck in 'em_atraso' that have no overdue invoices
DO $$
DECLARE
    r RECORD;
    v_new_status public.uc_status;
    v_usina_status TEXT;
BEGIN
    FOR r IN 
        SELECT id, subscriber_id, usina_id 
        FROM public.consumer_units 
        WHERE status = 'em_atraso' 
        AND NOT EXISTS (
            SELECT 1 FROM public.invoices 
            WHERE uc_id = consumer_units.id 
            AND status = 'atrasado'
        )
    LOOP
        -- Find usina status
        IF r.usina_id IS NOT NULL THEN
            SELECT status INTO v_usina_status FROM public.usinas WHERE id = r.usina_id;
        ELSE
            v_usina_status := NULL;
        END IF;

        v_new_status := CASE
            WHEN v_usina_status = 'gerando' THEN 'ativo'::public.uc_status
            WHEN v_usina_status = 'em_conexao' THEN 'vinculado'::public.uc_status
            WHEN v_usina_status IN ('manutencao', 'inativa', 'cancelada') THEN 'sem_geracao'::public.uc_status
            ELSE 'em_ativacao'::public.uc_status
        END;

        UPDATE public.consumer_units 
        SET status = v_new_status 
        WHERE id = r.id;

        IF r.subscriber_id IS NOT NULL THEN
            PERFORM public.fn_recalculate_subscriber_status(r.subscriber_id);
        END IF;
    END LOOP;
END;
$$;
