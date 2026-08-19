-- Trilha de autoria das transferências PIX.
--
-- Nullable de propósito: as 6 linhas históricas foram criadas quando a função
-- era anônima e não há como atribuí-las a ninguém. Preencher com um id
-- qualquer seria inventar um fato.
ALTER TABLE public.financial_transfers
    ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.financial_transfers.requested_by IS
    'Usuário autenticado que disparou a transferência. NULL nas linhas anteriores a 19/08/2026, quando a Edge Function aceitava chamada anônima.';
