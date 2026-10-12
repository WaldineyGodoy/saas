-- ============================================================================
-- Troca de titularidade (TT) como processo, nao como edicao no lugar
--
-- O limbo: em usina de autoconsumo remoto a trava
-- fn_uc_modalidade_e_titularidade so aceita vincular a UC quando o titular da
-- conta de energia ja e o da UG. Mas a TT -- que faz essa UC passar para o
-- titular da UG -- acontece DEPOIS do cadastro. Sem um registro do processo,
-- o sistema nao sabe o ponto A (UC cedente, titular antigo, numero antigo) nem
-- o ponto B (titular da UG, numero novo), e a automacao nao tem o que ligar.
--
-- Pre-requisito: 20261012g_status_desligado_por_tt.sql (status da UC sombra).
--
-- Aqui a TT vira um objeto com estados. Enquanto ela nao conclui:
--   * a UC fica no titular cedente e SEM usina_id (a trava do banco nao muda);
--   * o destino fica em consumer_units.usina_destino_id (intencao/reserva);
--   * o status da UC e em_transf_titularidade (a fila do robo ja a ignora).
-- Ao concluir, fn_concluir_tt faz tudo numa transacao: cria a UC sombra do
-- cedente (para o robo buscar a conta final), troca titular/numero, guarda a
-- identidade anterior e so entao grava usina_id -- a trava passa por si.
--
-- Quem inicia a TT na concessionaria e o CESSIONARIO (titular da UG), logado
-- com a credencial da UG, digitando o numero ATUAL da UC cedente. Se a UG tem
-- debito, o processo e finalizado e o debito e reportado
-- (bloqueada_por_debito); so volta quando um usuario informa a quitacao e
-- pede nova tentativa. O robo nunca retenta sozinho.
--
-- Escrita so por RPC (sem policy de insert/update): admin ou service_role.
-- ============================================================================

alter table public.consumer_units
    add column if not exists usina_destino_id uuid references public.usinas(id) on delete set null;

comment on column public.consumer_units.usina_destino_id is
    'Usina para a qual a UC vai assim que a TT em andamento concluir. NAO e vinculo: a UC so ganha usina_id em fn_concluir_tt.';

-- ------------------------------------------------------------------ tabelas
create table if not exists public.uc_transferencias_titularidade (
    id                    uuid primary key default gen_random_uuid(),
    uc_id                 uuid not null references public.consumer_units(id) on delete cascade,
    usina_destino_id      uuid not null references public.usinas(id),
    -- UG cuja credencial de portal executa o pedido (o cessionario inicia).
    ug_id                 uuid not null references public.consumer_units(id),
    cedente_id            uuid not null references public.subscribers(id),
    cessionario_id        uuid not null references public.subscribers(id),
    numero_uc_origem      text not null,
    numero_uc_destino     text,
    status                text not null default 'a_iniciar'
        check (status in ('a_iniciar','em_execucao','bloqueada_por_debito','protocolada',
                          'em_analise','concluida','recusada','cancelada','erro')),
    -- Status da UC antes da TT, para devolver se a TT for cancelada/recusada.
    status_uc_anterior    text,
    protocolo             text,
    solicitada_em         timestamptz,
    debito_valor          numeric(12,2),
    debito_detalhe        text,
    debito_reportado_em   timestamptz,
    quitacao_informada_em timestamptz,
    quitacao_informada_por uuid references auth.users(id),
    tentativas            int not null default 0,
    ultima_tentativa_em   timestamptz,
    erro                  text,
    motivo_encerramento   text,
    data_conclusao        date,
    concluida_em          timestamptz,
    criado_por            uuid references auth.users(id),
    criado_em             timestamptz not null default now(),
    atualizado_em         timestamptz not null default now()
);

comment on table public.uc_transferencias_titularidade is
    'Processo de troca de titularidade de uma UC para o titular da UG da usina destino. A UC so ganha usina_id em fn_concluir_tt.';

