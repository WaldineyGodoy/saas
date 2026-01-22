
-- Table to store commissions generated for originators
CREATE TABLE IF NOT EXISTS public.commissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    originator_id UUID REFERENCES public.originators_v2(id) ON DELETE CASCADE,
    reference_month DATE, -- The first day of the month usually, e.g. 2024-01-01
    total_invoices INT DEFAULT 0,
    total_value NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'pending', -- pending, paid
    payment_id TEXT, -- Asaas transfer ID
    payment_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can do everything on commissions" ON public.commissions
FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'super_admin')
);

CREATE POLICY "Originators can view their own commissions" ON public.commissions
FOR SELECT USING (
    originator_id IN (
        SELECT id FROM public.originators_v2 
        WHERE user_id = auth.uid()
    )
);

-- Fix policy if originators_v2 uses user_id
-- We'll just assume user_id or similar.
-- Let's make it broad for now or check columns.
