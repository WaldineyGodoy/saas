-- ============================================================================
-- TT automatica: a UC entra em TT no CRM e o robo protocola sozinho
--
-- Pedido do dono em 23/11/2026 (UC da Adelita, TT em 'a_iniciar' sem ninguem
-- para rodar o tt_filler.js). Ate aqui o robo era manual.
--
-- Mesmo desenho do faturista (20260904e): o banco aciona o workflow do GitHub
-- (.github/workflows/tt-filler.yml), porque o Chromium precisa de Xvfb para
-- passar pelo WAF da Neoenergia e uma Edge Function nao roda navegador.
--
--   1. Gatilho: uma TT que FICA em 'a_iniciar' (nova, ou "Tentar de novo")
--      dispara o workflow na hora.
--   2. Rede de seguranca (pg_cron, a cada 15 min): se sobrou TT em 'a_iniciar'
--      ha mais de 10 min -- disparo perdido, token ausente, runner caido --,
--      dispara de novo. Sem TT esquecida, nao faz nada.
--
-- O que NAO muda: debito na UG ou dia de faturamento continuam parando a TT
-- ('bloqueada_por_debito' / 'erro'), e so uma pessoa usa "Tentar de novo".
-- O envio so acontece se as conferencias do `--auto-enviar` passarem.
-- Duas execucoes nao protocolam a mesma TT: fn_tt_reivindicar e atomica.
--
-- DEPENDE do workflow tt-filler.yml ja estar no branch main: o dispatch aponta
-- para ele. Aplicar esta migracao so depois do merge.
-- ============================================================================

create or replace function public.fn_disparar_tt(p_motivo text default 'pg_cron')
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_token text;
    v_req   bigint;
begin
    select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'cron:github_token';

    if v_token is null then
        raise exception 'Segredo cron:github_token ausente no Vault. Sem ele o banco nao consegue acionar o workflow da TT.';
    end if;

    select net.http_post(
        url  := 'https://api.github.com/repos/WaldineyGodoy/saas/actions/workflows/tt-filler.yml/dispatches',
        body := jsonb_build_object(
            'ref', 'main',
            'inputs', jsonb_build_object('reason', coalesce(p_motivo, 'pg_cron'))
        ),
        headers := jsonb_build_object(
            'Content-Type',          'application/json',
            'Accept',                'application/vnd.github+json',
            'X-GitHub-Api-Version',  '2022-11-28',
            'User-Agent',            'b2w-pg-cron',
            'Authorization',         'Bearer ' || v_token
        ),
        timeout_milliseconds := 30000
    ) into v_req;

    insert into robo_execucoes (robo, aplicou, detalhe)
    values ('tt-disparo', true,
            jsonb_build_object('origem', coalesce(p_motivo, 'pg_cron'), 'http_request_id', v_req));

    return v_req;
end;
$fn$;

revoke execute on function public.fn_disparar_tt(text) from public, anon, authenticated;

-- Gatilho: nunca pode impedir a criacao ou a nova tentativa da TT. Se o disparo
-- falhar, a TT fica em 'a_iniciar' e a rede de seguranca pega depois.
create or replace function public.fn_tt_disparar_ao_ficar_pronta()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
    begin
        perform public.fn_disparar_tt('gatilho: TT ' || new.id);
    exception when others then
        raise warning 'fn_disparar_tt falhou (%): a rede de seguranca tenta de novo.', sqlerrm;
    end;
    return new;
end;
$fn$;

revoke execute on function public.fn_tt_disparar_ao_ficar_pronta() from public, anon, authenticated;

-- Dois gatilhos porque `tg_op` nao existe na clausula WHEN (e `old` nao existe
-- no INSERT): um para a TT que nasce pronta, outro para a que VOLTA a 'a_iniciar'
-- ("Tentar de novo" / quitacao informada). Atualizar outras colunas nao dispara.
drop trigger if exists trg_tt_disparar_ao_nascer on public.uc_transferencias_titularidade;
create trigger trg_tt_disparar_ao_nascer
    after insert on public.uc_transferencias_titularidade
    for each row
    when (new.status = 'a_iniciar')
    execute function public.fn_tt_disparar_ao_ficar_pronta();

drop trigger if exists trg_tt_disparar_ao_voltar on public.uc_transferencias_titularidade;
create trigger trg_tt_disparar_ao_voltar
    after update of status on public.uc_transferencias_titularidade
    for each row
    when (new.status = 'a_iniciar' and old.status is distinct from 'a_iniciar')
    execute function public.fn_tt_disparar_ao_ficar_pronta();

-- Rede de seguranca.
create or replace function public.fn_tt_rede_seguranca()
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
begin
    if exists (select 1 from uc_transferencias_titularidade
                where status = 'a_iniciar'
                  and atualizado_em < now() - interval '10 minutes') then
        return public.fn_disparar_tt('rede de seguranca');
    end if;
    return null;
end;
$fn$;

revoke execute on function public.fn_tt_rede_seguranca() from public, anon, authenticated;

select cron.unschedule('tt-rede-seguranca')
where exists (select 1 from cron.job where jobname = 'tt-rede-seguranca');

select cron.schedule(
    'tt-rede-seguranca',
    '*/15 * * * *',
    $cron$ select public.fn_tt_rede_seguranca() $cron$
);
