CREATE TABLE IF NOT EXISTS public.recargas_eletroposto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eletroposto_id UUID REFERENCES public.eletropostos(id) ON DELETE SET NULL,
    conector_numero INTEGER NOT NULL DEFAULT 1,
    tipo_usuario TEXT NOT NULL CHECK (tipo_usuario IN ('avulso', 'cadastrado')),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    motorista_nome TEXT,
    motorista_email TEXT,
    motorista_telefone TEXT,
    valor NUMERIC(10, 2) NOT NULL,
    kwh_estimado NUMERIC(10, 2),
    tarifa_kwh_aplicada NUMERIC(10, 4),
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (
        status IN ('pending_payment', 'paid', 'charging', 'completed', 'failed', 'canceled')
    ),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recargas_eletroposto_posto ON public.recargas_eletroposto(eletroposto_id);
CREATE INDEX IF NOT EXISTS idx_recargas_eletroposto_status ON public.recargas_eletroposto(status);
CREATE INDEX IF NOT EXISTS idx_recargas_eletroposto_pi ON public.recargas_eletroposto(stripe_payment_intent_id);

ALTER TABLE public.recargas_eletroposto ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'recargas_eletroposto' AND policyname = 'Permitir leitura da recarga'
    ) THEN
        CREATE POLICY "Permitir leitura da recarga" 
        ON public.recargas_eletroposto 
        FOR SELECT 
        USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'recargas_eletroposto' AND policyname = 'Permitir criacao de solicitacao de recarga'
    ) THEN
        CREATE POLICY "Permitir criacao de solicitacao de recarga" 
        ON public.recargas_eletroposto 
        FOR INSERT 
        WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'recargas_eletroposto' AND policyname = 'Permitir atualizacao da recarga'
    ) THEN
        CREATE POLICY "Permitir atualizacao da recarga" 
        ON public.recargas_eletroposto 
        FOR UPDATE 
        USING (true);
    END IF;
END $$;
