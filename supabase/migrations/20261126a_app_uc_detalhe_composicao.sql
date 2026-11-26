-- =====================================================================
-- App: composição da fatura na tela da UC
-- Data: 26/11/2026
--
-- A tela "Unidade Consumidora Detalhada" passa a mostrar o mesmo resumo
-- do CRM (Resumo da Fatura, PR #149): energia compensada na tarifa cheia e
-- com desconto, CIP, conta projetada na concessionária e economia. Para
-- isso o app precisa da tarifa impressa na conta (TE + TUSD) e das parcelas
-- gravadas. Só acrescenta campos; nada sai da resposta.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.app_uc_detalhe(p_uc uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    select jsonb_build_object(
        'uc', to_jsonb(u) - 'portal_credentials' - 'portal_password_secret_id',
        'faturas', coalesce((
            select jsonb_agg(to_jsonb(f) order by f.mes_referencia desc)
              from (select i.id, i.mes_referencia, i.vencimento, i.status,
                           i.consumo_kwh, i.consumo_compensado, i.energia_injetada,
                           i.valor_concessionaria, i.economia_reais, i.valor_a_pagar,
                           i.desconto_aplicado, i.asaas_boleto_url,
                           i.asaas_pdf_storage_url, i.linha_digitavel, i.pix_string,
                           i.te_apurado, i.tusd_apurado, i.iluminacao_publica,
                           i.outros_lancamentos, i.parcelamento, i.parcelamento_repassado,
                           i.tarifa_minima, i.consumo_reais
                      from invoices i
                     where i.uc_id = u.id
                       and i.status::text not in ('cancelado', 'cancelada')
                       and coalesce(i.is_placeholder, false) = false
                     order by i.mes_referencia desc nulls last
                     limit 6) f), '[]'::jsonb)
    )
    from consumer_units u
    where u.id = p_uc and u.subscriber_id = fn_app_subscriber_id();
$$;
