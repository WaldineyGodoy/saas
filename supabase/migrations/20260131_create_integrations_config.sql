-- Create integrations_config table
CREATE TABLE IF NOT EXISTS integrations_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name varchar(50) NOT NULL UNIQUE, -- 'evolution_api', 'financial_api'
    endpoint_url text,
    api_key text,
    secret_key text,
    variables jsonb DEFAULT '{}'::jsonb, -- Stores key-value pairs like { "var1": "val", "var2": "val" }
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE integrations_config ENABLE ROW LEVEL SECURITY;

-- Policy: somente administradores.
--
-- A versao original desta migration liberava para qualquer `authenticated`
-- com USING (true). Como o onboarding publico cria login para leads e
-- assinantes, "authenticated" inclui qualquer visitante que se cadastrou --
-- e esta tabela guarda a chave de producao da Asaas em texto puro.
--
-- A producao ja foi corrigida a mao; este arquivo ficou para tras. Um
-- `db reset` reintroduziria o buraco em silencio.
DROP POLICY IF EXISTS "Enable all for authenticated users" ON integrations_config;

CREATE POLICY integrations_config_admin_only
ON integrations_config FOR ALL
TO authenticated
USING (public.check_user_is_admin(auth.uid()))
WITH CHECK (public.check_user_is_admin(auth.uid()));
