-- Ponte conta -> fatura: o valor do assinante se calcula sozinho quando os
-- fatos da conta chegam, por qualquer caminho de escrita.
--
-- Por que existe: em 17/10/2026 o reprocesso da Cosern criou 26 faturas da
-- Guanabara e da Associacao (06 a 09/2026) com o valor da conta e o consumo,
-- mas sem passar pela fn_calcular_fatura -- ela so roda quando alguem a chama
-- (robo, recuperador, tela). As faturas ficaram com valor_a_pagar zero e a
-- auditoria barrou a emissao com `sem_valor`. O zero era seguro; o defeito era
-- nao existir ponte entre a leitura da conta e o faturamento.
--
-- A regra da ponte: fato incompleto nao vira valor. Calcular com a CIP nula
-- daria um boleto MENOR que o devido (v_encargos = 0), e um valor maior que
-- zero passa pelo emissor -- trocaria um zero seguro por uma cobranca a menos
-- silenciosa. Por isso:
--   * fn_fatura_fatos_pendentes diz o que falta ler na conta (nulo = completo);
--   * o gatilho so calcula com os fatos completos e, quando nao estao, grava o
--     motivo em `calculo_pendente` e deixa o valor como esta;
--   * a propria fn_calcular_fatura passa a recusar GRAVAR com fato faltando,
--     para que nenhum outro caminho (tela, robo, recuperador) contorne a regra.
--     A simulacao (p_gravar = false) segue livre: e o preview da tela.
--
-- Nulo e "nao lido"; zero e "a conta nao cobrou". O extrator grava 0 quando a
-- conta nao tem o item, e as colunas nao tem default, entao nulo so aparece
-- quando a leitura nao aconteceu.
--
-- A tarifa impressa (te/tusd) NAO e requisito aqui: na falta dela a fatura
-- cai para a tarifa do cadastro, como ja faz hoje, e a auditoria avisa com
-- `tarifa_conta_ausente`. Endurecer isso e outra decisao (ver 20261012f).

alter table public.invoices
    add column if not exists calculo_pendente text,
    add column if not exists calculado_em timestamptz;

comment on column public.invoices.calculo_pendente is
    'O que falta ler na conta para o valor do assinante ser calculado (nulo = nada pendente). Gravado pela ponte 20261103a.';
comment on column public.invoices.calculado_em is
    'Quando a fn_calcular_fatura gravou o valor do assinante pela ultima vez.';


