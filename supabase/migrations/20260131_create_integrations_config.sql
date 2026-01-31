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

-- Policies (Restrict access to Admins ideally, but for now allow authenticated)
CREATE POLICY "Enable all for authenticated users" 
ON integrations_config FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);