-- Uma TT aberta por UC.
create unique index if not exists uc_tt_uma_aberta_por_uc
    on public.uc_transferencias_titularidade (uc_id)
    where status not in ('concluida','recusada','cancelada');

create index if not exists uc_tt_status_idx
    on public.uc_transferencias_titularidade (status);

create table if not exists public.uc_transferencias_titularidade_eventos (
    id         uuid primary key default gen_random_uuid(),
    tt_id      uuid not null references public.uc_transferencias_titularidade(id) on delete cascade,
    evento     text not null,
    detalhe    jsonb,
    criado_em  timestamptz not null default now(),
    criado_por uuid references auth.users(id)
);

create index if not exists uc_tt_eventos_tt_idx
    on public.uc_transferencias_titularidade_eventos (tt_id, criado_em);

alter table public.uc_transferencias_titularidade enable row level security;
alter table public.uc_transferencias_titularidade_eventos enable row level security;

drop policy if exists uc_tt_leitura on public.uc_transferencias_titularidade;
create policy uc_tt_leitura on public.uc_transferencias_titularidade
    for select to authenticated using (true);

drop policy if exists uc_tt_eventos_leitura on public.uc_transferencias_titularidade_eventos;
create policy uc_tt_eventos_leitura on public.uc_transferencias_titularidade_eventos
    for select to authenticated using (true);

-- ------------------------------------------------------------------ helpers
create or replace function public.fn_tt_autorizado()
returns boolean
language sql stable
set search_path = public
as $$
    select coalesce(auth.role(), '') = 'service_role'
        or coalesce(public.check_user_is_admin(auth.uid()), false);
$$;

create or replace function public.fn_tt_evento(p_tt_id uuid, p_evento text, p_detalhe jsonb default null)
returns void
language sql
security definer
set search_path = public
as $$
    insert into uc_transferencias_titularidade_eventos (tt_id, evento, detalhe, criado_por)
    values (p_tt_id, p_evento, p_detalhe, auth.uid());
$$;