-- ---------------------------------------------------------------------------
-- O que falta ler na conta. Nulo = fatos completos.
-- ---------------------------------------------------------------------------
create or replace function public.fn_fatura_fatos_pendentes(p_invoice_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case
        when i.id is null                            then 'fatura inexistente'
        when coalesce(i.valor_concessionaria, 0) <= 0 then 'valor da conta ausente'
        when i.consumo_kwh is null                   then 'consumo (kWh) nao lido'
        when i.consumo_compensado is null            then 'compensado (kWh) nao lido'
        when i.iluminacao_publica is null            then 'iluminacao publica nao lida'
        when i.outros_lancamentos is null            then 'outros lancamentos nao lidos'
    end
      from (select 1) um
      left join public.invoices i on i.id = p_invoice_id;
$$;

revoke all on function public.fn_fatura_fatos_pendentes(uuid) from public, anon;
grant execute on function public.fn_fatura_fatos_pendentes(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Nucleo do calculo: a mesma formula de sempre, sem o portao de permissao,
-- para o gatilho poder chama-la qualquer que seja o papel de quem gravou a
-- conta. Nao e exposta: so a fn_calcular_fatura e o gatilho a chamam.
-- ---------------------------------------------------------------------------
create or replace function public.fn_calcular_fatura_nucleo(p_invoice_id uuid, p_gravar boolean default false)
returns table(consumo_reais numeric, tarifa_minima numeric, economia_reais numeric, desconto_aplicado numeric, valor_a_pagar numeric)
language plpgsql
security definer
set search_path = public
as $function$
declare
    f record;
    v_desconto numeric;
    v_multiplicador numeric;
    v_compensada numeric;
    v_encargos numeric;
    v_tarifa numeric;
    v_ref record;
    v_franquia numeric;
    v_pendente text;
begin
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

    -- Fato incompleto nao vira valor (20261103a).
    if p_gravar then
        v_pendente := public.fn_fatura_fatos_pendentes(p_invoice_id);
        if v_pendente is not null then
            raise exception 'Fatura % sem os fatos da conta completos (%); reprocessar o PDF antes de calcular.',
                p_invoice_id, v_pendente;
        end if;
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
           set consumo_reais         = fn_calcular_fatura_nucleo.consumo_reais,
               tarifa_minima         = fn_calcular_fatura_nucleo.tarifa_minima,
               economia_reais        = fn_calcular_fatura_nucleo.economia_reais,
               desconto_aplicado     = fn_calcular_fatura_nucleo.desconto_aplicado,
               valor_a_pagar         = fn_calcular_fatura_nucleo.valor_a_pagar,
               -- snapshot: o que valia no momento em que a fatura foi calculada
               tarifa_concessionaria = v_tarifa,
               desconto_assinante    = v_desconto,
               franquia              = coalesce(v_franquia, i.franquia),
               calculo_pendente      = null,
               calculado_em          = now()
         where i.id = p_invoice_id;
    end if;

    return next;
end;
$function$;

revoke all on function public.fn_calcular_fatura_nucleo(uuid, boolean) from public, anon, authenticated;
grant execute on function public.fn_calcular_fatura_nucleo(uuid, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- A funcao publica continua com a mesma assinatura e o mesmo portao; so
-- delega a conta ao nucleo.
-- ---------------------------------------------------------------------------
create or replace function public.fn_calcular_fatura(p_invoice_id uuid, p_gravar boolean default false)
returns table(consumo_reais numeric, tarifa_minima numeric, economia_reais numeric, desconto_aplicado numeric, valor_a_pagar numeric)
language plpgsql
security definer
set search_path = public
as $function$
begin
    if not public.fn_chamador_interno() then
        raise exception 'Sem permissao.' using errcode = '42501';
    end if;

    return query select * from public.fn_calcular_fatura_nucleo(p_invoice_id, p_gravar);
end;
$function$;


-- ---------------------------------------------------------------------------
-- O gatilho.
--
-- Dispara quando muda um FATO da conta (ou o status), nunca quando muda um
-- resultado do calculo -- e isso que impede o UPDATE do nucleo de reacionar o
-- gatilho. Fica de fora:
--   * fatura com cobranca no Asaas, ou dentro de consolidada ja cobrada:
--     recalcular mudaria um valor que o assinante ja recebeu;
--   * status que nao e de fatura a emitir (pago, cancelado, a_vencer...);
--   * UC geradora sem consumo de terceiro: nao se fatura (fn_ug_sem_cobranca).
-- So grava quando o resultado difere do que esta na linha, para nao encher o
-- historico com alteracoes que nao alteram nada.
-- ---------------------------------------------------------------------------
create or replace function public.fn_ponte_calculo_fatura()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_motivo text;
    v_calc record;
begin
    if new.asaas_payment_id is not null then
        return null;
    end if;

    if new.status::text not in ('sem_faturamento', 'ag_emissao_boleto') then
        return null;
    end if;

    if new.consolidated_invoice_id is not null and exists (
        select 1 from public.consolidated_invoices c
         where c.id = new.consolidated_invoice_id
           and c.asaas_payment_id is not null
    ) then
        return null;
    end if;

    if exists (
        select 1 from public.consumer_units cu
         where cu.id = new.uc_id
           and cu.tipo_unidade = 'geradora'
           and not coalesce(cu.fatura_consumo_terceiro, false)
    ) then
        return null;
    end if;

    v_motivo := public.fn_fatura_fatos_pendentes(new.id);
    if v_motivo is not null then
        if new.calculo_pendente is distinct from v_motivo then
            update public.invoices set calculo_pendente = v_motivo where id = new.id;
        end if;
        return null;
    end if;

    -- A ponte nunca derruba a gravacao da conta: se o calculo falhar, a conta
    -- fica gravada e o motivo vai para calculo_pendente.
    begin
        select * into v_calc from public.fn_calcular_fatura_nucleo(new.id, false);

        if v_calc.valor_a_pagar  is distinct from new.valor_a_pagar
        or v_calc.consumo_reais  is distinct from new.consumo_reais
        or v_calc.tarifa_minima  is distinct from new.tarifa_minima
        or v_calc.economia_reais is distinct from new.economia_reais
        or new.calculo_pendente is not null
        or new.calculado_em is null then
            perform public.fn_calcular_fatura_nucleo(new.id, true);
        end if;
    exception when others then
        update public.invoices
           set calculo_pendente = left('falha no calculo: ' || sqlerrm, 300)
         where id = new.id;
    end;

    return null;
end;
$$;

revoke all on function public.fn_ponte_calculo_fatura() from public, anon, authenticated;

drop trigger if exists tr_ponte_calculo_fatura on public.invoices;
create trigger tr_ponte_calculo_fatura
    after insert or update of
        consumo_kwh, consumo_compensado, iluminacao_publica, outros_lancamentos,
        parcelamento, valor_concessionaria, te_apurado, tusd_apurado, status
    on public.invoices
    for each row
    execute function public.fn_ponte_calculo_fatura();
