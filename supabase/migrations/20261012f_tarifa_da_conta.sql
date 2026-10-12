-- Tarifa da fatura vem da CONTA da concessionaria (decisao do dono, 12/10/2026).
--
-- Ate aqui a tarifa do boleto e a do razao saiam do cadastro (UC ou tabela
-- Concessionaria). Em set/2026 a UC 198436603202 foi faturada a 0,9864
-- (cadastro velho) com a conta da Cosern a 1,04487662, e o razao dividiu uma
-- base a 1,0347 com Fio B 0,213 contra 0,21575 cobrado: a diferenca caiu na
-- 1.1.2 como divida de um assinante que pagou tudo (estornada em 20261012e).
-- A tarifa com tributos muda todo mes (PIS/COFINS), entao so a conta e fonte.
--
-- Leitura: parse-invoice / energyBillParser gravam te_apurado, tusd_apurado,
-- tusd_consumo_unit e tusd_compensado_unit (colunas ja existentes, vazias).
--
-- 1. fio_b_apurado passa a ser derivado no banco (gatilho), formula unica.
-- 2. fn_calcular_fatura: tarifa = TE + TUSD da conta; cadastro so na falta.
-- 3. fn_base_recompensa_fatura: tarifa e Fio B da conta; cadastro so na falta,
--    e a origem fica registrada no JSON que vai para recompensas_aplicadas.
-- 4. fn_auditar_fatura: sem tarifa da conta -> aviso, que vira bloqueio quando
--    fn_tarifa_conta_obrigatoria() for ligada (depois do merge que poe o robo
--    para gravar os unitarios); bloqueia residuo entre a
--    conta e o que o boleto repassa acima de 2% da conta (piso R$ 5), avisa
--    cadastro defasado (>2%).
--
-- Cada funcao e substituida so se o corpo vivo for o que foi lido (md5).

-- ---------------------------------------------------------------- guardas
do $$
declare
    v record;
begin
    for v in
        select * from (values
            ('fn_calcular_fatura',        'e23ee5f39206d271e1c84e0d9946b02f'),
            ('fn_base_recompensa_fatura', '1249b8311623f88fd30f72395505d9d0'),
            ('fn_auditar_fatura',         '39e31a874f5909ce62f1582e5b196f04')
        ) t(nome, md5_esperado)
    loop
        if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = v.nome) is distinct from v.md5_esperado then
            raise exception '% mudou desde a leitura (md5 esperado %). Refazer a migracao a partir do corpo vivo.',
                v.nome, v.md5_esperado;
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------- 1. Fio B
create or replace function public.fn_invoice_fio_b_apurado()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
    -- Fio B (R$/kWh) cobrado pela concessionaria = TUSD consumo - TUSD
    -- compensado, ambos impressos na conta. Sem os dois, fica como estava.
    if new.tusd_consumo_unit is not null and new.tusd_compensado_unit is not null then
        new.fio_b_apurado := public.fn_fio_b_apurado(new.tusd_consumo_unit, new.tusd_compensado_unit);
    end if;
    return new;
end;
$function$;

drop trigger if exists tr_invoice_fio_b_apurado on public.invoices;
create trigger tr_invoice_fio_b_apurado
    before insert or update of tusd_consumo_unit, tusd_compensado_unit on public.invoices
    for each row execute function public.fn_invoice_fio_b_apurado();

-- Chave do bloqueio 'tarifa_conta_ausente'. Nasce DESLIGADA: o robo (GitHub
-- Actions, branch main) e a tela de upload so gravam os unitarios depois do
-- merge da impl/plano-usina. Ligada antes disso, toda fatura nova seria
-- barrada. Desligada, a regra sai como aviso. Ligar = migracao que troca o
-- corpo para "select true".
create or replace function public.fn_tarifa_conta_obrigatoria()
returns boolean
language sql
stable  -- nao immutable: o corpo vai mudar e nao pode ficar embutido em plano em cache
set search_path to 'public'
as $function$
    select false;
$function$;

-- Tarifa impressa na conta (TE + TUSD de consumo). Nula se faltar um dos dois.
create or replace function public.fn_tarifa_da_conta(p_te numeric, p_tusd numeric)
returns numeric
language sql
immutable
set search_path to 'public'
as $function$
    select case when coalesce(p_te, 0) > 0 and coalesce(p_tusd, 0) > 0
                then p_te + p_tusd end;
$function$;

