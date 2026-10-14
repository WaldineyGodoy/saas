-- Task 4 (Split de Pagamentos): motor puro do split da recompensa
-- recorrente. Dado uma base ja liquida, o teto de deducao (folga ate o
-- piso do fornecedor) e a lista de participantes, devolve exatamente
-- quanto cada um recebe.
-- Spec: .superpowers/sdd/2026-09-27-split-de-pagamentos/task-4-brief.md
--
-- Funcao pura: IMMUTABLE, nao le nem grava tabela. Quem resolve os
-- participantes (arvore de indicacao, licenca do PPP, status do
-- assinante) e quem chama esta funcao -- ela so faz a conta.
--
-- Regra de arredondamento (decisao desta task, coberta pelo teste
-- "arredonda e fecha o total" em split_motor.test.sql):
--   1) Cada valor baseado em percentual (B2W, cada beneficiario) e
--      arredondado individualmente para 2 casas com o ROUND padrao do
--      tipo numeric do Postgres, que arredonda 0,5 para cima em modulo
--      (round half away from zero -- ex.: round(0.125,2) = 0.13,
--      round(-0.125,2) = -0.13; confirmado nesta base, 28/09/2026).
--   2) O fornecedor NUNCA e calculado como percentual proprio: e sempre
--      o resto (`p_base - total_deduzido`). Como cada peca deduzida ja
--      esta arredondada a centavo, e o fornecedor absorve o resto exato,
--      a soma de todas as partes bate com a base sempre, sem sobrar nem
--      faltar centavo -- mesmo em bases com fracao de centavo esquisita.
--   3) O corte (trava anti-deficit) tambem opera em cima de valores ja
--      arredondados a centavo, entao "cortado" e sempre um numero limpo
--      de 2 casas.
CREATE OR REPLACE FUNCTION public.fn_calcular_split_recompensa(
  p_base numeric,
  p_teto_deducao numeric,
  p_regras jsonb,
  p_participantes jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_pct_b2w         numeric;
  v_valor_b2w        numeric;
  v_valor_absorvido  numeric := 0;
  v_pct_absorvido    numeric := 0;
  v_beneficiarios    jsonb := '[]'::jsonb;
  v_item             jsonb;
  v_papel            text;
  v_nivel            int;
  v_suspenso         boolean;
  v_pct              numeric;
  v_valor            numeric;
  v_max_niveis       int;
  v_total_bruto      numeric;
  v_excesso          numeric;
  v_corte_aplicado   numeric := 0;
  v_arr              jsonb[];
  v_idx              int;
  v_cat              text;
  v_cut              numeric;
  v_valor_atual      numeric;
  v_cortado_atual    numeric;
  v_total_deduzido   numeric;
BEGIN
  -- base <= 0: nada a partilhar, tudo zerado, fornecedor fica com a base
  -- (que e <= 0) tal como recebida -- decisao explicita do brief.
  IF p_base IS NULL OR p_base <= 0 THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'papel', elem->>'papel',
               'id', elem->'id',
               'nivel', (elem->>'nivel')::int,
               'pct', 0,
               'valor', 0,
               'cortado', 0
             )
           ), '[]'::jsonb)
      INTO v_beneficiarios
      FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb)) elem;

    RETURN jsonb_build_object(
      'b2w', jsonb_build_object('pct', 0, 'valor', 0, 'pct_absorvido', 0, 'valor_absorvido', 0),
      'beneficiarios', v_beneficiarios,
      'total_deduzido', 0,
      'corte_aplicado', 0,
      'fornecedor', p_base
    );
  END IF;

  -- B2W: percentual fixo (hoje igual em L1-L4, mas le sempre L1 porque a
  -- B2W nao "recebe em nivel" -- e a raiz da arvore, nao um beneficiario).
  v_pct_b2w := COALESCE((p_regras #>> ARRAY['b2w','niveis','L1'])::numeric, 0);
  v_valor_b2w := round(p_base * v_pct_b2w / 100, 2);

  -- 1a passada: um item por participante, com pct/valor brutos (antes do
  -- corte). Suspenso vira 0 aqui e engorda a absorcao da B2W.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb))
  LOOP
    v_papel    := v_item->>'papel';
    v_nivel    := NULLIF(v_item->>'nivel', '')::int;
    v_suspenso := COALESCE((v_item->>'suspenso')::boolean, false);
    v_max_niveis := COALESCE((p_regras #>> ARRAY[v_papel, 'max_niveis'])::int, 0);

    IF v_nivel IS NULL OR v_nivel > v_max_niveis THEN
      v_pct := 0;
    ELSE
      v_pct := COALESCE((p_regras #>> ARRAY[v_papel, 'niveis', 'L' || v_nivel])::numeric, 0);
    END IF;

    v_valor := round(p_base * v_pct / 100, 2);

    IF v_suspenso THEN
      -- nao recebe; percentual e valor vao para a B2W (nunca ao fornecedor)
      v_pct_absorvido   := v_pct_absorvido + v_pct;
      v_valor_absorvido := v_valor_absorvido + v_valor;
      v_beneficiarios := v_beneficiarios || jsonb_build_object(
        'papel', v_papel, 'id', v_item->'id', 'nivel', v_nivel,
        'pct', 0, 'valor', 0, 'cortado', 0
      );
    ELSE
      v_beneficiarios := v_beneficiarios || jsonb_build_object(
        'papel', v_papel, 'id', v_item->'id', 'nivel', v_nivel,
        'pct', v_pct, 'valor', v_valor, 'cortado', 0
      );
    END IF;
  END LOOP;

  v_valor_b2w := v_valor_b2w + v_valor_absorvido;

  SELECT v_valor_b2w + COALESCE(SUM((b->>'valor')::numeric), 0)
    INTO v_total_bruto
    FROM jsonb_array_elements(v_beneficiarios) b;

  -- trava anti-deficit: se a soma (B2W + beneficiarios) fura o teto que
  -- sobra ate o piso do fornecedor, corta na ordem assinante_conect ->
  -- parceiro (ppe|ppp|ppf) -> lider. B2W nunca e alvo do corte.
  IF v_total_bruto > p_teto_deducao THEN
    v_excesso := v_total_bruto - p_teto_deducao;

    SELECT array_agg(elem ORDER BY ord)
      INTO v_arr
      FROM jsonb_array_elements(v_beneficiarios) WITH ORDINALITY AS t(elem, ord);

    FOR v_cat IN SELECT unnest(ARRAY['assinante_conect', 'parceiro', 'lider'])
    LOOP
      EXIT WHEN v_excesso <= 0;

      FOR v_idx IN 1 .. COALESCE(array_length(v_arr, 1), 0)
      LOOP
        EXIT WHEN v_excesso <= 0;

        v_papel := v_arr[v_idx] ->> 'papel';
        CONTINUE WHEN NOT (
          (v_cat = 'assinante_conect' AND v_papel = 'assinante_conect') OR
          (v_cat = 'parceiro'         AND v_papel IN ('ppe', 'ppp', 'ppf')) OR
          (v_cat = 'lider'            AND v_papel = 'lider')
        );

        v_valor_atual := (v_arr[v_idx] ->> 'valor')::numeric;
        CONTINUE WHEN v_valor_atual <= 0;

        v_cut := LEAST(v_valor_atual, v_excesso);
        v_cortado_atual := (v_arr[v_idx] ->> 'cortado')::numeric + v_cut;

        v_arr[v_idx] := jsonb_set(
          jsonb_set(v_arr[v_idx], '{valor}', to_jsonb(v_valor_atual - v_cut)),
          '{cortado}', to_jsonb(v_cortado_atual)
        );

        v_excesso        := v_excesso - v_cut;
        v_corte_aplicado := v_corte_aplicado + v_cut;
      END LOOP;
    END LOOP;

    SELECT jsonb_agg(elem ORDER BY ord)
      INTO v_beneficiarios
      FROM unnest(v_arr) WITH ORDINALITY AS t(elem, ord);
  END IF;

  v_total_deduzido := v_total_bruto - v_corte_aplicado;

  RETURN jsonb_build_object(
    'b2w', jsonb_build_object(
      'pct', v_pct_b2w,
      'valor', v_valor_b2w,
      'pct_absorvido', v_pct_absorvido,
      'valor_absorvido', v_valor_absorvido
    ),
    'beneficiarios', v_beneficiarios,
    'total_deduzido', v_total_deduzido,
    'corte_aplicado', v_corte_aplicado,
    'fornecedor', p_base - v_total_deduzido
  );
END;
$fn$;

COMMENT ON FUNCTION public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb) IS
  'Motor puro do split da recompensa recorrente (Task 4). Dado a base liquida, o teto de deducao (folga ate o piso do fornecedor), regras_multinivel do plano e a lista de participantes ja resolvida [{papel,id,nivel,suspenso}], devolve {b2w:{pct,valor,pct_absorvido,valor_absorvido}, beneficiarios:[{papel,id,nivel,pct,valor,cortado}], total_deduzido, corte_aplicado, fornecedor}. Percentual = regras[papel].niveis[''L''||nivel], relativo a quem recebe, zero quando nivel > max_niveis daquele papel. B2W sempre entra (fixo, le L1) e nunca e cortada. suspenso:true = nao recebe, e o pct/valor dele e somado a B2W (pct_absorvido/valor_absorvido), nunca ao fornecedor (PPP com licenca vencida, decisao do dono 27/09/2026). Se B2W+beneficiarios passar de p_teto_deducao, corta na ordem assinante_conect -> parceiro (ppe|ppp|ppf) -> lider, registrando cortado por beneficiario e o total em corte_aplicado; fornecedor = p_base - total_deduzido sempre (nunca percentual proprio), o que garante a soma exata com a base. base <= 0 devolve tudo zerado e fornecedor = p_base. Arredondamento: ver comentario no topo da migracao 20260928b_motor_split.sql. IMMUTABLE, sem acesso a tabela -- quem resolve os participantes (arvore, licenca, status) e responsabilidade de quem chama.';
