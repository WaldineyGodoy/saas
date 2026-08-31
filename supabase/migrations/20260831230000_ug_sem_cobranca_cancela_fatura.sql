-- Unidade geradora sem consumo de terceiro não gera cobrança ao assinante.
--
-- A conta dela é despesa da usina, abatida no fechamento. Mesmo assim, toda
-- fatura de UG nascia com valor_a_pagar calculado e alguém precisava cancelar
-- à mão, todo mês, em toda usina. Três ocorrências conhecidas: Bom Jesus I em
-- 08/2026, Novo Leblon em 06/2026 e de novo em 08/2026 (R$ 187,01, flagrada em
-- 31/08/2026 no próprio log do robô: "[Faturamento] assinante paga R$ 187,01").
--
-- A regra é objetiva e já está no cadastro:
--     tipo_unidade = 'geradora' AND fatura_consumo_terceiro = false
--         -> não existe a quem cobrar
--
-- Fica no banco, e não no robô, porque o robô é só um dos caminhos que criam
-- fatura -- há também a tela, o upload manual e importação. No gatilho a
-- garantia vale para todos.
--
-- DUAS SALVAGUARDAS DELIBERADAS:
--
-- 1. Fatura 'pago'/'liquidado' NUNCA é rebaixada. Cancelar uma fatura paga
--    apagaria o registro do pagamento. Duas faturas de UG estão nesse estado
--    (Bom Jesus I, 06 e 07/2026) e ficam intocadas, para decisão humana.
--
-- 2. O nome do gatilho vem depois de `ensure_reading_status` na ordem
--    alfabética de propósito: `derive_reading_status` zera reading_status
--    quando vê status cancelado, e rodando antes dele a leitura do medidor
--    seria preservada -- que é o que se quer. A leitura da UG é o dado mais
--    valioso da linha (energia injetada), e não pode se perder no cancelamento.

CREATE OR REPLACE FUNCTION public.fn_ug_sem_cobranca()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_tipo_unidade text;
    v_fatura_terceiro boolean;
BEGIN
    SELECT cu.tipo_unidade, cu.fatura_consumo_terceiro
      INTO v_tipo_unidade, v_fatura_terceiro
      FROM public.consumer_units cu
     WHERE cu.id = NEW.uc_id;

    IF v_tipo_unidade = 'geradora' AND COALESCE(v_fatura_terceiro, false) = false THEN
        -- Salvaguarda 1: pagamento registrado não se desfaz por automação.
        IF NEW.status::text IN ('pago', 'liquidado') THEN
            RETURN NEW;
        END IF;

        NEW.status := 'cancelado';
        NEW.valor_a_pagar := 0;
        NEW.economia_reais := 0;
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_ug_sem_cobranca ON public.invoices;
CREATE TRIGGER tr_ug_sem_cobranca
    BEFORE INSERT OR UPDATE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.fn_ug_sem_cobranca();


-- Saneamento do que já está gravado. Pagas ficam de fora, pelo mesmo motivo.
UPDATE public.invoices i
   SET status = 'cancelado',
       valor_a_pagar = 0,
       economia_reais = 0
  FROM public.consumer_units cu
 WHERE cu.id = i.uc_id
   AND cu.tipo_unidade = 'geradora'
   AND COALESCE(cu.fatura_consumo_terceiro, false) = false
   AND i.status::text NOT IN ('pago', 'liquidado')
   AND (i.status::text NOT IN ('cancelado', 'cancelada')
        OR COALESCE(i.valor_a_pagar, 0) <> 0
        OR COALESCE(i.economia_reais, 0) <> 0);
