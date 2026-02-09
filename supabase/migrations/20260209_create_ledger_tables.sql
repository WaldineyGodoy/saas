-- Create ledger_accounts table
CREATE TABLE IF NOT EXISTS public.ledger_accounts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    code text NOT NULL,
    name text NOT NULL,
    type text NOT NULL, -- 'asset', 'liability', 'equity', 'income', 'expense'
    parent_id uuid NULL,
    created_at timestamptz NULL DEFAULT now(),
    CONSTRAINT ledger_accounts_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_accounts_code_key UNIQUE (code),
    CONSTRAINT ledger_accounts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.ledger_accounts(id)
);

-- Create ledger_entries table
CREATE TABLE IF NOT EXISTS public.ledger_entries (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    transaction_id uuid NOT NULL,
    account_id uuid NOT NULL,
    amount numeric NOT NULL, -- Positive = Debit, Negative = Credit
    description text NULL,
    reference_type text NULL, -- 'invoice', 'payout_usina', 'commission', 'manual'
    reference_id uuid NULL,
    external_id text NULL,
    created_at timestamptz NULL DEFAULT now(),
    CONSTRAINT ledger_entries_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_entries_external_id_key UNIQUE (external_id),
    CONSTRAINT ledger_entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.ledger_accounts(id)
);

-- Create financial_transfers table
CREATE TABLE IF NOT EXISTS public.financial_transfers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    amount numeric NOT NULL,
    destination_type text NULL, -- 'usina', 'originator'
    destination_id uuid NULL,
    status text NULL DEFAULT 'pending'::text, -- 'pending', 'completed', 'failed'
    asaas_transfer_id text NULL,
    created_at timestamptz NULL DEFAULT now(),
    CONSTRAINT financial_transfers_pkey PRIMARY KEY (id)
);

-- Enable RLS (and add policies later if needed, mostly backend access)
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transfers ENABLE ROW LEVEL SECURITY;

-- Grant access to authenticated users (adjust based on actual needs, usually only admin/service role writes)
CREATE POLICY "Enable read access for authenticated users" ON public.ledger_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.ledger_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable read access for authenticated users" ON public.financial_transfers FOR SELECT TO authenticated USING (true);
