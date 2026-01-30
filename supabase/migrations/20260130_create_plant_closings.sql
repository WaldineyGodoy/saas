-- Create plant_closings table
CREATE TABLE IF NOT EXISTS plant_closings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usina_id uuid REFERENCES usinas(id) ON DELETE CASCADE,
    ref_month varchar(20) NOT NULL,
    ref_year integer NOT NULL,
    closing_date date DEFAULT CURRENT_DATE,
    status varchar(20) DEFAULT 'rascunho', -- 'rascunho', 'fechado'
    
    -- Production & Revenue
    energia_gerada decimal(10,2) DEFAULT 0,
    energia_compensada decimal(10,2) DEFAULT 0,
    faturamento_mensal decimal(10,2) DEFAULT 0,
    faturas_pagas_base decimal(10,2) DEFAULT 0, -- Base for management fee
    
    -- Expenses
    custo_disponibilidade decimal(10,2) DEFAULT 0,
    manutencao decimal(10,2) DEFAULT 0,
    arrendamento decimal(10,2) DEFAULT 0,
    servicos_total decimal(10,2) DEFAULT 0, -- Sum of other services
    
    -- Management Fee
    taxa_gestao_percentual decimal(5,2) DEFAULT 0,
    taxa_gestao_valor decimal(10,2) DEFAULT 0,
    
    -- Totals
    total_despesas decimal(10,2) DEFAULT 0,
    saldo_liquido decimal(10,2) DEFAULT 0,
    
    created_at timestamp field with time zone DEFAULT now()
);

-- Add RLS policies
ALTER TABLE plant_closings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" 
ON plant_closings FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Enable insert for authenticated users" 
ON plant_closings FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users" 
ON plant_closings FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "Enable delete for authenticated users" 
ON plant_closings FOR DELETE 
TO authenticated 
USING (true);
