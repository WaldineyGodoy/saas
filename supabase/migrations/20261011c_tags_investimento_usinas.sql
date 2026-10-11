-- =====================================================================
-- App: "Usinas solares" é uma forma de investir por si só (11/10/2026).
-- Quem marca só essa opção recebe a etiqueta-base #Investidor; antes
-- disso o pedido era recusado por "nenhuma forma de investir".
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_tags_investimento(p_interesses jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT ARRAY['#Investidor'] || coalesce(array_agg(DISTINCT t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}')
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_interesses) = 'array' THEN p_interesses ELSE '[]'::jsonb END) i(cod)
    LEFT JOIN (VALUES
      ('usinas', '#Investidor'),
      ('eletropostos', '#Eletropostos'), ('cotas', '#Cotas'), ('consorcio', '#Consorcio'),
      ('financiamento', '#Financiamento'), ('arrendamento', '#Arrendamento de area'), ('vagas', '#Locação de Vagas')
    ) t(cod, tag) ON t.cod = i.cod;
$$;
