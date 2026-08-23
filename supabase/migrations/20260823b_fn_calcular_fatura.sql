-- A formula do faturamento sai da tela.
--
-- Ela vivia num useEffect do InvoiceFormModal: nenhum processo de servidor
-- sabia calcular o valor do assinante, e era isso que travava qualquer
-- "gerar fatura" automatico.
--
--   energia_compensada = compensado * tarifa * (1 - desconto)
--   tarifa_minima      = max(0, (consumo - compensado) * tarifa)
--   economia           = compensado * tarifa * desconto
--   consumo_reais      = energia_compensada + tarifa_minima
--   valor_a_pagar      = max(0, energia_compensada + tarifa_minima + IP + outros + parcelamento)
--
-- Validada contra as 82 faturas da base reimplementando a aritmetica em SQL
-- puro sobre os mesmos insumos: 82 de 82 batem, diferenca maxima 0,0000.
--
-- NAO validei contra o valor historico gravado, e isso e proposital: o
-- historico nao e homogeneo. Parte das faturas foi lancada por upload manual,
-- parte e repasse puro (valor_a_pagar = valor_concessionaria em UC
-- 'aguardando_conexao'), e insumos como a tarifa mudaram depois. Comparar com
-- o passado mediria proveniencia, nao aritmetica.
--
-- Duas diferencas propositais em relacao a tela:
--
--   1. Arredonda em 2 casas. A tela gravava o float cru -- a base tem valores
--      como 2409.182 -- e o boleto arredondava so na hora de cobrar, entao o
--      numero exibido e o cobrado ja divergiam.
--
--   2. NULLIF no desconto, nao COALESCE. As 4 faturas de 08/2026 tinham
--      desconto_aplicado = 0 (default da coluna; o robo nunca escreve esse
--      campo) enquanto a UC tinha 20%. Com COALESCE o desconto sumia: a UC
--      7030839166 daria R$ 5.814,08 ao assinante contra uma conta de
--      R$ 1.764,91, com economia ZERO em 4.948 kWh compensados. E a mesma
--      armadilha que a migration de 08/08/2026 documentou para
--      gestao_percentual -- "COALESCE(x,15) so age em NULL".
--
--      Assinante sem desconto se representa com desconto 0 NA UC, que e onde a
--      decisao comercial mora. Zero vindo de default de coluna nunca foi
--      escolha de ninguem.

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
begin
    select i.id, i.consumo_kwh, i.consumo_compensado, i.iluminacao_publica,
           i.outros_lancamentos, i.parcelamento, i.desconto_aplicado,
           i.asaas_payment_id,
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

    v_compensada  := coalesce(f.consumo_compensado, 0) * coalesce(f.uc_tarifa, 0) * (1 - v_multiplicador);
    tarifa_minima := greatest(0, (coalesce(f.consumo_kwh, 0) - coalesce(f.consumo_compensado, 0)) * coalesce(f.uc_tarifa, 0));
    economia_reais := coalesce(f.consumo_compensado, 0) * coalesce(f.uc_tarifa, 0) * v_multiplicador;

    v_compensada   := round(v_compensada, 2);
    tarifa_minima  := round(tarifa_minima, 2);
    economia_reais := round(economia_reais, 2);

    consumo_reais := v_compensada + tarifa_minima;
    desconto_aplicado := v_desconto;

    valor_a_pagar := greatest(0, round(
        v_compensada + tarifa_minima
        + coalesce(f.iluminacao_publica, 0)
        + coalesce(f.outros_lancamentos, 0)
        + coalesce(f.parcelamento, 0), 2));

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
    'Calcula o valor do assinante a partir da conta da concessionaria. Mesma aritmetica do InvoiceFormModal, arredondada em 2 casas. p_gravar=true persiste; recusa se a fatura ja tem cobranca no Asaas.';

revoke all on function public.fn_calcular_fatura(uuid, boolean) from public, anon;
grant execute on function public.fn_calcular_fatura(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dois portoes novos na fn_auditar_fatura, nascidos dos casos de 08/2026.
-- (o corpo completo da funcao esta em 20260823a; aqui ficam so as mudancas
--  aplicadas depois, para o historico ficar legivel)
--
-- abaixo_da_conta (BLOQUEIO): sem compensacao, o assinante nao pode pagar bem
--   menos que a conta -- a diferenca sai do bolso da B2W. A UC 7030765391 tem
--   tarifa zerada e compensado zero: o calculo dava R$ 253,32 contra uma conta
--   de R$ 1.700,90. O portao tarifa_ausente nao pega, porque so olha quem
--   compensa. Zero falsos positivos nas 48 faturas ja cobradas.
--
-- desconto_ausente (AVISO): compensou energia mas a economia saiu zero.
--   Nasceu como bloqueio e foi rebaixado: acusou 5 faturas de 05/2026 ja pagas
--   em que o valor cobrado indica que o desconto FOI aplicado -- o que faltou
--   foi gravar economia_reais. A prova e fragil demais para barrar cobranca.
-- ---------------------------------------------------------------------------
