-- Exclusão de fatura passa a deixar rastro.
--
-- Em 31/08/2026 a conta de energia de 07/2026 da UC 7029875701 (R$ 117,67,
-- com PDF) desapareceu do banco. Descobrir o que houve exigiu deduzir a partir
-- do código da tela, porque `log_invoice_change` só trata INSERT e UPDATE —
-- um DELETE não deixava nenhum registro em `crm_history`.
--
-- Uma varredura por meses faltantes no meio da série de cada UC encontrou 8
-- buracos (Novo Leblon 04 e 05/2026, Simone Toral 05/2026, quatro Guanabara em
-- 06/2026 e o caso acima). Sem log, nenhum deles tem história.
--
-- O gatilho grava em `crm_history` o suficiente para reconstruir a linha:
-- valor da concessionária, vencimentos, mês de referência e o caminho do PDF
-- no Storage — que sobrevive à exclusão do registro.

CREATE OR REPLACE FUNCTION public.log_invoice_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    INSERT INTO public.crm_history (
        created_by,
        entity_type,
        entity_id,
        content,
        metadata
    ) VALUES (
        auth.uid(),
        'invoice',
        OLD.id,
        'Exclusão de Fatura',
        jsonb_build_object(
            'uc_id',                     OLD.uc_id,
            'mes_referencia',            OLD.mes_referencia,
            'status',                    OLD.status,
            'energy_bill_status',        OLD.energy_bill_status,
            'valor_a_pagar',             OLD.valor_a_pagar,
            'valor_concessionaria',      OLD.valor_concessionaria,
            'vencimento',                OLD.vencimento,
            'vencimento_concessionaria', OLD.vencimento_concessionaria,
            'consumo_kwh',               OLD.consumo_kwh,
            'consumo_compensado',        OLD.consumo_compensado,
            'energia_injetada',          OLD.energia_injetada,
            'concessionaria_pdf_url',    OLD.concessionaria_pdf_url
        )
    );
    RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS tr_log_invoice_delete ON public.invoices;
CREATE TRIGGER tr_log_invoice_delete
    AFTER DELETE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.log_invoice_delete();
