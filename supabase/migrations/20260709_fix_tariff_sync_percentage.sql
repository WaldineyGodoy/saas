-- Migration to fix the tariff sync percentage calculation for discounts
-- Prevents values from being multiplied by 100 if they are already stored as percentages (e.g. 20 instead of 0.20)

CREATE OR REPLACE FUNCTION sync_tariffs_to_entities()
RETURNS trigger AS $$
BEGIN
    -- Atualizar Unidades Consumidoras (consumer_units)
    UPDATE public.consumer_units
    SET 
        te = NEW."TE",
        tusd = NEW."TUSD",
        tarifa_concessionaria = NEW."Tarifa Concessionaria",
        desconto_assinante = CASE 
            WHEN NEW."Desconto Assinante" > 0 AND NEW."Desconto Assinante" <= 1 THEN NEW."Desconto Assinante" * 100 
            ELSE NEW."Desconto Assinante" 
        END
    WHERE 
        UPPER(concessionaria) = UPPER(NEW."Concessionaria")
        AND UPPER(address->>'cidade') = UPPER(NEW."Município")
        AND UPPER(address->>'uf') = UPPER(NEW."UF");

    -- Atualizar Leads
    UPDATE public.leads
    SET 
        tarifa_concessionaria = NEW."Tarifa Concessionaria",
        desconto_assinante = CASE 
            WHEN NEW."Desconto Assinante" > 0 AND NEW."Desconto Assinante" <= 1 THEN NEW."Desconto Assinante" * 100 
            ELSE NEW."Desconto Assinante" 
        END
    WHERE 
        UPPER(concessionaria) = UPPER(NEW."Concessionaria")
        AND UPPER(cidade) = UPPER(NEW."Município")
        AND UPPER(uf) = UPPER(NEW."UF");

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix any legacy corrupted discounts (e.g. 2000% instead of 20%)
UPDATE public.consumer_units SET desconto_assinante = desconto_assinante / 100 WHERE desconto_assinante > 100;
UPDATE public.leads SET desconto_assinante = desconto_assinante / 100 WHERE desconto_assinante > 100;
