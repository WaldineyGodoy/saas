-- Migration: 20260602_fix_date_format_in_notifications
-- Description: Format date and reference month to Brazilian standards (DD/MM/YYYY and MM/YYYY)
-- in fn_replace_notification_variables for invoices.

CREATE OR REPLACE FUNCTION public.fn_replace_notification_variables(p_text text, p_entity_type text, p_entity_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_result TEXT := p_text;
    v_data RECORD;
BEGIN
    -- LEAD
    IF p_entity_type = 'lead' THEN
        SELECT name, email, phone as telefone, status, concessionaria, address INTO v_data FROM public.leads WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Lead}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Lead}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Lead}}', COALESCE(v_data.status::TEXT, ''));
            v_result := REPLACE(v_result, '{{Concessionária}}', COALESCE(v_data.concessionaria, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;
    
    -- ASSINANTE (SUBSCRIBER)
    ELSIF p_entity_type = 'subscriber' THEN
        SELECT name, email, phone as telefone, status, cpf_cnpj, address INTO v_data FROM public.subscribers WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Assinante}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Assinante}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Assinante}}', COALESCE(v_data.status::TEXT, ''));
            v_result := REPLACE(v_result, '{{CPF/CNPJ}}', COALESCE(v_data.cpf_cnpj, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;

    -- UNIDADE CONSUMIDORA (CONSUMER_UNIT)
    ELSIF p_entity_type = 'consumer_unit' THEN
        SELECT 
            c.numero_uc, 
            c.address, 
            c.status::TEXT as status,
            c.concessionaria,
            s.name as subscriber_name,
            s.email,
            s.phone as telefone
        INTO v_data 
        FROM public.consumer_units c
        LEFT JOIN public.subscribers s ON s.id = c.subscriber_id
        WHERE c.id = p_entity_id;
        
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Unidade Consumidora}}', COALESCE(v_data.numero_uc, ''));
            v_result := REPLACE(v_result, '{{Endereço da UC}}', public.fn_format_json_address(v_data.address));
            v_result := REPLACE(v_result, '{{Status da UC}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Número da UC}}', COALESCE(v_data.numero_uc, ''));
            v_result := REPLACE(v_result, '{{Concessionária}}', COALESCE(v_data.concessionaria, ''));
            v_result := REPLACE(v_result, '{{Nome do Assinante}}', COALESCE(v_data.subscriber_name, ''));
        END IF;

    -- FATURA (INVOICE)
    ELSIF p_entity_type = 'invoice' THEN
        SELECT 
            to_char(i.mes_referencia, 'MM/YYYY') as mes_referencia, 
            to_char(i.vencimento, 'DD/MM/YYYY') as vencimento, 
            i.linha_digitavel, 
            i.status::TEXT as status, 
            i.valor_a_pagar::TEXT as valor_total, 
            i.concessionaria, 
            i.address,
            i.asaas_boleto_url,
            s.name as subscriber_name
        INTO v_data 
        FROM public.invoices i
        LEFT JOIN public.consumer_units cu ON cu.id = i.uc_id
        LEFT JOIN public.subscribers s ON s.id = cu.subscriber_id
        WHERE i.id = p_entity_id;
        
        IF FOUND THEN
            -- Support both exact UI variables and the ones commonly written by the user
            v_result := REPLACE(v_result, '{{Nome do Assinante}}', COALESCE(v_data.subscriber_name, ''));
            v_result := REPLACE(v_result, '{{Mês de Referência da Fatura}}', COALESCE(v_data.mes_referencia, ''));
            v_result := REPLACE(v_result, '{{Mês de Referência}}', COALESCE(v_data.mes_referencia, ''));
            v_result := REPLACE(v_result, '{{Vencimento da Fatura}}', COALESCE(v_data.vencimento, ''));
            v_result := REPLACE(v_result, '{{Vencimento}}', COALESCE(v_data.vencimento, ''));
            v_result := REPLACE(v_result, '{{Linha Digitável de Pagamento}}', COALESCE(v_data.linha_digitavel, ''));
            v_result := REPLACE(v_result, '{{Status da Fatura}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Valor Total}}', COALESCE(v_data.valor_total, '0.00'));
            v_result := REPLACE(v_result, '{{Concessionária}}', COALESCE(v_data.concessionaria, ''));
            v_result := REPLACE(v_result, '{{Endereço da UC}}', public.fn_format_json_address(v_data.address));
            v_result := REPLACE(v_result, '{{Link do Boleto}}', COALESCE(v_data.asaas_boleto_url, ''));
            v_result := REPLACE(v_result, '{{Link da Fatura}}', COALESCE(v_data.asaas_boleto_url, ''));
        END IF;

    -- ORIGINADOR (ORIGINATOR)
    ELSIF p_entity_type = 'originator' THEN
        SELECT name, email, phone as telefone, status::TEXT as status, address INTO v_data FROM public.originators_v2 WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Originador}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Originador}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Originador}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;

    -- FORNECEDOR (SUPPLIER)
    ELSIF p_entity_type = 'supplier' THEN
        SELECT name, email, phone as telefone, status::TEXT as status, address INTO v_data FROM public.suppliers WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Fornecedor}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Fornecedor}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Fornecedor}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;

    -- USINA (POWER_PLANT)
    ELSIF p_entity_type = 'power_plant' THEN
        SELECT name, status::TEXT as status, concessionaria, address INTO v_data FROM public.usinas WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome da Usina}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status da Usina}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Concessionária}}', COALESCE(v_data.concessionaria, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;
    END IF;

    -- Campos genéricos
    IF v_data IS NOT NULL THEN
        BEGIN
            v_result := REPLACE(v_result, '{{email}}', COALESCE(v_data.email::TEXT, ''));
        EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN
            v_result := REPLACE(v_result, '{{telefone}}', COALESCE(v_data.telefone::TEXT, ''));
        EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    RETURN v_result;
END;
$function$;
