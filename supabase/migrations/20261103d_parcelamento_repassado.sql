-- Parcelamento da conta que NAO se repassa ao assinante.
--
-- A conta de 08/2026 da UC 130179303270 (Guanabara) traz "Parc2/2 *104571
-- R$ 134,97" -- parcela de um acordo com a Cosern -- e a fn_calcular_fatura
-- soma todo parcelamento aos encargos do boleto: R$ 984,63 em vez de
-- R$ 849,66. Decisao do dono (03/11/2026): essa parcela nao e cobrada do
-- assinante.
--
-- Zerar invoices.parcelamento seria falsificar a conta: a Cosern cobra a
-- parcela, e a auditoria acusaria o residuo. O fato fica; o que muda e se ele
-- vai ao boleto:
--   * invoices.parcelamento_repassado (default true = comportamento atual);
--   * o nucleo do calculo so soma o parcelamento quando repassado;
--   * a auditoria NAO muda: o residuo mede se a conta fecha com o que foi
--     identificado nela, e a parcela continua identificada;
--   * o gatilho da ponte tambem dispara quando o marcador muda.

alter table public.invoices
    add column if not exists parcelamento_repassado boolean not null default true;

comment on column public.invoices.parcelamento_repassado is
    'false = o parcelamento impresso na conta fica com a B2W e nao entra no boleto do assinante (20261103d).';

-- O nucleo muda em dois trechos; troca e confere que cada um pegou.
do $mig$
declare
    d text := pg_get_functiondef('public.fn_calcular_fatura_nucleo(uuid, boolean)'::regprocedure);
    trocas text[][] := array[
        array['i.outros_lancamentos, i.parcelamento, i.desconto_aplicado,',
              'i.outros_lancamentos, i.parcelamento, i.parcelamento_repassado, i.desconto_aplicado,'],
        array['+ coalesce(f.parcelamento, 0);',
              '+ case when f.parcelamento_repassado then coalesce(f.parcelamento, 0) else 0 end;']
    ];
    i int;
begin
    for i in 1 .. array_length(trocas, 1) loop
        if position(trocas[i][1] in d) = 0 then
            raise exception 'fn_calcular_fatura_nucleo mudou: trecho % nao encontrado', i;
        end if;
        d := replace(d, trocas[i][1], trocas[i][2]);
    end loop;
    execute d;
end
$mig$;

drop trigger if exists tr_ponte_calculo_fatura on public.invoices;
create trigger tr_ponte_calculo_fatura
    after insert or update of
        consumo_kwh, consumo_compensado, iluminacao_publica, outros_lancamentos,
        parcelamento, parcelamento_repassado, valor_concessionaria,
        te_apurado, tusd_apurado, status
    on public.invoices
    for each row
    execute function public.fn_ponte_calculo_fatura();
