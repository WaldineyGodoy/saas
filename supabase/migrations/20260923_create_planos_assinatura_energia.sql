-- Migration: 20260923_create_planos_assinatura_energia
-- Tabela para gestão de Planos de Assinatura e Regras de Recompensas

CREATE TABLE IF NOT EXISTS public.planos_assinatura_energia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    desconto_assinante NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    ativo BOOLEAN NOT NULL DEFAULT true,
    
    -- Configurações de Recompensas
    recompensas_ativo BOOLEAN NOT NULL DEFAULT true,
    tipo_recompensa TEXT NOT NULL DEFAULT 'start' CHECK (tipo_recompensa IN ('start', 'recorrente', 'hibrido')),
    
    -- JSONB para o Plano Start
    start_config JSONB DEFAULT '{
      "faturas_elegiveis": [2],
      "regras": {
        "1": {"associacao": 0, "coordenador": 0, "embaixador": 0, "assinante": 0},
        "2": {"associacao": 0, "coordenador": 0, "embaixador": 0, "assinante": 0},
        "3": {"associacao": 0, "coordenador": 0, "embaixador": 0, "assinante": 0}
      }
    }'::jsonb,
    
    -- JSONB para o Plano Recorrente
    recorrente_config JSONB DEFAULT '{
      "meses": 48,
      "regras": {"associacao": 0, "coordenador": 0, "embaixador": 0, "assinante": 0}
    }'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.planos_assinatura_energia ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'planos_assinatura_energia' AND policyname = 'Permitir leitura para autenticados'
    ) THEN
        CREATE POLICY "Permitir leitura para autenticados" ON public.planos_assinatura_energia
            FOR SELECT TO authenticated USING (true);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'planos_assinatura_energia' AND policyname = 'Permitir controle total para autenticados'
    ) THEN
        CREATE POLICY "Permitir controle total para autenticados" ON public.planos_assinatura_energia
            FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'planos_assinatura_energia' AND policyname = 'Permitir leitura anon'
    ) THEN
        CREATE POLICY "Permitir leitura anon" ON public.planos_assinatura_energia
            FOR SELECT TO anon USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'planos_assinatura_energia' AND policyname = 'Permitir controle total anon'
    ) THEN
        CREATE POLICY "Permitir controle total anon" ON public.planos_assinatura_energia
            FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;
