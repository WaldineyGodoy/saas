-- Troca de titularidade: de onde a UC veio.
--
-- Na TT a concessionaria emite um numero novo e o registro no CRM era editado
-- no lugar -- numero e titular trocados na mesma linha. O historico contabil
-- ficava integro, mas a identidade anterior desaparecia do cadastro: em
-- 31/08/2026, reconstruir os numeros antigos das quatro UCs Green Park so foi
-- possivel por causa de anotacoes manuais no crm_history e do caminho dos PDFs
-- no Storage. Qualquer reprocessamento apagaria essa ultima pista.
--
-- A identidade anterior importa porque a conta final do periodo pre-troca sai
-- no portal sob o numero e o titular ANTIGOS, e e devida pela B2W.

ALTER TABLE public.consumer_units
    ADD COLUMN IF NOT EXISTS numero_uc_anterior text,
    ADD COLUMN IF NOT EXISTS titular_anterior_id uuid REFERENCES public.subscribers(id),
    ADD COLUMN IF NOT EXISTS data_troca_titularidade date;

COMMENT ON COLUMN public.consumer_units.numero_uc_anterior IS
    'Numero da UC antes da troca de titularidade. A conta final do periodo anterior sai no portal sob este numero.';
COMMENT ON COLUMN public.consumer_units.titular_anterior_id IS
    'Titular da fatura antes da troca. E a credencial que ainda acessa a UC antiga no portal da concessionaria.';
COMMENT ON COLUMN public.consumer_units.data_troca_titularidade IS
    'Data em que a troca de titularidade foi concluida na concessionaria.';