-- ---------------------------------------------------------------- 2. fn_calcular_fatura
CREATE OR REPLACE FUNCTION public.fn_calcular_fatura(p_invoice_id uuid, p_gravar boolean DEFAULT false)
 RETURNS TABLE(consumo_reais numeric, tarifa_minima numeric, economia_reais numeric, desconto_aplicado numeric, valor_a_pagar numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    f record;
    v_desconto numeric;
    v_multiplicador numeric;
    v_compensada numeric;
    v_encargos numeric;
    v_tarifa numeric;
    v_ref record;
    v_franquia numeric;
begin
  IF NOT public.fn_chamador_interno() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

    select i.id, i.consumo_kwh, i.consumo_compensado, i.iluminacao_publica,
           i.outros_lancamentos, i.parcelamento, i.desconto_aplicado,
           i.valor_concessionaria, i.asaas_payment_id, i.abatimento_indicacao,
           public.fn_tarifa_da_conta(i.te_apurado, i.tusd_apurado) as conta_tarifa,
           i.tarifa_concessionaria as snap_tarifa,
           i.desconto_assinante as snap_desconto,
           i.franquia as snap_franquia,
           cu.id as uc_id, cu.concessionaria,
           cu.tarifa_concessionaria as uc_tarifa,
           cu.desconto_assinante as uc_desconto,
           cu.franquia as uc_franquia,
           cu.address->>'uf' as uf, cu.address->>'ibge' as ibge
      into f
      from public.invoices i
      join public.consumer_units cu on cu.id = i.uc_id
     where i.id = p_invoice_id;

    if not found then
        raise exception 'Fatura % nao encontrada.', p_invoice_id;
    end if;

    if p_gravar and f.asaas_payment_id is not null then
        raise exception 'Fatura % ja tem cobranca no Asaas (%); recalcular mudaria um valor ja cobrado.',
            p_invoice_id, f.asaas_payment_id;
    end if;

    -- Tarifa: CONTA -> snapshot -> cadastro -> referencia (20261012f). A conta
    -- e o fato; o resto so vale na falta dela, e a auditoria barra a emissao
    -- de fatura compensada sem tarifa da conta. nullif porque zero aqui e
    -- ausencia, nao decisao (COALESCE nao trata zero).
    v_tarifa := coalesce(f.conta_tarifa, nullif(f.snap_tarifa, 0), nullif(f.uc_tarifa, 0));
    if v_tarifa is null then
        select * into v_ref from public.fn_tarifa_referencia(f.concessionaria, f.uf, f.ibge);
        v_tarifa := nullif(v_ref.tarifa_concessionaria, 0);
    end if;
    v_tarifa := coalesce(v_tarifa, 0);

    v_desconto := coalesce(nullif(f.desconto_aplicado, 0), nullif(f.snap_desconto, 0), nullif(f.uc_desconto, 0), 0);
    v_multiplicador := case when v_desconto > 1 then v_desconto / 100 else v_desconto end;
    desconto_aplicado := v_desconto;

    v_franquia := coalesce(nullif(f.snap_franquia, 0), nullif(f.uc_franquia, 0));

    v_encargos := coalesce(f.iluminacao_publica, 0)
                + coalesce(f.outros_lancamentos, 0)
                + coalesce(f.parcelamento, 0);

    -- ---------------- MODO REPASSE ----------------
    if coalesce(f.consumo_compensado, 0) = 0 then
        economia_reais := 0;
        tarifa_minima  := 0;
        valor_a_pagar  := greatest(0, round(coalesce(f.valor_concessionaria, 0), 2));
        consumo_reais  := greatest(0, round(valor_a_pagar - v_encargos, 2));
    else
        -- ---------------- MODO COMPENSACAO ----------------
        v_compensada  := round(coalesce(f.consumo_compensado, 0) * v_tarifa * (1 - v_multiplicador), 2);
        tarifa_minima := round(greatest(0, (coalesce(f.consumo_kwh, 0) - coalesce(f.consumo_compensado, 0)) * v_tarifa), 2);
        economia_reais := round(coalesce(f.consumo_compensado, 0) * v_tarifa * v_multiplicador, 2);
        consumo_reais := v_compensada + tarifa_minima;
        valor_a_pagar := greatest(0, round(v_compensada + tarifa_minima + v_encargos, 2));
    end if;

    -- Credito de indicacao ja abatido (20261006a): continua abatido.
    valor_a_pagar := greatest(0, round(valor_a_pagar - coalesce(f.abatimento_indicacao, 0), 2));

    if p_gravar then
        update public.invoices i
           set consumo_reais         = fn_calcular_fatura.consumo_reais,
               tarifa_minima         = fn_calcular_fatura.tarifa_minima,
               economia_reais        = fn_calcular_fatura.economia_reais,
               desconto_aplicado     = fn_calcular_fatura.desconto_aplicado,
               valor_a_pagar         = fn_calcular_fatura.valor_a_pagar,
               -- snapshot: o que valia no momento em que a fatura foi calculada
               tarifa_concessionaria = v_tarifa,
               desconto_assinante    = v_desconto,
               franquia              = coalesce(v_franquia, i.franquia)
         where i.id = p_invoice_id;
    end if;

    return next;
end;
$function$;

-- ---------------------------------------------------------------- 3. fn_base_recompensa_fatura
CREATE OR REPLACE FUNCTION public.fn_base_recompensa_fatura(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    c_formula constant text :=
        'consumo_compensado * (tarifa * (1 - desconto_pct / 100) - fio_b)';

    v_uc              uuid;
    v_kwh             numeric;
    v_conc            text;
    v_uf              text;
    v_grupo           text;
    v_classe          text;
    v_sufixo          text;
    v_col_tar         text;
    v_col_fio         text;

    v_plano           jsonb;
    v_desconto        numeric;
    v_desconto_origem text;

    v_linhas          int;
    v_d_tar           int;
    v_d_fio           int;
    v_nulos           int;
    v_tarifa          numeric;
    v_fio_b           numeric;

    -- 20261012f: o que a CONTA cobrou. Ganha do cadastro quando existe.
    v_tarifa_conta    numeric;
    v_fio_b_conta     numeric;
    v_tarifa_cadastro numeric;
    v_fio_b_cadastro  numeric;
    v_tarifa_origem   text;
    v_fio_b_origem    text;
    v_motivo_cadastro text;

    v_liquida         numeric;
    v_base            numeric;
    v_sem_comp        boolean;
    v_motivo          text;
BEGIN
    -- Fio B da conta derivado dos DOIS unitarios, nunca da coluna gravada
    -- fio_b_apurado: um zero gravado ali sem os unitarios inflaria a base (a
    -- suite split_base_compensada proibe ler a coluna por isso).
    SELECT i.uc_id, COALESCE(i.consumo_compensado, 0),
           public.fn_tarifa_da_conta(i.te_apurado, i.tusd_apurado),
           public.fn_fio_b_apurado(i.tusd_consumo_unit, i.tusd_compensado_unit)
      INTO v_uc, v_kwh, v_tarifa_conta, v_fio_b_conta
      FROM public.invoices i
     WHERE i.id = p_invoice;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false, 'motivo', 'fatura_inexistente',
            'base', NULL, 'formula', c_formula);
    END IF;

    SELECT NULLIF(btrim(COALESCE(cu.concessionaria, '')), ''),
           NULLIF(btrim(COALESCE(cu.address ->> 'uf', '')), ''),
           NULLIF(btrim(COALESCE(u.grupo_tarifario, '')), '')
      INTO v_conc, v_uf, v_grupo
      FROM public.consumer_units cu
      LEFT JOIN public.usinas u ON u.id = cu.usina_id
     WHERE cu.id = v_uc;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false, 'motivo', 'uc_inexistente',
            'base', NULL, 'formula', c_formula,
            'kwh_compensado', v_kwh);
    END IF;

    -- classe -> quais colunas do cadastro valem
    v_classe := COALESCE(v_grupo, 'B1 Residencial');
    v_sufixo := CASE v_classe
                    WHEN 'B1 Residencial' THEN ''
                    WHEN 'B2 Rural'       THEN '_B2'
                    WHEN 'B3 Comercial'   THEN '_B3'
                    WHEN 'Grupo A'        THEN '_A'
                    ELSE NULL
                END;

    IF v_sufixo IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false, 'motivo', 'classe_desconhecida',
            'base', NULL, 'formula', c_formula,
            'classe', v_classe, 'concessionaria', v_conc, 'uf', v_uf,
            'kwh_compensado', v_kwh);
    END IF;

    v_col_tar := 'Tarifa Concessionaria' || v_sufixo;
    v_col_fio := 'Fio B' || v_sufixo;

    -- desconto: o PLANO e a fonte (Task 3)
    v_plano           := public.fn_regras_recompensa_uc(v_uc);
    v_desconto        := NULLIF(v_plano ->> 'desconto_pct', '')::numeric;
    v_desconto_origem := CASE
                             WHEN v_plano IS NULL     THEN 'uc_sem_plano'
                             WHEN v_desconto IS NULL  THEN 'plano_sem_desconto'
                             ELSE 'plano'
                         END;
    -- C1 (revisao final, 30/09/2026) -- PLANO SEM DESCONTO BLOQUEIA.
    -- GUARDA DEFENSIVA, nao correcao de furo vivo: planos_assinatura_energia
    -- .desconto_assinante e NOT NULL hoje, entao v_desconto nunca chega nulo
    -- por essa via e este ramo nao dispara. Ele existe para o dia em que a
    -- coluna virar nullable, ou em que fn_regras_recompensa_uc deixar de
    -- devolver desconto_pct: ali o COALESCE abaixo transformaria NULL em 0, a
    -- base sairia inflada e as recompensas seriam pagas sobre ela. E a mesma
    -- falha que o Fio B ausente ja bloqueia nesta funcao, pela mesma razao
    -- escrita no cabecalho: cadastro faltando nao pode passar calado quando o
    -- efeito e pagar mais. Para calibrar a ordem de grandeza: numa fatura real
    -- de 4.948 kWh, desconto 0 da base 4.065,77 contra 3.041,83 com os 20%
    -- reais -- 33,7% a mais.
    --
    -- 'uc_sem_plano' NAO bloqueia aqui de proposito: sem plano nao existe
    -- matriz, logo nenhuma recompensa e paga e a base nao e usada para
    -- dinheiro nenhum (o fornecedor fica com o CAIXA -- ver a correcao no
    -- gatilho). Bloquear esse caso deixaria de lancar ate o recebimento no
    -- banco, e hoje nenhuma usina esta amarrada a um plano: o razao pararia
    -- de registrar o dinheiro que entra.
    IF v_desconto_origem = 'plano_sem_desconto' THEN
        RETURN jsonb_build_object(
            'ok', false, 'motivo', 'plano_sem_desconto',
            'base', NULL, 'formula', c_formula,
            'classe', v_classe, 'uf', v_uf, 'kwh_compensado', v_kwh,
            'desconto_pct', NULL, 'desconto_origem', v_desconto_origem,
            'plano_id', v_plano -> 'plano_id');
    END IF;

    v_desconto := COALESCE(v_desconto, 0);

    IF v_conc IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false, 'motivo', 'uc_sem_concessionaria',
            'base', NULL, 'formula', c_formula,
            'classe', v_classe, 'uf', v_uf, 'kwh_compensado', v_kwh,
            'desconto_pct', v_desconto, 'desconto_origem', v_desconto_origem);
    END IF;

    -- Todas as linhas da concessionaria (+ UF quando a UC tiver endereco).
    -- to_jsonb(c) resolve as colunas por NOME, que e o que permite trocar de
    -- classe sem SQL dinamico.
    SELECT count(*),
           count(DISTINCT ((to_jsonb(c) ->> v_col_tar)::numeric)),
           count(DISTINCT ((to_jsonb(c) ->> v_col_fio)::numeric)),
           count(*) FILTER (WHERE (to_jsonb(c) ->> v_col_tar) IS NULL
                               OR (to_jsonb(c) ->> v_col_fio) IS NULL),
           max((to_jsonb(c) ->> v_col_tar)::numeric),
           max((to_jsonb(c) ->> v_col_fio)::numeric)
      INTO v_linhas, v_d_tar, v_d_fio, v_nulos, v_tarifa_cadastro, v_fio_b_cadastro
      FROM public."Concessionaria" c
     WHERE upper(btrim(COALESCE(c."Concessionaria", ''))) = upper(v_conc)
       AND (v_uf IS NULL OR upper(btrim(COALESCE(c."UF", ''))) = upper(v_uf));

    IF v_linhas = 0 THEN
        v_motivo_cadastro := 'concessionaria_nao_cadastrada';
    ELSIF v_d_tar > 1 OR v_d_fio > 1 THEN
        v_motivo_cadastro := 'concessionaria_ambigua';
    ELSIF v_nulos > 0
          OR v_tarifa_cadastro IS NULL OR v_fio_b_cadastro IS NULL
          OR v_tarifa_cadastro <= 0 OR v_fio_b_cadastro <= 0 THEN
        v_motivo_cadastro := 'concessionaria_sem_tarifa';
    END IF;

    -- 20261012f: a CONTA ganha. O cadastro so entra no que a conta nao trouxe,
    -- e um defeito do cadastro so bloqueia quando ele e de fato usado. Fio B
    -- zero na conta e legitimo (GD1 compensa a TUSD inteira); no cadastro,
    -- zero continua sendo ausencia.
    IF v_tarifa_conta IS NOT NULL THEN
        v_tarifa := v_tarifa_conta;
        v_tarifa_origem := 'conta';
    ELSIF v_motivo_cadastro IS NULL THEN
        v_tarifa := v_tarifa_cadastro;
        v_tarifa_origem := 'cadastro';
    END IF;

    IF v_fio_b_conta IS NOT NULL THEN
        v_fio_b := v_fio_b_conta;
        v_fio_b_origem := 'conta';
    ELSIF v_motivo_cadastro IS NULL THEN
        v_fio_b := v_fio_b_cadastro;
        v_fio_b_origem := 'cadastro';
    END IF;

    IF v_tarifa IS NULL OR v_fio_b IS NULL THEN
        v_motivo := COALESCE(v_motivo_cadastro, 'concessionaria_sem_tarifa');
    END IF;

    IF v_motivo IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', false, 'motivo', v_motivo,
            'base', NULL, 'formula', c_formula,
            'kwh_compensado', v_kwh,
            'tarifa', v_tarifa, 'fio_b', v_fio_b,
            'tarifa_origem', v_tarifa_origem, 'fio_b_origem', v_fio_b_origem,
            'tarifa_conta', v_tarifa_conta, 'fio_b_conta', v_fio_b_conta,
            'tarifa_cadastro', v_tarifa_cadastro, 'fio_b_cadastro', v_fio_b_cadastro,
            'desconto_pct', v_desconto, 'desconto_origem', v_desconto_origem,
            'classe', v_classe, 'coluna_tarifa', v_col_tar, 'coluna_fio_b', v_col_fio,
            'concessionaria', v_conc, 'uf', v_uf,
            'linhas_cadastro', v_linhas,
            'valores_distintos_tarifa', v_d_tar,
            'valores_distintos_fio_b', v_d_fio,
            'linhas_incompletas', v_nulos);
    END IF;

    v_liquida  := v_tarifa * (1 - v_desconto / 100) - v_fio_b;
    v_sem_comp := (v_kwh <= 0);
    v_base     := CASE WHEN v_sem_comp THEN 0 ELSE v_kwh * v_liquida END;

    RETURN jsonb_build_object(
        'ok', true,
        'motivo', CASE WHEN v_sem_comp THEN 'sem_compensacao' ELSE NULL END,
        'sem_compensacao', v_sem_comp,
        'base', v_base,
        'formula', c_formula,
        'kwh_compensado', v_kwh,
        'tarifa', v_tarifa,
        'fio_b', v_fio_b,
        'tarifa_origem', v_tarifa_origem,
        'fio_b_origem', v_fio_b_origem,
        'tarifa_conta', v_tarifa_conta,
        'fio_b_conta', v_fio_b_conta,
        'tarifa_cadastro', v_tarifa_cadastro,
        'fio_b_cadastro', v_fio_b_cadastro,
        'desconto_pct', v_desconto,
        'desconto_origem', v_desconto_origem,
        'tarifa_liquida', v_liquida,
        'classe', v_classe,
        'coluna_tarifa', v_col_tar,
        'coluna_fio_b', v_col_fio,
        'concessionaria', v_conc,
        'uf', v_uf,
        'linhas_cadastro', v_linhas,
        'plano_id', v_plano -> 'plano_id');
