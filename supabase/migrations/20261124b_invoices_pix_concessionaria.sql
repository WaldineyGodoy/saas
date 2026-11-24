-- Pagamento da conta de energia pelo QR Code Pix impresso na conta.
--
-- Colunas próprias, e não `pix_string`: `pix_string` é limpo por
-- cancel-asaas-charge junto com a cobrança ao assinante, e já foi usado para
-- o Pix da cobrança da B2W. Misturar os dois apagaria o rastro de um
-- pagamento feito à concessionária.
--
-- Quem grava estas colunas é a Edge Function pagar-conta-pix, com
-- service_role. `status` e o id da transação servem de trava contra pagar a
-- mesma conta duas vezes.

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS pix_concessionaria text,
    ADD COLUMN IF NOT EXISTS pix_concessionaria_status text,
    ADD COLUMN IF NOT EXISTS pix_concessionaria_transacao_id text,
    ADD COLUMN IF NOT EXISTS pix_concessionaria_pago_em timestamptz,
    ADD COLUMN IF NOT EXISTS pix_concessionaria_pago_por uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.invoices.pix_concessionaria IS
    'Pix copia e cola lido do QR "PAGUE COM PIX" da conta da concessionária e efetivamente enviado à Asaas.';
COMMENT ON COLUMN public.invoices.pix_concessionaria_status IS
    'enviando | <status da transação Pix na Asaas> | falhou. "enviando" trava pagamento concorrente.';
COMMENT ON COLUMN public.invoices.pix_concessionaria_transacao_id IS
    'id da transação Pix na Asaas (GET /v3/pix/transactions/{id}).';
