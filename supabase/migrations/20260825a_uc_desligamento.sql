-- Desligamento de UC na concessionaria: dado, historico e auditoria.
--
-- O CASO (UC 7029990055, apurado em 25/08/2026)
--
-- O assinante pediu o desligamento do medidor direto na concessionaria, sem
-- avisar a B2W. Descobrimos em 13/05 olhando o portal. O ultimo ciclo de
-- leitura teve 19 dias (10/04 a 29/04) contra 17 e 29 dos anteriores -- ciclo
-- curto encerrando a serie e assinatura de leitura de encerramento. Premissa
-- adotada pelo dono: desligamento em 29/04/2026.
--
-- A Cosern seguiu emitindo conta de periodos POSTERIORES ao desligamento. Nao
-- havia no sistema nem o dado do desligamento nem regra que barrasse a
-- cobranca dessas contas ao assinante.
--
-- E nao havia como saber QUANDO o status mudou: consumer_units nao tinha
-- trigger de historico -- invoices tinha, UC nao. Sobravam so os registros que
-- a tela grava a mao e o updated_at, que o robo sobrescreve a cada tentativa.
-- Dai o "historico sem cronologia real dos eventos".
--
-- Nota: o status 'desconectado' existe no enum uc_status e nunca foi usado em
-- nenhuma das 30 UCs da base. Esta UC foi de ativa direto para
-- cancelado_inadimplente, em 31/07/2026, pelo modal.

-- ---------------------------------------------------------------------------
-- 1. O desligamento vira dado
-- ---------------------------------------------------------------------------
alter table public.consumer_units
    add column if not exists data_desligamento date,
    add column if not exists desligamento_origem text,
    add column if not exists desligamento_detectado_em timestamptz;

comment on column public.consumer_units.data_desligamento is
    'Data em que a UC foi desligada na concessionaria. Conta cujo periodo de leitura COMECA nesta data ou depois nao e devida pelo assinante -- ver fn_auditar_fatura.';
comment on column public.consumer_units.desligamento_origem is
    'Como o desligamento foi descoberto: portal, leitura_curta, manual ou concessionaria.';
comment on column public.consumer_units.desligamento_detectado_em is
    'Quando o sistema soube. Diferente de data_desligamento: o assinante desliga sem avisar e a descoberta vem depois.';

-- ---------------------------------------------------------------------------
-- 2. Historico da UC
-- ---------------------------------------------------------------------------
create or replace function public.fn_log_consumer_unit_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_mudancas jsonb := '{}'::jsonb;
    v_texto text[] := array[]::text[];
    v_autor uuid;
begin
    if TG_OP = 'INSERT' then
        insert into public.crm_history (entity_type, entity_id, content, metadata, created_by)
        values ('consumer_unit', NEW.id,
                format('UC %s criada com status %s.', NEW.numero_uc, NEW.status),
                jsonb_build_object('evento', 'criacao', 'status', NEW.status::text),
                auth.uid());
        return NEW;
    end if;

    -- So campos que mudam dinheiro ou responsabilidade. Ruido de scraping
    -- (last_scraping_*) fica de fora de proposito: o robo escreve todo dia e
    -- afogaria a linha do tempo.
    if NEW.status is distinct from OLD.status then
        v_mudancas := v_mudancas || jsonb_build_object('status',
            jsonb_build_object('de', OLD.status::text, 'para', NEW.status::text));
        v_texto := v_texto || format('status %s -> %s', OLD.status, NEW.status);
    end if;

    if NEW.data_desligamento is distinct from OLD.data_desligamento then
        v_mudancas := v_mudancas || jsonb_build_object('data_desligamento',
            jsonb_build_object('de', OLD.data_desligamento, 'para', NEW.data_desligamento));
        v_texto := v_texto || format('desligamento %s -> %s',
            coalesce(OLD.data_desligamento::text, 'nao informado'),
            coalesce(NEW.data_desligamento::text, 'nao informado'));
    end if;

    if NEW.usina_id is distinct from OLD.usina_id then
        v_mudancas := v_mudancas || jsonb_build_object('usina_id',
            jsonb_build_object('de', OLD.usina_id, 'para', NEW.usina_id));
        v_texto := v_texto || case
            when NEW.usina_id is null then 'saiu do rateio da usina'
            when OLD.usina_id is null then 'entrou no rateio de uma usina'
            else 'trocou de usina' end;
    end if;

    if NEW.titular_fatura_id is distinct from OLD.titular_fatura_id then
        v_mudancas := v_mudancas || jsonb_build_object('titular_fatura_id',
            jsonb_build_object('de', OLD.titular_fatura_id, 'para', NEW.titular_fatura_id));
        v_texto := v_texto || 'trocou o titular da fatura';
    end if;

    if NEW.tarifa_concessionaria is distinct from OLD.tarifa_concessionaria then
        v_mudancas := v_mudancas || jsonb_build_object('tarifa_concessionaria',
            jsonb_build_object('de', OLD.tarifa_concessionaria, 'para', NEW.tarifa_concessionaria));
        v_texto := v_texto || format('tarifa %s -> %s', OLD.tarifa_concessionaria, NEW.tarifa_concessionaria);
    end if;

    if NEW.desconto_assinante is distinct from OLD.desconto_assinante then
        v_mudancas := v_mudancas || jsonb_build_object('desconto_assinante',
            jsonb_build_object('de', OLD.desconto_assinante, 'para', NEW.desconto_assinante));
        v_texto := v_texto || format('desconto %s%% -> %s%%', OLD.desconto_assinante, NEW.desconto_assinante);
    end if;

    if NEW.numero_uc is distinct from OLD.numero_uc then
        v_mudancas := v_mudancas || jsonb_build_object('numero_uc',
            jsonb_build_object('de', OLD.numero_uc, 'para', NEW.numero_uc));
        v_texto := v_texto || format('numero %s -> %s', OLD.numero_uc, NEW.numero_uc);
    end if;

    if v_mudancas = '{}'::jsonb then
        return NEW;
    end if;

    -- auth.uid() e nulo quando quem escreve e o robo (service_role).
    v_autor := auth.uid();

    insert into public.crm_history (entity_type, entity_id, content, metadata, created_by)
    values ('consumer_unit', NEW.id,
            format('UC %s: %s', NEW.numero_uc, array_to_string(v_texto, '; ')),
            jsonb_build_object('evento', 'alteracao', 'mudancas', v_mudancas,
                               'origem', case when v_autor is null then 'automacao' else 'usuario' end),
            v_autor);
    return NEW;
