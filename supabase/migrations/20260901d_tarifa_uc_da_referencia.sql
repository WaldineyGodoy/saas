-- ============================================================================
-- Tarifa da UC vazia resolve sozinha das Tarifas Concessionárias
--
-- `tarifa_concessionaria = 0` na UC zera o cálculo do assinante inteiro — é o
-- defeito nº 1 do pipeline, aberto desde 20/08/2026. Em 01/09 ainda havia seis
-- UCs assim, todas do Mirantes Green Park, e uma delas (7030765391) apareceu na
-- tela com R$ 73,44 numa conta de R$ 509,06.
--
-- A tarifa não se digita: vem de Configurações → Conta de Energia → Tarifas
-- Concessionárias, resolvida por concessionária + UF. Este gatilho torna isso
-- verdade no dado, em vez de depender de cada leitor lembrar do fallback.
--
-- Zero e nulo são tratados igual DE PROPÓSITO: `COALESCE` não trata zero, e o
-- default da coluna é 0 — foi assim que o desconto sumiu na UC 7030839166.
-- ============================================================================

create or replace function public.fn_resolver_tarifa_uc()
returns trigger
language plpgsql
as $$
declare
    v_tarifa numeric;
begin
    if coalesce(new.tarifa_concessionaria, 0) = 0 and new.concessionaria is not null then
        select t.tarifa_concessionaria into v_tarifa
        from public.fn_tarifa_referencia(
            new.concessionaria,
            coalesce(new.address->>'uf', 'RN'),
            null
        ) t;

        if coalesce(v_tarifa, 0) > 0 then
            new.tarifa_concessionaria := v_tarifa;
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists tr_resolver_tarifa_uc on public.consumer_units;
create trigger tr_resolver_tarifa_uc
    before insert or update on public.consumer_units
    for each row execute function public.fn_resolver_tarifa_uc();

-- Preenche as que já estavam zeradas (6 UCs do Mirantes → 1,032 Cosern/RN).
update public.consumer_units
set tarifa_concessionaria = tarifa_concessionaria
where coalesce(tarifa_concessionaria, 0) = 0;
