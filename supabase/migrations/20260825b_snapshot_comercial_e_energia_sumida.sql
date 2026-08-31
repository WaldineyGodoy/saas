-- Dois defeitos achados no faturamento das contas de 07/2026.
--
-- ---------------------------------------------------------------------------
-- DEFEITO 1 -- a fatura saia so com o repasse fixo
--
-- O robo gravava quantidades (kWh, compensado, CIP, outras despesas) e ninguem
-- gravava os parametros do contrato. Com tarifa e desconto nulos na linha, o
-- calculo perdia inteiramente a parcela de energia compensada e sobrava so o
-- repasse: a UC 7030004455 saia por R$ 38,12 -- exatamente IP 36,94 + outros
-- 1,18 -- com 263 kWh compensados. O devido eram R$ 303,75.
--
-- A gravidade nao esta no tamanho do erro, esta na aparencia: R$ 38,12 nao
-- parece defeito, parece uma conta baixa. Sem portao, vira boleto.
--
-- Agora a fatura guarda SNAPSHOT do que valia quando foi calculada -- tarifa,
-- desconto e franquia. Snapshot e nao leitura ao vivo pela razao que o nucleo
-- tarifario documentou em 08/08/2026: cadastro mutavel torna faturamento
-- historico irreproduzivel. A tarifa da UC pode mudar amanha; a fatura fechada
-- nao pode mudar junto.
--
-- Ordem de resolucao da tarifa: snapshot -> cadastro da UC ->
-- fn_tarifa_referencia (concessionaria + UF). Nunca digitada.
--
-- NAO copio te_apurado, tusd_apurado nem fio_b_apurado: esses campos sao do
-- nucleo tarifario e significam "apurado NA CONTA", nao "vindo do cadastro".
-- Enche-los com valor de cadastro corromperia a auditoria tarifaria, que
-- compara justamente conta contra referencia.
-- ---------------------------------------------------------------------------

create or replace function public.fn_calcular_fatura(
    p_invoice_id uuid,
    p_gravar boolean default false
) returns table (
    consumo_reais numeric,
    tarifa_minima numeric,
    economia_reais numeric,
    desconto_aplicado numeric,
    valor_a_pagar numeric
)
language plpgsql
security definer
set search_path = public
as $$
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
    select i.id, i.consumo_kwh, i.consumo_compensado, i.iluminacao_publica,
           i.outros_lancamentos, i.parcelamento, i.desconto_aplicado,
           i.valor_concessionaria, i.asaas_payment_id,
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

    -- nullif porque zero aqui e ausencia, nao decisao (COALESCE nao trata zero).
    v_tarifa := coalesce(nullif(f.snap_tarifa, 0), nullif(f.uc_tarifa, 0));
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

    if coalesce(f.consumo_compensado, 0) = 0 then
        -- MODO REPASSE: sem compensacao nao ha desconto a dar.
        economia_reais := 0;
        tarifa_minima  := 0;
        valor_a_pagar  := greatest(0, round(coalesce(f.valor_concessionaria, 0), 2));
        consumo_reais  := greatest(0, round(valor_a_pagar - v_encargos, 2));
    else
        -- MODO COMPENSACAO
        v_compensada  := round(coalesce(f.consumo_compensado, 0) * v_tarifa * (1 - v_multiplicador), 2);
        tarifa_minima := round(greatest(0, (coalesce(f.consumo_kwh, 0) - coalesce(f.consumo_compensado, 0)) * v_tarifa), 2);
        economia_reais := round(coalesce(f.consumo_compensado, 0) * v_tarifa * v_multiplicador, 2);
        consumo_reais := v_compensada + tarifa_minima;
        valor_a_pagar := greatest(0, round(v_compensada + tarifa_minima + v_encargos, 2));
    end if;

    if p_gravar then
        update public.invoices i
           set consumo_reais         = fn_calcular_fatura.consumo_reais,
               tarifa_minima         = fn_calcular_fatura.tarifa_minima,
               economia_reais        = fn_calcular_fatura.economia_reais,
               desconto_aplicado     = fn_calcular_fatura.desconto_aplicado,
               valor_a_pagar         = fn_calcular_fatura.valor_a_pagar,
               tarifa_concessionaria = v_tarifa,
               desconto_assinante    = v_desconto,
               franquia              = coalesce(v_franquia, i.franquia)
         where i.id = p_invoice_id;
    end if;

    return next;
end;
$$;

comment on function public.fn_calcular_fatura(uuid, boolean) is
    'Calcula o valor do assinante e congela o snapshot comercial na fatura. Tarifa: snapshot -> cadastro da UC -> fn_tarifa_referencia. Dois modos: sem compensacao repassa a conta; com compensacao aplica o desconto.';

-- ---------------------------------------------------------------------------
-- DEFEITO 2 -- portao novo em fn_auditar_fatura (corpo completo em 20260823a)
--
-- energia_sumida (BLOQUEIO): compensou energia mas o valor nao passa dos
--   encargos fixos. Quem compensa SEMPRE paga a energia compensada com
--   desconto; se o total nao supera IP + outros + parcelamento, a parcela de
--   energia sumiu do calculo. Pega exatamente o caso dos R$ 38,12, que o
--   portao tarifa_ausente nao pegava -- ali a tarifa existia no cadastro, o
--   que faltava era alguem ter calculado.
--
-- tarifa_ausente passa a olhar a tarifa EFETIVA (snapshot da fatura OU cadastro
--   da UC), nao so o cadastro.
--
-- Zero falsos positivos nas 48 faturas ja cobradas.
-- ---------------------------------------------------------------------------
