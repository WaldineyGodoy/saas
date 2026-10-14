-- Task 4 (Split de Pagamentos): primeira rodada de correcoes de revisao
-- do motor puro do split (20260928b_motor_split.sql). O calculo em si
-- (matriz de niveis, absorcao por suspensao, trava anti-deficit,
-- fechamento exato da base) foi validado pela revisao e nao muda aqui.
-- O que muda e a guarda das entradas e o contrato de saida:
--
--   F1 - p_teto_deducao NULL fazia `total_bruto > p_teto_deducao`
--        avaliar NULL (nem verdadeiro nem falso) e a trava anti-deficit
--        nunca disparava -- ficava aberta em silencio. Agora estoura erro.
--   F2 - p_base NULL devolvia fornecedor:null, propagando NULL como se
--        fosse dinheiro. Agora estoura erro (p_base <= 0 continua sendo
--        tratado como "tudo zerado", nao muda).
--   F3 - fornecedor podia sair com 3+ casas quando a base em si tinha
--        fracao de centavo (ex.: base 100.005 -> fornecedor 84.005).
--        Agora a base e arredondada UMA VEZ na entrada
--        (`p_base := round(p_base, 2)`), entao o residuo (fornecedor)
--        fecha sempre em 2 casas -- fornecedor continua sendo SEMPRE o
--        resto, nunca arredondado isoladamente (isso quebraria a soma).
--   F4 - b2w.pct e b2w.valor podiam discordar quando havia absorcao
--        (pct=10 mas valor=14 com pct_absorvido=4): quem fizesse
--        valor + valor_absorvido creditava 18 contra um total_deduzido
--        de 14 e desbalanceava o razao. Decisao registrada nesta
--        migracao (ver COMMENT ON FUNCTION): b2w.pct e b2w.valor sao
--        sempre o TOTAL que a B2W recebe (nominal + absorvido);
--        pct_absorvido/valor_absorvido continuam existindo so como a
--        fatia informativa, JA CONTIDA dentro de pct/valor -- quem
--        chama a funcao nao soma de novo.
--   F5 - p_regras sem a chave b2w.niveis (ou p_regras NULL) dava B2W=0
--        em silencio e mandava os 10% para o fornecedor, contradizendo
--        "B2W sempre recebe". Agora estoura erro.
--   F6 - a ordem de corte DENTRO da mesma categoria (quando ha mais de
--        um participante elegivel, ex.: dois parceiros) nunca tinha
--        sido documentada de fato (so a ordem ENTRE categorias estava).
--        Documentada agora: drena sequencialmente na ordem em que os
--        participantes aparecem em p_participantes (um ate zerar, so
--        entao passa ao proximo) -- NAO e pro-rata. Este comportamento
--        fica como esta nesta migracao: e uma decisao de negocio ainda
--        pendente do dono (rateio proporcional vs. sequencial), a ser
--        resolvida numa proxima migracao se ele decidir mudar.
--
-- Mais 5 itens baratos pedidos na revisao:
--   (a) novo campo de saida `teto_estourado` (boolean): true quando,
--       mesmo depois de cortar tudo que da para cortar, total_deduzido
--       ainda fica acima de p_teto_deducao (ex.: B2W sozinha ja passa
--       do teto). Antes disso o chamador tinha que perceber sozinho.
--   (b) GREATEST(pct, 0) em cada percentual lido das regras (B2W e
--       cada beneficiario), para que um percentual negativo cadastrado
--       por engano nunca vire "recompensa negativa".
--   (c) SET search_path = '' no cabecalho da funcao (linter do
--       Supabase aponta funcao sem search_path fixo como risco).
--   (d) REVOKE EXECUTE ... FROM PUBLIC, anon + GRANT a authenticated e
--       service_role, no mesmo padrao ja usado nas outras funcoes do
--       projeto (ex.: 20260921b_adesao_v2.sql).
--   (e) uma frase no COMMENT ON FUNCTION avisando que quem chama deve
--       passar p_participantes ja deduplicado (a funcao nao deduplica).
CREATE OR REPLACE FUNCTION public.fn_calcular_split_recompensa(
  p_base numeric,
  p_teto_deducao numeric,
  p_regras jsonb,
  p_participantes jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  v_pct_b2w          numeric;
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
  v_teto_estourado   boolean;
BEGIN
  -- ----------------------------------------------------------------
  -- Guarda de contrato (F1/F2/F5): entrada invalida estoura erro em
  -- vez de produzir um numero silenciosamente errado.
  -- ----------------------------------------------------------------
  IF p_base IS NULL THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_base nao pode ser NULL (base ausente nao e o mesmo que base zero)';
  END IF;

  IF p_teto_deducao IS NULL THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_teto_deducao nao pode ser NULL (teto ausente nao e o mesmo que teto zero -- viraria trava anti-deficit sempre aberta)';
  END IF;

  IF p_regras #> '{b2w,niveis}' IS NULL THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_regras precisa da chave b2w.niveis (a B2W sempre recebe; regra ausente nao pode zerar ela em silencio)';
  END IF;

  -- F3: base sempre com 2 casas ja na entrada, para o residuo
  -- (fornecedor) tambem fechar sempre em 2 casas.
  p_base := round(p_base, 2);

  -- base <= 0: nada a partilhar, tudo zerado, fornecedor fica com a base
  -- (que e <= 0) tal como recebida -- decisao explicita do brief.
  IF p_base <= 0 THEN
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
      'fornecedor', p_base,
      'teto_estourado', (0::numeric > p_teto_deducao)
    );
  END IF;

  -- B2W: percentual fixo (hoje igual em L1-L4, mas le sempre L1 porque a
  -- B2W nao "recebe em nivel" -- e a raiz da arvore, nao um beneficiario).
  -- (b) GREATEST(...,0): percentual negativo nunca vira recompensa negativa.
  v_pct_b2w := GREATEST(COALESCE((p_regras #>> ARRAY['b2w','niveis','L1'])::numeric, 0), 0);
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
      v_pct := GREATEST(COALESCE((p_regras #>> ARRAY[v_papel, 'niveis', 'L' || v_nivel])::numeric, 0), 0);
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

  -- F4: pct e valor da B2W sao sempre o TOTAL que ela recebe (nominal +
  -- absorvido) -- decisao registrada no COMMENT ON FUNCTION abaixo.
  v_valor_b2w := v_valor_b2w + v_valor_absorvido;
  v_pct_b2w   := v_pct_b2w + v_pct_absorvido;

  SELECT v_valor_b2w + COALESCE(SUM((b->>'valor')::numeric), 0)
    INTO v_total_bruto
    FROM jsonb_array_elements(v_beneficiarios) b;

  -- trava anti-deficit: se a soma (B2W + beneficiarios) fura o teto que
  -- sobra ate o piso do fornecedor, corta na ordem assinante_conect ->
  -- parceiro (ppe|ppp|ppf) -> lider. B2W nunca e alvo do corte.
  -- F6 (documentado, comportamento NAO mudou nesta migracao): dentro da
  -- mesma categoria (ex.: dois parceiros), o corte drena sequencialmente
  -- na ordem em que os participantes aparecem em p_participantes -- um
  -- ate zerar, so entao passa ao proximo. NAO e rateio proporcional
  -- entre os participantes da categoria. Decisao de negocio (F7)
  -- pendente do dono; se ele optar por pro-rata, isto muda numa proxima
  -- migracao.
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
  -- (a) mesmo depois de cortar tudo que dava para cortar, o total ainda
  -- pode ficar acima do teto quando a propria B2W (nunca cortada) ja
  -- excede o teto sozinha. teto_estourado avisa o chamador disso.
  v_teto_estourado := (v_total_deduzido > p_teto_deducao);

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
    'fornecedor', p_base - v_total_deduzido,
    'teto_estourado', v_teto_estourado
  );
END;
$fn$;

COMMENT ON FUNCTION public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb) IS
  'Motor puro do split da recompensa recorrente (Task 4, corrigido na rodada de revisao 20260928c). Dado a base liquida, o teto de deducao (folga ate o piso do fornecedor), regras_multinivel do plano e a lista de participantes ja resolvida e DEDUPLICADA [{papel,id,nivel,suspenso}] (a funcao nao deduplica -- participante repetido conta duas vezes), devolve {b2w:{pct,valor,pct_absorvido,valor_absorvido}, beneficiarios:[{papel,id,nivel,pct,valor,cortado}], total_deduzido, corte_aplicado, fornecedor, teto_estourado}. Percentual = regras[papel].niveis[''L''||nivel], relativo a quem recebe, zero quando nivel > max_niveis daquele papel ou quando o percentual cadastrado e negativo (GREATEST(pct,0)). B2W sempre entra (fixo, le L1) e nunca e cortada. suspenso:true = nao recebe, e o pct/valor dele e somado a B2W, nunca ao fornecedor (PPP com licenca vencida, decisao do dono 27/09/2026). DECISAO F4: b2w.pct e b2w.valor sao sempre o TOTAL que a B2W recebe (nominal + absorvido de suspensoes) -- pct_absorvido/valor_absorvido sao so a fatia informativa da absorcao, JA CONTIDA dentro de pct/valor; quem chama NAO deve somar valor_absorvido de novo por cima de valor. Se B2W+beneficiarios passar de p_teto_deducao, corta na ordem assinante_conect -> parceiro (ppe|ppp|ppf) -> lider, registrando cortado por beneficiario e o total em corte_aplicado; DENTRO da mesma categoria o corte drena sequencialmente na ordem de p_participantes (um ate zerar, so entao o proximo), nao e pro-rata -- decisao de negocio (F7) ainda pendente do dono. fornecedor = p_base - total_deduzido sempre (nunca percentual proprio, nunca arredondado isoladamente), o que garante soma exata com a base; a propria p_base e arredondada a 2 casas na entrada para o residuo nunca herdar fracao de centavo. teto_estourado = true quando, mesmo depois do corte maximo possivel, total_deduzido ainda fica acima de p_teto_deducao (tipico quando a B2W sozinha ja excede o teto, ja que ela nunca e cortada). p_base NULL, p_teto_deducao NULL ou p_regras sem a chave b2w.niveis estouram erro (contrato de entrada). base <= 0 (nao-NULL) devolve tudo zerado e fornecedor = p_base. IMMUTABLE, sem acesso a tabela -- quem resolve os participantes (arvore, licenca, status, dedup) e responsabilidade de quem chama.';

REVOKE EXECUTE ON FUNCTION public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb) TO authenticated, service_role;
