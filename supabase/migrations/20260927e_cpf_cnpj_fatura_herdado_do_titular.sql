-- CPF/CNPJ da conta de energia passa a ser herdado do titular da conta.
--
-- Regra do dono (27/09/2026): o documento que vai para a Lista de Rateio e
-- para a concessionaria e' o do titular da conta de energia na
-- concessionaria (`titular_fatura_id` -> subscribers.cpf_cnpj), sempre, de
-- forma automatica. Ninguem digita.
--
-- Por que: na troca de titularidade de 24/08 as UCs do Green Park foram para
-- a Bennaya, mas `cpf_cnpj_fatura` ficou com o documento antigo. A tela, ao
-- trocar o titular, so preenchia o campo quando ele estava vazio. A Lista de
-- Rateio da Bom Jesus II (autoconsumo remoto, mesmo titular) sairia com tres
-- titulares diferentes do da UG.
--
-- UC sem titular informado (adesao publica, antes do cadastro do titular)
-- mantem o documento digitado; ao receber o titular, passa a herdar.
-- `titular_fatura_id` nao e' alterado aqui, so lido.

-- ---------------------------------------------------------------------------
-- 1. Na UC: ao gravar titular ou documento, o documento vem do titular
-- ---------------------------------------------------------------------------
create or replace function public.fn_uc_cpf_cnpj_do_titular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_doc text;
begin
    if new.titular_fatura_id is null then
        return new;
    end if;

    select nullif(btrim(t.cpf_cnpj), '')
      into v_doc
      from subscribers t
     where t.id = new.titular_fatura_id;

    -- Titular sem documento no cadastro: nao apaga o que ja existe.
    if v_doc is not null then
        new.cpf_cnpj_fatura := v_doc;
    end if;

    return new;
end;
$$;

drop trigger if exists tr_uc_cpf_cnpj_do_titular on public.consumer_units;
create trigger tr_uc_cpf_cnpj_do_titular
    before insert or update of titular_fatura_id, cpf_cnpj_fatura
    on public.consumer_units
    for each row
    execute function public.fn_uc_cpf_cnpj_do_titular();

-- ---------------------------------------------------------------------------
-- 2. No titular: corrigiu o documento, as UCs dele acompanham
-- ---------------------------------------------------------------------------
create or replace function public.fn_titular_cpf_cnpj_para_ucs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update consumer_units
       set cpf_cnpj_fatura = new.cpf_cnpj
     where titular_fatura_id = new.id
       and cpf_cnpj_fatura is distinct from new.cpf_cnpj;
    return null;
end;
$$;

drop trigger if exists tr_titular_cpf_cnpj_para_ucs on public.subscribers;
create trigger tr_titular_cpf_cnpj_para_ucs
    after update of cpf_cnpj on public.subscribers
    for each row
    when (old.cpf_cnpj is distinct from new.cpf_cnpj
          and nullif(btrim(new.cpf_cnpj), '') is not null)
    execute function public.fn_titular_cpf_cnpj_para_ucs();

comment on column public.consumer_units.cpf_cnpj_fatura is
    'CPF/CNPJ do titular da conta de energia. Herdado de titular_fatura_id -> subscribers.cpf_cnpj por gatilho; digitado so quando a UC ainda nao tem titular.';

-- ---------------------------------------------------------------------------
-- 3. Acerta quem ja esta divergente (em 27/09/2026: 5 UCs — as 4 do Green
--    Park na Bom Jesus II e a 7030839166 da Bom Jesus)
-- ---------------------------------------------------------------------------
update public.consumer_units c
   set cpf_cnpj_fatura = t.cpf_cnpj
  from public.subscribers t
 where t.id = c.titular_fatura_id
   and nullif(btrim(t.cpf_cnpj), '') is not null
   and c.cpf_cnpj_fatura is distinct from t.cpf_cnpj;

-- Conferencia (deve voltar 0):
-- select count(*) from consumer_units c join subscribers t on t.id = c.titular_fatura_id
--  where c.cpf_cnpj_fatura is distinct from t.cpf_cnpj;