revoke all on function public.fn_tt_evento(uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ iniciar
create or replace function public.fn_iniciar_tt(p_uc_id uuid, p_usina_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uc     consumer_units%rowtype;
    v_usina  usinas%rowtype;
    v_ug     consumer_units%rowtype;
    v_doc_a  text;
    v_doc_b  text;
    v_id     uuid;
begin
    if not fn_tt_autorizado() then
        raise exception 'Sem permissao para iniciar troca de titularidade.';
    end if;

    select * into v_uc from consumer_units where id = p_uc_id for update;
    if not found then raise exception 'UC nao encontrada.'; end if;

    select * into v_usina from usinas where id = p_usina_id;
    if not found then raise exception 'Usina nao encontrada.'; end if;

    if v_usina.modalidade::text <> 'auto_consumo_remoto' then
        raise exception 'A usina % nao e de autoconsumo remoto: nao ha troca de titularidade a fazer, vincule a UC direto.', v_usina.name;
    end if;
    if coalesce(v_uc.tipo_unidade, '') = 'geradora' then
        raise exception 'A UC geradora nao passa por troca de titularidade para a propria usina.';
    end if;
    if v_uc.usina_id is not null then
        raise exception 'A UC ja esta vinculada a uma usina. Desvincule antes de iniciar a TT.';
    end if;
    if v_uc.titular_fatura_id is null then
        raise exception 'A UC % esta sem titular da conta de energia (o cedente). Informe-o antes de iniciar a TT.', v_uc.numero_uc;
    end if;
    if v_uc.numero_uc is null or btrim(v_uc.numero_uc) = '' then
        raise exception 'A UC esta sem numero.';
    end if;
    -- em_transf_titularidade exige plano (fn_consumer_units_plano_obrigatorio).
    if v_uc.plano_assinatura_id is null then
        raise exception 'Escolha o plano de assinatura da UC antes de iniciar a TT (ela passa a Em Transf. de Titularidade).';
    end if;

    select * into v_ug
      from consumer_units
     where usina_id = p_usina_id and tipo_unidade = 'geradora'
     limit 1;
    if not found then
        raise exception 'A usina % nao tem unidade geradora cadastrada.', v_usina.name;
    end if;
    if v_ug.titular_fatura_id is null then
        raise exception 'A UG % da usina % esta sem titular da conta de energia.', v_ug.numero_uc, v_usina.name;
    end if;

    select regexp_replace(coalesce(cpf_cnpj,''), '\D', '', 'g') into v_doc_a from subscribers where id = v_uc.titular_fatura_id;
    select regexp_replace(coalesce(cpf_cnpj,''), '\D', '', 'g') into v_doc_b from subscribers where id = v_ug.titular_fatura_id;
    if v_uc.titular_fatura_id = v_ug.titular_fatura_id or (v_doc_a <> '' and v_doc_a = v_doc_b) then
        raise exception 'A UC ja esta no mesmo titular da UG: nao precisa de TT, vincule direto.';
    end if;

    insert into uc_transferencias_titularidade
        (uc_id, usina_destino_id, ug_id, cedente_id, cessionario_id,
         numero_uc_origem, status_uc_anterior, criado_por)
    values
        (v_uc.id, p_usina_id, v_ug.id, v_uc.titular_fatura_id, v_ug.titular_fatura_id,
         v_uc.numero_uc, v_uc.status::text, auth.uid())
    returning id into v_id;

    update consumer_units
       set usina_destino_id = p_usina_id,
           status = 'em_transf_titularidade'
     where id = v_uc.id;

    perform fn_tt_evento(v_id, 'iniciada',
        jsonb_build_object('usina', v_usina.name, 'ug', v_ug.numero_uc, 'numero_uc_origem', v_uc.numero_uc));
    return v_id;
end;
$$;

-- ------------------------------------------------ transicoes (robo ou admin)
-- O robo reivindica a TT: so uma execucao por vez, e conta a tentativa.
create or replace function public.fn_tt_reivindicar(p_tt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;
    update uc_transferencias_titularidade
       set status = 'em_execucao', tentativas = tentativas + 1,
           ultima_tentativa_em = now(), erro = null, atualizado_em = now()
     where id = p_tt_id and status = 'a_iniciar';
    get diagnostics v_n = row_count;
    if v_n = 1 then perform fn_tt_evento(p_tt_id, 'execucao_iniciada'); end if;
    return v_n = 1;
end;
$$;

-- Debito na UG: o processo e finalizado e o debito reportado. Nada de retentar.
create or replace function public.fn_tt_registrar_debito(p_tt_id uuid, p_valor numeric, p_detalhe text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;
    update uc_transferencias_titularidade
       set status = 'bloqueada_por_debito', debito_valor = p_valor, debito_detalhe = p_detalhe,
           debito_reportado_em = now(), atualizado_em = now()
     where id = p_tt_id and status in ('a_iniciar','em_execucao');
    if not found then
        raise exception 'TT nao esta em um estado que aceite reportar debito.';
    end if;
    perform fn_tt_evento(p_tt_id, 'debito_reportado',
        jsonb_build_object('valor', p_valor, 'detalhe', p_detalhe));
end;
$$;

create or replace function public.fn_tt_protocolar(p_tt_id uuid, p_protocolo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;
    if coalesce(btrim(p_protocolo), '') = '' then raise exception 'Protocolo vazio.'; end if;
    update uc_transferencias_titularidade
       set status = 'protocolada', protocolo = p_protocolo, solicitada_em = now(),
           erro = null, atualizado_em = now()
     where id = p_tt_id and status in ('a_iniciar','em_execucao');
    if not found then raise exception 'TT nao esta em um estado que aceite protocolo.'; end if;
    perform fn_tt_evento(p_tt_id, 'protocolada', jsonb_build_object('protocolo', p_protocolo));
end;
$$;

create or replace function public.fn_tt_marcar_em_analise(p_tt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;
    update uc_transferencias_titularidade
       set status = 'em_analise', atualizado_em = now()
     where id = p_tt_id and status = 'protocolada';
    if found then perform fn_tt_evento(p_tt_id, 'em_analise'); end if;
end;
$$;

-- Falha do robo (portal fora, seletor mudou...): vai para 'erro' e espera uma pessoa.
create or replace function public.fn_tt_registrar_erro(p_tt_id uuid, p_erro text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;
    update uc_transferencias_titularidade
       set status = 'erro', erro = left(p_erro, 2000), atualizado_em = now()
     where id = p_tt_id and status in ('a_iniciar','em_execucao');
    if found then perform fn_tt_evento(p_tt_id, 'erro', jsonb_build_object('erro', left(p_erro, 500))); end if;
end;
$$;

-- O usuario informa a quitacao (ou revisou o erro) e pede nova tentativa.
create or replace function public.fn_tt_retentar(p_tt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;
    select status into v_status from uc_transferencias_titularidade where id = p_tt_id for update;
    if v_status is null then raise exception 'TT nao encontrada.'; end if;
    if v_status not in ('bloqueada_por_debito','erro') then
        raise exception 'Nova tentativa so vale para TT bloqueada por debito ou com erro (esta esta %).', v_status;
    end if;
    update uc_transferencias_titularidade
       set status = 'a_iniciar',
           quitacao_informada_em = case when v_status = 'bloqueada_por_debito' then now() else quitacao_informada_em end,
           quitacao_informada_por = case when v_status = 'bloqueada_por_debito' then auth.uid() else quitacao_informada_por end,
           erro = null, atualizado_em = now()
     where id = p_tt_id;
    perform fn_tt_evento(p_tt_id, case when v_status = 'bloqueada_por_debito' then 'quitacao_informada' else 'nova_tentativa' end);
end;
$$;

-- Cancelar ou registrar recusa da concessionaria: a UC volta ao que era.
create or replace function public.fn_tt_encerrar(p_tt_id uuid, p_novo_status text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r uc_transferencias_titularidade%rowtype;
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;
    if p_novo_status not in ('cancelada','recusada') then
        raise exception 'Encerramento so para cancelada ou recusada.';
    end if;
    select * into r from uc_transferencias_titularidade where id = p_tt_id for update;
    if not found then raise exception 'TT nao encontrada.'; end if;
    if r.status in ('concluida','recusada','cancelada') then
        raise exception 'TT ja encerrada (%).', r.status;
    end if;

    update uc_transferencias_titularidade
       set status = p_novo_status, motivo_encerramento = p_motivo, atualizado_em = now()
     where id = p_tt_id;

    -- UC continua sem usina_id: o handle_uc_usina_link nao interfere.
    update consumer_units
       set usina_destino_id = null,
           status = coalesce(r.status_uc_anterior, 'em_ativacao')::uc_status
     where id = r.uc_id;

    perform fn_tt_evento(p_tt_id, p_novo_status, jsonb_build_object('motivo', p_motivo));
end;
$$;

-- ----------------------------------------------------------------- concluir
-- O ponto B: o titular da conta passou a ser o da UG. Tudo ou nada.
create or replace function public.fn_concluir_tt(
    p_tt_id          uuid,
    p_numero_uc_novo text default null,
    p_data           date default current_date
)
returns uuid  -- id da UC sombra do cedente
language plpgsql
security definer
set search_path = public
as $$
declare
    r          uc_transferencias_titularidade%rowtype;
    v_uc       consumer_units%rowtype;
    v_novo     text := nullif(btrim(coalesce(p_numero_uc_novo, '')), '');
    v_nome_ces text;
    v_prio     int;
    v_sombra   uuid;
begin
    if not fn_tt_autorizado() then raise exception 'Sem permissao.'; end if;

    select * into r from uc_transferencias_titularidade where id = p_tt_id for update;
    if not found then raise exception 'TT nao encontrada.'; end if;
    if r.status in ('concluida','recusada','cancelada') then
        raise exception 'TT ja encerrada (%).', r.status;
    end if;

    select * into v_uc from consumer_units where id = r.uc_id for update;
    if v_uc.usina_id is not null then
        raise exception 'A UC ja esta vinculada a uma usina; a TT nao pode concluir.';
    end if;
    select name into v_nome_ces from subscribers where id = r.cessionario_id;

    -- 1. UC sombra do cedente: numero antigo + credencial antiga,
    --    status 'desligado_por_tt' (nunca foi conectada, entao nao e 'desconectado'),
    --    acompanhada ~90 dias para o robo buscar a conta final (devida pela B2W).
    --    Nao reprocessa meses anteriores: eles ja estao na UC principal.
    insert into consumer_units
        (subscriber_id, numero_uc, titular_fatura_id, titular_conta, concessionaria,
         tipo_ligacao, tipo_unidade, address, dia_vencimento, dia_leitura,
         plano_assinatura_id, status, franquia, data_desligamento, desligamento_origem,
         acompanhar_conta_ate, usina_id)
    values
        (v_uc.subscriber_id, r.numero_uc_origem, r.cedente_id, v_uc.titular_conta, v_uc.concessionaria,
         v_uc.tipo_ligacao, v_uc.tipo_unidade, v_uc.address, v_uc.dia_vencimento, v_uc.dia_leitura,
         v_uc.plano_assinatura_id, 'desligado_por_tt', 0, p_data, 'concessionaria',
         p_data + 90, null)
    returning id into v_sombra;

    -- 2. A UC principal passa ao titular da UG. Status ANTES do usina_id: se o
    --    status mudasse junto, handle_uc_usina_link a promoveria para 'ativo'.
    update consumer_units
       set numero_uc               = coalesce(v_novo, numero_uc),
           titular_fatura_id       = r.cessionario_id,
           titular_conta           = v_nome_ces,
           numero_uc_anterior      = r.numero_uc_origem,
           titular_anterior_id     = r.cedente_id,
           data_troca_titularidade = p_data,
           status                  = 'aguardando_conexao'
     where id = v_uc.id;

    -- 3. Agora o vinculo. A trava de autoconsumo remoto passa por si: o titular
    --    ja e o da UG. Status igual ao antigo -> o gatilho nao o promove.
    select coalesce(max(prioridade), 0) + 1 into v_prio
      from consumer_units where usina_id = r.usina_destino_id;

    update consumer_units
       set usina_id = r.usina_destino_id, usina_destino_id = null, prioridade = v_prio
     where id = v_uc.id;

    update uc_transferencias_titularidade
       set status = 'concluida', numero_uc_destino = coalesce(v_novo, v_uc.numero_uc),
           data_conclusao = p_data, concluida_em = now(), atualizado_em = now(), erro = null
     where id = r.id;

    perform fn_tt_evento(r.id, 'concluida', jsonb_build_object(
        'numero_uc_origem', r.numero_uc_origem,
        'numero_uc_destino', coalesce(v_novo, v_uc.numero_uc),
        'uc_sombra_id', v_sombra));
    return v_sombra;
end;
$$;

-- ------------------------------------------------------------------ grants
do $$
declare f text;
begin
    foreach f in array array[
        'fn_iniciar_tt(uuid, uuid)',
        'fn_tt_reivindicar(uuid)',
        'fn_tt_registrar_debito(uuid, numeric, text)',
        'fn_tt_protocolar(uuid, text)',
        'fn_tt_marcar_em_analise(uuid)',
        'fn_tt_registrar_erro(uuid, text)',
        'fn_tt_retentar(uuid)',
        'fn_tt_encerrar(uuid, text, text)',
        'fn_concluir_tt(uuid, text, date)'
    ] loop
        execute format('revoke all on function public.%s from public, anon', f);
        execute format('grant execute on function public.%s to authenticated, service_role', f);
    end loop;
end $$;
