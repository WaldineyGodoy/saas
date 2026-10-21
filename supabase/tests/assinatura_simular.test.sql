-- Sandbox: simulação da Energia por Assinatura e Fonte B
-- (spec 2026-10-20-base-agente-assinatura-design.md §4.2, §5, §8.2).
-- Rodar depois da migration 20261021a; tudo é desfeito no RAISE final.
DO $t$
DECLARE
  r jsonb; v_cob record; v_split jsonb; v_regras jsonb; v_base numeric;
  v_usina uuid; v_lead uuid; v_ind uuid;
BEGIN
  -- Isola o teste: tira as usinas reais da Cosern da conta de vagas.
  UPDATE usinas SET concessionaria = concessionaria || ' (teste)' WHERE concessionaria = 'Neoenergia Cosern';

  -- 1. Sem usina nenhuma: fila.
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 300, null, null);
  IF (r->>'economia_mensal')::numeric <> 46.56 OR (r->>'economia_anual')::numeric <> 558.74 THEN
    RAISE EXCEPTION 'FALHOU economia: %', r; END IF;
  IF (r->>'desconto_pct')::numeric <> 15 OR r->>'vaga' <> 'fila' OR (r->>'atinge_minimo')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU fila: %', r; END IF;
  IF r->>'link_adesao' <> 'https://b2wenergia.com.br/' THEN RAISE EXCEPTION 'FALHOU link: %', r; END IF;

  -- 2. Usina em pré-operação com espaço.
  INSERT INTO usinas (name, status, concessionaria, geracao_estimada_kwh, previsao_entrega)
  VALUES ('UFV Teste Pré', 'pre_operacao', 'Neoenergia Cosern', 5000, '2026-12-01') RETURNING id INTO v_usina;
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 300, null, null);
  IF r->>'vaga' <> 'pre_operacao' OR r->>'previsao_operacao' <> '2026-12-01' THEN RAISE EXCEPTION 'FALHOU pre: %', r; END IF;

  -- 3. Usina gerando com espaço vence a pré-operação.
  INSERT INTO usinas (name, status, concessionaria, geracao_estimada_kwh)
  VALUES ('UFV Teste Gerando', 'gerando', 'Neoenergia Cosern', 1000);
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 300, null, null);
  IF r->>'vaga' <> 'imediata' THEN RAISE EXCEPTION 'FALHOU imediata: %', r; END IF;
  -- ...mas não comporta 1.200 kWh: cai na pré-operação.
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 1200, null, null);
  IF r->>'vaga' <> 'pre_operacao' THEN RAISE EXCEPTION 'FALHOU capacidade: %', r; END IF;

  -- 4. Valor em reais vira kWh pela tarifa; abaixo de 150 kWh.
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', null, 103.47, null);
  IF (r->>'consumo_kwh')::numeric <> 100 OR (r->>'consumo_convertido')::boolean IS NOT TRUE
     OR (r->>'atinge_minimo')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FALHOU reais: %', r; END IF;

  -- 5. Cidade fora da tabela e distribuidora sem plano.
  r := public.b2w_mcp_simular_assinatura('cidade que nao existe', 'RN', 300, null, null);
  IF (r->>'atende')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FALHOU fora: %', r; END IF;
  r := public.b2w_mcp_simular_assinatura('belo horizonte', 'MG', 300, null, null);
  IF (r->>'atende')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FALHOU sem plano: %', r; END IF;

  -- 6. Link com indicador do lead achado pelo telefone.
  SELECT id INTO v_ind FROM subscribers ORDER BY created_at LIMIT 1;
  INSERT INTO leads (name, phone, indicador_assinante_id) VALUES ('Lead Teste', '84 99999-0001', v_ind) RETURNING id INTO v_lead;
  r := public.b2w_mcp_simular_assinatura('natal', 'RN', 300, null, '5584999990001');
  IF r->>'link_adesao' <> 'https://b2wenergia.com.br/?indicador=' || v_ind THEN RAISE EXCEPTION 'FALHOU indicador: %', r; END IF;

  -- 7. Fonte B: Cosern com 15%, tarifa e crédito de indicação igual ao split.
  SELECT * INTO v_cob FROM public.ponte_deskcomm_assinatura_cobertura() WHERE concessionaria = 'Neoenergia Cosern';
  IF v_cob.desconto_pct <> 15 OR v_cob.tarifa <> 1.0347 OR v_cob.ufs <> 'RN' THEN RAISE EXCEPTION 'FALHOU cobertura: %', row_to_json(v_cob); END IF;
  SELECT p.recorrente_config->'regras_multinivel', (p.recorrente_config->'lastro_tarifario'->>'base_calculo_liquida')::numeric
    INTO v_regras, v_base
    FROM planos_assinatura_energia p JOIN planos_distribuidoras d ON d.plano_id = p.id
   WHERE p.ativo AND p.status = 'ativo' AND d.concessionaria = 'Neoenergia Cosern';
  v_split := public.fn_calcular_split_recompensa(v_base * 100, 999999, v_regras,
             '[{"papel":"assinante_conect","id":"00000000-0000-0000-0000-000000000001","nivel":1}]'::jsonb);
  IF (v_split->'beneficiarios'->0->>'valor')::numeric <> v_cob.credito_indicacao_100kwh THEN
    RAISE EXCEPTION 'FALHOU indicacao: split % x fonte %', v_split->'beneficiarios'->0->>'valor', v_cob.credito_indicacao_100kwh; END IF;

  IF (SELECT count(*) FROM ponte_deskcomm.fontes_base WHERE chave IN ('assinatura_faq', 'assinatura_cobertura')) <> 2 THEN
    RAISE EXCEPTION 'FALHOU chaves de fontes_base'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK credito_100kwh=% simulacao=%', v_cob.credito_indicacao_100kwh, r;
END
$t$;
