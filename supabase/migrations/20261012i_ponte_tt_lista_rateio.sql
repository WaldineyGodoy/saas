-- ============================================================================
-- Ponte TT -> Lista de Rateio -> Solicitacao na concessionaria -> UC ativa
--
-- Ate aqui a TT concluida deixava a UC vinculada a usina em aguardando_conexao
-- e ninguem pedia a alteracao da lista de compensacao a distribuidora: a Cosern
-- so compensa a UC depois da Solicitacao (Motivo 6). O card da Lista de Rateio
-- era criado a mao, com o retrato das UCs montado no front.
--
-- Fluxo daqui para frente:
--   UC criada -> TT (fn_iniciar_tt) -> TT concluida (fn_concluir_tt) ->
--   card unico da usina em 'criada' (fn_gerar_lista_rateio, por prioridade ou
--   porcentagem conforme a usina) -> Solicitacao enviada, protocolo registrado
--   (fn_rateio_registrar_protocolo: 'processando', prazo de 15 dias) ->
--   acompanhamento diario (fn_rateio_acompanhar, pg_cron) -> distribuidora
--   aprova (fn_rateio_concluir: UCs ativas) ou reprova/cancela por divergencia
--   de dados (fn_rateio_reprovar: corrige e refaz a lista).
--
-- Card UNICO por usina: se ja ha um 'processando' (lista na distribuidora),
-- a usina fica marcada com lista_rateio_pendente e o card novo nasce quando o
-- atual fechar. O card nao e editado -- ele e a fotografia do que foi pedido.
--
-- Corrige de passagem: concluir a lista no front ativava QUALQUER UC do
-- retrato que nao estivesse 'ativo', inclusive 'em_atraso'. Agora so sai de
-- aguardando_conexao / vinculado / em_ativacao.
-- ============================================================================

-- ---------------------------------------------------------------- colunas
alter table public.rateio_lists
    add column if not exists origem text not null default 'manual',
    add column if not exists prazo_limite date,
    add column if not exists portal_status text,
    add column if not exists portal_ultima_consulta_em timestamptz,
    add column if not exists motivo_reprovacao text,
    add column if not exists alerta_prazo text;

alter table public.rateio_lists
    drop constraint if exists rateio_lists_origem_check;
alter table public.rateio_lists
    add constraint rateio_lists_origem_check check (origem in ('manual','tt'));

comment on column public.rateio_lists.prazo_limite is
    'Protocolo + 15 dias: prazo maximo da distribuidora para concluir a solicitacao.';
comment on column public.rateio_lists.portal_status is
    'Ultimo status lido no portal da distribuidora (em_analise, aprovada, reprovada, cancelada_pela_distribuidora).';
comment on column public.rateio_lists.alerta_prazo is
    'Calculado pelo cron diario: dentro_do_prazo, atencao (8-12 dias), critico (13-15) ou vencido (>15).';

alter table public.usinas
    add column if not exists lista_rateio_pendente boolean not null default false;
comment on column public.usinas.lista_rateio_pendente is
    'Ha UC nova/alterada esperando um card de Lista de Rateio, porque ja existe um em processamento na distribuidora.';

alter table public.uc_transferencias_titularidade
    add column if not exists rateio_list_id uuid references public.rateio_lists(id) on delete set null;

create table if not exists public.rateio_list_eventos (
    id         uuid primary key default gen_random_uuid(),
    rateio_id  uuid not null references public.rateio_lists(id) on delete cascade,
    evento     text not null,
    detalhe    jsonb,
    criado_em  timestamptz not null default now(),
    criado_por uuid references auth.users(id)
);
create index if not exists rateio_list_eventos_idx on public.rateio_list_eventos (rateio_id, criado_em);
alter table public.rateio_list_eventos enable row level security;
drop policy if exists rateio_list_eventos_leitura on public.rateio_list_eventos;
create policy rateio_list_eventos_leitura on public.rateio_list_eventos
    for select to authenticated using (true);

-- Quem mexe nos cards de rateio: equipe interna (mesma regra do RLS de
-- rateio_lists) ou o service_role do robo.
create or replace function public.fn_rateio_autorizado()
returns boolean
language sql stable
set search_path = public
as $$
    select coalesce(auth.role(), '') = 'service_role'
        or coalesce(public.fn_papel_interno(), false);
$$;

