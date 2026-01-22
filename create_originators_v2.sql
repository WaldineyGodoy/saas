
-- Criar uma nova tabela limpa para evitar problemas de cache/schema na antiga
CREATE TABLE public.originators_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    cpf_cnpj TEXT,
    address JSONB DEFAULT '{}'::jsonb,
    pix_key TEXT,
    split_commission JSONB DEFAULT '{"start": 0, "recurrent": 0}'::jsonb
);

-- (Opcional) Migrar dados se conseguir (provavelmente falhará se colunas não existem na origem, então ignoramos)
-- INSERT INTO originators_v2 (name, created_at) SELECT name, created_at FROM originators;

-- Habilitar RLS (Segurança) - Opcional, dependendo da sua política
ALTER TABLE public.originators_v2 ENABLE ROW LEVEL SECURITY;

-- Política de acesso total (para desenvolvimento - ajustar depois)
CREATE POLICY "Enable all access for all users" ON public.originators_v2
FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload config';
