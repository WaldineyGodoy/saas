-- FASE B — so aplicar DEPOIS de preencher a data do Contrato de Gestao de
-- TOBIAS, B2W PROJETOS, NILTON e SOLLARECO. Antes disso os quatro cairiam
-- para 'cadastrado'. Conferir antes:
--   select name, status, fn_supplier_status_calculado(id) from suppliers;
--
-- Liga o recalculo do status do fornecedor aos eventos que o mudam.

-- Fornecedor: mudou a data da Gestao, ou saiu de Inativo.
create or replace function public.fn_trg_recalc_fornecedor_por_fornecedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.fn_recalculate_supplier_status(new.id);
    return null;
end;
$$;

drop trigger if exists trg_recalc_fornecedor on public.suppliers;
create trigger trg_recalc_fornecedor
    after update of contrato_assinado_em, status on public.suppliers
    for each row
    -- A gravacao do proprio recalculo nao casa com nenhuma das condicoes,
    -- entao nao ha recursao.
    when (new.status <> 'inativo'
          and (old.contrato_assinado_em is distinct from new.contrato_assinado_em
               or old.status = 'inativo'))
    execute function public.fn_trg_recalc_fornecedor_por_fornecedor();

-- Usina: criada, apagada, mudou de status, de fornecedor ou de data da
-- Compra e Venda. Na troca de fornecedor os dois sao recalculados.
create or replace function public.fn_trg_recalc_fornecedor_por_usina()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op in ('INSERT', 'UPDATE') then
        perform public.fn_recalculate_supplier_status(new.supplier_id);
    end if;
    if tg_op = 'DELETE'
       or (tg_op = 'UPDATE' and old.supplier_id is distinct from new.supplier_id) then
        perform public.fn_recalculate_supplier_status(old.supplier_id);
    end if;
    return null;
end;
$$;

drop trigger if exists trg_recalc_fornecedor_usina on public.usinas;
create trigger trg_recalc_fornecedor_usina
    after insert or delete or update of status, supplier_id, compra_venda_assinada_em
    on public.usinas
    for each row
    execute function public.fn_trg_recalc_fornecedor_por_usina();

-- Coloca todos no degrau certo agora.
select public.fn_recalculate_supplier_status(id) from public.suppliers;