create or replace function public.fn_rateio_evento(p_rateio_id uuid, p_evento text, p_detalhe jsonb default null)
returns void
language sql
security definer
set search_path = public
as $$
    insert into rateio_list_eventos (rateio_id, evento, detalhe, criado_por)
    values (p_rateio_id, p_evento, p_detalhe, auth.uid());
$$;
revoke all on function public.fn_rateio_evento(uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------- gerar o card/retrato
-- Mesma regra do botao "Criar Lista de Rateio" da usina, agora no banco: so
-- UCs ativo / em_atraso / aguardando_conexao, mais a geradora (sempre primeiro).
create or replace function public.fn_gerar_lista_rateio_interno(p_usina_id uuid, p_origem text default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_usina    usinas%rowtype;
    v_card_id  uuid;
    v_elig     jsonb;
    v_proc     jsonb := '[]'::jsonb;
    v_item     jsonb;
    v_idx      int;
    v_total    numeric;
    v_cur      numeric := 0;
    v_prc      numeric;
    v_saldo_ix int := 0;
    v_ger_ix   int := -1;
    v_alvo     int;
    v_n        int;
    v_pct      numeric;
    v_porcent  boolean;
begin
    select * into v_usina from usinas where id = p_usina_id for update;
    if not found then raise exception 'Usina nao encontrada.'; end if;

    -- Card unico: ja ha lista na distribuidora -> espera ela fechar.
    if exists (select 1 from rateio_lists where usina_id = p_usina_id and status = 'processando') then
        update usinas set lista_rateio_pendente = true where id = p_usina_id;
        return null;
    end if;

    select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_elig
      from (
        select row_number() over (
                   order by (cu.tipo_unidade = 'geradora') desc nulls last,
                            cu.prioridade nulls last, cu.created_at, cu.numero_uc) as ord,
               jsonb_build_object(
                   'id', cu.id,
                   'numero_uc', cu.numero_uc,
                   'tipo_unidade', cu.tipo_unidade,
                   'status', cu.status::text,
                   'franquia', cu.franquia,
                   'consumo_medio_kwh', null,
                   'cpf_cnpj', coalesce(nullif(cu.cpf_cnpj_fatura, ''), s.cpf_cnpj, ''),
                   'saldo_remanescente', coalesce(cu.saldo_remanescente, false),
                   'prioridade', cu.prioridade) as x
          from consumer_units cu
          left join subscribers s on s.id = cu.subscriber_id
         where cu.usina_id = p_usina_id
           and (cu.tipo_unidade = 'geradora'
                or cu.status::text in ('ativo', 'em_atraso', 'aguardando_conexao'))
      ) q;

    v_n := jsonb_array_length(v_elig);
    if v_n = 0 then
        return null;
    end if;

    v_porcent := coalesce(v_usina.rateio_type, 'prioridade') = 'porcentagem';

    if not v_porcent then
        v_idx := 0;
        for v_item in select * from jsonb_array_elements(v_elig) loop
            v_idx := v_idx + 1;
            v_proc := v_proc || jsonb_build_array(v_item || jsonb_build_object('prioridade', v_idx));
        end loop;
    else
        v_total := coalesce(nullif(v_usina.geracao_estimada_kwh, 0), 1);
        for v_idx in 0 .. v_n - 1 loop
            if (v_elig -> v_idx ->> 'saldo_remanescente')::boolean then v_saldo_ix := v_idx; end if;
            if v_ger_ix = -1 and (v_elig -> v_idx ->> 'tipo_unidade') = 'geradora' then v_ger_ix := v_idx; end if;
        end loop;
        if not exists (select 1 from jsonb_array_elements(v_elig) e where (e ->> 'saldo_remanescente')::boolean) then
            v_saldo_ix := case when v_ger_ix <> -1 then v_ger_ix else 0 end;
        end if;
        v_alvo := null;

        for v_idx in 0 .. v_n - 1 loop
            v_item := v_elig -> v_idx;
            v_prc := coalesce((v_item ->> 'franquia')::numeric, 0) / v_total * 100;
            if v_cur + v_prc <= 100 then
                v_cur := v_cur + v_prc;
                v_proc := v_proc || jsonb_build_array(v_item || jsonb_build_object('calculatedPercentage', v_prc));
            elsif v_cur < 100 then
                v_proc := v_proc || jsonb_build_array(v_item || jsonb_build_object('calculatedPercentage', 100 - v_cur));
                v_cur := 100;
                exit;
            else
                exit;
            end if;
        end loop;

        if v_cur < 100 and jsonb_array_length(v_proc) > 0 then
            -- A sobra vai para a UC do saldo remanescente (ou para a primeira).
            v_alvo := 0;
            for v_idx in 0 .. jsonb_array_length(v_proc) - 1 loop
                if (v_proc -> v_idx ->> 'id') = (v_elig -> v_saldo_ix ->> 'id') then v_alvo := v_idx; end if;
            end loop;
            v_pct := coalesce((v_proc -> v_alvo ->> 'calculatedPercentage')::numeric, 0) + (100 - v_cur);
            v_proc := jsonb_set(v_proc, array[v_alvo::text, 'calculatedPercentage'], to_jsonb(v_pct));
        end if;
    end if;

    -- Ja ha card 'criada': so renova o retrato, nunca abre um segundo.
    select id into v_card_id from rateio_lists
     where usina_id = p_usina_id and status = 'criada' order by created_at desc limit 1;

    if v_card_id is not null then
        update rateio_lists
           set ucs_snapshot = v_proc, qtd_ucs = jsonb_array_length(v_proc),
               rateio_type = coalesce(v_usina.rateio_type, 'prioridade'),
               concessionaria = v_usina.concessionaria,
               unidade_geradora = v_usina.unidade_geradora,
               updated_at = now()
         where id = v_card_id;
        perform fn_rateio_evento(v_card_id, 'retrato_renovado', jsonb_build_object('origem', p_origem, 'qtd_ucs', jsonb_array_length(v_proc)));
    else
        insert into rateio_lists
            (usina_id, usina_name, concessionaria, unidade_geradora, qtd_ucs, ucs_snapshot,
             rateio_type, status, status_dates, origem)
        values
            (p_usina_id, v_usina.name, v_usina.concessionaria, v_usina.unidade_geradora,
             jsonb_array_length(v_proc), v_proc, coalesce(v_usina.rateio_type, 'prioridade'),
             'criada', jsonb_build_object('criada_at', now()), p_origem)
        returning id into v_card_id;
        perform fn_rateio_evento(v_card_id, 'criada', jsonb_build_object('origem', p_origem, 'qtd_ucs', jsonb_array_length(v_proc)));
    end if;

    update usinas set lista_rateio_pendente = false where id = p_usina_id;
    return v_card_id;
end;
$$;

revoke all on function public.fn_gerar_lista_rateio_interno(uuid, text) from public, anon, authenticated;

create or replace function public.fn_gerar_lista_rateio(p_usina_id uuid, p_origem text default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
    if not fn_rateio_autorizado() then raise exception 'Sem permissao.'; end if;
    return fn_gerar_lista_rateio_interno(p_usina_id, p_origem);
end;
$$;

-- ------------------------------------------------ protocolo -> 'processando'
create or replace function public.fn_rateio_registrar_protocolo(
    p_rateio_id uuid, p_protocolo text, p_data date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r rateio_lists%rowtype;
begin
    if not fn_rateio_autorizado() then raise exception 'Sem permissao.'; end if;
    if coalesce(btrim(p_protocolo), '') = '' then raise exception 'Protocolo vazio.'; end if;
    select * into r from rateio_lists where id = p_rateio_id for update;
    if not found then raise exception 'Lista de rateio nao encontrada.'; end if;
    if r.status not in ('criada', 'reprovada') then
        raise exception 'So se registra protocolo em lista Criada ou Reprovada (esta esta %).', r.status;
    end if;
    update rateio_lists
       set protocolo = p_protocolo, status = 'processando',
           prazo_limite = p_data + 15, alerta_prazo = 'dentro_do_prazo',
           motivo_reprovacao = null, portal_status = null,
           status_dates = coalesce(status_dates, '{}'::jsonb) || jsonb_build_object('processando_at', now()),
           updated_at = now()
     where id = p_rateio_id;
    perform fn_rateio_evento(p_rateio_id, 'protocolo_registrado',
        jsonb_build_object('protocolo', p_protocolo, 'prazo_limite', p_data + 15));
end;
$$;

-- ----------------------------------------------------- aprovada -> concluida
create or replace function public.fn_rateio_concluir(p_rateio_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r        rateio_lists%rowtype;
    v_uc     record;
    v_tt     record;
    v_ok     int := 0;
    v_falhas jsonb := '[]'::jsonb;
begin
    if not fn_rateio_autorizado() then raise exception 'Sem permissao.'; end if;
    select * into r from rateio_lists where id = p_rateio_id for update;
    if not found then raise exception 'Lista de rateio nao encontrada.'; end if;
    if r.status not in ('processando', 'criada') then
        raise exception 'So se conclui lista Criada ou Processando (esta esta %).', r.status;
    end if;

    -- So sai de "ainda nao compensa" para ativo. em_atraso, cancelada etc. ficam como estao.
    for v_uc in
        select cu.id, cu.numero_uc
          from jsonb_array_elements(r.ucs_snapshot) e
          join consumer_units cu on cu.id = (e ->> 'id')::uuid
         where cu.usina_id = r.usina_id
           and cu.status::text in ('aguardando_conexao', 'vinculado', 'em_ativacao')
    loop
        begin
            update consumer_units set status = 'ativo' where id = v_uc.id;
            v_ok := v_ok + 1;
        exception when others then
            v_falhas := v_falhas || jsonb_build_array(jsonb_build_object('uc', v_uc.numero_uc, 'erro', sqlerrm));
        end;
    end loop;

    update rateio_lists
       set status = 'concluida', portal_status = coalesce(portal_status, 'aprovada'),
           alerta_prazo = null,
           status_dates = coalesce(status_dates, '{}'::jsonb) || jsonb_build_object('concluida_at', now()),
           updated_at = now()
     where id = p_rateio_id;

    perform fn_rateio_evento(p_rateio_id, 'concluida', jsonb_build_object('ucs_ativadas', v_ok, 'falhas', v_falhas));

    -- A TT que originou esta lista fecha o ciclo.
    for v_tt in select id from uc_transferencias_titularidade where rateio_list_id = p_rateio_id loop
        perform fn_tt_evento(v_tt.id, 'rateio_concluido', jsonb_build_object('rateio_id', p_rateio_id));
    end loop;

    return jsonb_build_object('ucs_ativadas', v_ok, 'falhas', v_falhas);
end;
$$;

-- ------------------------------ reprovada / cancelada pela distribuidora
-- Divergencia de dados (numero de UC, titular...) cancela a solicitacao la.
-- O card vai a 'reprovada' com o motivo; corrige-se o cadastro e se refaz a lista.
create or replace function public.fn_rateio_reprovar(p_rateio_id uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r rateio_lists%rowtype;
begin
    if not fn_rateio_autorizado() then raise exception 'Sem permissao.'; end if;
    select * into r from rateio_lists where id = p_rateio_id for update;
    if not found then raise exception 'Lista de rateio nao encontrada.'; end if;
    if r.status not in ('processando', 'criada') then
        raise exception 'So se reprova lista Criada ou Processando (esta esta %).', r.status;
    end if;
    update rateio_lists
       set status = 'reprovada', motivo_reprovacao = p_motivo, alerta_prazo = null,
           status_dates = coalesce(status_dates, '{}'::jsonb) || jsonb_build_object('reprovada_at', now()),
           updated_at = now()
     where id = p_rateio_id;
    perform fn_rateio_evento(p_rateio_id, 'reprovada', jsonb_build_object('motivo', p_motivo));
end;
$$;

-- --------------------------------------- leitura do portal (robo ou usuario)
create or replace function public.fn_rateio_registrar_status_portal(
    p_rateio_id uuid, p_status text, p_detalhe text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not fn_rateio_autorizado() then raise exception 'Sem permissao.'; end if;
    if p_status not in ('em_analise', 'aprovada', 'reprovada', 'cancelada_pela_distribuidora') then
        raise exception 'Status de portal desconhecido: %.', p_status;
    end if;
    update rateio_lists
       set portal_status = p_status, portal_ultima_consulta_em = now(), updated_at = now()
     where id = p_rateio_id;
    if not found then raise exception 'Lista de rateio nao encontrada.'; end if;
    perform fn_rateio_evento(p_rateio_id, 'portal_' || p_status, jsonb_build_object('detalhe', p_detalhe));

    if p_status = 'aprovada' then
        perform fn_rateio_concluir(p_rateio_id);
    elsif p_status in ('reprovada', 'cancelada_pela_distribuidora') then
        perform fn_rateio_reprovar(p_rateio_id, coalesce(p_detalhe, 'Solicitacao ' || replace(p_status, '_', ' ') || ' no portal.'));
    end if;
end;
$$;

-- --------------------------------------------- cron diario de acompanhamento
-- A distribuidora tem ate 15 dias, mas costuma ser bem mais rapida (a lista da
-- Bom Jesus II levou 9). O cron mede o tempo desde o protocolo e sobe o alerta;
-- a leitura do portal chega por fn_rateio_registrar_status_portal.
create or replace function public.fn_rateio_acompanhar()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    r      record;
    v_dias int;
    v_novo text;
    v_n    int := 0;
begin
    for r in select id, alerta_prazo, status_dates from rateio_lists where status = 'processando' loop
        v_dias := current_date - (coalesce((r.status_dates ->> 'processando_at')::timestamptz, now()))::date;
        v_novo := case when v_dias > 15 then 'vencido'
                       when v_dias >= 13 then 'critico'
                       when v_dias >= 8  then 'atencao'
                       else 'dentro_do_prazo' end;
        if r.alerta_prazo is distinct from v_novo then
            update rateio_lists set alerta_prazo = v_novo, updated_at = now() where id = r.id;
            perform fn_rateio_evento(r.id, 'alerta_prazo', jsonb_build_object('alerta', v_novo, 'dias', v_dias));
            v_n := v_n + 1;
        end if;
    end loop;
    return v_n;
end;
$$;

do $$
begin
    if exists (select 1 from cron.job where jobname = 'rateio-acompanhamento') then
        perform cron.unschedule('rateio-acompanhamento');
    end if;
    perform cron.schedule('rateio-acompanhamento', '47 9 * * *', 'select public.fn_rateio_acompanhar()');
end $$;

-- ------------------------------- card que estava esperando: gera ao fechar
create or replace function public.fn_rateio_fechou_gera_pendente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status in ('concluida', 'reprovada', 'cancelada')
       and old.status is distinct from new.status
       and exists (select 1 from usinas where id = new.usina_id and lista_rateio_pendente) then
        perform fn_gerar_lista_rateio_interno(new.usina_id, 'tt');
    end if;
    return new;
end;
$$;

drop trigger if exists tr_rateio_fechou_gera_pendente on public.rateio_lists;
create trigger tr_rateio_fechou_gera_pendente
    after update of status on public.rateio_lists
    for each row execute function public.fn_rateio_fechou_gera_pendente();

-- ------------------------- fn_concluir_tt passa a pedir o card de rateio
create or replace function public.fn_concluir_tt(
    p_tt_id          uuid,
    p_numero_uc_novo text default null,
    p_data           date default current_date
)
returns uuid
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
    v_card     uuid;
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

    update consumer_units
       set numero_uc               = coalesce(v_novo, numero_uc),
           titular_fatura_id       = r.cessionario_id,
           titular_conta           = v_nome_ces,
           numero_uc_anterior      = r.numero_uc_origem,
           titular_anterior_id     = r.cedente_id,
           data_troca_titularidade = p_data,
           status                  = 'aguardando_conexao'
     where id = v_uc.id;

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

    -- A UC ja esta na usina, mas a distribuidora so a compensa depois da
    -- alteracao da lista: pede (ou renova) o card unico da usina.
    v_card := fn_gerar_lista_rateio_interno(r.usina_destino_id, 'tt');
    if v_card is not null then
        update uc_transferencias_titularidade set rateio_list_id = v_card where id = r.id;
        perform fn_tt_evento(r.id, 'lista_rateio', jsonb_build_object('rateio_id', v_card));
    else
        perform fn_tt_evento(r.id, 'lista_rateio_pendente',
            jsonb_build_object('motivo', 'Ja ha lista em processamento na distribuidora; o card novo nasce quando ela fechar.'));
    end if;

    return v_sombra;
end;
$$;

-- ------------------------------------------------------------------ grants
do $$
declare f text;
begin
    foreach f in array array[
        'fn_gerar_lista_rateio(uuid, text)',
        'fn_rateio_registrar_protocolo(uuid, text, date)',
        'fn_rateio_concluir(uuid)',
        'fn_rateio_reprovar(uuid, text)',
        'fn_rateio_registrar_status_portal(uuid, text, text)',
        'fn_concluir_tt(uuid, text, date)'
    ] loop
        execute format('revoke all on function public.%s from public, anon', f);
        execute format('grant execute on function public.%s to authenticated, service_role', f);
    end loop;
    revoke all on function public.fn_rateio_acompanhar() from public, anon, authenticated;
    revoke all on function public.fn_rateio_autorizado() from public, anon;
    grant execute on function public.fn_rateio_autorizado() to authenticated, service_role;
end $$;
