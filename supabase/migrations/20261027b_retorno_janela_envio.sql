-- Trava da janela de envio nos retornos agendados pelos agentes, 26/10/2026.
--
-- A janela dos agentes (followup.send_window: dias úteis, 08:15 às 17:00 em
-- Brasília) só vale para as retomadas automáticas do motor (cron_jobs com
-- payload.node_id). O retorno que o agente agenda com schedule_followup
-- (payload.promised_at, sem node_id) sai na hora marcada, mesmo à noite: foi
-- o caso de um retorno prometido "à noite" que saiu às 20:31.
--
-- Este gatilho adia esses retornos para o início da próxima janela. Exceção:
-- retorno para daqui a até 15 minutos, que é parte de uma conversa em curso
-- (ex.: entregar o link do contrato na adesão pelo WhatsApp). promised_at fica
-- como o agente gravou; o motivo ganha uma nota para a mensagem não falar em
-- "noite". Nunca bloqueia a gravação do motor.

create or replace function ponte_deskcomm.fn_proxima_janela_envio(p_quando timestamptz)
returns timestamptz
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
    -- Mesma janela de followup.send_window de todos os agentes publicados.
    c_inicio constant time := '08:15';
    c_fim    constant time := '17:00';
    v_local  timestamp := p_quando at time zone 'America/Sao_Paulo';
    v_dia    date := v_local::date;
begin
    if extract(isodow from v_dia) <= 5 then
        if v_local::time between c_inicio and c_fim then return p_quando; end if;
        if v_local::time < c_inicio then
            return (v_dia + c_inicio) at time zone 'America/Sao_Paulo';
        end if;
    end if;
    v_dia := v_dia + 1;
    while extract(isodow from v_dia) > 5 loop v_dia := v_dia + 1; end loop;
    return (v_dia + c_inicio) at time zone 'America/Sao_Paulo';
end $$;

create or replace function ponte_deskcomm.fn_retorno_na_janela()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
    v_janela timestamptz;
begin
    begin
        if new.job_kind = 'followup_turn' and new.kind = 'at' and new.enabled
           and new.payload ? 'promised_at' and not new.payload ? 'node_id'
           and new.next_run_at > now() + interval '15 minutes' then
            v_janela := ponte_deskcomm.fn_proxima_janela_envio(new.next_run_at);
            if v_janela > new.next_run_at then
                new.payload := new.payload || jsonb_build_object(
                    'adiado_pela_janela_de', new.next_run_at,
                    'reason', coalesce(new.payload->>'reason', '')
                        || ' (Retorno adiado para o horário de atendimento: não diga que é noite nem fim de semana; retome de forma natural.)');
                new.next_run_at := v_janela;
            end if;
        end if;
    exception when others then
        insert into ponte_deskcomm.erros (onde, mensagem)
        values ('fn_retorno_na_janela', sqlerrm || ' cron_job ' || new.id);
    end;
    return new;
end $$;

drop trigger if exists trg_ponte_retorno_janela on public.cron_jobs;
create trigger trg_ponte_retorno_janela
    before insert or update of next_run_at, payload, enabled on public.cron_jobs
    for each row execute function ponte_deskcomm.fn_retorno_na_janela();

-- Retornos já agendados fora da janela passam pelo gatilho.
update public.cron_jobs set next_run_at = next_run_at
 where enabled and job_kind = 'followup_turn' and kind = 'at'
   and payload ? 'promised_at' and not payload ? 'node_id' and next_run_at > now();
