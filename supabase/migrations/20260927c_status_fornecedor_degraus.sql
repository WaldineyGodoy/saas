-- Status do fornecedor em cinco degraus e Pre-Operacao da usina.
-- Spec: docs/superpowers/specs/2026-09-27-status-fornecedor-usina-pre-operacao-design.md
--
-- Rodar DEPOIS da 20260927b (o valor 'pre_operacao' precisa ja existir).
-- Nao liga gatilho de recalculo: isso e' a 20260927d (Fase B), depois que
-- as datas do Contrato de Gestao forem preenchidas.

-- ---------------------------------------------------------------------------
-- 1. Usina: nasce em Pre-Operacao e guarda quando a Compra e Venda foi assinada
-- ---------------------------------------------------------------------------
alter table public.usinas alter column status set default 'pre_operacao';

alter table public.usinas
    add column if not exists compra_venda_assinada_em timestamptz;

comment on column public.usinas.compra_venda_assinada_em is
    'Quando o fornecedor assinou a Compra e Venda desta usina. Preenchida pelo autentique-webhook ou a mao (assinatura fora da Autentique). NULL = nao assinada. Leva o fornecedor a contrato_assinado.';

-- Backfill: Compras e Vendas ja assinadas pela Autentique (Rodrigo: Santa
-- Maria e Sao Vicente). updated_at da assinatura = chegada do evento signed.
update public.usinas u
   set compra_venda_assinada_em = x.assinada_em
  from (
      select g.usina_id, min(g.updated_at) assinada_em
        from public.signatures g
       where g.signer_type = 'supplier'
         and g.document_type = 'compra_venda'
         and g.status = 'signed'
         and g.usina_id is not null
       group by g.usina_id
  ) x
 where u.id = x.usina_id
   and u.compra_venda_assinada_em is null;

-- ---------------------------------------------------------------------------
-- 2. Fornecedor: cinco status, nasce Cadastrado
-- ---------------------------------------------------------------------------
alter table public.suppliers drop constraint if exists suppliers_status_check;
alter table public.suppliers
    add constraint suppliers_status_check
    check (status = any (array['cadastrado'::text, 'contrato_assinado'::text,
                               'ativacao'::text, 'ativo'::text, 'inativo'::text]));

alter table public.suppliers alter column status set default 'cadastrado';

-- 'ativacao' passa a significar Gestao assinada. Quem esta nele sem data de
-- Gestao era o antigo "recem-cadastrado" (em 27/09/2026: so a Ana Paola).
update public.suppliers
   set status = 'cadastrado'
 where status = 'ativacao'
   and contrato_assinado_em is null;

comment on column public.suppliers.contrato_assinado_em is
    'Quando o Contrato de GESTAO foi assinado. Preenchida pelo autentique-webhook ou a mao. Leva o fornecedor a ativacao (Em Ativacao).';

-- ---------------------------------------------------------------------------
-- 3. UCs: Pre-Operacao se comporta como Em Conexao (UC fica 'vinculado').
--    Corpos identicos aos de producao; so a comparacao com em_conexao mudou.
-- ---------------------------------------------------------------------------
create or replace function public.handle_uc_usina_link()
returns trigger
language plpgsql
as $$
DECLARE
    usina_status TEXT;
BEGIN
    -- Se usina_id mudou e não é nulo
    IF NEW.usina_id IS NOT NULL AND (OLD.usina_id IS NULL OR NEW.usina_id != OLD.usina_id) THEN
        SELECT status INTO usina_status FROM usinas WHERE id = NEW.usina_id;

        -- TRAVA: Se for um UPDATE e o status antigo for inativo/cancelado/desconectado,
        -- e o status não estiver sendo alterado manualmente (NEW.status = OLD.status), NÃO altera automaticamente.
        IF TG_OP = 'UPDATE' AND OLD.status IN ('desconectado', 'cancelado', 'cancelado_inadimplente') AND NEW.status = OLD.status THEN
            -- Mantém o status antigo
            NULL;
        -- TRAVA: Não avança automaticamente de 'aguardando_conexao' ou 'em_transf_titularidade' para 'ativo'
        ELSIF (TG_OP = 'UPDATE' AND OLD.status IN ('aguardando_conexao', 'em_transf_titularidade') AND NEW.status = OLD.status)
           OR (TG_OP = 'INSERT' AND NEW.status IN ('aguardando_conexao', 'em_transf_titularidade')) THEN
            -- Mantém o status atual, se for mudar para gerando não altera para ativo
            IF usina_status IN ('pre_operacao', 'em_conexao') THEN
                NEW.status := 'vinculado';
            ELSIF usina_status IN ('manutencao', 'inativa', 'cancelada') THEN
                NEW.status := 'sem_geracao';
            END IF;
        ELSE
            IF usina_status = 'gerando' THEN
                NEW.status := 'ativo';
            ELSIF usina_status IN ('pre_operacao', 'em_conexao') THEN
                NEW.status := 'vinculado';
            ELSIF usina_status IN ('manutencao', 'inativa', 'cancelada') THEN
                NEW.status := 'sem_geracao';
            END IF;
        END IF;
    END IF;

    -- Se desvinculado (usina_id se torna nulo)
    IF NEW.usina_id IS NULL AND OLD.usina_id IS NOT NULL THEN
        IF TG_OP = 'UPDATE' AND OLD.status IN ('desconectado', 'cancelado', 'cancelado_inadimplente') AND NEW.status = OLD.status THEN
            NULL;
        ELSE
            NEW.status := 'em_ativacao';
        END IF;
    END IF;

    -- Padrão na criação se nulo
    IF NEW.status IS NULL THEN
        NEW.status := 'em_ativacao';
    END IF;

    RETURN NEW;