end;
$$;

drop trigger if exists tr_log_consumer_unit_change on public.consumer_units;
create trigger tr_log_consumer_unit_change
    after insert or update on public.consumer_units
    for each row execute function public.fn_log_consumer_unit_change();

comment on function public.fn_log_consumer_unit_change() is
    'Historico da UC em crm_history. So campos que mudam dinheiro ou responsabilidade; ignora last_scraping_* de proposito, que o robo escreve todo dia.';

-- ---------------------------------------------------------------------------
-- 3. Auxiliares da auditoria
-- ---------------------------------------------------------------------------

-- Periodo que COMECA na data do desligamento e integralmente posterior, nao
-- atravessamento: o medidor parou naquele dia. E o formato das contas que a
-- concessionaria seguiu emitindo.
create or replace function public.fn_periodo_vs_desligamento(
    p_leitura_anterior date, p_leitura date, p_desligamento date
) returns text
language sql immutable as $$
    select case
        when p_desligamento is null or p_leitura_anterior is null then 'sem_regra'
        when p_leitura_anterior >= p_desligamento then 'pos_desligamento'
        when p_leitura is not null and p_desligamento < p_leitura then 'atravessa'
        else 'anterior'
    end;
$$;

-- Ciclo curto SOZINHO nao serve: em 03/2026 a Cosern encurtou o ciclo de cinco
-- UCs do mesmo grupo de uma vez (remanejamento de calendario) e o consumo
-- seguiu normal -- oito falsos positivos na primeira versao. O que caracteriza
-- encerramento e ciclo curto E NAO HAVER LEITURA DEPOIS. Com essa exigencia, a
-- base inteira devolve exatamente uma suspeita: a UC do caso.
create or replace function public.fn_suspeita_desligamento(p_invoice_id uuid)
returns table (suspeita boolean, dias_ciclo int, mediana numeric, ciclos int, ultima boolean)
language sql stable security definer set search_path = public as $$
    with f as (
        select i.id, i.uc_id, i.mes_referencia, i.data_leitura, i.data_leitura_anterior
          from public.invoices i where i.id = p_invoice_id
    ), ciclo as (
        select (f.data_leitura - f.data_leitura_anterior) as dias from f
    ), outras as (
        select percentile_cont(0.5) within group (order by (o.data_leitura - o.data_leitura_anterior))::numeric as med,
               count(*)::int as qtd
          from public.invoices o, f
         where o.uc_id = f.uc_id and o.id <> f.id
           and o.data_leitura is not null and o.data_leitura_anterior is not null
           and (o.data_leitura - o.data_leitura_anterior) > 0
           and o.status::text not in ('cancelado','cancelada')
    ), posterior as (
        select not exists (
            select 1 from public.invoices p, f
             where p.uc_id = f.uc_id and p.mes_referencia > f.mes_referencia
               and p.status::text not in ('cancelado','cancelada')
        ) as e_ultima from f
    )
    select (ciclo.dias > 0 and outras.qtd >= 2 and outras.med > 0
            and ciclo.dias < outras.med * 0.85 and posterior.e_ultima),
           ciclo.dias, round(outras.med, 1), outras.qtd, posterior.e_ultima
      from ciclo, outras, posterior;
$$;

revoke all on function public.fn_periodo_vs_desligamento(date, date, date) from public, anon;
grant execute on function public.fn_periodo_vs_desligamento(date, date, date) to authenticated, service_role;
revoke all on function public.fn_suspeita_desligamento(uuid) from public, anon;
grant execute on function public.fn_suspeita_desligamento(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. fn_auditar_fatura ganhou tres regras (corpo completo em 20260823a):
--
--   conta_pos_desligamento (BLOQUEIO) -- periodo inteiro posterior ao
--     desligamento. O assinante nao consumiu nada; cobrar seria repassar custo
--     de terceiro.
--
--   periodo_atravessa_desligamento (AVISO) -- desligamento no meio do periodo.
--     A parte anterior e devida, a posterior nao; o rateio proporcional e
--     conta de gente.
--
--   suspeita_desligamento (AVISO) -- ultima conta com ciclo curto numa UC sem
--     desligamento registrado.
--
-- Regressao contra as 48 faturas ja cobradas: nenhum bloqueio novo.
-- ---------------------------------------------------------------------------
