-- Dois modelos de cobranca, nao um.
--
-- Sem compensacao nao ha desconto a dar: o assinante paga o REPASSE da conta
-- da concessionaria. E o que as UCs em 'aguardando_conexao' sempre fizeram --
-- das 8 faturas sem compensacao ja cobradas, 6 tem valor_a_pagar identico ao
-- valor_concessionaria. Decisao do dono em 23/08/2026.
--
-- Sem isso a formula dava numero errado nessas UCs: a 7030765391, com tarifa
-- zerada no cadastro, sairia por R$ 253,32 contra uma conta de R$ 1.700,90 --
-- R$ 1.447 do bolso da B2W.
--
-- A regra nao olha o status da UC, olha a compensacao. Uma beneficiaria ativa
-- que num mes nao recebeu rateio tambem cai no repasse, que e o certo: nao
-- houve energia compensada para descontar.
--
-- Conferido depois da mudanca: das 8 faturas sem compensacao ja cobradas, 6
-- sao reproduzidas ao centavo (as 2 restantes ja divergiam antes, sao ajustes
-- manuais); das 37 com compensacao, 36 seguem gerando economia > 0 -- a
-- restante tem tarifa zerada e o portao tarifa_ausente a barra.

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
begin
    select i.id, i.consumo_kwh, i.consumo_compensado, i.iluminacao_publica,
           i.outros_lancamentos, i.parcelamento, i.desconto_aplicado,
           i.valor_concessionaria, i.asaas_payment_id,
           cu.tarifa_concessionaria as uc_tarifa,
           cu.desconto_assinante as uc_desconto
      into f
      from public.invoices i
      join public.consumer_units cu on cu.id = i.uc_id
     where i.id = p_invoice_id;

    if not found then
        raise exception 'Fatura % nao encontrada.', p_invoice_id;
    end if;

    -- Fatura ja cobrada nao se recalcula: mudaria em silencio um valor que o
    -- assinante ja recebeu como boleto.
    if p_gravar and f.asaas_payment_id is not null then
        raise exception 'Fatura % ja tem cobranca no Asaas (%); recalcular mudaria um valor ja cobrado.',
            p_invoice_id, f.asaas_payment_id;
    end if;

    -- nullif, nao coalesce: zero aqui e ausencia, nao decisao.
    v_desconto := coalesce(nullif(f.desconto_aplicado, 0), nullif(f.uc_desconto, 0), 0);
    v_multiplicador := case when v_desconto > 1 then v_desconto / 100 else v_desconto end;
    desconto_aplicado := v_desconto;

    v_encargos := coalesce(f.iluminacao_publica, 0)
                + coalesce(f.outros_lancamentos, 0)
                + coalesce(f.parcelamento, 0);

    -- ---------------- MODO REPASSE ----------------
    if coalesce(f.consumo_compensado, 0) = 0 then
        economia_reais := 0;
        tarifa_minima  := 0;
        valor_a_pagar  := greatest(0, round(coalesce(f.valor_concessionaria, 0), 2));
        -- O que sobra depois dos encargos e a energia da propria conta.
        consumo_reais  := greatest(0, round(valor_a_pagar - v_encargos, 2));

        if p_gravar then
            update public.invoices i
               set consumo_reais     = fn_calcular_fatura.consumo_reais,
                   tarifa_minima     = fn_calcular_fatura.tarifa_minima,
                   economia_reais    = fn_calcular_fatura.economia_reais,
                   desconto_aplicado = fn_calcular_fatura.desconto_aplicado,
                   valor_a_pagar     = fn_calcular_fatura.valor_a_pagar
             where i.id = p_invoice_id;
        end if;
        return next;
        return;
    end if;

    -- ---------------- MODO COMPENSACAO ----------------
    v_compensada  := round(coalesce(f.consumo_compensado, 0) * coalesce(f.uc_tarifa, 0) * (1 - v_multiplicador), 2);
    tarifa_minima := round(greatest(0, (coalesce(f.consumo_kwh, 0) - coalesce(f.consumo_compensado, 0)) * coalesce(f.uc_tarifa, 0)), 2);
    economia_reais := round(coalesce(f.consumo_compensado, 0) * coalesce(f.uc_tarifa, 0) * v_multiplicador, 2);

    consumo_reais := v_compensada + tarifa_minima;
    valor_a_pagar := greatest(0, round(v_compensada + tarifa_minima + v_encargos, 2));

    if p_gravar then
        update public.invoices i
           set consumo_reais     = fn_calcular_fatura.consumo_reais,
               tarifa_minima     = fn_calcular_fatura.tarifa_minima,
               economia_reais    = fn_calcular_fatura.economia_reais,
               desconto_aplicado = fn_calcular_fatura.desconto_aplicado,
               valor_a_pagar     = fn_calcular_fatura.valor_a_pagar
         where i.id = p_invoice_id;
    end if;

    return next;
end;
$$;

comment on function public.fn_calcular_fatura(uuid, boolean) is
    'Calcula o valor do assinante. Dois modos: sem compensacao repassa a conta da concessionaria; com compensacao aplica a formula do desconto. p_gravar=true persiste; recusa se a fatura ja tem cobranca no Asaas.';

-- As 4 faturas de 08/2026 foram calculadas com esta versao (p_gravar = true):
--   7030765324  repasse       R$ 6.591,56
--   7030839166  compensacao   R$ 4.792,81   economia R$ 1.021,27
--   7030765391  repasse       R$ 1.700,90
--   7029875701  repasse       R$   115,63
-- As quatro passam pelos portoes sem bloqueio.