END;
$function$;

-- ---------------------------------------------------------------- 4. fn_auditar_fatura
CREATE OR REPLACE FUNCTION public.fn_auditar_fatura(p_invoice_id uuid)
 RETURNS TABLE(codigo text, severidade text, mensagem text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    f record; v_media numeric; v_variacao numeric; v_razao_cip numeric;
    v_razao_municipio numeric; v_amostras int; v_duplicatas int; v_susp record;
    v_periodo text; v_tarifa numeric; v_encargos numeric;
    v_repassado numeric; v_residuo numeric; v_tolerancia numeric;
begin
    select i.id, i.uc_id, i.mes_referencia, i.reading_status, i.reading_error,
           i.consumo_kwh, i.consumo_compensado, i.iluminacao_publica,
           i.outros_lancamentos, i.parcelamento, i.tarifa_minima,
           i.valor_concessionaria, i.valor_a_pagar, i.economia_reais, i.asaas_payment_id,
           i.data_leitura, i.data_leitura_anterior,
           i.tarifa_concessionaria as snap_tarifa,
           public.fn_tarifa_da_conta(i.te_apurado, i.tusd_apurado) as conta_tarifa,
           public.fn_fio_b_apurado(i.tusd_consumo_unit, i.tusd_compensado_unit) as fio_b_apurado,
           cu.numero_uc, cu.tarifa_concessionaria as uc_tarifa,
           cu.tipo_unidade::text as tipo_unidade, cu.status::text as uc_status,
           cu.address->>'cidade' as cidade, cu.data_desligamento, cu.nao_faturavel
      into f from public.invoices i join public.consumer_units cu on cu.id = i.uc_id
     where i.id = p_invoice_id;

    if not found then
        codigo := 'fatura_inexistente'; severidade := 'bloqueio';
        mensagem := 'Fatura nao encontrada.'; return next; return;
    end if;

    v_periodo := public.fn_periodo_vs_desligamento(f.data_leitura_anterior, f.data_leitura, f.data_desligamento);
    v_tarifa := coalesce(f.conta_tarifa, nullif(f.snap_tarifa, 0), nullif(f.uc_tarifa, 0), 0);
    v_encargos := coalesce(f.iluminacao_publica, 0) + coalesce(f.outros_lancamentos, 0) + coalesce(f.parcelamento, 0);

    -- ---------------- BLOQUEIOS ----------------

    -- UC marcada como nao faturavel (ex.: conta saldo da propria
    -- associacao). Emitir boleto seria a B2W cobrando de si mesma.
    if coalesce(f.nao_faturavel, false) then
        codigo := 'uc_nao_faturavel'; severidade := 'bloqueio';
        mensagem := format('UC %s esta marcada como nao faturavel no cadastro: ela nao gera cobranca ao assinante.', f.numero_uc);
        return next; return;
    end if;

    if v_periodo = 'pos_desligamento' then
        codigo := 'conta_pos_desligamento'; severidade := 'bloqueio';
        mensagem := format('UC %s foi desligada em %s, mas esta conta cobre %s a %s -- periodo inteiro posterior ao desligamento. Nao e devida pelo assinante.',
                           f.numero_uc, to_char(f.data_desligamento, 'DD/MM/YYYY'),
                           to_char(f.data_leitura_anterior, 'DD/MM/YYYY'),
                           coalesce(to_char(f.data_leitura, 'DD/MM/YYYY'), '?')); return next;
    end if;

    if f.reading_status = 'error' then
        codigo := 'extracao_reprovada'; severidade := 'bloqueio';
        mensagem := coalesce(f.reading_error, 'A leitura da conta foi reprovada na conferencia.'); return next;
    end if;

    if coalesce(f.consumo_compensado, 0) > 0 and v_tarifa = 0 then
        codigo := 'tarifa_ausente'; severidade := 'bloqueio';
        mensagem := format('UC %s tem %s kWh compensados mas tarifa zerada: a economia sairia zero e o assinante seria cobrado a menos.',
                           f.numero_uc, round(f.consumo_compensado)); return next;
    end if;

    -- 20261012f: o boleto cobra pela tarifa da CONTA. Sem ela, o valor sairia
    -- do cadastro, que difere da conta todo mes (PIS/COFINS) e ja chegou a
    -- 6% de diferenca (UC 198436603202, set/2026).
    -- Bloqueio so com a chave ligada (fn_tarifa_conta_obrigatoria); antes
    -- disso e aviso, porque o robo ainda nao grava os unitarios.
    if coalesce(f.consumo_compensado, 0) > 0 and f.conta_tarifa is null then
        codigo := 'tarifa_conta_ausente';
        severidade := case when public.fn_tarifa_conta_obrigatoria() then 'bloqueio' else 'aviso' end;
        mensagem := format('UC %s compensou %s kWh, mas a tarifa da conta (TE + TUSD unitarios) nao foi lida. Reprocessar o PDF da conta antes de emitir: sem ela o boleto sairia pela tarifa do cadastro (R$ %s/kWh).',
                           f.numero_uc, round(f.consumo_compensado),
                           translate(to_char(coalesce(nullif(f.uc_tarifa, 0), 0), 'FM0.00000'), '.', ',')); return next;
    end if;

    -- 20261012f: RESIDUO entre a conta e o que o boleto repassa.
    -- A concessionaria cobra: Fio B da energia compensada + o que o boleto
    -- repassa (CIP, outros lancamentos, parcelamento, energia nao compensada).
    -- O que sobra nao esta no boleto nem no Fio B: item da conta que ninguem
    -- repassou (multa, juros) ou leitura errada. No razao, esse residuo vira
    -- conta a receber do assinante que nao existe (caso dos R$ 136,62).
    -- Tolerancia do dono: 2% da conta, com piso de R$ 5.
    if coalesce(f.consumo_compensado, 0) > 0 and f.conta_tarifa is not null
       and f.fio_b_apurado is not null and coalesce(f.valor_concessionaria, 0) > 0 then
        v_repassado  := v_encargos + coalesce(f.tarifa_minima, 0);
        v_residuo    := round(f.valor_concessionaria - v_repassado - f.consumo_compensado * f.fio_b_apurado, 2);
        v_tolerancia := greatest(5, round(f.valor_concessionaria * 0.02, 2));
        if abs(v_residuo) > v_tolerancia then
            codigo := 'residuo_conta'; severidade := 'bloqueio';
            mensagem := format('UC %s: a conta de R$ %s nao fecha com o que o boleto repassa. Repassado R$ %s (iluminacao, outros, parcelamento, energia nao compensada) + Fio B R$ %s (%s kWh x %s) = R$ %s; %s R$ %s (tolerancia R$ %s). Conferir na conta multas, juros ou itens nao lidos antes de emitir.',
                               f.numero_uc, fn_moeda_br(f.valor_concessionaria),
                               fn_moeda_br(v_repassado),
                               fn_moeda_br(round(f.consumo_compensado * f.fio_b_apurado, 2)),
                               round(f.consumo_compensado),
                               translate(to_char(f.fio_b_apurado, 'FM0.00000'), '.', ','),
                               fn_moeda_br(round(v_repassado + f.consumo_compensado * f.fio_b_apurado, 2)),
                               case when v_residuo > 0 then 'a conta cobra a mais' else 'o boleto repassa a mais' end,
                               fn_moeda_br(abs(v_residuo)), fn_moeda_br(v_tolerancia)); return next;
        end if;
    end if;

    -- A parcela de energia sumiu: sobrou so o repasse fixo.
    if coalesce(f.consumo_compensado, 0) > 0
       and coalesce(f.valor_a_pagar, 0) > 0
       and f.valor_a_pagar <= v_encargos + 0.01 then
        codigo := 'energia_sumida'; severidade := 'bloqueio';
        mensagem := format('UC %s compensou %s kWh, mas a fatura de R$ %s nao passa dos encargos fixos (R$ %s de iluminacao, outros e parcelamento). A energia compensada nao entrou no calculo.',
                           f.numero_uc, round(f.consumo_compensado),
                           fn_moeda_br(f.valor_a_pagar), fn_moeda_br(v_encargos)); return next;
    end if;

    if coalesce(f.consumo_compensado, 0) = 0 and coalesce(f.valor_concessionaria, 0) > 0
       and coalesce(f.valor_a_pagar, 0) > 0 and f.valor_a_pagar < f.valor_concessionaria * 0.9 then
        codigo := 'abaixo_da_conta'; severidade := 'bloqueio';
        mensagem := format('UC %s nao compensou energia, mas o assinante pagaria R$ %s contra uma conta de R$ %s da concessionaria.',
                           f.numero_uc, fn_moeda_br(f.valor_a_pagar), fn_moeda_br(f.valor_concessionaria)); return next;
    end if;

    select count(*) into v_duplicatas from public.invoices d
     where d.uc_id = f.uc_id and d.mes_referencia = f.mes_referencia
       and d.id <> f.id and d.status::text not in ('cancelado', 'cancelada');
    if v_duplicatas > 0 then
        codigo := 'duplicidade'; severidade := 'bloqueio';
        mensagem := format('Existem %s outra(s) fatura(s) ativa(s) da UC %s no mesmo mes de referencia.',
                           v_duplicatas, f.numero_uc); return next;
    end if;

    if coalesce(f.valor_a_pagar, 0) <= 0 then
        codigo := 'sem_valor'; severidade := 'bloqueio';
        mensagem := 'Valor a pagar ausente ou zerado -- a fatura ainda nao foi calculada.'; return next;
    end if;

    if f.asaas_payment_id is not null then
        codigo := 'ja_cobrada'; severidade := 'bloqueio';
        mensagem := format('Fatura ja possui cobranca no Asaas (%s).', f.asaas_payment_id); return next;
    end if;

    -- ---------------- AVISOS ----------------

    if v_periodo = 'atravessa' then
        codigo := 'periodo_atravessa_desligamento'; severidade := 'aviso';
        mensagem := format('UC %s foi desligada em %s, no meio do periodo %s a %s: so a parte anterior ao desligamento e devida, o valor precisa ser rateado.',
                           f.numero_uc, to_char(f.data_desligamento, 'DD/MM/YYYY'),
                           to_char(f.data_leitura_anterior, 'DD/MM/YYYY'),
                           to_char(f.data_leitura, 'DD/MM/YYYY')); return next;
    end if;

    if f.data_desligamento is null then
        select * into v_susp from public.fn_suspeita_desligamento(f.id);
        if v_susp.suspeita then
            codigo := 'suspeita_desligamento'; severidade := 'aviso';
            mensagem := format('UC %s: ultima conta com ciclo de %s dias contra mediana de %s em %s faturas. Ciclo curto sem leitura depois e assinatura de encerramento -- conferir no portal se a UC foi desligada e registrar a data.',
                               f.numero_uc, v_susp.dias_ciclo, v_susp.mediana, v_susp.ciclos); return next;
        end if;
    end if;

    if coalesce(f.consumo_compensado, 0) > 0 and coalesce(f.valor_a_pagar, 0) > 0
       and coalesce(f.economia_reais, 0) = 0 then
        codigo := 'desconto_ausente'; severidade := 'aviso';
        mensagem := format('UC %s compensou %s kWh mas a economia ficou zerada -- conferir se o desconto entrou no valor.',
                           f.numero_uc, round(f.consumo_compensado)); return next;
    end if;

    -- 20261012f: cadastro defasado. Nao muda o boleto (que usa a conta), mas
    -- o cadastro alimenta auditoria e viabilidade de planos e usinas.
    if f.conta_tarifa is not null and coalesce(f.uc_tarifa, 0) > 0
       and abs(f.conta_tarifa - f.uc_tarifa) / f.conta_tarifa > 0.02 then
        codigo := 'cadastro_defasado'; severidade := 'aviso';
        mensagem := format('UC %s: a conta cobra R$ %s/kWh e o cadastro da UC diz R$ %s/kWh (%s%% de diferenca). Atualizar o cadastro.',
                           f.numero_uc,
                           translate(to_char(f.conta_tarifa, 'FM0.00000'), '.', ','),
                           translate(to_char(f.uc_tarifa, 'FM0.00000'), '.', ','),
                           round(abs(f.conta_tarifa - f.uc_tarifa) / f.conta_tarifa * 100, 1)); return next;
    end if;

    if f.reading_status is distinct from 'success' and f.reading_status is distinct from 'error' then
        codigo := 'leitura_pendente'; severidade := 'aviso';
        mensagem := format('A conta ainda nao passou pela conferencia (reading_status = %s).',
                           coalesce(f.reading_status, 'nulo')); return next;
    end if;

    select avg(a.valor_concessionaria) into v_media
      from (select v.valor_concessionaria from public.invoices v
             where v.uc_id = f.uc_id and v.mes_referencia < f.mes_referencia
               and coalesce(v.valor_concessionaria, 0) > 0
               and v.status::text not in ('cancelado', 'cancelada')
             order by v.mes_referencia desc limit 3) a;
    if v_media > 0 and coalesce(f.valor_concessionaria, 0) > 0 then
        v_variacao := abs(f.valor_concessionaria - v_media) / v_media;
        if v_variacao > 0.5 then
            codigo := 'variacao'; severidade := 'aviso';
            mensagem := format('Conta de R$ %s contra media de R$ %s nos 3 meses anteriores (%s%% de diferenca).',
                               fn_moeda_br(f.valor_concessionaria), fn_moeda_br(v_media), round(v_variacao * 100)); return next;
        end if;
    end if;

    if f.tipo_unidade = 'beneficiaria' and f.uc_status in ('ativo','em_atraso','em_transf_titularidade')
       and coalesce(f.consumo_compensado, 0) = 0 then
        codigo := 'sem_compensacao'; severidade := 'aviso';
        mensagem := format('UC %s esta ativa como beneficiaria mas nao teve energia compensada no mes.', f.numero_uc); return next;
    end if;

    if coalesce(f.consumo_kwh, 0) > 0 and coalesce(f.iluminacao_publica, 0) > 0 and f.cidade is not null then
        v_razao_cip := f.iluminacao_publica / f.consumo_kwh;
        select percentile_cont(0.5) within group (order by o.iluminacao_publica / o.consumo_kwh), count(*)
          into v_razao_municipio, v_amostras
          from public.invoices o join public.consumer_units c on c.id = o.uc_id
         where c.address->>'cidade' = f.cidade and o.id <> f.id
           and coalesce(o.consumo_kwh, 0) > 0 and coalesce(o.iluminacao_publica, 0) > 0
           and o.status::text not in ('cancelado','cancelada');
        if v_amostras >= 3 and v_razao_municipio > 0
           and abs(v_razao_cip - v_razao_municipio) / v_razao_municipio > 0.05 then
            codigo := 'cip_fora_do_padrao'; severidade := 'aviso';
            mensagem := format('Iluminacao publica de R$ %s da %s R$/kWh, contra %s R$/kWh de %s (%s faturas).',
                               fn_moeda_br(f.iluminacao_publica),
                               translate(to_char(v_razao_cip,'FM0.00000'),'.',','),
                               translate(to_char(v_razao_municipio,'FM0.00000'),'.',','),
                               f.cidade, v_amostras); return next;
        end if;
    end if;
    return;
end; $function$;