END;
$$;

create or replace function public.handle_usina_status_change()
returns trigger
language plpgsql
as $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        UPDATE consumer_units
        SET status = CASE
            WHEN NEW.status = 'gerando' THEN 'ativo'
            WHEN NEW.status IN ('pre_operacao', 'em_conexao') THEN 'vinculado'
            WHEN NEW.status IN ('manutencao', 'inativa', 'cancelada') THEN 'sem_geracao'
            ELSE status
        END
        WHERE usina_id = NEW.id
          AND status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente')
          AND NOT (NEW.status = 'gerando' AND status IN ('aguardando_conexao', 'em_transf_titularidade'));
    END IF;
    RETURN NEW;
END;
$$;

create or replace function public.handle_invoice_status_change()
returns trigger
language plpgsql
as $$
DECLARE
    v_subscriber_id UUID;
    v_uc_status TEXT;
BEGIN
    -- Obter subscriber_id e status da UC vinculada
    SELECT subscriber_id, status::text INTO v_subscriber_id, v_uc_status
    FROM public.consumer_units
    WHERE id = COALESCE(NEW.uc_id, OLD.uc_id);

    -- Lógica original de atraso da UC (só aplica se não estiver desconectada/cancelada)
    IF NEW.status = 'atrasado' AND v_uc_status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente') THEN
        -- Não retroage status se o status atual da UC já for maior que 'em_atraso' (rank 7)
        IF fn_get_uc_status_rank('em_atraso') >= fn_get_uc_status_rank(v_uc_status) THEN
            UPDATE public.consumer_units SET status = 'em_atraso'::public.uc_status WHERE id = NEW.uc_id;
        END IF;

        IF (CURRENT_DATE - NEW.vencimento) > 60 THEN
            IF fn_get_uc_status_rank('cancelado_inadimplente') >= fn_get_uc_status_rank(v_uc_status) THEN
                UPDATE public.consumer_units SET status = 'cancelado_inadimplente'::public.uc_status WHERE id = NEW.uc_id;
            END IF;
        END IF;
    END IF;

    -- Se a fatura foi paga e estava atrasada, recalcular status baseado na usina (removendo a trava de ranking progressivo para permitir o retorno do status)
    IF NEW.status = 'pago' AND OLD.status = 'atrasado' AND v_uc_status NOT IN ('desconectado', 'cancelado', 'cancelado_inadimplente') THEN
        IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE uc_id = NEW.uc_id AND status = 'atrasado') THEN
             WITH u_status AS (
                SELECT u.status
                FROM public.usinas u
                JOIN public.consumer_units c ON c.usina_id = u.id
                WHERE c.id = NEW.uc_id
             )
             UPDATE public.consumer_units c
             SET status = CASE
                WHEN (SELECT status FROM u_status) = 'gerando' THEN 'ativo'::public.uc_status
                WHEN (SELECT status FROM u_status) IN ('pre_operacao', 'em_conexao') THEN 'vinculado'::public.uc_status
                WHEN (SELECT status FROM u_status) IN ('manutencao', 'inativa', 'cancelada') THEN 'sem_geracao'::public.uc_status
                ELSE 'em_ativacao'::public.uc_status
             END
             WHERE id = NEW.uc_id;
        END IF;
    END IF;

    -- Recalcular status do assinante se houver
    IF v_subscriber_id IS NOT NULL THEN
        PERFORM public.fn_recalculate_subscriber_status(v_subscriber_id);
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fornecedor: a regra (pura, testavel com SELECT) e quem grava
-- ---------------------------------------------------------------------------
create or replace function public.fn_supplier_status_calculado(p_supplier_id uuid)
returns text
language sql
stable
set search_path = public
as $$
    -- Do degrau mais alto para o mais baixo. NULL = fornecedor nao existe.
    select case
        -- Decisao do operador: a automacao nao e' dona desse estado.
        when s.status = 'inativo' then 'inativo'
        -- Gestao assinada e alguma usina fora de pre-operacao/inativa/cancelada.
        when s.contrato_assinado_em is not null
         and exists (select 1 from usinas u
                      where u.supplier_id = s.id
                        and u.status in ('em_conexao', 'gerando', 'manutencao'))
            then 'ativo'
        when s.contrato_assinado_em is not null then 'ativacao'
        when exists (select 1 from usinas u
                      where u.supplier_id = s.id
                        and u.compra_venda_assinada_em is not null)
            then 'contrato_assinado'
        else 'cadastrado'
    end
    from suppliers s
    where s.id = p_supplier_id;
$$;

comment on function public.fn_supplier_status_calculado(uuid) is
    'Status que o fornecedor deveria ter. So le. cadastrado -> contrato_assinado (Compra e Venda) -> ativacao (Gestao) -> ativo (Gestao + usina em_conexao/gerando/manutencao); inativo e'' preservado.';

create or replace function public.fn_recalculate_supplier_status(p_supplier_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_novo text := public.fn_supplier_status_calculado(p_supplier_id);
begin
    if v_novo is null then
        return;
    end if;

    update suppliers
       set status = v_novo
     where id = p_supplier_id
       and status is distinct from v_novo;
end;
$$;
