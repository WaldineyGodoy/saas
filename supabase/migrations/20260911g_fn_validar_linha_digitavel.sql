-- Task 8 do plano 2026-09-11-arrendamento-repasse.
--
-- A linha digitavel carrega dentro dela o valor e o vencimento. Conferir os
-- dois contra o esperado antes de chamar o Asaas e' trava de graca contra
-- colar o boleto do mes errado ou de outro credor.
--
-- O valor BLOQUEIA. O vencimento so' avisa: imobiliaria reemite boleto com
-- vencimento novo e o valor continua sendo o que importa.
--
-- Formato que a funcao nao sabe ler e' recusado explicitamente. Aceitar o
-- desconhecido seria pagar de olhos fechados.

create or replace function public.fn_validar_linha_digitavel(
    p_linha      text,
    p_valor      numeric,
    p_vencimento date default null
)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $$
declare
    v_d       text;
    v_cod     text;
    v_len     int;
    v_formato text;
    v_cent    numeric;
    v_fator   int;
    v_venc    date;
    v_div     text[] := array[]::text[];
    v_ok      boolean := true;
begin
    if p_linha is null then
        return jsonb_build_object('ok', false, 'formato', null,
            'divergencias', array['linha digitavel ausente']::text[]);
    end if;

    v_d := regexp_replace(p_linha, '[^0-9]', '', 'g');
    v_len := length(v_d);

    if v_len = 47 then
        -- Boleto bancario (titulo). O campo 5 da linha digitavel e' o proprio
        -- fim do codigo de barras: 4 digitos de fator de vencimento e 10 de
        -- valor em centavos.
        v_formato := 'bancario';
        v_fator := substring(v_d from 34 for 4)::int;
        v_cent  := substring(v_d from 38 for 10)::numeric;

    elsif v_len = 48 then
        -- Arrecadacao (convenio): 4 blocos de 12, cada um com 11 digitos uteis
        -- e 1 DV. Removidos os DVs sobra o codigo de barras de 44, e o valor
        -- mora nos digitos 5 a 15.
        v_formato := 'arrecadacao';
        v_cod := substring(v_d from  1 for 11)
              || substring(v_d from 13 for 11)
              || substring(v_d from 25 for 11)
              || substring(v_d from 37 for 11);
        v_cent := substring(v_cod from 5 for 11)::numeric;
        v_fator := null;

    else
        return jsonb_build_object('ok', false, 'formato', 'desconhecido',
            'digitos', v_len,
            'divergencias', array['linha digitavel com ' || v_len || ' digitos: nao e boleto bancario (47) nem arrecadacao (48)']::text[]);
    end if;

    -- Fator de vencimento: dias desde 07/10/1997. A FEBRABAN reiniciou em
    -- 1000 em 22/02/2025, entao um fator baixo pode ser das duas eras. Se a
    -- data cair muito no passado, e' da era nova. E' heuristica, e por isso o
    -- vencimento so' avisa -- quem bloqueia e' o valor.
    if v_fator is not null and v_fator > 0 then
        v_venc := date '1997-10-07' + v_fator;
        if v_venc < date '2023-01-01' then
            v_venc := v_venc + 9000;
        end if;
    end if;

    -- Cast explicito em cada append: literal sem tipo faz o Postgres tentar
    -- interpretar a string como array e estourar malformed array literal.
    if p_valor is null then
        v_ok := false;
        v_div := v_div || array['valor esperado nao informado: nao da para conferir']::text[];
    elsif round(v_cent / 100.0, 2) is distinct from round(p_valor, 2) then
        v_ok := false;
        v_div := v_div || array[format('valor do boleto e R$ %s, mas o pagamento previsto e R$ %s',
                                       round(v_cent / 100.0, 2), round(p_valor, 2))]::text[];
    end if;

    if p_vencimento is not null and v_venc is not null and v_venc is distinct from p_vencimento then
        v_div := v_div || array[format('vencimento do boleto e %s, e o previsto era %s', v_venc, p_vencimento)]::text[];
    end if;

    return jsonb_build_object(
        'ok',                v_ok,
        'formato',           v_formato,
        'valor_boleto',      round(v_cent / 100.0, 2),
        'vencimento_boleto', v_venc,
        'divergencias',      v_div
    );
end;
$$;

revoke execute on function public.fn_validar_linha_digitavel(text, numeric, date) from public, anon;
grant  execute on function public.fn_validar_linha_digitavel(text, numeric, date) to authenticated, service_role;
