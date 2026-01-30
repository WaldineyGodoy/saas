-- Create cashbook table
CREATE TABLE IF NOT EXISTS cashbook (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usina_id uuid REFERENCES usinas(id) ON DELETE CASCADE,
    type varchar(20) NOT NULL CHECK (type IN ('entrada', 'saida')), -- 'entrada' (Revenue), 'saida' (Expense)
    category varchar(50) NOT NULL, -- 'fatura_assinante', 'manutencao', 'arrendamento', 'taxa_gestao', 'servicos'
    description text,
    amount decimal(10,2) NOT NULL,
    origin_id uuid, -- Link to invoice_id or plant_closing_id (loose link to separate tables)
    origin_type varchar(20), -- 'invoice', 'closing_expense'
    status varchar(20) DEFAULT 'provisionado', -- 'provisionado', 'liquidado'
    transaction_date date DEFAULT CURRENT_DATE,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE cashbook ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for auth" ON cashbook FOR ALL TO authenticated USING (true);


-- Trigger: When Invoice becomes 'paga', insert into Cashbook
CREATE OR REPLACE FUNCTION public.handle_invoice_paid()
RETURNS TRIGGER AS $$
DECLARE
    v_usina_id uuid;
BEGIN
    -- Check if status changed to 'paga'
    IF NEW.status = 'paga' AND OLD.status != 'paga' THEN
        
        -- Get Usina ID from the Invoice's UC linkage
        -- We need to find the consumer_unit related to this invoice, then get its usina_id
        SELECT usina_id INTO v_usina_id 
        FROM consumer_units 
        WHERE id = NEW.uc_id;

        IF v_usina_id IS NOT NULL THEN
            INSERT INTO cashbook (usina_id, type, category, description, amount, origin_id, origin_type, status, transaction_date)
            VALUES (
                v_usina_id,
                'entrada',
                'fatura_assinante',
                'Fatura Paga - ' || NEW.mes_referencia || '/' || NEW.ano_referencia,
                NEW.valor_total,
                NEW.id,
                'invoice',
                'provisionado', -- Enters as provisioned first? Or Liquidado? 
                                -- User said: "liquidado" are invoices ALREADY PAID *AND* PASSED ON (repassado).
                                -- So, "paga" by client means money is with Platform, not yet with Supplier.
                                -- So it stays "provisionado" (available for payout) until Payout happens.
                CURRENT_DATE
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_invoice_paid
    AFTER UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_invoice_paid();
