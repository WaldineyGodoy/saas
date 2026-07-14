-- Create standalone_usinas table
CREATE TABLE IF NOT EXISTS public.standalone_usinas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(255) NOT NULL,
    tipo_compensacao VARCHAR(50) NOT NULL CHECK (tipo_compensacao IN ('prioridade', 'porcentagem')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create standalone_ucs table
CREATE TABLE IF NOT EXISTS public.standalone_ucs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usina_id UUID REFERENCES public.standalone_usinas(id) ON DELETE CASCADE,
    numero_uc VARCHAR(255) NOT NULL UNIQUE,
    titular VARCHAR(255),
    tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('ug', 'uc')),
    prioridade INTEGER DEFAULT 1,
    porcentagem NUMERIC(5,2) DEFAULT 0.0,
    conta_saldo BOOLEAN DEFAULT false,
    concessionaria VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create standalone_contas table
CREATE TABLE IF NOT EXISTS public.standalone_contas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uc_id UUID REFERENCES public.standalone_ucs(id) ON DELETE CASCADE,
    mes_referencia VARCHAR(7) NOT NULL, -- e.g. '2026-07'
    data_leitura DATE,
    data_leitura_anterior DATE,
    vencimento DATE,
    consumo_kwh NUMERIC DEFAULT 0,
    energia_injetada NUMERIC DEFAULT 0,
    energia_compensada NUMERIC DEFAULT 0,
    saldo_kwh NUMERIC DEFAULT 0,
    valor_concessionaria NUMERIC DEFAULT 0,
    pdf_url TEXT,
    alertas JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS (and set generic access for authenticated/anon for our standalone dashboard)
ALTER TABLE public.standalone_usinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standalone_ucs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standalone_contas ENABLE ROW LEVEL SECURITY;

-- Temporary public policies for the standalone dashboard
CREATE POLICY "Enable all access for standalone_usinas" ON public.standalone_usinas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for standalone_ucs" ON public.standalone_ucs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for standalone_contas" ON public.standalone_contas FOR ALL USING (true) WITH CHECK (true);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_standalone_ucs_usina_id ON public.standalone_ucs(usina_id);
CREATE INDEX IF NOT EXISTS idx_standalone_ucs_numero_uc ON public.standalone_ucs(numero_uc);
CREATE INDEX IF NOT EXISTS idx_standalone_contas_uc_id ON public.standalone_contas(uc_id);
CREATE INDEX IF NOT EXISTS idx_standalone_contas_data_leitura ON public.standalone_contas(data_leitura);
