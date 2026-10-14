-- =====================================================================
-- Adesão sem plano escolhido (site, link de parceiro) passa a usar o plano
-- vigente da distribuidora da UC (decisão do dono, 14/10/2026: "deve ser o
-- desconto do plano vigente, Plano Ultra"). Antes caía no desconto do
-- município (fn_desconto_assinante_municipio): a Cosern saía com 20% em vez
-- dos 15% do Plano Ultra Connect, e a UC ficava sem plano.
--
-- Regra: havendo um único plano ativo ligado à distribuidora, ele vale
-- (desconto e plano_assinatura_id). Sem plano para a distribuidora, segue o
-- desconto do município, como antes. Com mais de um plano ativo para a mesma
-- distribuidora, a adesão não escolhe sozinha: também segue o município, e
-- a equipe define o plano da UC no CRM.
--
-- Remendo pontual no corpo de fn_criar_assinante_publico (mesma assinatura).
-- O trecho tem de aparecer exatamente uma vez, senão a migração falha.
-- =====================================================================
DO $migr$
DECLARE
  v_def text := pg_get_functiondef(
    'public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,integer,text,text,text,text)'::regprocedure);
  v_de text := '    v_desc := coalesce(v_plano_desc,';
  v_para text := '    -- Sem plano escolhido: o plano vigente da distribuidora, se for um so (20261014d).
    IF v_plano_id IS NULL THEN
      SELECT (array_agg(p.id))[1], (array_agg(p.desconto_assinante))[1]
        INTO v_plano_id, v_plano_desc
        FROM public.planos_assinatura_energia p
       WHERE p.ativo AND p.status = ''ativo''
         AND EXISTS (SELECT 1 FROM public.planos_distribuidoras d
                      WHERE d.plano_id = p.id
                        AND lower(btrim(d.concessionaria)) = lower(btrim(coalesce(v_uc->>''concessionaria'', ''''))))
      HAVING count(*) = 1;
    END IF;
    v_desc := coalesce(v_plano_desc,';
BEGIN
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'fn_criar_assinante_publico: trecho do desconto nao encontrado exatamente uma vez';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$migr$;
