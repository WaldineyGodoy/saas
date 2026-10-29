-- Fluxo lead → fornecedor → usina → fornecedor → lead.
--
-- Caso de 27/10/2026: o lead CHARLES DE ALMEIDA MOREIRA virou fornecedor e
-- recebeu a usina UFV - Santa Maria I. Sem nenhum contrato enviado:
--   1. o fornecedor apareceu como "Contrato Assinado";
--   2. o lead ficou em "Simulação".
--
-- 1. `usinas.compra_venda_assinada_em` é a data da Compra e Venda entre a usina
--    e o DONO dela, mas a usina guardava a data do contrato de quem a tinha
--    antes. A Santa Maria I carregava 15/09/2026, de uma Compra e Venda de teste
--    assinada pelo fornecedor de teste "Investidor" (investidor@gmail.com). Ao
--    trocar o dono, a data foi junto e o cálculo promoveu o dono novo.
--    Agora, quando a usina muda de dono, a data passa a ser a da Compra e Venda
--    assinada pelo dono novo, ou nada. Quem grava a data junto com a troca (o
--    campo manual do cadastro da usina) continua mandando.
--
-- 2. Nada levava o status do fornecedor ao lead de origem (`suppliers.lead_id`).
--    O assinante já faz isso (`sync_subscriber_to_lead_status`); o fornecedor
--    passa a fazer pela mesma régua de status do lead:
--       fornecedor cadastrado, sem contrato enviado → Negociação
--       fornecedor com contrato pendente na Autentique → Contrato Enviado
--       contrato_assinado (Compra e Venda) / ativacao (Gestão) → Ativação
--       ativo → Ativo
--       inativo → não mexe (decisão humana)
--    O lead só avança: o fornecedor não desfaz um passo que o lead já deu por
--    outro caminho (um assinante do mesmo lead, uma reunião marcada à mão).

-- 1. A data da Compra e Venda acompanha o dono da usina -----------------------

create or replace function public.fn_usinas_compra_venda_do_dono()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.supplier_id is distinct from old.supplier_id
       and new.compra_venda_assinada_em is not distinct from old.compra_venda_assinada_em then
        new.compra_venda_assinada_em := (
            select max(g.updated_at)
              from public.signatures g
             where g.usina_id = new.id
               and g.signer_type = 'supplier'
               and g.signer_id = new.supplier_id
               and g.document_type = 'compra_venda'
               and g.status = 'signed'
        );
    end if;
    return new;
end;
$$;

drop trigger if exists trg_usinas_compra_venda_do_dono on public.usinas;
create trigger trg_usinas_compra_venda_do_dono
    before update of supplier_id on public.usinas
    for each row execute function public.fn_usinas_compra_venda_do_dono();

-- 2. O status do fornecedor chega ao lead -------------------------------------

-- Só lê: dá para conferir por SELECT antes de confiar no gatilho.
create or replace function public.fn_lead_status_do_fornecedor(p_supplier_id uuid)
returns public.lead_status
language sql
stable
security definer
set search_path = public
as $$
    select case s.status
        when 'inativo'           then null
        when 'ativo'             then 'ativo'::public.lead_status
        when 'ativacao'          then 'ativacao'::public.lead_status
        when 'contrato_assinado' then 'ativacao'::public.lead_status
        else case
            when exists (select 1 from public.signatures g
                          where g.signer_type = 'supplier'
                            and g.signer_id = s.id
                            and g.status = 'pending')
                then 'contrato_enviado'::public.lead_status
            else 'negociacao'::public.lead_status
        end
    end
    from public.suppliers s
    where s.id = p_supplier_id;
$$;

-- Ordem do funil, igual às colunas do kanban. Negócio Perdido fica no começo:
-- virar fornecedor reabre o negócio.
create or replace function public.fn_lead_status_ordem(p_status public.lead_status)
returns int
language sql
immutable
as $$
    select coalesce(array_position(array[
        'negocio_perdido', 'sem_interacao', 'indicado', 'simulacao', 'convite_enviado',
        'negociacao', 'reuniao_agendada', 'contrato_enviado', 'ativacao', 'ativo', 'pago'
    ], p_status::text), 0);
$$;

create or replace function public.fn_sync_lead_do_fornecedor(p_supplier_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead uuid;
    v_novo public.lead_status;
begin
    select lead_id into v_lead from public.suppliers where id = p_supplier_id;
    if v_lead is null then
        return;
    end if;

    v_novo := public.fn_lead_status_do_fornecedor(p_supplier_id);
    if v_novo is null then
        return;
    end if;

    update public.leads
       set status = v_novo,
           updated_at = now()
     where id = v_lead
       and public.fn_lead_status_ordem(status) < public.fn_lead_status_ordem(v_novo);
end;
$$;

create or replace function public.fn_trg_sync_lead_por_fornecedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.fn_sync_lead_do_fornecedor(new.id);
    return null;
end;
$$;

drop trigger if exists trg_sync_lead_por_fornecedor on public.suppliers;
create trigger trg_sync_lead_por_fornecedor
    after insert or update of status, lead_id on public.suppliers
    for each row execute function public.fn_trg_sync_lead_por_fornecedor();

-- Contrato enviado ou cancelado na Autentique muda o degrau do lead.
create or replace function public.fn_trg_sync_lead_por_assinatura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.signer_type = 'supplier' and new.signer_id is not null then
        perform public.fn_sync_lead_do_fornecedor(new.signer_id);
    end if;
    return null;
end;
$$;

drop trigger if exists trg_sync_lead_por_assinatura on public.signatures;
create trigger trg_sync_lead_por_assinatura
    after insert or update of status on public.signatures
    for each row execute function public.fn_trg_sync_lead_por_assinatura();

revoke all on function public.fn_lead_status_do_fornecedor(uuid) from public, anon;
revoke all on function public.fn_sync_lead_do_fornecedor(uuid) from public, anon, authenticated;
revoke all on function public.fn_usinas_compra_venda_do_dono() from public, anon, authenticated;
revoke all on function public.fn_trg_sync_lead_por_fornecedor() from public, anon, authenticated;
revoke all on function public.fn_trg_sync_lead_por_assinatura() from public, anon, authenticated;
grant execute on function public.fn_lead_status_do_fornecedor(uuid) to authenticated;

-- 3. Dados que a regra antiga deixou errados ----------------------------------

-- Compra e Venda que não foi assinada pelo dono atual da usina. Em 27/10/2026
-- eram duas, ambas de teste do fornecedor "Investidor":
--   UFV - Santa Maria I (dono CHARLES)  2026-09-15 00:15:35.6+00
--   UFV - São Vicente I (dono B2W)      2026-09-16 18:39:42.049+00
-- O gatilho de recálculo de usinas devolve cada dono ao degrau certo.
update public.usinas u
   set compra_venda_assinada_em = null
 where u.compra_venda_assinada_em is not null
   and exists (select 1 from public.signatures g
                where g.usina_id = u.id and g.document_type = 'compra_venda' and g.status = 'signed')
   and not exists (select 1 from public.signatures g
                    where g.usina_id = u.id and g.document_type = 'compra_venda' and g.status = 'signed'
                      and g.signer_type = 'supplier' and g.signer_id = u.supplier_id);

-- Leads que já viraram fornecedor antes deste gatilho.
select public.fn_sync_lead_do_fornecedor(s.id) from public.suppliers s where s.lead_id is not null;
